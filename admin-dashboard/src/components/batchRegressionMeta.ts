// WP-K 批次回归页 · 前端展示映射（单一真相源在后端 metric-dictionary.ts / config-fingerprint.ts，
// 这里只做 id → 展示名的本地投影；未知 id 原样回退，不丢信息）。
import type { BatchSummaryRow, ConfigSegment } from '@/api/types'

/** 指纹段展示顺序（与后端 CONFIG_SEGMENT_ORDER 对齐）。 */
export const CONFIG_SEGMENT_ORDER: readonly ConfigSegment[] = [
  'stateTransition',
  'alliance',
  'deltaTableConfig',
  'lexicon',
  'baselines',
  'prompts',
  'acceptance',
]

/** 八维追踪维度顺序（与后端 TRACKED_DIMENSIONS 对齐）。 */
export const TRACKED_DIMENSIONS = [
  'trust',
  'safety',
  'bond',
  'valence',
  'arousal',
  'verbal',
  'depth',
  'style',
] as const

/** 11 种事件顺序（与后端 TRACKED_EVENTS 对齐）。 */
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
] as const

/** 8 种行为策略顺序（与后端 TRACKED_STRATEGIES 对齐）。 */
export const TRACKED_STRATEGIES = [
  'simple_response',
  'request',
  'recounting',
  'cognitive_exploration',
  'affective_exploration',
  'insight',
  'discussing_plans',
  'resistance',
] as const

/** 场次出口顺序（与后端 SESSION_OUTCOMES 对齐）。 */
export const SESSION_OUTCOMES = ['completed', 'crisis_ended', 'stagnant', 'failed'] as const

const DIMENSION_LABELS: Record<string, string> = {
  trust: '信任',
  safety: '安全感',
  bond: '纽带',
  valence: '效价',
  arousal: '唤醒',
  verbal: '话量阻抗',
  depth: '深度阻抗',
  style: '风格阻抗',
}

const EVENT_LABELS: Record<string, string> = {
  empathy: '共情',
  acceptance: '接纳',
  normalization: '正常化',
  open_probe: '开放式探问',
  affirmation: '肯定',
  judgment: '评判',
  preaching: '说教',
  minimizing: '弱化',
  boundary_cross: '边界越界',
  sensitive_touch: '敏感触碰',
  neutral: '中性',
}

const STRATEGY_LABELS: Record<string, string> = {
  simple_response: '简单回应',
  request: '请求',
  recounting: '复述',
  cognitive_exploration: '认知探索',
  affective_exploration: '情感探索',
  insight: '洞察',
  discussing_plans: '计划讨论',
  resistance: '阻抗应对',
}

const OUTCOME_LABELS: Record<string, string> = {
  completed: '完成',
  crisis_ended: '危机结束',
  stagnant: '停滞',
  failed: '失败',
}

const SUFFIX_LABELS: Record<string, string> = {
  first_avg: '首轮均值',
  last_avg: '末轮均值',
  delta_avg: '平均变化',
  per_turn_rate: '每轮速率',
  p10: '末值 P10',
  p90: '末值 P90',
}

const METRIC_SUFFIX_LABELS: Record<string, string> = {
  count: '计数',
  rate: '率',
}

const SCALAR_LABELS: Record<string, string> = {
  'exploration.rate': '探索率',
  'event.positive.rate': '正事件率',
  'session.zero_motion': '零变化场次',
  'pipeline.llm_call_ratio': 'LLM 调用场次占比',
  'pipeline.fallback_ratio': '渲染兜底率',
}

/** 维度短名（雷达 / 条形轴标签用）；未知维度原样回退。 */
export function dimensionLabel(dim: string): string {
  return DIMENSION_LABELS[dim] ?? dim
}

/** 事件短名。 */
export function eventLabel(kind: string): string {
  return EVENT_LABELS[kind] ?? kind
}

/** 策略短名。 */
export function strategyLabel(name: string): string {
  return STRATEGY_LABELS[name] ?? name
}

/** 出口短名。 */
export function outcomeLabel(outcome: string): string {
  return OUTCOME_LABELS[outcome] ?? outcome
}

/** 指标 id → 展示名；解析不出时原样返回 id（保留可追溯性）。 */
export function metricLabel(metricId: string): string {
  const direct = SCALAR_LABELS[metricId]
  if (direct) return direct

  const dimMatch = /^dim\.([a-z]+)\.(.+)$/.exec(metricId)
  if (dimMatch) {
    const dim = dimMatch[1]
    const suffix = dimMatch[2]
    if (dim && suffix) {
      const dimLabel = DIMENSION_LABELS[dim]
      const suffixLabel = SUFFIX_LABELS[suffix]
      if (dimLabel && suffixLabel) return `${dimLabel}·${suffixLabel}`
    }
  }

  const eventMatch = /^event\.([a-z_]+)\.(count|rate)$/.exec(metricId)
  if (eventMatch) {
    const kind = eventMatch[1]
    const suffix = eventMatch[2]
    if (kind && suffix) {
      const kindLabel = EVENT_LABELS[kind]
      if (kindLabel) return `${kindLabel}·${METRIC_SUFFIX_LABELS[suffix]}`
    }
  }

  const strategyMatch = /^strategy\.([a-z_]+)\.(count|rate)$/.exec(metricId)
  if (strategyMatch) {
    const name = strategyMatch[1]
    const suffix = strategyMatch[2]
    if (name && suffix) {
      const nameLabel = STRATEGY_LABELS[name]
      if (nameLabel) return `${nameLabel}·${METRIC_SUFFIX_LABELS[suffix]}`
    }
  }

  const outcomeMatch = /^session\.outcome\.([a-z_]+)$/.exec(metricId)
  if (outcomeMatch) {
    const outcome = outcomeMatch[1]
    if (outcome) return OUTCOME_LABELS[outcome] ?? metricId
  }

  return metricId
}

/** 标量值格式化；null = 未采集，显示破折号而不是 0。 */
export function formatMetric(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return value.toFixed(4)
}

/** 差值格式化：带正负号；null 显示破折号。 */
export function formatDelta(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  const fixed = value.toFixed(4)
  return value > 0 ? `+${fixed}` : fixed
}

/** 指纹 / id 短码（取前 8 位，避免长哈希撑破布局）。 */
export function shortHash(value: string | null | undefined): string {
  if (!value) return '—'
  return value.length > 8 ? `${value.slice(0, 8)}…` : value
}

/** 批次创建时间短格式（月/日 时:分）。 */
export function formatBatchTime(iso: string): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return iso
  }
}

/**
 * legacy = 快照未采集：四个冗余标量与快照 metricsJson 同源写入，
 * 全空即老批次（metrics_json 为 NULL，契约 §2.2 legacy 占位）。
 */
export function isLegacyBatch(
  row: Pick<
    BatchSummaryRow,
    'explorationRate' | 'depthDeltaAvg' | 'safetyDeltaAvg' | 'positiveEventRate'
  >,
): boolean {
  return (
    row.explorationRate === null &&
    row.depthDeltaAvg === null &&
    row.safetyDeltaAvg === null &&
    row.positiveEventRate === null
  )
}
