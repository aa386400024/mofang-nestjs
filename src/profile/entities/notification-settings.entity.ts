import { Column, CreateDateColumn, Entity, JoinColumn, OneToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import { User } from '../../user/entities/user.entity';

/**
 * 用户通知设置 entity — 1:1 关联 users (大厂企业级 V3).
 *
 * V2.0 §Tab4 通知设置页:
 *   4 个开关 (双角色共用, 文案自动适配):
 *     1. 练习提醒 — practiceReminder (boolean)
 *     2. 状态更新通知 — statusUpdate (boolean)
 *     3. 陪伴者消息 — companionMessage (boolean, 陪伴者端文案 = "收到支持者消息")
 *     4. 免打扰时段 — quietStart + quietEnd (HH:mm 字符串, 24h 制)
 *   提醒强度 — reminderIntensity (low / medium / high, V2.0 默认 low)
 *
 * 大厂做法:
 *   - 1:1 跟 users.uid (PK + FK 同列)
 *   - 默认值在 entity 声明 (V2.0 默认全开, 强度 low)
 *   - 字段都是 nullable 友好 (V3 加新开关不破坏现有行)
 *   - 修密 / 软删 / 账号删除时, 这 row 一并被 FK cascade 删除
 */
@Entity('user_notification_settings')
export class NotificationSettings {
  @PrimaryColumn({ type: 'char', length: 36, name: 'uid' })
  uid!: string;

  @Column({ type: 'boolean', default: true, name: 'practice_reminder' })
  practiceReminder!: boolean;

  @Column({ type: 'boolean', default: true, name: 'status_update' })
  statusUpdate!: boolean;

  @Column({ type: 'boolean', default: true, name: 'companion_message' })
  companionMessage!: boolean;

  /** HH:mm 字符串, V2.0 默认 22:00 / 08:00. */
  @Column({ type: 'varchar', length: 5, name: 'quiet_start', default: '22:00' })
  quietStart!: string;

  @Column({ type: 'varchar', length: 5, name: 'quiet_end', default: '08:00' })
  quietEnd!: string;

  @Column({ type: 'varchar', length: 16, name: 'reminder_intensity', default: 'low' })
  reminderIntensity!: 'low' | 'medium' | 'high';

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'uid', referencedColumnName: 'uid' })
  user?: User;
}
