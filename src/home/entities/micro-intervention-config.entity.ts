import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import type { HomeMicroInterventionTrigger } from '../home.constants';

/**
 * 心塑首页「场景化微干预」配置 — V2.0 新增.
 *
 * 每个用户一份 (1:1 with users).
 *
 * 设计要点 (DESIGN §1.5「场景化微干预植入系统」):
 *   - 用户可管理触发场景与灵敏度 (DESIGN §3「微干预设置」入口)
 *   - 默认全开 + 中等灵敏度
 *   - V3 计划: 接日程权限 / 位置权限 / 使用行为做端侧计算
 *
 * 大厂做法:
 *   - 用 @PrimaryColumn 而不是 @PrimaryGeneratedColumn, 跟 users.uid 强一致
 *   - JSON 字段存 enabled_triggers 数组 (Trigger[]), 简化查询
 *   - 默认值在 entity 层声明, INSERT 缺省时用 DEFAULT
 */
@Entity('micro_intervention_configs')
export class MicroInterventionConfig {
  @PrimaryColumn({ type: 'char', length: 36, name: 'uid' })
  uid!: string;

  /**
   * 总开关 — 关闭后所有微干预不再弹出.
   *
   * 大厂做法: 用 `type: 'boolean'` (TypeORM 自动映射到 MySQL TINYINT(1)),
   * 跟项目其他 entity (burnout-settings / consent-signature / notification-settings) 一致.
   * 之前用 `@Column({ type: 'tinyint', width: 1, ... })` 触发 TS2769 overload 匹配失败,
   * 因为 `width` 字段只在 `ColumnWithLengthOptions` (搭配 WithLengthColumnType) 里,
   * 而 'tinyint' 是 UnsignedColumnType. 用 'boolean' 是项目 standard, 自动映射 MySQL TINYINT(1).
   */
  @Column({ type: 'boolean', name: 'master_enabled', default: true })
  masterEnabled!: boolean;

  /** 灵敏度: low / medium / high (决定触发频率). */
  @Column({ type: 'varchar', length: 16, name: 'sensitivity', default: 'medium' })
  sensitivity!: 'low' | 'medium' | 'high';

  /** 已启用的触发场景 — 默认全开. */
  @Column({ type: 'json', name: 'enabled_triggers', nullable: true })
  enabledTriggers!: HomeMicroInterventionTrigger[] | null;

  /** 静默时段 (HH:mm, 不会触发). */
  @Column({ type: 'varchar', length: 5, name: 'quiet_start', default: '22:00' })
  quietStart!: string;

  @Column({ type: 'varchar', length: 5, name: 'quiet_end', default: '08:00' })
  quietEnd!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
