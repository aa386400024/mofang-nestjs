// V2026-10-29 治本 (WP9-A · B 层 · 内置角色种子注册表):
//   职责: 本期唯一的角色数据源 —— 内置 2 个最小训练角色的**纯数据种子**, 以及
//         "角色种子 + 临场参数 → 内核 CharacterProfile" 的**确定性映射**.
//   边界: 纯数据 + 纯函数, 零 IO / 零随机 / 零 @nestjs; 不读 env、不读 DB、不调模型.
//
//   为什么本期用硬编码种子而不是先建表 (任务单 §0):
//     角色池建表 / 审核状态 / migration 是**独立一块**(WP9-B). 先用种子把
//     "角色定义 → CharacterProfile → 内核快照" 这条链打通并钉死单测, 二期接 DB
//     时只换数据源 —— 避免边建表边改装配导致返工.
//
//   为什么要"确定性映射"而不是"把种子的数值原样塞进去":
//     临场参数 (难度 / 防御水平 / 配合风格 / 情绪基线) 是**每一场都会变**的东西,
//     角色种子是"这个角色本来是什么样". 两者必须分开表达: 种子给基线, 临场参数
//     给**叠加量**. 若把临场参数直接写进种子里, 同一角色在不同临场参数下就没法
//     区分, 而且"谁改了这套基线"永远说不清.
//
//   映射口径 (任务单 §4; 数值是**工程种子值**, 非临床标定):
//     · 三维阻抗 = 种子基线 + 防御水平×权重 + 难度系数 (+ 风格对 style 的微调)
//     · 情绪 arousal 由临场 emotionBaseline 决定 (缺省用种子值); valence 由种子给
//     · emotion.label **不填** —— 由内核 resolveEmotionLabel 按双轴确定性重算
//     · trust 由种子给 (临场参数不覆盖信任 —— 信任是关系的产物, 不是旋钮)
//     · 移情固定全零 (移情随会话演化, 不在开场预设正负)
//
//   反双胞胎:
//     - 不自己写第二份 clamp01: 内核 `clamp01` 没有从公开 barrel 导出, 而本期
//       engine-core **整树零改动** —— 深路径 import 一个"没导出"的内部函数会把
//       内核的公开出口变成可有可无. 所以本层自带一个三行 clamp, 语义与内核一致
//       (NaN → 0, 越界夹取), 并在此注明.
//     - 不手填离散情绪标签: 手填 label 会让内核的 resolveEmotionLabel 与适配层
//       各说各话 (同一份双轴数值解出两个标签), 标签的**唯一真相**必须在内核.
//     - 不用随机数派生 seed: 种子是"同一角色可复现"的入口, 随机种子等于没有种子.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp9a-character-resolver.spec.ts 覆盖解析/可复现/可区分/clamp

import type {
  CharacterPresetInput,
  CharacterProfileResolver,
  CharacterResolveRequest,
  ResolvedCharacter,
} from './character-profile.resolver';
import type { AttachmentStyle, BdiResistance, CharacterProfile, CoreBelief, UnderlyingDesireSeed } from '../../../engine-core';

/**
 * 内置角色种子 (纯数据).
 *
 * 形状刻意与内核 `CharacterProfile` 分开: 种子是"角色资产"的表达 (带 key 与展示名),
 * `CharacterProfile` 是"内核基线"的表达 (数值已归一). 两者之间隔着**映射函数** ——
 * 没有映射, 种子的数值就会直接变成内核数值, 临场参数也就无处叠加.
 */
export interface BuiltinCharacterSeed {
  /** 角色 key (与公共人物模板 id 同一命名空间). */
  readonly key: string;
  /** 展示用角色名 (persona 快照 / 报告 / 日志). */
  readonly displayName: string;
  /** 依恋风格 (内核消费; 不由临场参数推导). */
  readonly attachmentStyle: AttachmentStyle;
  /** 核心信念 (第一人称; 永久不可变). */
  readonly coreBeliefs: readonly CoreBelief[];
  /** 底层愿望种子. */
  readonly underlyingDesires: readonly UnderlyingDesireSeed[];
  /** 来访者绝不会做的事 (负向约束; 透传给内核意图规划, **不作风险信号**). */
  readonly forbiddenBehaviors: readonly string[];
  /** 敏感议题词表 (命中触发 sensitive_touch 事件). */
  readonly sensitiveTopics: readonly string[];
  /** 角色自身的基线 (临场参数在这之上叠加). */
  readonly baseline: {
    /** 初始信任 [0,1]. */
    readonly trust: number;
    /** 三维阻抗基线 [0,1]. */
    readonly resistance: {
      readonly verbal: number;
      readonly depth: number;
      readonly style: number;
    };
    /** 情绪基调 (valence [-1,1] / arousal [0,1]; **不含 label**). */
    readonly emotion: {
      readonly valence: number;
      readonly arousal: number;
    };
  };
}

/**
 * 种子 1 · 回避依恋 L1.
 *
 * 低信任 + 三维阻抗偏高 + 情绪压抑空洞 (低 valence / 低 arousal);
 * 核心信念是"靠太近就会被抛下""我不需要谁".
 */
export const BUILTIN_AVOIDANT_L1: BuiltinCharacterSeed = {
  key: 'builtin_avoidant_l1',
  displayName: '回避依恋 · L1',
  attachmentStyle: 'avoidant',
  coreBeliefs: [
    { theme: 'abandonment', statement: '我要是靠得太近, 最后还是会被抛下。', activationTags: ['closeness', 'rejection'] },
    { theme: 'self_sufficiency', statement: '我不需要谁, 我自己能扛下来。', activationTags: ['help', 'dependence'] },
  ],
  underlyingDesires: [
    { key: 'autonomy', label: '保持自主与距离', baselineWeight: 0.7 },
    { key: 'security', label: '不被抛弃的安全感', baselineWeight: 0.45 },
  ],
  forbiddenBehaviors: ['主动说出自己需要帮助', '主动表达对咨询师的依赖', '给咨询师出主意'],
  sensitiveTopics: ['亲密关系', '被抛弃', '童年依赖'],
  baseline: {
    trust: 0.2,
    resistance: { verbal: 0.62, depth: 0.68, style: 0.6 },
    emotion: { valence: -0.55, arousal: 0.18 },
  },
};

/**
 * 种子 2 · 焦虑低落 L1.
 *
 * 中低信任 + 深度阻抗中位 + 情绪负向中唤醒; 核心信念是"我没什么用""表现不好就会被丢下".
 */
export const BUILTIN_ANXIOUS_LOW_MOOD_L1: BuiltinCharacterSeed = {
  key: 'builtin_anxious_low_mood_l1',
  displayName: '焦虑低落 · L1',
  attachmentStyle: 'anxious',
  coreBeliefs: [
    { theme: 'worthlessness', statement: '我没什么用, 事情也不会变好。', activationTags: ['failure', 'self_worth'] },
    { theme: 'rejection', statement: '我要是表现不好, 大家就不要我了。', activationTags: ['evaluation', 'rejection'] },
  ],
  underlyingDesires: [
    { key: 'acceptance', label: '被接纳与认可', baselineWeight: 0.72 },
    { key: 'stability', label: '情绪与生活的稳定', baselineWeight: 0.55 },
  ],
  forbiddenBehaviors: ['主动给出解决方案', '评价咨询师的水平', '承诺自己会好起来'],
  sensitiveTopics: ['失败', '自我价值', '被评价'],
  baseline: {
    trust: 0.28,
    resistance: { verbal: 0.42, depth: 0.5, style: 0.38 },
    emotion: { valence: -0.45, arousal: 0.62 },
  },
};

/**
 * 全部内置种子 (本期 2 个).
 */
export const BUILTIN_CHARACTER_SEEDS: readonly BuiltinCharacterSeed[] = [BUILTIN_AVOIDANT_L1, BUILTIN_ANXIOUS_LOW_MOOD_L1];

/**
 * 防御水平对三维阻抗的权重 (defenseLevel 1.0 → 最高 +0.35).
 */
const DEFENSE_RESISTANCE_WEIGHT = 0.35;

/**
 * 难度档对三维阻抗的加成 (越高难度, 来访者越"难被打开").
 */
const DIFFICULTY_RESISTANCE_BONUS: Readonly<Record<string, number | undefined>> = {
  L1: 0,
  L2: 0.08,
  L3: 0.16,
};

/**
 * 配合风格对**表达风格阻抗**的微调.
 *
 * 为什么只调 style 一维: 配合风格说的是"这个人此刻愿不愿意好好说话" —— 那是表达
 * 层面的事; 话量与内容深度是角色自身的结构 (回避型的人话少, 不是因为配合度低).
 */
const STYLE_RESISTANCE_ADJUST: Readonly<Record<string, number | undefined>> = {
  cooperative: -0.1,
  mixed: 0,
  defensive: 0.08,
  avoidant: 0.1,
  resistant: 0.15,
};

/**
 * 内置角色解析器 (本期唯一实现).
 *
 * 纯函数式: 同一请求 → 同一结果 (无随机、无 IO、无时钟).
 */
export class BuiltinCharacterProfileResolver implements CharacterProfileResolver {
  private readonly seeds: ReadonlyMap<string, BuiltinCharacterSeed>;

  constructor(seeds: readonly BuiltinCharacterSeed[] = BUILTIN_CHARACTER_SEEDS) {
    this.seeds = new Map(seeds.map((seed) => [seed.key, seed]));
  }

  /**
   * 解析角色.
   *
   * 查不到 → null (**不抛错**): "本场无角色"是常态, 由调用方回退中性基线.
   */
  async resolve(request: CharacterResolveRequest): Promise<ResolvedCharacter | null> {
    const key = request.templateId?.trim();
    if (!key) return null;
    const seed = this.seeds.get(key);
    if (!seed) return null;
    return {
      characterProfile: buildCharacterProfile(seed, request.preset),
      seed: stableSeedFromKey(seed.key),
      displayName: seed.displayName,
    };
  }
}

/**
 * 角色种子 + 临场参数 → 内核角色基线 (确定性映射).
 *
 * @param seed 角色种子
 * @param preset 临场参数 (可选)
 * @returns 内核 `CharacterProfile`
 */
export function buildCharacterProfile(seed: BuiltinCharacterSeed, preset?: CharacterPresetInput): CharacterProfile {
  return {
    coreBeliefs: seed.coreBeliefs.map((belief) => ({ ...belief, activationTags: [...belief.activationTags] })),
    attachmentStyle: seed.attachmentStyle,
    underlyingDesires: seed.underlyingDesires.map((desire) => ({ ...desire })),
    baseline: {
      trust: clamp01(seed.baseline.trust),
      resistance: buildResistance(seed, preset),
      // 只给双轴数值: label 由内核 resolveEmotionLabel 重算 (适配层不手填离散标签).
      emotion: buildEmotion(seed, preset),
      // 移情固定全零: 移情随会话演化, 开场不预设正负.
      transference: { positive: 0, negative: 0, dependency: 0 },
    },
    forbiddenBehaviors: [...seed.forbiddenBehaviors],
    sensitiveTopics: [...seed.sensitiveTopics],
  };
}

/**
 * 三维阻抗映射: 种子基线 + 防御水平×权重 + 难度系数 (+ 风格对 style 的微调).
 */
function buildResistance(seed: BuiltinCharacterSeed, preset?: CharacterPresetInput): BdiResistance {
  const base = seed.baseline.resistance;
  const defense = clamp01(preset?.defenseLevel ?? 0);
  const difficultyBonus = DIFFICULTY_RESISTANCE_BONUS[preset?.difficulty ?? 'L1'] ?? 0;
  const styleAdjust = STYLE_RESISTANCE_ADJUST[preset?.style ?? 'mixed'] ?? 0;
  const common = defense * DEFENSE_RESISTANCE_WEIGHT + difficultyBonus;
  return {
    verbal: clamp01(base.verbal + common),
    depth: clamp01(base.depth + common),
    style: clamp01(base.style + common + styleAdjust),
  };
}

/**
 * 情绪基线映射: valence 由种子给; arousal 由临场 emotionBaseline 决定 (缺省用种子值).
 *
 * 为什么不 blend: 临场 `emotionBaseline` 是**每一场都在变**的现场旋钮
 * ("这场来访者的内在空洞感起点"), 种子给的是"这个人本来多空". 让现场旋钮说了算,
 * 角色之间的区别仍然由 valence + 阻抗 + 信任 + 信念承载 ——
 * 那四项才是角色的"骨架", 情绪唤醒度本来就是当场状态.
 */
function buildEmotion(seed: BuiltinCharacterSeed, preset?: CharacterPresetInput): { valence: number; arousal: number } {
  const arousalSource = preset?.emotionBaseline;
  return {
    valence: clampValence(seed.baseline.emotion.valence),
    arousal: clamp01(arousalSource ?? seed.baseline.emotion.arousal),
  };
}

/**
 * FNV-1a 32 位参数 (offset basis / prime).
 *
 * 用十进制而不是十六进制字面量: 仓库里 prettier 要求十六进制小写、unicorn
 * 要求大写, 两条规则在字面量上互斥 —— 写成十进制既绕开冲突, 也让这两个
 * "魔法数"有名字 (可读性本来就更好).
 */
const FNV_OFFSET_BASIS = 2_166_136_261;
const FNV_PRIME = 16_777_619;

/**
 * 由角色 key 稳定派生整数种子 (FNV-1a 32 位).
 *
 * 确定性是硬要求: 同一角色 key 必须永远得到同一个种子, 否则"同角色同行为序列
 * 同轨迹"的可复现性就没了. 按码点逐个折叠而不是 `hashCode` 之类的语言内建,
 * 是为了跨运行时稳定 (不同 JS 引擎的字符串 hash 不保证一致).
 *
 * @param key 角色 key
 * @returns 正整数种子
 */
export function stableSeedFromKey(key: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < key.length; index += 1) {
    // codePointAt: 与 charCodeAt 不同, 它按 Unicode 码点取值 (代理对不会被截半).
    hash ^= key.codePointAt(index) ?? 0;
    // Math.imul 做 32 位乘法再转回无符号: 避免浮点乘法丢精度.
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash % 2_147_483_647;
}

/**
 * 把数值 clamp 到 [0,1] (NaN → 0).
 *
 * 与内核 `clamp01` 语义一致; 本层自带一份是因为内核那个函数没有从公开 barrel
 * 导出, 而本期 engine-core 整树零改动 —— 深路径 import 一个"未导出"的内部函数
 * 会让内核的公开出口形同虚设.
 */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * 把效价 clamp 到 [-1,1] (NaN → 0).
 */
function clampValence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(-1, value));
}
