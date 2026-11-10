// V2026-11-10 治本 (WP-J P2 · 专业级标注工具 · 一致性计算):
//   职责: 把"人工标注"与"自动判定"逐场对齐, 算出三个可复算的一致性指标.
//   边界: **纯函数** —— 零 DB / 零文件 / 零 Nest; 输入是已取好的两列.
//
//   为什么**要抽成纯函数**: 一致性报告是这次校准的**产出物**, 它的口径必须能被
//   单测钉死 (多少场算多少、没标的不算、两边都缺时返 null 而不是 0).
//
//   ⚠️ **"没标"不算"不一致"**:
//     人工标签为空的行直接跳过 —— 把未标注的行算成"不一致"会让报告越来越难看,
//     而那不是标注员错了, 是还没标.

import type { AutoMetrics } from './quality-annotation-auto.js';
import type { AnnotationLabel } from './quality-annotation.constants.js';

/**
 * 一致性计算的输入 (一场会话).
 */
export interface ConsistencyInput {
  /** 这场是否已标 (人工主导标签非空). */
  readonly labeled: boolean;
  /** 人工主导标签 (NULL = 未标). */
  readonly humanLabel: AnnotationLabel | null;
  /** 人工危机峰值档位. */
  readonly humanCrisisLevel: number;
  /** 人工探索开始轮次 (NULL = 未标 / 本场无探索). */
  readonly humanExplorationTurn: number | null;
  /** 自动判定结果 (NULL = 逐字稿缺失, 这场无法对比). */
  readonly auto: AutoMetrics | null;
}

/**
 * 一致性报告.
 */
export interface ConsistencyReport {
  /** 已标注场次. */
  readonly labeled: number;
  /** 总场次. */
  readonly total: number;
  /** 主导标签一致率 (0~1; 没有可比场次 → null). */
  readonly labelAgreement: number | null;
  /** 危机档位一致率 (0~1; 没有可比场次 → null). */
  readonly crisisAgreement: number | null;
  /** 探索轮次平均绝对误差 (没有可比场次 → null). */
  readonly explorationTurnMae: number | null;
}

/**
 * 算一致性报告.
 *
 * @param inputs 逐场输入
 * @returns 一致性报告
 */
export function computeConsistency(inputs: readonly ConsistencyInput[]): ConsistencyReport {
  let labeled = 0;
  let labelCompared = 0;
  let labelHits = 0;
  let crisisCompared = 0;
  let crisisHits = 0;
  let maeSum = 0;
  let maeCompared = 0;

  for (const item of inputs) {
    if (!item.labeled) continue;
    labeled += 1;
    const auto = item.auto;
    if (auto === null) continue;

    if (item.humanLabel !== null && auto.dominantLabel !== null) {
      labelCompared += 1;
      if (item.humanLabel === auto.dominantLabel) labelHits += 1;
    }

    crisisCompared += 1;
    if (item.humanCrisisLevel === auto.crisisLevel) crisisHits += 1;

    if (item.humanExplorationTurn !== null && auto.explorationTurn !== null) {
      maeSum += Math.abs(item.humanExplorationTurn - auto.explorationTurn);
      maeCompared += 1;
    }
  }

  return {
    labeled,
    total: inputs.length,
    labelAgreement: labelCompared > 0 ? labelHits / labelCompared : null,
    crisisAgreement: crisisCompared > 0 ? crisisHits / crisisCompared : null,
    explorationTurnMae: maeCompared > 0 ? maeSum / maeCompared : null,
  };
}
