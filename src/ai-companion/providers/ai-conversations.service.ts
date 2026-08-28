import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BizCode } from '../../common/exceptions/biz-code.enum';
import { BizException } from '../../common/exceptions/biz.exception';

import { AiConversationDto, AiConversationsResponseDto } from '../dto/ai-conversations.dto';
import { ChatSession } from '../entities/chat-session.entity';

/**
 * AI 对话历史服务 — V2.0 §Tab4 「我的数据」AI 对话记录.
 *
 * 范围限定: 仅做 history 浏览 (列出 + 单条详情 + 删除).
 *   - 实时对话 / 消息原文 / 流式响应 都不在本服务 (V2.0 不在「我的」Tab 范围)
 *   - 业务约束: 只允许查询 / 删除自己 uid 下的会话, 严禁跨用户
 *
 * V2.0 占位:
 *   - DB 当前为空, 真实历史会话由 ChatPage 上线后异步写入
 *   - V2.0 demo 阶段, 提供 4-6 条硬编码 sample, 跟前端 sample 对齐
 *   - V3 接 ChatSessionService.createSession + AI 后, 自动转储摘要
 */
@Injectable()
export class AiConversationsService {
  private readonly logger = new Logger(AiConversationsService.name);

  constructor(
    @InjectRepository(ChatSession)
    private readonly repo: Repository<ChatSession>,
  ) {}

  /**
   * 列出会话 — 按 createdAt 倒序.
   *
   * V2.0 占位: DB 为空时返回 sample 数据 (4 段分组演示).
   * V3 接真实数据后: 直接查 repo.find({ where: { uid }, order: { createdAt: 'DESC' } }).
   */
  async listConversations(_uid: string): Promise<AiConversationsResponseDto> {
    // V3 真实查询: const rows = await this.repo.find({ where: { uid }, order: { createdAt: 'DESC' }, take: 100 });
    // V2 占位: 返回 6 条 sample 让前端能演示
    return { items: sampleConversations() };
  }

  /**
   * 取单条会话详情 — 前端 ChatPage 跳回时拿原始 metadata.
   *
   * V2.0 占位: 不存消息原文, 返回 summary 已够 ChatPage 用.
   * V3: 增补内容索引 (e.g. 第一句 / 关键引用), 让 ChatPage 跳回能定位上下文.
   */
  async getConversation(uid: string, id: string): Promise<AiConversationDto> {
    const row = await this.repo.findOne({ where: { id, uid } });
    if (!row) {
      // V2 占位: sample 模式不校验, 真实上线后取消
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

/**
 * V2.0 sample 数据 — 4 段日期分组演示用, 跟前端 ProfileAiConversationsPage 对齐.
 *
 * 时区: 服务端 sample 用 UTC, 前端按本地时区分组 (DateTime.now() 偏移).
 */
function sampleConversations(): AiConversationDto[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const iso = (d: Date, h: number, m: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).toISOString();
  return [
    {
      id: 'sample-c1',
      timestamp: iso(today, 21, 12),
      emoji: '🌧️',
      title: '开会前突然很焦虑',
      summary: '聊了"被当众提问"的恐惧, AI 帮我识别出「灾难化」思维, 给了 3 个呼吸锚点',
      rounds: 8,
      mode: 'normal',
    },
    {
      id: 'sample-c2',
      timestamp: iso(today, 9, 3),
      emoji: '🌤️',
      title: '昨晚终于睡着了',
      summary: '聊了失眠背后对"明天能不能做好"的担心, AI 引导做了认知解离小练习',
      rounds: 12,
      mode: 'normal',
    },
    {
      id: 'sample-c3',
      timestamp: iso(new Date(today.getTime() - 86_400_000), 20, 45),
      emoji: '🌙',
      title: '跟父母吵架后很难受',
      summary: 'AI 用 ACT 接纳框架陪我把"我不够好"的想法当作背景音, 不再盯着它',
      rounds: 16,
      mode: 'normal',
    },
    {
      id: 'sample-c4',
      timestamp: iso(new Date(today.getTime() - 86_400_000), 12, 30),
      emoji: '🌿',
      title: '只是想随便聊聊',
      summary: '聊了最近在追的剧, AI 陪我梳理了"放松式专注"的体验',
      rounds: 5,
      mode: 'normal',
    },
    {
      id: 'sample-c5',
      timestamp: iso(new Date(today.getTime() - 86_400_000 * 3), 16, 0),
      emoji: '🌈',
      title: '今天的状态意外地好',
      summary: 'AI 引导我回看是什么让今天跟平时不一样, 找出 3 个可复用的元素',
      rounds: 9,
      mode: 'inner_voice_coach',
    },
    {
      id: 'sample-c6',
      timestamp: iso(new Date(today.getTime() - 86_400_000 * 5), 10, 22),
      emoji: '🔥',
      title: '工作汇报后又陷入自我否定',
      summary: '识别出"全或无"思维模式, 一起做了思维五栏表的练习',
      rounds: 14,
      mode: 'normal',
    },
  ];
}
