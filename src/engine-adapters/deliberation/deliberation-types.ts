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
//   V2026-11-05 治本 (WP68 · B 层 · 意图锁定机制):
//     审议输出加**可选的** `intentionShift` —— LLM 可以建议切换行为策略, 不需要就返回 null.
//     为什么要有它: 影子期一直在比"软状态 delta", 但**意图层面**还没比过 ——
//     "LLM 会不会乱改意图"这个问题, 没有 intentionShift 就没法回答.
//     为什么放在本文件 (契约层) 而不是 service: 它是**输出契约的一部分**
//     (prompt / 校验 / trace 三处都要认它), 契约一处定义、三处引用, 免得三份真相.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp63-deliberation-schema.spec.ts 覆盖枚举数量 / 与内核口径的一致性
//     3. `satisfies` 编译期约束: 维度必须是内核 DeltaVector 的键, 对齐标签必须是内核事件类型
//     4. test/engine-adapters/wp68-deliberation-intention-lock.spec.ts 覆盖 intentionShift 校验 /
//        策略枚举与内核的一致性

import type { BehaviorStrategy, CounselorEventKind, DeltaVector } from '../../engine-core/index.js';

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
 * ⚠️ **V2026-11-12 (D-2) 的显式决定**: 内核 `CounselorEventKind` 扩到 13 类, 新增两类
 *   **在场状态**事件 (`holding_present` / `cold_absent`) —— 本组**刻意不加**它们:
 *   · 规则轨**词表不扩** → 规则侧**产不出**这两个标签 (本组是「规则算子也会打」的标签);
 *   · 模型轨走 shadow 旁路 → 影子对比口径不变 (两侧都是规则轨口径);
 *   · 两类的 delta 种子是 ZERO, 没有"规则可覆盖的 delta"可对齐;
 *   → 纳入本组 = 把模型独有标签误算成规则可覆盖 (任务单 §6 T6).
 *   是否纳入**留标定批次评估**.
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
 * 内核 8 种行为策略的**运行时清单** (WP68).
 *
 * ⚠️ 为什么内核只给类型不给数组:
 *   内核 `BehaviorStrategy` 是**类型** (union), 编译期有, 运行期没有值 ——
 *   而审议层需要**运行期**的清单: prompt 要列给模型看合法取值, 校验层要拿它做白名单.
 *   给内核加一个运行期数组 = **动 engine-core** (破红线), 所以清单落在适配层.
 *
 * ⚠️ 为什么用**穷尽 Record** 而不是 `as const` 数组 + `satisfies`:
 *   `satisfies readonly BehaviorStrategy[]` 只保证"**不多**" (子集), 不保证"**不少**" ——
 *   内核哪天加了第 9 种策略, 数组少一个, 编译期**不报错**, 模型却永远选不到它.
 *   `Record<BehaviorStrategy, true>` 反过来: 内核加策略而这里没跟 → **TS 直接报错**,
 *   逼着补上 (与渲染层 `STRATEGY_LABEL` / `EMOTION_EXPRESSION` 同一范式).
 *
 * 顺序 = 提示模型时的展示顺序 (内核 `intention.ts` 的声明顺序).
 */
const BEHAVIOR_STRATEGY_SET: Readonly<Record<BehaviorStrategy, true>> = {
  simple_response: true,
  request: true,
  recounting: true,
  cognitive_exploration: true,
  affective_exploration: true,
  insight: true,
  discussing_plans: true,
  resistance: true,
};

/**
 * 内核 8 种行为策略 (运行期清单).
 *
 * 用途: ① prompt 的 schema 描述列合法取值; ② `intentionShift.targetStrategy` 的白名单校验.
 */
export const DELIBERATION_BEHAVIOR_STRATEGIES: readonly BehaviorStrategy[] = Object.keys(BEHAVIOR_STRATEGY_SET) as BehaviorStrategy[];

/**
 * 这个字符串是合法的行为策略吗 (WP68).
 *
 * @param value 待校验值
 * @returns true = 是内核的 8 种策略之一
 */
export function isBehaviorStrategy(value: unknown): value is BehaviorStrategy {
  return typeof value === 'string' && Object.hasOwn(BEHAVIOR_STRATEGY_SET, value);
}

/**
 * LLM 建议的**意图切换** (WP68) —— 可选, 不需要切换就返回 null.
 *
 * 为什么要它 (这是 PoC 组最后一块拼图):
 *   影子期一直在比"软状态 delta"(trust / safety / bond …), 但**意图层面**还没比过.
 *   内核的 `Intention.strategy` 是每轮从状态选出来的行为策略 (8 种) ——
 *   现在是规则算子选的, 将来切灰度后 LLM 也可以建议切换.
 *   而"LLM 会不会乱改意图"这个问题, 没有这个字段就**没法回答**.
 *
 * ⚠️ 影子模式下它**不生效**: 审议结果从不写回内核 (WP64 起的纪律),
 *   主流程永远走规则算子选的意图. 本字段只用来**旁路模拟**意图锁定机制.
 */
export interface DeliberationIntentionShift {
  /** 建议切换到的行为策略 (必须是内核 8 种策略之一). */
  readonly targetStrategy: BehaviorStrategy;
  /** 切换理由 (一句话自然语言, 供督导观测). */
  readonly reason: string;
}

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
  /**
   * LLM 建议的**意图切换** (WP68) —— 可选.
   *
   * 口径:
   *   · `null` —— 觉得当前策略就该继续, 不建议切换 (**大多数轮次都是这种**);
   *   · 有值 —— 建议切到 `targetStrategy`, 附一句 `reason`.
   *
   * ⚠️ 字段**永远存在** (值可能是 null), 免得消费方到处判 `undefined`:
   *   蓝图 §2.2 的输出示例就是 `"intentionShift": null` 这个形状.
   *
   * ⚠️ 影子模式下它**不生效** —— 主流程永远走规则算子选的意图.
   *   真正拦住"乱改意图"的是**意图锁定机制** (在 service 层算, 结果进 trace).
   */
  readonly intentionShift: DeliberationIntentionShift | null;
}

// ── V2026-11-08 治本 (Phase2.5 WP-A · 审议输入最小化 · 合规 + 成本双解决) ─────────────
//
//   本节新增的是审议的**输入契约** —— 与上面那套输出契约对称.
//
//   为什么要换掉输入 (Phase2 代码级对账审计 R6 / R8):
//     改造前的审议 prompt 传的是**完整对话原文** (咨询师说的话 + AI 来访者说的话),
//     原样拼进 prompt 发给第三方模型. 两个问题同时炸:
//       · **合规** —— 心理内容随 prompt 出境第三方 (数据出境);
//       · **成本** —— 每轮都带全量上下文, 30 轮就破 10k token.
//
//   新契约的核心主张 (Phase2.5 总览 §5.1):
//     审议的本质是"评估**这一轮的状态变化**合不合理", 不是"理解对话说了什么".
//     所以**结构化数据就够了** —— 不传原文, 只传:
//       · 本轮咨询师行为的事件分类 (内核已有的事件词典);
//       · BDI 状态的前后对比 (前值 → 后值 + 变化量);
//       · 角色基线 (依恋风格 / 大五人格 / 阻抗基线);
//       · 风险等级 (低 / 中 / 高).
//
//   ⚠️ **零对话原文是硬红线** (WP-A §6.3):
//     `DeliberationInput` 里**没有任何一个字段装对话原文** —— 不是"约定不要填",
//     是**类型层面装不下**. 这样一来, 审议层即使被误改, 也**没有东西可泄漏**.
//     连带的好处: BullMQ 的 job payload 里也不再躺着心理对话原文 (它要随 job 冻结到 Redis).
//
//   ⚠️ **边界**: 本节只是**类型**. 组装 (从快照 / 事件 / 判定里抽结构化数据) 与
//     格式化 (拼成 prompt 文本) 分别落在 deliberation-input.ts 与 deliberation-prompt.ts.

/**
 * 审议用的风险等级 (适配层口径 · WP-A).
 *
 * 口径 (为什么不是直接用内核的 pass / warn / block):
 *   内核三级表达的是"**要不要拦**"; 审议这一层要回答的是"**这一轮能不能送出境**".
 *   两者语义不同 —— 咨询师说了句"你这就是想不开"是 warn (专业性问题),
 *   但它**不含任何心理内容**, 让 LLM 审一轮完全没问题; 而"我不想活了"是 warn (意念层),
 *   它必须**永远走本地规则**. 同一个 warn 覆盖两种完全不同的处置, 所以另立一套口径.
 *
 * - `low`    —— 无危机信号 (纯 pass) —— 唯一允许跑 LLM 审议的档;
 * - `medium` —— 危机意念 / 探索层 (被动自杀意图 / 自伤意念 / 自杀探索 …) —— 不跑;
 * - `high`   —— 危机行动层 (自杀未遂 / 计划 / 准备 / 主动意图 / 自伤行为 / 伤人)
 *               或任何 block 级硬红线 —— 不跑.
 *
 * ⚠️ **保守方向**: 拿不准往高了判 —— 少跑一轮审议只是少一条观察数据,
 *   让危机轮次出境是不可逆的合规事故.
 */
export type DeliberationRiskLevel = 'low' | 'medium' | 'high';

/**
 * "**高风险轮次, 压根没跑审议**" 的 trace 错误码 (WP-A 合规闸门).
 *
 * ⚠️ 为什么放在**契约文件**而不是 service 里:
 *   这个码要被**三方**引用 —— service (写 trace) / 统计面板 (认这一类轮次) /
 *   队列层 (日志口径). 放在任何一处都会引出"另一处要 import service" 的环.
 *   契约文件零依赖, 是三方共同的落点.
 *
 * ⚠️ 它与 `DELIBERATION_CIRCUIT_OPEN_ERROR_CODE` (`circuit_open`) 是**同类不同因**:
 *   · `circuit_open`      —— 熔断器拦下了 (LLM 之前就挂了, 省钱);
 *   · `skipped_high_risk` —— 合规闸门拦下了 (风险轮次永远不送出境).
 *   两者都表示"根本没跑 LLM", 但**原因不同**, 看板要能分开看.
 */
export const DELIBERATION_RISK_SKIP_ERROR_CODE = 'skipped_high_risk';

/**
 * 状态对比的一维 (WP-A) —— "这一轮前后, 这一维动了多少".
 *
 * 为什么**逐维**而不是只给一个总变化量:
 *   审议要判的是"trust 涨 0.02 合理吗" —— 这需要知道 trust 的**绝对水位**
 *   (从 0.05 涨到 0.07 与从 0.85 涨到 0.87 完全不是一回事), 也需要知道**别的维**
 *   有没有同时动 (阻抗三维集体上升 = 典型的隐性阻抗信号).
 */
export interface DeliberationStateComparisonEntry {
  /** 维度名 (与内核 `DeltaVector` 的键逐字一致). */
  readonly dimension: DeliberationDim;
  /** 本轮开始时的值. */
  readonly before: number;
  /** 本轮结束后的值. */
  readonly after: number;
  /** 变化量 (= after - before). */
  readonly delta: number;
}

/**
 * 阻抗基线 (三维) —— 角色"天生有多难靠近".
 *
 * 为什么单独拎出来 (WP-A 交付物 #4「角色简述格式化器」):
 *   同一个"来访者沉默", 在高阻抗角色身上是常态, 在低阻抗角色身上是退缩信号.
 *   审议模型不看基线就判不了"阻抗涨了 0.015 算不算异常" —— 所以基线必须进 prompt.
 */
export interface DeliberationResistanceBaseline {
  /** 话量阻抗 [0,1]. */
  readonly verbal: number;
  /** 内容深度阻抗 [0,1]. */
  readonly depth: number;
  /** 表达风格阻抗 [0,1]. */
  readonly style: number;
}

/**
 * 审议的**结构化输入** (WP-A) —— 审议 prompt 的唯一数据源.
 *
 * ⚠️ **零对话原文** (硬红线): 这里没有任何字段装咨询师/来访者说过的话.
 *   事件分类是**标签**, 状态对比是**数字**, 角色基线是**角色种子的元数据**
 *   (依恋风格 / 大五人格 —— 合成数据, 不是来访者的心理内容).
 *
 * ⚠️ **为什么角色简述可以带**: 它来自角色的**种子设定** (装配层 `buildCharacterBrief`),
 *   描述的是"AI 扮演的来访者是谁", 不是"来访者说了什么" —— 它是**合成数据**, 不出境敏感内容.
 *   反过来, **核心信念 / 情境愿望 / 记忆召回** 这些**不进来** —— 前两者可能带剧本化敏感内容,
 *   后者是**来访者的心理内容** (敏感度比对话原文更高), 一律不出境.
 */
export interface DeliberationInput {
  /**
   * 本轮咨询师行为的**事件分类** (内核口径).
   *
   * 来源是内核分类器的产物 (`EngineTurnOutput.events`) —— **内核的单一真相**.
   * 适配层不另起一套预判 (同一句话两套标签 = 影子期对比数据全废).
   */
  readonly events: readonly DeliberationOperatorTag[];
  /** BDI 状态逐维前后对比 (11 维全量). */
  readonly stateComparison: readonly DeliberationStateComparisonEntry[];
  /** 角色简述 (角色种子元数据: 依恋风格 + 大五人格; 不含对话原文). */
  readonly characterBrief: string;
  /** 阻抗基线 (话量 / 内容深度 / 表达风格). */
  readonly resistanceBaseline: DeliberationResistanceBaseline;
  /** 本轮风险等级 (低 / 中 / 高). */
  readonly riskLevel: DeliberationRiskLevel;
  /** 命中的风险类别 (内核 SafetyCategory 口径; 低风险轮次通常为空). */
  readonly riskCategories: readonly string[];
  /** 本轮规则算子选中的行为策略 (内核意图) —— 意图锁定判定要用. */
  readonly ruleStrategy: BehaviorStrategy;
}
