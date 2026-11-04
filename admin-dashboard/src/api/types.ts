// 与后端 WP19-R AdminDebugModule API 契约对齐.
// 后端未覆盖的字段标记为可选, 前端渲染层要做空态兜底.

export interface BdiSnapshot {
  trust: number
  valence: number
  arousal: number
  resistance: number
  /** 内核按 valence×arousal 象限重算的离散标签 */
  anxiousSecure?: string | null
}

export interface RenderSpecSummary {
  taskKind?: string
  maxCompletionTokens?: number
  reasoningEffort?: string
  /** system 消息前 500 字截断预览 */
  promptPreview?: string
}

export interface LlmUsage {
  promptTokens: number
  completionTokens: number
  reasoningTokens: number
  ttftMs?: number
  finishReason?: string
}

export interface TurnTrace {
  turnIndex: number
  characterSlug?: string
  bdiSnapshot: BdiSnapshot
  renderSpec?: RenderSpecSummary
  llmUsage?: LlmUsage
  crisis: { detected: boolean; category?: string | null }
  ts: string
  /** 本轮 delta 明细（后端补，前端先 mock） */
  deltaDetail?: DeltaDetail
  /** 本轮 cap 砍幅报告（后端补，前端先 mock） */
  capReport?: CapReport
  /** 本轮信念激活状态（WP57 做完后接入，前端先 mock） */
  beliefActivation?: Record<string, number>
}

/** 单轮 delta 明细：各维度变化了多少 */
export interface DeltaDetail {
  trust: number
  safety: number
  bond: number
  valence: number
  arousal: number
  verbal: number
  depth: number
  style: number
  /** 触发的事件类型 */
  events: string[]
}

/** 单轮 cap 砍幅报告：哪些维度被砍了、砍了多少 */
export interface CapReport {
  /** 被砍的维度列表 */
  capped: {
    dimension: string
    rawDelta: number
    cappedDelta: number
    capLimit: number
  }[]
  /** 是否有维度被砍 */
  hasCapped: boolean
}

export interface TranscriptEntry { role: string; text: string }

export interface SessionSummary {
  sessionId: string
  characterSlug?: string
  visitorAlias: string
  startedAt: string | null
  endedAt: string | null
  durationSec: number
  status: string
  totalTokens: number
}

export interface SessionDetail extends SessionSummary {
  transcript: TranscriptEntry[]
  traces: TurnTrace[]
  report: ReportDetail
}

// ─── 安全判定 ───
export interface SafetyVerdict {
  level: 'pass' | 'warn' | 'block'
  ruleLevel: string
  ruleCategories: string[]
  probeLevel: string | null
  probeCategories: string[]
  probeScore?: number
  finalCategories: string[]
}

// ─── 报告详情 ───
export interface ReportAnnotation {
  type: 'good' | 'warn' | 'error'
  category: string
  message: string
  suggestion?: string
}

export interface ReportDetail {
  status: string
  dimensions: Record<string, number> | null
  annotations: ReportAnnotation[]
  techStats: Record<string, unknown> | null
}

// ─── 角色池 ───
export interface CharacterBaseline {
  slug: string
  codename: string
  attachmentStyle?: string
  baseline: {
    trust: number
    resist: number
    valence: number
    arousal: number
  }
  resistance?: {
    verbal: number
    depth: number
    style: number
  }
  enabled?: boolean
  auditStatus?: string
}

export interface CharacterDetail extends CharacterBaseline {
  fivePs: {
    presenting: string
    predisposing: string
    precipitating: string
    perpetuating: string
    protecting: string
  }
  expressionStyle: {
    speechVolumeBaseline: number
    narrativeStyle: string
    expressionTone: string
  }
  sessionCount: number
}

// ─── 记忆浏览器 ───
export type MemoryType = 'fact' | 'emotion' | 'relationship' | 'event' | 'preference'
export interface MemoryEntry {
  id: string
  visitorId: string
  visitorAlias?: string
  content: string
  type: MemoryType
  importance: number
  sourceSessionId?: string
  createdAt: string
  source: 'short_term' | 'long_term'
  supersededBy?: string
}

export interface MemoryGroup {
  visitorId: string
  total: number
  longTerm: number
  superseded: number
  entries: MemoryEntry[]
}

// ─── PsyGUARD 监控 ───
export interface PsyGuardStats {
  status: 'ok' | 'degraded' | 'down'
  modelLoaded: boolean
  p50Ms: number
  p90Ms: number
  totalRequests: number
  byCategory: Record<string, number>
}

// ─── 仪表盘 ───
export interface DashboardStats {
  totalSessions: number
  todaySessions: number
  crisisHits: number
  totalTokens: number
  estimatedCostCny: number
  psyguard: PsyGuardStats
}

// ─── 轨迹/剧本节点 ───
export interface TrajectoryNode {
  nodeId: string
  label: string
  type: 'entry' | 'branch' | 'crisis' | 'exit'
  triggeredAt: string | null
  description?: string
}

export interface TrajectoryState {
  scriptId: string
  scriptName: string
  currentNode: string | null
  path: string[]
  triggered: TrajectoryNode[]
}

// ─── 成本看板 ───
export interface CostTrendPoint {
  date: string
  tokens: number
  costCny: number
  sessions: number
}

export interface SessionCost {
  sessionId: string
  visitorAlias: string
  startedAt: string
  tokens: number
  costCny: number
}

// ─── 角色历史会话 ───
export interface CharacterSession {
  sessionId: string
  visitorAlias: string
  startedAt: string
  durationSec: number
  status: string
  totalTokens: number
}

// ─── 引擎健康状态 ───
export interface HealthStatus {
  status: string
  engineVoiceEnabled: boolean
  uptimeSec: number
}

// ─── PsyGUARD 趋势 ───
export interface PsyGuardTrendPoint {
  ts: string
  p50Ms: number
  p90Ms: number
  requests: number
}
