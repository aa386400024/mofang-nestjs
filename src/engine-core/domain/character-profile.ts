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
//
// V2026-11-04 WP41 (引擎内核 · 表达风格三字段):
//   WP10A 在 DB `character_profiles` 里预留了 3 列 (话量基线 / 叙事风格 / 语态倾向),
//   但从 DB 到渲染 prompt 这条路是**断的** —— 内核里没有这 3 个字段, 适配层没读,
//   渲染层没消费. 本文件的扩展: `CharacterProfile` 顶层加 3 个**可选**字段.
//
//   为什么它们是**角色固有属性** (与 attachmentStyle / personalityTraits 同性质):
//     说话条理与否、语气克制与否, 是"这个人一贯的样子" —— 不随这一轮的阻抗变化.
//     所以它们住**顶层**, 不进 `baseline` (那是"开场时的数值状态": trust / 阻抗 /
//     情绪 / 移情 / safety / bond).
//
//   为什么话量基线与 verbal 阻抗**正交** (不合成一个维度):
//     verbal 阻抗是"此刻不信任、不愿暴露"; 话量基线是"气质上的话多话少".
//     两者可以反向 —— 话多但不愿说 (防御性沉默), 话少但很能说 (气质性沉默).
//     合成一个维度会把两种人混成同一种 (任务单 §1.1 的原话).
//
//   为什么是**可选**:
//     缺省 = 不传 = 渲染层不做基线修正 / 不渲染风格行 = 行为与 WP35 **逐字一致**
//     (零回归). 与 trust / attachmentStyle / personalityTraits 同一范式.
//
//   ⚠️ 数值与取值档位是**工程种子值, 非临床标定** —— 待真实对练校准.

import type { BdiResistance } from './bdi-snapshot.js';
import type { CoreBelief } from './beliefs.js';
import type { EmotionState } from './emotion.js';
import type { TransferenceState } from './transference.js';

/** 依恋风格 (压力下的关系模式). */
export type AttachmentStyle = 'secure' | 'anxious' | 'avoidant' | 'disorganized';

/**
 * 叙事逻辑风格 (WP41 · 表达风格).
 *
 * - structured   —— 条理清晰 / 时间线明确;
 * - disorganized —— 话题跳跃 / 想到哪说到哪;
 * - mixed        —— 兼有 (默认档).
 *
 * 为什么用字符串联合而非 enum: 与内核既有的判别式同一范式 (纯控制流, 零运行时导出).
 */
export type CharacterNarrativeStyle = 'structured' | 'disorganized' | 'mixed';

/**
 * 语态倾向 (WP41 · 表达风格).
 *
 * - restrained          —— 克制内敛 / 情绪平淡 (默认档);
 * - emotional           —— 情绪化宣泄 / 语句破碎;
 * - intellectualizing   —— 理智化隔离 / 讲道理 / 自我分析;
 * - passive_aggressive  —— 被动攻击 / 言语带刺 / 表面顺从实则抵触.
 */
export type CharacterExpressionTone = 'restrained' | 'emotional' | 'intellectualizing' | 'passive_aggressive';

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
  /**
   * 话量基线 [0,1] (WP41 · 表达风格).
   *
   * "这个人天生话多话少": 0 = 极沉默 / 长停顿, 0.5 = 中位, 1 = 絮叨 / 长篇大论.
   *
   * 与 `baseline.resistance.verbal` **正交** —— 一个是"此刻不愿暴露", 一个是
   * "气质上的话多话少"; 两者反向时 (话多但不愿说 / 话少但很能说) 说的是两种人.
   *
   * 缺省 = 不传 = 渲染层不做基线修正 = 话量判定与 WP35 逐字一致.
   */
  readonly speechVolumeBaseline?: number;
  /** 叙事逻辑风格 (WP41 · 表达风格; 缺省 = 不渲染叙事那一行). */
  readonly narrativeStyle?: CharacterNarrativeStyle;
  /** 语态倾向 (WP41 · 表达风格; 缺省 = 不渲染语态那一行). */
  readonly expressionTone?: CharacterExpressionTone;
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
