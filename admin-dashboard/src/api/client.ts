import type { SessionSummary, SessionDetail, CharacterBaseline } from './types'

const BASE = '/admin/api'

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`)
  if (!r.ok) throw new Error(`${path} → ${r.status}`)
  return r.json() as Promise<T>
}

export const api = {
  sessions: (limit = 20) => get<SessionSummary[]>(`/sessions?limit=${limit}`),
  session: (id: string) => get<SessionDetail>(`/sessions/${id}`),
  characters: () => get<CharacterBaseline[]>('/characters'),
  health: () => get<{ status: string; engineVoiceEnabled: boolean; uptimeSec: number }>('/health'),
}
