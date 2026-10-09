// V2026-10-09 治本 (Visitor Agent 服务 — SPEC §11.1):
//   职责: 编排 persona → prompt → LLM 流, 维护 per-session 记忆 (history + emotion)
//   调用方: VoiceService.onUserText()
//   关键设计:
//     - 内存 Map<sessionId, VisitorSessionMemory> 维护对话历史 (V0.x 兜底, V1.x 接 Redis)
//     - 滑动窗口: 单 session 最多保留 20 条消息 (10 轮 user+assistant), 防止 prompt 膨胀
//     - history capture: async generator 的 try/finally 包裹 inner LLM 流
//         - 正常完成 (for-await 自然结束 + done chunk) → 提交 assistant 文本
//         - 早退 (barge-in break) / error chunk / 异常 → 回滚 user 消息, 不污染 history
//     - persona 锁定: openSession 时 snapshot persona 实体引用, 整个 session 期间不重新加载
//     - signal 透传: AbortSignal 从 VoiceService → Visitor → LlmService, fetch 真中断
//         (修 Phase 3 治本注释里说"AbortController 注入 fetch"但实际没接的 bug)
//
//   反双胞胎:
//     - 不写 LLM chunk 的拼接逻辑 — 那是 VoiceService 的事 (转发到 TTS + client)
//     - 不缓存 persona 自身到 memory 之外 — PersonaRepository 自己有缓存, Visitor 只引用
//     - 不用 class 包装 LlmMessage — interface + readonly 字段, 简单可序列化
//     - 不接 Supervisor / RAG — Phase 4 不在范围, Phase 5 加
//
//   如何验证:
//     1. pnpm build 无 type error
//     2. openSession 后 memory 落到 Map, currentEmotion = persona.emotionBaseline
//     3. streamTurn 后 messages 增加 user + assistant 两条
//     4. barge-in break: 验证 user 消息被回滚, 不污染下次
//     5. closeSession 后 memory 清理, 同 sessionId 再 openSession 创建新对象

import { Inject, Injectable, Logger } from '@nestjs/common';

import { renderSystemPrompt, VISITOR_HISTORY_SLICE_TURNS } from './visitor.prompts';
import type {
  VisitorCloseResult,
  VisitorMessage,
  VisitorPersonaSnapshot,
  VisitorSessionMemory,
  VisitorTurnOptions,
  VisitorTurnResult,
} from './visitor.types';
import { LlmService } from '../llm/llm.service';
import type { LlmMessage, LlmStream } from '../llm/llm.types';
import type { Persona } from '../persona/domain/entities/persona.entity';
import { PERSONA_REPOSITORY, type PersonaRepository } from '../persona/domain/repositories/persona.repository';

/** 单 session 记忆最大消息数 (user+assistant 算 1 对, 2 条). */
const MAX_HISTORY_MESSAGES = VISITOR_HISTORY_SLICE_TURNS * 2;

@Injectable()
export class VisitorService {
  private readonly logger = new Logger(VisitorService.name);
  /** sessionId → memory. V0.x 内存, V1.x 接 Redis (session 共享 + 持久化). */
  private readonly memories = new Map<string, VisitorSessionMemory>();

  constructor(
    private readonly llm: LlmService,
    @Inject(PERSONA_REPOSITORY) private readonly personas: PersonaRepository,
  ) {}

  /**
   * 启动 visitor session — 加载 persona, 创建 memory.
   * VoiceService.startSession 阶段调用.
   * @param opts.sessionId 必传
   * @param opts.tenantId 必传 (V0.x 传 'default')
   * @param opts.personaId 可选, 不传或找不到时 fallback 到 default persona
   * @returns persona 快照 (id / name / voiceId / difficulty) — VoiceService 缓存到 session state
   * @throws 当 default persona 也不存在时抛错 (启动期必现, 单元测试要 mock)
   */
  async openSession(opts: {
    readonly sessionId: string;
    readonly tenantId: string;
    readonly personaId?: string;
  }): Promise<VisitorPersonaSnapshot> {
    const persona = await this.resolvePersona(opts.tenantId, opts.personaId);
    if (!persona) {
      throw new Error(
        `VisitorService.openSession: no persona available (tenant=${opts.tenantId} ` +
          `requested=${opts.personaId ?? '<none>'}) — V2026-10-09 治本`,
      );
    }
    const memory: VisitorSessionMemory = {
      sessionId: opts.sessionId,
      persona,
      tenantId: opts.tenantId,
      createdAt: Date.now(),
      messages: [],
      currentEmotion: persona.emotionBaseline,
      turnCount: 0,
      lastActiveAt: Date.now(),
    };
    this.memories.set(opts.sessionId, memory);
    this.logger.log(
      `[openSession] session=${opts.sessionId} tenant=${opts.tenantId} ` +
        `persona=${persona.id} difficulty=${persona.difficulty} voice=${persona.voiceId}`,
    );
    return {
      id: persona.id,
      name: persona.name,
      voiceId: persona.voiceId,
      difficulty: persona.difficulty,
    };
  }

  /**
   * 一轮对话 — 拼 messages + LLM 流 + 包装 history capture.
   * 同步返回 (LlmStream 本身是 async iterable), 无 await.
   * @throws 当 sessionId 未 openSession 过时抛错 (运行时必现, 是 bug)
   */
  streamTurn(opts: VisitorTurnOptions): VisitorTurnResult {
    const memory = this.getMemoryOrThrow(opts.sessionId);
    // 1. 追加 user 消息 (先入, finally 失败时回滚)
    const userMessage: VisitorMessage = {
      role: 'user',
      content: opts.userText,
      at: Date.now(),
    };
    memory.messages.push(userMessage);
    memory.lastActiveAt = userMessage.at;

    // 2. 拼 LlmMessage[] + 调 LLM
    const llmMessages = this.buildLlmMessages(memory);
    const inner = this.llm.streamChat(llmMessages, {
      tenantId: opts.tenantId,
      userId: opts.userId,
      traceId: opts.traceId,
      signal: opts.signal,
      temperature: 0.7,
      maxTokens: 200,
    });

    // 3. 包装 history capture
    return { stream: this.wrapWithHistory(inner, memory) };
  }

  /** 关闭 session, 清理 memory. */
  closeSession(sessionId: string): VisitorCloseResult {
    const memory = this.memories.get(sessionId);
    if (!memory) {
      return { hadMemory: false, finalTurnCount: 0, finalMessageCount: 0 };
    }
    const result: VisitorCloseResult = {
      hadMemory: true,
      finalTurnCount: memory.turnCount,
      finalMessageCount: memory.messages.length,
    };
    this.memories.delete(sessionId);
    this.logger.log(`[closeSession] session=${sessionId} turns=${result.finalTurnCount} ` + `msgs=${result.finalMessageCount}`);
    return result;
  }

  /** 当前活跃 session 数 (健康检查 / 测试用). */
  size(): number {
    return this.memories.size;
  }

  // ── private ────────────────────────────────────────────────────

  private async resolvePersona(tenantId: string, personaId: string | undefined): Promise<Persona | null> {
    if (personaId) {
      const found = await this.personas.findById(tenantId, personaId);
      if (found) return found;
    }
    return this.personas.findDefault(tenantId);
  }

  private getMemoryOrThrow(sessionId: string): VisitorSessionMemory {
    const memory = this.memories.get(sessionId);
    if (!memory) {
      throw new Error(`VisitorService.streamTurn: sessionId=${sessionId} not opened — ` + 'V2026-10-09 治本: 必须先 openSession');
    }
    return memory;
  }

  /**
   * 拼 LlmMessage[] — system prompt (含 persona + 行为 + 历史摘要) + 滑窗 messages.
   * 系统 prompt 通过 renderSystemPrompt 渲染; 滑窗 messages 保留最近 MAX_HISTORY_MESSAGES 条.
   * 注意: 当前 user 消息已在 streamTurn 里 push, 这里直接 slice 即可.
   */
  private buildLlmMessages(memory: VisitorSessionMemory): readonly LlmMessage[] {
    const systemPrompt = renderSystemPrompt(memory.persona, memory);
    const recentMessages = memory.messages.slice(-MAX_HISTORY_MESSAGES);
    return [{ role: 'system', content: systemPrompt }, ...recentMessages.map((m): LlmMessage => ({ role: m.role, content: m.content }))];
  }

  /**
   * 包裹 LLM 流 + 维护 history.
   * 关键: try/finally 在 async generator 中支持早退时触发,
   *   for-await break (barge-in) 或抛异常时 finally 块一定执行.
   *   区分两种情况: committed 标志位.
   */
  private async *wrapWithHistory(inner: LlmStream, memory: VisitorSessionMemory): LlmStream {
    let assistantText = '';
    let committed = false;
    try {
      for await (const chunk of inner) {
        if (chunk.type === 'content') {
          assistantText += chunk.content;
        }
        yield chunk;
        if (chunk.type === 'done') {
          // 正常完成: 提交 assistant 文本
          if (assistantText.length > 0) {
            memory.messages.push({ role: 'assistant', content: assistantText, at: Date.now() });
          }
          memory.turnCount += 1;
          memory.lastActiveAt = Date.now();
          this.trimHistory(memory);
          committed = true;
        }
        if (chunk.type === 'error') {
          // 错误 chunk 算早退, 不提交, 走 finally 回滚
          break;
        }
      }
    } catch (err) {
      this.logger.warn(`[wrap] session=${memory.sessionId} err=${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (!committed) {
        // 早退 (barge-in break / error chunk / 异常): 回滚 user 消息
        this.rollbackLastUser(memory);
        this.logger.log(
          `[barge-in/rollback] session=${memory.sessionId} ` + `partial_chars=${assistantText.length} msgs_after=${memory.messages.length}`,
        );
      }
    }
  }

  /**
   * 回滚最后一个 user 消息.
   * 设计前提: openSession 后, streamTurn push 一个 user → LLM 流 → done 时 push assistant.
   * 早退时只 push 了 user, 所以 pop 最后一个 user 即可. assistant 必然在 user 之前.
   */
  private rollbackLastUser(memory: VisitorSessionMemory): void {
    for (let i = memory.messages.length - 1; i >= 0; i -= 1) {
      const msg = memory.messages[i];
      if (msg && msg.role === 'user') {
        memory.messages.splice(i, 1);
        return;
      }
    }
  }

  private trimHistory(memory: VisitorSessionMemory): void {
    if (memory.messages.length > MAX_HISTORY_MESSAGES) {
      memory.messages.splice(0, memory.messages.length - MAX_HISTORY_MESSAGES);
    }
  }
}
