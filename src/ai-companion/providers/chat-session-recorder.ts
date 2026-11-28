import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

import { ChatSession } from '../entities/chat-session.entity.js';

/** 会话记录输入 — 只接收判断标题 / 轮数所需的最小字段. */
export interface RecordChatSessionInput {
  uid: string;
  conversationId: string;
  messages: readonly { role: string; content: string }[];
}

/**
 * AI 对话历史写入器 — 把一次实时流式对话落成 `ai_chat_sessions` 元数据行.
 *
 * 边界（V2.0 §5.4 端侧加密）:
 *   - 只写首条 user 消息截断出的标题，不写消息原文、不写 assistant 回复
 *   - summaryText / emotionEmoji 保持 null，给后续摘要 cron 留位
 *   - roundCount 取本次提交里的 user 消息数；续聊时保留历史最大值
 *
 * 为什么独立 provider: `LlmOrchestratorService` 只负责流式编排，历史写入属于
 * ai-companion 域；独立后写入失败可被主链路吞掉并观测，不污染 chat 语义.
 */
@Injectable()
export class ChatSessionRecorder {
  private readonly logger = new Logger(ChatSessionRecorder.name);

  /** 标题最大长度，与 `ai_chat_sessions.summary_title` 列宽一致. */
  private static readonly TITLE_MAX_LENGTH = 80;

  constructor(
    @InjectRepository(ChatSession)
    private readonly repo: Repository<ChatSession>,
  ) {}

  /**
   * 记录会话元数据（幂等 upsert）.
   *
   * 写入失败只 warn 并返回 false，不向调用方抛异常 —— 历史记录不是对话主链路
   * 的强依赖，不能因为一次 DB 抖动让已完成的对话变成失败.
   */
  async record(input: RecordChatSessionInput): Promise<boolean> {
    try {
      return await this.recordInternal(input);
    } catch (e) {
      this.logger.warn(`record chat session failed uid=${input.uid} conversationId=${input.conversationId} err=${(e as Error).name}`);
      return false;
    }
  }

  private async recordInternal(input: RecordChatSessionInput): Promise<boolean> {
    const userMessages = input.messages.filter((m) => m.role === 'user' && m.content.trim().length > 0);
    if (userMessages.length === 0) {
      return false;
    }

    const title = ChatSessionRecorder.toTitle(userMessages[0].content);
    const rounds = userMessages.length;
    const existing = await this.repo.findOne({ where: { id: input.conversationId, uid: input.uid } });

    if (existing) {
      existing.summaryTitle = existing.summaryTitle ?? title;
      existing.roundCount = Math.max(existing.roundCount, rounds);
      await this.repo.save(existing);
      return true;
    }

    await this.repo.save(
      this.repo.create({
        id: input.conversationId,
        uid: input.uid,
        mode: 'normal',
        summaryTitle: title,
        summaryText: null,
        emotionEmoji: null,
        roundCount: rounds,
        archived: false,
      }),
    );
    return true;
  }

  private static toTitle(content: string): string {
    const normalized = content.replaceAll(/\s+/g, ' ').trim();
    return normalized.slice(0, ChatSessionRecorder.TITLE_MAX_LENGTH);
  }
}
