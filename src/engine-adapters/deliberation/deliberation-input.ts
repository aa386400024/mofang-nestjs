// V2026-11-08 治本 (Phase2.5 WP-A · 审议输入最小化 · 结构化输入装配层):
//   职责: 把"一轮对练"压成**结构化数据** (事件分类 + 状态对比 + 角色基线 + 风险等级),
//         供审议 prompt 使用 —— 全程**不产出任何对话原文**.
//   边界: 纯函数 / 零 IO / 零网络 / 零 @nestjs; 只住在 src/engine-adapters/deliberation/ 内.
//
//   为什么这一层单独存在 (而不是把逻辑塞进 prompt 组装):
//     · prompt 组装只该管"**怎么写**" (措辞 / 区块顺序);
//     · 本层管"**取什么**" (从快照 / 事件 / 判定里抽结构化数据) —— 两件事分开, 各自可单测;
//     · 本层是**唯一**知道"怎么从内核拿数据"的地方 —— prompt 层不碰内核类型.
//
//   ⚠️ **对话原文只在入参里待一瞬**:
//     `buildDeliberationInput` 的入参含 counselorText / visitorText, 但它们只用于
//     **派生标签与类别** (事件分类兜底 + 来访侧安全规则判定), 派生完就不复存在.
//     返回值 (`DeliberationInput`) 里**没有任何原文** —— 类型层面装不下.
//     这不是"约定不要填", 是"**没有地方可填**" —— 审查者不必信任注释.
//
//   ⚠️ **为什么来访侧安全判定在这里重算一次** (而不是复用渲染侧的 guard 结论):
//     渲染侧的输出 guard 结论**只挂在流式路径** (`StreamRenderOutcome.guardVerdict`),
//     聚合路径没有 —— 两条路径口径必须一致 (仓库纪律: 判定只有一份), 否则同一段话术
//     在两条路径上被判出不同等级. 所以这里统一用内核的**纯规则**判定
//     (`evaluateSafety`, 零网络零延迟), 两条路径逐字一致.
//     代价: 来访侧的 PsyGUARD **语义**探测结果不进这个风险档 (只有规则命中).
//     影响面: 规则的关键词表覆盖了内核 10 类危机里的显性表述; 语义型表述
//     (如"我最近有点撑不住") 由咨询师侧的 PsyGUARD 探测兜住.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/phase25-wp-a-deliberation-input-minimization.spec.ts 覆盖
//        事件提取 / 状态对比 / 角色简述 / 风险分流 / 闸门

import {
  DELIBERATION_DIMS,
  DELIBERATION_RULE_ALIGNED_TAGS,
  type DeliberationDim,
  type DeliberationInput,
  type DeliberationOperatorTag,
  type DeliberationResistanceBaseline,
  type DeliberationRiskLevel,
  type DeliberationStateComparisonEntry,
} from './deliberation-types.js';
import { PSYGUARD_LEVEL_MAP, RuleBasedClassifier, evaluateSafety, maxSafetyLevel } from '../../engine-core/index.js';
import type { BehaviorStrategy, BdiSnapshot, CounselorEventKind, SafetyVerdict } from '../../engine-core/index.js';

/**
 * 风险等级的中文标签 (给 prompt 看).
 *
 * ⚠️ **穷尽 Record**: 内核/审议维度那边加新档位而这里没跟 → TS 直接报错,
 *   逼着补上 (与渲染层 `STRATEGY_LABEL` 同范式).
 */
export const DELIBERATION_RISK_LEVEL_LABELS: Readonly<Record<DeliberationRiskLevel, string>> = {
  low: '低',
  medium: '中',
  high: '高',
};

/**
 * 危机类别集合 (来访风险 10 类) —— **从内核的 `PSYGUARD_LEVEL_MAP` 派生**, 不另列一份.
 *
 * ⚠️ 为什么"派生"而不是手写清单:
 *   手写清单 = 第二份真相 —— 内核哪天加了第 12 类危机, 这里不会跟着变,
 *   于是那一类**静默漏判** (判成低风险 → 危机轮次被送去出境).
 *   派生的做法保证"内核加了类别 → 这里自动跟上", 一行代码都不用改.
 */
const CRISIS_CATEGORY_SET: ReadonlySet<string> = new Set(Object.keys(PSYGUARD_LEVEL_MAP).filter((category) => category !== 'neutral'));

/**
 * 规则轨分类器 (内核的同一个实现) —— 事件分类**兜底**用.
 *
 * ⚠️ 这是**兜底**, 不是主路: 主路是内核算好的 `EngineTurnOutput.events` (权威真相).
 *   只有内核没给出 events 时 (老版本 / 测试 mock) 才走这里.
 *   ⚠️ 兜底路径拿不到角色的敏感议题词表 → `sensitive_touch` 可能漏判 (内核路径不缺).
 */
const fallbackClassifier = new RuleBasedClassifier();

/**
 * 事件分类结果 (事件分类 + 风险等级).
 *
 * @param level 风险等级
 * @param categories 命中的风险类别 (去重)
 */
export interface DeliberationRiskAssessment {
  readonly level: DeliberationRiskLevel;
  readonly categories: readonly string[];
}

/**
 * 判定本轮风险等级 (WP-A 合规闸门的唯一口径).
 *
 * 口径 (保守方向 —— 拿不准往高了判):
 *   · **block 级** → `high` —— 无论它是咨询师侧硬红线 (承诺治愈 / 双重关系 /
 *     自杀指导 / 歧视) 还是来访侧行动层危机 (自杀未遂 / 计划 / 准备 / 主动意图 / 自伤行为),
 *     一律不跑 LLM 审议;
 *   · **命中危机类别** (意念 / 探索层: 被动自杀意图 / 自伤意念 / 自杀探索 / 伤人) → `medium`
 *     —— 同样不跑 (这是"自杀倾向", 合规红线里点名的档);
 *   · 其余 (含"专业性问题"类的 warn: 价值评判 / 过早给建议) → `low` —— 允许跑.
 *
 * ⚠️ **为什么 warn 的专业性问题不拦**:
 *   "你就是想不开"这类命中的是**咨询师的专业性违规**, 不是危机 —— 它不含任何心理内容,
 *   而且这恰恰是 LLM 审议**最该帮忙**的场景 (规则算子把它打成 trust↓ / safety↓,
 *   LLM 可以判断"这个幅度合不合理"). 把它一并拦掉 = 把审议层最有价值的用法砍了.
 *
 * @param counselorVerdict 咨询师侧安全判定 (内核本轮判定; 缺省 = 无)
 * @param visitorVerdict 来访侧安全判定 (内核规则判定; 缺省 = 无)
 * @returns 风险等级 + 命中的类别
 */
export function resolveDeliberationRiskLevel(
  counselorVerdict: SafetyVerdict | undefined,
  visitorVerdict: SafetyVerdict | undefined,
): DeliberationRiskAssessment {
  const categories = [...new Set([...(counselorVerdict?.categories ?? []), ...(visitorVerdict?.categories ?? [])])];
  const level = maxSafetyLevel(counselorVerdict?.level ?? 'pass', visitorVerdict?.level ?? 'pass');
  const hasCrisis = categories.some((category) => CRISIS_CATEGORY_SET.has(category));
  if (level === 'block') return { level: 'high', categories };
  if (hasCrisis) return { level: 'medium', categories };
  return { level: 'low', categories };
}

/**
 * 这个风险等级允许跑 LLM 审议吗 (WP-A §3.3 高风险分流).
 *
 * ⚠️ 只有 `low` 允许 —— 这是**合规红线**, 没有例外:
 *   高风险轮次永远走本地规则算子, 状态变化完全由规则决定.
 *
 * @param level 风险等级
 * @returns true = 允许跑审议
 */
export function isDeliberationRiskAcceptable(level: DeliberationRiskLevel): boolean {
  return level === 'low';
}

/**
 * 把内核事件种类翻译成审议操作标签 (过滤掉 neutral).
 *
 * @param kind 内核事件种类
 * @returns 对应的审议标签; neutral / 未知 → null
 */
function toOperatorTag(kind: CounselorEventKind): DeliberationOperatorTag | null {
  const raw: string = kind;
  for (const tag of DELIBERATION_RULE_ALIGNED_TAGS) {
    if ((tag as string) === raw) return tag;
  }
  return null;
}

/**
 * 提取本轮咨询师行为的**事件分类** (WP-A 交付物 #2).
 *
 * 主路: 内核分类器的产物 (`EngineTurnOutput.events`) —— **内核的单一真相**.
 *   适配层不另起一套预判: 同一句话两套标签 = 影子期的对比数据全废 (双方 delta 对不上, 谁也说不清谁错).
 *
 * 兜底: 内核没给 events 时 (老版本 / 测试 mock), 用**内核同一个**规则分类器现算一遍.
 *   ⚠️ 兜底拿不到角色敏感议题词表 → `sensitive_touch` 可能漏判 (可接受: 兜底只在缺数据时发生).
 *
 * @param kernelEvents 内核本轮事件分类 (权威; 缺省 = 走兜底)
 * @param counselorText 本轮咨询师发言 (只用于兜底分类; **不进结果**)
 * @returns 去重保序的审议标签 (可能是空数组 = 本轮没命中任何行为分类)
 */
export function extractCounselorEvents(
  kernelEvents: readonly CounselorEventKind[] | undefined,
  counselorText: string,
): readonly DeliberationOperatorTag[] {
  const source: readonly CounselorEventKind[] =
    kernelEvents && kernelEvents.length > 0 ? kernelEvents : fallbackClassifier.classify(counselorText).map((event) => event.kind);
  const tags: DeliberationOperatorTag[] = [];
  for (const kind of source) {
    // neutral = "没命中任何规则"的占位, 在 DELTA_TABLE 里是全零 delta —— 不该成为任何标签.
    if (kind === 'neutral') continue;
    const tag = toOperatorTag(kind);
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

/**
 * 从快照里读出 11 个审议维度的当前值.
 *
 * ⚠️ **为什么手写这一张映射表** (而不是遍历对象键):
 *   快照的字段是**嵌套**的 (`emotion.valence` / `resistance.verbal` / `transference.positive`),
 *   而审议维度是**扁平**的 (valence / verbal / positive) —— 两套命名对不上, 遍历取不到.
 *   这张表是"内核结构 → 审议维度"的**唯一**翻译处, 别处不再写第二份.
 *
 * @param snapshot BDI 快照
 * @returns 11 维当前值
 */
function readStateDimensions(snapshot: BdiSnapshot): Record<DeliberationDim, number> {
  return {
    trust: snapshot.trust,
    safety: snapshot.safety,
    bond: snapshot.bond,
    valence: snapshot.emotion.valence,
    arousal: snapshot.emotion.arousal,
    verbal: snapshot.resistance.verbal,
    depth: snapshot.resistance.depth,
    style: snapshot.resistance.style,
    positive: snapshot.transference.positive,
    negative: snapshot.transference.negative,
    dependency: snapshot.transference.dependency,
  };
}

/**
 * 保留 6 位小数 (与审议 trace 的数值精度一致, 避免浮点噪声进 prompt).
 *
 * @param value 原值
 * @returns 6 位小数 (非有限值 → 0; -0 归一成 0)
 */
function round6(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value * 1e6) / 1e6;
  return rounded === 0 ? 0 : rounded;
}

/**
 * 构造 BDI 状态的逐维前后对比 (WP-A 交付物 #3).
 *
 * ⚠️ **为什么 11 维全给** (而不是只给"变了的那几维"):
 *   审议要判"trust 涨 0.02 合不合理" —— 需要知道 trust 的**绝对水位**
 *   (从 0.05 涨到 0.07 与从 0.85 涨到 0.87 意义完全不同), 也需要知道
 *   "别的维有没有同时动" (阻抗三维集体上升 = 隐性阻抗的典型信号).
 *   少给 = 模型拿不到判断依据; 全给 = 多花约 200 token, 换来"每轮口径完全一致"。
 *
 * @param before 本轮开始时的快照 (R0)
 * @param after 本轮结束后的快照 (R1)
 * @returns 11 维逐维对比 (顺序 = `DELIBERATION_DIMS` 的声明顺序, 稳定可比)
 */
export function buildStateComparison(before: BdiSnapshot, after: BdiSnapshot): readonly DeliberationStateComparisonEntry[] {
  const beforeValues = readStateDimensions(before);
  const afterValues = readStateDimensions(after);
  return DELIBERATION_DIMS.map((dimension) => ({
    dimension,
    before: round6(beforeValues[dimension]),
    after: round6(afterValues[dimension]),
    delta: round6(afterValues[dimension] - beforeValues[dimension]),
  }));
}

/**
 * 从"本轮开始时的快照"取阻抗基线 (WP-A 交付物 #4 的一部分).
 *
 * @param snapshot 本轮开始时的快照
 * @returns 阻抗三维基线
 */
export function buildResistanceBaseline(snapshot: BdiSnapshot): DeliberationResistanceBaseline {
  return {
    verbal: round6(snapshot.resistance.verbal),
    depth: round6(snapshot.resistance.depth),
    style: round6(snapshot.resistance.style),
  };
}

/**
 * 装配审议结构化输入的入参.
 *
 * ⚠️ `counselorText` / `visitorText` 是**唯一**两处会碰到原文的地方,
 *   而且都只用于**派生标签 / 类别** —— 派生完即弃, 不进返回值.
 */
export interface BuildDeliberationInputParams {
  /** 内核本轮事件分类 (权威; 缺省 = 走规则分类器兜底). */
  readonly kernelEvents?: readonly CounselorEventKind[];
  /** 本轮咨询师发言 (只用于事件分类兜底; **不进结果**). */
  readonly counselorText: string;
  /** 本轮开始时的 BDI 快照 (R0). */
  readonly stateBefore: BdiSnapshot;
  /** 本轮结束后的 BDI 快照 (R1). */
  readonly stateAfter: BdiSnapshot;
  /** 角色简述 (角色种子元数据: 依恋风格 + 大五人格). */
  readonly characterBrief: string;
  /** 咨询师侧安全判定 (内核本轮判定). */
  readonly counselorVerdict?: SafetyVerdict;
  /** 本轮来访的渲染文本 (只用于来访侧安全规则判定; **不进结果**). */
  readonly visitorText: string;
  /** 本轮规则算子选中的行为策略 (内核意图). */
  readonly ruleStrategy: BehaviorStrategy;
}

/**
 * 装配审议的**结构化输入** (WP-A 的核心).
 *
 * @param params 入参
 * @returns 结构化输入 (**零对话原文**)
 */
export function buildDeliberationInput(params: BuildDeliberationInputParams): DeliberationInput {
  // 来访侧规则判定 (纯函数, 零网络) —— 与渲染侧 guard 用**同一套**内核规则.
  const visitorVerdict = evaluateSafety(params.visitorText, 'visitor_output');
  const risk = resolveDeliberationRiskLevel(params.counselorVerdict, visitorVerdict);
  return {
    events: extractCounselorEvents(params.kernelEvents, params.counselorText),
    stateComparison: buildStateComparison(params.stateBefore, params.stateAfter),
    characterBrief: params.characterBrief.trim(),
    resistanceBaseline: buildResistanceBaseline(params.stateBefore),
    riskLevel: risk.level,
    riskCategories: risk.categories,
    ruleStrategy: params.ruleStrategy,
  };
}
