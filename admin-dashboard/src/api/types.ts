// 与后端 WP19 AdminDebugModule API 契约对齐.
// 后端未覆盖的字段标记为可选, 前端渲染层要做空态兜底.

export interface BdiSnapshot {
  trust: number; valence: number; arousal: number
  resistance: number; attachmentType: string
}
export interface TurnTrace {
  turnIndex: number
  bdi: BdiSnapshot
  /** WP19 后端暂未捕获 prompt 分段, 预留空对象. */
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
  report: {
    status: string
    techStats: Record<string, unknown> | null
  }
}
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
