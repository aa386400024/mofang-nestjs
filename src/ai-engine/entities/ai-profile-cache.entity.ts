// V2026-09-04 治本 (V6.0 §3.1 + audit P0-1):
//   AI 用户画像缓存表 — 每行 = 单维度快照.
//   原因: 前端 ai_profile_cache 表已实装 (commit 14935e3), 后端需对齐
//         schema. 7 维度画像独立行存储, 端侧增量更新 + 云端协同.
//   修复: (uid, dimension) 唯一 — 单维度 upsert 幂等; payload JSON
//         字段存储端侧 Map; source 区分 cloud / local / user_override.
//   如何验证:
//     1. upsert 同一 (uid, dimension) — 不新增行, 只更新 payload + updated_at.
//     2. 查 7 维度 → SELECT * FROM ai_profile_cache WHERE uid=? 返回 7 行.
//     3. payload 缺字段 → 应用层容错 (AIUserProfile.fromJson), 不抛.

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { AIProfileDimension, AIProfileSource } from '../enums/ai-profile.enums';

/**
 * AI 用户画像单维度缓存 — V6.0 §3.1.
 *
 * 设计要点:
 *   - 每行 = 一个维度快照, 7 维度各占 1 行 (emotion / trait / habit /
 *     stage / tolerance / effect / gamification).
 *   - (uid, dimension) 唯一约束, upsert 幂等.
 *   - payload JSON 字段存端侧 Map 序列化结果, 维度 schema 自由 (由
 *     应用层解释, 大厂 standard: 不在 DB 层约束).
 *   - source 区分 cloud (服务端 RAG 推算) / local (端侧推断) /
 *     user_override (用户在偏好设置面板主动修改).
 *   - last_full_update_ms 是聚合层概念, 由 AIProfileService.loadProfile()
 *     时 SELECT MAX(updated_at_ms) 计算, 不存这张表.
 */
@Entity('ai_profile_cache')
@Index('idx_ai_profile_uid_dim', ['uid', 'dimension'], { unique: true })
@Index('idx_ai_profile_uid_updated', ['uid', 'updatedAt'])
export class AIProfileCache {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'char', length: 36, name: 'uid' })
  uid!: string;

  @Column({ type: 'enum', enum: AIProfileDimension, name: 'dimension' })
  dimension!: AIProfileDimension;

  /** 维度结构化数据 — 应用层 schema 自由, 大厂 standard: 不在 DB 约束. */
  @Column({ type: 'json', name: 'payload' })
  payload!: Record<string, unknown>;

  @Column({
    type: 'enum',
    enum: AIProfileSource,
    name: 'source',
    default: AIProfileSource.CLOUD,
  })
  source!: AIProfileSource;

  @UpdateDateColumn({ type: 'datetime', precision: 6, name: 'updated_at' })
  updatedAt!: Date;

  @CreateDateColumn({ type: 'datetime', precision: 6, name: 'created_at' })
  createdAt!: Date;
}
