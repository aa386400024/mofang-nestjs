// V2026-10-22 治本 (V1.3 §7.6 P3-c — 练习记录回写五维画像):
//   原因: spec §7.6 P3-c 拍板「attempt 回写五维画像」, §4 的对账表也写了
//     「本文 attempts 后续可回灌 errorCategories (V2)」. 练习记录不只该回答
//     "练过没练过", 它还应该**反过来喂养**用户的能力雷达 —— 否则用户练了几十次,
//     雷达图纹丝不动, 练习就只是"刷题", 没有累积感.
//   修法 (信号 → 聚合 → upsert 三步):
//     ① **单次信号**: 从本次作答的零压批注里算出 0-100 的信号强度
//        (✅ 动作达成 计 +1, ⚠️ 可以留意 计 -1, ℹ️ 技术提示 **不计入**)
//        ℹ️ 不计的理由: 技术提示是"概念提醒", 不是"这次做到了没做到"的判定,
//        把它算进去等于用噪声稀释信号.
//     ② **跨次聚合**: 取该用户在该子指标上的**全部** attempt 信号求均值.
//        用均值而不是"最近一次": 能力画像要反映**长期水平**, 一次手生不该让雷达图崩掉.
//     ③ **upsert**: 写回 ability_scores (UNIQUE (user_id, dimension_id) 覆盖写).
//
//   零压红线说明 (重要):
//     §6.2「practice_attempts 不下发分数」在**出参层**依然是结构性保证 ——
//     本服务写入的信号只进 ability_scores, **不出现在任何 practice 出参 DTO 里**.
//     两者语义也不同:
//       - 练习批注 = 「这一轮的技术动作批注」, 每次都零压, 绝不含评级
//       - 画像分数 = 「跨次累积的能力雷达」, 是用户主动查看的成长视图
//     如果用户不想看到画像, 那是不看雷达图的问题, 不是练习页的问题.
//
//   反双胞胎:
//     - 不用"最近一次"当分数: 一次手生就把雷达打到地板上, 用户会得出
//       "我越练越差"的结论 —— 这跟零压理念直接冲突
//     - 不在 attempt 落库时同步写 ability_scores: 两条写路径不是一个事务,
//       一次练习成功、一次画像失败, 会留下不一致; 统一在**读侧聚合**时写,
//       幂等且可重算
//     - 不把 ℹ️ 计入信号: 见上
//     - 不在画像里区分"标准题库 / 私有场景": 两者练的是同一项技能, 合并计算
//     - 不硬编码 ability_dimensions 的 id: 按 sub_indicator_code 查 (id 是 UUID,
//       跨环境不一致, code 才是业务主键)
//
//   验证:
//     1. tsc 0 错
//     2. 同一基本功连续练 3 次 (2 次达标 + 1 次未达标) → 画像分数 ≈ 67
//     3. 维度 code 找不到 → 静默跳过 (记 warn), 不抛错打断练习主链路
//     4. 出参 DTO 里 grep 'score' → 0 命中 (零压红线的结构级校验)
//
//   时间戳: 2026-10-22
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, type Repository } from 'typeorm';

import { abilityDimensionCodeOfMode } from '../config/practice-ability-mapping';
import type { PracticeFeedback } from '../domain/practice/practice.types';
import { AbilityDimension } from '../entities/ability-dimension.entity';
import { AbilityScore } from '../entities/ability-score.entity';
import { PracticeAttempt } from '../entities/practice-attempt.entity';
import { PracticeFeedbackTone } from '../enums/practice-feedback-tone.enum';
import { TrainingExerciseMode } from '../enums/training-exercise-mode.enum';

/**
 * 画像回写的结果 (供调用方打日志 / 排查).
 */
export interface PracticeAbilitySyncResult {
  /** 是否成功回写 */
  synced: boolean;
  /** 命中的能力子指标 code (未命中时为 null) */
  dimensionCode: string | null;
  /** 回写后的分数 (未回写时为 null) */
  score: number | null;
}

/**
 * 练习记录 → 五维画像 的回写服务.
 */
@Injectable()
export class PracticeAbilitySyncService {
  private readonly logger = new Logger(PracticeAbilitySyncService.name);

  constructor(
    @InjectRepository(AbilityDimension)
    private readonly dimensionRepo: Repository<AbilityDimension>,
    @InjectRepository(AbilityScore)
    private readonly scoreRepo: Repository<AbilityScore>,
    @InjectRepository(PracticeAttempt)
    private readonly attemptRepo: Repository<PracticeAttempt>,
  ) {}

  /**
   * 把一次练习的信号回写到能力画像.
   *
   * 失败**不影响练习主链路** —— 画像是附加价值, 不该因为它挂了就让用户的练习白做.
   *
   * @param userId 用户 id
   * @param mode 本次练习的基本功
   * @param feedback 本次作答的零压批注 (用于算单次信号)
   * @param attemptId 本次作答记录 id (写进 evidence, 便于回溯)
   * @returns 回写结果
   */
  async syncFromAttempt(
    userId: string,
    mode: TrainingExerciseMode,
    feedback: PracticeFeedback,
    attemptId: string,
  ): Promise<PracticeAbilitySyncResult> {
    try {
      const dimensionCode = abilityDimensionCodeOfMode(mode);
      const dimension = await this.dimensionRepo.findOne({
        where: { subIndicatorCode: dimensionCode, isActive: 1, deletedAt: IsNull() },
      });
      if (!dimension) {
        this.logger.warn(`[practice_ability_sync_skipped] reason=dimension_not_found code=${dimensionCode}`);
        return { synced: false, dimensionCode, score: null };
      }

      const signal = this.computeSignal(feedback);
      if (signal === null) {
        // 本次没有可计入的信号 (全是非判定型批注) —— 不写入, 避免用 0 分污染画像.
        this.logger.warn(`[practice_ability_sync_skipped] reason=no_countable_signal attempt=${attemptId}`);
        return { synced: false, dimensionCode, score: null };
      }

      // 把本次信号落进 attempt 行 (记账), 供后续聚合查询 (零 N+1 的索引路径).
      await this.attemptRepo.update({ id: attemptId, userId }, { abilityDimensionCode: dimensionCode, abilitySignal: signal });

      const aggregated = await this.aggregateSignal(userId, dimensionCode);
      if (aggregated === null) {
        return { synced: false, dimensionCode, score: null };
      }

      await this.upsertScore(userId, dimension.id, aggregated, attemptId);
      return { synced: true, dimensionCode, score: aggregated };
    } catch (error) {
      // 画像回写失败**不能**打断练习主链路.
      this.logger.error(
        `[practice_ability_sync_failed] attempt=${attemptId} err=${error instanceof Error ? error.message : String(error)}`,
      );
      return { synced: false, dimensionCode: null, score: null };
    }
  }

  /**
   * 算本次作答的单次信号 (0-100).
   *
   * 规则: ✅ 记 +1, ⚠️ 记 -1, ℹ️ 不计; (✅ + ⚠️) 为 0 时返回 null (无可计入信号).
   *
   * @param feedback 零压批注
   * @returns 0-100 的信号; 无可计入信号时返回 null
   */
  private computeSignal(feedback: PracticeFeedback): number | null {
    let positive = 0;
    let warning = 0;
    for (const item of feedback.items) {
      if (item.tone === PracticeFeedbackTone.POSITIVE) {
        positive += 1;
        continue;
      }
      if (item.tone === PracticeFeedbackTone.WARNING) {
        warning += 1;
      }
    }
    const total = positive + warning;
    if (total === 0) {
      return null;
    }
    return Math.round((positive / total) * 100);
  }

  /**
   * 跨次聚合: 该用户在该子指标上的全部信号均值.
   *
   * @param userId 用户 id
   * @param dimensionCode 子指标 code
   * @returns 均值 (0-100); 无可聚合数据时返回 null
   */
  private async aggregateSignal(userId: string, dimensionCode: string): Promise<number | null> {
    const attempts = await this.attemptRepo.find({
      where: { userId, abilityDimensionCode: dimensionCode, deletedAt: IsNull() },
      select: { id: true, abilitySignal: true },
    });
    const signals = attempts.map((attempt) => attempt.abilitySignal).filter((value): value is number => value !== null);
    if (signals.length === 0) {
      return null;
    }
    const sum = signals.reduce((acc, value) => acc + value, 0);
    return Math.round(sum / signals.length);
  }

  /**
   * 写回 ability_scores (UNIQUE (user_id, dimension_id) 覆盖写).
   *
   * @param userId 用户 id
   * @param dimensionId 能力维度 id
   * @param score 分数 0-100
   * @param attemptId 本次作答记录 id (写进 evidence)
   */
  private async upsertScore(userId: string, dimensionId: string, score: number, attemptId: string): Promise<void> {
    const existing = await this.scoreRepo.findOne({
      where: { userId, dimensionId, deletedAt: IsNull() },
    });

    const evidence = {
      // 只保留最近 20 条证据 id: 避免 evidence JSON 无限膨胀 (它是 json 列, 没有上限).
      sessionIds: [...(existing?.evidence?.sessionIds ?? []), attemptId].slice(-20),
      lastUpdatedAt: new Date().toISOString(),
    };

    if (existing) {
      existing.score = score;
      existing.evidence = evidence;
      await this.scoreRepo.save(existing);
      return;
    }

    await this.scoreRepo.save(
      this.scoreRepo.create({
        tenantId: userId, // A9 一人一租户
        userId,
        dimensionId,
        score,
        source: 'cloud',
        evidence,
      }),
    );
  }
}
