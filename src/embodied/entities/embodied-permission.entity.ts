import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import { User } from '../../user/entities/user.entity';

/**
 * 具身数据权限设置 entity — 1:1 with users (V2.0 §Tab4 embodied 权限管理).
 *
 * 设计: 1 行 4 列 boolean, 默认 true (用户新增 1 行空权限记录).
 *   - 不拆 4 行 table: 一致性更好, 单行 update 即可
 *   - 跟 user_profile / membership / notification_settings 一致
 */
@Entity('embodied_permissions')
export class EmbodiedPermissions {
  @PrimaryColumn({ type: 'char', length: 36, name: 'uid' })
  uid!: string;

  @Column({ type: 'boolean', name: 'practice_realtime_guide', default: true })
  practiceRealtimeGuide!: boolean;

  @Column({ type: 'boolean', name: 'fitness_analytics', default: true })
  fitnessAnalytics!: boolean;

  @Column({ type: 'boolean', name: 'emotion_passive_recognition', default: false })
  emotionPassiveRecognition!: boolean;

  @Column({ type: 'boolean', name: 'anonymous_trend_share', default: false })
  anonymousTrendShare!: boolean;

  @Column({ type: 'boolean', name: 'master_sensor_enabled', default: true })
  masterSensorEnabled!: boolean;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'uid', referencedColumnName: 'uid' })
  user?: User;
}
