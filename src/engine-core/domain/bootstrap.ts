// V2026-10-28 WP1 (引擎内核 · 初始状态装配):
//   职责: 全新会话开场时, 把可选的角色 profile 装配成一份初始 BdiSnapshot;
//         无 profile 时回落到中性默认基线. 跨会话接续不走这里 (直接搬上一场快照).
//   边界: 纯 TS, 无 I/O, 无随机, 可复现.
//
// V2026-11-04 WP51 (引擎内核 · 角色种子同盟三维基线):
//   WP42 把同盟拆成 trust / safety / bond 三维后, safety / bond 的开场值一直是
//   **硬编码的默认值** (0.5 / 0) —— 所有角色开场一模一样, 依恋风格的差异没落地.
//   WP42 当时的理由是"角色种子里没有这两项, 硬造一个'依恋型起始安全感更高'就是
//   发明临床数字" —— 现在角色种子**自己有了**这两个字段 (WP51), 于是开场值改从
//   `profile.baseline` 读.
//
//   为什么回退仍住在**内核这一处**:
//     适配层只负责"种子说了什么就传什么", 不做二次兜底 ——
//     内核 `?? DEFAULT_SAFETY` 是唯一的回退口径. 适配层若也兜一份, 就出现
//     "内核兜 0.5 / 适配层兜 0.5"两个真相源, 改一处漏一处 (反双胞胎纪律).
//
//   缺省 = 不传 = 用默认值 = 行为与 WP42 **逐字一致** (零回归).

import type { BdiResistance, BdiSnapshot } from './bdi-snapshot.js';
import type { CoreBelief, CoreBeliefActivation, MemoryBelief, TemporaryBelief } from './beliefs.js';
import type { CharacterProfile, UnderlyingDesireSeed } from './character-profile.js';
import { DEFAULT_UNDERLYING_DESIRES, type SituationalDesire, type UnderlyingDesire } from './desires.js';
import { clamp01, clampValence, resolveEmotionLabel, type EmotionState } from './emotion.js';
import { DEFAULT_TRANSFERENCE, type TransferenceState } from './transference.js';

/** 中性默认信任基线 (初识谨慎, 非全然冷漠). */
export const DEFAULT_TRUST = 0.3;

/**
 * 中性默认安全感基线 (WP42).
 *
 * 0.5 的口径: 陌生咨询师面前, 来访**不敢**敞开心扉, 但也不是完全防备 ——
 *   正是"trust 0.3 但 safety 0.5"这种开局, 让 WP42 的三维决策有意义:
 *   安全感高于信任, 说明"我还不确定你是不是专业的, 但我愿意先试试".
 *   安全感的初始值比信任高, 也符合临床上"安全感是关系的即时感受, 信任是累积出来的".
 */
export const DEFAULT_SAFETY = 0.5;

/**
 * 中性默认纽带感基线 (WP42).
 *
 * 0 的口径: 纽带感是**情感连接**, 开场时不存在 ——
 *   它只能靠共情 / 接纳 / 肯定一轮轮长出来, 不能预设.
 */
export const DEFAULT_BOND = 0;

/** 中性默认三维阻抗基线. */
export const DEFAULT_RESISTANCE: BdiResistance = { verbal: 0.4, depth: 0.4, style: 0.35 };

/** 中性默认情绪基线: 平静、低唤醒、零效价. */
export const DEFAULT_EMOTION: EmotionState = { label: 'neutral', valence: 0, arousal: 0.3 };

function seedToDesire(seed: UnderlyingDesireSeed): UnderlyingDesire {
  const baselineWeight = clamp01(seed.baselineWeight);
  return { key: seed.key, label: seed.label, baselineWeight, currentWeight: baselineWeight };
}

/** 装配三维阻抗基线: 逐维取 profile 值, 缺省回落默认, 统一 clamp 到 [0,1]. */
function buildResistance(profile: CharacterProfile | undefined): BdiResistance {
  const source = profile?.baseline?.resistance;
  return {
    verbal: clamp01(source?.verbal ?? DEFAULT_RESISTANCE.verbal),
    depth: clamp01(source?.depth ?? DEFAULT_RESISTANCE.depth),
    style: clamp01(source?.style ?? DEFAULT_RESISTANCE.style),
  };
}

/** 装配情绪基线: label 由双轴数值确定性推导, 不采信外部自由标签. */
function buildEmotion(profile: CharacterProfile | undefined): EmotionState {
  const source = profile?.baseline?.emotion;
  const valence = clampValence(source?.valence ?? DEFAULT_EMOTION.valence);
  const arousal = clamp01(source?.arousal ?? DEFAULT_EMOTION.arousal);
  return { label: resolveEmotionLabel(valence, arousal), valence, arousal };
}

/** 装配移情基线: 正/负/依赖三态独立取值, 缺省回落全零. */
function buildTransference(profile: CharacterProfile | undefined): TransferenceState {
  const source = profile?.baseline?.transference;
  return {
    positive: clamp01(source?.positive ?? DEFAULT_TRANSFERENCE.positive),
    negative: clamp01(source?.negative ?? DEFAULT_TRANSFERENCE.negative),
    dependency: clamp01(source?.dependency ?? DEFAULT_TRANSFERENCE.dependency),
  };
}

/**
 * 装配初始快照. 仅用于"全新会话"分支; resume 接续由调用方直接搬上一场快照.
 * @param profile 可选角色内核; 缺省字段全部回落到中性默认基线.
 */
export function buildInitialSnapshot(profile?: CharacterProfile): BdiSnapshot {
  // 核心信念拷贝一层, 避免装配结果与外部 profile 共享可变引用 (值语义).
  const coreBeliefs: readonly CoreBelief[] = (profile?.coreBeliefs ?? []).map((b) => ({
    ...b,
    activationTags: [...b.activationTags],
  }));
  const temporaryBeliefs: readonly TemporaryBelief[] = [];
  const memoryBeliefs: readonly MemoryBelief[] = [];
  // WP57: 核心信念的激活强度初始全为 0 (还没被激活过).
  //   同一 theme 出现多次时共享同一个键 (角色配置的责任, 引擎不校验) —— 与算子的
  //   "同 theme 的信念共享一份激活强度"口径一致 (见 state-transition.ts).
  const coreBeliefActivation: CoreBeliefActivation = Object.fromEntries(coreBeliefs.map((b) => [b.theme, 0]));
  const underlyingDesires: readonly UnderlyingDesire[] =
    profile?.underlyingDesires?.map(seedToDesire) ??
    // 默认种子也要拷贝, 避免多次装配共享同一份常量数组 (值语义, 防污染全局).
    DEFAULT_UNDERLYING_DESIRES.map((d) => ({ ...d }));
  const situationalDesires: readonly SituationalDesire[] = [];

  return {
    coreBeliefs,
    coreBeliefActivation,
    temporaryBeliefs,
    memoryBeliefs,
    underlyingDesires,
    situationalDesires,
    emotion: buildEmotion(profile),
    resistance: buildResistance(profile),
    transference: buildTransference(profile),
    trust: clamp01(profile?.baseline?.trust ?? DEFAULT_TRUST),
    // WP51: 安全感 / 纽带感从**角色基线**读, 缺省用内核默认值 (零回归).
    //   角色种子给了就用角色的, 没给就用 DEFAULT_SAFETY / DEFAULT_BOND ——
    //   回退逻辑住在**内核这一处**, 适配层不做二次兜底 (免得两个真相源漂移).
    safety: clamp01(profile?.baseline?.safety ?? DEFAULT_SAFETY),
    bond: clamp01(profile?.baseline?.bond ?? DEFAULT_BOND),
  };
}
