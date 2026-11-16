// V2026-11-09 治本 (Phase2.5 WP-C · 触发式审议闸门 · 纯判定层):
//   职责: 闸门的**全部判定逻辑** —— 从"状态 + 事件 + 运行时状态"算出"跑 / 不跑 + 理由".
//   边界: **纯函数** —— 零 IO / 零 Redis / 零 env / 零网络. 纯函数才好测、好拆、好复核.
//
//   为什么判定必须住在纯函数里 (本单最关键的一条治本):
//     任务单 §2.2 的决策流程有 8 步, 其中 ④冷却 / ⑤配额 / ⑥熔断 三步要读 Redis.
//     如果把这三步的 IO 与判定混在一个 service 里, 这条流程就只能靠"起 Redis 才能测"来覆盖 ——
//     而 §5.1 的验收明确要求 evaluator.spec.ts 覆盖"危机 / 首轮 / 关键事件 / 阈值 / 全平静".
//     所以这里定死一条规矩:
//       · **IO 层 (quotas.ts) 只负责"读数字 / 写数字"**, 一个比较都不做;
//       · **判定层 (本文件) 只负责"比较"**, 一个 IO 都不做.
//     于是整条 8 步流程可以整段单测, 且 Redis 抖动时的降级方向也一眼可见
//     (读失败 → 数字取"最宽松"的缺省 → 判定自然放行).
//
//   复用了既有口径 (判定只有一份):
//     · 状态前后对比 → buildStateComparison (deliberation-input.ts, WP-A 已有的唯一翻译处);
//     · "能不能出境" → isDeliberationRiskAcceptable (WP-A 合规闸门的唯一口径);
//     · "规则算得准不准" → DELIBERATION_RULE_ALIGNED_TAGS (WP63 的标签契约).
//     本文件**不复制**任何一份 —— 复制即漂移, 漂移即白跑一轮.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/deliberation-gate/evaluator.spec.ts 覆盖任务单 §5.1 全部分支

import type { GateDecision, GateEventTag, GateInput, GatePolicy, GateReason, GateRuntimeState } from './deliberation-gate.types.js';
import type { BdiSnapshot } from '../../engine-core/index.js';
import { buildStateComparison, isDeliberationRiskAcceptable } from '../deliberation/deliberation-input.js';
import { DELIBERATION_RULE_ALIGNED_TAGS, type DeliberationDim } from '../deliberation/deliberation-types.js';

/**
 * 同盟三维 (任务单 §2.1 的"同盟三维触发阈值").
 *
 * ⚠️ 为什么用 satisfies 而不是直接写死类型:
 *   维度名必须是审议维度 (DELIBERATION_DIMS) 的子集 —— 写错一个键名编译期就红,
 *   不用等运行时才发现"这一维的 delta 永远读不到".
 */
export const GATE_ALLIANCE_DIMS = ['trust', 'safety', 'bond'] as const satisfies readonly DeliberationDim[];

/**
 * 阻抗三维 (任务单 §2.1 的"阻抗维度触发阈值").
 */
export const GATE_RESISTANCE_DIMS = ['verbal', 'depth', 'style'] as const satisfies readonly DeliberationDim[];

/**
 * 关键事件硬触发清单 (任务单 §2.1: boundary_violation / judgment / crisis_edge).
 *
 * ⚠️ **任务单用的是抽象名, 这里映射到内核既有事件口径** (内核 DELTA_TABLE 的事件名):
 *   · boundary_violation → boundary_cross (咨询师越界);
 *   · judgment         → judgment        (价值评判);
 *   · crisis_edge      → sensitive_touch (触碰敏感议题 = 踩到危机边缘).
 * 映射之后闸门直接吃内核真值 (output.events), 不另起一套预判 ——
 *   同一句话两套标签 = 影子期的对比数据全废 (仓库反双胞胎纪律).
 */
export const GATE_KEY_EVENT_TAGS: readonly GateEventTag[] = ['boundary_cross', 'judgment', 'sensitive_touch'];

/**
 * "规则算得准"的事件清单 (规则算子也能打出来的那些).
 *
 * ⚠️ 直接引用 WP63 的契约常量, **不复制** —— 复制即第二份真相.
 *   任何不在这份清单里的事件 (LLM 专属的隐性阻抗 / 微表情 / 关系氛围, 或内核的
 *   neutral 占位) 都意味着"规则这一轮没把握" → 交给 LLM 去看.
 */
const RULE_CONFIDENT_TAGS: ReadonlySet<string> = new Set(DELIBERATION_RULE_ALIGNED_TAGS);

/**
 * 算本轮 11 维逐维 delta (观测用).
 *
 * ⚠️ 复用 WP-A 的 buildStateComparison 而不是自己再写一遍"快照 → 维度"的翻译:
 *   那张映射表 (snapshot.emotion.valence → 维度 valence) 在仓库里**只有一份**,
 *   复制一份就意味着两处的维度口径迟早对不上 (而 delta 对不上 = 影子期数据全废).
 *
 * @param before 本轮开始时的快照
 * @param after 本轮结束后的快照
 * @returns 11 维 delta (维度名 → 变化量)
 */
export function computeGateDeltaSummary(before: BdiSnapshot, after: BdiSnapshot): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const entry of buildStateComparison(before, after)) {
    summary[entry.dimension] = entry.delta;
  }
  return summary;
}

/**
 * 这一轮有没有命中关键事件 (硬触发, 不看 delta).
 *
 * @param events 本轮事件标签
 * @returns true = 命中
 */
export function hasGateKeyEvent(events: readonly GateEventTag[]): boolean {
  const keyEvents: readonly string[] = GATE_KEY_EVENT_TAGS;
  return events.some((tag) => keyEvents.includes(tag));
}

/**
 * 这个事件类型规则**算得准**吗 (在置信清单内).
 *
 * @param tag 事件标签
 * @returns true = 规则有把握
 */
export function isRuleConfidentEvent(tag: GateEventTag): boolean {
  return RULE_CONFIDENT_TAGS.has(tag);
}

/**
 * 闸门判定的入参 (纯数据: 状态 + 事件 + 运行时状态 + 策略).
 */
export interface GateEvaluationRequest {
  /** 本轮输入 (零对话原文). */
  readonly input: GateInput;
  /** 从 Redis 读到的运行时状态 (冷却 / 计数 / 配额 / 熔断). */
  readonly runtime: GateRuntimeState;
  /** 当前模式下的策略 (阈值 / 冷却 / 配额 / 熔断开关). */
  readonly policy: GatePolicy;
}

/**
 * 闸门判定的结果.
 */
export interface GateEvaluationResult {
  /** 跑 / 不跑. */
  readonly decision: GateDecision;
  /** 理由 (可枚举). */
  readonly reason: GateReason;
  /** 11 维逐维 delta (观测用). */
  readonly deltaSummary: Readonly<Record<string, number>>;
}

/**
 * 闸门判定 (任务单 §2.2 的八步流程, 短路返回).
 *
 * ⚠️ **顺序不能改** —— 每一步的语义依赖"上面都没命中":
 *   ① 危机红线在最前: 危机轮次**永远不跑**, 哪怕它同时命中了关键事件;
 *   ② 首轮次之: 基线必须建立, 不受冷却/配额限制 (否则第一轮永远建不了基线);
 *   ③ 关键事件第三: 硬触发**不受冷却与配额限制** —— 越界/评判这种轮次不能被冷却挡掉;
 *   ④⑤⑥ 才是"省钱"的三道闸 (冷却 / 配额 / 熔断);
 *   ⑦ 最后才是"不确定性评估" (这一轮到底值不值得问 LLM).
 *
 * @param request 判定入参
 * @returns 决策 + 理由 + delta 摘要
 */
export function evaluateGate(request: GateEvaluationRequest): GateEvaluationResult {
  const { input, runtime, policy } = request;
  const deltaSummary = computeGateDeltaSummary(input.stateBefore, input.stateAfter);

  // ① 硬红线: 危机轮次永远不跑 (口径复用 WP-A 的 isDeliberationRiskAcceptable ——
  //    只有 low 允许出境; medium/high 是危机意念与行动层, 一律不跑).
  if (!isDeliberationRiskAcceptable(input.safety.riskLevel)) {
    return { decision: 'skip', reason: 'crisis_skip', deltaSummary };
  }

  // ② 首轮强制跑 (建立基线).
  if (input.turnIndex === 1) {
    return { decision: 'run', reason: 'first_turn_baseline', deltaSummary };
  }

  // ③ 关键事件硬触发 (越界 / 评判 / 触碰敏感议题) —— 不管 delta 多大都跑.
  if (hasGateKeyEvent(input.events)) {
    return { decision: 'run', reason: 'key_event', deltaSummary };
  }

  // ④ 冷却检查: 距上次跑不到 N 轮.
  //    ⚠️ 用 <= 而不是 <: "冷却 N 轮"= 跑完后 N 轮内不再跑 (影子冷却 1 轮 = 隔一轮跑一次).
  if (runtime.lastTurn !== null && input.turnIndex - runtime.lastTurn <= policy.cooldownTurns) {
    return { decision: 'skip', reason: 'cooldown', deltaSummary };
  }

  // ⑤ 配额检查: 本会话次数上限 / 全局每分钟上限.
  if (runtime.sessionRunCount >= policy.maxPerSession) {
    return { decision: 'skip', reason: 'quota_exceeded', deltaSummary };
  }
  if (runtime.globalRunCount >= policy.globalRpm) {
    return { decision: 'skip', reason: 'quota_exceeded', deltaSummary };
  }

  // ⑥ 熔断检查 (仅生效模式; 影子模式策略里 circuitEnabled = false).
  if (policy.circuitEnabled && runtime.circuitOpen) {
    return { decision: 'skip', reason: 'circuit_open', deltaSummary };
  }

  // ⑦ 不确定性评估: 规则**算不准**的地方才跑.
  for (const tag of input.events) {
    if (!isRuleConfidentEvent(tag)) {
      return { decision: 'run', reason: 'unknown_event_type', deltaSummary };
    }
  }
  if (GATE_ALLIANCE_DIMS.some((dimension) => Math.abs(deltaSummary[dimension] ?? 0) > policy.thresholds.alliance)) {
    return { decision: 'run', reason: 'alliance_delta_high', deltaSummary };
  }
  if (GATE_RESISTANCE_DIMS.some((dimension) => Math.abs(deltaSummary[dimension] ?? 0) > policy.thresholds.resistance)) {
    return { decision: 'run', reason: 'resistance_delta_high', deltaSummary };
  }
  const allDeltas = Object.values(deltaSummary);
  if (allDeltas.every((delta) => Math.abs(delta) < policy.thresholds.calm)) {
    return { decision: 'skip', reason: 'calm_turn', deltaSummary };
  }

  // ⑧ 默认: 规则有把握, 不跑.
  return { decision: 'skip', reason: 'rule_confident', deltaSummary };
}
