// 与后端 WP19 AdminDebugModule API 契约对齐.
// 后端未落地前 USE_MOCK=true 走假数据; 落地后改 false.

export interface BdiSnapshot {
  trust: number; valence: number; arousal: number
  resistance: number; attachmentType: string
}
export interface TurnTrace {
  turnIndex: number
  bdi: BdiSnapshot
  render: {
    taskKind: string
    effort: string
    maxTokens: number
    system: string
    context: string
    instructions: string
  }
  usage: { promptTokens: number; completionTokens: number; reasoningTokens: number; ttftMs: number; finishReason: string }
  crisis: { detected: boolean; category: string | null }
  ts: string
}
export interface TranscriptEntry { role: 'counselor' | 'visitor'; text: string; ts: string }
export interface SessionSummary {
  sessionId: string; characterSlug: string; visitorAlias: string
  startedAt: string; endedAt: string | null; durationSec: number
  status: string; totalTokens: number
}
export interface SessionDetail extends SessionSummary {
  turns: TurnTrace[]; transcript: TranscriptEntry[]; report: SessionReport
}
export interface CharacterBaseline {
  slug: string; codename: string; attachmentType: string
  trust: number; resistance: number; valence: number; arousal: number; status: string
}

export interface ReportDimensions {
  empathy: number; activeListening: number; questioning: number
  boundary: number; response: number; professionalism: number
}
export interface ReportAnnotation {
  type: 'good' | 'warn' | 'error'
  category: string; message: string; suggestion?: string
}
export interface ReportTechStats {
  commentary: string
}
export interface SessionReport {
  status: 'pending' | 'completed' | 'parse_error' | 'no_content'
  overallScore: number | null
  dimensions: ReportDimensions | null
  annotations: ReportAnnotation[]
  growthSuggestions: string[]
  techStats: ReportTechStats | null
}
