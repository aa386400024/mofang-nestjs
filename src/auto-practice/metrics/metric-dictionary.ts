// V2026-11-11 WP-K (批次回归追踪 · 指标字典 —— 单一真相源):
//   职责: 把"批次快照里有哪些指标、每个指标什么口径"集中在**一处**定义,
//         快照计算、HTTP 端点、CLI 报告、前端契约全部从这里取, 禁止各处各写一遍口径.
//   边界: 纯常量 + 纯类型, 零 IO / 零框架依赖.
//
//   设计纪律:
//     - `id` 是稳定契约, 一旦发布只增不改不复用 (改 id = 让历史快照对不上);
//     - 每个指标写清分子/分母口径 (`definition`), 不靠名字猜;
//     - `nullable: false` 的指标, 计算层必须赋值, 缺数据要在 coverage 里显式标记,
//       而不是偷偷塞 null;
//     - 浮点统一 round6 (见 round.ts), 保证跨机器复算一致.
//
//   指标分层 (id 用点分段):
//     dim.<dimension>.*       八维状态 (首/末/变化/速率/分布)
//     event.<kind>.*          事件计数与率
//     strategy.<name>.*       策略计数与率
//     session.*               场次级汇总 (零变化/出口分布)
//     pipeline.*              管道健康 (复用既有口径)
//     exploration.rate        探索率
//     event.positive.rate     正事件率

/** 指标的度量单位 (决定取值域与展示方式). */
export type MetricUnit = 'ratio' | 'delta' | 'count' | 'per_turn';

/** 指标的长期方向 (用于回归判定; 首次会谈的特殊口径由判据表另管). */
export type MetricDirection = 'higher_is_better' | 'lower_is_better' | 'neutral';

/** 一个指标的完整定义. */
export interface MetricDef {
  /** 稳定 id (快照 JSON 的键). */
  readonly id: string;
  /** 展示名. */
  readonly label: string;
  /** 度量单位. */
  readonly unit: MetricUnit;
  /** 长期方向. */
  readonly direction: MetricDirection;
  /** 取值域; null = 无界 (计数类). */
  readonly bounds: { readonly min: number; readonly max: number } | null;
  /** 是否允许 null (true = 数据缺失可空; false = 必须赋值). */
  readonly nullable: boolean;
  /** 口径说明: 分子/分母怎么算. */
  readonly definition: string;
}

/** 八个可追踪维度 (与逐字稿扁平字段对齐). */
export const TRACKED_DIMENSIONS = ['trust', 'safety', 'bond', 'valence', 'arousal', 'verbal', 'depth', 'style'] as const;

export type TrackedDimension = (typeof TRACKED_DIMENSIONS)[number];

/** 每个维度的长期方向与中文展示名. */
const DIMENSION_META: Readonly<Record<TrackedDimension, { readonly label: string; readonly direction: MetricDirection }>> = {
  trust: { label: '信任', direction: 'higher_is_better' },
  safety: { label: '安全感', direction: 'higher_is_better' },
  bond: { label: '纽带', direction: 'higher_is_better' },
  valence: { label: '效价', direction: 'higher_is_better' },
  arousal: { label: '唤醒', direction: 'neutral' },
  // 阻抗三维 (K-2): intake 首次会谈目标是"防御保持稳定、不被击穿", 不是"越低越好".
  // 它是区间/幅值问题 (既不被打穿、也不僵住), 没有单调方向, 故自动 verdict 按 neutral 处理;
  // 阻抗质量由单批 acceptance 的 max_delta 独立兜底 (超标即 FAIL), 不会漏.
  verbal: { label: '话量阻抗', direction: 'neutral' },
  depth: { label: '深度阻抗', direction: 'neutral' },
  style: { label: '风格阻抗', direction: 'neutral' },
};

/** 11 种事件 (与 CounselorEventKind 对齐; 含 neutral). */
export const TRACKED_EVENTS = [
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
  'neutral',
] as const;

export type TrackedEvent = (typeof TRACKED_EVENTS)[number];

/** 正向事件 (用于正事件率). */
export const POSITIVE_EVENTS: readonly TrackedEvent[] = ['empathy', 'acceptance', 'normalization', 'open_probe', 'affirmation'];

/** 8 种行为策略 (与 BehaviorStrategy 对齐). */
export const TRACKED_STRATEGIES = [
  'simple_response',
  'request',
  'recounting',
  'cognitive_exploration',
  'affective_exploration',
  'insight',
  'discussing_plans',
  'resistance',
] as const;

export type TrackedStrategy = (typeof TRACKED_STRATEGIES)[number];

/** 场次出口状态 (与 PracticeSession.status 的终态对齐). */
export const SESSION_OUTCOMES = ['completed', 'crisis_ended', 'stagnant', 'failed'] as const;

export type SessionOutcome = (typeof SESSION_OUTCOMES)[number];

const RATIO_BOUNDS = { min: 0, max: 1 } as const;
const DELTA_BOUNDS = { min: -1, max: 1 } as const;

function buildDimensionMetrics(): readonly MetricDef[] {
  const defs: MetricDef[] = [];
  for (const dim of TRACKED_DIMENSIONS) {
    const meta = DIMENSION_META[dim];
    const base = `dim.${dim}`;
    defs.push(
      {
        id: `${base}.first_avg`,
        label: `${meta.label}·首轮均值`,
        unit: 'ratio',
        direction: meta.direction,
        bounds: RATIO_BOUNDS,
        nullable: false,
        definition: `各场首个快照的 ${dim} 跨场算术平均`,
      },
      {
        id: `${base}.last_avg`,
        label: `${meta.label}·末轮均值`,
        unit: 'ratio',
        direction: meta.direction,
        bounds: RATIO_BOUNDS,
        nullable: false,
        definition: `各场最后一个快照的 ${dim} 跨场算术平均`,
      },
      {
        id: `${base}.delta_avg`,
        label: `${meta.label}·平均变化`,
        unit: 'delta',
        direction: meta.direction,
        bounds: DELTA_BOUNDS,
        nullable: false,
        definition: `各场 (末值 − 首值) 跨场算术平均`,
      },
      {
        id: `${base}.per_turn_rate`,
        label: `${meta.label}·每轮速率`,
        unit: 'per_turn',
        direction: meta.direction,
        bounds: DELTA_BOUNDS,
        nullable: false,
        definition: `各场 (末值 − 首值) ÷ 该场轮数, 再跨场平均`,
      },
      {
        id: `${base}.p10`,
        label: `${meta.label}·末值 P10`,
        unit: 'ratio',
        // 百分位是分布诊断 (小样本下对单个极端场敏感), 不参与自动好坏 verdict,
        // 仅保留在快照供人工下钻; 方向判定一律走均值/速率.
        direction: 'neutral',
        bounds: RATIO_BOUNDS,
        nullable: false,
        definition: `各场末值 ${dim} 的第 10 百分位 (分布下界, 防均值掩盖极端场)`,
      },
      {
        id: `${base}.p90`,
        label: `${meta.label}·末值 P90`,
        unit: 'ratio',
        direction: 'neutral',
        bounds: RATIO_BOUNDS,
        nullable: false,
        definition: `各场末值 ${dim} 的第 90 百分位 (分布上界)`,
      },
    );
  }
  return defs;
}

function buildEventMetrics(): readonly MetricDef[] {
  const defs: MetricDef[] = [];
  for (const kind of TRACKED_EVENTS) {
    defs.push(
      {
        id: `event.${kind}.count`,
        label: `事件·${kind}·计数`,
        unit: 'count',
        direction: 'neutral',
        bounds: null,
        nullable: false,
        definition: `全部纳入场次中 eventTags 含 ${kind} 的轮数合计`,
      },
      {
        id: `event.${kind}.rate`,
        label: `事件·${kind}·率`,
        unit: 'ratio',
        direction: 'neutral',
        bounds: RATIO_BOUNDS,
        nullable: false,
        definition: `${kind} 轮数 ÷ 全部纳入轮数`,
      },
    );
  }
  return defs;
}

function buildStrategyMetrics(): readonly MetricDef[] {
  const defs: MetricDef[] = [];
  for (const name of TRACKED_STRATEGIES) {
    defs.push(
      {
        id: `strategy.${name}.count`,
        label: `策略·${name}·计数`,
        unit: 'count',
        direction: 'neutral',
        bounds: null,
        nullable: false,
        definition: `全部纳入轮次中 intention.strategy = ${name} 的轮数合计`,
      },
      {
        id: `strategy.${name}.rate`,
        label: `策略·${name}·率`,
        unit: 'ratio',
        direction: 'neutral',
        bounds: RATIO_BOUNDS,
        nullable: false,
        definition: `${name} 轮数 ÷ 全部纳入轮数`,
      },
    );
  }
  return defs;
}

/** 固定的非维度/事件/策略指标. */
const SCALAR_METRICS: readonly MetricDef[] = [
  {
    id: 'exploration.rate',
    label: '探索率',
    unit: 'ratio',
    direction: 'higher_is_better',
    bounds: RATIO_BOUNDS,
    nullable: false,
    definition: '至少一轮出现 affective_exploration / cognitive_exploration 的场次数 ÷ 纳入场次数',
  },
  {
    id: 'event.positive.rate',
    label: '正事件率',
    unit: 'ratio',
    direction: 'higher_is_better',
    bounds: RATIO_BOUNDS,
    nullable: false,
    definition: '正向事件轮数 (empathy/acceptance/normalization/open_probe/affirmation) ÷ 全部纳入轮数',
  },
  {
    id: 'session.zero_motion',
    label: '零变化场次',
    unit: 'count',
    direction: 'lower_is_better',
    bounds: null,
    nullable: false,
    definition: '八个维度首末全部相等的场次数 (I-10 长期监控: 冷漠被静默成中性的程度)',
  },
  ...SESSION_OUTCOMES.map<MetricDef>((outcome) => ({
    id: `session.outcome.${outcome}`,
    label: `出口·${outcome}`,
    unit: 'count',
    direction: 'neutral',
    bounds: null,
    nullable: false,
    definition: `终态 status = ${outcome} 的场次数`,
  })),
  {
    id: 'pipeline.llm_call_ratio',
    label: 'LLM 调用场次占比',
    unit: 'ratio',
    direction: 'higher_is_better',
    bounds: RATIO_BOUNDS,
    nullable: false,
    definition: 'llm_call_turns > 0 的场次数 ÷ 纳入场次数 (复用批次健康口径)',
  },
  {
    id: 'pipeline.fallback_ratio',
    label: '渲染兜底率',
    unit: 'ratio',
    direction: 'lower_is_better',
    bounds: RATIO_BOUNDS,
    nullable: true,
    definition: 'render_fallback_turns ÷ 全部纳入轮数 (复用批次健康口径; 未测 = null)',
  },
];

/**
 * 字典版本标识.
 *
 * 改字典条目 / 口径 / 取值域时手动递增; 供前端缓存与审计比对.
 */
export const METRIC_DICTIONARY_VERSION = 'dict-v1';

/** 完整指标字典 (单一真相源). */
export const METRIC_DICTIONARY: readonly MetricDef[] = [
  ...buildDimensionMetrics(),
  ...buildEventMetrics(),
  ...buildStrategyMetrics(),
  ...SCALAR_METRICS,
];

/** id → 定义 的快速索引. */
export const METRIC_BY_ID: ReadonlyMap<string, MetricDef> = new Map(METRIC_DICTIONARY.map((metric) => [metric.id, metric]));

/** 全部非空指标 id 集合 (计算层据此核对无遗漏). */
export const NON_NULLABLE_IDS: readonly string[] = METRIC_DICTIONARY.filter((m) => !m.nullable).map((m) => m.id);
