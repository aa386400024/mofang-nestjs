// V2026-10-28 WP1 (引擎内核 · 初始状态装配):
//   职责: 全新会话开场时, 把可选的角色 profile 装配成一份初始 BdiSnapshot;
//         无 profile 时回落到中性默认基线. 跨会话接续不走这里 (直接搬上一场快照).
//   边界: 纯 TS, 无 I/O, 无随机, 可复现.

import type { BdiResistance, BdiSnapshot } from './bdi-snapshot';
import type { CoreBelief, MemoryBelief, TemporaryBelief } from './beliefs';
import type { CharacterProfile, UnderlyingDesireSeed } from './character-profile';
import { DEFAULT_UNDERLYING_DESIRES, type SituationalDesire, type UnderlyingDesire } from './desires';
import { clamp01, clampValence, resolveEmotionLabel, type EmotionState } from './emotion';
import { DEFAULT_TRANSFERENCE, type TransferenceState } from './transference';

/** 中性默认信任基线 (初识谨慎, 非全然冷漠). */
export const DEFAULT_TRUST = 0.3;

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
  const underlyingDesires: readonly UnderlyingDesire[] =
    profile?.underlyingDesires?.map(seedToDesire) ??
    // 默认种子也要拷贝, 避免多次装配共享同一份常量数组 (值语义, 防污染全局).
    DEFAULT_UNDERLYING_DESIRES.map((d) => ({ ...d }));
  const situationalDesires: readonly SituationalDesire[] = [];

  return {
    coreBeliefs,
    temporaryBeliefs,
    memoryBeliefs,
    underlyingDesires,
    situationalDesires,
    emotion: buildEmotion(profile),
    resistance: buildResistance(profile),
    transference: buildTransference(profile),
    trust: clamp01(profile?.baseline?.trust ?? DEFAULT_TRUST),
  };
}
