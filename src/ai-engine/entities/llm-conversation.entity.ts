// V2026-09-04 治本 (V6.0 §3.5 + §11.2 + audit P0-1):
//   LLM 对话 session 表 — token 累计 + crisis 关联 + 审计.
//   原因: LLM 流式对话需要会话级 token 累计 (跨多个 chunk), crisis 事件
//         关联 conversation_id 反查上下文 (§11.3 审计), prompt +
//         completion tokens 拆存便于后续 §9 商业化计费.
//   修复: id 用 uuid (对外 conversation_id); uid FK CASCADE; tier enum
//         跟 LLMTier 对齐; crisis_event_id nullable FK 关联 crisis_events
//         (§11.2 二级及以上危机必须留痕); started_at / ended_at 分离
//         (会话可能跨多个 chunk 持续).
//   如何验证:
//     1. 流式开始 → INSERT llm_conversations (started_at = NOW()).
//     2. 每个 chunk 累计 token → UPDATE llm_conversations SET prompt_tokens=...
//        WHERE id = ? (高频写, 可走 cache + 定期 flush).
//     3. 流结束 → UPDATE ended_at = NOW().
//     4. 检测到危机 → INSERT crisis_events (conversation_id = ?) + 同步
//        UPDATE llm_conversations SET crisis_event_id = ?.

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { LLMTier } from '../../llm/common/enums/llm.enums';

/**
 * LLM 对话会话 — V6.0 §3.5 + §11.2.
 *
 * 与 ai-companion/entities/chat-session.entity.ts 的区别:
 *   - ChatSession 是历史浏览列表 (§3.4 dashboard 用), 摘要已生成.
 *   - LLMConversation 是实时流式会话 (按 conversation_id 维度), 用于
 *     token 累计 + crisis 关联 + 后续计费 (§9 商业化).
 *   - 两个 entity 未来可合并: ChatSession.summary 字段由 cron 从
 *     LLMConversation 异步生成 (V2 阶段先并存).
 */
@Entity('llm_conversations')
@Index('idx_llm_conv_uid_started', ['uid', 'startedAt'])
@Index('idx_llm_conv_tier', ['tier'])
export class LLMConversationEntity {
  /** 对外 conversation_id (UUID v4). */
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'char', length: 36, name: 'uid' })
  uid!: string;

  /** §3.5 三层架构. */
  @Column({ type: 'enum', enum: LLMTier, name: 'tier', default: LLMTier.RAG })
  tier!: LLMTier;

  /** 调用的具体 provider — 审计用 (deepseek / doubao / qwen / ...). */
  @Column({ type: 'varchar', length: 32, name: 'provider_id', nullable: true })
  providerId!: string | null;

  /** 具体模型 — gpt-4o / deepseek-chat / doubao-pro-32k / qwen-plus. */
  @Column({ type: 'varchar', length: 64, name: 'model', nullable: true })
  model!: string | null;

  /** AI 自动生成的会话标题 (V2 占位, V3 由 summary cron 写入). */
  @Column({ type: 'varchar', length: 80, name: 'title', nullable: true })
  title!: string | null;

  @Column({ type: 'int', name: 'prompt_tokens', default: 0 })
  promptTokens!: number;

  @Column({ type: 'int', name: 'completion_tokens', default: 0 })
  completionTokens!: number;

  /** 关联 crisis_event (§11.2 二级及以上危机留痕). nullable FK. */
  @Column({ type: 'char', length: 36, name: 'crisis_event_id', nullable: true })
  crisisEventId!: string | null;

  @CreateDateColumn({ type: 'datetime', precision: 6, name: 'started_at' })
  startedAt!: Date;

  /** 流结束时间 — null 表示会话进行中. */
  @Column({ type: 'datetime', precision: 6, name: 'ended_at', nullable: true })
  endedAt!: Date | null;
}
