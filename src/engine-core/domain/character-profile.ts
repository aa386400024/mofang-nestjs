// V2026-10-28 WP1 (引擎内核 · 角色内核注入 schema):
//   职责: adapter 从 MySQL / persona 解析后注入的**纯角色基线**, 内核只消费这个对象,
//         不读数据库、不感知 persona 实体结构 (保持内核可整包搬走).
//   边界: 纯 TS, 零 @nestjs/* / typeorm. 缺省字段回落到中性默认基线 (见 bootstrap).

import type { BdiResistance } from './bdi-snapshot';
import type { CoreBelief } from './beliefs';
import type { EmotionState } from './emotion';
import type { TransferenceState } from './transference';

/** 依恋风格 (压力下的关系模式). */
export type AttachmentStyle = 'secure' | 'anxious' | 'avoidant' | 'disorganized';

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
