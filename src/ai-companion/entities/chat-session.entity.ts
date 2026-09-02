import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import type { AiCompanionMode } from '../../shared/types/practice.types';
import { User } from '../../user/entities/user.entity';

/**
 * AI 陪伴会话 entity — V2.0 §Tab4 「我的数据」AI 对话记录.
 *
 * 范围限定: 仅作为对话历史浏览页面的数据源. 实时对话由前端 ChatPage
 * 跟其他渠道 (mmx-vision 等) 交互, 本 entity 只存摘要 + 元数据.
 *
 * 设计要点:
 *   - mode 切换: normal / inner_voice_coach (V2.0 §5.5 新增)
 *   - summary_* 由 AI 异步生成, 存第一次总结结果
 *   - emotion_emoji 由开题识别 (前端展示用, 服务端不分析原始消息)
 *   - V2.0 §5.4 端侧加密: 消息原文不存服务, 仅存元数据
 *   - archived = true 时 UI 显示但禁止修改/删除
 */
@Entity('ai_chat_sessions')
@Index('idx_chat_sessions_uid_created', ['uid', 'createdAt'])
@Index('idx_chat_sessions_uid_archived', ['uid', 'archived'])
export class ChatSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'char', length: 36, name: 'uid' })
  uid!: string;

  @Column({ type: 'varchar', length: 32, name: 'mode', default: 'normal' })
  mode!: AiCompanionMode;

  /** AI 自动生成的对话摘要标题 (1 句话, 客户端展示用, ≤ 80 字). */
  @Column({ type: 'varchar', length: 80, name: 'summary_title', nullable: true })
  summaryTitle!: string | null;

  /** AI 自动生成的对话摘要详情 (≤ 200 字). */
  @Column({ type: 'varchar', length: 200, name: 'summary_text', nullable: true })
  summaryText!: string | null;

  /** 开题情绪 emoji (前端展示用). */
  @Column({ type: 'varchar', length: 16, name: 'emotion_emoji', nullable: true })
  emotionEmoji!: string | null;

  @Column({ type: 'int', name: 'round_count', default: 0 })
  roundCount!: number;

  @Column({ type: 'boolean', name: 'archived', default: false })
  archived!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'uid', referencedColumnName: 'uid' })
  user?: User;
}
