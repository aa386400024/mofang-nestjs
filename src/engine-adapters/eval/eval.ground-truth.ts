// V2026-11-09 治本 (Phase2.5 WP-E · 自动评测 · 真值层):
//   职责: 回答两个问题 —— "这一轮**应该不该**跑审议" 与 "这一轮的 delta **应该**是多少".
//   边界: 纯判定, 零 IO / 零 env. 真值来自数据集, 不来自模型 (不调外部 LLM 做裁判).
//
//   为什么有两套真值提供者 (任务单 §4.1 的 A / B 方案):
//     A 方案 (训练集): 真值 = "规则 delta 与参考审议 delta 差异大" —— 规则算不准, 该跑.
//       ⚠️ 它衡量的是**闸门**该不该放行, 不是审议准不准.
//     B 方案 (验收集): 真值 = 督导标注 —— 督导标了"这里需要反思"的轮次 = 该跑.
//       只有 B 方案能回答"审议输出对不对" (有人的判断做基准).
//
//   ⚠️ 红线: **不用规则 delta 冒充真值**.
//     A 方案下 expectedDeltas 恒为 null —— 拿规则输出当"正确答案", 评出来的"准确率"
//     只是"审议与规则一致的比例", 跟临床准不准没关系. 宁可让指标显示"不可算",
//     也不能让一个看起来漂亮的分数误导调参方向.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/eval/eval.metrics.spec.ts 覆盖 A / B 两套真值

import {
  directionOf,
  type EvalDelta,
  type EvalDimension,
  type EvalSessionRecord,
  type EvalSplit,
  type EvalTurnRecord,
} from './eval.types.js';

/** 真值来源. */
export type EvalGroundTruthKind = 'supervisor' | 'rule_diff';

/**
 * 真值提供者.
 *
 * ⚠️ 两个方法都允许返回 null = "这一轮的真值未知" (不参与指标计算),
 *   而不是 false —— "不知道"与"确实不该跑"是两回事, 混为一谈会凭空造出假阴性.
 */
export interface EvalGroundTruthProvider {
  /** 真值来源. */
  readonly kind: EvalGroundTruthKind;
  /** 数据集切分. */
  readonly split: EvalSplit;
  /** 这一轮**应该**跑审议吗 (null = 未知). */
  shouldRun(turn: EvalTurnRecord): boolean | null;
  /** 这一轮的期望 delta (null = 无人类真值). */
  expectedDeltas(turn: EvalTurnRecord): EvalDelta | null;
}

/**
 * A 方案的幅度差异门槛 (任务单 §4.1: 幅度差 > 0.05).
 */
export const RULE_DIFF_AMPLITUDE_THRESHOLD = 0.05;

/**
 * 判断"规则这一轮算不算不准" (A 方案真值).
 *
 * ⚠️ 判定口径: 方向不同 **或** 任一维幅度差 > 0.05 —— 两条任一成立就算"该跑".
 *   只看幅度差会漏掉"幅度小但方向相反"的轮次 (那正是最危险的: 规则把安全说成提升),
 *   只看方向会漏掉"方向对但幅度差很多"的轮次 (规则差一半, 一样不准).
 *
 * @param ruleDelta 规则输出
 * @param referenceDelta 参考审议输出
 * @returns 该不该跑审议
 */
export function evaluateRuleDiff(ruleDelta: EvalDelta, referenceDelta: EvalDelta): boolean {
  const dims: readonly EvalDimension[] = ['trust', 'safety', 'bond', 'verbal', 'depth', 'style'];
  for (const dim of dims) {
    const ruleValue = ruleDelta[dim] ?? 0;
    const referenceValue = referenceDelta[dim] ?? 0;
    if (directionOf(ruleValue) !== directionOf(referenceValue)) return true;
    if (Math.abs(ruleValue - referenceValue) > RULE_DIFF_AMPLITUDE_THRESHOLD) return true;
  }
  return false;
}

/**
 * 督导真值提供者 (B 方案).
 *
 * ⚠️ 期望 delta 缺失时返回 null (不猜) —— 督导只标了"该跑"没标"该调多少"是常态.
 */
export class SupervisorGroundTruthProvider implements EvalGroundTruthProvider {
  readonly kind: EvalGroundTruthKind = 'supervisor';

  constructor(readonly split: EvalSplit) {}

  shouldRun(turn: EvalTurnRecord): boolean | null {
    return turn.expectedShouldRun ?? null;
  }

  expectedDeltas(turn: EvalTurnRecord): EvalDelta | null {
    return turn.expectedDeltas ?? null;
  }
}

/**
 * 规则差异真值提供者 (A 方案).
 *
 * ⚠️ expectedDeltas 恒为 null —— A 方案没有人类真值, 建议质量不可算 (见文件头红线).
 */
export class RuleDiffGroundTruthProvider implements EvalGroundTruthProvider {
  readonly kind: EvalGroundTruthKind = 'rule_diff';

  constructor(readonly split: EvalSplit) {}

  shouldRun(turn: EvalTurnRecord): boolean | null {
    if (!turn.llmDelta) return null;
    return evaluateRuleDiff(turn.ruleDelta, turn.llmDelta);
  }

  expectedDeltas(_turn: EvalTurnRecord): EvalDelta | null {
    return null;
  }
}

/**
 * 给一场会话选真值提供者.
 *
 * ⚠️ 选择规则: 只要**有任何一轮**带督导标注, 就整场按督导口径算.
 *   混着用两套真值 = 同一份报告里 P/R 的一部分用 A 口径、一部分用 B 口径, 分数不可比.
 *
 * @param session 会话
 * @param split 数据集切分
 * @returns 真值提供者
 */
export function createGroundTruthProvider(session: EvalSessionRecord, split: EvalSplit): EvalGroundTruthProvider {
  const hasSupervisorAnnotation = session.turns.some((turn) => turn.expectedShouldRun !== undefined);
  return hasSupervisorAnnotation ? new SupervisorGroundTruthProvider(split) : new RuleDiffGroundTruthProvider(split);
}
