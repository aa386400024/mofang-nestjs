// V2026-10-28 治本 (WP3 · 引擎内核 · 轨迹合成):
//   职责: 按模式把 BDI 自由规划结果 (Intention) 与本轮幕的 target / delta 合成,
//         产出「最终 Intention + 叠加后快照」.
//   边界: 纯函数, 无状态, 无 IO, 无随机. 不改入参, 全部返回新对象.
//
//   三模式语义 (任务单 §5.3-§5.6):
//     force_override   强覆盖: target 有值的字段**替换** BDI; forbiddenBehaviors 取并集;
//     trigger          触发: 命中后按**强覆盖**语义激活 (信号要明确, 不能被柔化稀释);
//     weighted_correct 修正: strategy 取 target, 数值按 w 加权混合 (w*target+(1-w)*bdi).
//
//   目标与偏移是**两件事** (别混):
//     target = 本轮的**行为目标** (这一轮怎么回应) → 影响 Intention;
//     delta  = 本轮的**状态偏移** (来访内心状态怎么变) → 影响快照, 且**只在
//              进入新幕那一轮叠加一次**. 等待轮不叠, 否则信任/阻抗会被反复滚高.
//
//   反双胞胎:
//     - **不新造 clamp**: 复用 WP1 的 clamp01 / clampValence / resolveEmotionLabel.
//       新写一套就会与事件迁移那套产生细微差异 (比如 NaN 的处理), 于是"同一份
//       快照在两条路径上算出不同的值", 且极难查.
//     - 不自己判"该叠多少": 是否叠加由 planAct 的 enterNewAct 决定, 合成层只执行.
//       两边都判断一次 = 迟早出现"推进器认为不叠、合成器叠了"的状态漂移.
//     - 不用 mutate 改快照: 快照是值语义 (可回放), 一律造新对象整体替换.
//
//   V2026-11-03 治本 (WP26 · P2-12 — 轨迹 delta 纳入单回合总 delta 的 cap):
//     改之前本文件把 `node.delta` 直接 clamp 后叠到快照上 —— **只 clamp 不 cap**,
//     于是"事件 delta (已 cap) + 剧本 delta (未 cap)"能叠出 2 倍 cap 的单回合跳变.
//     现在: 偏移先转成内核 delta 向量 (`toDeltaVector`, 唯一转换点), 一路带出去
//     (TrajectoryApplication.delta), 由会话层与事件 delta 合并后**统一过一次 cap**
//     再落快照. 落快照复用内核的 `applyDeltaVector` —— 不在本文件再写第二份 clamp.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-core/wp3-trajectory.spec.ts 覆盖三模式合成与 delta 一次性

import type { ActPlan } from './act-cursor.js';
import type { BdiSnapshot } from '../../domain/bdi-snapshot.js';
import { clamp01, clampValence, resolveEmotionLabel, type EmotionState } from '../../domain/emotion.js';
import type { Intention } from '../../domain/intention.js';
import type { SnapshotDelta, TrajectoryMode, TrajectoryNodeTarget } from '../../domain/trajectory/script.js';
import { applyDeltaVector, type DeltaVector } from '../state-transition.js';

/**
 * 修正模式默认权重 (工程种子值: 幕目标占六成、BDI 占四成).
 *
 * 非临床标定, 集中为常量便于后期用训练数据校准.
 */
export const DEFAULT_CORRECT_WEIGHT = 0.6;

/**
 * 修正模式权重的下界 (落在 (0,1] 内).
 *
 * 为什么不 clamp 到 0: 权重 0 意味着"这一幕完全不影响本轮", 幕目标被彻底抹掉 ——
 * 一条脏配置 (correctWeight: 0 / 负数) 若直接生效, 剧本会静默失效, 而脚本作者
 * 以为"这一幕生效了". 夹到极小正值 = 仍然生效但影响微弱, 失败方向是"偏弱"而非"消失".
 */
export const MIN_CORRECT_WEIGHT = 0.01;

/**
 * 三模式合成结果.
 */
export interface TrajectoryApplication {
  /** 最终意图 (本轮实际生效的行为目标). */
  readonly intention: Intention;
  /** 叠加后的快照 (已 clamp, 已重算 emotion.label); enterNewAct=false 时不叠 delta. */
  readonly snapshot: BdiSnapshot;
  /** 本轮是否有幕被激活. */
  readonly activated: boolean;
  /**
   * 本轮叠加的**原始**状态偏移 (未过单回合 cap).
   *
   * V2026-11-03 治本 (WP26 · P2-12): cap 管的是"**一回合总 delta**", 不管 delta
   * 来自事件还是剧本 —— 所以剧本这一份必须能被会话层取走, 与事件 delta 合并后
   * 统一过一次 cap. 缺省 = 本轮没有叠加任何偏移 (等待轮 / 无 delta 的幕).
   *
   * 为什么是"原始": 已经过 cap 的值没法再与事件 delta 合并 —— 那等于把同一把
   * 尺子量两次, 报告里的 raw 也就不是真的 raw 了.
   */
  readonly delta?: DeltaVector;
}

/**
 * 解析修正模式的权重.
 *
 * 缺省 → DEFAULT_CORRECT_WEIGHT; 越界 (>1) → 1; 非正 → MIN_CORRECT_WEIGHT;
 * NaN / 非有限 → DEFAULT_CORRECT_WEIGHT (数值非法时回落默认, 而不是 0).
 *
 * @param raw 幕上声明的权重
 * @returns 落在 (0,1] 的有效权重
 */
export function resolveCorrectWeight(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) return DEFAULT_CORRECT_WEIGHT;
  if (raw <= 0) return MIN_CORRECT_WEIGHT;
  if (raw > 1) return 1;
  return raw;
}

/**
 * 按模式把 BDI 自由规划结果与本轮幕合成.
 *
 * @param mode 剧本模式
 * @param bdi planIntention 产出的原始 Intention
 * @param baseSnapshot transitionState 后的快照
 * @param plan planAct 产出的 ActPlan (node 为空 → 透传 BDI; enterNewAct 决定是否叠 delta)
 * @returns 合成结果
 */
export function applyTrajectory(mode: TrajectoryMode, bdi: Intention, baseSnapshot: BdiSnapshot, plan: ActPlan): TrajectoryApplication {
  const node = plan.node;
  // 无幕 (未命中 / 越过末幕 / abort) → 原样透传 BDI, 不叠任何 delta.
  if (!node) {
    return { intention: bdi, snapshot: baseSnapshot, activated: false };
  }

  const target = node.target ?? {};
  const intention =
    mode === 'weighted_correct'
      ? mergeWeighted(bdi, target, resolveCorrectWeight(node.correctWeight), node.nodeId, mode)
      : mergeOverride(bdi, target, node.nodeId, mode);

  // V2026-11-03 治本 (WP26 · P2-12): 偏移**只转换一次** ——
  //   落快照 (applyDeltaVector) 与外抛的 raw delta 用的是同一个向量, 杜绝
  //   "报出来的 raw 与真正叠上去的不是同一个数".
  const delta = plan.enterNewAct ? toDeltaVector(node.delta) : undefined;
  const snapshot = delta ? applyDeltaVector(baseSnapshot, delta) : baseSnapshot;
  return { intention, snapshot, activated: true, ...(delta ? { delta } : {}) };
}

/**
 * 幕偏移 → 内核 delta 向量 (唯一转换点).
 *
 * 维度口径与 `applyDeltaVector` 一一对应: 信念层 / 愿望层**不参与**偏移
 * (剧本改不了来访的核心信念, 那是认知演进的活).
 *
 * WP42: 同盟三维的 safety / bond 固定为 0 —— 剧本契约 (`SnapshotDelta`) 本期
 *   没有这两项, 任务单也没给剧本的同盟三维口径. 与其发明一个没依据的数,
 *   不如让它不动 (事件 delta 仍照常推进这两维).
 */
function toDeltaVector(delta: SnapshotDelta | undefined): DeltaVector | undefined {
  if (!delta) return undefined;
  return {
    trust: delta.trust ?? 0,
    safety: 0,
    bond: 0,
    verbal: delta.resistance?.verbal ?? 0,
    depth: delta.resistance?.depth ?? 0,
    style: delta.resistance?.style ?? 0,
    valence: delta.emotion?.valence ?? 0,
    arousal: delta.emotion?.arousal ?? 0,
    positive: delta.transference?.positive ?? 0,
    negative: delta.transference?.negative ?? 0,
    dependency: delta.transference?.dependency ?? 0,
  };
}

/**
 * 强覆盖合成 (force_override 与 trigger 命中共用).
 *
 * target 有值的字段替换 BDI; 未给字段保留 BDI; forbiddenBehaviors 取并集.
 */
function mergeOverride(bdi: Intention, target: TrajectoryNodeTarget, nodeId: string, mode: TrajectoryMode): Intention {
  return {
    strategy: target.strategy ?? bdi.strategy,
    emotion: mergeEmotionOverride(bdi.emotion, target.emotion),
    resistance: { ...bdi.resistance, ...target.resistance },
    transference: { ...bdi.transference, ...target.transference },
    forbiddenBehaviors: unionBehaviors(bdi.forbiddenBehaviors, target.forbiddenBehaviors),
    rationale: mergeRationale(bdi.rationale, mode, nodeId),
  };
}

/**
 * 修正合成: strategy 取 target (缺省回退 BDI), 数值按权重混合.
 *
 * 不做策略层的概率混合 (任务单 §1.2 明确留模型轨): strategy 只有一个标量策略,
 * 混合它等于让"这一轮到底做什么"不可判定.
 */
function mergeWeighted(bdi: Intention, target: TrajectoryNodeTarget, weight: number, nodeId: string, mode: TrajectoryMode): Intention {
  return {
    strategy: target.strategy ?? bdi.strategy,
    emotion: mergeEmotionWeighted(bdi.emotion, target.emotion, weight),
    resistance: {
      verbal: mixNumber(weight, target.resistance?.verbal, bdi.resistance.verbal, clamp01),
      depth: mixNumber(weight, target.resistance?.depth, bdi.resistance.depth, clamp01),
      style: mixNumber(weight, target.resistance?.style, bdi.resistance.style, clamp01),
    },
    transference: {
      positive: mixNumber(weight, target.transference?.positive, bdi.transference.positive, clamp01),
      negative: mixNumber(weight, target.transference?.negative, bdi.transference.negative, clamp01),
      dependency: mixNumber(weight, target.transference?.dependency, bdi.transference.dependency, clamp01),
    },
    forbiddenBehaviors: unionBehaviors(bdi.forbiddenBehaviors, target.forbiddenBehaviors),
    rationale: mergeRationale(bdi.rationale, mode, nodeId),
  };
}

/**
 * 强覆盖的情绪合成.
 *
 * 显式给了 label → 沿用; 否则只要动了双轴 → label 由双轴重算 (不沿用旧 label,
 * 否则会出现"valence=-0.8 但 label=hopeful"这种自相矛盾的情绪状态).
 */
function mergeEmotionOverride(base: EmotionState, target: Partial<EmotionState> | undefined): EmotionState {
  if (!target) return base;
  const valence = target.valence ?? base.valence;
  const arousal = target.arousal ?? base.arousal;
  const label = target.label ?? resolveEmotionLabel(valence, arousal);
  return { label, valence, arousal };
}

/** 修正模式下的情绪合成: 双轴按权重混合, label 随后由混合后的双轴重算. */
function mergeEmotionWeighted(base: EmotionState, target: Partial<EmotionState> | undefined, weight: number): EmotionState {
  const valence = mixNumber(weight, target?.valence, base.valence, clampValence);
  const arousal = mixNumber(weight, target?.arousal, base.arousal, clamp01);
  const label = target?.label ?? resolveEmotionLabel(valence, arousal);
  return { label, valence, arousal };
}

/**
 * 数值混合: w*target + (1-w)*base, 再 clamp.
 *
 * target 未给 → 保留 BDI 原值; target 是 NaN → 混合结果 NaN, 由 clamp 落到边界
 * (0 / valence 0), 绝不把 NaN 写进快照 (任务单 §7).
 */
function mixNumber(weight: number, target: number | undefined, base: number, clamp: (value: number) => number): number {
  if (target === undefined) return base;
  return clamp(weight * target + (1 - weight) * base);
}

/** 禁止行为取并集 (去重, 保留 BDI 原有顺序在前). */
function unionBehaviors(base: readonly string[], extra: readonly string[] | undefined): readonly string[] {
  if (!extra || extra.length === 0) return base;
  return [...new Set([...base, ...extra])];
}

/**
 * 决策理由: 保留 BDI 的推理, 追加轨迹来源.
 *
 * 为什么追加而不是替换: BDI 的 rationale 解释的是"BDI 为什么选这个策略";
 * 轨迹强覆盖后策略可能已经变了, 直接留旧理由会让督导看到与实际策略不符的解释.
 * 追加则两条都在 —— 谁改的、改成了什么, 一眼可见.
 */
function mergeRationale(base: string | undefined, mode: TrajectoryMode, nodeId: string): string {
  const note = `轨迹:${mode}/${nodeId}`;
  return base ? `${base} | ${note}` : note;
}
