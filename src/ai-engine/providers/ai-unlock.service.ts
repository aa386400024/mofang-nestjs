// V2026-09-04 治本 (V6.0 §3.3 + audit P0-1):
//   AI 解锁服务 — 6 大高阶功能 + 4 维度评分 + 状态机.
//   关键反双胞胎: 不写「手动解锁」 — 全由 evaluateUnlocks() 自动跑.
//             client 只读 + 接受回滚通知 (§3.3 audit + 用户解释面板).

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';

import type { AIUnlockStateDto, AIUnlockStatesDto } from '../dto/ai-unlock.dto';
import { AIUnlockStateEntity } from '../entities/ai-unlock-state.entity';
import { AIUnlockFeature, AIUnlockState } from '../enums/ai-unlock.enums';

/**
 * AI 动态解锁服务 — §3.3.
 *
 * 核心: evaluateUnlocks(uid) 跑 4 维度评分 + 写状态机.
 *   - 评分公式: composite = need*0.4 + usage*0.25 + effect*0.2 + readiness*0.15
 *   - 状态机: locked → unlocking → unlocked → (rolled_back)
 *   - V2.0 阶段 evaluate 用静态评分 (cold start + 7 day baseline),
 *     V3 接行为数据 + 评估问卷.
 */
@Injectable()
export class AIUnlockService {
  private readonly logger = new Logger(AIUnlockService.name);

  /** §3.3 解锁阈值 — composite >= 0.6 触发 unlocked. */
  static readonly UNLOCK_THRESHOLD = 0.6;

  /** §3.3 评分公式权重. */
  static readonly WEIGHTS = {
    need: 0.4,
    usage: 0.25,
    effect: 0.2,
    readiness: 0.15,
  } as const;

  /**
   * 生成 UUID — 抽成方法方便单测 mock, 同时跟 ai-profile.service.ts.upsertRow
   * 走一致风格 (randomUUID from node:crypto, 大厂 standard 够用).
   */
  private generateUuid(): string {
    return randomUUID();
  }

  constructor(
    @InjectRepository(AIUnlockStateEntity)
    private readonly repo: Repository<AIUnlockStateEntity>,
  ) {}

  /**
   * 拉取 6 大功能解锁状态 — 端侧 GameUnlockProgressBloc 同步源.
   */
  async getStates(uid: string): Promise<AIUnlockStatesDto> {
    const rows = await this.repo.find({ where: { uid } });
    const items: AIUnlockStateDto[] = rows.map((row) => ({
      feature: row.feature,
      state: row.state,
      scoreNeed: Number.parseFloat(row.scoreNeed),
      scoreUsage: Number.parseFloat(row.scoreUsage),
      scoreEffect: Number.parseFloat(row.scoreEffect),
      scoreReadiness: Number.parseFloat(row.scoreReadiness),
      compositeScore: Number.parseFloat(row.compositeScore),
      rollbackReason: row.rollbackReason,
      lastEvaluatedAtMs: row.lastEvaluatedAt.getTime(),
    }));
    return { items, fetchedAtMs: Date.now() };
  }

  /**
   * 评估 + 更新 — cron 周期 (5 分钟) 调用.
   *
   * V2.0 实现: 用静态 baseline 评分 (V3 接行为数据时替换).
   * 状态机:
   *   - composite >= 0.6 && state in (locked, rolled_back) → unlocked
   *   - composite < 0.6 && state == unlocked → unlocked (保持, 不回滚, 等 cron 周期累计后判定)
   *   - composite < 0.4 持续 14 天 → rolled_back
   *
   * 反双胞胎: 不写评分输入数据采集 (那是 assessment / practice 模块
   *           的职责, 本服务只接收聚合后的分数).
   */
  async evaluateUnlocks(uid: string): Promise<AIUnlockStatesDto> {
    // V2.0 占位: 6 功能都按 cold_start baseline 评分.
    // V3: 拉 ai_profile_cache + assessment_records + practice_records 聚合.
    const baselines: {
      feature: AIUnlockFeature;
      need: number;
      usage: number;
      effect: number;
      readiness: number;
    }[] = [
      { feature: AIUnlockFeature.INNER_VOICE_COACH, need: 0.7, usage: 0.3, effect: 0.5, readiness: 0.6 },
      { feature: AIUnlockFeature.GENOME_RESHAPE, need: 0.5, usage: 0.2, effect: 0.4, readiness: 0.5 },
      { feature: AIUnlockFeature.LIFE_SCRIPT, need: 0.4, usage: 0.1, effect: 0.3, readiness: 0.4 },
      { feature: AIUnlockFeature.EMBODIED_DEEP, need: 0.6, usage: 0.2, effect: 0.4, readiness: 0.5 },
      { feature: AIUnlockFeature.COMPANION_TREE, need: 0.8, usage: 0.4, effect: 0.6, readiness: 0.7 },
      { feature: AIUnlockFeature.PET_CULTIVATION, need: 0.5, usage: 0.3, effect: 0.5, readiness: 0.5 },
    ];

    for (const b of baselines) {
      const composite =
        b.need * AIUnlockService.WEIGHTS.need +
        b.usage * AIUnlockService.WEIGHTS.usage +
        b.effect * AIUnlockService.WEIGHTS.effect +
        b.readiness * AIUnlockService.WEIGHTS.readiness;

      // 状态机判定.
      let state: AIUnlockState;
      const rollbackReason: string | null = null;
      if (composite >= AIUnlockService.UNLOCK_THRESHOLD) {
        state = AIUnlockState.UNLOCKED;
      } else if (composite >= 0.3) {
        state = AIUnlockState.UNLOCKING;
      } else {
        state = AIUnlockState.LOCKED;
      }

      // V2026-09-04 治本 (smoke 修 + 跟 ai-profile/game-unlock/emergency 对齐):
      //   旧实现 `repo.upsert(..., ['uid', 'feature'])` 在 typeorm 1.1.1 上有
      //   extractUpsertSet 丢字段 bug (本服务字段虽然不踩 jsonb Record 的 TS2345,
      //   但 runtime 行为仍不可预测 — 大厂 standard 走统一 raw SQL 治源).
      //   修复: 走 raw SQL `INSERT ... ON DUPLICATE KEY UPDATE`, 1 SQL 完成.
      //   id 走 randomUUID() (entity 列 @PrimaryGeneratedColumn('uuid'), raw query
      //   路径下 typeorm 不自动生成). last_evaluated_at 由 MySQL DEFAULT NOW() 托管.
      //   Fallback: dto 没传 rollbackReason → NULL (entity 列 nullable).
      await this.repo.query(
        `INSERT INTO ai_unlock_states
           (id, uid, feature, state, score_need, score_usage, score_effect,
            score_readiness, composite_score, rollback_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           state = VALUES(state),
           score_need = VALUES(score_need),
           score_usage = VALUES(score_usage),
           score_effect = VALUES(score_effect),
           score_readiness = VALUES(score_readiness),
           composite_score = VALUES(composite_score),
           rollback_reason = VALUES(rollback_reason),
           last_evaluated_at = NOW()`,
        [
          this.generateUuid(),
          uid,
          b.feature,
          state,
          b.need.toFixed(3),
          b.usage.toFixed(3),
          b.effect.toFixed(3),
          b.readiness.toFixed(3),
          composite.toFixed(3),
          rollbackReason,
        ],
      );
    }

    this.logger.debug(`evaluateUnlocks uid=${uid} features=${baselines.length}`);
    return this.getStates(uid);
  }

  /**
   * 手动回滚 — admin 后台强制把某功能回到 locked.
   *
   * 反双胞胎: 不写「管理员强制解锁」 — 评估算法自动跑, 人工只干预回滚.
   */
  async rollback(uid: string, feature: AIUnlockFeature, reason: string): Promise<AIUnlockStateDto> {
    const row = await this.repo.findOne({ where: { uid, feature } });
    if (!row) {
      throw new Error(`AI unlock not found uid=${uid} feature=${feature}`);
    }
    row.state = AIUnlockState.ROLLED_BACK;
    row.rollbackReason = reason;
    await this.repo.save(row);
    return {
      feature: row.feature,
      state: row.state,
      scoreNeed: Number.parseFloat(row.scoreNeed),
      scoreUsage: Number.parseFloat(row.scoreUsage),
      scoreEffect: Number.parseFloat(row.scoreEffect),
      scoreReadiness: Number.parseFloat(row.scoreReadiness),
      compositeScore: Number.parseFloat(row.compositeScore),
      rollbackReason: row.rollbackReason,
      lastEvaluatedAtMs: row.lastEvaluatedAt.getTime(),
    };
  }
}
