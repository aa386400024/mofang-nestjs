// V2026-09-04 治本 (V6.0 §3.3 + audit P0-1):
//   AI 动态解锁状态表 — 6 大高阶功能 (§3.3 表) + 4 维度评分.
//   原因: 前端 game_unlock_progress 表已实装 (commit 14935e3) — 服务端
//         镜像表, 评估算法在服务端跑 (服务端聚合行为数据 + 评估需求强度 /
//         使用深度 / 干预效果 / 心理准备度).
//   修复: 4 维度评分 decimal(4,3) 存 (0..1); state enum 4 态; rollback_reason
//         解释回退原因 (§3.3「AI 自动暂时隐藏」审计); (uid, feature) 唯一.
//   如何验证:
//     1. composite = need*0.4 + usage*0.25 + effect*0.2 + readiness*0.15
//        服务端 SQL 计算或 service 层计算, >= 0.6 触发 unlocked.
//     2. rollback 写 rollback_reason, 下次评估可重新转 unlocked (状态机).
//     3. last_evaluated_at + updated_at 双重记录 (评估 vs 状态变更).

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { AIUnlockFeature, AIUnlockState } from '../enums/ai-unlock.enums';

/**
 * AI 动态解锁状态 — V6.0 §3.3 表.
 *
 * 反双胞胎:
 *   - 跟 inner_world/entities/game-unlock-progress.entity.ts 字段对齐
 *     (uid + module_id + state + progress_json), 那个是端侧缓存表, 这个
 *     是服务端权威表. V2 阶段两侧字段一致, 由 sync 任务对齐.
 */
@Entity('ai_unlock_states')
@Index('idx_ai_unlock_uid_feature', ['uid', 'feature'], { unique: true })
@Index('idx_ai_unlock_state', ['state'])
export class AIUnlockStateEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'char', length: 36, name: 'uid' })
  uid!: string;

  /** 高阶功能 — 6 大类 (§3.3 表). */
  @Column({ type: 'enum', enum: AIUnlockFeature, name: 'feature' })
  feature!: AIUnlockFeature;

  /** 解锁状态机 — 4 态. */
  @Column({
    type: 'enum',
    enum: AIUnlockState,
    name: 'state',
    default: AIUnlockState.LOCKED,
  })
  state!: AIUnlockState;

  // ─── 4 维度评分 (§3.3 权重表) — decimal(4,3) 0..1 ───

  /** 需求强度 weight 0.4. */
  @Column({ type: 'decimal', precision: 4, scale: 3, name: 'score_need', default: 0 })
  scoreNeed!: string;

  /** 使用深度 weight 0.25. */
  @Column({ type: 'decimal', precision: 4, scale: 3, name: 'score_usage', default: 0 })
  scoreUsage!: string;

  /** 干预效果 weight 0.20. */
  @Column({ type: 'decimal', precision: 4, scale: 3, name: 'score_effect', default: 0 })
  scoreEffect!: string;

  /** 心理准备度 weight 0.15. */
  @Column({ type: 'decimal', precision: 4, scale: 3, name: 'score_readiness', default: 0 })
  scoreReadiness!: string;

  /** 综合分缓存 — 服务端每次 evaluate 重算并写回, 减少重复计算. */
  @Column({ type: 'decimal', precision: 4, scale: 3, name: 'composite_score', default: 0 })
  compositeScore!: string;

  /** 回退原因 (rolledBack 时有值, §3.3 审计 + 用户解释面板). */
  @Column({ type: 'varchar', length: 200, name: 'rollback_reason', nullable: true })
  rollbackReason!: string | null;

  /** 上次评估时间 — 行为数据变更触发重算 (cron 周期 + 事件触发). */
  @UpdateDateColumn({ type: 'datetime', precision: 6, name: 'last_evaluated_at' })
  lastEvaluatedAt!: Date;

  @CreateDateColumn({ type: 'datetime', precision: 6, name: 'created_at' })
  createdAt!: Date;
}
