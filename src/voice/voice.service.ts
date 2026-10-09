// V2026-10-09 治本 (Voice Session 业务编排 — SPEC §9.3 / §10.2 + §11.1):
//   职责升级 (Phase 4): 维护 per-session 状态 (VoiceSessionState), 编排 LLM → TTS 流水线,
//     处理打断 (user_speaking). Phase 4 起 LLM 调用通过 VisitorService (persona + history 编排),
//     VoiceService 只负责: 启动 visitor session / 取 TTS voice / 转发 LLM chunk 到 TTS + client / 打断.
//   调用方: VoiceGateway.handleMessage() 转发事件进来, 本 service 异步推流
//     给 gateway, gateway 转发给 client.
//
//   关键设计:
//     - 每 session 一个 VoiceSessionState (Map<sessionId, state>)
//     - 每条 user_text 自增 currentGeneration, 老 pipeline 检查 generation 不匹配
//       自己退出, 避免老请求的 TTS 音频继续流到 client
//     - LLM 取消: AbortController 注入 fetch (V2026-10-09 治本: 修 Phase 3 dead AbortController),
//       signal 透传到 LlmService, abort() 立即断网 + 关 reader
//     - TTS 取消: TtsService.cancel() 协议级 task_cancel (MiniMax 原生)
//     - Persona: startSession 时 resolve 并缓存, TTS voiceId 用 persona.voiceId,
//       LLM 用 persona prompt 模板 (通过 VisitorService 编排)
//
//   错误处理:
//     - visitor.openSession 失败 (无 persona) → startSession throw → gateway close 1011
//     - LLM 流错误 → yield error 消息给 client, 标记 session 'idle' 等下一轮
//     - TTS 流错误 → 同上
//     - 顶层异常 → 捕获 + 标记 session 'error' + yield session_ended
//
//   反双胞胎:
//     - 不在 service 内自己 emit WS — emit 通过 VoiceGateway 注入的 callback
//     - 不用 RxJS Subject — 异步生成器 + Map<sessionId, generator> 简单够用
//     - 不在 service 内自己 build prompt — 那是 VisitorService 的事 (§11.1)
//     - 不再直接 inject LlmService — Phase 4 全走 VisitorService (单职责)
//
//   如何验证:
//     1. pnpm build 无 type error
//     2. 集成测试: mock VisitorService, 跑通"user_text → visitor.streamTurn → tts 流 → done"
//     3. 打断测试: user_text → 处理中 → user_speaking → TTS cancel + LLM abort (signal 透传)
//     4. persona 切换: ?personaId=l1_zhang vs l3_wang, TTS 音色 + prompt 行为应不同

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { TtsService } from './tts/tts.service';
import type { TtsOptions, TtsSessionHandle } from './tts/tts.types';
import type { VoiceClientMessage, VoiceServerMessage, VoiceSessionMeta, VoiceSessionPersona, VoiceSessionState } from './voice.types';
import type { LlmStream } from '../agent/llm/llm.types';
import { VisitorService } from '../agent/visitor/visitor.service';

type SendFn = (msg: VoiceServerMessage) => void;

@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);
  private readonly defaultVoice: string;
  private readonly defaultModel: string;

  private readonly sessions = new Map<string, VoiceSessionState>();

  constructor(
    private readonly visitor: VisitorService,
    private readonly tts: TtsService,
    config: ConfigService,
  ) {
    this.defaultVoice = config.get<string>('minimax.ttsDefaultVoice') ?? 'mandarin_female_001';
    this.defaultModel = config.get<string>('minimax.llmModel') ?? 'MiniMax-M3';
  }

  /** 处理一条客户端消息. gateway 在 socket.onMessage 时调. */
  async handleMessage(meta: VoiceSessionMeta, msg: VoiceClientMessage, send: SendFn): Promise<void> {
    const state = this.sessions.get(meta.sessionId);
    if (!state) {
      // 防御: 正常路径下 startSession 先于 message
      this.logger.warn(`[handleMessage] session=${meta.sessionId} not found`);
      send({ type: 'session_ended', reason: 'error' });
      return;
    }

    switch (msg.type) {
      case 'user_text':
        await this.onUserText(state, msg.text, send);
        return;
      case 'user_speaking':
        this.onUserSpeaking(state, send);
        return;
      case 'session_finish':
        this.endSession(meta.sessionId, 'user_finish', send);
    }
  }

  /**
   * 启动一个 voice session — resolve persona + 创建 visitor memory + 缓存 state.
   * 异步 (resolve persona 走仓储). gateway 在 verifyAndStart 时 await.
   * @throws 当 visitor.openSession 失败 (无 persona) 时 throw, gateway 关闭 socket
   */
  async startSession(meta: VoiceSessionMeta): Promise<void> {
    if (this.sessions.has(meta.sessionId)) {
      this.logger.warn(`[startSession] session=${meta.sessionId} already exists, replacing`);
      const old = this.sessions.get(meta.sessionId)!;
      old.ttsHandle?.cancel();
      old.llmAbort?.abort();
    }
    const personaSnapshot: VoiceSessionPersona = await this.visitor.openSession({
      sessionId: meta.sessionId,
      tenantId: meta.tenantId,
      personaId: meta.personaId,
    });
    const state: VoiceSessionState = {
      meta,
      persona: personaSnapshot,
      status: 'idle',
      currentGeneration: 0,
      ttsHandle: null,
      llmAbort: null,
    };
    this.sessions.set(meta.sessionId, state);
    this.logger.log(
      `[startSession] session=${meta.sessionId} tenant=${meta.tenantId} user=${meta.userId} ` +
        `persona=${personaSnapshot.id} voice=${personaSnapshot.voiceId}`,
    );
  }

  /** 关闭 voice session. gateway 在 handleDisconnect 时调. */
  endSession(sessionId: string, reason: 'user_finish' | 'timeout' | 'error' = 'user_finish', send?: SendFn): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    state.ttsHandle?.cancel();
    state.llmAbort?.abort();
    const visitorClose = this.visitor.closeSession(sessionId);
    this.sessions.delete(sessionId);
    this.logger.log(`[endSession] session=${sessionId} reason=${reason} visitor_turns=${visitorClose.finalTurnCount}`);
    send?.({ type: 'session_ended', reason });
  }

  /** 进程退出时全量清理. */
  async onApplicationShutdown(): Promise<void> {
    for (const [sessionId] of this.sessions) {
      this.endSession(sessionId, 'error');
    }
  }

  // ── private ────────────────────────────────────────────────────

  /**
   * 处理 user_text — 编排 LLM → TTS 流水线.
   * LLM 流通过 VisitorService.streamTurn() 拿 (persona + history 编排), 本 service 只负责:
   *   1. 启动 TTS session (用 persona voiceId, fallback default)
   *   2. 消费 visitor 流, 转发 chunk 到 TTS + client
   *   3. 等 TTS done
   * 如果当前 session 在 processing (上一轮未结束), 触发打断, 启动新一轮.
   *
   * V2026-10-09 治本 (lint complexity 25/20 + sonarjs/cognitive-complexity 28/25):
   *   Phase 4 重写后本函数 cyc/cog complexity 涨到 25/28, 拆出 startTtsSession / consumeLlmStream / waitTtsDone
   *   把 try/catch + for-await + if-else-if 链外移, 主函数降到 ~9 复杂度, 符合 eslint 默认 20 阈值.
   *   顺手修:
   *     - chunk.type if-else-if 改 switch (unicorn/prefer-switch)
   *     - 删 ttsDone dead store (sonarjs/no-dead-store) — 原变量只在第二个循环 set, 循环外永远不读
   */
  private async onUserText(state: VoiceSessionState, text: string, send: SendFn): Promise<void> {
    if (text.trim().length === 0) {
      this.logger.debug(`[user_text] empty, ignore`);
      return;
    }
    // 打断上一轮 (如果还在跑)
    if (state.status === 'processing') {
      this.logger.log(`[user_text] barge-in previous pipeline (gen=${state.currentGeneration})`);
      this.bargeIn(state, send);
    }
    state.currentGeneration += 1;
    const myGeneration = state.currentGeneration;
    state.status = 'processing';

    // 1. 启动 TTS session (用 persona voiceId, fallback default)
    const ttsHandle = await this.startTtsSession(state, send);
    if (!ttsHandle) {
      state.status = 'idle';
      return;
    }
    state.ttsHandle = ttsHandle;
    send({ type: 'tts_start' });

    // 2. 启动 LLM 流 (通过 Visitor — persona + history 编排, signal 透传)
    state.llmAbort = new AbortController();
    const { stream: llmStream } = this.visitor.streamTurn({
      sessionId: state.meta.sessionId,
      tenantId: state.meta.tenantId,
      userId: state.meta.userId,
      personaId: state.meta.personaId ?? state.persona?.id ?? 'default',
      userText: text,
      traceId: state.meta.traceId,
      signal: state.llmAbort.signal,
    });

    // 3. 消费 LLM 流 (try/catch 包 stream-level 异常, 如 network abort)
    let llmDone = false;
    try {
      send({ type: 'llm_start' });
      llmDone = await this.consumeLlmStream(llmStream, myGeneration, state, send, ttsHandle);
    } catch (err) {
      this.logger.error(`[user_text] LLM stream error: ${err instanceof Error ? err.message : String(err)}`);
      send({
        type: 'error',
        error: { code: 'llm_stream_error', message: 'LLM 流错误', retryable: true },
      });
      ttsHandle.cancel();
    }

    // 4. 等 TTS done (LLM 正常 done 才进, 早退 / error 不等, 避免挂死)
    if (llmDone) {
      await this.waitTtsDone(ttsHandle, myGeneration, state, send);
    }

    state.ttsHandle = null;
    state.llmAbort = null;
    state.status = 'idle';
    this.logger.log(`[user_text] done gen=${myGeneration} persona=${state.persona?.id ?? 'unknown'}`);
  }

  /**
   * 启动 TTS session — V2026-10-09 拆出 (修 onUserText complexity 25/20).
   * @returns 成功返 handle, 失败返 null (已发 error 给 client, 调用方负责把 state 标回 idle)
   */
  private async startTtsSession(state: VoiceSessionState, send: SendFn): Promise<TtsSessionHandle | null> {
    const ttsOptions: TtsOptions = {
      tenantId: state.meta.tenantId,
      userId: state.meta.userId,
      sessionId: state.meta.sessionId,
      voice: state.persona?.voiceId ?? this.defaultVoice,
      model: this.defaultModel,
    };
    try {
      return await this.tts.startSession(ttsOptions);
    } catch (err) {
      this.logger.error(`[user_text] TTS startSession failed: ${err instanceof Error ? err.message : String(err)}`);
      send({
        type: 'error',
        error: { code: 'tts_start_failed', message: 'TTS 启动失败', retryable: true },
      });
      return null;
    }
  }

  /**
   * 消费 LLM 流 — V2026-10-09 拆出 (修 onUserText complexity + unicorn/prefer-switch).
   *   chunk.type 三态:
   *     - content: 转发 client + 推 TTS
   *     - error:   log + 发 error + cancel TTS + return (LLM 失败不再等 done)
   *     - done:    标 llmDone + 发 llm_done + 通知 TTS 收尾 (finish)
   *   generation mismatch (新 user_text 打断) → return.
   * @returns true = LLM 流正常 done, false = 早退 (error / mismatch)
   */
  private async consumeLlmStream(
    llmStream: LlmStream,
    myGeneration: number,
    state: VoiceSessionState,
    send: SendFn,
    ttsHandle: TtsSessionHandle,
  ): Promise<boolean> {
    let llmDone = false;
    for await (const chunk of llmStream) {
      if (state.currentGeneration !== myGeneration) {
        // 已被新 user_text 打断
        this.logger.log(`[user_text] gen mismatch, abort gen=${myGeneration}`);
        return llmDone;
      }
      switch (chunk.type) {
        case 'content':
          send({ type: 'llm_text', text: chunk.content });
          ttsHandle.sendText(chunk.content);
          break;
        case 'error':
          this.logger.warn(`[user_text] LLM error: ${chunk.error.code}`);
          send({ type: 'error', error: { code: chunk.error.code, message: chunk.error.message, retryable: chunk.error.retryable } });
          ttsHandle.cancel();
          return llmDone;
        case 'done':
          llmDone = true;
          send({ type: 'llm_done' });
          ttsHandle.finish();
          break;
      }
    }
    return llmDone;
  }

  /**
   * 等 TTS done — V2026-10-09 拆出 (删 ttsDone dead store, 修 sonarjs/no-dead-store).
   *   原 ttsDone 变量只在第二个循环里 set, 循环外 (if guard `!ttsDone` 之后) 永远不再读, dead store.
   *   修法: 不再用 ttsDone 标记, 直接在 done event 里 return 出去.
   *   触发条件: llmDone === true (LLM 正常 done, TTS 可能还有剩余 audio 没流完).
   */
  private async waitTtsDone(ttsHandle: TtsSessionHandle, myGeneration: number, state: VoiceSessionState, send: SendFn): Promise<void> {
    for await (const event of ttsHandle.events) {
      if (state.currentGeneration !== myGeneration) return;
      switch (event.type) {
        case 'done':
          send({ type: 'tts_done', usage: { characters: event.usage.characters } });
          return;
        case 'error':
          send({ type: 'error', error: event.error });
          return;
      }
    }
  }

  /** 打断 — 取消 LLM + TTS, 通知 client. */
  private onUserSpeaking(state: VoiceSessionState, send: SendFn): void {
    if (state.status !== 'processing') {
      this.logger.debug(`[user_speaking] no active pipeline, ignore`);
      return;
    }
    this.bargeIn(state, send);
  }

  private bargeIn(state: VoiceSessionState, send: SendFn): void {
    state.currentGeneration += 1;
    // V2026-10-09 治本: signal 真正中断 fetch (不再仅靠 generation 检查兜底)
    state.llmAbort?.abort();
    state.llmAbort = null;
    state.ttsHandle?.cancel();
    state.ttsHandle = null;
    state.status = 'cancelled';
    send({ type: 'tts_cancelled' });
    this.logger.log(`[bargeIn] session=${state.meta.sessionId} new gen=${state.currentGeneration}`);
  }
}
