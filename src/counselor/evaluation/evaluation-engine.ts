// V2026-11-06 治本 (WP43 · 评估引擎基础版 · 纯规则评分):
//   职责: 把一场对练的内核出参 (事件计数 / BDI 首末差值 / 安全判定) 算成一份 0-100 的评估.
//   边界: **纯函数** —— 零 IO / 零 ORM / 零 LLM / 零 NestJS.
//
//   为什么是"规则引擎"而不是"再问一次 LLM":
//     督导报告 (LLM) 要 30-120s + 一次调用成本; 本引擎毫秒级 + 零成本 ——
//     用户训练完立刻能看到"这场说了几次共情、几次评判、有没有越界".
//     两者**互补**: LLM 看语境与整体质量, 规则给可复核的计数事实.
//
//   与既有能力的边界 (别造双胞胎):
//     · `training_sessions.tech_stats` = **技术手法**分类 (reflection/paraphrase/… 中性描述,
//       督导 LLM 同一次调用顺带产出) —— 本引擎计的是**行为效果**分类
//       (empathy / judgment / boundary_cross), 两者维度不同, 不重复;
//     · `supervisor` 六维 = LLM 综合打分 (0-100, 考虑语境) —— 本引擎是规则计数,
//       粒度不同, 互补不替代.
//
//   数据来源: **内核出参** (每轮 snapshot / events / safety), 不依赖留痕开关
//     (`ENGINE_DEBUG_TRACE_ENABLED`) —— 留痕是调试能力 (prod 缺省关),
//     评估是业务能力 (prod 必须开).
//
//   ⚠️ 下面的数值是**工程种子值**, 不是临床结论:
//     任务单只给了"每维 0-100 / 正向次数越多越高 / 负向次数越多越低"的形状,
//     没给具体刻度 —— 本单取一组可解释的默认值并**集中成常量**, 待真实数据校准.
//     (与内核 DeltaCapConfig / RecallPolicyOptions 同款纪律: 种子值集中一处 + 可解释.)

import type { SessionEvaluationTurnInput } from '../../voice/session-evaluation-slot.js';

/**
 * 正向技术手法: 每次出现的加分 (4 次封顶 100 分).
 */
export const POSITIVE_TECHNIQUE_SCORE_PER_HIT = 25;

/**
 * 负向技术手法: 每次出现的扣分 (4 次扣到 0 分).
 */
export const NEGATIVE_TECHNIQUE_PENALTY_PER_HIT = 25;

/**
 * 边界越界: 每次的扣分 (2 次扣到 0 分) —— 严重项, 单独一档.
 */
export const BOUNDARY_CROSS_PENALTY_PER_HIT = 50;

/**
 * BDI 变化维度的基准分 (没变化 = 50 分).
 */
export const BDI_CHANGE_NEUTRAL_SCORE = 50;

/**
 * BDI 变化 → 分 的放大系数 (变化 1.0 = ±50 分).
 */
export const BDI_CHANGE_SCORE_SCALE = 50;

/**
 * 伦理维度: warn 每次扣分.
 */
export const ETHICS_WARN_PENALTY = 20;

/**
 * 伦理维度: block 每次扣分.
 */
export const ETHICS_BLOCK_PENALTY = 40;

/**
 * 总分权重 (技术 / BDI 变化 / 伦理).
 */
export const TOTAL_WEIGHT_TECHNICAL = 0.6;
export const TOTAL_WEIGHT_BDI = 0.2;
export const TOTAL_WEIGHT_ETHICS = 0.2;

/**
 * 危机类别 (计数用).
 *
 * 为什么显式列出来而不是按前缀猜: "哪些类别算危机"是**临床口径**, 不是实现细节 ——
 *   猜前缀 (含 suicide/self_harm/aggression) 会随内核加类别而悄悄变口径.
 *   这里列全内核现有的危机类 (咨询师侧 1 类 + 来访侧自杀/自伤/攻击 8 类),
 *   内核新增危机类别时**要在这里补一行** (漏了会少计, 但不会算错 —— 等级维度还在).
 */
export const CRISIS_SAFETY_CATEGORIES: readonly string[] = [
  // 咨询师侧 (违规类别).
  'suicide_coaching',
  // 来访侧 (PsyGUARD 11 类里的自杀 / 自伤 / 攻击).
  'suicide_attempt',
  'suicide_plan',
  'suicide_preparation',
  'active_ideation',
  'passive_ideation',
  'suicide_exploration',
  'self_harm_behavior',
  'self_harm_ideation',
  'aggression_others',
  'aggression_self',
];

/**
 * 整体安全评级.
 */
export type SessionSafetyLabel = 'safe' | 'warning' | 'danger';

/**
 * 技术维度分 (每维 0-100).
 */
export interface TechnicalDimensionScores {
  /** 共情回应次数 → 分. */
  readonly empathy: number;
  /** 开放提问次数 → 分. */
  readonly openProbe: number;
  /** 评判次数 → 分 (扣分项). */
  readonly judgment: number;
  /** 说教次数 → 分 (扣分项). */
  readonly preaching: number;
  /** 淡化次数 → 分 (扣分项). */
  readonly minimizing: number;
  /** 边界越界次数 → 分 (严重扣分项). */
  readonly boundaryCross: number;
  /** 正常化回应次数 → 分. */
  readonly normalization: number;
  /** 接纳回应次数 → 分. */
  readonly acceptance: number;
  /** 肯定回应次数 → 分. */
  readonly affirmation: number;
}

/**
 * 技术维度评分 (含平均分).
 */
export interface TechnicalScores extends TechnicalDimensionScores {
  /** 技术维度平均分 (0-100) —— 总分里占 60%. */
  readonly average: number;
}

/**
 * BDI 变化维度评分 (每维 0-100).
 */
export interface BdiDeltaScores {
  /** 信任提升幅度 → 分. */
  readonly trust: number;
  /** 安全感提升幅度 → 分. */
  readonly safety: number;
  /** 阻抗变化 → 分 (阻抗下降 = 分高). */
  readonly resistance: number;
  /** 情绪变化 (效价) → 分. */
  readonly valence: number;
  /** BDI 维度平均分 (0-100) —— 总分里占 20%. */
  readonly average: number;
}

/**
 * 伦理维度评分.
 */
export interface EthicsScores {
  /** 危机触发次数 (命中危机类别的轮次). */
  readonly crisisCount: number;
  /** 告警轮次 (safety level = warn). */
  readonly warnCount: number;
  /** 拦截轮次 (safety level = block). */
  readonly blockCount: number;
  /** 整体安全评级. */
  readonly label: SessionSafetyLabel;
  /** 伦理维度分 (0-100) —— 总分里占 20%. */
  readonly score: number;
}

/**
 * 原始统计 (供调试 / 回溯: 分数是怎么来的).
 */
export interface RawEvaluationStats {
  /** 参与评估的轮数. */
  readonly turnCount: number;
  /** 逐类事件计数. */
  readonly eventCounts: Readonly<Record<string, number>>;
  /** 首轮关键值 (null = 没轮次). */
  readonly firstTurn: SessionEvaluationTurnInput | null;
  /** 末轮关键值 (null = 没轮次). */
  readonly lastTurn: SessionEvaluationTurnInput | null;
  /** 逐级安全判定计数. */
  readonly safetyLevelCounts: Readonly<Record<string, number>>;
  /** 纽带感变化 (本单不计分, 留档供回溯). */
  readonly bondDelta: number | null;
}

/**
 * 一场会话的评估结果.
 */
export interface SessionEvaluationScores {
  /** 综合总分 (0-100). */
  readonly overall: number;
  /** 技术维度. */
  readonly technical: TechnicalScores;
  /** BDI 变化维度. */
  readonly bdiDelta: BdiDeltaScores;
  /** 伦理维度. */
  readonly ethics: EthicsScores;
  /** 原始统计. */
  readonly raw: RawEvaluationStats;
}

/**
 * 算一场会话的评估 (纯规则, 零 IO).
 *
 * @param turns 逐轮内核出参投影 (可乱序, 内部按轮次排序)
 * @returns 评估结果
 */
export function computeSessionEvaluation(turns: readonly SessionEvaluationTurnInput[]): SessionEvaluationScores {
  const ordered = turns.toSorted((a, b) => a.turnIndex - b.turnIndex);
  if (ordered.length === 0) return emptyEvaluation();
  const eventCounts = countEvents(ordered);
  const technical = scoreTechnical(eventCounts);
  const bdiDelta = scoreBdiDelta(ordered);
  const ethics = scoreEthics(ordered);
  const overall = Math.round(
    technical.average * TOTAL_WEIGHT_TECHNICAL + bdiDelta.average * TOTAL_WEIGHT_BDI + ethics.score * TOTAL_WEIGHT_ETHICS,
  );
  return {
    overall: clampScore(overall),
    technical,
    bdiDelta,
    ethics,
    raw: {
      turnCount: ordered.length,
      eventCounts,
      firstTurn: ordered[0] ?? null,
      lastTurn: ordered.at(-1) ?? null,
      safetyLevelCounts: countSafetyLevels(ordered),
      bondDelta: ordered.length > 1 ? (ordered.at(-1)?.bond ?? 0) - (ordered[0]?.bond ?? 0) : null,
    },
  };
}

/**
 * 逐类事件计数.
 */
function countEvents(turns: readonly SessionEvaluationTurnInput[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const turn of turns) {
    for (const kind of turn.events) {
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * 技术维度评分 (9 维 + 平均).
 */
function scoreTechnical(counts: Readonly<Record<string, number>>): TechnicalScores {
  const dimensions: TechnicalDimensionScores = {
    empathy: positiveScore(counts['empathy'] ?? 0),
    openProbe: positiveScore(counts['open_probe'] ?? 0),
    judgment: negativeScore(counts['judgment'] ?? 0),
    preaching: negativeScore(counts['preaching'] ?? 0),
    minimizing: negativeScore(counts['minimizing'] ?? 0),
    boundaryCross: boundaryScore(counts['boundary_cross'] ?? 0),
    normalization: positiveScore(counts['normalization'] ?? 0),
    acceptance: positiveScore(counts['acceptance'] ?? 0),
    affirmation: positiveScore(counts['affirmation'] ?? 0),
  };
  const values = Object.values(dimensions);
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return { ...dimensions, average: clampScore(average) };
}

/**
 * 正向手法分: 次数越多越高, 封顶 100.
 */
function positiveScore(hits: number): number {
  return clampScore(hits * POSITIVE_TECHNIQUE_SCORE_PER_HIT);
}

/**
 * 负向手法分: 0 次满分, 出现就扣.
 */
function negativeScore(hits: number): number {
  return clampScore(100 - hits * NEGATIVE_TECHNIQUE_PENALTY_PER_HIT);
}

/**
 * 边界越界分: 0 次满分, 严重扣分.
 */
function boundaryScore(hits: number): number {
  return clampScore(100 - hits * BOUNDARY_CROSS_PENALTY_PER_HIT);
}

/**
 * BDI 变化维度评分 (首末轮差值 → 0-100).
 *
 * 阻抗是**反向**的: 阻抗下降 = 来访更能展开 = 分高 (所以取负号).
 */
function scoreBdiDelta(turns: readonly SessionEvaluationTurnInput[]): BdiDeltaScores {
  const first = turns[0];
  const last = turns.at(-1);
  if (!first || !last) {
    return { trust: 0, safety: 0, resistance: 0, valence: 0, average: 0 };
  }
  const trust = changeScore(last.trust - first.trust);
  const safety = changeScore(last.safety - first.safety);
  const resistance = changeScore(first.resistance - last.resistance);
  const valence = changeScore(last.valence - first.valence);
  const average = (trust + safety + resistance + valence) / 4;
  return { trust, safety, resistance, valence, average: clampScore(average) };
}

/**
 * 变化量 → 0-100 分 (0 变化 = 50 分, 正向变化 = 加分).
 */
function changeScore(delta: number): number {
  return clampScore(BDI_CHANGE_NEUTRAL_SCORE + delta * BDI_CHANGE_SCORE_SCALE);
}

/**
 * 伦理维度评分 (crisis 计数 + warn/block 扣分 + 安全评级).
 */
function scoreEthics(turns: readonly SessionEvaluationTurnInput[]): EthicsScores {
  let crisisCount = 0;
  let warnCount = 0;
  let blockCount = 0;
  for (const turn of turns) {
    if (turn.safetyLevel === 'warn') warnCount += 1;
    if (turn.safetyLevel === 'block') blockCount += 1;
    if (turn.safetyCategories.some((category) => CRISIS_SAFETY_CATEGORIES.includes(category))) crisisCount += 1;
  }
  const label = resolveSafetyLabel(warnCount, blockCount);
  const score = clampScore(100 - warnCount * ETHICS_WARN_PENALTY - blockCount * ETHICS_BLOCK_PENALTY);
  return { crisisCount, warnCount, blockCount, label, score };
}

/**
 * 安全评级 (取判定等级里最高的一档).
 *
 * 抽成独立函数有两个原因:
 *   ① 嵌套三元被 eslint (sonarjs/no-nested-conditional) 拦;
 *   ② "哪个等级更高"是一条**独立口径** (block > warn > pass), 单独成函数后一眼可读.
 *
 * @param warnCount 告警轮次
 * @param blockCount 拦截轮次
 * @returns 安全评级
 */
function resolveSafetyLabel(warnCount: number, blockCount: number): SessionSafetyLabel {
  if (blockCount > 0) return 'danger';
  if (warnCount > 0) return 'warning';
  return 'safe';
}

/**
 * 逐级安全判定计数.
 */
function countSafetyLevels(turns: readonly SessionEvaluationTurnInput[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const turn of turns) {
    const level = turn.safetyLevel ?? 'none';
    counts[level] = (counts[level] ?? 0) + 1;
  }
  return counts;
}

/**
 * 分数收敛到 [0,100] 且取整.
 */
function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(100, Math.max(0, value)));
}

/**
 * 空场次 (一轮都没跑) 的评估 —— 全部 0 分.
 *
 * 为什么不给"中性分": 没有轮次就**没有事实**, 给 50 分等于凭空造一个"表现尚可"的结论.
 */
function emptyEvaluation(): SessionEvaluationScores {
  return {
    overall: 0,
    technical: {
      empathy: 0,
      openProbe: 0,
      judgment: 0,
      preaching: 0,
      minimizing: 0,
      boundaryCross: 0,
      normalization: 0,
      acceptance: 0,
      affirmation: 0,
      average: 0,
    },
    bdiDelta: { trust: 0, safety: 0, resistance: 0, valence: 0, average: 0 },
    ethics: { crisisCount: 0, warnCount: 0, blockCount: 0, label: 'safe', score: 0 },
    raw: {
      turnCount: 0,
      eventCounts: {},
      firstTurn: null,
      lastTurn: null,
      safetyLevelCounts: {},
      bondDelta: null,
    },
  };
}
