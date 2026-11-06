// V2026-11-06 治本 (WP44 · 成长档案体系 — 读取侧总览 + 趋势):
//   职责: ① GET /counselor/growth/archive-overview —— 成长档案总览卡片;
//         ② GET /counselor/growth/trend —— 按天的趋势曲线;
//         ③ 打开档案页时把对练数据同步进能力雷达 (幂等).
//   边界: 只做「查表 → 聚合 → 出参」; 评分规则不归本文件 (那是 WP43 的快评).
//
//   为什么路径挂在 /counselor/growth 而不是 /counselor/profile:
//     任务单原文写的是 GET /counselor/profile/overview, 但**那个端点已经存在**
//     (我的 Tab: 训练偏好 + 会员状态, Flutter 客户端在用) ——
//     同名不同义 = 两个端点抢一个路径 = 迟早漂. 成长档案归"成长"语义,
//     所以落在 /counselor/growth/archive-overview + /counselor/growth/trend.
//
//   数据源 (都是**既有**表, 本单不加列、不加表):
//     · session_evaluations —— 单场快评 (WP43): 总分 / 技术 / BDI / 伦理 / crisis
//     · training_sessions  —— 总对练场次
//
//   同步触发 (任务单 §2.1 "用户打开成长档案页时触发一次"):
//     两个端点都触发 —— 前端可能只拉趋势 (独立图表页), 只在总览里触发会让雷达滞后.
//     同步是**幂等全量重算**, 重复触发无副作用 (只会多几次查询).
//
//   零压 / 隐私红线:
//     本文件只出**聚合数字**, 不出任何对话原文 / 量表答案 / 心理画像明细 ——
//     心理内容留在它自己的表里 (逐字稿 / 评估明细), 出参层只给分数.
//
//   验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/counselor/wp44-growth-archive.spec.ts 覆盖总览 / 趋势 / 同步触发
//
//   时间戳: 2026-11-06
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThanOrEqual, type Repository } from 'typeorm';

import { SessionAbilitySyncService } from './session-ability-sync.service.js';
import {
  type GrowthArchiveCategoryAverages,
  type GrowthArchiveOverviewDto,
  type GrowthArchiveTrendDto,
  type GrowthArchiveTrendPointDto,
} from '../dto/growth-archive.dto.js';
import { SessionEvaluation } from '../entities/session-evaluation.entity.js';
import { TrainingSession } from '../entities/training-session.entity.js';

/**
 * 一天毫秒数 (趋势窗口换算).
 */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 成长档案读取服务.
 */
@Injectable()
export class GrowthArchiveService {
  constructor(
    @InjectRepository(SessionEvaluation)
    private readonly evaluationRepo: Repository<SessionEvaluation>,
    @InjectRepository(TrainingSession)
    private readonly sessionRepo: Repository<TrainingSession>,
    private readonly abilitySync: SessionAbilitySyncService,
  ) {}

  /**
   * 成长档案总览卡片.
   *
   * @param userId 当前学员 id
   * @returns 总览
   */
  async overview(userId: string): Promise<GrowthArchiveOverviewDto> {
    await this.syncAbility(userId);
    const evaluations = await this.evaluationRepo.find({ where: { userId }, order: { createdAt: 'DESC' } });
    const totalSessions = await this.sessionRepo.count({ where: { userId, deletedAt: IsNull() } });
    const overallScores = evaluations.map((row) => row.overallScore);
    return {
      totalSessions,
      avgOverallScore: averageOrNull(overallScores),
      // evaluations 已按创建时间倒序 → 第 0 条就是最近一场.
      latestScore: overallScores.length > 0 ? (overallScores[0] ?? null) : null,
      highestScore: overallScores.length > 0 ? Math.max(...overallScores) : null,
      averageByCategory: this.averageByCategory(evaluations),
      crisisCount: evaluations.reduce((sum, row) => sum + row.ethicsScores.crisisCount, 0),
    };
  }

  /**
   * 成长档案趋势曲线 (按天聚合).
   *
   * @param userId 当前学员 id
   * @param days 回看天数
   * @returns 趋势点 (按日期升序)
   */
  async trend(userId: string, days: number): Promise<GrowthArchiveTrendDto> {
    await this.syncAbility(userId);
    const window = Math.min(365, Math.max(1, days));
    const since = new Date(Date.now() - window * DAY_MS);
    const evaluations = await this.evaluationRepo.find({
      where: { userId, createdAt: MoreThanOrEqual(since) },
      order: { createdAt: 'ASC' },
    });
    return { points: this.groupByDay(evaluations) };
  }

  /**
   * 把对练数据同步进能力雷达 (失败不抛 —— 画像是附加价值).
   *
   * @param userId 当前学员 id
   */
  private async syncAbility(userId: string): Promise<void> {
    await this.abilitySync.syncFromSessions(userId);
  }

  /**
   * 三大维度均分.
   *
   * @param evaluations 评估行
   * @returns 均分
   */
  private averageByCategory(evaluations: readonly SessionEvaluation[]): GrowthArchiveCategoryAverages {
    return {
      technical: averageOrNull(evaluations.map((row) => row.technicalScores.average)),
      bdiDelta: averageOrNull(evaluations.map((row) => row.bdiDeltaScores.average)),
      ethics: averageOrNull(evaluations.map((row) => row.ethicsScores.score)),
    };
  }

  /**
   * 按天分组取均值 (按**本地日期**分组).
   *
   * 为什么用本地日期而不是 UTC: created_at 是 DATETIME 列, 库里存的就是服务器本地时间;
   *   转成 UTC 再取日期会让用户看到"今天练的"落到昨天 —— 趋势图上最容易被发现的小错.
   *
   * @param evaluations 评估行 (按创建时间升序)
   * @returns 趋势点
   */
  private groupByDay(evaluations: readonly SessionEvaluation[]): GrowthArchiveTrendPointDto[] {
    const buckets = new Map<string, SessionEvaluation[]>();
    for (const row of evaluations) {
      const date = toLocalDateKey(row.createdAt);
      const bucket = buckets.get(date);
      if (bucket) {
        bucket.push(row);
      } else {
        buckets.set(date, [row]);
      }
    }
    return [...buckets.entries()]
      .toSorted((left, right) => left[0].localeCompare(right[0]))
      .map(([date, rows]) => ({
        date,
        overall: Math.round(averageOrNull(rows.map((row) => row.overallScore)) ?? 0),
        technical: Math.round(averageOrNull(rows.map((row) => row.technicalScores.average)) ?? 0),
        bdiDelta: Math.round(averageOrNull(rows.map((row) => row.bdiDeltaScores.average)) ?? 0),
        ethics: Math.round(averageOrNull(rows.map((row) => row.ethicsScores.score)) ?? 0),
      }));
  }
}

/**
 * 一组数值的均值 (空数组 → null).
 *
 * @param values 数值列表
 * @returns 均值; 空 → null
 */
function averageOrNull(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((acc, value) => acc + value, 0);
  return Math.round((sum / values.length) * 10) / 10;
}

/**
 * Date → 本地日期键 (YYYY-MM-DD).
 *
 * @param value 日期
 * @returns 日期键
 */
function toLocalDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
