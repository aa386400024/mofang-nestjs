// V2026-10-28 WP1 (引擎内核 · 角色内核注入 schema):
//   职责: adapter 从 MySQL / persona 解析后注入的**纯角色基线**, 内核只消费这个对象,
//         不读数据库、不感知 persona 实体结构 (保持内核可整包搬走).
//   边界: 纯 TS, 零 @nestjs/* / typeorm. 缺省字段回落到中性默认基线 (见 bootstrap).
//
// V2026-11-04 WP51 (引擎内核 · 角色种子同盟三维基线):
//   WP42 把同盟拆成 trust / safety / bond 三维后, **safety / bond 的开场值一直是
//   硬编码的默认值** (0.5 / 0) —— 所有角色开场一模一样, 依恋风格的差异没落地.
//   回避型角色 (对关系很戒备) 与安全型角色开场安全感一样, 人格差异只体现在
//   trust 和阻抗上.
//
//   本文件的扩展: `baseline` 加 `safety?` / `bond?` 两个**可选**字段, 与既有的
//   `trust` 同性质 —— 都是"这个人开场时是什么状态".
//
//   为什么进 `baseline` 而不是 PersonalityModulator (任务单 §4.1):
//     基线是"这个人开场是什么状态"; 调节算子调的是"这个人对事件的反应幅度"
//     (delta × 系数). 两者是**不同的事** —— WP53 把调节算子扩到 safety / bond 后,
//     基线还是平的, 调节再准也差不了多少 (在平地上调坡度, 起点都在同一高度).
//
//   为什么是**可选**:
//     缺省 = 不传 = 用内核默认值 = 行为与 WP42 **逐字一致** (零回归).
//     与既有的 trust / resistance / emotion / transference 同一范式.
//
//   ⚠️ 数值是**工程种子值, 非临床标定** —— 内测后按真实对练校准.

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
    /**
     * 关系安全感基线 [0,1] (WP51).
     *
     * 来访在这段关系里感到安全, 可以敞开心扉.
     * 缺省 = 不传 = 用 DEFAULT_SAFETY (0.5) —— 见 bootstrap 的回退口径.
     */
    readonly safety?: number;
    /**
     * 关系联结基线 [0,1] (WP51).
     *
     * 来访与咨询师有情感连接, 不是冷冰冰的问诊.
     * 缺省 = 不传 = 用 DEFAULT_BOND (0) —— 见 bootstrap 的回退口径.
     */
    readonly bond?: number;
  };
  /** 禁止行为 (透传给本轮意图, 供 WP5 回避). */
  readonly forbiddenBehaviors: readonly string[];
  /** 敏感议题词表: 命中即 sensitive_touch 触发. */
  readonly sensitiveTopics: readonly string[];
}
