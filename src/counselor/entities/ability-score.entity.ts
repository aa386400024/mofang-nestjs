// V2026-10-15 治本 (V3.2 — ability_scores entity, user × dimension 聚合):
//   原因: counselor-mode-v1.0 §6.3 拍板 ability_scores 表 (userId × dimensionId UNIQUE
//     + score 0-100 + source 区分 cloud/local/user_override + evidence json 来源
//     session_id 列表), V0.3 §13 baseline 0 子指标 score 表 (V0.x AIProfileSnapshot
//     7 维度是 json 字段, 1:1 wire 0 破坏). V1.x W5-6 新建独立表, 28 子指标各自一行.
//
//   修法 (跟 supervision-feedback.entity.ts W3-4 风格一致):
//     - UUID PK + char(36) id
//     - tenantId char(36) (V0.x 多租户, A9: 一人一租户)
//     - userId char(36) + dimensionId char(36) UNIQUE 配对 (1:1 wire, 防止重复)
//     - score int 0-100 (子指标分数, V0.x AIProfileSnapshot 0-1 改为 0-100 更直观)
//     - source varchar(20) (跟 V0.x AIProfileSnapshot.source enum 1:1: cloud / local / user_override)
//     - evidence json (来源 session_id 列表, 跟 counselor-mode-v1.0 §6.3 1:1)
//     - 3 索引: PRIMARY + UNIQUE (user_id, dimension_id) + (user_id) 加速按 user 聚合
//     - 软删 deletedAt
//
//   反双胞胎:
//     - 不复用 V0.x AIProfileSnapshot 7 维度 json 字段: 28 子指标粒度更细, 1:1 wire 增量
//     - 不用 polymorphic score source: V0.x enum (cloud/local/user_override) 跟 §6.3 1:1
//     - 不存 vector 字段: V0.x 阶段不接 RAG, V2.x 升级再切
//     - V0.5 阶段不接 W3-4 supervision.service 自动累加: 留 V1.x 续做 (避免 V0.5 scope 蔓延,
//       W3-4 service.generateFeedback V0.5 mock 不调用 ability.service.upsertScore)
//
//   验证:
//     1. tsc 0 错
//     2. pnpm migration:run 后 SHOW INDEX FROM ability_scores; 3 索引
//
//   时间戳: 2026-10-15

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * 来源 session_id 列表 (evidence json 字段 1:1 对应 counselor-mode-v1.0 §6.3).
 */
export interface AbilityScoreEvidence {
  /** 来源 session_id 列表 (W1-2 LongTermCaseSession.id / W3-4 supervision_feedback.session_id) */
  sessionIds: string[];
  /** 最后一次更新时间 ISO 8601 */
  lastUpdatedAt: string;
}

/**
 * ability_scores 表.
 *
 * 跟 xin_su_app AbilityScore entity 1:1 wire.
 * 1:N user × dimension (1 user 最多 28 行, 跟 ability_dimensions 1:1 配对).
 */
@Entity('ability_scores')
@Index('uniq_as_user_dim', ['userId', 'dimensionId'], { unique: true })
@Index('idx_as_user', ['userId'])
export class AbilityScore {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // V0.x: tenantId = userId (一人一租户, A9). V1.x 多租户上线后 backfill.
  @Column({ type: 'char', length: 36, name: 'tenant_id' })
  tenantId!: string;

  // UNIQUE (user_id, dimension_id) 配对, 1:1 wire, 防止重复.
  @Column({ type: 'char', length: 36, name: 'user_id' })
  userId!: string;

  // 应用层校验, 不写 DB-level FK (软删兼容, 跟 supervision_feedback.schoolId 同 pattern).
  @Column({ type: 'char', length: 36, name: 'dimension_id' })
  dimensionId!: string;

  // 子指标分数 0-100 (V0.x AIProfileSnapshot 0-1 改为 0-100 更直观, UI 雷达图直接用).
  @Column({ type: 'int' })
  score!: number;

  // 来源 (跟 V0.x AIProfileSnapshot.source 1:1: cloud / local / user_override).
  // V0.5 阶段 user_override 走前端 toggle, 跟 V0.3 §6 一致.
  @Column({ type: 'varchar', length: 20, default: 'cloud' })
  source!: string;

  // 来源 session_id 列表 + 最后更新时间 (V1.x 接 W3-4 supervision_feedback 累加时填).
  @Column({ type: 'json', nullable: true })
  evidence!: AbilityScoreEvidence | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  // 软删, 跟 V3 其他模块一致.
  @Column({ type: 'datetime', name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;
}
