import type { SessionSummary, SessionDetail, CharacterBaseline } from './types'

const USE_MOCK = true
const BASE = '/admin/api'

async function get<T>(path: string): Promise<T> {
  if (USE_MOCK) return mock(path) as Promise<T>
  const r = await fetch(`${BASE}${path}`)
  if (!r.ok) throw new Error(`${path} → ${r.status}`)
  return r.json() as Promise<T>
}

export const api = {
  sessions: (limit = 20) => get<SessionSummary[]>(`/sessions?limit=${limit}`),
  session: (id: string) => get<SessionDetail>(`/sessions/${id}`),
  characters: () => get<CharacterBaseline[]>('/characters'),
}

async function mock(path: string): Promise<unknown> {
  await new Promise(r => setTimeout(r, 60))
  if (path.startsWith('/sessions?')) {
    return [
      { sessionId: 'caf3b6d0', characterSlug: 'vpt_intimate_avoidance_l1', visitorAlias: '晚晴', startedAt: '2026-10-29T14:30:00Z', endedAt: '2026-10-29T14:33:24Z', durationSec: 204, status: 'completed', totalTokens: 2340 },
      { sessionId: 'a8da5d0f', characterSlug: 'vpt_workplace_intellectualization_l1', visitorAlias: '亦舟', startedAt: '2026-10-29T14:15:00Z', endedAt: '2026-10-29T14:20:10Z', durationSec: 310, status: 'completed', totalTokens: 4820 },
      { sessionId: 'empty001', characterSlug: 'vpt_intimate_avoidance_l1', visitorAlias: '晚晴', startedAt: '2026-10-29T13:50:00Z', endedAt: '2026-10-29T13:50:05Z', durationSec: 5, status: 'no_content', totalTokens: 0 },
    ]
  }
  if (path.startsWith('/sessions/')) {
    return {
      sessionId: path.replace('/sessions/', ''),
      characterSlug: 'vpt_intimate_avoidance_l1', visitorAlias: '晚晴',
      startedAt: '2026-10-29T14:30:00Z', endedAt: '2026-10-29T14:33:24Z',
      durationSec: 204, status: 'completed', totalTokens: 2340,
      transcript: [
        { role: 'counselor', text: '你好，最近怎么样？', ts: '' },
        { role: 'visitor', text: '嗯……最近也没什么特别的，就是有点累。', ts: '' },
        { role: 'counselor', text: '怎么个累法？', ts: '' },
        { role: 'visitor', text: '就是提不起劲，做什么都没什么意思。', ts: '' },
      ],
      turns: [
        { turnIndex: 0, bdi: { trust: 0.28, valence: -0.45, arousal: 0.62, resistance: 0.42, attachmentType: 'anxious' }, render: { taskKind: 'voice_render', effort: 'low', maxTokens: 1500, system: '你是晚晴，28岁市场专员。依恋类型：焦虑型。性格：回避亲密，用"还好""没什么"拉开距离，但又渴望被关心。说话简短，带犹豫。', context: '咨询师刚开场："你好，最近怎么样？"', instructions: '用口语化中文回复，2-3句。不要过度解释。带犹豫感。' }, usage: { promptTokens: 0, completionTokens: 604, reasoningTokens: 38, ttftMs: 1988, finishReason: 'stop' }, crisis: { detected: false, category: null }, ts: '' },
        { turnIndex: 1, bdi: { trust: 0.31, valence: -0.42, arousal: 0.58, resistance: 0.38, attachmentType: 'anxious' }, render: { taskKind: 'voice_render', effort: 'low', maxTokens: 1500, system: '你是晚晴。当前状态：trust=0.31, resistance=0.38。', context: '咨询师："怎么个累法？"\n来访上一轮："嗯……最近也没什么特别的，就是有点累。"', instructions: '稍微多展开一点，但仍带阻抗。不要立刻敞开心扉。2-3句。' }, usage: { promptTokens: 0, completionTokens: 573, reasoningTokens: 12, ttftMs: 1659, finishReason: 'stop' }, crisis: { detected: false, category: null }, ts: '' },
        { turnIndex: 2, bdi: { trust: 0.35, valence: -0.38, arousal: 0.50, resistance: 0.32, attachmentType: 'anxious' }, render: { taskKind: 'voice_render', effort: 'low', maxTokens: 1500, system: '你是晚晴。trust=0.35, resistance=0.32，信任略升。', context: '咨询师共情后，来访开始多说一点。', instructions: '阻抗下降，情绪略舒展，但仍保留一丝距离。2-3句。' }, usage: { promptTokens: 0, completionTokens: 480, reasoningTokens: 18, ttftMs: 1520, finishReason: 'stop' }, crisis: { detected: false, category: null }, ts: '' },
        { turnIndex: 3, bdi: { trust: 0.38, valence: -0.35, arousal: 0.44, resistance: 0.28, attachmentType: 'anxious' }, render: { taskKind: 'voice_render', effort: 'low', maxTokens: 1500, system: '你是晚晴。trust=0.38, resistance=0.28。', context: '继续探索阶段。', instructions: '继续开放，但不要突然变得很话多。保持角色一致性。2-3句。' }, usage: { promptTokens: 0, completionTokens: 520, reasoningTokens: 15, ttftMs: 1480, finishReason: 'stop' }, crisis: { detected: false, category: null }, ts: '' },
      ],
      report: {
        status: 'completed',
        overallScore: 72,
        dimensions: { empathy: 75, activeListening: 80, questioning: 65, boundary: 85, response: 70, professionalism: 78 },
        annotations: [
          { type: 'good', category: '共情', message: '开场用开放式提问，给来访留足表达空间' },
          { type: 'warn', category: '提问', message: '第二轮偏封闭式提问，可能限制来访自由联想' },
          { type: 'good', category: '倾听', message: '有复述来访关键词，建立同盟感' },
        ],
        growthSuggestions: [
          '在来访沉默时多等 3 秒再追问，避免急于填补空白',
          '减少"怎么个累法"这类拆解式追问，换成"听起来你最近确实很辛苦"式反映',
        ],
        techStats: { commentary: '提问以开放式为主，干预中反映和复述较多，无明显打断。' },
      },
    }
  }
  if (path === '/characters') {
    return [
      { slug: 'vpt_intimate_avoidance_l1', codename: '晚晴', attachmentType: 'anxious', trust: 0.28, resistance: 0.42, valence: -0.45, arousal: 0.62, status: 'approved' },
      { slug: 'vpt_workplace_intellectualization_l1', codename: '亦舟', attachmentType: 'avoidant', trust: 0.20, resistance: 0.62, valence: -0.55, arousal: 0.18, status: 'approved' },
    ]
  }
  throw new Error(`mock: unknown ${path}`)
}
