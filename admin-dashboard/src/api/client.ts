import type {
  SessionSummary, SessionDetail, CharacterBaseline, CharacterDetail,
  MemoryEntry, MemoryListResponse, PsyGuardStats, DashboardStats,
  TrajectoryState, PsyGuardTrend, CostTrendPoint, SessionCost,
  CharacterSession, HealthStatus, DeliberationStats,
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

async function patch<T>(path: string, body: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const auth = getAuthHeader()
  if (auth) headers.Authorization = auth

  const r = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  })

  if (r.status === 401) {
    sessionStorage.removeItem(CRED_KEY)
    const newAuth = promptCredentials()
    if (!newAuth) throw new Error('需要登录')
    const retry = await fetch(`${BASE}${path}`, {
      method: 'PATCH',
      headers: { ...headers, Authorization: newAuth },
      body: JSON.stringify(body),
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
    // 列出所有历史会话 (V2026-11-05 持久化)
    list: async (): Promise<Array<{ id: string; title: string; characterSlug: string; createdAt: string; updatedAt: string; turnCount: number; status: string }>> => {
      return get('/debug/sessions')
    },
    // 获取某个会话的完整 trace (messages 里来访者那条自带 trace)
    get: async (sessionId: string): Promise<{ id: string; title: string; characterSlug: string; createdAt: string; updatedAt: string; turnCount: number; status: string; messages: Array<{ role: string; text: string; turnIndex: number; ts: string; trace: unknown }> }> => {
      return get(`/debug/sessions/${sessionId}`)
    },
    // 更新会话标题
    update: async (sessionId: string, title: string): Promise<{ id: string; title: string }> => {
      return patch(`/debug/sessions/${sessionId}`, { title })
    },
    // 删除会话 (连文件一起删)
    remove: async (sessionId: string): Promise<{ id: string; deleted: boolean }> => {
      return del(`/debug/sessions/${sessionId}`)
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

  // ─── 仪表盘 (真 API · V2026-11-05) ───
  // 后端: GET /admin/api/dashboard (总览统计; 含 psyguard 子视图)
  dashboard: async (): Promise<DashboardStats> => {
    return get<DashboardStats>('/dashboard')
  },

  // ─── 近 7 天会话趋势 (真 API · V2026-11-05) ───
  // 后端: GET /admin/api/dashboard/weekly-sessions (行数恒 7, 没有会话的天补 0)
  weeklySessions: async (): Promise<{ date: string; count: number }[]> => {
    return get<{ date: string; count: number }[]>('/dashboard/weekly-sessions')
  },

  // ─── 记忆浏览器 (真 API · V2026-11-05) ───
  // 后端: GET /admin/api/memories (长时记忆; source='unavailable' = 向量库读不到)
  memories: async (): Promise<MemoryListResponse> => {
    return get<MemoryListResponse>('/memories')
  },

  // ─── PsyGUARD 监控 (真 API · V2026-11-05) ───
  // 后端: GET /admin/api/psyguard (真实探活; metricsAvailable=false = 指标未采集)
  psyguard: async (): Promise<PsyGuardStats> => {
    return get<PsyGuardStats>('/psyguard')
  },
  // 后端: GET /admin/api/psyguard/trend (近 7 天调用量趋势)
  psyguardTrend: async (): Promise<PsyGuardTrend> => {
    return get<PsyGuardTrend>('/psyguard/trend')
  },

  // ─── 成本看板（真 API · WP31） ───
  // 后端: GET /admin/api/cost/trend?days=N (按天聚合, 行数恒等于 days)
  costTrend: async (days = 7): Promise<CostTrendPoint[]> => {
    return get<CostTrendPoint[]>(`/cost/trend?days=${days}`)
  },
  // 后端: GET /admin/api/cost/sessions?limit=N (含成本口径 costBasis)
  sessionCosts: async (limit = 20): Promise<SessionCost[]> => {
    return get<SessionCost[]>(`/cost/sessions?limit=${limit}`)
  },

  // ─── 影子模式审议统计 (切灰度决策用) ───
  // 后端: GET /admin/api/deliberation/stats?days=N (Redis hash 计数器, O(1))
  // days 不传 = 累计值; days=7 = 最近 7 天
  deliberationStats: async (days?: number): Promise<DeliberationStats> => {
    const query = days ? `?days=${days}` : ''
    return get<DeliberationStats>(`/deliberation/stats${query}`)
  },
}
