// 与后端 WP19 AdminDebugModule API 契约对齐.
// 后端未覆盖的字段标记为可选, 前端渲染层要做空态兜底.
// P1/P2 视图的数据先 mock, 后端补 API 后切换.

export interface BdiSnapshot {
  trust: number; valence: number; arousal: number
  resistance: number; attachmentType: string
}
export interface TurnTrace {
  turnIndex: number
  bdi: BdiSnapshot
  render?: {
    taskKind?: string
    effort?: string
    maxTokens?: number
    system?: string
    context?: string
    instructions?: string
  }
  usage: { completionTokens: number; reasoningTokens: number; totalTokens: number }
  crisis: { detected: boolean; category: string | null }
  /** P0: 安全判定详情（后端补 API 后切换，当前 mock） */
  safety?: SafetyVerdict
  ts: string
}
export interface TranscriptEntry { role: string; text: string }
export interface SessionSummary {
  sessionId: string
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

// ─── P0: 安全判定 ───
export interface SafetyVerdict {
  level: 'pass' | 'warn' | 'block'
  ruleLevel: string
  ruleCategories: string[]
  probeLevel: string | null
  probeCategories: string[]
  probeScore?: number
  finalCategories: string[]
}

// ─── P0: 报告详情 ───
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

// ─── P1: 角色详情 ───
export interface CharacterBaseline {
  slug: string
  codename: string
  ageRange: string
  presentingComplaint: string
  defenseType: string
  issueDomain: string
  difficulty: string
  emotionBaseline: number
  defenseLevel: number
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

// ─── P1: 记忆浏览器 ───
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

// ─── P2: PsyGUARD 监控 ───
export interface PsyGuardStats {
  status: 'ok' | 'degraded' | 'down'
  modelLoaded: boolean
  p50Ms: number
  p90Ms: number
  totalRequests: number
  byCategory: Record<string, number>
}

// ─── P0: 仪表盘 ───
export interface DashboardStats {
  totalSessions: number
  todaySessions: number
  crisisHits: number
  totalTokens: number
  estimatedCostCny: number
  psyguard: PsyGuardStats
}

// ─── P1: 轨迹/剧本节点 ───
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

// ─── P2: PsyGUARD 监控趋势 ───
export interface PsyGuardTrendPoint {
  ts: string
  p50Ms: number
  p90Ms: number
  requests: number
}

// ─── P2: 成本看板 ───
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
