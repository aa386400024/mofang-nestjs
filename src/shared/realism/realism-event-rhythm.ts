// V2026-11-21 建立 (AF-216 · R6 事件的条件分布):
//   职责: 把 R2 的"事件种类 + 总上限"推进到"停顿在哪里、有多长、改口在句中还是句缝、
//         这一轮最多几个分句"——同一角色在不同状态带得到不同的**节奏**，而不是同一套词表。
//
//   边界:
//     · 纯函数，不读 env、不写日志、不落库；
//     · 所有值都是上限/条件，不是必须发生的配额；
//     · 风险轮不安排任何表演性痕迹，安全信息优先清楚。

import type { RealismScene, RealismStateBand, VisitorVoiceRole } from './turn-shape-selector.js';

/** 停顿形态：不出现 / 短停顿 / 拉长停顿 / 断裂停顿。 */
export type RealismPauseStyle = 'none' | 'brief' | 'held' | 'broken';

/** 改口位置：不出现 / 句缝处 / 句中。 */
export type RealismRepairPosition = 'none' | 'clause_boundary' | 'mid_sentence';

/** 短答偏置：正常 / 强短答 / 碎片化。 */
export type RealismShortAnswerBias = 'normal' | 'high' | 'fragmented';

export interface RealismEventRhythm {
  readonly pauseStyle: RealismPauseStyle;
  readonly repairPosition: RealismRepairPosition;
  readonly shortAnswerBias: RealismShortAnswerBias;
  readonly maxSentences: number;
  readonly maxClauses: number;
  readonly maxPauseSpans: number;
  /** 拼进事件层 prompt 的一句条件指令；明确“在哪里发生”，不写词表。 */
  readonly conditionDirective: string;
}

/**
 * 状态化节奏。
 *
 * 关键差别:
 *   · steady：事件稀少，允许一个具体细节，最多三句；
 *   · guarded：最高短答偏置，通常一句就停，停顿短、不硬加改口；
 *   · flooded：停顿可以拉长/断裂，改口在句中，句子可碎但不整理成长段；
 *   · risk：全部归零，不让表演层压过安全信息。
 *
 * 场景只调整“最多几句”：文字消息天然可以多一条短消息；句式仍是短句。
 */
export function resolveRealismEventRhythm(input: {
  readonly role: VisitorVoiceRole;
  readonly state: RealismStateBand;
  readonly scene: RealismScene;
}): RealismEventRhythm {
  const textScene = input.scene === 'online_text';
  const sentenceBonus = textScene ? 1 : 0;

  if (input.state === 'risk') {
    return {
      pauseStyle: 'none',
      repairPosition: 'none',
      shortAnswerBias: 'normal',
      maxSentences: 2 + sentenceBonus,
      maxClauses: 2 + sentenceBonus,
      maxPauseSpans: 0,
      conditionDirective: '这一轮不安排停顿、改口、填充或半截话；安全信息先说清楚，句子短而完整。',
    };
  }

  if (input.state === 'guarded') {
    return {
      pauseStyle: 'brief',
      repairPosition: 'none',
      shortAnswerBias: 'high',
      maxSentences: 1 + sentenceBonus,
      maxClauses: 2 + sentenceBonus,
      maxPauseSpans: 1,
      conditionDirective:
        '节奏条件：停顿只在第一个短句后出现一次，用一组省略号；不要为了像真人硬加改口；这一轮最多两个分句、一句就停，能一句说完不拆两句。',
    };
  }

  if (input.state === 'flooded') {
    return {
      pauseStyle: input.role === 'chaotic_disorganized' ? 'broken' : 'held',
      repairPosition: 'mid_sentence',
      shortAnswerBias: 'fragmented',
      maxSentences: 2 + sentenceBonus,
      maxClauses: 2 + sentenceBonus,
      maxPauseSpans: 2,
      conditionDirective:
        '节奏条件：这一轮必须在第一个短句后写一次「…………」（连续四个省略号），只写一次；不要把停顿写成两个「……」。改口只允许在说到一半时用「不对，我是说」，不要放在句首。这一轮最多两个分句、两句；可以碎，但不要把碎片整理成完整故事。',
    };
  }

  return {
    pauseStyle: 'brief',
    repairPosition: 'clause_boundary',
    shortAnswerBias: 'normal',
    maxSentences: 2 + sentenceBonus,
    maxClauses: 3 + sentenceBonus,
    maxPauseSpans: 1,
    conditionDirective:
      '节奏条件：停顿一次就够，用一组省略号；改口放在逗号或句号后的句缝处；这一轮最多三个分句、两句，可以补一个具体细节，但不要铺开讲。',
  };
}
