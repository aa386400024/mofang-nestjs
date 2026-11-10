import type {
  SessionSummary, SessionDetail, CharacterBaseline, CharacterDetail,
  MemoryEntry, MemoryListResponse, PsyGuardStats, DashboardStats,
  TrajectoryState, PsyGuardTrend, CostTrendPoint, SessionCost,
  CharacterSession, HealthStatus, DeliberationStats,
  CounselorMode, PracticeSession, BatchProgress,
  EvalReportListResponse, EvalReportDetail, GateTraceListResponse, GateStatsResponse,
  AnnotationListResponse, AnnotationDetail, AnnotationSaveBody, AnnotationReveal,
  AnnotationConsistency, AnnotationRow,
} from './types'

const BASE = '/admin/api'
const CRED_KEY = 'admin_basic_auth'

// ─── Auth 凭据 ───
export function getAuthHeader(): string | null {
  const raw = sessionStorage.getItem(CRED_KEY)
  return raw ? `Basic ${raw}` : null
}

export function clearAuth(): void {
  sessionStorage.removeItem(CRED_KEY)
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

// ─── 核心请求函数（统一处理 method / headers / 401 重试） ───
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const doFetch = (auth: string | null) => {
    const headers: Record<string, string> = {}
    if (auth) headers.Authorization = auth
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    return fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  }

  let r = await doFetch(getAuthHeader())

  // 401 → 重新弹框输凭据 → 重试一次
  if (r.status === 401) {
    clearAuth()
    const newAuth = promptCredentials()
    if (!newAuth) throw new Error('需要登录')
    r = await doFetch(newAuth)
  }

  if (!r.ok) throw new Error(`${path} → ${r.status}`)
  return r.json() as Promise<T>
}

// HTTP 方法代理
const get  = <T>(path: string) => request<T>('GET', path)
const post = <T>(path: string, body: unknown) => request<T>('POST', path, body)
const put  = <T>(path: string, body: unknown) => request<T>('PUT', path, body)
const patch = <T>(path: string, body: unknown) => request<T>('PATCH', path, body)
const del  = <T>(path: string) => request<T>('DELETE', path)

// ─── 真实 API 端点 ───

export const api = {
  // ─── 会话列表 ───
  sessions: async (limit = 20): Promise<SessionSummary[]> => {
    return get<SessionSummary[]>(`/sessions?limit=${limit}`)
  },

  // ─── 会话详情 ───
  session: async (id: string): Promise<SessionDetail> => {
    return get<SessionDetail>(`/sessions/${id}`)
  },

  // ─── 角色池列表 ───
  characters: async (): Promise<CharacterBaseline[]> => {
    return get<CharacterBaseline[]>('/characters')
  },

  // ─── 引擎健康状态 ───
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
    list: async (): Promise<Array<{ id: string; title: string; characterSlug: string; createdAt: string; updatedAt: string; turnCount: number; status: string; active: boolean }>> => {
      return get('/debug/sessions')
    },
    get: async (sessionId: string): Promise<{ id: string; title: string; characterSlug: string; createdAt: string; updatedAt: string; turnCount: number; status: string; messages: Array<{ role: string; text: string; turnIndex: number; ts: string; trace: unknown }> }> => {
      return get(`/debug/sessions/${sessionId}`)
    },
    update: async (sessionId: string, title: string): Promise<{ id: string; title: string }> => {
      return patch(`/debug/sessions/${sessionId}`, { title })
    },
    remove: async (sessionId: string): Promise<{ id: string; deleted: boolean }> => {
      return del(`/debug/sessions/${sessionId}`)
    },
    resume: async (sessionId: string): Promise<{ sessionId: string; resumed: boolean; turnCount: number }> => {
      return post(`/debug/session/${sessionId}/resume`, {})
    },
    deltaAudit: async (sessionId: string): Promise<{ sessionId: string; turns: Array<{
      turnIndex: number
      events: string[]
      rawDeltas: Record<string, number>
      cappedDeltas: Record<string, number>
      capApplied: boolean
      crisisDetected: boolean
    }> }> => {
      const res = await get<{ code: number; data: { sessionId: string; turns: Array<{
        turnIndex: number
        events: string[]
        rawDeltas: Record<string, number>
        cappedDeltas: Record<string, number>
        capApplied: boolean
        crisisDetected: boolean
      }> } }>(`/debug/sessions/${sessionId}/delta-audit`)
      return res.data
    },
  },

  // ─── 角色详情（WP30） ───
  character: async (slug: string): Promise<CharacterDetail> => {
    return get<CharacterDetail>(`/characters/${slug}`)
  },

  // ─── 角色历史会话 ───
  characterSessions: async (slug: string): Promise<CharacterSession[]> => {
    return get<CharacterSession[]>(`/characters/${slug}/sessions`)
  },

  // ─── 轨迹/剧本节点 ───
  trajectory: async (sessionId: string): Promise<TrajectoryState | null> => {
    return get<TrajectoryState | null>(`/sessions/${sessionId}/trajectory`)
  },

  // ─── 本场记忆 ───
  sessionMemories: async (sessionId: string): Promise<MemoryEntry[]> => {
    return get<MemoryEntry[]>(`/sessions/${sessionId}/memories`)
  },

  // ─── 仪表盘 ───
  dashboard: async (): Promise<DashboardStats> => {
    return get<DashboardStats>('/dashboard')
  },

  // ─── 近 7 天会话趋势 ───
  weeklySessions: async (): Promise<{ date: string; count: number }[]> => {
    return get<{ date: string; count: number }[]>('/dashboard/weekly-sessions')
  },

  // ─── 记忆浏览器 ───
  memories: async (): Promise<MemoryListResponse> => {
    return get<MemoryListResponse>('/memories')
  },

  // ─── PsyGUARD 监控 ───
  psyguard: async (): Promise<PsyGuardStats> => {
    return get<PsyGuardStats>('/psyguard')
  },
  psyguardTrend: async (): Promise<PsyGuardTrend> => {
    return get<PsyGuardTrend>('/psyguard/trend')
  },

  // ─── 成本看板（WP31） ───
  costTrend: async (days = 7): Promise<CostTrendPoint[]> => {
    return get<CostTrendPoint[]>(`/cost/trend?days=${days}`)
  },
  sessionCosts: async (limit = 20): Promise<SessionCost[]> => {
    return get<SessionCost[]>(`/cost/sessions?limit=${limit}`)
  },

  // ─── 影子模式审议统计 ───
  deliberationStats: async (days?: number): Promise<DeliberationStats> => {
    const query = days ? `?days=${days}` : ''
    return get<DeliberationStats>(`/deliberation/stats${query}`)
  },

  // ─── 自动对练（WP-D） ───
  autoPractice: {
    startSession: async (body: { characterSlug: string; counselorModeId: string; maxTurns?: number }): Promise<{ practiceSessionId: string; characterSlug: string; counselorModeId: string }> => {
      return post('/auto-practice/sessions', body)
    },
    enqueueBatch: async (body: { characterSlugs: string[]; counselorModeIds: string[]; maxTurns?: number; repeats?: number }): Promise<{ batchId: string; enqueued: number }> => {
      return post('/auto-practice/batch', body)
    },
    listSessions: async (params?: { batchId?: string; status?: string; page?: number; pageSize?: number }): Promise<{ items: PracticeSession[]; total: number; page: number; pageSize: number }> => {
      const q = new URLSearchParams()
      if (params?.batchId) q.set('batchId', params.batchId)
      if (params?.status) q.set('status', params.status)
      if (params?.page) q.set('page', String(params.page))
      if (params?.pageSize) q.set('pageSize', String(params.pageSize))
      const qs = q.toString()
      return get<{ items: PracticeSession[]; total: number; page: number; pageSize: number }>(`/auto-practice/sessions${qs ? `?${qs}` : ''}`)
    },
    getSession: async (id: string): Promise<PracticeSession> => {
      return get<PracticeSession>(`/auto-practice/sessions/${id}`)
    },
    batchProgress: async (batchId: string): Promise<BatchProgress> => {
      return get<BatchProgress>(`/auto-practice/batches/${batchId}`)
    },
    listModes: async (): Promise<CounselorMode[]> => {
      return get<CounselorMode[]>('/auto-practice/modes')
    },
    createMode: async (body: { name: string; systemPrompt?: string; description?: string; enabled?: boolean; sortOrder?: number }): Promise<CounselorMode> => {
      return post('/auto-practice/modes', body)
    },
    updateMode: async (id: string, body: Partial<{ name: string; systemPrompt: string; description: string; enabled: boolean; sortOrder: number }>): Promise<CounselorMode> => {
      return put<CounselorMode>(`/auto-practice/modes/${id}`, body)
    },
    deleteMode: async (id: string): Promise<{ deleted: boolean }> => {
      return del<{ deleted: boolean }>(`/auto-practice/modes/${id}`)
    },
  },

  // ─── 自动评测报告（WP-E） ───
  evalReports: async (params?: { page?: number; pageSize?: number; status?: string }): Promise<EvalReportListResponse> => {
    const q = new URLSearchParams(
      Object.entries(params ?? {}).filter(([, v]) => v !== undefined && v !== '') as Record<string, string>,
    ).toString()
    return get<EvalReportListResponse>(`/eval/reports${q ? `?${q}` : ''}`)
  },
  evalReportDetail: async (id: string): Promise<EvalReportDetail> => {
    return get<EvalReportDetail>(`/eval/reports/${id}`)
  },

  // ─── 闸门决策 trace ───
  gateTraces: async (params?: {
    page?: number
    pageSize?: number
    sessionId?: string
    dbSessionId?: string
    mode?: string
    reason?: string
    decision?: 'run' | 'skip'
    startDate?: string
    endDate?: string
  }): Promise<GateTraceListResponse> => {
    const q = new URLSearchParams(
      Object.entries(params ?? {}).filter(([, v]) => v !== undefined && v !== '') as Record<string, string>,
    ).toString()
    return get<GateTraceListResponse>(`/gate/traces${q ? `?${q}` : ''}`)
  },
  gateStats: async (days = 7): Promise<GateStatsResponse> => {
    return get<GateStatsResponse>(`/gate/stats?days=${days}`)
  },

  // ─── 质量标注台（WP-J P2） ───
  qualityAnnotation: {
    list: async (status: 'pending' | 'done' | 'all' = 'pending'): Promise<AnnotationListResponse> => {
      return get<AnnotationListResponse>(`/quality/annotations?status=${status}`)
    },
    detail: async (id: string): Promise<AnnotationDetail> => {
      return get<AnnotationDetail>(`/quality/annotations/${id}`)
    },
    save: async (id: string, body: AnnotationSaveBody): Promise<AnnotationRow> => {
      return put<AnnotationRow>(`/quality/annotations/${id}`, body)
    },
    reveal: async (id: string): Promise<AnnotationReveal> => {
      return get<AnnotationReveal>(`/quality/annotations/${id}/reveal`)
    },
    auto: async (id: string): Promise<AnnotationReveal> => {
      return get<AnnotationReveal>(`/quality/annotations/${id}/auto`)
    },
    consistency: async (): Promise<AnnotationConsistency> => {
      return get<AnnotationConsistency>('/quality/consistency')
    },
  },
}
