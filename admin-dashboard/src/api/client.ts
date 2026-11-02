import type {
  SessionSummary, SessionDetail, CharacterBaseline, CharacterDetail,
  MemoryEntry, PsyGuardStats, DashboardStats,
  TrajectoryState, PsyGuardTrendPoint, CostTrendPoint, SessionCost,
  CharacterSession,
} from './types'

const BASE = '/admin/api'

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`)
  if (!r.ok) throw new Error(`${path} → ${r.status}`)
  return r.json() as Promise<T>
}

// ─── mock 数据（后端补 API 前用，切换时把函数体换成 get<T>） ───

const mockDashboard: DashboardStats = {
  totalSessions: 47,
  todaySessions: 3,
  crisisHits: 5,
  totalTokens: 128450,
  estimatedCostCny: 12.45,
  psyguard: {
    status: 'ok', modelLoaded: true, p50Ms: 243, p90Ms: 248,
    totalRequests: 1320,
    byCategory: { suicide_plan: 8, passive_ideation: 15, self_harm_ideation: 6, neutral: 1291 },
  },
}

const mockCharacterDetail: Record<string, CharacterDetail> = {
  'vpt_intimate_avoidance_l1': {
    slug: 'vpt_intimate_avoidance_l1', codename: '晚晴', ageRange: '25-30',
    presentingComplaint: '亲密关系中难以敞开心扉，害怕被抛弃',
    defenseType: 'avoidant', issueDomain: '亲密关系', difficulty: 'L1',
    emotionBaseline: -0.2, defenseLevel: 0.6,
    fivePs: {
      presenting: '与男友第三次吵架后失眠，觉得对方不理解自己',
      predisposing: '从小父母情感疏离，习惯用回避处理冲突',
      precipitating: '男友周末加班未提前告知，感到被忽视',
      perpetuating: '每次想沟通就咽回去，积累后爆发',
      protecting: '有两个交往十年的朋友，偶尔能倾诉',
    },
    expressionStyle: { speechVolumeBaseline: 0.5, narrativeStyle: 'mixed', expressionTone: 'restrained' },
    sessionCount: 12,
  },
  'vpt_self_worth_intellectualization_l1': {
    slug: 'vpt_self_worth_intellectualization_l1', codename: '小满', ageRange: '22-25',
    presentingComplaint: '总觉得自己不够好，用理智压住情绪',
    defenseType: 'intellectualization', issueDomain: '自我价值', difficulty: 'L1',
    emotionBaseline: -0.1, defenseLevel: 0.5,
    fivePs: {
      presenting: '实习转正答辩后，反复想"哪里没做好"',
      predisposing: '从小被要求优秀，犯错=羞耻',
      precipitating: '领导评语里有一句"还可以更主动"',
      perpetuating: '用分析问题代替感受情绪，越分析越累',
      protecting: '喜欢跑步，运动时能短暂放松',
    },
    expressionStyle: { speechVolumeBaseline: 0.5, narrativeStyle: 'mixed', expressionTone: 'intellectualizing' },
    sessionCount: 8,
  },
}

const mockMemories: MemoryEntry[] = [
  { id: 'm001', visitorId: 'vpt_intimate_avoidance_l1', visitorAlias: '晚晴', content: '来访者提到男友周末加班未告知，感到被忽视', type: 'event', importance: 0.8, sourceSessionId: 'sess_001', createdAt: '2026-10-24T10:30:00Z', source: 'long_term' },
  { id: 'm002', visitorId: 'vpt_intimate_avoidance_l1', visitorAlias: '晚晴', content: '来访者习惯用回避处理亲密关系冲突，不主动表达需求', type: 'relationship', importance: 0.9, sourceSessionId: 'sess_001', createdAt: '2026-10-24T10:35:00Z', source: 'long_term' },
  { id: 'm003', visitorId: 'vpt_intimate_avoidance_l1', visitorAlias: '晚晴', content: '来访者提到有两个交往十年的朋友，偶尔能倾诉', type: 'fact', importance: 0.4, sourceSessionId: 'sess_001', createdAt: '2026-10-24T10:40:00Z', source: 'long_term' },
  { id: 'm004', visitorId: 'vpt_intimate_avoidance_l1', visitorAlias: '晚晴', content: '来访者小时候父母情感疏离，习惯了"说了也没用"', type: 'emotion', importance: 0.95, sourceSessionId: 'sess_001', createdAt: '2026-10-24T10:45:00Z', source: 'long_term' },
  { id: 'm005', visitorId: 'vpt_intimate_avoidance_l1', visitorAlias: '晚晴', content: '来访者提到和男友冷战三天后主动发了消息', type: 'event', importance: 0.7, sourceSessionId: 'sess_002', createdAt: '2026-10-26T14:20:00Z', source: 'long_term', supersededBy: 'm006' },
  { id: 'm006', visitorId: 'vpt_intimate_avoidance_l1', visitorAlias: '晚晴', content: '来访者提到和男友冷战三天后，是男友先主动找的她', type: 'event', importance: 0.75, sourceSessionId: 'sess_002', createdAt: '2026-10-26T14:25:00Z', source: 'long_term' },
  { id: 'm007', visitorId: 'vpt_intimate_avoidance_l1', visitorAlias: '晚晴', content: '来访者偏好安静、低压力的沟通方式', type: 'preference', importance: 0.5, sourceSessionId: 'sess_002', createdAt: '2026-10-26T14:30:00Z', source: 'long_term' },
  { id: 'm008', visitorId: 'vpt_intimate_avoidance_l1', visitorAlias: '晚晴', content: '来访者提到最近开始尝试写日记，记录情绪变化', type: 'preference', importance: 0.6, sourceSessionId: 'sess_005', createdAt: '2026-10-28T11:00:00Z', source: 'long_term' },
  { id: 'm009', visitorId: 'vpt_intimate_avoidance_l1', visitorAlias: '晚晴', content: '来访者表示这周主动跟男友表达了一次需求，虽然很紧张', type: 'event', importance: 0.85, sourceSessionId: 'sess_005', createdAt: '2026-10-28T11:10:00Z', source: 'long_term' },
  { id: 'm010', visitorId: 'vpt_self_worth_intellectualization_l1', visitorAlias: '小满', content: '来访者用理智化防御，用分析问题代替感受情绪', type: 'emotion', importance: 0.9, sourceSessionId: 'sess_003', createdAt: '2026-10-25T16:00:00Z', source: 'long_term' },
  { id: 'm011', visitorId: 'vpt_self_worth_intellectualization_l1', visitorAlias: '小满', content: '来访者实习转正答辩后，反复想"哪里没做好"', type: 'event', importance: 0.8, sourceSessionId: 'sess_003', createdAt: '2026-10-25T16:10:00Z', source: 'long_term' },
  { id: 'm012', visitorId: 'vpt_self_worth_intellectualization_l1', visitorAlias: '小满', content: '来访者从小被要求优秀，犯错=羞耻', type: 'fact', importance: 0.95, sourceSessionId: 'sess_003', createdAt: '2026-10-25T16:15:00Z', source: 'long_term' },
  { id: 'm013', visitorId: 'vpt_self_worth_intellectualization_l1', visitorAlias: '小满', content: '来访者喜欢跑步，运动时能短暂放松', type: 'preference', importance: 0.6, sourceSessionId: 'sess_003', createdAt: '2026-10-25T16:20:00Z', source: 'long_term' },
  { id: 'm014', visitorId: 'vpt_self_worth_intellectualization_l1', visitorAlias: '小满', content: '来访者提到这周试着在答辩后不自我分析，而是去散步', type: 'event', importance: 0.7, sourceSessionId: 'sess_006', createdAt: '2026-10-27T15:30:00Z', source: 'long_term' },
  { id: 'm015', visitorId: 'vpt_self_worth_intellectualization_l1', visitorAlias: '小满', content: '来访者说跟导师聊了一次，感觉没那么怕犯错了', type: 'relationship', importance: 0.85, sourceSessionId: 'sess_006', createdAt: '2026-10-27T15:40:00Z', source: 'long_term' },
]

// P1: 轨迹 mock
const mockTrajectory: Record<string, TrajectoryState> = {
  'sess_demo_001': {
    scriptId: 'wp10_blindbox_03',
    scriptName: '伦理盲盒 #03 · 自杀意念探测',
    currentNode: 'branch_crisis_probe',
    path: ['entry', 'rapport_building', 'branch_crisis_probe'],
    triggered: [
      { nodeId: 'entry', label: '开场建立关系', type: 'entry', triggeredAt: '2026-10-30T10:00:00Z', description: '咨询师自我介绍，说明设置与保密例外' },
      { nodeId: 'rapport_building', label: '建立咨访关系', type: 'branch', triggeredAt: '2026-10-30T10:03:00Z', description: '来访者讲述最近的生活压力' },
      { nodeId: 'branch_crisis_probe', label: '危机探测分支', type: 'crisis', triggeredAt: '2026-10-30T10:08:00Z', description: '来访者提到"活着没什么意思"，触发自杀意念探测协议' },
    ],
  },
}

// P2: PsyGUARD 趋势 mock
const mockPsyGuardTrend: PsyGuardTrendPoint[] = Array.from({ length: 24 }, (_, i) => ({
  ts: `${String(i).padStart(2, '0')}:00`,
  p50Ms: 230 + Math.round(Math.random() * 30),
  p90Ms: 245 + Math.round(Math.random() * 20),
  requests: Math.round(40 + Math.random() * 80),
}))

// P2: 成本 mock
const mockCostTrend: CostTrendPoint[] = Array.from({ length: 7 }, (_, i) => {
  const d = new Date()
  d.setDate(d.getDate() - (6 - i))
  return {
    date: `${d.getMonth() + 1}/${d.getDate()}`,
    tokens: Math.round(12000 + Math.random() * 8000),
    costCny: +(1.2 + Math.random() * 0.8).toFixed(2),
    sessions: Math.round(3 + Math.random() * 4),
  }
})
const mockSessionCosts: SessionCost[] = [
  { sessionId: 'sess_001', visitorAlias: '晚晴', startedAt: '2026-10-30 10:00', tokens: 4200, costCny: 0.42 },
  { sessionId: 'sess_002', visitorAlias: '小满', startedAt: '2026-10-30 09:15', tokens: 3800, costCny: 0.38 },
  { sessionId: 'sess_003', visitorAlias: '亦舟', startedAt: '2026-10-29 16:30', tokens: 5100, costCny: 0.51 },
  { sessionId: 'sess_004', visitorAlias: '晚晴', startedAt: '2026-10-29 14:00', tokens: 3500, costCny: 0.35 },
]

// 角色历史会话 mock
const mockCharacterSessions: Record<string, CharacterSession[]> = {
  vpt_intimate_avoidance_l1: [
    { sessionId: 'sess_001', visitorAlias: '晚晴', startedAt: '2026-10-24 10:00', durationSec: 1240, status: 'completed', totalTokens: 4200 },
    { sessionId: 'sess_002', visitorAlias: '晚晴', startedAt: '2026-10-26 14:00', durationSec: 980, status: 'completed', totalTokens: 3500 },
    { sessionId: 'sess_005', visitorAlias: '晚晴', startedAt: '2026-10-28 11:00', durationSec: 1120, status: 'completed', totalTokens: 3900 },
  ],
  vpt_self_worth_intellectualization_l1: [
    { sessionId: 'sess_003', visitorAlias: '小满', startedAt: '2026-10-25 16:00', durationSec: 1100, status: 'completed', totalTokens: 3800 },
    { sessionId: 'sess_006', visitorAlias: '小满', startedAt: '2026-10-27 15:30', durationSec: 1050, status: 'completed', totalTokens: 3600 },
  ],
}

// 近 7 天会话趋势 mock
const mockWeeklySessions = Array.from({ length: 7 }, (_, i) => {
  const d = new Date()
  d.setDate(d.getDate() - (6 - i))
  return {
    date: `${d.getMonth() + 1}/${d.getDate()}`,
    count: Math.round(2 + Math.random() * 5),
  }
})

export const api = {
  // ─── 已有 API ───
  sessions: async (limit = 20): Promise<SessionSummary[]> => {
    // mock：从记忆和角色数据生成会话列表
    const ids = ['sess_001', 'sess_002', 'sess_003', 'sess_005', 'sess_006']
    return ids.map((id, i) => ({
      sessionId: id,
      visitorAlias: i < 3 ? '晚晴' : '小满',
      startedAt: ['2026-10-24T10:00:00Z', '2026-10-26T14:00:00Z', '2026-10-25T16:00:00Z', '2026-10-28T11:00:00Z', '2026-10-27T15:30:00Z'][i],
      endedAt: null,
      durationSec: 900 + i * 120,
      status: 'completed',
      totalTokens: 3200 + i * 500,
    })).slice(0, limit)
  },

  session: async (id: string): Promise<SessionDetail> => {
    // mock：生成一个默认会话详情
    const isWanqing = id.startsWith('sess_001') || id.startsWith('sess_002') || id.startsWith('sess_005')
    return {
      sessionId: id,
      visitorAlias: isWanqing ? '晚晴' : '小满',
      startedAt: '2026-10-24T10:00:00Z',
      endedAt: null,
      durationSec: 1200,
      status: 'completed',
      totalTokens: 4200,
      transcript: [
        { role: 'counselor', text: '你好，我是这次的咨询师，今天想聊点什么？' },
        { role: 'visitor', text: '嗯…最近跟男友又吵架了，感觉他总是不理解我。' },
        { role: 'counselor', text: '能具体说说吗？这次是因为什么事情？' },
        { role: 'visitor', text: '他周末加班没提前告诉我，我等了他一晚上。' },
      ],
      traces: [
        { turnIndex: 0, bdi: { trust: 0.2, valence: -0.1, arousal: 0.3, resistance: 0.4, attachmentType: 'avoidant' }, usage: { completionTokens: 120, reasoningTokens: 0, totalTokens: 120 }, crisis: { detected: false, category: null }, ts: '2026-10-24T10:00:00Z' },
        { turnIndex: 1, bdi: { trust: 0.3, valence: -0.3, arousal: 0.5, resistance: 0.5, attachmentType: 'avoidant' }, usage: { completionTokens: 180, reasoningTokens: 20, totalTokens: 200 }, crisis: { detected: false, category: null }, ts: '2026-10-24T10:02:00Z' },
        { turnIndex: 2, bdi: { trust: 0.4, valence: -0.2, arousal: 0.4, resistance: 0.45, attachmentType: 'avoidant' }, usage: { completionTokens: 150, reasoningTokens: 10, totalTokens: 160 }, crisis: { detected: false, category: null }, ts: '2026-10-24T10:04:00Z' },
      ],
      report: {
        status: 'completed',
        dimensions: { trust: 0.6, valence: 0.3, arousal: 0.4, resistance: 0.3, empathy: 0.7, insight: 0.5 },
        annotations: [
          { type: 'good', category: 'rapport', message: '咨访关系建立良好', suggestion: '继续保持温和、非评判的态度' },
          { type: 'warn', category: 'avoidance', message: '来访者倾向于回避深层情感表达', suggestion: '可适当使用开放式提问，鼓励探索情绪' },
        ],
        techStats: { totalTokens: 4200, durationSec: 1200, turns: 12 },
      },
    }
  },

  characters: async (): Promise<CharacterBaseline[]> => {
    return Object.values(mockCharacterDetail).map(({ fivePs, expressionStyle, sessionCount, ...rest }) => rest)
  },
  health: async () => ({ status: 'ok' as const, engineVoiceEnabled: true, uptimeSec: 3600 }),

  // ─── P0: 仪表盘（mock） ───
  dashboard: async (): Promise<DashboardStats> => mockDashboard,

  // ─── P1: 角色详情（mock，按 slug 查） ───
  character: async (slug: string): Promise<CharacterDetail> =>
    mockCharacterDetail[slug] ?? {
      slug, codename: slug, ageRange: '', presentingComplaint: '',
      defenseType: '', issueDomain: '', difficulty: '',
      emotionBaseline: 0, defenseLevel: 0,
      fivePs: { presenting: '', predisposing: '', precipitating: '', perpetuating: '', protecting: '' },
      expressionStyle: { speechVolumeBaseline: 0.5, narrativeStyle: 'mixed', expressionTone: 'restrained' },
      sessionCount: 0,
    },

  // ─── P1: 记忆浏览器（mock） ───
  memories: async (visitorId?: string): Promise<MemoryEntry[]> =>
    visitorId ? mockMemories.filter(m => m.visitorId === visitorId) : mockMemories,

  // ─── P2: PsyGUARD 监控（mock） ───
  psyguard: async (): Promise<PsyGuardStats> => mockDashboard.psyguard,
  psyguardTrend: async (): Promise<PsyGuardTrendPoint[]> => mockPsyGuardTrend,

  // ─── P1: 轨迹/剧本节点（mock，按 sessionId） ───
  trajectory: async (sessionId: string): Promise<TrajectoryState | null> =>
    mockTrajectory[sessionId] ?? null,

  // ─── P2: 成本看板（mock） ───
  costTrend: async (): Promise<CostTrendPoint[]> => mockCostTrend,
  sessionCosts: async (): Promise<SessionCost[]> => mockSessionCosts,

  // ─── 角色历史会话（mock） ───
  characterSessions: async (slug: string): Promise<CharacterSession[]> =>
    mockCharacterSessions[slug] ?? [],

  // ─── 近 7 天会话趋势（mock） ───
  weeklySessions: async (): Promise<{ date: string; count: number }[]> => mockWeeklySessions,

  // ─── 本场记忆（mock，后端补 API 后切换） ───
  sessionMemories: async (sessionId: string): Promise<MemoryEntry[]> =>
    mockMemories.filter(m => m.sourceSessionId === sessionId),
}
