// V2026-10-28 WP1 (引擎内核 · 角色内核注入 schema):
//   职责: adapter 从 MySQL / persona 解析后注入的**纯角色基线**, 内核只消费这个对象,
//         不读数据库、不感知 persona 实体结构 (保持内核可整包搬走).
//   边界: 纯 TS, 零 @nestjs/* / typeorm. 缺省字段回落到中性默认基线 (见 bootstrap).

import type { BdiResistance } from './bdi-snapshot.js';
import type { CoreBelief } from './beliefs.js';
import type { EmotionState } from './emotion.js';
import type { TransferenceState } from './transference.js';

/** 依恋风格 (压力下的关系模式). */
export type AttachmentStyle = 'secure' | 'anxious' | 'avoidant' | 'disorganized';

/**
 * 人格特质 (大五), 归一化到 [0,1].
 *
 * WP34 只消费**宜人性** (agreeableness); 其余四项本期只是契约位 (任务单 §3.2:
 * 其余特质本期不展开, 避免 BDI 膨胀).
 *
 * ⚠️ 与 DB 里 `character_profiles.five_ps` **不是一回事**: 那是临床 5Ps
 * (易感 / 维持 / 诱发 / 保护 / 持续因素), 与大五人格是两个概念, 不要混用.
 */
export interface PersonalityTraits {
  /** 开放性 (经验开放). */
  readonly openness?: number;
  /** 尽责性. */
  readonly conscientiousness?: number;
  /** 外倾性. */
  readonly extraversion?: number;
  /** 宜人性 (共情回应的 trust 增益系数). */
  readonly agreeableness?: number;
  /** 神经质. */
  readonly neuroticism?: number;
}

/** 底层愿望种子 (装配时 currentWeight 取 baselineWeight). */
export interface UnderlyingDesireSeed {
  readonly key: string;
  readonly label: string;
  readonly baselineWeight: number;
}

/** 角色内核: 由 adapter 解析后经 openSession.characterProfile 注入. */
export interface CharacterProfile {
  /** 核心信念 (永久不可变). */
  readonly coreBeliefs: readonly CoreBelief[];
  readonly attachmentStyle?: AttachmentStyle;
  /** 人格特质 (WP34; 缺省 = 不做特质调节). */
  readonly personalityTraits?: PersonalityTraits;
  readonly underlyingDesires?: readonly UnderlyingDesireSeed[];
  /** 初始基线覆盖; 缺省字段用中性默认值. */
  readonly baseline?: {
    readonly trust?: number;
    readonly resistance?: Partial<BdiResistance>;
    readonly emotion?: Partial<EmotionState>;
    readonly transference?: Partial<TransferenceState>;
  };
  /** 禁止行为 (透传给本轮意图, 供 WP5 回避). */
  readonly forbiddenBehaviors: readonly string[];
  /** 敏感议题词表: 命中即 sensitive_touch 触发. */
  readonly sensitiveTopics: readonly string[];
}
