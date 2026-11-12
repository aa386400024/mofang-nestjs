// V2026-11-11 WP-K (批次指标快照 Schema v1):
//   职责: 定义"一个批次的固化快照长什么样", 这是落库 / 对比 / 报告的共同契约.
//   边界: 纯类型 + 纯守卫, 零 IO / 零框架.
//
//   演进策略 (重要):
//     · schemaVersion 只增不改; 读端按版本分派解析器, 不做"一把梭"的兼容猜测;
//     · v1 之前的批次 (metrics_json 为 NULL) 视为 legacy, 不回溯重算、不覆盖写
//       (历史行当时没算过, 回填 = 编数据);
//     · 字段只增不删; 确需删除/改语义, 必须升 schemaVersion 而不是就地改 v1.

import type { ZeroMotionBreakdown } from './acceptance-thresholds.js';
import type { ConfigFingerprintSegments } from '../config-fingerprint.js';

/** 当前快照版本. */
export const BATCH_METRICS_SCHEMA_VERSION = 1 as const;

/** 跳过原因枚举 (coverage.skipReasons 的键). */
export type SkipReason = 'file_missing' | 'json_invalid' | 'no_traces' | 'no_snapshot';

/** 覆盖率: 哪些场次真的纳入了、哪些被跳过及原因. */
export interface BatchCoverage {
  readonly expectedSessions: number;
  readonly includedSessions: number;
  readonly skippedSessions: number;
  readonly skipReasons: Readonly<Partial<Record<SkipReason, number>>>;
  readonly totalTurns: number;
  /** 来源目录 (相对仓库根; 只存路径, 不含内容). */
  readonly transcriptRoot: string;
}

/** 单场血缘 (审计: 快照由哪些文件算出). */
export interface SessionLineage {
  readonly debugSessionId: string;
  readonly characterSlug: string;
  readonly counselorModeId: string;
  readonly turns: number;
  /** 逐字稿文件 sha256 前 16 位. */
  readonly fileSha256: string;
}

/** 一个分组切片 (byMode / byCharacter 共用). */
export interface MetricsSlice {
  readonly sessions: number;
  readonly turns: number;
  readonly metrics: Readonly<Record<string, number | null>>;
  /**
   * 零变化场次细分 (I-22): total / closure (事件层非 neutral → 豁免) / idle (纯 neutral → 计入).
   *
   * 字段只增不删: 旧快照 (intake-v1 时期落库) 没有这个字段, 读端按"缺省"处理.
   */
  readonly zeroMotionBreakdown?: ZeroMotionBreakdown;
}

/** 批次指标快照 v1. */
export interface BatchMetricsV1 {
  readonly schemaVersion: 1;
  readonly computedAt: string;
  readonly batchId: string;
  readonly fingerprint: ConfigFingerprintSegments;
  readonly coverage: BatchCoverage;
  readonly lineage: readonly SessionLineage[];
  /** 键 = 指标字典 id; 值 = 指标值 (nullable 指标可为 null). */
  readonly metrics: Readonly<Record<string, number | null>>;
  /** 全批零变化场次细分 (I-22); 字段只增不删, 旧快照缺省. */
  readonly zeroMotionBreakdown?: ZeroMotionBreakdown;
  readonly byMode: Readonly<Record<string, MetricsSlice>>;
  readonly byCharacter: Readonly<Record<string, MetricsSlice>>;
}

// ── 手写守卫 ──────────────────────────────────────────────────────────────
// 不做"宽松通过": 每个必需字段都验证类型, 对不上直接抛错. 这样读到坏数据时
// 立刻暴露, 而不是让 undefined 一路流到报告里变成难查的静默错误.

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * 轻量版本识别 (不抛错): 区分 v1 与 legacy.
 * 解析外部数据时先调它; false 即按 legacy 处理, 不进入 assert.
 */
export function isBatchMetricsV1(value: unknown): boolean {
  return isObject(value) && value['schemaVersion'] === BATCH_METRICS_SCHEMA_VERSION;
}

/**
 * 断言一个未知值是合法的 BatchMetricsV1.
 *
 * @param value 待校验值
 * @param label 出错时的标识 (batchId 等)
 */
function assertCoverage(value: Record<string, unknown>, label: string): void {
  const coverage = value['coverage'];
  if (!isObject(coverage)) throw new Error(`[${label}] coverage 缺失`);
  const numericFields = ['expectedSessions', 'includedSessions', 'skippedSessions', 'totalTurns'] as const;
  for (const field of numericFields) {
    if (!isFiniteNumber(coverage[field])) throw new Error(`[${label}] coverage.${field} 非法`);
  }
  if (!isString(coverage['transcriptRoot'])) throw new Error(`[${label}] coverage.transcriptRoot 非法`);
}

function assertLineage(value: Record<string, unknown>, label: string): void {
  const lineage = value['lineage'];
  if (!Array.isArray(lineage)) throw new Error(`[${label}] lineage 不是数组`);
  for (const [i, entry] of lineage.entries()) {
    if (!isObject(entry) || !isString(entry['debugSessionId']) || !isString(entry['characterSlug'])) {
      throw new Error(`[${label}] lineage[${i}] 非法`);
    }
  }
}

function assertMetricsMap(value: Record<string, unknown>, label: string): void {
  const metrics = value['metrics'];
  if (!isObject(metrics)) throw new Error(`[${label}] metrics 缺失`);
  for (const [key, metric] of Object.entries(metrics)) {
    if (metric !== null && !isFiniteNumber(metric)) {
      throw new Error(`[${label}] metrics.${key} 既非数字也非 null`);
    }
  }
}

/**
 * 校验零变化细分 (可选字段; 在场则逐个字段验型).
 *
 * @param value 待校验值
 * @param label 出错时的标识
 */
function assertZeroMotionBreakdown(value: unknown, label: string): void {
  if (!isObject(value)) throw new Error(`[${label}] zeroMotionBreakdown 非法`);
  for (const field of ['total', 'closure', 'idle'] as const) {
    if (!isFiniteNumber(value[field])) throw new Error(`[${label}] zeroMotionBreakdown.${field} 非法`);
  }
}

export function assertBatchMetricsV1(value: unknown, label = 'snapshot'): asserts value is BatchMetricsV1 {
  if (!isObject(value)) throw new Error(`[${label}] 快照不是对象`);
  if (value['schemaVersion'] !== BATCH_METRICS_SCHEMA_VERSION) {
    throw new Error(`[${label}] schemaVersion 不是 ${BATCH_METRICS_SCHEMA_VERSION}`);
  }
  if (!isString(value['computedAt'])) throw new Error(`[${label}] computedAt 缺失或非字符串`);
  if (!isString(value['batchId'])) throw new Error(`[${label}] batchId 缺失或非字符串`);
  if (!isObject(value['fingerprint'])) throw new Error(`[${label}] fingerprint 缺失`);
  assertCoverage(value, label);
  assertLineage(value, label);
  assertMetricsMap(value, label);
  if (!isObject(value['byMode'])) throw new Error(`[${label}] byMode 缺失`);
  if (!isObject(value['byCharacter'])) throw new Error(`[${label}] byCharacter 缺失`);
  if (value['zeroMotionBreakdown'] !== undefined) assertZeroMotionBreakdown(value['zeroMotionBreakdown'], label);
  for (const [sliceName, slices] of [
    ['byMode', value['byMode']],
    ['byCharacter', value['byCharacter']],
  ] as const) {
    for (const [key, slice] of Object.entries(slices)) {
      if (!isObject(slice)) throw new Error(`[${label}] ${sliceName}.${key} 非法`);
      if (slice['zeroMotionBreakdown'] !== undefined) {
        assertZeroMotionBreakdown(slice['zeroMotionBreakdown'], `${label}.${sliceName}.${key}`);
      }
    }
  }
}
