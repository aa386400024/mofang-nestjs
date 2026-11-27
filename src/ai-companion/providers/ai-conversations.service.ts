import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

import { BizCode } from '../../common/exceptions/biz-code.enum.js';
import { BizException } from '../../common/exceptions/biz.exception.js';

import { AiConversationDto, AiConversationsResponseDto } from '../dto/ai-conversations.dto.js';
import { ChatSession } from '../entities/chat-session.entity.js';

/**
 * AI 对话历史服务 — V2.0 §Tab4 「我的数据」AI 对话记录.
 *
 * 范围限定: 仅做 history 浏览 (列出 + 单条详情 + 删除).
 *   - 实时对话 / 消息原文 / 流式响应 都不在本服务 (V2.0 不在「我的」Tab 范围)
 *   - 业务约束: 只允许查询 / 删除自己 uid 下的会话, 严禁跨用户
 *
 * 数据来源:
 *   - 只读 `ai_chat_sessions` 真实行; 无数据返回空列表.
 *   - 不再提供硬编码 sample —— 伪造的心理对话历史会误导用户, 也掩盖写入链路缺失.
 */
@Injectable()
export class AiConversationsService {
  private readonly logger = new Logger(AiConversationsService.name);

  /** 历史列表单次最多返回的会话数. */
  private static readonly HISTORY_LIMIT = 100;

  constructor(
    @InjectRepository(ChatSession)
    private readonly repo: Repository<ChatSession>,
  ) {}

  /**
   * 列出当前用户会话 — 按 createdAt 倒序, 最多 100 条.
   *
   * @param uid 当前用户 uid
   */
  async listConversations(uid: string): Promise<AiConversationsResponseDto> {
    const rows = await this.repo.find({
      where: { uid },
      order: { createdAt: 'DESC' },
      take: AiConversationsService.HISTORY_LIMIT,
    });
    return { items: rows.map((row) => this.toDto(row)) };
  }

  /**
   * 取单条会话详情 — 前端 ChatPage 跳回时拿原始 metadata.
   *
   * 只存摘要与元数据, 不含消息原文; 后续可增补内容索引让 ChatPage 定位上下文.
   */
  async getConversation(uid: string, id: string): Promise<AiConversationDto> {
    const row = await this.repo.findOne({ where: { id, uid } });
    if (!row) {
      throw new BizException(BizCode.ChatSessionNotFound, `对话 ${id} 不存在或不属于你`);
    }
    return this.toDto(row);
  }

  /**
   * 删除会话 — 二次确认由前端负责 (alertDialog), 后端做最终校验.
   *
   * 业务约束:
   *   - 仅本人 uid 可删
   *   - archived = true 的不允许删 (V2.0 §5.4 审计要求)
   *   - 真实删除 (V2 不做软删, 因为摘要本身不含隐私; V3 视情况加 deleted_at)
   */
  async deleteConversation(uid: string, id: string): Promise<{ deleted: true; id: string }> {
    const row = await this.repo.findOne({ where: { id, uid } });
    if (!row) {
      throw new BizException(BizCode.ChatSessionNotFound, `对话 ${id} 不存在或不属于你`);
    }
    if (row.archived) {
      throw new BizException(BizCode.ChatSessionArchived, '已归档的会话不允许删除');
    }
    await this.repo.delete({ id, uid });
    this.logger.log(`uid=${uid} deleted chat session ${id}`);
    return { deleted: true, id };
  }

  // ────────────────────────────────────────────────────────
  // Entity → DTO 映射
  // ────────────────────────────────────────────────────────
  private toDto(row: ChatSession): AiConversationDto {
    return {
      id: row.id,
      timestamp: row.createdAt.toISOString(),
      emoji: row.emotionEmoji ?? '💬',
      title: row.summaryTitle ?? '对话记录',
      summary: row.summaryText ?? '',
      rounds: row.roundCount,
      mode: row.mode,
    };
  }
}
