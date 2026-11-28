// V2026-09-04 治本 (V6.0 §3.5 + §11.2 + audit P0-1):
//   LLM Orchestrator — 流式 chat 入口 + crisis 联动 + token 累计 + LlmConversation 写库.
//   关键反双胞胎:
//     - 不写 LLM 调用细节 — 走 LlmRouterService (已抽象 OpenAI 兼容协议).
//     - 不写 token 估算 — ChatCompletionChunk.tokenCount 已是累计值.
//     - 不写 crisis 关键词匹配 — 走 CrisisDetectorService (统一逻辑).
//     - 不写 SSE 帧编码 — 走 NestJS @Sse() decorator (controller 层).

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { Repository } from 'typeorm';

import { CrisisDetectorService } from './crisis-detector.service.js';
import { ChatSessionRecorder } from '../../ai-companion/providers/chat-session-recorder.js';
import { BizCode } from '../../common/exceptions/biz-code.enum.js';
import { BizException } from '../../common/exceptions/biz.exception.js';
import { ConsentService } from '../../consent/providers/consent.service.js';
import type { ChatCompletionChunk } from '../../llm/common/interfaces/chat-provider.interface.js';
import { LlmRouterService } from '../../llm/registry/llm-router.service.js';
import type { ChatCompletionChunkDto, ChatCompletionDto } from '../dto/llm-chat.dto.js';
import { CrisisEventEntity } from '../entities/crisis-event.entity.js';
import { LLMConversationEntity } from '../entities/llm-conversation.entity.js';
import { CrisisLevel } from '../enums/ai-crisis.enums.js';

/**
 * 本轮 usage 累计 (AF-594).
 *
 * provider chunk 的 prompt/completion 都是**累计值**, 这里只保存最后一次非空值,
 * 流结束后一次性原子累加进 DB.
 */
interface TurnUsage {
  promptTokens: number;
  completionTokens: number;
}

/**
 * LLM 编排器 — V6.0 §3.5.
 *
 * 职责:
 *   1. 接收 ChatCompletionDto, 转换为 LLM Router 调用.
 *   2. 服务端二级 crisis 检测 (§11.2 + 防 client bypass).
 *   3. 流式 yield chunk DTO, 含 token 累计 + crisisSignal.
 *   4. 写 LlmConversation (流开始) + 更新 token (流结束).
 *   5. 命中 crisis 时, 写 CrisisEventEntity (fire-and-forget).
 */
@Injectable()
export class LlmOrchestratorService {
  private readonly logger = new Logger(LlmOrchestratorService.name);

  constructor(
    private readonly router: LlmRouterService,
    private readonly crisisDetector: CrisisDetectorService,
    @InjectRepository(LLMConversationEntity)
    private readonly conversationRepo: Repository<LLMConversationEntity>,
    @InjectRepository(CrisisEventEntity)
    private readonly crisisRepo: Repository<CrisisEventEntity>,
    private readonly consent: ConsentService,
    private readonly config: ConfigService,
    private readonly chatSessionRecorder: ChatSessionRecorder,
  ) {}

  /**
   * 流式 chat — 主入口. controller 通过 @Sse() 包装.
   *
   * V2026-09-04 治本: 返回 AsyncIterable<ChatCompletionChunkDto>,
   * 不返回 Node Readable (那是 OpenAI SDK 类型).
   */
  async *streamChat(uid: string, dto: ChatCompletionDto): AsyncIterable<ChatCompletionChunkDto> {
    // AF-537 P0-10: AI 对话前必须已同意当前版本隐私协议（服务端强制，不依赖客户端）。
    if (this.config.get<{ enforceAiChat?: boolean }>('consent')?.enforceAiChat !== false) {
      await this.consent.assertAccepted(uid, 'agreement+privacy');
    }

    // 1. 服务端二级 crisis 检测 (最后一条 user message).
    const lastUserMsg = [...dto.messages].reverse().find((m) => m.role === 'user');
    const crisisResult = lastUserMsg ? this.crisisDetector.detect(lastUserMsg.content) : null;

    // 2. high 等级 — 强制插入安全 system prompt + 中断 LLM 调用, 直接 yield 危机响应.
    //   §11.2 三级响应: high → 立刻跳出 + 推荐热线, 不发给 LLM.
    if (crisisResult && crisisResult.level === CrisisLevel.HIGH) {
      yield* this.handleHighCrisis(uid, dto, crisisResult);
      return;
    }

    // 3. 创建 / 归属校验 conversation (用于 token 累计 + crisis 关联).
    //    AF-594: 只有新会话才 INSERT; 续聊已做过归属校验, 不再重复 save 整行.
    const conversationId = await this.openConversation(uid, dto);

    // 4. medium / low crisis — 透传给 LLM, 让其知道上下文, 但 yield chunk 时携带信号.
    let crisisEventId: string | null = null;
    if (crisisResult && (crisisResult.level === CrisisLevel.MEDIUM || crisisResult.level === CrisisLevel.LOW)) {
      crisisEventId = await this.recordCrisisEvent(uid, conversationId, crisisResult);
    }

    // 5. 调 LLM 流.
    try {
      const stream = this.router.streamChat(
        {
          tier: dto.tier,
          // router 自己解析默认 model, 这里传空走 fallback
          model: '',
          messages: dto.messages.map((m) => ({
            role: m.role,
            content: m.content,
            toolCallId: m.toolCallId,
            name: m.name,
          })),
          temperature: dto.temperature,
          maxTokens: dto.maxTokens,
          conversationId,
          preCheckedCrisisLevel: dto.preCheckedCrisisLevel,
        },
        { uid },
      );

      const usage: TurnUsage = { promptTokens: 0, completionTokens: 0 };

      for await (const chunk of stream) {
        // router chunk → DTO chunk.
        yield {
          delta: chunk.delta,
          tokenCount: chunk.tokenCount,
          isFinal: chunk.isFinal,
          finishReason: chunk.finishReason ?? null,
          conversationId,
          crisisSignal:
            crisisResult && crisisResult.level !== CrisisLevel.NONE
              ? {
                  level: crisisResult.level,
                  keywords: crisisResult.keywords,
                  suggestedResource: crisisResult.suggestedResource ?? undefined,
                }
              : null,
        };

        // 终结 chunk: 记录 token (输入侧 usage 回填 / 输出侧优先 provider 累计值).
        this.captureUsage(chunk, usage);
      }

      // 6. 更新 conversation (token 原子累加 + crisisEvent + endedAt).
      await this.persistConversationUsage(uid, conversationId, crisisEventId, usage);
      await this.persistChatSession(uid, conversationId, dto.messages);
    } catch (e) {
      this.logger.error(`streamChat failed uid=${uid} conversationId=${conversationId}: ${(e as Error).message}`);
      throw e;
    }
  }

  /**
   * High 等级 crisis — 不发 LLM, 直接 yield 危机响应 + 写 CrisisEvent.
   *
   * 大厂 standard: §11.2 三级响应 high = 立刻中断 LLM, 推送公益热线,
   * 用户端展示急救弹层 (§4.2 急救闭环联动).
   */
  private async *handleHighCrisis(
    uid: string,
    dto: ChatCompletionDto,
    crisisResult: ReturnType<CrisisDetectorService['detect']>,
  ): AsyncIterable<ChatCompletionChunkDto> {
    const conversationId = await this.resolveConversationId(uid, dto.conversationId);
    await this.conversationRepo.save(
      this.conversationRepo.create({
        id: conversationId,
        uid,
        tier: dto.tier,
        promptTokens: 0,
        completionTokens: 0,
      }),
    );

    const crisisEventId = await this.recordCrisisEvent(uid, conversationId, crisisResult);

    const safeMessage =
      '我注意到你现在可能很难受. 请立刻联系专业帮助:\n\n' +
      `📞 ${crisisResult.suggestedResource}\n\n` +
      '如果身边有信任的人, 也请告诉他们. 你不需要独自面对.';

    // 分块 yield, 保持流式体验 (UI 打字效果).
    const chars = safeMessage.split('');
    for (let i = 0; i < chars.length; i++) {
      yield {
        delta: chars[i],
        tokenCount: i + 1,
        isFinal: false,
        finishReason: null,
        conversationId,
        crisisSignal: {
          level: crisisResult.level,
          keywords: crisisResult.keywords,
          suggestedResource: crisisResult.suggestedResource ?? undefined,
        },
      };
    }

    // 最终 chunk.
    yield {
      delta: '',
      tokenCount: chars.length,
      isFinal: true,
      finishReason: 'content_filter',
      conversationId,
      crisisSignal: {
        level: crisisResult.level,
        keywords: crisisResult.keywords,
        suggestedResource: crisisResult.suggestedResource ?? undefined,
      },
    };

    await this.conversationRepo.update(
      { id: conversationId, uid },
      {
        crisisEventId,
        endedAt: new Date(),
      },
    );
    await this.persistChatSession(uid, conversationId, dto.messages);
  }

  /**
   * 落 AI 对话历史元数据 — 失败只 warn，不改变对话成功语义.
   *
   * 只传 uid / conversationId / messages 给 recorder；标题截断与轮数计算都在
   * ai-companion 域内完成，orchestrator 不碰心理内容.
   */
  private async persistChatSession(
    uid: string,
    conversationId: string,
    messages: readonly { role: string; content: string }[],
  ): Promise<void> {
    try {
      await this.chatSessionRecorder.record({ uid, conversationId, messages });
    } catch (e) {
      this.logger.warn(`persist chat session failed uid=${uid} conversationId=${conversationId} err=${(e as Error).name}`);
    }
  }

  /**
   * AF-594: 新会话 INSERT 一次; 续聊只做归属校验, 不再整行 save.
   */
  private async openConversation(uid: string, dto: ChatCompletionDto): Promise<string> {
    if (dto.conversationId) {
      return this.resolveConversationId(uid, dto.conversationId);
    }

    const conversationId = randomUUID();
    await this.conversationRepo.save(
      this.conversationRepo.create({
        id: conversationId,
        uid,
        tier: dto.tier,
        providerId: null,
        model: null,
        title: null,
        promptTokens: 0,
        completionTokens: 0,
        crisisEventId: null,
      }),
    );
    return conversationId;
  }

  /** AF-594: 从上游 chunk 回填本轮 usage (只保留累计终值). */
  private captureUsage(chunk: ChatCompletionChunk, usage: TurnUsage): void {
    if (chunk.promptTokens !== undefined) usage.promptTokens = chunk.promptTokens;
    if (chunk.completionTokens !== undefined) usage.completionTokens = chunk.completionTokens;
    if (!chunk.isFinal) return;
    if (chunk.completionTokens === undefined) usage.completionTokens = chunk.tokenCount;
  }

  /**
   * AF-594: 一条 UPDATE 完成 token 原子累加 + crisisEvent + endedAt.
   *
   * 旧写法每轮覆盖 prompt/completion, 会把历史 token 冲掉; 原始表达式让 DB 做
   * `col = col + delta`, 并发轮次不会互相覆盖.
   */
  private async persistConversationUsage(
    uid: string,
    conversationId: string,
    crisisEventId: string | null,
    usage: TurnUsage,
  ): Promise<void> {
    const promptDelta = Math.max(0, Math.trunc(usage.promptTokens));
    const completionDelta = Math.max(0, Math.trunc(usage.completionTokens));

    await this.conversationRepo.update(
      { id: conversationId, uid },
      {
        promptTokens: () => `prompt_tokens + ${promptDelta}`,
        completionTokens: () => `completion_tokens + ${completionDelta}`,
        crisisEventId,
        endedAt: new Date(),
      },
    );
  }

  /**
   * 解析会话 id：客户端传入时必须属于当前 uid，否则拒绝（AF-537 P0-11）。
   *
   * 旧实现直接信任客户端 `conversationId` 并 `save`，任何人都能把对话写进别人的会话。
   */
  private async resolveConversationId(uid: string, provided?: string): Promise<string> {
    if (!provided) {
      return randomUUID();
    }
    const existing = await this.conversationRepo.findOne({ where: { id: provided } });
    if (!existing || existing.uid !== uid) {
      throw new BizException(BizCode.LlmConversationNotFound, '对话不存在或不属于你');
    }
    return provided;
  }

  /**
   * 写 CrisisEvent — fire-and-forget, 不阻塞流.
   */
  private async recordCrisisEvent(
    uid: string,
    conversationId: string,
    result: ReturnType<CrisisDetectorService['detect']>,
  ): Promise<string> {
    const event = await this.crisisRepo.save(
      this.crisisRepo.create({
        uid,
        level: result.level,
        source: result.source,
        keywords: result.keywords,
        context: result.contextSnippet,
        suggestedResource: result.suggestedResource,
        conversationId,
      }),
    );
    this.logger.warn(`Crisis event recorded uid=${uid} level=${result.level} conversationId=${conversationId}`);
    return event.id;
  }

  /**
   * 单轮 chat — 走 router, 不走流 (admin 后台测试 / 批量评估).
   */
  async chatOnce(uid: string, dto: ChatCompletionDto): Promise<ChatCompletionChunkDto> {
    let lastChunk: ChatCompletionChunkDto | null = null;
    for await (const chunk of this.streamChat(uid, dto)) {
      lastChunk = chunk;
    }
    if (!lastChunk) {
      throw new Error('LLM returned no chunks');
    }
    return lastChunk;
  }

  /**
   * 会话历史列表.
   */
  async listConversations(uid: string, limit = 50): Promise<LLMConversationEntity[]> {
    return this.conversationRepo.find({
      where: { uid },
      order: { startedAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * 取单条会话.
   */
  async getConversation(uid: string, id: string): Promise<LLMConversationEntity> {
    const row = await this.conversationRepo.findOne({ where: { id, uid } });
    if (!row) {
      throw new BizException(BizCode.LlmConversationNotFound, '对话不存在或不属于你');
    }
    return row;
  }
}
