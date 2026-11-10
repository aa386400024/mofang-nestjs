// V2026-11-10 治本 (Phase2.5 WP-H · 改动 6 / 改动 9 / 新增 12 — 批次健康与逐字稿索引):
//   职责: 把"这一批数据能不能用"从"看的人自己判断"变成"机器判 + 库里查得到":
//     ① 批次级指标聚合 (改动 6): render_fallback_turns / llm_call_turns / 兜底率;
//     ② 批次有效性门禁 (改动 9): 三条合格线, 任一不过 → valid=false + 端点带 warning;
//     ③ 逐字稿批次索引 (新增 12): data/debug-sessions/_batches/<key>.json,
//        只有 id 与枚举, **不含任何对话文本**.
//
//   为什么门禁是"读时算"而不是"跑完才算":
//     批次还在跑的时候, 前面几场就已经可能不合格 (整场 0 token / 全程兜底).
//     早标出来早提醒人 —— 等"跑完"再判, 等于让人先看完一堆不可用的数据.
//
//   反双胞胎:
//     - 判定是**纯函数** (computeBatchMetrics / evaluateBatchHealth), 单测直接调, 不连 DB;
//     - 落库失败 / 索引写失败都只 warn —— 可观测性设施不该把批次收尾搞挂;
//     - 索引只是**加**一份索引, 不改 debug-session 的写入路径与读取逻辑
//       (改了 admin 调试页就读不到逐字稿了);
//     - 索引里只有 id 与枚举标签, 零对话原文 (隐私红线 AGENTS.md §5.4).

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Repository } from 'typeorm';

import { resolveStoreDir } from '../admin-debug/debug-session-store.js';
import { PracticeBatch } from './entities/practice-batch.entity.js';
import { PracticeSession } from './entities/practice-session.entity.js';

/** 合格线: 有真实调用的场次占比 (改动 9). */
export const BATCH_HEALTH_LLM_CALL_RATIO_MIN = 0.9;

/** 合格线: 渲染兜底率批次均值上限 (改动 9). */
export const BATCH_HEALTH_FALLBACK_RATIO_MAX = 0.05;

/** 不合格批次在响应体里带的告警文案 (改动 9 · 规格原文). */
export const BATCH_INVALID_WARNING = '该批次未通过有效性门禁，指标不可用于结论';

/** 不达标原因标签 (枚举, 不是自由文本). */
export const BATCH_VALIDITY_FLAGS = {
  /** 有真实调用的场次占比不足. */
  llmCallRatioLow: 'LLM_CALL_RATIO_LOW',
  /** 渲染兜底率过高. */
  fallbackRatioHigh: 'FALLBACK_RATIO_HIGH',
  /** 兜底率根本没测到 (没测过 ≠ 0). */
  fallbackRatioUnknown: 'FALLBACK_RATIO_UNKNOWN',
  /** 计数不一致 (degraded_turns > turn_count). */
  counterInconsistent: 'COUNTER_INCONSISTENT',
  /** 批次里一场都没有. */
  noSession: 'NO_SESSION',
} as const;

/**
 * 单场场次的批次视角指标 (只取计数 / 枚举, 不含文本).
 */
export interface BatchSessionMetrics {
  readonly id: string;
  readonly debugSessionId: string;
  readonly characterSlug: string;
  readonly counselorModeId: string;
  readonly status: string;
  readonly turnCount: number;
  readonly degradedTurns: number;
  readonly counselorDegradedTurns: number;
  readonly visitorDegradedTurns: number;
  readonly renderFallbackTurns: number;
  readonly llmCallTurns: number;
  readonly renderFallbackRatio: number | null;
  readonly exitReason: string | null;
  readonly engineVersion: string | null;
  /** WP-B: 本场跑的时候的 prompt 模板版本 (批次对比用). */
  readonly promptVersion: string | null;
}

/**
 * 批次级聚合指标 (改动 6).
 */
export interface BatchMetrics {
  readonly totalSessions: number;
  readonly totalTurns: number;
  readonly renderFallbackTurns: number;
  readonly llmCallTurns: number;
  readonly degradedTurns: number;
  readonly counselorDegradedTurns: number;
  readonly visitorDegradedTurns: number;
  /** 渲染兜底率**批次均值** (改动 9 口径); null = 没测过 (不是 0). */
  readonly renderFallbackRatio: number | null;
  /** 渲染兜底率**加权值** (合计兜底轮 / 合计轮数); null = 没轮数. */
  readonly renderFallbackRatioWeighted: number | null;
  /** 有真实调用的场次占比 (0~1). */
  readonly llmCallRatio: number;
  /** 计数一致性 (全场 degraded_turns ≤ turn_count). */
  readonly counterConsistent: boolean;
}

/**
 * 批次有效性判定结果 (改动 9).
 */
export interface BatchHealth {
  readonly valid: boolean;
  readonly flags: readonly string[];
  readonly llmCallRatio: number;
  readonly fallbackRatio: number | null;
  readonly counterConsistent: boolean;
  readonly totalSessions: number;
}

/**
 * 把场次行投影成批次视角指标 (纯函数).
 *
 * @param row ap_practice_sessions 行
 * @returns 批次视角的单场指标
 */
export function toBatchSessionMetrics(row: PracticeSession): BatchSessionMetrics {
  return {
    id: row.id,
    debugSessionId: row.debugSessionId,
    characterSlug: row.characterSlug,
    counselorModeId: row.counselorModeId,
    status: row.status,
    turnCount: row.turnCount,
    degradedTurns: row.degradedTurns,
    counselorDegradedTurns: row.counselorDegradedTurns,
    visitorDegradedTurns: row.visitorDegradedTurns,
    renderFallbackTurns: row.renderFallbackTurns,
    llmCallTurns: row.llmCallTurns,
    // ⚠️ DECIMAL 在 mysql2 驱动下取回来是**字符串** —— 记得转数字; 转不了就当"没测过".
    renderFallbackRatio: toRatio(row.renderFallbackRatio),
    exitReason: row.exitReason,
    engineVersion: row.engineVersion,
    promptVersion: row.promptVersion,
  };
}

/**
 * 把可能是字符串的 DECIMAL 转成 number; 转不了 (null / NaN) 返回 null.
 *
 * @param raw 原始值
 * @returns 数字或 null
 */
function toRatio(raw: number | string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * 批次级聚合 (纯函数; 改动 6).
 *
 * @param rows 批次内的场次
 * @returns 批次级指标
 */
export function computeBatchMetrics(rows: readonly BatchSessionMetrics[]): BatchMetrics {
  let totalTurns = 0;
  let renderFallbackTurns = 0;
  let llmCallTurns = 0;
  let degradedTurns = 0;
  let counselorDegradedTurns = 0;
  let visitorDegradedTurns = 0;
  let sessionsWithLlmCall = 0;
  let measuredRatioSum = 0;
  let measuredRatioCount = 0;
  let counterConsistent = true;

  for (const row of rows) {
    totalTurns += row.turnCount;
    renderFallbackTurns += row.renderFallbackTurns;
    llmCallTurns += row.llmCallTurns;
    degradedTurns += row.degradedTurns;
    counselorDegradedTurns += row.counselorDegradedTurns;
    visitorDegradedTurns += row.visitorDegradedTurns;
    if (row.llmCallTurns > 0) sessionsWithLlmCall += 1;
    if (row.renderFallbackRatio !== null) {
      measuredRatioSum += row.renderFallbackRatio;
      measuredRatioCount += 1;
    }
    // 计数一致性: 分子是"降级事件数", 分母是"轮数" —— 分子 > 分母在数学上不可能.
    if (row.degradedTurns > row.turnCount) counterConsistent = false;
  }

  const totalSessions = rows.length;
  return {
    totalSessions,
    totalTurns,
    renderFallbackTurns,
    llmCallTurns,
    degradedTurns,
    counselorDegradedTurns,
    visitorDegradedTurns,
    renderFallbackRatio: measuredRatioCount > 0 ? measuredRatioSum / measuredRatioCount : null,
    renderFallbackRatioWeighted: totalTurns > 0 ? renderFallbackTurns / totalTurns : null,
    llmCallRatio: totalSessions > 0 ? sessionsWithLlmCall / totalSessions : 0,
    counterConsistent,
  };
}

/**
 * 批次里是否已经没有"还在跑"的场次 (纯函数).
 *
 * @param rows 批次内的场次
 * @returns 是否全部跑完 (空批次算"跑完" —— 没跑的批次不值得等)
 */
export function areAllFinished(rows: readonly BatchSessionMetrics[]): boolean {
  return rows.every((row) => row.status !== 'running');
}

/**
 * 批次有效性判定 (纯函数; 改动 9).
 *
 * 三条合格线 (与任务单原文一致):
 *   · llm_call_ratio ≥ 0.9 —— 有真实调用的场次占比;
 *   · fallback_ratio < 0.05 —— 渲染兜底率批次均值;
 *   · counter_consistency = 100% —— degraded_turns ≤ turn_count.
 *
 * 任一不达标 → valid = false, 并把原因写进 flags.
 * 不做自动删除、不做自动重跑 —— 只标记, 由人决定 (任务单原文).
 *
 * @param metrics 批次级聚合指标
 * @returns 判定结果
 */
export function evaluateBatchHealth(metrics: BatchMetrics): BatchHealth {
  const flags: string[] = [];

  if (metrics.totalSessions === 0) {
    flags.push(BATCH_VALIDITY_FLAGS.noSession);
  }
  if (metrics.llmCallRatio < BATCH_HEALTH_LLM_CALL_RATIO_MIN) {
    flags.push(BATCH_VALIDITY_FLAGS.llmCallRatioLow);
  }
  if (metrics.renderFallbackRatio === null) {
    // 没测过 ≠ 0: 判成"未知"并标不合格 —— 绝不能把"没测"当成"没问题".
    flags.push(BATCH_VALIDITY_FLAGS.fallbackRatioUnknown);
  } else if (metrics.renderFallbackRatio >= BATCH_HEALTH_FALLBACK_RATIO_MAX) {
    flags.push(BATCH_VALIDITY_FLAGS.fallbackRatioHigh);
  }
  if (!metrics.counterConsistent) {
    flags.push(BATCH_VALIDITY_FLAGS.counterInconsistent);
  }

  return {
    valid: flags.length === 0,
    flags,
    llmCallRatio: metrics.llmCallRatio,
    fallbackRatio: metrics.renderFallbackRatio,
    counterConsistent: metrics.counterConsistent,
    totalSessions: metrics.totalSessions,
  };
}

/**
 * 逐字稿批次索引的一个条目 (只有 id 与枚举, 零对话文本).
 */
interface TranscriptIndexEntry {
  readonly practiceSessionId: string;
  readonly debugSessionId: string;
  readonly characterSlug: string;
  readonly counselorModeId: string;
  readonly status: string;
  readonly turnCount: number;
}

/**
 * 逐字稿批次索引文件 (新增 12).
 */
interface TranscriptIndexFile {
  readonly batchId: string | null;
  /** batch = 批量跑的一批; single = 单场实时跑 (没有 batchId). */
  readonly scope: 'batch' | 'single';
  readonly engineVersion: string | null;
  /** WP-B: 本批的 prompt 模板版本 (批次对比用). */
  readonly promptVersion: string | null;
  readonly createdAt: string;
  readonly sessions: readonly TranscriptIndexEntry[];
}

/**
 * 一次刷新的结果 (指标 + 判定).
 */
export interface BatchRefreshResult {
  readonly metrics: BatchMetrics;
  readonly health: BatchHealth;
  /** 批次内场次列表 (批次视角). */
  readonly sessions: readonly BatchSessionMetrics[];
  /** 批次内是否已没有"还在跑"的场次 (批次收尾判定). */
  readonly allSessionsFinished: boolean;
}

/**
 * 批次健康与逐字稿索引服务.
 */
@Injectable()
export class PracticeBatchHealthService {
  private readonly logger = new Logger('PracticeBatchHealthService');

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(PracticeSession) private readonly sessionRepo: Repository<PracticeSession>,
    @InjectRepository(PracticeBatch) private readonly batchRepo: Repository<PracticeBatch>,
  ) {}

  /**
   * 刷新一个批次的健康结论 (改动 9): 聚合 → 判定 → 落库 → 写索引.
   *
   * 落库 / 写索引失败只 warn —— 判定结论已经算出来了, 不该因为"存不下去"就丢掉.
   *
   * @param batchId 批次 id
   * @param options.onlyWhenFinished 只在批次全部跑完时才落库 + 写索引
   * @returns 指标 + 判定 (落库失败时仍然返回算出来的结论)
   */
  async refreshBatch(batchId: string, options: { readonly onlyWhenFinished?: boolean } = {}): Promise<BatchRefreshResult> {
    const rows = await this.sessionRepo.find({ where: { batchId } });
    const sessionMetrics = rows.map((row) => toBatchSessionMetrics(row));
    const metrics = computeBatchMetrics(sessionMetrics);
    const health = evaluateBatchHealth(metrics);
    const allSessionsFinished = areAllFinished(sessionMetrics);
    // `onlyWhenFinished`: 队列侧每跑完一场就调一次 —— 批次还在跑时不落库、不写索引,
    //   免得 100 场批次刷 100 次 (判定照算, 只是不落).
    if (!(options.onlyWhenFinished === true && !allSessionsFinished)) {
      await this.persist(batchId, metrics, health, rows);
      await this.writeTranscriptIndex(batchId, 'batch', sessionMetrics);
    }
    return { metrics, health, sessions: sessionMetrics, allSessionsFinished };
  }

  /**
   * 刷新单场实时跑的结论 (batchId 为 null 时走这里).
   *
   * 单场也要能生成索引 —— 否则"只跑了一场就没法核对"这种最常见的调试场景反而没有索引.
   *
   * @param practiceSessionId 场次 id
   * @returns 指标 + 判定
   */
  async refreshSingleSession(practiceSessionId: string): Promise<BatchRefreshResult> {
    const row = await this.sessionRepo.findOne({ where: { id: practiceSessionId } });
    const rows = row ? [row] : [];
    const sessionMetrics = rows.map((r) => toBatchSessionMetrics(r));
    const metrics = computeBatchMetrics(sessionMetrics);
    const health = evaluateBatchHealth(metrics);
    await this.writeTranscriptIndex(practiceSessionId, 'single', sessionMetrics);
    return { metrics, health, sessions: sessionMetrics, allSessionsFinished: areAllFinished(sessionMetrics) };
  }

  /**
   * 把判定结论落库 (幂等 upsert 语义).
   */
  private async persist(batchId: string, metrics: BatchMetrics, health: BatchHealth, rows: readonly PracticeSession[]): Promise<void> {
    try {
      const now = new Date();
      const existing = await this.batchRepo.findOne({ where: { batchId } });
      const row = existing ?? new PracticeBatch();
      row.batchId = batchId;
      row.totalSessions = metrics.totalSessions;
      row.totalTurns = metrics.totalTurns;
      row.renderFallbackTurns = metrics.renderFallbackTurns;
      row.llmCallTurns = metrics.llmCallTurns;
      row.llmCallRatio = metrics.llmCallRatio;
      row.fallbackRatio = metrics.renderFallbackRatio;
      row.counterConsistent = metrics.counterConsistent ? 1 : 0;
      row.valid = health.valid ? 1 : 0;
      row.validityFlags = health.flags.length > 0 ? health.flags.join(',') : null;
      row.engineVersion = rows.find((r) => r.engineVersion)?.engineVersion ?? null;
      // WP-B: prompt 模板版本 —— 批次对比时"prompt 是不是同一版"就看这一列.
      row.promptVersion = rows.find((r) => r.promptVersion)?.promptVersion ?? null;
      if (!existing) row.createdAt = now;
      row.updatedAt = now;
      await this.batchRepo.save(row);
    } catch (error) {
      this.logger.warn(`批次健康结论落库失败 batch=${batchId}: ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }

  /**
   * 写逐字稿批次索引 (新增 12).
   *
   * 写失败只 warn —— 索引是便利设施, 不该让批次收尾失败.
   */
  private async writeTranscriptIndex(key: string, scope: 'batch' | 'single', rows: readonly BatchSessionMetrics[]): Promise<void> {
    try {
      const dir = path.join(resolveStoreDir(this.config), '_batches');
      await mkdir(dir, { recursive: true });
      const payload: TranscriptIndexFile = {
        batchId: scope === 'batch' ? key : null,
        scope,
        engineVersion: rows.find((row) => row.engineVersion)?.engineVersion ?? null,
        promptVersion: rows.find((row) => row.promptVersion)?.promptVersion ?? null,
        createdAt: new Date().toISOString(),
        sessions: rows.map((row) => ({
          practiceSessionId: row.id,
          debugSessionId: row.debugSessionId,
          characterSlug: row.characterSlug,
          counselorModeId: row.counselorModeId,
          status: row.status,
          turnCount: row.turnCount,
        })),
      };
      await writeFile(path.join(dir, `${sanitizeFileKey(key)}.json`), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    } catch (error) {
      this.logger.warn(`逐字稿批次索引写入失败 key=${key}: ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }
}

/**
 * 文件名安全化: 只保留字母 / 数字 / 下划线 / 连字符.
 *
 * 为什么要: key 会拼进文件路径 —— 不校验的话, 一个带 `/` 的 id 就能把文件写到目录外面去.
 * id 本来是 nanoid (本来就安全), 这里再兜一层, 免得将来有人传了别的进来.
 *
 * @param key 原始 key
 * @returns 安全化后的文件名主干
 */
export function sanitizeFileKey(key: string): string {
  const cleaned = key.replaceAll(/[^A-Za-z0-9_-]/g, '_');
  return cleaned.length > 0 ? cleaned : 'unknown';
}
