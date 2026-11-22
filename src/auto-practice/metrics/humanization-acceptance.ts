// V2026-11-23 建立 (AF-328 · 文字层真人度 humanization-v1 判据):
//   职责: 把 text.disfluency.* 的六类不流利数字, 收敛成一组**可判读**的真人度判据.
//         判据只在 RENDER_REALISM_MODE=active 的批次上生效; off / audit 批次只测量不判定.
//   边界: 纯常量 + 纯函数, 零 IO / 零框架 / 零随机 / 零文本.
//
//   为什么要有模式门:
//     历史 batch 与 P1 基线批次都在 realism off 下产出, 却也带 text.disfluency.* 指标.
//     若直接套用真人度门槛, 会把「未开注入」误判成「真人度不合格」. 因此本判据把
//     适用模式作为输入的一部分, 非 active 一律 not_applicable, 不产生假失败.
//
//   数值性质: **工程种子值, 非临床标定**. 只用于 AI 层回归与灰度观察, 不能当临床
//   有效性证据, 也不替代真人督导.

import { round6 } from './round.js';

/** 判据适用模式 (与 RENDER_REALISM_MODE 三档同口径). */
export type HumanizationRealismMode = 'off' | 'audit' | 'active';

/** 判据版本标识; 改判据时手动递增. */
export const HUMANIZATION_ACCEPTANCE_VERSION = 'humanization-v1';

/** 判据版本历史 (新→旧). */
export const HUMANIZATION_ACCEPTANCE_VERSION_HISTORY: readonly string[] = ['humanization-v1'];

/** 硬判定所需的最低 visitor 轮次; 低于该值只测量不判定. */
export const HUMANIZATION_MIN_TURNS = 5;

/** 判据类型. */
export type HumanizationExpectationKind = 'range' | 'max_value';

/** 一条真人度判据. */
export interface HumanizationExpectation {
  /** 指标 id, 与 batch-metrics 的 text.disfluency.* 同名. */
  readonly metricId: string;
  readonly kind: HumanizationExpectationKind;
  /** range 下界. */
  readonly min?: number;
  /** range 上界 / max_value 上限. */
  readonly max?: number;
  /** 边界容差, 避免浮点贴边误判. */
  readonly tol: number;
  /** 一句工程依据. */
  readonly rationale: string;
}

/**
 * humanization-v1 判据表.
 *
 * 取值来自 2026-11-23 真实 7 场语料 (140 个 visitor 轮) 的 audit 基线:
 * eventTurnRate 0.407143 / eventsPerTurn 0.528571 / densityPer100 1.321901 /
 * repairPerTurn 0.035714. 门槛在基线外侧留出带宽, 只排除「完全无口语痕迹」与
 * 「机械注入过量」两个极端, 不在中间地带做临床裁决.
 */
export const HUMANIZATION_EXPECTATIONS: readonly HumanizationExpectation[] = [
  {
    metricId: 'text.disfluency.event_turn_rate',
    kind: 'range',
    min: 0.15,
    max: 0.6,
    tol: 0.02,
    rationale: '真人文本应有一部分轮次带口语痕迹, 既不是完全书面化, 也不是每轮都结巴',
  },
  {
    metricId: 'text.disfluency.events_per_turn',
    kind: 'max_value',
    max: 0.8,
    tol: 0.02,
    rationale: '每轮平均不流利事件设上限, 防止为了真人度机械堆填充词',
  },
  {
    metricId: 'text.disfluency.density_per100',
    kind: 'range',
    min: 0.2,
    max: 2.5,
    tol: 0.05,
    rationale: '每百字事件密度过低像书面语, 过高像口吃表演',
  },
  {
    metricId: 'text.disfluency.repair_per_turn',
    kind: 'max_value',
    max: 0.1,
    tol: 0.01,
    rationale: '自我修正是偶发行为, 每轮都改口会破坏话轮可信度',
  },
];

/** 单条判据结果状态. */
export type HumanizationCriterionStatus = 'pass' | 'fail' | 'not_applicable';

/** 单条判据结果. */
export interface HumanizationCriterionResult {
  readonly metricId: string;
  readonly status: HumanizationCriterionStatus;
  readonly actual: number | null;
  readonly expected: string;
  readonly reason: string;
}

/** 总体判定状态. */
export type HumanizationEvaluationStatus = 'passed' | 'failed' | 'not_applicable';

/** 一次判定的完整结果. */
export interface HumanizationEvaluation {
  readonly acceptanceVersion: string;
  readonly realismMode: HumanizationRealismMode;
  readonly status: HumanizationEvaluationStatus;
  readonly applicable: boolean;
  readonly reason: string;
  readonly turns: number | null;
  readonly results: readonly HumanizationCriterionResult[];
}

/** 判定选项. */
export interface HumanizationEvaluationOptions {
  readonly realismMode: HumanizationRealismMode;
  /** visitor 轮次数; null / 缺省视为未知. */
  readonly turns?: number | null;
  /** 最低样本轮次; 低于该值不做硬判定. 缺省 HUMANIZATION_MIN_TURNS. */
  readonly minTurns?: number;
}

/**
 * 把判据表渲染成可读的期望描述.
 *
 * @param expectation 判据
 * @returns 期望描述
 */
export function describeExpectation(expectation: HumanizationExpectation): string {
  if (expectation.kind === 'range') {
    return `[${expectation.min ?? '-inf'}, ${expectation.max ?? '+inf'}] ± ${expectation.tol}`;
  }
  return `<= ${expectation.max ?? 0} ± ${expectation.tol}`;
}

/**
 * 判定单条判据 (纯函数).
 *
 * @param expectation 判据
 * @param actual 指标实际值
 * @returns 单条结果
 */
function evaluateCriterion(expectation: HumanizationExpectation, actual: number | null): HumanizationCriterionResult {
  const expected = describeExpectation(expectation);
  if (actual === null || !Number.isFinite(actual)) {
    return {
      metricId: expectation.metricId,
      status: 'fail',
      actual: null,
      expected,
      reason: `${expectation.rationale}; 指标缺失, fail-closed`,
    };
  }
  if (expectation.kind === 'range') {
    const aboveMin = expectation.min === undefined || actual >= expectation.min - expectation.tol;
    const belowMax = expectation.max === undefined || actual <= expectation.max + expectation.tol;
    return {
      metricId: expectation.metricId,
      status: aboveMin && belowMax ? 'pass' : 'fail',
      actual: round6(actual),
      expected,
      reason: expectation.rationale,
    };
  }
  return {
    metricId: expectation.metricId,
    status: actual <= (expectation.max ?? 0) + expectation.tol ? 'pass' : 'fail',
    actual: round6(actual),
    expected,
    reason: expectation.rationale,
  };
}

/**
 * 判定一批文字的真人度 (纯函数).
 *
 * 非 active 模式、未知轮次、低于最低样本量时返回 not_applicable, 不产生 PASS/FAIL.
 * active 模式下指标缺失 fail-closed, 绝不「缺数据即通过」.
 *
 * @param metrics 指标 map, 键为 text.disfluency.*
 * @param options 判定选项
 * @returns 判定结果
 */
export function evaluateHumanization(
  metrics: Readonly<Record<string, number | null>>,
  options: HumanizationEvaluationOptions,
): HumanizationEvaluation {
  const mode = options.realismMode;
  const turns = options.turns ?? null;
  const minTurns = options.minTurns ?? HUMANIZATION_MIN_TURNS;

  if (mode !== 'active') {
    return {
      acceptanceVersion: HUMANIZATION_ACCEPTANCE_VERSION,
      realismMode: mode,
      status: 'not_applicable',
      applicable: false,
      reason: `realism mode=${mode}; humanization-v1 只判定 active 批次`,
      turns,
      results: HUMANIZATION_EXPECTATIONS.map((expectation) => ({
        metricId: expectation.metricId,
        status: 'not_applicable' as const,
        actual: metrics[expectation.metricId] ?? null,
        expected: describeExpectation(expectation),
        reason: '模式门未开启, 仅测量不判定',
      })),
    };
  }

  if (turns === null || turns < minTurns) {
    return {
      acceptanceVersion: HUMANIZATION_ACCEPTANCE_VERSION,
      realismMode: mode,
      status: 'not_applicable',
      applicable: false,
      reason: `样本不足: turns=${turns ?? 'unknown'}, 最低 ${minTurns}`,
      turns,
      results: HUMANIZATION_EXPECTATIONS.map((expectation) => ({
        metricId: expectation.metricId,
        status: 'not_applicable' as const,
        actual: metrics[expectation.metricId] ?? null,
        expected: describeExpectation(expectation),
        reason: '样本不足, 不做硬判定',
      })),
    };
  }

  const results = HUMANIZATION_EXPECTATIONS.map((expectation) => evaluateCriterion(expectation, metrics[expectation.metricId] ?? null));
  const passed = results.every((result) => result.status === 'pass');
  return {
    acceptanceVersion: HUMANIZATION_ACCEPTANCE_VERSION,
    realismMode: mode,
    status: passed ? 'passed' : 'failed',
    applicable: true,
    reason: passed ? '全部判据通过' : '存在未达标判据',
    turns,
    results,
  };
}

/**
 * 从六类计数与轮次数构建 text.disfluency.* 指标 map (纯函数).
 *
 * 与 batch-metrics.compute 的同名口径保持一致, 便于同一批判据直接复用.
 *
 * @param turns 轮次数
 * @param events 不流利事件总数
 * @param eventTurns 含至少一次事件的轮次数
 * @param normalizedChars 归一化字符总数
 * @param counts 六类计数
 * @returns 指标 map
 */
export function buildHumanizationMetrics(
  turns: number,
  events: number,
  eventTurns: number,
  normalizedChars: number,
  counts: {
    readonly filler: number;
    readonly pause: number;
    readonly repetition: number;
    readonly repair: number;
    readonly trailoff: number;
    readonly elongation: number;
  },
): Record<string, number | null> {
  const perTurn = (value: number): number => (turns > 0 ? round6(value / turns) : 0);
  const density = normalizedChars > 0 ? round6((events * 100) / normalizedChars) : 0;
  return {
    'text.disfluency.events_per_turn': perTurn(events),
    'text.disfluency.event_turn_rate': turns > 0 ? round6(eventTurns / turns) : 0,
    'text.disfluency.density_per100': density,
    'text.disfluency.repair_per_turn': perTurn(counts.repair),
    'text.disfluency.filler_per_turn': perTurn(counts.filler),
    'text.disfluency.pause_per_turn': perTurn(counts.pause),
    'text.disfluency.repetition_per_turn': perTurn(counts.repetition),
    'text.disfluency.trailoff_per_turn': perTurn(counts.trailoff),
  };
}
