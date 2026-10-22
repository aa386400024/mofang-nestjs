// V2026-10-15 治本 (V4.1 — quota_usage entity, 3 类配额月度聚合表):
//   原因: counselor-mode-v1.0 §6.4 拍板 quota_usage 表 (userId + quotaType + used + limit
//     + periodStart/End YYYY-MM), V0.3 §13 baseline 0 配额表 (V0.x AI engine + gamification
//     不接配额), 1:1 wire 0 破坏. V1.x W7-8 新建 quota_usage 表, 月度配额按 (userId, quotaType,
//     period) UNIQUE 1:1 配对, 月底清零 (不累积到下月, 跟 §7.2 "月底清零" 1:1).
//
//   修法 (跟 W1-2 long-term-case-session.entity.ts V0.x 风格一致):
//     - UUID PK + char(36) id
//     - tenantId char(36) (V0.x 多租户, A9: 一人一租户)
//     - userId char(36) + quotaType varchar(40) + period varchar(7) UNIQUE 1:1 配对
//     - used int DEFAULT 0 (本月已用配额)
//     - limit int DEFAULT 0 (本月配额上限, 从 membership-tier-presets 5 preset 读)
//     - 3 索引: PRIMARY + UNIQUE (user_id, quota_type, period) + (user_id, period) 加速聚合
//     - 软删 deletedAt
//
//   反双胞胎:
//     - 不用 polymorphic quota source: V0.x 风格 enum 强类型, 防 drift
//     - 不存 vector 字段: V0.x 阶段不接 RAG, V2.x 升级再切
//     - 不复用 V0.x user_memberships 表加 quota_used json 字段: 走独立表, 1:1 wire 0 破坏
//
//   验证:
//     1. tsc 0 错
//     2. pnpm migration:run 后 SHOW INDEX FROM quota_usage; 3 索引
//
//   时间戳: 2026-10-15

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { PracticeQuotaType } from '../enums/practice-quota-type.enum';
import { QuotaType } from '../enums/quota-type.enum';

/**
 * quota_usage 表.
 *
 * 跟 xin_su_app QuotaUsage entity 1:1 wire.
 * 1:N user (1 user 每 quotaType × period 月度 1 行, 月底清零).
 */
@Entity('quota_usage')
@Index('uniq_qu_user_quota_period', ['userId', 'quotaType', 'period'], { unique: true })
@Index('idx_qu_user_period', ['userId', 'period'])
export class QuotaUsage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // V0.x: tenantId = userId (一人一租户, A9). V1.x 多租户上线后 backfill.
  @Column({ type: 'char', length: 36, name: 'tenant_id' })
  tenantId!: string;

  // UNIQUE (user_id, quota_type, period) 配对, 1:1 wire, 防止重复.
  @Column({ type: 'char', length: 36, name: 'user_id' })
  userId!: string;

  // 3 类会员权益配额 (voice_session / long_term_case / voice_analysis), V0.x 风格 enum 强类型.
  //
  // V2026-10-22 治本 (V1.3 §7.4 — 练习域配额并入同一张表):
  //   类型放宽为 `QuotaType | PracticeQuotaType` 的并集, 而不是加进 QuotaType:
  //     - QuotaType 是**会员权益** (可售卖的价值), 且跟客户端 1:1 wire
  //     - PracticeQuotaType 是**单接口调用频率** (防滥用 + 控成本), 不是权益
  //   两类共用 quota_usage 表 (spec §7.4 要求沿用), 但会员链路的
  //   `getQuotaStatuses` 仍只遍历 QuotaType, 不会多吐一行"余额 0"的权益项.
  @Column({ type: 'varchar', length: 40, name: 'quota_type' })
  quotaType!: QuotaType | PracticeQuotaType;

  // 周期串: 月度粒度 'YYYY-MM' (会员权益, V0.x 口径) 或日粒度 'YYYY-MM-DD'
  // (练习域日配额, V1.3 §7.4). 两种粒度靠 UNIQUE (user_id, quota_type, period)
  // 天然互不冲突; 列宽已由 migration 1714900000016 放宽到 VARCHAR(10).
  @Column({ type: 'varchar', length: 10 })
  period!: string;

  // 本月已用配额.
  @Column({ type: 'int', default: 0 })
  used!: number;

  // 本月配额上限 (从 membership-tier-presets 5 preset 读).
  @Column({ type: 'int', default: 0 })
  limit!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  // 软删, 跟 V3 其他模块一致.
  @Column({ type: 'datetime', name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;
}
