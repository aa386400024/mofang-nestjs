// V2026-11-05 治本 (WP63 · B 层 · 审议输出契约):
//   职责: 定义「LLM 审议层」的**输入输出契约** —— 审议维度枚举 / 操作标签枚举 /
//         审议输出类型. 让 LLM 能输出**结构化**的 delta 建议, 且每条 delta 都带可解释的理由.
//   边界: 纯 TS, 零 @nestjs / 零 IO / 零 LLM 调用 / 零 prompt.
//         本期**只定义契约**, 不接进会话管道 (影子模式是 WP64 的事).
//
//   为什么这一层在**适配层**而不是内核:
//     审议层是「LLM 替人工算子库」的新机制, 它天然带 prompt / 模型 / 网络 ——
//     内核是纯层 (零 @nestjs / 零网络 / 零 prompt), 放进去直接破红线.
//     北极星 (docs/architecture/hybrid-bdi-agent-blueprint-v1.0.md §2.2) 也明确写了
//     「审议服务在适配层 (src/engine-adapters/deliberation/), 不在 engine-core」.
//
//   本期为什么**只定义契约**:
//     影子模式 (WP64) 的前提是「规则算子 delta 与 LLM 审议 delta 必须同口径才能对比」——
//     口径没定下来之前就把审议接进管道, 出来的对比结果不可信.
//     所以本期只落: 维度口径 / 标签口径 / 输出形状 / prompt 模板. 一行管道代码都不写.
//
//   反双胞胎:
//     - **不直接用 `keyof DeltaVector` 当维度类型** —— 那样内核哪天加了硬安全维度
//       (自杀倾向 / 危机等级) 就会**自动**被审议层接管, 而那些维度必须只走规则.
//       显式列一份 + `satisfies readonly (keyof DeltaVector)[]` 编译期守住"子集关系",
//       再由单测守住"不多不少" —— 方向不同, 两条都要.
//     - **不把内核 `CounselorEventKind` 直接当标签类型** —— 审议标签要多出 LLM 独有的几个
//       (规则算子靠关键词匹配, 看不到隐含意思), 而且内核事件里还有 `neutral`
//       (零 delta, 不该出现在任何 delta 标签里). 显式列一份, 别让内核加一个枚举就悄悄改了审议契约.
//     - **不输出绝对状态值** —— 审议层只给**增量建议**, 绝对值由内核快照持有.
//       两套都出 = 两份真相, 迟早对不上.
//     - **不在本期写格式校验 / 重试** —— 那是 WP66 的事; 本期只保证"形状"是**类型级**的约束.
//     - **不输出分数 / 评级** —— 零压红线 (AGENTS.md §5.3): 分数只允许出现在 MCQ 备考频道.
//       审议输出契约里**没有**分数字段, `exam` 模式也不例外 (见 deliberation-prompt.ts).
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp63-deliberation-schema.spec.ts 覆盖枚举数量 / 与内核口径的一致性
//     3. `satisfies` 编译期约束: 维度必须是内核 DeltaVector 的键, 对齐标签必须是内核事件类型

import type { CounselorEventKind, DeltaVector } from '../../engine-core/index.js';

/**
 * 审议维度 (与内核 `DeltaVector` 的 11 个键一一对应).
 *
 * 为什么单独列一个 type 而不是直接用 `keyof DeltaVector`:
 *   将来硬安全维度 (自杀倾向 / 危机等级) 若被加进 `DeltaVector`, 用 `keyof` 的话
 *   审议层会**自动**接管那个维度 —— 而那些维度必须**只走规则引擎**
 *   (硬安全判定不能交给一个可能脑补的 LLM). 显式列一份 = 把这条边界写死在类型里.
 *
 * 为什么用 `satisfies` 再钉一道编译期约束:
 *   `satisfies readonly (keyof DeltaVector)[]` 保证「审议维度 ⊆ 内核维度」——
 *   写错一个键名 (比如把 `valence` 写成 `emotionValence`) **编译期就红**, 不用等运行时才发现.
 *   ⚠️ 它只保证**子集**方向; 「不多不少」(内核加维度时审议要不要跟) 由单测守着 ——
 *   两条方向要分开守, 合成一条就会漏掉一半.
 *
 * 口径: 全部是**增量** (delta), 不是绝对值. clamp 由内核 `applyDeltaVector` 负责, 审议层只管建议.
 */
export const DELIBERATION_DIMS = [
  'trust',
  'safety',
  'bond',
  'valence',
  'arousal',
  'verbal',
  'depth',
  'style',
  'positive',
  'negative',
  'dependency',
] as const satisfies readonly (keyof DeltaVector)[];

/** 审议维度名. */
export type DeliberationDim = (typeof DELIBERATION_DIMS)[number];

/**
 * 与内核 `CounselorEventKind` **逐字对齐**的操作标签 (规则算子也会打这些标签).
 *
 * 为什么单独拆一组 (而不是混在一个数组里):
 *   影子模式的核心用法是**对比** —— "规则算子打了 `empathy` 标签、delta=+0.10;
 *   LLM 审议也打了 `empathy` 标签、delta=+0.15".
 *   对比的前提是两边**能打同一批标签**; 把"规则也有的"与"只有 LLM 有的"分两组,
 *   统计"只有 LLM 打了的标签占多少"就是"规则算子覆盖不了的场景有多少"——
 *   这正是审议层存在的价值证据. 混在一个数组里, 这个统计就没法一眼算.
 *
 * ⚠️ **与内核事件类型的一处刻意差异**:
 *   内核 `CounselorEventKind` 有 11 个值, 本组只有 **10** 个 —— 少的是 `neutral`.
 *   `neutral` 在内核 `DELTA_TABLE` 里对应**全零 delta** (不推进任何维度),
 *   它是"没命中任何规则"的占位, **不会**成为任何一条 delta 的成因标签.
 *   把 `neutral` 塞进标签枚举 = 让模型给一条 delta 打"我什么也没匹配到"的标签 = 噪声.
 *
 * ⚠️ 另一处**刻意的补齐** (相对任务单原文):
 *   任务单 §3.2 列了 9 个 (少了 `sensitive_touch`), 但内核 `DELTA_TABLE` 里
 *   `sensitive_touch` 是**有真实非零 delta** 的算子 (arousal +0.15 / safety -0.01 …).
 *   漏掉它 = 规则侧能打这个标签、审议侧不能打 → 影子模式对比时**永远匹配不上**,
 *   而且 LLM 明明看到了"咨询师触碰了敏感议题"却被迫乱打别的标签 ——
 *   恰好把 LLM 最该贡献的信号给掐掉了. 详见交付记录 §2.1.
 */
export const DELIBERATION_RULE_ALIGNED_TAGS = [
  'empathy',
  'acceptance',
  'normalization',
  'open_probe',
  'affirmation',
  'judgment',
  'preaching',
  'minimizing',
  'boundary_cross',
  'sensitive_touch',
] as const satisfies readonly CounselorEventKind[];

/**
 * **只有 LLM 能打**的标签 (规则算子靠关键词匹配, 看不到这些).
 *
 * 为什么加这几个:
 *   规则算子的局限就是"靠关键词匹配" (「听起来你」→ empathy),
 *   LLM 的优势就是"能理解语境和隐含意思" (表面是开放式提问, 语气却很敷衍).
 *   把这个优势**显式化**成标签: 影子模式跑完, 统计打了这几个标签的 delta 有多少,
 *   就是"规则算子覆盖不了、需要 LLM 的场景有多少"——这是审议层价值的**证据**, 不是口号.
 */
export const DELIBERATION_LLM_ONLY_TAGS = [
  /** 微表情 / 语气变化 (隐含情绪) —— 关键词匹配看不到语气. */
  'micro_expression',
  /** 隐性阻抗 (话里没明说, 但感觉在躲) —— 关键词匹配只能看到"说了什么". */
  'implicit_resistance',
  /** 关系氛围微妙变化 (信任 / 安全感的细微升降) —— 细微到规则算子根本不会触发. */
  'rapport_shift',
] as const;

/**
 * 审议操作标签全集 (可解释性核心).
 *
 * = 与规则算子对齐的一组 + 只有 LLM 能打的一组 (两组都单列, 见上面的说明).
 */
export const DELIBERATION_OPERATOR_TAGS = [...DELIBERATION_RULE_ALIGNED_TAGS, ...DELIBERATION_LLM_ONLY_TAGS] as const;

/** 审议操作标签. */
export type DeliberationOperatorTag = (typeof DELIBERATION_OPERATOR_TAGS)[number];

/**
 * 审议模式.
 *
 * - `exam`    —— MCQ 备考频道 (考核域): 将来评分会参考审议结果, 所以审议要**严格**;
 * - `freeform`—— 自由练习 (零压域): 允许**灵活**, 鼓励捕捉细微变化.
 *
 * ⚠️ 两种模式**都不产出分数 / 评级** (零压红线, AGENTS.md §5.3):
 *   分数只允许出现在 MCQ 备考频道, 且由那一侧的评分链路产出, 不是审议层产出.
 *   审议层在两种模式下的产物**形状完全相同** —— 只有 prompt 的**措辞严格度**不同.
 */
export type DeliberationMode = 'exam' | 'freeform';

/**
 * 单维度 delta 的**建议**幅度上限 (绝对值).
 *
 * 口径说明 (别把它当成内核 cap 的精确值):
 *   内核 `DEFAULT_DELTA_CAP_CONFIG` 是**逐维、且上下向不对称**的:
 *     · trust / safety / bond / valence: 上 +0.20 / 下 -0.30 (损失厌恶);
 *     · arousal 与阻抗三维: ±0.20;
 *     · 移情三维 (positive / negative / dependency): ±0.15.
 *   本常量取 **0.2** = 上向 cap 的统一档, 作为一个**粗口径**写进 prompt.
 *   ⚠️ 移情三维的精确上限是 0.15 —— 超出部分由**下游约束校验层** (北极星 §2.3) clamp 掉.
 *   审议层只给**建议**, 不负责 clamp (它连内核的 cap 端口都不碰, 更别说改状态).
 */
export const DELIBERATION_MAX_ABS_DELTA = 0.2;

/** 单条 delta 理由的字数上限 (中文). */
export const DELIBERATION_REASON_MAX_CHARS = 50;

/** 整体判断的字数上限 (中文). */
export const DELIBERATION_SUMMARY_MAX_CHARS = 80;

/**
 * 审议输出的一条 delta 建议.
 *
 * 为什么是"建议"不是"直接写入":
 *   影子模式阶段, LLM 输出只是旁路观察, 不生效.
 *   将来切灰度后, 也要过约束校验层 (delta cap / 临床合理性) 才落快照.
 */
export interface DeliberationDeltaEntry {
  /** 维度名 (与内核 `DeltaVector` 的键一一对应). */
  readonly dimension: DeliberationDim;
  /** 增量值 (建议值, 过约束校验层后才生效). */
  readonly delta: number;
  /**
   * 操作标签 —— 可解释性核心字段.
   *
   * 为什么要 operatorTags:
   *   规则算子的 delta 来自固定的事件类型 (empathy → trust +0.1).
   *   LLM 审议的 delta 如果只是一个数, 你不知道它为什么涨了 / 跌了.
   *   operatorTags 让 LLM 自己说"我为什么觉得 trust 涨了"——
   *   是因为共情? 还是因为接纳? 还是因为开放式提问?
   *
   * 枚举与现有 `CounselorEventKind` 对齐, 这样才能对比:
   *   规则算子打了 empathy 标签, delta=+0.10;
   *   LLM 审议也打了 empathy 标签, 但 delta=+0.15 ——
   *   差异一目了然, 而且能人工复核"0.15 是不是合理".
   */
  readonly operatorTags: readonly DeliberationOperatorTag[];
  /** 理由 (一句话, 中文, ≤50 字). */
  readonly reason: string;
}

/**
 * 审议完整输出.
 *
 * 为什么不直接输出 `DeltaVector`:
 *   `DeltaVector` 是 11 个字段**全有**的 (即使增量为 0).
 *   审议输出应该是"有变化才写"—— 没变化的维度不出现, 减少 token.
 *   而且每条 delta 要带 operatorTags 和 reason, `DeltaVector` 没有这些字段.
 *
 * 但两边**必须同口径**: `DeliberationDim` 的枚举值与 `DeltaVector` 的键名逐字一致,
 * 这样将来 LLM 输出的 delta 能直接转成 `DeltaVector` 喂给内核 `applyDeltaVector`.
 */
export interface DeliberationOutput {
  /** 本轮审议的 delta 建议列表 (只有有变化的维度). */
  readonly deltas: readonly DeliberationDeltaEntry[];
  /** 整体判断 (来访当前状态的一句话总结, ≤80 字). */
  readonly summary: string;
  /**
   * 置信度 [0, 1].
   *
   * 为什么要置信度:
   *   LLM 自己也知道"这个我拿不准".
   *   影子模式对比时, 低置信度的 delta 差异可以重点看 ——
   *   到底是 LLM 拿不准, 还是规则算子漏了.
   */
  readonly confidence: number;
}
