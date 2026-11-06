// V2026-11-06 治本 (WP44 · 成长档案体系 — 能力信号统一聚合器):
//   职责: 把**三个来源**的能力信号 (MCQ 刷题 / 对练快评 / 对练督导) 按同一口径
//         聚合成一个 0-100 分, 并 upsert 进 `ability_scores`.
//   边界: 只做「取数 → 聚合 → 写回」; 映射口径在 session-ability-mapping.ts,
//         评分规则在各自来源里, 本文件**不含任何子指标专属逻辑**.
//
//   为什么必须是**一个**聚合器 (而不是两个 sync 各算各的):
//     `ability_scores` 一行 = 一个 (用户 × 子指标), **物理上只有一行**.
//     MCQ 刷题与对练都会写这 5 个重叠子指标 ——
//       若两路各算各的均值再覆盖写, 最终值取决于"谁最后写" → 雷达分会漂移,
//       而且用户刷新一次页面就可能变一次分 (最不可信的一类 bug).
//     共用聚合器后: 两路算出来的**是同一个数** (全部信号合并取均值),
//     谁先谁后写都一样 → 幂等, 可重算.
//
//   三类信号 (都是 0-100, 越高越好):
//     ① 刷题: `practice_attempts.ability_signal` (V1.3 §7.6 P3-c 已落库)
//     ② 快评: `session_evaluations` 的技术/伦理维度分 (WP43)
//     ③ 督导: `supervision_reports.dimensions` 六维分 (LLM 深度版)
//
//   取督导报告为什么不直接按 user_id 查:
//     报告行的归属靠 tenant 隔离 + sessionId 白名单 (见 SupervisionReportRepository 的接口注释),
//     仓储**刻意没有**按 userId 查的出口 —— 本服务按既有范式:
//     先查该用户的 training_sessions (拿 id + tenantId), 再批量 findBySessionIds.
//     单人产品阶段量级是"几十场", 一次批量查完; 真到了千场级再补仓储出口.
//
//   反双胞胎:
//     - 不在本文件里写"哪个维度怎么算": 映射表才有那份口径;
//     - 不把 0 分当"没有信号": 没有信号 → 该维度**不写**这一行 (别用 0 污染画像);
//     - 不在写入失败时抛错: 画像是附加价值, 挂了不该让用户看不到成长档案;
//     - 数值一律过有限数校验: 督导六维是 LLM 解析出来的, 可能缺字段 / 非数字.
//
//   验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/counselor/wp44-growth-archive.spec.ts 覆盖三来源合并 / 幂等 / 端点

import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, type Repository } from 'typeorm';

import {
  SUPERVISION_REPORT_REPOSITORY,
  type SupervisionReportRepository,
} from '../../agent/supervisor/domain/repositories/supervision-report.repository.js';
import { SESSION_ABILITY_MAPPING } from '../config/session-ability-mapping.js';
import { AbilityDimension } from '../entities/ability-dimension.entity.js';
import { AbilityScore } from '../entities/ability-score.entity.js';
import { PracticeAttempt } from '../entities/practice-attempt.entity.js';
import { SessionEvaluation } from '../entities/session-evaluation.entity.js';
import { TrainingSession } from '../entities/training-session.entity.js';

/**
 * evidence 里最多保留的来源 id 数 (json 列没有长度上限, 但无限膨胀会让行越来越大).
 */
const EVIDENCE_MAX_IDS = 20;

/**
 * 批量查督导报告时的 sessionId 分片大小 (IN 列表太长会拖慢 SQL).
 */
const REPORT_LOOKUP_CHUNK = 200;

/**
 * 一个用户的全部能力信号 (一次装载, 多个子指标复用).
 */
export interface AbilitySignalBundle {
  /** 子指标 code → 全部信号值 (0-100). */
  readonly byDimension: ReadonlyMap<string, number[]>;
  /** 子指标 code → 来源记录 id (刷题 = attempt id, 对练 = training_session id). */
  readonly sourceIdsByDimension: ReadonlyMap<string, string[]>;
}

/**
 * 单个子指标的同步结果.
 */
export interface AbilitySyncOutcome {
  /** 是否真的写回了 (没信号 / 子指标不存在 → false). */
  readonly synced: boolean;
  /** 子指标 code. */
  readonly dimensionCode: string;
  /** 写回的分数 (0-100); 没写回 → null. */
  readonly score: number | null;
}

/**
 * 往信号集合里塞一条 (值 + 来源 id).
 *
 * @param byDimension 子指标 → 值集合
 * @param sourceIds 子指标 → 来源 id 集合
 * @param dimensionCode 子指标 code
 * @param value 信号值 (0-100)
 * @param sourceId 来源记录 id
 */
function pushSignal(
  byDimension: Map<string, number[]>,
  sourceIds: Map<string, string[]>,
  dimensionCode: string,
  value: number,
  sourceId: string,
): void {
  const values = byDimension.get(dimensionCode);
  if (values) {
    values.push(value);
  } else {
    byDimension.set(dimensionCode, [value]);
  }
  const ids = sourceIds.get(dimensionCode);
  if (ids) {
    ids.push(sourceId);
  } else {
    sourceIds.set(dimensionCode, [sourceId]);
  }
}

/**
 * 把一组 id 切成固定大小的片.
 *
 * @param ids id 列表
 * @param size 每片大小
 * @returns 分片结果
 */
function chunk<T>(ids: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < ids.length; index += size) {
    result.push(ids.slice(index, index + size));
  }
  return result;
}

/**
 * 能力信号统一聚合器 (刷题 + 快评 + 督导 → 同一个数).
 */
@Injectable()
export class AbilityAggregateService {
  private readonly logger = new Logger(AbilityAggregateService.name);

  constructor(
    @InjectRepository(AbilityDimension)
    private readonly dimensionRepo: Repository<AbilityDimension>,
    @InjectRepository(AbilityScore)
    private readonly scoreRepo: Repository<AbilityScore>,
    @InjectRepository(PracticeAttempt)
    private readonly attemptRepo: Repository<PracticeAttempt>,
    @InjectRepository(SessionEvaluation)
    private readonly evaluationRepo: Repository<SessionEvaluation>,
    @InjectRepository(TrainingSession)
    private readonly sessionRepo: Repository<TrainingSession>,
    @Inject(SUPERVISION_REPORT_REPOSITORY)
    private readonly reportRepo: SupervisionReportRepository,
  ) {}

  /**
   * 装载该用户的全部能力信号 (三来源).
   *
   * 一次装载、多个子指标复用 —— 五个子指标不能各查一遍 (那是 N×5 次 DB 往返).
   *
   * @param userId 用户 id
   * @returns 信号集合
   */
  async loadSignals(userId: string): Promise<AbilitySignalBundle> {
    const byDimension = new Map<string, number[]>();
    const sourceIds = new Map<string, string[]>();
    await this.loadPracticeSignals(userId, byDimension, sourceIds);
    await this.loadEvaluationSignals(userId, byDimension, sourceIds);
    await this.loadReportSignals(userId, byDimension, sourceIds);
    return { byDimension, sourceIdsByDimension: sourceIds };
  }

  /**
   * 取某个子指标上的全部信号均值 (0-100).
   *
   * @param bundle 信号集合
   * @param dimensionCode 子指标 code
   * @returns 均值 (0-100); 无信号 → null
   */
  aggregate(bundle: AbilitySignalBundle, dimensionCode: string): number | null {
    const values = bundle.byDimension.get(dimensionCode);
    if (!values || values.length === 0) return null;
    const sum = values.reduce((acc, value) => acc + value, 0);
    return Math.round(sum / values.length);
  }

  /**
   * 聚合并写回某个子指标 (幂等覆盖写).
   *
   * @param userId 用户 id
   * @param dimensionCode 子指标 code
   * @param bundle 信号集合 (缺省 = 自己装一次)
   * @returns 同步结果
   */
  async syncDimension(userId: string, dimensionCode: string, bundle?: AbilitySignalBundle): Promise<AbilitySyncOutcome> {
    const dimension = await this.dimensionRepo.findOne({
      where: { subIndicatorCode: dimensionCode, isActive: 1, deletedAt: IsNull() },
    });
    if (!dimension) {
      this.logger.warn(`[ability_aggregate_skipped] reason=dimension_not_found code=${dimensionCode}`);
      return { synced: false, dimensionCode, score: null };
    }
    const signals = bundle ?? (await this.loadSignals(userId));
    const aggregated = this.aggregate(signals, dimensionCode);
    if (aggregated === null) {
      // 没有信号 → **不写**这一行 (别用 0 分污染画像).
      return { synced: false, dimensionCode, score: null };
    }
    const sourceIds = signals.sourceIdsByDimension.get(dimensionCode) ?? [];
    await this.upsertScore(userId, dimension.id, aggregated, sourceIds);
    return { synced: true, dimensionCode, score: aggregated };
  }

  /**
   * 装载刷题信号 (MCQ 练习的零压批注算出来的能力信号).
   *
   * @param userId 用户 id
   * @param byDimension 子指标 → 值集合
   * @param sourceIds 子指标 → 来源 id 集合
   */
  private async loadPracticeSignals(userId: string, byDimension: Map<string, number[]>, sourceIds: Map<string, string[]>): Promise<void> {
    const attempts = await this.attemptRepo.find({
      where: { userId, deletedAt: IsNull() },
      select: { id: true, abilityDimensionCode: true, abilitySignal: true },
    });
    for (const attempt of attempts) {
      const code = attempt.abilityDimensionCode;
      const signal = attempt.abilitySignal;
      if (!code || signal === null || !Number.isFinite(signal)) continue;
      pushSignal(byDimension, sourceIds, code, signal, attempt.id);
    }
  }

  /**
   * 装载快评信号 (WP43 的规则引擎评分).
   *
   * @param userId 用户 id
   * @param byDimension 子指标 → 值集合
   * @param sourceIds 子指标 → 来源 id 集合
   */
  private async loadEvaluationSignals(userId: string, byDimension: Map<string, number[]>, sourceIds: Map<string, string[]>): Promise<void> {
    const evaluations = await this.evaluationRepo.find({
      where: { userId },
      select: { sessionId: true, technicalScores: true, ethicsScores: true },
    });
    for (const evaluation of evaluations) {
      for (const rule of SESSION_ABILITY_MAPPING) {
        const signal = rule.fromEvaluation({
          technical: evaluation.technicalScores,
          ethics: evaluation.ethicsScores,
        });
        if (signal === null || !Number.isFinite(signal)) continue;
        pushSignal(byDimension, sourceIds, rule.dimensionCode, signal, evaluation.sessionId);
      }
    }
  }

  /**
   * 装载督导信号 (LLM 六维评分).
   *
   * @param userId 用户 id
   * @param byDimension 子指标 → 值集合
   * @param sourceIds 子指标 → 来源 id 集合
   */
  private async loadReportSignals(userId: string, byDimension: Map<string, number[]>, sourceIds: Map<string, string[]>): Promise<void> {
    const sessions = await this.sessionRepo.find({
      where: { userId, deletedAt: IsNull() },
      select: { id: true, tenantId: true },
    });
    if (sessions.length === 0) return;
    const idsByTenant = new Map<string, string[]>();
    for (const session of sessions) {
      const ids = idsByTenant.get(session.tenantId);
      if (ids) {
        ids.push(session.id);
      } else {
        idsByTenant.set(session.tenantId, [session.id]);
      }
    }
    for (const [tenantId, ids] of idsByTenant) {
      for (const part of chunk(ids, REPORT_LOOKUP_CHUNK)) {
        const found = await this.reportRepo.findBySessionIds(tenantId, part);
        for (const [sessionId, report] of found) {
          // parse_error 的报告没有可用六维 → 不取信号.
          if (report.status !== 'completed' || !report.dimensions) continue;
          for (const rule of SESSION_ABILITY_MAPPING) {
            const signal = rule.fromReport(report.dimensions);
            if (signal === null || !Number.isFinite(signal)) continue;
            pushSignal(byDimension, sourceIds, rule.dimensionCode, signal, sessionId);
          }
        }
      }
    }
  }

  /**
   * 写回 ability_scores (UNIQUE (user_id, dimension_id) 覆盖写).
   *
   * evidence 里放**当前全部来源 id** (去重 + 取最近 N 条) —— 而不是"往上次的结果后面追加":
   *   追加会让同一个 id 反复堆积, 且重算后长度只增不减; 重算语义要求**可重复得到同一个值**.
   *
   * @param userId 用户 id
   * @param dimensionId 能力维度 id
   * @param score 分数 0-100
   * @param sourceIds 来源记录 id 列表
   */
  private async upsertScore(userId: string, dimensionId: string, score: number, sourceIds: readonly string[]): Promise<void> {
    const existing = await this.scoreRepo.findOne({
      where: { userId, dimensionId, deletedAt: IsNull() },
    });
    const evidence = {
      sessionIds: [...new Set(sourceIds)].slice(-EVIDENCE_MAX_IDS),
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
