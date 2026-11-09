// 与后端 WP19-R AdminDebugModule API 契约对齐.
// 后端未覆盖的字段标记为可选, 前端渲染层要做空态兜底.

export interface BdiSnapshot {
  trust: number
  /** 关系安全感 [0,1]（WP42） */
  safety?: number
  /** 关系联结 [0,1]（WP42） */
  bond?: number
  valence: number
  arousal: number
  resistance: number
  /** 阻抗三维：话量（WP1） */
  resistanceVerbal?: number
  /** 阻抗三维：深度（WP1） */
  resistanceDepth?: number
  /** 阻抗三维：风格（WP1） */
  resistanceStyle?: number
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
  /** 本轮审议闸门决策（WP-C 做完后接入） */
  gateDecision?: {
    decision: 'run' | 'skip'
    reason: string
    thresholdUsed: number
  }
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
// V2026-11-05: 契约与**内核口径**对齐 (原来那套 `type: fact|emotion|...`
//   是前端自造的"内容分类", 后端没有任何分类器 —— 留着就是假维度, 已删).
//   现在只有内核**真有的**两个维度: 分层 (tier) 与来源 (source).
export type MemoryTier = 'working' | 'short_term' | 'long_term'
export type MemorySource = 'turn' | 'summary' | 'manual'

export interface MemoryEntry {
  id: string
  /**
   * 归属作用域 (内核 `visitorId`).
   *
   * ⚠️ 形状是 `"{学员id}:{角色key}"` —— 是**归属键**, 不是人类可读的名字.
   */
  visitorId: string
  content: string
  /** 记忆分层 (working / short_term / long_term). */
  tier: MemoryTier
  /** 记忆来源 (turn = 轮次原文 / summary = 模型摘要 / manual = 人工注入). */
  source: MemorySource
  importance: number
  /** 来源会话 id (可空). */
  sessionId?: string
  createdAt: string
  /** 被谁取代 (冲突消解标记). */
  supersededBy?: string
}

export interface MemoryListResponse {
  /** 记忆条目 (可能为空). */
  entries: MemoryEntry[]
  /**
   * 口径: 只含**长时记忆** (工作/短时记忆在进程内的会话级回落仓里,
   * 内核 `MemoryStore` 端口没有 list-all —— 拿不到).
   */
  scope: 'long_term'
  /**
   * 数据源状态:
   * · `qdrant`      = 读到了 (可能是 0 条);
   * · `unavailable` = **向量库读不到** (没配 / 不可达 / collection 不存在).
   */
  source: 'qdrant' | 'unavailable'
  /** 本次返回的条数. */
  total: number
  /** 单次上限 (后端扫描窗口). */
  limit: number
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
  /** 模型是否已加载 (真值: 探 `/health` 的 `model_loaded`). */
  modelLoaded: boolean
  /** 11 类标签口径是否与内核一致. */
  contractOk: boolean
  /**
   * 延迟 / 请求量指标**是否已采集**.
   *
   * ⚠️ 当前后端**未采集** (恒 false) → 下面的 p50/p90/totalRequests 是 0,
   *   那意思是"**没数**", 不是"调用了 0 次". 前端据此显示"指标未采集",
   *   不拿 0 画一条贴着底的假曲线.
   */
  metricsAvailable: boolean
  p50Ms: number
  p90Ms: number
  totalRequests: number
  byCategory: Record<string, number>
  /** 本次探活时刻 (ISO). */
  checkedAt: string
}

// ─── 仪表盘 ───
export interface DashboardStats {
  /** 总会话数 (会话表全量 count). */
  totalSessions: number
  /** 今日会话数 (Asia/Shanghai 口径). */
  todaySessions: number
  crisisHits: number
  totalTokens: number
  estimatedCostCny: number
  /** 平均每会话轮次 (分母 = **有留痕的**会话数). */
  avgTurnsPerSession: number
  /** 参与 token / 轮次 / 成本聚合的会话数 (扫描窗口内). */
  sessionsScanned: number
  /** 扫描窗口是否被截断 (true = 还有更早的会话没算进来). */
  truncated: boolean
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
  /** 开场时刻；未开场 / 无记录时为 null */
  startedAt: string | null
  /** 本场 token 总量（输入 + 输出，与 `/admin/api/sessions` 的 totalTokens 同口径） */
  totalTokens: number
  costCny: number
  /**
   * 成本口径：
   * - `full` —— 输入输出都计，这是全场成本；
   * - `output_only` —— 上游没报输入侧用量，成本只是**下界**。
   */
  costBasis: 'full' | 'output_only'
}

// ─── 角色历史会话 ───
export interface CharacterSession {
  sessionId: string
  visitorAlias: string
  /** 开场时刻；未开场 / 无记录时为 null（后端列可空，前端按空态渲染） */
  startedAt: string | null
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

export interface PsyGuardTrend {
  /** 指标是否已采集 (当前后端未采集 → false, points 全 0). */
  metricsAvailable: boolean
  /** 趋势点 (行数恒等于窗口天数). */
  points: PsyGuardTrendPoint[]
}

// ─── 影子模式审议统计 (切灰度决策用) ───

/** 统计窗口口径 */
export interface DeliberationStatsWindow {
  /** 模式: all = 累计, days = 最近 N 天, range = 自定义区间 */
  mode: 'all' | 'days' | 'range'
  /** 最近 N 天 (mode=days 时有效) */
  days?: number
  /** 起始日期 (mode=range 时有效, YYYY-MM-DD) */
  from?: string
  /** 结束日期 (mode=range 时有效, YYYY-MM-DD) */
  to?: string
  /** 窗口内有数据的天数 (日 key 从某天才有 → 头几天不满窗) */
  daysCovered: number
}

export interface DeliberationStats {
  /** 总轮次 (成功 + 失败) */
  totalTurns: number
  /** 成功轮次 */
  successTurns: number
  /** 失败轮次 (含熔断跳过) */
  failureTurns: number
  /** 成功率 0-1 */
  successRate: number
  /** 失败原因分布 (错误码 → 次数) */
  failureByErrorCode: Record<string, number>
  /** 平均耗时 ms (含失败轮次) */
  avgDurationMs: number
  /** 最大耗时 ms (精确值) */
  maxDurationMs: number
  /** P50 耗时 ms (桶上界估计) */
  p50DurationMs: number
  /** P95 耗时 ms (桶上界估计) */
  p95DurationMs: number
  /** 平均重试次数 */
  avgRetryCount: number
  /** 平均 prompt tokens */
  avgPromptTokens: number
  /** 平均 completion tokens */
  avgCompletionTokens: number
  /** deltaDiff 平均绝对值 (分母=成功轮次) */
  avgDeltaDiffAbs: number
  /** deltaDiff 最大绝对值 (精确值) */
  maxDeltaDiffAbs: number
  /** 过期率 0-1 (分母=成功轮次) */
  staleRate: number
  /** 被砍维度分布 (维度 → 次数) */
  capByDimension: Record<string, number>
  /** 临床 flagged 分布 (规则 → 次数) */
  clinicalByRule: Record<string, number>
  /** 临床 flagged 轮次占比 0-1 */
  flaggedTurnRate: number
  /** 窗口口径 (这批数是哪段时间的) */
  window: DeliberationStatsWindow
}

// ─── 自动对练 (Phase2.5 WP-D) ───

/** 咨询师模式 (ap_counselor_modes 表) */
export interface CounselorMode {
  id: string
  name: string
  systemPrompt: string
  description: string
  enabled: number
  sortOrder: number
  createdAt: string
  updatedAt: string
}

/** 对练场次 (ap_practice_sessions 表) */
export interface PracticeSession {
  id: string
  debugSessionId: string
  characterSlug: string
  counselorModeId: string
  status: 'running' | 'completed' | 'failed'
  maxTurns: number
  turnCount: number
  crisisEnded: number
  exitReason: string | null
  batchId: string | null
  modelVersion: string | null
  seedValue: string | null
  totalCost: number | null
  errorMessage: string | null
  startedAt: string
  finishedAt: string | null
  createdAt: string
  updatedAt: string
}

/** 批量进度汇总 */
export interface BatchProgress {
  batchId: string
  total: number
  byStatus: Record<string, number>
  sessions: Array<{
    id: string
    characterSlug: string
    counselorModeId: string
    status: string
    turnCount: number
    exitReason: string | null
  }>
}

/** WS: 一场开始 */
export interface ApSessionStart {
  practiceSessionId: string
  debugSessionId: string
  characterSlug: string
  counselorModeId: string
  maxTurns: number
}

/** WS: 一轮对话 */
export interface ApTurn {
  practiceSessionId: string
  turnIndex: number
  counselorText: string
  visitorText: string
  crisisDetected: boolean
  trace: TurnTrace | null
}

/** WS: 一场结束 */
export interface ApSessionEnd {
  practiceSessionId: string
  status: string
  exitReason: string
  turnCount: number
  crisisEnded: boolean
}
