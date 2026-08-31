import { Column, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * 心塑首页消息 — 顶部「消息入口」小红点.
 *
 * 跟「AI 对话记录 / 我的 Tab AI 对话记录」是不同维度:
 *   - home_message: 系统消息 (欢迎 / 活动 / 微干预提醒 / 陪伴者消息摘要), 短, 不存正文
 *   - chat_session: 完整 AI 对话存档, 走 ai-companion 模块
 *
 * 设计要点:
 *   - content 长度限制 280 字 (跟情绪备注对齐)
 *   - read_at 标记已读; 前端调 mark-read 把同一 uid 的所有 unread 一次性 mark
 *   - 软删用 read_at (按已读隐藏); 真删由 users.deleted_at cascade
 *
 * 大厂做法:
 *   - INDEX (uid, read_at) — 未读数查询
 *   - 不存 raw content, 走 type 决定渲染 — 减少攻击面 + 国际化友好
 */
@Entity('home_messages')
@Index('idx_home_messages_uid_read', ['uid', 'readAt'])
export class HomeMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'char', length: 36, name: 'uid' })
  uid!: string;

  /** 消息类型 (system / companion / companion_request / micro_intervention_nudge). */
  @Column({ type: 'varchar', length: 32, name: 'type' })
  type!: 'system' | 'companion' | 'companion_request' | 'micro_intervention_nudge';

  @Column({ type: 'varchar', length: 64, name: 'title', nullable: true })
  title!: string | null;

  @Column({ type: 'varchar', length: 280, name: 'preview', nullable: true })
  preview!: string | null;

  /** 关联业务 id (companion_binding_id / intervention_id 等), 用于点击跳转. */
  @Column({ type: 'varchar', length: 64, name: 'ref_id', nullable: true })
  refId!: string | null;

  @Column({ type: 'datetime', name: 'read_at', nullable: true })
  readAt!: Date | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
