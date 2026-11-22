// V2026-11-10 治本 (WP-J P2 · 专业级标注工具 · 自动口径现算):
//   职责: 从**逐字稿 trace** 现算自动判定结果 (探索轮次 / 主导标签 / 危机档位),
//         供 reveal (双盲揭示) 与一致性报告使用.
//   边界: **纯函数** —— 零网络 / 零 DB / 零 Nest; 输入是已抽好的 trace 摘要.
//
//   ⚠️ **口径与 `scripts/ops/quality/visitor-quality-audit.ts` 对齐** (同源):
//     · 探索轮次: 按**来访者轮序** (第几个来访者回应) 找第一个探索类策略, 从 1 起;
//     · 危机档位: 取所有轮次里危机档位的最大值; 未知类别按 1 档兜底.
//
//   ⚠️ **主导标签的口径差异 (与审计脚本有意不同, 见交付记录 B3)**:
//     审计脚本的 `dominant_label` 是**文本关键词推断** (approach/avoid/attack/appease),
//     人工标注员点的是**内核策略** (recounting/resistance/...) —— 两者不同源,
//     拿来算"一致率"是拿猜测比猜测. 本工具的自动主导标签因此改成**策略口径**:
//     统计来访者各轮的**内核策略**, 取 5 个人工标签对应策略里出现最多的那个.
//     内核另外三个策略 (request / insight / discussing_plans) 人工点不出来,
//     不参与评选 (见 STRATEGY_TO_LABEL).

import {
  ANNOTATION_LABELS,
  CRISIS_LEVEL_BY_CATEGORY,
  CRISIS_LEVEL_FALLBACK,
  EXPLORATION_STRATEGIES,
  STRATEGY_TO_LABEL,
  type AnnotationLabel,
} from './quality-annotation.constants.js';

/**
 * 单轮 trace 的**摘要** (只取本文件要用的字段).
 */
export interface AutoTraceInput {
  /** 轮次 (从 1 起). */
  readonly turnIndex: number;
  /** 内核策略 (NULL = 没记到). */
  readonly strategy: string | null;
  /** 该轮是否检出危机. */
  readonly crisisDetected: boolean;
  /** 该轮危机类别 (NULL = 无). */
  readonly crisisCategory: string | null;
}

/**
 * 自动口径的输入 (一场会话).
 */
export interface AutoMetricsInput {
  /** 来访者回应轮数 (逐字稿里 visitor 消息条数). */
  readonly visitorTurnCount: number;
  /** 逐轮 trace 摘要. */
  readonly traces: readonly AutoTraceInput[];
}

/**
 * 自动判定结果.
 */
export interface AutoMetrics {
  /** 首次进入探索的轮次 (NULL = 全场没进探索). */
  readonly explorationTurn: number | null;
  /** 主导标签 (NULL = 没有可映射的策略). */
  readonly dominantLabel: AnnotationLabel | null;
  /** 危机峰值档位 (0~3). */
  readonly crisisLevel: number;
}

/**
 * 从原始 trace (形状未知, 逐字稿里是 `unknown[]`) 抽出摘要.
 *
 * 为什么**防御式解析**: 逐字稿是文件, 里面混着不同版本引擎写出的 trace;
 * 字段缺失/类型不对**不能炸** —— 炸了整场标注就打不开了.
 *
 * @param traces 原始 trace 数组
 * @returns 摘要数组 (形状不对的条目被跳过)
 */
export function toAutoTraces(traces: readonly unknown[]): AutoTraceInput[] {
  const out: AutoTraceInput[] = [];
  for (const raw of traces) {
    if (!raw || typeof raw !== 'object') continue;
    const trace = raw as {
      turnIndex?: unknown;
      intention?: { strategy?: unknown } | null;
      crisis?: { detected?: unknown; category?: unknown } | null;
    };
    const turnIndex = typeof trace.turnIndex === 'number' && Number.isFinite(trace.turnIndex) ? trace.turnIndex : 0;
    const strategy = typeof trace.intention?.strategy === 'string' ? trace.intention.strategy : null;
    const crisis = trace.crisis;
    const crisisDetected = crisis?.detected === true;
    const crisisCategory = typeof crisis?.category === 'string' ? crisis.category : null;
    out.push({ turnIndex, strategy, crisisDetected, crisisCategory });
  }
  return out;
}

/**
 * 算一场会话的自动判定结果.
 *
 * @param input 输入 (来访者轮数 + trace 摘要)
 * @returns 自动判定结果
 */
export function computeAutoMetrics(input: AutoMetricsInput): AutoMetrics {
  const strategyByTurn = new Map<number, string>();
  let crisisLevel = 0;
  for (const trace of input.traces) {
    if (trace.strategy !== null) strategyByTurn.set(trace.turnIndex, trace.strategy);
    if (!trace.crisisDetected) continue;
    const level = CRISIS_LEVEL_BY_CATEGORY[trace.crisisCategory ?? ''] ?? CRISIS_LEVEL_FALLBACK;
    if (level > crisisLevel) crisisLevel = level;
  }

  const strategies: string[] = [];
  for (let turn = 1; turn <= input.visitorTurnCount; turn += 1) {
    strategies.push(strategyByTurn.get(turn) ?? 'unknown');
  }

  return {
    explorationTurn: findExplorationTurn(strategies),
    dominantLabel: findDominantLabel(strategies),
    crisisLevel,
  };
}

/**
 * 首次进入探索的轮次 (从 1 起; 没有 → null).
 *
 * @param strategies 逐轮策略 (下标 0 = 第 1 轮)
 * @returns 轮次; 没进过 → null
 */
function findExplorationTurn(strategies: readonly string[]): number | null {
  const index = strategies.findIndex((strategy) => EXPLORATION_STRATEGIES.includes(strategy));
  return index === -1 ? null : index + 1;
}

/**
 * 主导标签 —— 5 个人工标签对应策略里出现最多的那个.
 *
 * 为什么**不算"未知"与另外三个内核策略**: 人工词表里没有它们, 算进来就得
 * 拿一个点不出来的标签当"自动答案" —— 那等于用一条标注员无法复现的规则打分.
 *
 * 并列时按 `ANNOTATION_LABELS` 的固定顺序取第一个 —— 口径必须**可复算**,
 * 不能靠遍历顺序碰运气.
 *
 * @param strategies 逐轮策略
 * @returns 主导标签; 一个都没有 → null
 */
function findDominantLabel(strategies: readonly string[]): AnnotationLabel | null {
  const counts = new Map<AnnotationLabel, number>();
  for (const strategy of strategies) {
    const label = STRATEGY_TO_LABEL[strategy];
    if (label === undefined) continue;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  let best: AnnotationLabel | null = null;
  let bestCount = 0;
  for (const label of ANNOTATION_LABELS) {
    const count = counts.get(label) ?? 0;
    if (count > bestCount) {
      bestCount = count;
      best = label;
    }
  }
  return best;
}
