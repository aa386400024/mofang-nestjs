// WP-K 批次回归页 · 指标目录。
// 真相源在后端：
//   src/auto-practice/metrics/metric-dictionary.ts（单位 / 方向 / 取值域 / 口径）
//   src/auto-practice/metrics/acceptance-thresholds.ts（验收区间判据）
// 运行时通过 GET /metrics/catalog 拉取远端目录并会话缓存；拉取失败时回退本地兜底规则。
// 前端只展示阈值与口径，不复算验收 pass/fail（结论以后端 acceptance 为准）。
import { ref } from 'vue'
import { api } from '@/api/client'
import type { CatalogMetricDef, CatalogExpectation, CatalogTier } from '@/api/types'
import { dimensionLabel, eventLabel, strategyLabel, outcomeLabel } from './batchRegressionMeta'

export type MetricUnit = 'ratio' | 'delta' | 'count' | 'per_turn'
export type MetricDirection = 'higher_is_better' | 'lower_is_better' | 'neutral'
export type ExpectationKind = 'range' | 'max_delta' | 'min_value' | 'must_be_zero' | 'max_ratio'
export type ExpectationNumerator = 'raw' | 'idle'

/** 一条验收判据（对齐后端 MetricExpectation；tol 为边界缓冲，前端展示省略）。 */
export interface MetricExpectation {
  kind: ExpectationKind
  min?: number
  max?: number
  absLimit?: number
  /** max_ratio 的分子口径；缺省 raw。 */
  numerator?: ExpectationNumerator
  rationale: string
}

/** 单指标目录元数据。 */
export interface MetricInfo {
  label: string
  unit: MetricUnit
  direction: MetricDirection
  /** 数学取值域 [min, max]；计数类无界为 null。 */
  bounds: [number, number] | null
  /** 口径定义（分子 / 分母）。 */
  definition: string
  /** 验收判据（仅 intake 档 8 条指标有；其余指标未纳入验收）。 */
  expectation?: MetricExpectation
}

/** 一档判据视图（远端 CatalogTier 与本地兜底归一化后的形态）。 */
export interface TierView {
  id: string
  label: string
  counselorModeIds: string[]
  /** true = 候选阈值（待主控复核），不是定稿硬门槛。 */
  provisional: boolean
  note: string
  expectations: ExpectationEntry[]
}

// ─── 本地兜底常量（远端目录不可用时的离线副本） ──────────────────────────────

const LOCAL_DIMENSION_META: Record<string, { direction: MetricDirection }> = {
  trust: { direction: 'higher_is_better' },
  safety: { direction: 'higher_is_better' },
  bond: { direction: 'higher_is_better' },
  valence: { direction: 'higher_is_better' },
  arousal: { direction: 'neutral' },
  verbal: { direction: 'neutral' },
  depth: { direction: 'neutral' },
  style: { direction: 'neutral' },
}

const LOCAL_SUFFIX_META: Record<string, { unit: MetricUnit; bounds: [number, number]; definition: string }> = {
  first_avg: { unit: 'ratio', bounds: [0, 1], definition: '各场首个快照的维度值跨场算术平均' },
  last_avg: { unit: 'ratio', bounds: [0, 1], definition: '各场最后快照的维度值跨场算术平均' },
  delta_avg: { unit: 'delta', bounds: [-1, 1], definition: '各场（末值 − 首值）跨场算术平均' },
  per_turn_rate: { unit: 'per_turn', bounds: [-1, 1], definition: '各场（末值 − 首值）÷ 该场轮数，再跨场平均' },
  p10: { unit: 'ratio', bounds: [0, 1], definition: '各场末值第 10 百分位（分布下界）' },
  p90: { unit: 'ratio', bounds: [0, 1], definition: '各场末值第 90 百分位（分布上界）' },
}

/** 本地兜底判据（镜像 INTAKE_EXPECTATIONS；metricId → 判据）。 */
const LOCAL_EXPECTATIONS: Record<string, MetricExpectation> = {
  'dim.trust.delta_avg': { kind: 'range', min: 0.05, max: 0.2, rationale: '首次会谈信任温和上升；焦虑型快速理想化' },
  'dim.safety.delta_avg': { kind: 'range', min: 0.02, max: 0.06, rationale: '试探性安全，只小幅涨' },
  'dim.bond.delta_avg': { kind: 'range', min: -0.03, max: 0.03, rationale: '纽带 3-5 次会谈后才成形，首次几乎不动' },
  'dim.depth.delta_avg': { kind: 'max_delta', absLimit: 0.1, rationale: '深度防御是保护性的，不该被几次共情打穿' },
  'dim.style.delta_avg': { kind: 'max_delta', absLimit: 0.05, rationale: '人格级表达风格防御稳定' },
  'dim.verbal.delta_avg': { kind: 'max_delta', absLimit: 0.15, rationale: '愿说一点，但不是倾倒' },
  'dim.arousal.delta_avg': { kind: 'range', min: -0.05, rationale: '结束时唤醒仍可能高于基线，不要求下降' },
  'session.zero_motion': { kind: 'must_be_zero', rationale: '零变化场次应为 0；否则说明冷漠被静默成中性、检测失效' },
}

/** 本地兜底 cold 档判据（镜像后端 INTAKE_EXPECTATIONS_COLD；离线回退副本，真相源在后端 tiers）。 */
const LOCAL_COLD_EXPECTATIONS: Record<string, MetricExpectation> = {
  'dim.trust.delta_avg': { kind: 'range', min: 0.01, max: 0.08, rationale: 'cold 冷漠输入下信任建立显著慢；下限 0.01 保住完全无响应即不合格的底线' },
  'dim.safety.delta_avg': { kind: 'range', min: 0, max: 0.03, rationale: '试探性安全几乎不涨属合理反应；上限 0.03 防无节制依赖滑向另一端' },
  'dim.bond.delta_avg': { kind: 'range', min: -0.03, max: 0.03, rationale: '纽带 3-5 次会谈后才成形，首次会谈本就不该动' },
  'dim.depth.delta_avg': { kind: 'max_delta', absLimit: 0.05, rationale: '深度防御基本稳；收窄到 ±0.05，捕捉冷漠输入反而把深度防御撬开 / 塌陷' },
  'dim.style.delta_avg': { kind: 'max_delta', absLimit: 0.05, rationale: '人格级表达风格防御稳定' },
  'dim.verbal.delta_avg': { kind: 'max_delta', absLimit: 0.05, rationale: '话量阻抗几乎不动；收窄到 ±0.05，捕捉被压垮 / 泄洪' },
  'dim.arousal.delta_avg': { kind: 'range', min: -0.05, rationale: '结束时唤醒仍可能高于基线，不要求下降' },
  'session.zero_motion': { kind: 'max_ratio', max: 0.7, numerator: 'idle', rationale: '只计纯 neutral 空转的零变化场次；不要求为 0，但空转率过高说明失效面过大' },
}

function expectationsOf(record: Record<string, MetricExpectation>): ExpectationEntry[] {
  return Object.entries(record).map(([metricId, expectation]) => ({ metricId, expectation }))
}

/** 本地兜底判据档（远端目录不可用时的离线副本；baseline = intake-v1 阈值，cold = 候选档）。 */
const LOCAL_TIERS: TierView[] = [
  {
    id: 'baseline',
    label: '基线档 (intake-v1 阈值)',
    counselorModeIds: [],
    provisional: false,
    note: '兜底档：expert 及所有未单列的 counselorModeId 落此；阈值与 intake-v1 逐条相同。',
    expectations: expectationsOf(LOCAL_EXPECTATIONS),
  },
  {
    id: 'cold',
    label: 'cold 负向极端档 (候选阈值 · 待主控复核)',
    counselorModeIds: ['cold'],
    provisional: true,
    note: 'cold = 冷漠型 AI 咨询师：来访者面对冷漠输入时联盟建立慢属合理反应；候选值待主控复核，不作硬门槛。',
    expectations: expectationsOf(LOCAL_COLD_EXPECTATIONS),
  },
]

/** 本地兜底显式标量指标（族规则覆盖不到的汇总指标）。 */
const LOCAL_EXPLICIT: Record<string, MetricInfo> = {
  'exploration.rate': {
    label: '探索率', unit: 'ratio', direction: 'higher_is_better', bounds: [0, 1],
    definition: '至少一轮出现情感 / 认知探索策略的场次数 ÷ 纳入场次数',
  },
  'event.positive.rate': {
    label: '正事件率', unit: 'ratio', direction: 'higher_is_better', bounds: [0, 1],
    definition: '正向事件轮数（共情 / 接纳 / 正常化 / 开放式探问 / 肯定）÷ 全部纳入轮数',
  },
  'session.zero_motion': {
    label: '零变化场次', unit: 'count', direction: 'lower_is_better', bounds: null,
    definition: '八个维度首末全部相等的场次数',
    expectation: LOCAL_EXPECTATIONS['session.zero_motion'],
  },
  'pipeline.llm_call_ratio': {
    label: 'LLM 调用场次占比', unit: 'ratio', direction: 'higher_is_better', bounds: [0, 1],
    definition: '含 LLM 调用的场次数 ÷ 纳入场次数',
  },
  'pipeline.fallback_ratio': {
    label: '渲染兜底率', unit: 'ratio', direction: 'lower_is_better', bounds: [0, 1],
    definition: '渲染兜底轮数 ÷ 全部纳入轮数；未测记为 null',
  },
}

/** 前端列表行字段 → 快照指标 id（趋势表头用前端字段名）。 */
const ROW_FIELD_TO_METRIC: Record<string, string> = {
  explorationRate: 'exploration.rate',
  depthDeltaAvg: 'dim.depth.delta_avg',
  safetyDeltaAvg: 'dim.safety.delta_avg',
  positiveEventRate: 'event.positive.rate',
}

// ─── 远端目录缓存（运行时拉取，会话级） ──────────────────────────────────────

const remoteMetrics = new Map<string, CatalogMetricDef>()
const remoteExpectations = new Map<string, CatalogExpectation>()
const remoteTiers: CatalogTier[] = []
let remoteVersions: { dictionaryVersion: string | null; acceptanceVersion: string | null } = {
  dictionaryVersion: null,
  acceptanceVersion: null,
}
let catalogSource: 'remote' | 'fallback' = 'fallback'

/** 远端目录加载完成（或失败）后递增，驱动卡片 / 浮层重算。 */
export const catalogTick = ref(0)

let loadingPromise: Promise<void> | null = null

/** 拉取后端指标目录；成功填充缓存，失败静默回退本地兜底。重复调用复用同一 Promise。 */
export function loadMetricCatalog(): Promise<void> {
  if (loadingPromise) return loadingPromise
  loadingPromise = (async () => {
    try {
      const res = await api.batchRegression.getMetricCatalog()
      const payload = res.data
      remoteMetrics.clear()
      remoteExpectations.clear()
      remoteTiers.length = 0
      for (const metric of payload.metrics) remoteMetrics.set(metric.id, metric)
      for (const expectation of payload.expectations) remoteExpectations.set(expectation.metricId, expectation)
      for (const tier of payload.tiers ?? []) remoteTiers.push(tier)
      remoteVersions = {
        dictionaryVersion: payload.dictionaryVersion,
        acceptanceVersion: payload.acceptanceVersion,
      }
      catalogSource = 'remote'
    } catch {
      catalogSource = 'fallback'
    } finally {
      catalogTick.value += 1
    }
  })()
  return loadingPromise
}

/** 目录版本与来源（供汇总卡展示；source = remote | fallback）。 */
export function getCatalogMeta(): {
  dictionaryVersion: string | null
  acceptanceVersion: string | null
  source: 'remote' | 'fallback'
} {
  return { ...remoteVersions, source: catalogSource }
}

function expectationToLocal(e: CatalogExpectation): MetricExpectation {
  return { kind: e.kind, min: e.min, max: e.max, absLimit: e.absLimit, numerator: e.numerator, rationale: e.rationale }
}

function infoFromRemote(def: CatalogMetricDef): MetricInfo {
  const expectation = remoteExpectations.get(def.id)
  return {
    label: def.label,
    unit: def.unit,
    direction: def.direction,
    bounds: def.bounds ? [def.bounds.min, def.bounds.max] : null,
    definition: def.definition,
    expectation: expectation ? expectationToLocal(expectation) : undefined,
  }
}

// ─── 查询入口 ────────────────────────────────────────────────────────────────

/** 按指标 id 查目录；远端优先，未命中回退本地规则；都无登记返回 null。 */
export function getMetricInfo(metricId: string): MetricInfo | null {
  const remote = remoteMetrics.get(metricId)
  if (remote) return infoFromRemote(remote)
  return infoFromLocal(metricId)
}

/** 按前端列表行字段名查目录（无映射返回 null）。 */
export function getMetricInfoByRowField(field: string): MetricInfo | null {
  const metricId = ROW_FIELD_TO_METRIC[field]
  return metricId ? getMetricInfo(metricId) : null
}

/** 验收判据条目（供指标字典汇总卡；远端优先，回退本地兜底顺序）。 */
export interface ExpectationEntry {
  metricId: string
  expectation: MetricExpectation
}

/** 判据区间的可读文本（浮层与汇总卡复用）。 */
export function expectationText(e: MetricExpectation): string {
  switch (e.kind) {
    case 'range': {
      const lo = e.min === undefined ? '−∞' : String(e.min)
      const hi = e.max === undefined ? '+∞' : String(e.max)
      return `[${lo}, ${hi}]`
    }
    case 'max_delta':
      return `|Δ| ≤ ${e.absLimit}`
    case 'min_value':
      return `≥ ${e.min}`
    case 'must_be_zero':
      return '= 0'
    case 'max_ratio': {
      const numerator = e.numerator === 'idle' ? '空转占比' : '占比'
      return `${numerator} ≤ ${e.max}`
    }
  }
}

const LOCAL_EXPECTATION_LIST: ExpectationEntry[] = Object.entries(LOCAL_EXPECTATIONS).map(
  ([metricId, expectation]) => ({ metricId, expectation }),
)

/** 判据档列表：远端优先；远端未加载时回退本地兜底。 */
export function getTierList(): TierView[] {
  if (remoteTiers.length > 0) {
    return remoteTiers.map((tier) => ({
      id: tier.id,
      label: tier.label,
      counselorModeIds: tier.counselorModeIds,
      provisional: tier.provisional,
      note: tier.note,
      expectations: tier.expectations.map((e) => ({ metricId: e.metricId, expectation: expectationToLocal(e) })),
    }))
  }
  return LOCAL_TIERS
}

/** 指定档的判据条目；档 id 不存在时回落首档（基线档）。 */
export function getTierExpectations(tierId: string): ExpectationEntry[] {
  const tiers = getTierList()
  const tier = tiers.find((t) => t.id === tierId) ?? tiers[0]
  return tier?.expectations ?? []
}

/** 验收判据列表：传 tierId 返回该档；不传则沿用基线档（远端优先，本地兜底）。 */
export function getExpectationList(tierId?: string): ExpectationEntry[] {
  if (tierId !== undefined) return getTierExpectations(tierId)
  if (remoteExpectations.size > 0) {
    return [...remoteExpectations.entries()].map(([metricId, expectation]) => ({
      metricId,
      expectation: expectationToLocal(expectation),
    }))
  }
  return LOCAL_EXPECTATION_LIST
}

// ─── 本地兜底规则（远端未覆盖时的离线投影） ─────────────────────────────────

function infoFromLocal(metricId: string): MetricInfo | null {
  const explicit = LOCAL_EXPLICIT[metricId]
  if (explicit) return explicit

  const dimMatch = /^dim\.([a-z]+)\.(.+)$/.exec(metricId)
  if (dimMatch) {
    const [, dim, suffix] = dimMatch
    const dimMeta = dim ? LOCAL_DIMENSION_META[dim] : undefined
    const suffixMeta = suffix ? LOCAL_SUFFIX_META[suffix] : undefined
    if (dim && suffix && dimMeta && suffixMeta) {
      return {
        label: `${dimensionLabel(dim)}·${suffixLabel(suffix)}`,
        unit: suffixMeta.unit,
        direction: dimMeta.direction,
        bounds: suffixMeta.bounds,
        definition: suffixMeta.definition,
        expectation: LOCAL_EXPECTATIONS[metricId],
      }
    }
  }

  const eventMatch = /^event\.([a-z_]+)\.(count|rate)$/.exec(metricId)
  if (eventMatch) {
    const [, kind, suffix] = eventMatch
    const name = kind ? eventLabel(kind) : metricId
    if (suffix === 'rate') {
      return { label: `${name}·率`, unit: 'ratio', direction: 'neutral', bounds: [0, 1], definition: `${name}轮数 ÷ 全部纳入轮数` }
    }
    return { label: `${name}·计数`, unit: 'count', direction: 'neutral', bounds: null, definition: `${name}出现的轮数合计` }
  }

  const strategyMatch = /^strategy\.([a-z_]+)\.(count|rate)$/.exec(metricId)
  if (strategyMatch) {
    const [, name, suffix] = strategyMatch
    const label = name ? strategyLabel(name) : metricId
    if (suffix === 'rate') {
      return { label: `${label}·率`, unit: 'ratio', direction: 'neutral', bounds: [0, 1], definition: `${label}策略轮数 ÷ 全部纳入轮数` }
    }
    return { label: `${label}·计数`, unit: 'count', direction: 'neutral', bounds: null, definition: `${label}策略出现的轮数合计` }
  }

  const outcomeMatch = /^session\.outcome\.([a-z_]+)$/.exec(metricId)
  if (outcomeMatch) {
    const [, outcome] = outcomeMatch
    return {
      label: outcome ? outcomeLabel(outcome) : metricId,
      unit: 'count', direction: 'neutral', bounds: null,
      definition: '终态为该出口的场次数',
    }
  }

  return null
}

function suffixLabel(suffix: string): string {
  const labels: Record<string, string> = {
    first_avg: '首轮均值',
    last_avg: '末轮均值',
    delta_avg: '平均变化',
    per_turn_rate: '每轮速率',
    p10: '末值 P10',
    p90: '末值 P90',
  }
  return labels[suffix] ?? suffix
}
