import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 安抚卡片 entity — 陪伴者发给成长用户的低压力安抚卡 (V2.0 §Tab2 陪伴者端).
 *
 * 设计:
 *   - 6 个 templateKey: gentle / breathing / grounding / warmth / listening / space
 *   - direction: 'sent' (陪伴者发出) / 'received' (成长用户发回)
 *   - accentColorToken 走 String (前端 enum → palette), 不存 Color 实体 (跨平台一致)
 *
 * 大厂做法:
 *   - INDEX (from_uid, to_uid, sent_at DESC) — 查某两人的安抚历史
 *   - 软删由 users.deleted_at cascade 触发 (无需 deleted_at 字段)
 */
@Entity('companion_soothing_cards')
@Index('idx_soothing_cards_from_to_sent', ['fromUid', 'toUid', 'sentAt'])
export class SoothingCard {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'char', length: 36, name: 'from_uid' })
  fromUid!: string;

  @Column({ type: 'char', length: 36, name: 'to_uid' })
  toUid!: string;

  @Column({ type: 'varchar', length: 32, name: 'template_key' })
  templateKey!: string;

  @Column({ type: 'varchar', length: 80, name: 'title' })
  title!: string;

  @Column({ type: 'text', name: 'body' })
  body!: string;

  @Column({ type: 'varchar', length: 32, name: 'accent_color_token', default: 'primary' })
  accentColorToken!: string;

  @Column({ type: 'varchar', length: 16, name: 'direction', default: 'sent' })
  direction!: 'sent' | 'received';

  @CreateDateColumn({ name: 'sent_at' })
  sentAt!: Date;

  @Column({ type: 'datetime', name: 'read_at', nullable: true })
  readAt!: Date | null;
}
