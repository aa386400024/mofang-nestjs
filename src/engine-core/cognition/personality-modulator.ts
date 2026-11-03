// V2026-11-03 WP34 (引擎内核 · P1 人格调节算子):
//   职责: 依恋调节 + 人格特质调节 —— 让**同一个事件**在不同角色身上落出**不同的 delta**.
//   边界: 纯函数, 零 env / 零 IO / 零随机 / 零全局状态. 系数走**端口**注入
//         (内核只认端口; env 由适配层读好组装, 见 WP26 P2-14 的 DeltaCapConfig 先例).
//
//   为什么要有这一层 (任务单 §1):
//     WP1 的 trust 增量是"一刀切"的 —— 同样一句共情, 安全型与回避型涨的信任一样多.
//     蓝图把 P1 级算子的定义写成"同样共情, 安全型/回避型信任增量不同"
//     (docs/reference/bdi-cognitive-engine-principles-v1.0.md:214).
//     这是"来访从扮演变仿真"的分水岭: 角色对同一句话的反应开始**因人而异**.
//
//   两条调节方向 —— 只调"来访向靠近方向"的变化, 受损方向不调:
//     ① trust **增益** (delta.trust > 0 时乘系数).
//        蓝图原话: "回避依恋型来访, 收到共情后, 信任提升系数打 5 折, 不会快速敞开心扉"
//        (bdi-cognitive-engine-principles-v1.0.md:202).
//        信任**受损**的方向不调 —— 任务单没给系数, 不发明临床数字.
//     ② 阻抗**下降** (delta.verbal/depth/style < 0 时除以阻抗系数).
//        任务单 §3.1 的"阻抗调节"列是**水平**语义的系数 (回避型 1.3 = 阻抗更高),
//        而内核算子只算**变化量** —— 于是实现成"下降量 ÷ 系数":
//          系数 > 1 → 阻抗更难被撬动 (共情时降得少 = 不快速敞开心扉);
//          系数 < 1 → 阻抗更易被撬动 (共情时降得多 = 更敞开心扉).
//        阻抗**水平**本身 (基线) 由角色种子承担 (wp9a 已断言"回避型阻抗高于焦虑型"),
//        本算子只管**变化快慢**, 不管基线高低.
//        阻抗**上升**的方向不调 (同 ① 的理由).
//
//   调节的**位置**: 事件 delta 聚合之后、单回合 cap 之前.
//     cap 是"一回合最多动多少"的最后一道尺子 —— 调节不得绕过它.
//     剧本 (trajectory) delta **不参与**调节: 剧本是作者写死、且本就按角色分化的偏移.
//
//   边界回落 (任务单 §5 验收 #3):
//     依恋类型为空 / 未知 → 系数全 1.0 (不破坏现有角色);
//     系数非法 (非有限 / 负 / 除数为 0) → 回退内核种子值;
//     阈值非法 (不在 [0,1]) → 回退种子值.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-core/wp34-personality-modulator.spec.ts 覆盖差异化 / 回落 / 方向 / 注入
//     3. test/engine-adapters/wp34-personality-modulator-config.spec.ts 覆盖 env 组装与非法值回退

import type { DeltaVector } from './state-transition.js';
import type { AttachmentStyle, PersonalityTraits } from '../domain/character-profile.js';
import type { SessionEvent } from '../domain/events/session-event.js';

/**
 * 单个依恋类型的调节系数 (内核端口).
 *
 * 两个系数的**极性不同**, 不是笔误 —— 见文件头两条调节方向.
 */
export interface AttachmentModulation {
  /**
   * trust **增益**系数 (≥ 0).
   *
   * >1 = 信任涨得快, <1 = 涨得慢. 任务单 §3.1 种子:
   *   secure 1.0 / avoidant 0.6 / anxious 1.2 / disorganized 0.8.
   *
   * ⚠️ 只作用于**增益**方向 (delta.trust > 0). 受损方向不调 (不发明惩罚系数).
   */
  readonly trustScale: number;
  /**
   * 阻抗**水平**倍率 (> 0).
   *
   * 任务单 §3.1 种子: secure 1.0 / avoidant 1.3 / anxious 0.8 / disorganized 1.2.
   *
   * 实现口径: 阻抗**下降量 ÷ 该值** (系数越大 = 阻抗越守得住).
   * ⚠️ 只作用于**下降**方向 (delta < 0). 上升方向不调.
   */
  readonly resistanceScale: number;
}

/**
 * 人格特质调节 (任务单 §3.2: 本期只实现宜人性这一条, 其余大五特质本期不展开).
 */
export interface AgreeablenessModulation {
  /** 宜人性达标时 trust 增益系数 (≥ 0). 种子 1.1. */
  readonly trustScale: number;
  /** 宜人性阈值 [0,1]: 达到即视为"高宜人性". 种子 0.7. */
  readonly highThreshold: number;
}

/**
 * 人格调节端口 (内核只认这个对象, 不认 env).
 *
 * 缺省 = `DEFAULT_PERSONALITY_MODULATOR_CONFIG` (内核种子值), env 只做覆写.
 */
export interface PersonalityModulatorConfig {
  /** 四种依恋类型的系数表. */
  readonly attachment: Readonly<Record<AttachmentStyle, AttachmentModulation>>;
  /** 宜人性调节. */
  readonly agreeableness: AgreeablenessModulation;
}

/**
 * 内核种子值 (工程种子值, **非临床标定** —— 待真实对练校准).
 *
 * 任务单 §3.1 的四种依恋系数, 逐字照搬; 宜人性取任务单 §3.2 的示例值.
 */
export const DEFAULT_PERSONALITY_MODULATOR_CONFIG: PersonalityModulatorConfig = {
  attachment: {
    secure: { trustScale: 1, resistanceScale: 1 },
    avoidant: { trustScale: 0.6, resistanceScale: 1.3 },
    anxious: { trustScale: 1.2, resistanceScale: 0.8 },
    disorganized: { trustScale: 0.8, resistanceScale: 1.2 },
  },
  agreeableness: { trustScale: 1.1, highThreshold: 0.7 },
};

/** 中性调节 (不改变 delta): 依恋类型缺失 / 未知时的回落值. */
const NEUTRAL_ATTACHMENT: AttachmentModulation = { trustScale: 1, resistanceScale: 1 };

/**
 * 取某依恋类型的系数 (运行时安全: 表缺项 / 键非法 → undefined).
 *
 * 为什么不能直接 `table[style]`: 端口是**公开契约**, 任何人都能 new 一个残缺的配置
 * 塞进来 —— TypeScript 挡不住运行时来自 JSON / DB 的非法键.
 */
function lookupAttachment(
  table: PersonalityModulatorConfig['attachment'] | undefined,
  style: AttachmentStyle,
): AttachmentModulation | undefined {
  if (!table) return undefined;
  const found = (table as Partial<Record<AttachmentStyle, AttachmentModulation>>)[style];
  return found ?? undefined;
}

/** trust 增益系数校验 (非法 → 回退). */
function sanitizeTrustScale(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return fallback;
  return value;
}

/** 阻抗倍率校验 (非法 → 回退; 除数必须 > 0). */
function sanitizeResistanceScale(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

/** 宜人性阈值校验 (不在 [0,1] → 回退). */
function sanitizeThreshold(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 0 || value > 1) return fallback;
  return value;
}

/**
 * 解析依恋类型的有效系数.
 *
 * 回落顺序 (从"最中性"到"最具体"):
 *   依恋类型缺失 / 未知 → 中性 (×1.0, 不破坏现有角色);
 *   端口缺该项 → 内核种子值 (该依恋类型的权威默认);
 *   端口该项的系数非法 → 逐项回退内核种子值.
 */
function resolveAttachment(style: AttachmentStyle | undefined, config: PersonalityModulatorConfig): AttachmentModulation {
  if (!style) return NEUTRAL_ATTACHMENT;

  const seed = lookupAttachment(DEFAULT_PERSONALITY_MODULATOR_CONFIG.attachment, style);
  // 未知依恋类型 (运行时来自 JSON / DB 的脏值) → 中性.
  if (!seed) return NEUTRAL_ATTACHMENT;

  const provided = lookupAttachment(config.attachment, style);
  if (!provided) return seed;

  return {
    trustScale: sanitizeTrustScale(provided.trustScale, seed.trustScale),
    resistanceScale: sanitizeResistanceScale(provided.resistanceScale, seed.resistanceScale),
  };
}

/**
 * 解析宜人性带来的 trust 增益系数.
 *
 * 规则 (任务单 §3.2 的示例): 宜人性达到阈值 → 共情回合的 trust 增益 × 1.1.
 *
 * 为什么只在"含共情事件"时生效: 任务单原文是"宜人性高 → **共情回应**的 trust 增量 ×1.1".
 * 精确到"只放大共情那一条"需要逐事件 delta, 会把内核的 delta 表拆散 —— 本期是示例级
 * 精度 (任务单 §3.2 明说"先搭架子"), 放大的是**本轮**的 trust 增益.
 */
function resolveAgreeablenessTrustScale(
  traits: PersonalityTraits | undefined,
  events: readonly SessionEvent[] | undefined,
  config: PersonalityModulatorConfig,
): number {
  const value = traits?.agreeableness;
  if (value === undefined || !Number.isFinite(value)) return 1;

  const fallback = DEFAULT_PERSONALITY_MODULATOR_CONFIG.agreeableness;
  const threshold = sanitizeThreshold(config.agreeableness?.highThreshold, fallback.highThreshold);
  if (value < threshold) return 1;

  const scale = sanitizeTrustScale(config.agreeableness?.trustScale, fallback.trustScale);
  if (scale === 1) return 1;

  if (!events?.some((event) => event.kind === 'empathy')) return 1;
  return scale;
}

/**
 * 人格调节的输入 (角色侧数据 + 端口 + 本轮事件).
 *
 * 全部可缺省: 缺省 = 不做该条调节 (逐字不变).
 */
export interface PersonalityModulationInput {
  /** 角色的依恋类型 (缺省 / 未知 → 系数全 1.0). */
  readonly attachmentStyle?: AttachmentStyle;
  /** 角色的人格特质 (缺省 = 不做特质调节). */
  readonly traits?: PersonalityTraits;
  /** 本轮事件 (判定"共情回应"; 缺省 = 宜人性规则不生效). */
  readonly events?: readonly SessionEvent[];
  /** 调节端口 (缺省 = 内核种子值). */
  readonly config?: PersonalityModulatorConfig;
}

/**
 * 人格调节: 给一个 delta 向量套上角色的"人格系数".
 *
 * 纯函数: 同 delta + 同输入 → 同输出 (可复现).
 * 不改变 delta 的**维度**与**顺序**, 只改数值.
 *
 * @param delta 待调节的 delta 向量 (通常是本轮事件 delta 的聚合值)
 * @param input 人格调节输入 (角色数据 + 端口 + 本轮事件)
 * @returns 调节后的 delta 向量 (无调节时逐字等于入参)
 */
export function modulateDeltaByPersonality(delta: DeltaVector, input: PersonalityModulationInput): DeltaVector {
  const config = input.config ?? DEFAULT_PERSONALITY_MODULATOR_CONFIG;
  const attachment = resolveAttachment(input.attachmentStyle, config);
  const agreeablenessScale = resolveAgreeablenessTrustScale(input.traits, input.events, config);

  const trustScale = attachment.trustScale * agreeablenessScale;
  // 阻抗系数是**水平**倍率 → 变化量除以它 (系数越大 = 越守得住).
  const resistanceFactor = 1 / attachment.resistanceScale;

  return {
    ...delta,
    // 只调"增益"方向: 信任受损的方向保持基准速率.
    trust: delta.trust > 0 ? delta.trust * trustScale : delta.trust,
    // 只调"下降"方向: 阻抗上升的方向保持基准速率.
    verbal: delta.verbal < 0 ? delta.verbal * resistanceFactor : delta.verbal,
    depth: delta.depth < 0 ? delta.depth * resistanceFactor : delta.depth,
    style: delta.style < 0 ? delta.style * resistanceFactor : delta.style,
  };
}
