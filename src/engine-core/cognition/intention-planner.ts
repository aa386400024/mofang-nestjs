// V2026-10-28 WP1 (引擎内核 · 意图规划器):
//   职责: 从迁移后的状态选一个主导行为策略, 组装本轮 Intention (五字段).
//   边界: 纯函数, 无随机. 规则轨只选状态可判定的策略; request / insight /
//         discussing_plans 等依赖来访侧信号的策略本期留类型不主动选出 (模型轨填充).
//
// V2026-11-03 WP42 (咨询同盟三维):
//   决策从"只看 trust"改成"看同盟三维".
//
//   为什么:
//     旧口径把"信任" / "安全感" / "纽带感"混成一个 trust —— 于是"相信你专业但
//     不敢说真话"这种来访, 与"真的信任你"被当成同一种状态, 一律进探索模式.
//     临床上前者需要的是"降低压力", 不是"追问到底".
//
//   两个口径的落点:
//     · 探索门槛: `min(trust, safety) >= open` —— 信任与安全感**都**够才敢探索.
//       纽带感 (bond) 不进门槛: 纽带是"关系深度"的刻度, 不是"敢不敢说话"的刻度 ——
//       一个来访完全可以还没产生情感连接, 但已经足够安全 (这正是安全型来访的路径).
//     · 抗拒触发: `trust < resistanceTrust || safety < resistanceSafety` ——
//       任一维度塌到低位即倾向抗拒.
//
//   ⚠️ 抗拒分支**保留了原有的整体防御聚合前提** (`aggregate >= HIGH_RESISTANCE_AGG`):
//     那一项管的是"阻抗三维整体是不是很高", 与信任无关, 是三维化之外的独立条件.
//     去掉它, 默认基线 (trust=0.3 < 0.4) 的全新会话会**每轮都进抗拒模式** ——
//     那是把"三维化"变成"行为大改", 不是本 WP 要做的事.
//
//   门槛值走**端口** (AllianceConfig.thresholds, 见 cognition/alliance-config.ts):
//     门槛是部署形态的决定 (内测期按真实对练校准), 不该写死在算子里.
//     缺省 = 内核种子值 (open 0.6 / resistanceTrust 0.4 / resistanceSafety 0.3
//     / openDepth 0.35).
//
//   V2026-11-12 S-1 (探索深度门槛端口化):
//     探索分支的第二个条件原先是本文件内的局部常量 `LOW_DEPTH = 0.35`, 与另外三个
//     同盟门槛不同构 (按角色 / 会话配不动). 本次把它并入端口字段
//     `thresholds.openDepth` —— **种子值逐字不变**, 缺省路径的判定结果与改造前
//     完全一致 (零行为变化); 只是让深度门槛从此可被同一条注入通道配置.
//
//   AF-315 (2026-11-22 · 决策敏感性与临床校准):
//     8 场 20 轮调试 trace 显示：trust 能到 0.9，safety 却卡在 0.4，探索门槛
//     `min(trust, safety) >= 0.6` 几乎不可达，策略长期锁死在 `recounting`。
//     本轮把决策带宽扩到 BDI 的其余状态：
//       ① 首轮禁止深度探索（`explorationMinTurn`，缺省 2）；
//       ② 核心信念激活高且安全感不足时抑制探索（`coreActivationGate` /
//          `coreActivationSafetyGate`）；
//       ③ 负移情主导 → 抗拒；依赖移情高 → 请求；
//       ④ 底层愿望 `avoid_pain` 压过 `understood` 时抑制探索，`understood` 高时
//          小幅下调探索门槛。
//     所有新输入都来自快照，不给规则轨引入随机或来访侧幻觉信号。

import { resolveAllianceThresholds, type AllianceConfig } from './alliance-config.js';
import type { BdiSnapshot } from '../domain/bdi-snapshot.js';
import type { CharacterProfile } from '../domain/character-profile.js';
import type { BehaviorStrategy, Intention, IntentionLock } from '../domain/intention.js';

/**
 * 意图锁配置 (AF-349).
 *
 * ⚠️ 缺省 **关闭** —— 不开启时 `planIntention` 与改造前逐字一致.
 *   是否开启属于批次决策, 本单只落机制.
 */
export interface IntentionLockConfig {
  readonly enabled: boolean;
  /** 锁存活轮数 (从锁定的那一轮起算). */
  readonly ttlTurns: number;
}

/** 缺省: 关闭 + 3 轮. */
export const DEFAULT_INTENTION_LOCK_CONFIG: IntentionLockConfig = {
  enabled: false,
  ttlTurns: 3,
};

/** 保护性策略: 当轮风险 / 情境决定, 永远可以覆盖上一轮的锁. */
const PROTECTIVE_STRATEGIES: ReadonlySet<BehaviorStrategy> = new Set(['resistance', 'simple_response', 'request']);

/** 可被锁定的连续性策略: 探索 / 叙述 / 领悟 / 计划. */
const LOCKABLE_STRATEGIES: ReadonlySet<BehaviorStrategy> = new Set([
  'recounting',
  'cognitive_exploration',
  'affective_exploration',
  'insight',
  'discussing_plans',
]);

/** 策略是否保护性 (不能被锁覆盖). */
export function isProtectiveStrategy(strategy: BehaviorStrategy): boolean {
  return PROTECTIVE_STRATEGIES.has(strategy);
}

/**
 * 计算本轮生效的意图锁 (纯函数).
 *
 * 返回 undefined 表示: 没开 / 没锁 / 已到期 / 锁的是保护性策略 (不合法).
 */
export function resolveActiveIntentionLock(
  lock: IntentionLock | null | undefined,
  turnNumber: number,
  config: IntentionLockConfig = DEFAULT_INTENTION_LOCK_CONFIG,
): IntentionLock | undefined {
  if (!config.enabled || !lock) return undefined;
  if (!LOCKABLE_STRATEGIES.has(lock.strategy)) return undefined;
  if (lock.expiresAtTurn !== undefined && turnNumber > lock.expiresAtTurn) return undefined;
  return lock;
}

/**
 * 计算本轮结束后的意图锁 (纯函数).
 *
 * 规则:
 *   · 保护性策略 / 到期 → 清锁 (null);
 *   · 本轮策略可锁且当前无锁 → 新建锁 (lockedAtTurn = 本轮, expiresAtTurn = 本轮 + ttl);
 *   · 本轮策略可锁且当前锁仍有效 → 保持原锁 (不刷新到期, 防止无限续锁);
 *   · 本轮策略不可锁 (如 simple_response 以外未知) → 清锁.
 */
export function nextIntentionLock(
  current: IntentionLock | null | undefined,
  strategy: BehaviorStrategy,
  turnNumber: number,
  config: IntentionLockConfig = DEFAULT_INTENTION_LOCK_CONFIG,
): IntentionLock | null {
  if (!config.enabled) return current ?? null;
  const active = resolveActiveIntentionLock(current, turnNumber, config);
  if (isProtectiveStrategy(strategy)) return null;
  if (!LOCKABLE_STRATEGIES.has(strategy)) return null;
  if (active) return active;
  return {
    strategy,
    lockedAtTurn: turnNumber,
    expiresAtTurn: turnNumber + Math.max(1, config.ttlTurns),
    reason: 'continuity',
  };
}

// AF-354 (2026-11-23 · 决策阈值端口化):
//   本文件原先残留 12 个局部常量（阻抗聚合 / 话量 / 负移情 / 依赖 / 回避边际 /
//   探索下调双门槛与幅度 / 情境请求 / 掌控计划 / 自发信念置信度）。它们都是
//   "部署形态"的调参决定，与 open / openDepth 同构，统一并入
//   `AllianceConfig.thresholds`。缺省值逐字等于原常量 —— 零行为变化。
//   ⚠️ 数值仍是工程种子，不是临床标定；本单只打通配置通道，不做标定.

/**
 * 决策信号快照 (AF-315).
 *
 * 把“从快照里读出哪些量、以及这些量之间的大小关系”集中在一处计算，
 * 让 `planIntention` 只负责选策略 —— 否则单函数条件过多，规则难审、难测。
 */
interface DecisionSignals {
  readonly aggregate: number;
  readonly allianceGate: number;
  readonly allianceLow: boolean;
  readonly turnNumber: number;
  readonly turnTooEarly: boolean;
  readonly activationPeak: number;
  readonly activationBlocksExploration: boolean;
  readonly negativeDominant: boolean;
  readonly dependencyHigh: boolean;
  readonly understoodWeight: number;
  readonly acceptedWeight: number;
  readonly avoidPainWeight: number;
  readonly avoidanceDominant: boolean;
  readonly explorationGate: number;
  readonly situationalPriority: number;
  readonly controlWeight: number;
  readonly reflectiveBeliefCount: number;
  readonly lateStageEligible: boolean;
}

/** 从快照与门槛推导本轮全部决策信号 (纯函数, 无随机). */
function deriveDecisionSignals(
  snapshot: BdiSnapshot,
  thresholds: ReturnType<typeof resolveAllianceThresholds>,
  turnNumber: number,
): DecisionSignals {
  const { verbal, depth, style } = snapshot.resistance;
  const aggregate = (verbal + depth + style) / 3;
  // WP42: 探索门槛取信任与安全感的**较小者** —— 短板决定能不能探索.
  const allianceGate = Math.min(snapshot.trust, snapshot.safety);
  // WP42: 抗拒触发 —— 信任或安全感任一塌到低位即算.
  const allianceLow = snapshot.trust < thresholds.resistanceTrust || snapshot.safety < thresholds.resistanceSafety;
  const turnTooEarly = turnNumber < thresholds.explorationMinTurn;
  // AF-315: 核心信念激活峰值 —— 只读快照，不新增来访侧信号。
  const activationPeak = Object.values(snapshot.coreBeliefActivation).reduce((max, value) => Math.max(max, value), 0);
  const activationBlocksExploration = activationPeak >= thresholds.coreActivationGate && allianceGate < thresholds.coreActivationSafetyGate;
  // AF-315: 移情进入决策。负移情主导 = 对咨询师的不满 / 敌意投射已经压过好感。
  const negativeDominant =
    snapshot.transference.negative >= thresholds.negativeDominantFloor &&
    snapshot.transference.negative >= snapshot.transference.positive + thresholds.negativeDominantMargin;
  const dependencyHigh = snapshot.transference.dependency >= thresholds.dependencyHigh;
  // AF-315: 愿望层。`avoid_pain` 明显压过“被理解”时，先保护自己，不往深处走。
  const understoodWeight = snapshot.underlyingDesires.find((desire) => desire.key === 'understood')?.currentWeight ?? 0;
  const acceptedWeight = snapshot.underlyingDesires.find((desire) => desire.key === 'accepted')?.currentWeight ?? 0;
  const avoidPainWeight = snapshot.underlyingDesires.find((desire) => desire.key === 'avoid_pain')?.currentWeight ?? 0;
  const avoidanceDominant = avoidPainWeight - Math.max(understoodWeight, acceptedWeight) > thresholds.avoidanceMargin;
  // AF-322: 被理解与被接纳是两个独立信号，二者都高才下调探索门槛；
  //   用平均值近似会把“只被理解、尚未被接纳”误判成可以更深探索。
  const explorationGate =
    understoodWeight >= thresholds.explorationUnderstoodGate && acceptedWeight >= thresholds.explorationAcceptedGate
      ? Math.max(0, thresholds.open - thresholds.explorationGateRelief)
      : thresholds.open;
  // AF-315: 情境愿望有明确高优先级诉求时，先回应具体请求 (规则轨不解析文本)。
  const situationalPriority = snapshot.situationalDesires
    .filter((desire) => desire.active)
    .reduce((max, desire) => Math.max(max, desire.priority), 0);
  // AF-322: 整合领悟的前提是来访已经自发形成一条较高置信度的短期信念。
  const reflectiveBeliefCount = snapshot.temporaryBeliefs.filter(
    (belief) => belief.source === 'observed' && belief.confidence >= thresholds.reflectiveBeliefGate,
  ).length;
  const controlWeight = snapshot.underlyingDesires.find((desire) => desire.key === 'control')?.currentWeight ?? 0;
  // 直接调用方不传轮次时保持 AF-315 之前的策略边界；后段策略只在引擎显式给轮次时启用。
  const lateStageEligible = Number.isFinite(turnNumber);
  return {
    aggregate,
    allianceGate,
    allianceLow,
    turnNumber,
    turnTooEarly,
    activationPeak,
    activationBlocksExploration,
    negativeDominant,
    dependencyHigh,
    understoodWeight,
    acceptedWeight,
    avoidPainWeight,
    avoidanceDominant,
    explorationGate,
    situationalPriority,
    controlWeight,
    reflectiveBeliefCount,
    lateStageEligible,
  };
}

/** 策略选择结果. */
interface SelectedStrategy {
  strategy: BehaviorStrategy;
  rationale: string;
}

/**
 * 保护性策略：防御 / 负移情 / 话量 / 依赖 / 情境诉求，优先级高于探索与后段策略。
 *
 * @param snapshot 当前快照
 * @param signals 决策信号
 * @param thresholds 已解析门槛
 * @returns 命中策略；undefined = 继续走探索判断
 */
function pickProtectiveStrategy(
  snapshot: BdiSnapshot,
  signals: DecisionSignals,
  thresholds: ReturnType<typeof resolveAllianceThresholds>,
): SelectedStrategy | undefined {
  const { verbal } = snapshot.resistance;
  const { aggregate, allianceLow, negativeDominant, dependencyHigh, turnNumber, situationalPriority } = signals;

  if (aggregate >= thresholds.highResistanceAgg && allianceLow) {
    return {
      strategy: 'resistance',
      rationale: `整体防御强(agg=${aggregate.toFixed(2)})且信任/安全感偏低(trust=${snapshot.trust.toFixed(2)}, safety=${snapshot.safety.toFixed(2)}), 倾向抗拒`,
    };
  }
  if (negativeDominant) {
    return {
      strategy: 'resistance',
      rationale: `负移情主导(negative=${snapshot.transference.negative.toFixed(2)}, positive=${snapshot.transference.positive.toFixed(2)}), 对咨询师的不满先以抗拒表达`,
    };
  }
  if (verbal >= thresholds.highVerbal) {
    return { strategy: 'simple_response', rationale: `话量阻抗高(${verbal.toFixed(2)}), 倾向简短回应` };
  }
  if (dependencyHigh && turnNumber >= thresholds.explorationMinTurn) {
    return {
      strategy: 'request',
      rationale: `依赖移情高(dependency=${snapshot.transference.dependency.toFixed(2)}), 先回应具体请求而不是继续探索`,
    };
  }
  if (situationalPriority >= thresholds.situationalRequestPriority) {
    return { strategy: 'request', rationale: `情境愿望优先级高(${situationalPriority.toFixed(2)}), 先回应来访本轮具体诉求` };
  }
  return undefined;
}

/**
 * 后段策略：整合领悟 / 讨论计划。
 *
 * 只在引擎显式给轮次时启用；`discussing_plans` 优先于 `insight` ——
 * 掌控型愿望已升高时继续“领悟”会拖住行动。
 *
 * @param snapshot 当前快照
 * @param signals 决策信号
 * @param thresholds 已解析门槛
 * @returns 命中策略；undefined = 未满足后段条件
 */
function pickLateStageStrategy(
  snapshot: BdiSnapshot,
  signals: DecisionSignals,
  thresholds: ReturnType<typeof resolveAllianceThresholds>,
): SelectedStrategy | undefined {
  const { depth } = snapshot.resistance;
  const {
    lateStageEligible,
    turnNumber,
    controlWeight,
    reflectiveBeliefCount,
    allianceGate,
    explorationGate,
    activationBlocksExploration,
    avoidanceDominant,
  } = signals;

  if (
    !lateStageEligible ||
    allianceGate < explorationGate ||
    depth >= thresholds.openDepth ||
    activationBlocksExploration ||
    avoidanceDominant
  ) {
    return undefined;
  }
  if (turnNumber >= thresholds.planMinTurn && controlWeight >= thresholds.controlPlanGate) {
    return {
      strategy: 'discussing_plans',
      rationale: `第 ${turnNumber} 轮且掌控愿望权重达 ${controlWeight.toFixed(2)}，同盟稳定(min=${allianceGate.toFixed(2)}, gate=${explorationGate.toFixed(2)})，进入计划讨论`,
    };
  }
  if (turnNumber >= thresholds.insightMinTurn && reflectiveBeliefCount > 0) {
    return {
      strategy: 'insight',
      rationale: `第 ${turnNumber} 轮、同盟稳定(min=${allianceGate.toFixed(2)}, gate=${explorationGate.toFixed(2)})且来访已有 ${reflectiveBeliefCount} 条自发信念(confidence>=0.60)，进入整合领悟`,
    };
  }
  return undefined;
}

/** 按优先级选策略与解释 (纯函数, 无副作用). */
function selectStrategy(
  snapshot: BdiSnapshot,
  signals: DecisionSignals,
  thresholds: ReturnType<typeof resolveAllianceThresholds>,
): SelectedStrategy {
  const { depth } = snapshot.resistance;
  const {
    allianceGate,
    turnNumber,
    turnTooEarly,
    activationPeak,
    activationBlocksExploration,
    understoodWeight,
    avoidPainWeight,
    avoidanceDominant,
    explorationGate,
  } = signals;

  const protective = pickProtectiveStrategy(snapshot, signals, thresholds);
  if (protective) return protective;
  const lateStage = pickLateStageStrategy(snapshot, signals, thresholds);
  if (lateStage) return lateStage;

  if (
    allianceGate >= explorationGate &&
    depth < thresholds.openDepth &&
    !turnTooEarly &&
    !activationBlocksExploration &&
    !avoidanceDominant
  ) {
    return {
      strategy: snapshot.emotion.valence < 0 ? 'affective_exploration' : 'cognitive_exploration',
      rationale: `信任与安全感均达探索门槛(min=${allianceGate.toFixed(2)}, gate=${explorationGate.toFixed(2)}, trust=${snapshot.trust.toFixed(2)}, safety=${snapshot.safety.toFixed(2)})且深度阻抗低(${depth.toFixed(2)}), 进入探索`,
    };
  }
  if (activationBlocksExploration) {
    return {
      strategy: 'recounting',
      rationale: `核心信念激活高(peak=${activationPeak.toFixed(2)})且安全感不足(safety=${snapshot.safety.toFixed(2)}), 先承接痛处, 暂不探索`,
    };
  }
  if (turnTooEarly && allianceGate >= explorationGate) {
    return { strategy: 'recounting', rationale: `第 ${turnNumber} 轮仍处于建立接触阶段, 暂不进入深度探索` };
  }
  if (avoidanceDominant) {
    return {
      strategy: 'recounting',
      rationale: `回避痛苦(${avoidPainWeight.toFixed(2)})压过被理解(${understoodWeight.toFixed(2)}), 先维持安全叙述, 不向痛处推进`,
    };
  }
  return { strategy: 'recounting', rationale: '默认叙述事实, 尚未进入探索' };
}

/**
 * 规划本轮意图. 阈值为集中常量, 便于后期调参.
 * @param snapshot 迁移后的最新快照
 * @param profile 角色内核 (仅取禁止行为透传)
 * @param alliance 同盟三维端口 (缺省 = 内核种子门槛)
 * @param context 轮次上下文 (AF-315; 缺省 = 不启用首轮抑制, 保持直接调用方的旧行为)
 */
export function planIntention(
  snapshot: BdiSnapshot,
  profile?: CharacterProfile,
  alliance?: AllianceConfig,
  context?: { readonly turnNumber?: number; readonly intentionLockConfig?: IntentionLockConfig },
): Intention {
  const thresholds = resolveAllianceThresholds(alliance);
  // AF-315: 轮次门槛. 缺省用 +∞ = 不做首轮抑制，保持既有直接调用方的行为；
  //   引擎会话会显式传 1 起轮次号。
  const turnNumber = context?.turnNumber ?? Number.POSITIVE_INFINITY;
  const signals = deriveDecisionSignals(snapshot, thresholds, turnNumber);
  const selected = selectStrategy(snapshot, signals, thresholds);
  const activeLock = resolveActiveIntentionLock(
    snapshot.intentionLock,
    turnNumber,
    context?.intentionLockConfig ?? DEFAULT_INTENTION_LOCK_CONFIG,
  );
  // AF-349: 锁只能覆盖**非保护性**当轮策略. 一旦本轮判出抗拒 / 简短回应 / 请求,
  //   保护性优先 —— 否则"上一轮锁 exploration"会把危机反应顶掉.
  const locked =
    activeLock && !isProtectiveStrategy(selected.strategy) && activeLock.strategy !== selected.strategy ? activeLock : undefined;
  const finalSelected = locked
    ? {
        strategy: locked.strategy,
        rationale: `跨轮意图锁有效(自第 ${locked.lockedAtTurn} 轮, 至第 ${locked.expiresAtTurn ?? '∞'} 轮), 保持 ${locked.strategy}; 当轮规则原判 ${selected.strategy} 被锁覆盖`,
      }
    : selected;

  return {
    strategy: finalSelected.strategy,
    emotion: snapshot.emotion,
    resistance: snapshot.resistance,
    transference: snapshot.transference,
    forbiddenBehaviors: profile?.forbiddenBehaviors ?? [],
    rationale: finalSelected.rationale,
  };
}
