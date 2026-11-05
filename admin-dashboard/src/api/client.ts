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

async function post<T>(path: string, body: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const auth = getAuthHeader()
  if (auth) headers.Authorization = auth

  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  if (r.status === 401) {
    sessionStorage.removeItem(CRED_KEY)
    const newAuth = promptCredentials()
    if (!newAuth) throw new Error('需要登录')
    const retry = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { ...headers, Authorization: newAuth },
      body: JSON.stringify(body),
    })
    if (!retry.ok) throw new Error(`${path} → ${retry.status}`)
    return retry.json() as Promise<T>
  }

  if (!r.ok) throw new Error(`${path} → ${r.status}`)
  return r.json() as Promise<T>
}

async function del<T>(path: string): Promise<T> {
  const headers: Record<string, string> = {}
  const auth = getAuthHeader()
  if (auth) headers.Authorization = auth

  const r = await fetch(`${BASE}${path}`, {
    method: 'DELETE',
    headers,
  })

  if (r.status === 401) {
    sessionStorage.removeItem(CRED_KEY)
    const newAuth = promptCredentials()
    if (!newAuth) throw new Error('需要登录')
    const retry = await fetch(`${BASE}${path}`, {
      method: 'DELETE',
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

  // ─── 调试会话（WP58） ───
  debugSession: {
    create: async (characterSlug: string): Promise<{ sessionId: string; debugSessionId: string; characterSlug: string; characterLabel: string; createdAt: string }> => {
      return post('/debug/session', { characterSlug })
    },
    turn: async (sessionId: string, counselorText: string): Promise<{ turnIndex: number; reply: string; trace: unknown }> => {
      return post(`/debug/session/${sessionId}/turn`, { counselorText })
    },
    close: async (sessionId: string): Promise<{ sessionId: string; closed: boolean }> => {
      return del(`/debug/session/${sessionId}`)
    },
  },

  // ─── 角色详情（真 API · WP30） ───
  // 后端: GET /admin/api/characters/:slug (character_profiles 单行 + 会话数)
  character: async (slug: string): Promise<CharacterDetail> => {
    return get<CharacterDetail>(`/characters/${slug}`)
  },

  // ─── 角色历史会话（真 API · WP30） ───
  // 后端: GET /admin/api/characters/:slug/sessions (按留痕里的 characterSlug 过滤)
  characterSessions: async (slug: string): Promise<CharacterSession[]> => {
    return get<CharacterSession[]>(`/characters/${slug}/sessions`)
  },

  // ─── 轨迹/剧本节点（真 API · WP30） ───
  // 后端: GET /admin/api/sessions/:id/trajectory (返 null = 本场无剧本)
  trajectory: async (sessionId: string): Promise<TrajectoryState | null> => {
    return get<TrajectoryState | null>(`/sessions/${sessionId}/trajectory`)
  },

  // ─── 本场记忆（真 API · WP30） ───
  // 后端: GET /admin/api/sessions/:id/memories
  // 注: 后端当前恒返空数组 (training_sessions 无 memories 列), 见交付记录 §缺口 G1
  sessionMemories: async (sessionId: string): Promise<MemoryEntry[]> => {
    return get<MemoryEntry[]>(`/sessions/${sessionId}/memories`)
  },

  // ─── 以下为 mock，后端补 API 后切换 ───

  // ─── P1: 记忆浏览器（mock · 页面尚未接真 API） ───
  memories: async (_visitorId?: string): Promise<MemoryEntry[]> => [],

  // ─── P2: PsyGUARD 监控（mock） ───
  psyguard: async (): Promise<PsyGuardStats> => ({
    status: 'ok', modelLoaded: true, p50Ms: 0, p90Ms: 0, totalRequests: 0, byCategory: {},
  }),
  psyguardTrend: async (): Promise<PsyGuardTrendPoint[]> => [],

  // ─── P2: 成本看板（mock） ───
  costTrend: async (): Promise<CostTrendPoint[]> => [],
  sessionCosts: async (): Promise<SessionCost[]> => [],

  // ─── 近 7 天会话趋势（mock） ───
  weeklySessions: async (): Promise<{ date: string; count: number }[]> => [],

  // ─── 仪表盘（mock） ───
  dashboard: async (): Promise<DashboardStats> => ({
    totalSessions: 0, todaySessions: 0, crisisHits: 0, totalTokens: 0,
    estimatedCostCny: 0,
    psyguard: { status: 'ok', modelLoaded: true, p50Ms: 0, p90Ms: 0, totalRequests: 0, byCategory: {} },
  }),
}
