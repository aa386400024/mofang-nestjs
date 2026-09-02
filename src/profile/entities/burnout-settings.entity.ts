import { Column, CreateDateColumn, Entity, JoinColumn, OneToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import { User } from '../../user/entities/user.entity';

/**
 * 陪伴者耗竭预警设置 entity — 陪伴者专属 (大厂企业级 V3).
 *
 * V2.0 §Tab4 我的耗竭预警设置:
 *   - enableWarning: 启用耗竭预警 (true)
 *   - enableWeeklyReport: 每周自检报告 (true)
 *   - autoRestReminder: 自动休息提醒 (true)
 *   - dailyLimit: 每日陪伴次数上限 (1-10, 默认 5)
 *
 * 大厂做法:
 *   - 1:1 跟 users.uid (PK + FK 同列)
 *   - cron 用这些设置做实际触发 (V3 跑批)
 *   - 业务参数全部 nullable 友好, V3 加新开关不破坏现有行
 */
@Entity('user_b_burnout_settings')
export class BurnoutSettings {
  @PrimaryColumn({ type: 'char', length: 36, name: 'uid' })
  uid!: string;

  @Column({ type: 'boolean', default: true, name: 'enable_warning' })
  enableWarning!: boolean;

  @Column({ type: 'boolean', default: true, name: 'enable_weekly_report' })
  enableWeeklyReport!: boolean;

  @Column({ type: 'boolean', default: true, name: 'auto_rest_reminder' })
  autoRestReminder!: boolean;

  @Column({ type: 'tinyint', default: 5, name: 'daily_limit' })
  dailyLimit!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'uid', referencedColumnName: 'uid' })
  user?: User;
}
