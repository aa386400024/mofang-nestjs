import type {
  SessionSummary, SessionDetail, CharacterBaseline, CharacterDetail,
  MemoryEntry, PsyGuardStats, DashboardStats,
  TrajectoryState, PsyGuardTrendPoint, CostTrendPoint, SessionCost,
  CharacterSession, HealthStatus,
} from './types'

const BASE = '/admin/api'

// ─── Basic Auth 凭据管理 ───
const CRED_KEY = 'admin_basic_auth'

function getAuthHeader(): string | null {
  const raw = sessionStorage.getItem(CRED_KEY)
  return raw ? `Basic ${raw}` : null
}

function promptCredentials(): string | null {
  const user = window.prompt('Admin 用户名')
  if (!user) return null
  const pass = window.prompt('Admin 密码')
  if (!pass) return null
  const encoded = btoa(`${user}:${pass}`)
  sessionStorage.setItem(CRED_KEY, encoded)
  return `Basic ${encoded}`
}

async function get<T>(path: string): Promise<T> {
  const headers: Record<string, string> = {}
  const auth = getAuthHeader()
  if (auth) headers.Authorization = auth

  const r = await fetch(`${BASE}${path}`, { headers })

  if (r.status === 401) {
    // 后端要求鉴权，弹框输入
    sessionStorage.removeItem(CRED_KEY)
    const newAuth = promptCredentials()
    if (!newAuth) throw new Error('需要登录')
    const retry = await fetch(`${BASE}${path}`, {
      headers: { Authorization: newAuth },
    })
    if (!retry.ok) throw new Error(`${path} → ${retry.status}`)
    return retry.json() as Promise<T>
  }

  if (!r.ok) throw new Error(`${path} → ${r.status}`)
  return r.json() as Promise<T>
}

// ─── 真实 API 端点 ───

export const api = {
  // ─── 会话列表（真 API） ───
  sessions: async (limit = 20): Promise<SessionSummary[]> => {
    return get<SessionSummary[]>(`/sessions?limit=${limit}`)
  },

  // ─── 会话详情（真 API） ───
  session: async (id: string): Promise<SessionDetail> => {
    return get<SessionDetail>(`/sessions/${id}`)
  },

  // ─── 角色池列表（真 API） ───
  characters: async (): Promise<CharacterBaseline[]> => {
    return get<CharacterBaseline[]>('/characters')
  },

  // ─── 引擎健康状态（真 API） ───
  health: async (): Promise<HealthStatus> => {
    return get<HealthStatus>('/health')
  },

  // ─── 以下为 mock，后端补 API 后切换 ───

  // ─── P1: 角色详情（mock，按 slug 查） ───
  character: async (slug: string): Promise<CharacterDetail> => ({
    slug,
    codename: slug,
    baseline: { trust: 0, resist: 0, valence: 0, arousal: 0 },
    fivePs: { presenting: '', predisposing: '', precipitating: '', perpetuating: '', protecting: '' },
    expressionStyle: { speechVolumeBaseline: 0.5, narrativeStyle: 'mixed', expressionTone: 'restrained' },
    sessionCount: 0,
  }),

  // ─── P1: 记忆浏览器（mock） ───
  memories: async (_visitorId?: string): Promise<MemoryEntry[]> => [],

  // ─── P2: PsyGUARD 监控（mock） ───
  psyguard: async (): Promise<PsyGuardStats> => ({
    status: 'ok', modelLoaded: true, p50Ms: 0, p90Ms: 0, totalRequests: 0, byCategory: {},
  }),
  psyguardTrend: async (): Promise<PsyGuardTrendPoint[]> => [],

  // ─── P1: 轨迹/剧本节点（mock） ───
  trajectory: async (_sessionId: string): Promise<TrajectoryState | null> => null,

  // ─── P2: 成本看板（mock） ───
  costTrend: async (): Promise<CostTrendPoint[]> => [],
  sessionCosts: async (): Promise<SessionCost[]> => [],

  // ─── 角色历史会话（mock） ───
  characterSessions: async (_slug: string): Promise<CharacterSession[]> => [],

  // ─── 近 7 天会话趋势（mock） ───
  weeklySessions: async (): Promise<{ date: string; count: number }[]> => [],

  // ─── 本场记忆（mock） ───
  sessionMemories: async (_sessionId: string): Promise<MemoryEntry[]> => [],

  // ─── 仪表盘（mock） ───
  dashboard: async (): Promise<DashboardStats> => ({
    totalSessions: 0, todaySessions: 0, crisisHits: 0, totalTokens: 0,
    estimatedCostCny: 0,
    psyguard: { status: 'ok', modelLoaded: true, p50Ms: 0, p90Ms: 0, totalRequests: 0, byCategory: {} },
  }),
}
