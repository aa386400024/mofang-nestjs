// V2026-09-04 治本 (V6.0 §3.4 + audit P0-1):
//   AI 干预效果记录表 — 短 / 中 / 长 3 维效果 (§3.4).
//   原因: 前端 AIEffectRecord 实体已定义 horizon (immediate/weekly/monthly),
//         后端需要持久化效果数据 + 服务端聚合 (§3.4 闭环优化).
//   修复: 短期字段 nullable (用户可能跳过自评), 中期 / 长期 cron 聚合
//         写入 weeklyDelta / monthlyDelta; tool_id + session_id 双向索引
//         支撑 §3.4「同类推荐降权 / 切换方案」聚合查询.
//   如何验证:
//     1. POST /ai/effect/immediate { tool_id, session_id, intensity_before, intensity_after }
//        → 单行落库, 返回 AIEffectRecord DTO.
//     2. cron 每周跑 SELECT * 聚合 → UPDATE ai_effect_records SET weekly_delta = ...
//        WHERE uid = ? AND recorded_at BETWEEN ... AND ...
//     3. SELECT average_delta FROM ai_effect_records WHERE tool_id = ?
//        GROUP BY week → §3.4「持续无效果引导专业转介」.

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { AIEffectHorizon } from '../enums/ai-effect.enums';

/**
 * AI 干预效果记录 — V6.0 §3.4.
 *
 * 设计:
 *   - 短期 (immediate) 由 POST /ai/effect/immediate 即时写入.
 *   - 中期 / 长期 (weekly / monthly) 由 cron 任务聚合后批量 UPDATE.
 *   - context 字段存工具上下文 (e.g. { session_id, scenario_id }), 用于溯源.
 */
@Entity('ai_effect_records')
@Index('idx_ai_effect_uid_recorded', ['uid', 'recordedAt'])
@Index('idx_ai_effect_uid_tool_recorded', ['uid', 'toolId', 'recordedAt'])
@Index('idx_ai_effect_horizon', ['horizon'])
export class AIEffectRecordEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'char', length: 36, name: 'uid' })
  uid!: string;

  @Column({ type: 'varchar', length: 64, name: 'tool_id' })
  toolId!: string;

  /** 关联前端 session id — 同一次会话多次 effect 记录 (短 + 中 + 长). */
  @Column({ type: 'varchar', length: 64, name: 'session_id' })
  sessionId!: string;

  @Column({ type: 'enum', enum: AIEffectHorizon, name: 'horizon' })
  horizon!: AIEffectHorizon;

  // ─── 短期字段 (immediate) ───

  /** 不安度前测 0..10 (用户跳过自评 = null, §3.4 无评判). */
  @Column({ type: 'tinyint', name: 'intensity_before', nullable: true })
  intensityBefore!: number | null;

  /** 不安度后测 0..10. */
  @Column({ type: 'tinyint', name: 'intensity_after', nullable: true })
  intensityAfter!: number | null;

  /** 主观情绪分 0..1 (可选). */
  @Column({ type: 'decimal', precision: 3, scale: 2, name: 'mood_score', nullable: true })
  moodScore!: string | null;

  // ─── 中期 / 长期字段 (cron 聚合) ───

  /** 周维度情绪稳定性变化 -1..1 (§3.4 表). */
  @Column({ type: 'decimal', precision: 4, scale: 3, name: 'weekly_delta', nullable: true })
  weeklyDelta!: string | null;

  /** 月维度心理特质变化 -1..1. */
  @Column({ type: 'decimal', precision: 4, scale: 3, name: 'monthly_delta', nullable: true })
  monthlyDelta!: string | null;

  /** 游戏化参与度 0..1 (§3.4 指标). */
  @Column({ type: 'decimal', precision: 4, scale: 3, name: 'gamification_engagement', nullable: true })
  gamificationEngagement!: string | null;

  /** 上下文透传 — 工具来源 / 场景 / 子模式. */
  @Column({ type: 'json', name: 'context', nullable: true })
  context!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'datetime', precision: 6, name: 'recorded_at' })
  recordedAt!: Date;
}
