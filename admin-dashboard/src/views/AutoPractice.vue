<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NSelect, NInputNumber, NButton, NEmpty, NTag, NProgress, NModal, NCheckbox, NSpace, NStatistic, NDivider, NBadge, useMessage } from 'naive-ui'
import { io, type Socket } from 'socket.io-client'
import { api } from '@/api/client'
import type { CharacterBaseline, CounselorMode, PracticeSession, BatchProgress, ApTurn, ApSessionEnd, ApSessionStart, TurnTrace } from '@/api/types'
import DebugTracePanel, { type BdiSnapshotPoint } from '@/components/DebugTracePanel.vue'

const { t } = useI18n()
const message = useMessage()

// ========== 状态 ==========
const characters = ref<CharacterBaseline[]>([])
const modes = ref<CounselorMode[]>([])
const selectedCharacterSlug = ref<string | null>(null)
const selectedModeId = ref<string | null>(null)
const maxTurns = ref(15)

// AF-187: 接触方式 —— 默认面对面；线上再选子通道.
const encounterMode = ref<'in_person' | 'online'>('in_person')
const encounterChannel = ref<'video' | 'voice' | 'text'>('voice')
const encounterModeOptions = [
  { label: '面对面咨询室', value: 'in_person' },
  { label: '线上咨询', value: 'online' },
]
const encounterChannelOptions = [
  { label: '视频', value: 'video' },
  { label: '语音', value: 'voice' },
  { label: '文字', value: 'text' },
]

// 当前运行中的场次
const runningSessionId = ref<string | null>(null)
const running = ref(false)

// 会话列表展开/收起
const showSessionList = ref(true)

// 模式切换：手动调试 / 自动对练
const mode = ref<'manual' | 'auto'>('auto')
const manualInput = ref('')
const manualDebugSessionId = ref<string | null>(null)

// 手动调试模式的会话列表
// V2026-11-06 WP69: 每行带 active = 本进程内存里还有运行时状态
const debugSessions = ref<Array<{ id: string; title: string; characterSlug: string; updatedAt: string; turnCount: number; status: string; active: boolean }>>([])

// AF-395: 调试页三模型 TTS 的前端内存缓存与播放状态.
type DebugTtsProvider = 'minimax-hd' | 'minimax-turbo' | 'doubao-seed-tts-2.0'
interface TtsUiState {
  status: 'loading' | 'ready' | 'error'
  audioUrl?: string
  cached?: boolean
  error?: string
  durationMs?: number | null
}
const ttsStates = ref<Record<string, TtsUiState>>({})
const ttsPlayingKey = ref<string | null>(null)
let ttsAudio: HTMLAudioElement | null = null
let ttsCurrentKey: string | null = null

// 恢复调试会话 loading
const resumingSessionId = ref<string | null>(null)

// 手动模式：重命名弹窗
const manualEditDialogVisible = ref(false)
const manualEditTitleValue = ref('')
const manualEditingSessionId = ref<string | null>(null)
const manualEditLoading = ref(false)

// 手动模式：删除确认
const manualDeleteConfirmVisible = ref(false)
const manualDeletingSessionId = ref<string | null>(null)
const manualDeletingSessionTitle = ref('')
const manualDeleteLoading = ref(false)

// 切换模式时加载对应的会话列表
watch(mode, async (newMode: 'manual' | 'auto') => {
  // 切换模式时清空中间对话窗口
  messages.value = []
  turns.clear()
  sessionMeta.value = null
  runningSessionId.value = null
  manualDebugSessionId.value = null

  if (newMode === 'manual') {
    try {
      debugSessions.value = await api.debugSession.list()
    } catch (e) {
      // 静默失败
    }
  } else {
    await syncSessions()
  }
})

// 角色头像颜色映射
const avatarColors = ['#7c8db5', '#7ab59e', '#b59e7c', '#9e7cb5', '#7cb5b5', '#b57c8d']
function avatarColor(slug: string): string {
  let hash = 0
  for (let i = 0; i < slug.length; i++) hash = (hash * 31 + slug.charCodeAt(i)) & 0xffff
  return avatarColors[hash % avatarColors.length]!
}
function avatarInitial(slug: string): string {
  return slug.slice(0, 1).toUpperCase()
}

/**
 * 会话列表标题：历史脏标题已被后端投影成「未命名会话 - 时间」，
 * 列表里补上角色名，否则 80+ 条同名条目完全分不清是谁的会话。
 * 有真实标题时原样使用，不做任何改写。
 */
function sessionDisplayTitle(s: { title: string; characterSlug: string }): string {
  if (!s.title.startsWith('未命名会话 - ')) return s.title || '未命名会话'
  return `${characterNameBySlug(s.characterSlug)} · ${s.title.slice('未命名会话 - '.length)}`
}

// 一轮对练的完整记录
interface TurnRecord {
  turnIndex: number
  counselorText: string
  visitorText: string
  trace?: TurnTrace
  crisis: boolean
}

// 以"轮"为唯一真相: 消息流由它派生. 这样 WS 增量与 REST 快照都按 turnIndex 幂等合并,
// 不会出现重复/错位/整体覆盖跳变.
const turns = new Map<number, TurnRecord>()

const messages = ref<Array<{ role: 'counselor' | 'visitor'; text: string; trace?: TurnTrace; crisis?: boolean; turnIndex?: number }>>([])
const sessionStatus = ref<string>('')
const exitReason = ref<string>('')
const crisisDetected = ref(false)
const crisisOutcome = ref<string>('')
const finalTurnCount = ref(0)

/** 当前正在查看的场次行（含场景与危机结论；运行中可能还是乐观行）. */
const currentSessionRow = computed(() => recentSessions.value.find((s) => s.id === runningSessionId.value))

/** 危机收尾结论的中文标签（旧场次无该字段 → 空串）. */
const crisisOutcomeLabel = computed(() => {
  switch (crisisOutcome.value) {
    case 'safety_plan_completed':
      return '安全计划已完成'
    case 'escalated':
      return '已升级求助'
    case 'incomplete':
      return '安全计划未完成'
    default:
      return ''
  }
})

/** 结束原因的展示文案（自然收尾 / 轮数上限 / 危机 / 停滞 / 异常）. */
const endReasonLabel = computed(() => exitReasonText(exitReason.value, sessionStatus.value || '已结束'))
// BDI 状态历史（每轮记录一次，供右侧面板画曲线）
const bdiHistory = ref<BdiSnapshotPoint[]>([])
// 当前轮的 trace（右侧面板展示用）
const currentTrace = ref<TurnTrace | null>(null)
// 会话元信息（启动时固定保存，导出时用，不依赖选择器状态）
const sessionMeta = ref<{ characterSlug: string; counselorModeId: string; debugSessionId: string } | null>(null)
// WS 最后收到事件的时间
let lastWsEventTime = 0
// 轮询定时器（兜底用）
let pollTimer: ReturnType<typeof setInterval> | null = null

// 历史场次列表 (无限滚动加载)
const recentSessions = ref<PracticeSession[]>([])
const sessionPage = ref(1)
const sessionPageSize = ref(20)
const sessionTotal = ref(0)
const sessionLoadingMore = ref(false)
const sessionListRef = ref<HTMLElement | null>(null)
// 刚点「跑一场」但后端还没落库时的占位行（保证左栏立刻有条目，不闪）
const pendingRow = ref<PracticeSession | null>(null)

// 批量跑面板
const showBatchModal = ref(false)
const batchSelectedCharacters = ref<string[]>([])
const batchSelectedModes = ref<string[]>([])
const batchMaxTurns = ref(15)
const batchRepeats = ref(1)
const batchEncounterMode = ref<'in_person' | 'online'>('in_person')
const batchEncounterChannel = ref<'video' | 'voice' | 'text'>('voice')
const activeBatchId = ref<string | null>(null)
const batchProgress = ref<BatchProgress | null>(null)
let batchPollTimer: ReturnType<typeof setInterval> | null = null

// WS
let socket: Socket | null = null

// ========== 计算属性 ==========
const canStart = computed(() => !!selectedCharacterSlug.value && !!selectedModeId.value && !running.value)
const modeOptions = computed(() => modes.value.filter(m => m.enabled === 1).map(m => ({ label: m.name, value: m.id })))

// 根据 ID 查咨询师模式名称
function modeNameById(id: string): string {
  const m = modes.value.find(x => x.id === id)
  return m?.name ?? id
}

/** AF-187: 场次接触方式的人读标签（缺省按面对面，兼容历史行）。 */
function encounterLabel(s: PracticeSession): string {
  if (s.encounterMode !== 'online') return '面对面'
  const channel = s.encounterChannel === 'video' ? '视频' : s.encounterChannel === 'text' ? '文字' : '语音'
  return `线上${channel}`
}

/** AF-314: 常见模型 id 的紧凑展示名；未知模型回退完整 id，不隐藏真实标识。 */
const MODEL_DISPLAY_NAMES: Record<string, string> = {
  'doubao-seed-character-260628': '豆包 Seed Character',
  'MiniMax-M3': 'MiniMax M3',
  'MiniMax-M3.1-Flash': 'MiniMax M3.1 Flash',
  'deepseek-chat': 'DeepSeek Chat',
  'qwen-plus': 'Qwen Plus',
}

function modelShortName(model: string | null | undefined): string {
  if (!model) return '未记录'
  return MODEL_DISPLAY_NAMES[model] ?? model
}

/** AF-314: 退出原因人读标签；卡片与详情共用同一映射。 */
function exitReasonText(reason: string | null | undefined, fallback = '未记录'): string {
  switch (reason) {
    case 'natural_close':
      return '咨询师自然收尾'
    case 'max_turns':
      return '达到轮数上限'
    case 'crisis':
      return '触发危机保护'
    case 'crisis_practice_max':
      return '危机稳定化练习完成'
    case 'crisis_practice_close':
      return '危机稳定化后收尾'
    case 'crisis_escalated':
      return '危机升级终止'
    case 'crisis_safety_incomplete':
      return '危机收束缺项'
    case 'stagnant':
      return '对话停滞'
    case 'interrupted':
      return '进程重启中断'
    case 'error':
      return '异常结束'
    default:
      return reason || fallback
  }
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** AF-314: 场次时间紧凑展示（当年省略年份，悬浮提示给完整时间）。 */
function formatPracticeTime(iso: string | null | undefined): string {
  if (!iso) return '时间未记录'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '时间未记录'
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return `${sameYear ? '' : `${d.getFullYear()}-`}${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function formatDurationSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  if (seconds < 60) return `${seconds}秒`
  const minutes = Math.floor(seconds / 60)
  const restSeconds = seconds % 60
  if (minutes < 60) return restSeconds > 0 ? `${minutes}分${restSeconds}秒` : `${minutes}分`
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  return restMinutes > 0 ? `${hours}时${restMinutes}分` : `${hours}时`
}

/** AF-314: 对练时长；运行中按当前时刻实时计算，不伪造 finishedAt. */
function practiceDurationText(s: PracticeSession): string {
  const start = new Date(s.startedAt).getTime()
  if (Number.isNaN(start)) return '时长未记录'
  if (s.finishedAt) {
    const finish = new Date(s.finishedAt).getTime()
    if (Number.isNaN(finish)) return '时长未记录'
    return formatDurationSeconds((finish - start) / 1000)
  }
  if (s.status === 'running') return `进行中 ${formatDurationSeconds((Date.now() - start) / 1000)}`
  return '时长未记录'
}

function practiceCostText(s: PracticeSession): string | null {
  if (s.totalCost === null || s.totalCost === undefined) return null
  const cost = Number(s.totalCost)
  if (!Number.isFinite(cost)) return null
  return `¥${cost.toFixed(4).replace(/\.?0+$/, '')}`
}

/** AF-314: 卡片模型摘要；历史行分列缺失时回退引擎指纹模型并明示语义。 */
function practiceModelSummary(s: PracticeSession): string {
  const visitor = s.visitorModel ? `来访 ${modelShortName(s.visitorModel)}` : ''
  const counselor = s.counselorModel ? `咨询 ${modelShortName(s.counselorModel)}` : ''
  if (visitor && counselor) return `${visitor} · ${counselor}`
  if (visitor) return visitor
  if (counselor) return counselor
  if (s.modelVersion) return `引擎 ${modelShortName(s.modelVersion)}`
  return '未记录'
}

/** AF-314: 悬浮提示给完整 ID 与辅助排障字段，卡片本身保持紧凑。 */
function practiceSessionTooltip(s: PracticeSession): string {
  const finish = s.finishedAt ? ` ~ ${formatPracticeTime(s.finishedAt)}` : ''
  const cost = practiceCostText(s)
  const lines = [
    `对练时间：${formatPracticeTime(s.startedAt)}${finish}`,
    `退出原因：${exitReasonText(s.exitReason)}`,
    `来访者模型：${s.visitorModel ?? '未记录'}${s.visitorModelProvider ? `（${s.visitorModelProvider}）` : ''}`,
    `咨询师模型：${s.counselorModel ?? '未记录'}`,
    `引擎模型：${s.modelVersion ?? '未记录'}`,
    `成本：${cost ?? '未记录'}`,
  ]
  if (s.batchId) lines.push(`批次：${s.batchId}`)
  if (s.seedValue) lines.push(`种子：${s.seedValue}`)
  return lines.join('\n')
}

// 根据 slug 查角色名称（codename）
function characterNameBySlug(slug: string): string {
  const c = characters.value.find(x => x.slug === slug)
  return c?.codename || slug
}

// ========== 方法 ==========

/** 从 turns 重建消息流 / BDI 曲线 / 当前 trace（所有更新的唯一出口）. */
function rebuildFromTurns() {
  const recs = [...turns.values()].sort((a, b) => a.turnIndex - b.turnIndex)
  messages.value = recs.flatMap(r => [
    { role: 'counselor' as const, text: r.counselorText, turnIndex: r.turnIndex, crisis: false },
    { role: 'visitor' as const, text: r.visitorText, trace: r.trace, turnIndex: r.turnIndex, crisis: r.crisis },
  ])
  bdiHistory.value = recs.reduce<BdiSnapshotPoint[]>((acc, r) => {
    const s = r.trace?.bdiSnapshot
    if (s) {
      acc.push({
        turnIndex: r.turnIndex,
        trust: s.trust,
        safety: s.safety ?? 0,
        bond: s.bond ?? 0,
        valence: s.valence,
        arousal: s.arousal,
      })
    }
    return acc
  }, [])
  const lastTrace = [...recs].reverse().find(r => r.trace)?.trace
  if (lastTrace) currentTrace.value = lastTrace
}

/** 幂等写入一轮（WS 增量与 REST 快照都走这里，同 turnIndex 覆盖）. */
function mergeTurn(rec: TurnRecord) {
  turns.set(rec.turnIndex, rec)
  rebuildFromTurns()
}

/** 把 debug-session 的扁平 messages 还原成轮次快照. */
function hydrateSnapshot(raw: Array<{ role: string; text: string; trace?: TurnTrace }>) {
  turns.clear()
  let pendingCounselor = ''
  let turnIndex = 0
  for (const m of raw) {
    if (m.role === 'counselor') {
      pendingCounselor = m.text
      continue
    }
    turnIndex += 1
    turns.set(turnIndex, {
      turnIndex,
      counselorText: pendingCounselor,
      visitorText: m.text,
      trace: m.trace,
      crisis: (m.trace as any)?.crisis?.detected === true,
    })
    pendingCounselor = ''
  }
  rebuildFromTurns()
}

/** 用 REST 拉一次全量快照（订阅/连接/重连后补历史用）. */
async function hydrateFromRest() {
  const dsid = sessionMeta.value?.debugSessionId
  if (!dsid) return
  try {
    const data = await api.debugSession.get(dsid)
    hydrateSnapshot((data.messages ?? []) as Array<{ role: string; text: string; trace?: TurnTrace }>)
  } catch (e) {
    console.warn('[auto-practice] 快照拉取失败', e)
  }
}

/** 刷新场次列表（手动点刷新按钮） */
async function refreshSessions() {
  await syncSessions()
}

/** 翻页 */
async function onSessionPageChange(page: number) {
  sessionPage.value = page
  await syncSessions()
}

/** 切换每页条数 */
async function onSessionPageSizeChange(size: number) {
  sessionPageSize.value = size
  sessionPage.value = 1 // 切条数后回到第一页
  await syncSessions()
}

/** 滚动到底部加载更多 */
async function loadMoreSessions() {
  if (sessionLoadingMore.value) return
  if (recentSessions.value.length >= sessionTotal.value) return // 全部加载完了
  sessionLoadingMore.value = true
  try {
    sessionPage.value += 1
    const res = await api.autoPractice.listSessions({ page: sessionPage.value, pageSize: sessionPageSize.value })
    recentSessions.value = [...recentSessions.value, ...res.items]
    sessionTotal.value = res.total
  } catch (e) {
    console.warn('[auto-practice] 加载更多失败', e)
  } finally {
    sessionLoadingMore.value = false
  }
}

/** 滚动监听：接近底部时加载更多 */
function onSessionListScroll(e: Event) {
  const el = e.target as HTMLElement
  const bottom = el.scrollHeight - el.scrollTop - el.clientHeight
  if (bottom < 80) {
    loadMoreSessions()
  }
}

// ─── 自动对练场次不提供重命名 / 删除 / AI 重命名 ───
// 后端 ap_practice_sessions 是审计表：无 title 列，且设计明确“不做软删”。
// 在没有后端契约前不摆假按钮；手动调试会话的重命名 / 删除走 debug-session 真接口。

// ─── 气泡小工具 ───
function copyMessage(text: string) {
  navigator.clipboard.writeText(text)
  message.success('已复制')
}

function showTrace(trace: TurnTrace) {
  currentTrace.value = trace
}

// ─── AF-395: 来访者气泡三模型 TTS（点击才生成，二次点击只读缓存） ───
const TTS_PROVIDERS: Array<{ id: DebugTtsProvider; label: string; title: string }> = [
  { id: 'minimax-hd', label: 'HD', title: 'MiniMax speech-2.8-hd' },
  { id: 'minimax-turbo', label: 'Turbo', title: 'MiniMax speech-2.8-turbo' },
  { id: 'doubao-seed-tts-2.0', label: '豆包', title: '豆包 doubao-seed-tts-2.0（Agent Plan）' },
]

function ttsSessionContext(): { source: 'auto_practice' | 'debug_session'; sessionId: string } | null {
  if (mode.value === 'auto') {
    return runningSessionId.value ? { source: 'auto_practice', sessionId: runningSessionId.value } : null
  }
  return manualDebugSessionId.value ? { source: 'debug_session', sessionId: manualDebugSessionId.value } : null
}

function ttsKey(turnIndex: number | undefined, provider: DebugTtsProvider): string {
  const ctx = ttsSessionContext()
  return `${ctx?.source ?? 'none'}:${ctx?.sessionId ?? 'none'}:${turnIndex ?? 0}:${provider}`
}

function ttsTitle(turnIndex: number | undefined, provider: (typeof TTS_PROVIDERS)[number]): string {
  const state = ttsStates.value[ttsKey(turnIndex, provider.id)]
  if (state?.status === 'loading') return `${provider.title} · 正在生成`
  if (state?.status === 'error') return `${provider.title} · ${state.error ?? '生成失败'}`
  if (state?.status === 'ready') return `${provider.title} · ${state.cached ? '历史缓存' : '已生成'}`
  return `${provider.title} · 点击生成并播放`
}

function ttsBadge(turnIndex: number | undefined, provider: DebugTtsProvider): string {
  const state = ttsStates.value[ttsKey(turnIndex, provider)]
  if (state?.status === 'loading') return '··'
  if (state?.status === 'error') return '!'
  if (ttsPlayingKey.value === ttsKey(turnIndex, provider)) return '■'
  return TTS_PROVIDERS.find(p => p.id === provider)?.label ?? '播'
}

function stopTts(): void {
  if (ttsAudio) ttsAudio.pause()
  ttsAudio = null
  ttsCurrentKey = null
  ttsPlayingKey.value = null
}

async function playDebugTts(turnIndex: number | undefined, provider: DebugTtsProvider): Promise<void> {
  const ctx = ttsSessionContext()
  if (ctx === null || turnIndex === undefined) {
    message.warning('当前没有可回放的会话轮次')
    return
  }
  const key = ttsKey(turnIndex, provider)
  const existing = ttsStates.value[key]
  if (existing?.status === 'loading') return
  if (existing?.status === 'ready' && existing.audioUrl) {
    stopTts()
    const audio = new Audio(existing.audioUrl)
    ttsAudio = audio
    ttsCurrentKey = key
    ttsPlayingKey.value = key
    audio.onended = () => { if (ttsCurrentKey === key) stopTts() }
    void audio.play().catch(() => message.error('音频播放失败'))
    return
  }

  ttsStates.value = { ...ttsStates.value, [key]: { status: 'loading' } }
  try {
    const res = await api.debugSession.tts({ ...ctx, turnIndex, provider })
    const audioUrl = `data:audio/mp3;base64,${res.audioBase64}`
    ttsStates.value = {
      ...ttsStates.value,
      [key]: { status: 'ready', audioUrl, cached: res.cached, durationMs: res.durationMs },
    }
    const audio = new Audio(audioUrl)
    ttsAudio = audio
    ttsCurrentKey = key
    ttsPlayingKey.value = key
    audio.onended = () => { if (ttsCurrentKey === key) stopTts() }
    void audio.play().catch(() => message.error('音频播放失败'))
  } catch (error) {
    const reason = error instanceof Error ? error.message : '生成失败'
    ttsStates.value = { ...ttsStates.value, [key]: { status: 'error', error: reason } }
    message.error(reason)
  }
}

// ─── 手动调试模式：发送一轮 ───
async function sendManualTurn() {
  if (!manualInput.value.trim() || !manualDebugSessionId.value) return
  const text = manualInput.value.trim()
  manualInput.value = ''

  try {
    const res = await api.debugSession.turn(manualDebugSessionId.value, text)
    const trace = res.trace as TurnTrace
    mergeTurn({
      turnIndex: res.turnIndex,
      counselorText: text,
      visitorText: res.reply,
      trace,
      crisis: trace?.crisis?.detected === true,
    })
  } catch (e) {
    message.error('发送失败')
  }
}

// ─── 手动调试模式：开启调试会话 ───
async function startManualSession() {
  if (!selectedCharacterSlug.value) return
  try {
    const res = await api.debugSession.create(selectedCharacterSlug.value)
    manualDebugSessionId.value = res.debugSessionId
    turns.clear()
    messages.value = []
    bdiHistory.value = []
    currentTrace.value = null
    message.success(`调试会话已开启: ${res.debugSessionId}`)
  } catch (e) {
    message.error('开启调试会话失败')
  }
}

// ─── 手动调试模式：结束会话 ───
async function endManualSession() {
  if (!manualDebugSessionId.value) return
  try {
    await api.debugSession.close(manualDebugSessionId.value)
    manualDebugSessionId.value = null
    turns.clear()
    messages.value = []
    bdiHistory.value = []
    currentTrace.value = null
    message.success('会话已结束')
  } catch (e) {
    message.error('结束会话失败')
  }
}

// ─── 手动调试模式：加载历史调试会话 ───
async function loadDebugSession(s: { id: string; title: string; characterSlug: string }) {
  manualDebugSessionId.value = s.id
  turns.clear()
  messages.value = []
  bdiHistory.value = []
  currentTrace.value = null
  try {
    const data = await api.debugSession.get(s.id)
    hydrateSnapshot(data.messages.map((m: any) => ({
      role: m.role,
      text: m.text,
      trace: m.trace,
    })))
    message.success(`已加载会话: ${sessionDisplayTitle(s)}`)
  } catch (e) {
    message.error('加载会话失败')
  }
}

// ─── 手动模式：恢复调试会话 (后端重启后继续聊) ───
async function resumeDebugSession(s: { id: string; title: string; characterSlug: string }) {
  if (resumingSessionId.value) return
  resumingSessionId.value = s.id
  try {
    await api.debugSession.resume(s.id)
    message.success(`会话已恢复: ${sessionDisplayTitle(s)}`)
    // 刷新列表, active 应该变成 true 了
    debugSessions.value = await api.debugSession.list()
    // 加载会话内容
    await loadDebugSession(s)
  } catch (e) {
    message.error('恢复会话失败, 可能没有可恢复的快照')
  } finally {
    resumingSessionId.value = null
  }
}

// ─── 手动模式：重命名调试会话 ───
function openManualEditDialog(s: { id: string; title: string }) {
  manualEditingSessionId.value = s.id
  manualEditTitleValue.value = s.title || ''
  manualEditDialogVisible.value = true
}

async function submitManualEditTitle() {
  const id = manualEditingSessionId.value
  const title = manualEditTitleValue.value.trim()
  if (!id || !title || manualEditLoading.value) return
  manualEditLoading.value = true
  try {
    await api.debugSession.update(id, title)
    message.success('标题已更新')
    manualEditDialogVisible.value = false
    debugSessions.value = await api.debugSession.list()
  } catch (e) {
    message.error('更新标题失败')
  } finally {
    manualEditLoading.value = false
  }
}

// ─── 手动模式：删除调试会话 ───
function openManualDeleteConfirm(s: { id: string; title: string }) {
  manualDeletingSessionId.value = s.id
  manualDeletingSessionTitle.value = s.title || '未命名会话'
  manualDeleteConfirmVisible.value = true
}

async function confirmManualDelete() {
  const id = manualDeletingSessionId.value
  if (!id || manualDeleteLoading.value) return
  manualDeleteLoading.value = true
  try {
    await api.debugSession.remove(id)
    message.success('会话已删除')
    manualDeleteConfirmVisible.value = false
    manualDeletingSessionId.value = null
    debugSessions.value = await api.debugSession.list()
    // 如果删的是当前正在看的会话，清空消息区
    if (manualDebugSessionId.value === id) {
      manualDebugSessionId.value = null
      messages.value = []
    }
  } catch (e) {
    message.error('删除会话失败')
  } finally {
    manualDeleteLoading.value = false
  }
}

/** 拉一次场次列表，保留本地占位行，并同步当前场次的元信息. */
async function syncSessions() {  try {
    const res = await api.autoPractice.listSessions({ page: sessionPage.value, pageSize: sessionPageSize.value })
    const arr = res.items
    sessionTotal.value = res.total
    if (pendingRow.value) {
      if (arr.some(s => s.id === pendingRow.value!.id)) pendingRow.value = null
      else arr.unshift(pendingRow.value)
    }
    recentSessions.value = arr

    // 同步当前场次：debugSessionId / 轮次 / 终态
    const cur = runningSessionId.value ? arr.find(s => s.id === runningSessionId.value) : undefined
    if (!cur) return
    if (sessionMeta.value && !sessionMeta.value.debugSessionId && cur.debugSessionId) {
      sessionMeta.value = { ...sessionMeta.value, debugSessionId: cur.debugSessionId }
      await hydrateFromRest()
    }
    if (cur.status !== 'running' && running.value) {
      applySessionEnd(cur.status, cur.exitReason ?? '', cur.crisisEnded === 1, cur.turnCount, cur.crisisOutcome ?? '')
    }
  } catch (e) {
    console.warn('[auto-practice] 场次列表同步失败', e)
  }
}

/** 统一处理"这一场结束了". */
function applySessionEnd(status: string, reason: string, crisis: boolean, turnCount: number, outcome = '') {
  running.value = false
  sessionStatus.value = status
  exitReason.value = reason
  crisisDetected.value = crisis
  crisisOutcome.value = outcome
  finalTurnCount.value = turnCount
  pendingRow.value = null
  void syncSessions()
}

async function loadInitial() {
  try {
    const [chars, modeList, sessionRes] = await Promise.all([
      api.characters(),
      api.autoPractice.listModes(),
      api.autoPractice.listSessions({ page: sessionPage.value, pageSize: sessionPageSize.value }),
    ])
    characters.value = chars
    modes.value = modeList
    recentSessions.value = sessionRes.items
    sessionTotal.value = sessionRes.total
    // 自动恢复运行中的场次（页面刷新后）
    const runningSession = sessionRes.items.find(s => s.status === 'running')
    if (runningSession) {
      runningSessionId.value = runningSession.id
      running.value = true
      sessionMeta.value = {
        characterSlug: runningSession.characterSlug,
        counselorModeId: runningSession.counselorModeId,
        debugSessionId: runningSession.debugSessionId,
      }
      await hydrateFromRest()
      connectWS(runningSession.id)
      startPolling()
      message.info(`已恢复运行中的场次: ${runningSession.id}`)
    }
  } catch (e) {
    console.error('加载初始数据失败', e)
    message.error('加载失败')
  }
}

// WS 连接状态
const wsStatus = ref<'disconnected' | 'connecting' | 'connected' | 'reconnecting'>('disconnected')

function connectWS(sessionId: string) {
  // 关闭旧连接
  if (socket) {
    socket.off()
    socket.disconnect()
    socket = null
  }
  wsStatus.value = 'connecting'
  socket = io({
    path: '/ws/auto-practice',
    // 先尝试 websocket，失败降级 polling（Vite 代理兼容性）
    transports: ['websocket', 'polling'],
    // 自动重连
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity,
    // 心跳由 Socket.IO 内置 ping/pong 处理
  })

  socket.on('connect', () => {
    wsStatus.value = 'connected'
    console.log('[auto-practice] WS 已连接, socket.id =', socket?.id)
    // 连接（含重连）成功后重新订阅场次，并补一次 REST 快照，保证断线期间漏掉的轮次补齐
    const id = runningSessionId.value
    if (id) {
      socket?.emit('subscribe', { practiceSessionId: id })
      void hydrateFromRest()
    }
  })

  socket.on('reconnect_attempt', (attempt) => {
    wsStatus.value = 'reconnecting'
    console.log(`[auto-practice] WS 重连尝试 #${attempt}`)
  })

  // 服务端确认订阅成功（附带房间人数，便于确认推送链路已通）
  socket.on('ap:subscribed', (p: { practiceSessionId: string; roomSize: number }) => {
    console.log('[auto-practice] subscribed', p)
  })

  socket.on('ap:session_start', (p: ApSessionStart) => {
    lastWsEventTime = Date.now()
    console.log('[auto-practice] session_start', p)
    sessionMeta.value = {
      characterSlug: p.characterSlug,
      counselorModeId: p.counselorModeId,
      debugSessionId: p.debugSessionId,
    }
    void syncSessions()
  })

  socket.on('ap:turn', (p: ApTurn) => {
    lastWsEventTime = Date.now()
    console.log('[auto-practice] ap:turn', p.turnIndex)
    mergeTurn({
      turnIndex: p.turnIndex,
      counselorText: p.counselorText,
      visitorText: p.visitorText,
      trace: p.trace ?? undefined,
      crisis: p.crisisDetected,
    })
    nextTick(() => scrollToBottom())
  })

  socket.on('ap:session_end', (p: ApSessionEnd) => {
    lastWsEventTime = Date.now()
    console.log('[auto-practice] session_end', p)
    applySessionEnd(p.status, p.exitReason, p.crisisEnded, p.turnCount, p.crisisOutcome ?? '')
    message.success(`对练结束: ${p.status} (${p.turnCount} 轮)`)
  })

  socket.on('connect_error', (err) => {
    wsStatus.value = 'disconnected'
    console.error('[auto-practice] WS 连接失败', err.message)
  })

  socket.on('disconnect', (reason) => {
    wsStatus.value = 'disconnected'
    console.warn('[auto-practice] WS 断开:', reason)
  })
}

async function startPractice() {
  if (!canStart.value || !selectedCharacterSlug.value || !selectedModeId.value) return
  running.value = true
  turns.clear()
  messages.value = []
  sessionStatus.value = ''
  exitReason.value = ''
  crisisDetected.value = false
  crisisOutcome.value = ''
  finalTurnCount.value = 0
  bdiHistory.value = []
  currentTrace.value = null
  sessionMeta.value = null

  const charSlug = selectedCharacterSlug.value
  const modeId = selectedModeId.value

  try {
    const res = await api.autoPractice.startSession({
      characterSlug: charSlug,
      counselorModeId: modeId,
      maxTurns: maxTurns.value,
      encounterMode: encounterMode.value,
      ...(encounterMode.value === 'online' ? { encounterChannel: encounterChannel.value } : {}),
    })
    runningSessionId.value = res.practiceSessionId
    sessionMeta.value = {
      characterSlug: charSlug,
      counselorModeId: modeId,
      debugSessionId: '',
    }
    // 乐观插入：后端 fire-and-forget 落库有延迟，先占一行，左栏立刻有条目
    pendingRow.value = {
      id: res.practiceSessionId,
      debugSessionId: '',
      characterSlug: charSlug,
      counselorModeId: modeId,
      status: 'running',
      maxTurns: maxTurns.value,
      turnCount: 0,
      crisisEnded: 0,
      exitReason: null,
      batchId: null,
      modelVersion: null,
      seedValue: null,
      totalCost: null,
      errorMessage: null,
      startedAt: new Date().toISOString(),
    } as PracticeSession
    recentSessions.value = [pendingRow.value, ...recentSessions.value.filter(s => s.id !== pendingRow.value!.id)].slice(0, 20)

    connectWS(res.practiceSessionId)
    startPolling()
  } catch (e) {
    console.error('启动对练失败', e)
    message.error('启动失败')
    running.value = false
    pendingRow.value = null
  }
}

// 元信息轮询: 常开. 只同步场次列表(轮次/状态/debugSessionId), 不是消息主通道.
// 消息只靠 WS 推; 仅当 WS 明确断开且当前在看运行中的场次时, 才用 REST 补一次.
function startPolling() {
  stopPolling()
  pollTimer = setInterval(async () => {
    await syncSessions()
    if (running.value && wsStatus.value === 'disconnected') {
      await hydrateFromRest()
      nextTick(() => scrollToBottom())
    }
  }, 1500)
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

async function startBatch() {
  if (batchSelectedCharacters.value.length === 0 || batchSelectedModes.value.length === 0) {
    message.warning('请至少选一个角色和一个模式')
    return
  }
  try {
    const res = await api.autoPractice.enqueueBatch({
      characterSlugs: batchSelectedCharacters.value,
      counselorModeIds: batchSelectedModes.value,
      maxTurns: batchMaxTurns.value,
      repeats: batchRepeats.value,
      encounterMode: batchEncounterMode.value,
      ...(batchEncounterMode.value === 'online' ? { encounterChannel: batchEncounterChannel.value } : {}),
    })
    activeBatchId.value = res.batchId
    showBatchModal.value = false
    message.success(`已入队 ${res.enqueued} 场`)
    // 开始轮询
    if (batchPollTimer) clearInterval(batchPollTimer)
    const poll = async () => {
      if (!activeBatchId.value) return
      try {
        batchProgress.value = await api.autoPractice.batchProgress(activeBatchId.value)
        // 全部跑完就停
        const p = batchProgress.value
        const done = (p.byStatus['completed'] ?? 0) + (p.byStatus['failed'] ?? 0) + (p.byStatus['crisis_ended'] ?? 0) + (p.byStatus['stagnant'] ?? 0)
        if (done >= p.total && batchPollTimer) {
          clearInterval(batchPollTimer)
          batchPollTimer = null
          message.success('批量跑完成')
        }
      } catch (e) {
        console.error('轮询批量进度失败', e)
      }
    }
    poll()
    batchPollTimer = setInterval(poll, 3000)
  } catch (e) {
    console.error('批量入队失败', e)
    message.error('批量入队失败')
  }
}

function scrollToBottom() {
  const el = document.getElementById('ap-messages')
  if (el) el.scrollTop = el.scrollHeight
}

function exportJSON() {
  const row = currentSessionRow.value
  const sceneMode = row?.encounterMode ?? encounterMode.value
  const sceneChannel = row?.encounterChannel ?? (sceneMode === 'online' ? encounterChannel.value : null)
  const data = {
    exportedAt: new Date().toISOString(),
    session: {
      practiceSessionId: runningSessionId.value,
      characterSlug: sessionMeta.value?.characterSlug ?? selectedCharacterSlug.value,
      counselorModeId: sessionMeta.value?.counselorModeId ?? selectedModeId.value,
      status: running.value ? 'running' : sessionStatus.value,
      turnCount: finalTurnCount.value || turns.size,
      encounterMode: sceneMode,
      encounterChannel: sceneChannel,
      encounterLabel: sceneMode === 'online'
        ? (sceneChannel === 'voice' ? '线上语音' : sceneChannel === 'text' ? '线上文字' : '线上视频')
        : '面对面',
      exitReason: exitReason.value,
      exitReasonLabel: endReasonLabel.value,
      crisisEnded: crisisDetected.value,
      crisisOutcome: crisisOutcome.value || null,
      crisisOutcomeLabel: crisisOutcomeLabel.value || null,
    },
    bdiHistory: bdiHistory.value,
    messages: messages.value.map((m, i) => ({
      index: i,
      role: m.role,
      text: m.text,
      crisis: m.crisis ?? false,
      bdiSnapshot: m.trace?.bdiSnapshot ?? null,
      eventTags: m.trace?.eventTags ?? null,
      crisisDetected: m.trace?.crisis ?? null,
    })),
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `auto-practice-${runningSessionId.value || 'session'}.json`
  a.click()
  URL.revokeObjectURL(url)
  message.success('已导出 JSON')
}

async function loadSession(s: PracticeSession) {
  // 切到某场：先拉全量快照，运行中的场次继续跟随实时推送
  try {
    runningSessionId.value = s.id
    sessionMeta.value = {
      characterSlug: s.characterSlug,
      counselorModeId: s.counselorModeId,
      debugSessionId: s.debugSessionId,
    }
    sessionStatus.value = s.status
    exitReason.value = s.exitReason ?? ''
    crisisDetected.value = s.crisisEnded === 1
    crisisOutcome.value = s.crisisOutcome ?? ''
    finalTurnCount.value = s.turnCount

    turns.clear()
    messages.value = []
    bdiHistory.value = []
    currentTrace.value = null
    await hydrateFromRest()

    if (s.status === 'running') {
      // 运行中：接上实时订阅，后续轮次自动进来
      running.value = true
      connectWS(s.id)
    } else {
      running.value = false
      if (socket) {
        socket.off()
        socket.disconnect()
        socket = null
      }
      wsStatus.value = 'disconnected'
    }
    startPolling() // 元信息轮询常开：左栏其它跑着的场次也要看到轮次增长
    nextTick(() => scrollToBottom())
  } catch (e) {
    message.error('加载场次失败')
  }
}

// ========== 生命周期 ==========
watch([runningSessionId, manualDebugSessionId], () => stopTts())

onMounted(() => {
  loadInitial()
  startPolling() // 元信息轮询常开（批量跑 / 后台跑的场次也能看到轮次与状态变化）
})

onUnmounted(() => {
  stopTts()
  if (socket) socket.disconnect()
  if (batchPollTimer) clearInterval(batchPollTimer)
  stopPolling()
})
</script>

<template>
  <div class="h-full flex flex-col p-4 gap-4">
    <!-- 顶部工具栏 -->
    <div class="flex items-center gap-3 flex-wrap bg-bg-surface rounded-lg border border-bg-border p-3">
      <!-- 收起后：展开按钮 -->
      <button
        v-if="!showSessionList"
        class="w-8 h-8 flex items-center justify-center rounded-md text-muted hover:text-accent hover:bg-bg-elevated transition-colors"
        @click="showSessionList = true"
        title="展开会话列表"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
          <path d="M15 3v18"/>
        </svg>
      </button>

      <!-- 模式切换 -->
      <div class="flex items-center gap-1 bg-bg-elevated rounded-lg p-0.5">
        <button
          class="px-3 py-1 text-xs rounded-md transition-colors"
          :class="mode === 'auto' ? 'bg-accent text-white' : 'text-muted hover:text-text-primary'"
          @click="mode = 'auto'"
        >
          自动对练
        </button>
        <button
          class="px-3 py-1 text-xs rounded-md transition-colors"
          :class="mode === 'manual' ? 'bg-accent text-white' : 'text-muted hover:text-text-primary'"
          @click="mode = 'manual'"
        >
          手动调试
        </button>
      </div>

      <div v-if="mode === 'auto'" class="flex items-center gap-2">
        <span class="text-sm text-muted">来访者</span>
        <NSelect
          v-model:value="selectedCharacterSlug"
          :options="characters.map(c => ({ label: c.codename || c.slug, value: c.slug }))"
          placeholder="选择角色"
          style="width: 180px"
          size="small"
          :disabled="running"
        />
      </div>

      <!-- 手动调试模式：角色选择 + 开启会话 -->
      <div v-if="mode === 'manual'" class="flex items-center gap-2">
        <span class="text-sm text-muted">角色</span>
        <NSelect
          v-model:value="selectedCharacterSlug"
          :options="characters.map(c => ({ label: c.codename || c.slug, value: c.slug }))"
          placeholder="选择角色"
          style="width: 180px"
          size="small"
        />
        <NButton size="small" type="primary" :disabled="!selectedCharacterSlug" @click="startManualSession">
          + 开启调试会话
        </NButton>
        <NButton v-if="manualDebugSessionId" size="small" quaternary @click="endManualSession">
          结束会话
        </NButton>
      </div>
      <div v-if="mode === 'auto'" class="flex items-center gap-2">
        <span class="text-sm text-muted">咨询师</span>
        <NSelect
          v-model:value="selectedModeId"
          :options="modeOptions"
          placeholder="选择模式"
          style="width: 160px"
          size="small"
          :disabled="running"
        />
      </div>
      <div v-if="mode === 'auto'" class="flex items-center gap-2">
        <span class="text-sm text-muted">场景</span>
        <NSelect
          v-model:value="encounterMode"
          :options="encounterModeOptions"
          style="width: 130px"
          size="small"
          :disabled="running"
        />
        <NSelect
          v-if="encounterMode === 'online'"
          v-model:value="encounterChannel"
          :options="encounterChannelOptions"
          style="width: 90px"
          size="small"
          :disabled="running"
        />
      </div>
      <div v-if="mode === 'auto'" class="flex items-center gap-2">
        <span class="text-sm text-muted">轮数</span>
        <NInputNumber v-model:value="maxTurns" :min="3" :max="50" size="small" style="width: 80px" :disabled="running" />
      </div>
      <NButton v-if="mode === 'auto'" type="primary" size="small" :loading="running" :disabled="!canStart" @click="startPractice">
        ▶ 跑一场
      </NButton>
      <NButton v-if="mode === 'auto'" size="small" quaternary @click="showBatchModal = true">
        ⚡ 批量跑
      </NButton>
      <div v-if="running" class="ml-auto flex items-center gap-3 text-xs text-muted font-mono">
        <span class="flex items-center gap-1">
          <span
            class="inline-block w-2 h-2 rounded-full"
            :class="wsStatus === 'connected' ? 'bg-success' : wsStatus === 'reconnecting' ? 'bg-warn animate-pulse' : 'bg-error'"
          />
          {{ wsStatus === 'connected' ? '实时' : wsStatus === 'reconnecting' ? '重连中' : '离线(轮询)' }}
        </span>
        <span class="inline-block w-2 h-2 rounded-full bg-warn animate-pulse"></span>
        对练进行中…
      </div>
    </div>

    <!-- 主区域: 三栏 -->
    <div class="flex-1 flex min-h-0 gap-3">
      <!-- 左栏: 历史场次 + 批量进度 -->
      <div v-if="showSessionList" class="w-64 flex-shrink-0 flex flex-col gap-3 min-h-0">
        <!-- 批量进度 -->
        <div v-if="batchProgress" class="bg-bg-surface rounded-lg border border-bg-border p-3">
          <div class="text-xs font-medium mb-2 flex items-center justify-between">
            <span>批量进度</span>
            <span class="text-muted font-mono">{{ batchProgress.total }} 场</span>
          </div>
          <NProgress
            type="line"
            :percentage="batchProgress.total > 0 ? (Object.entries(batchProgress.byStatus).filter(([k]) => k !== 'running').reduce((s, [, v]) => s + v, 0) / batchProgress.total) * 100 : 0"
            :show-text="false"
            :show-indicator="false"
          />
          <div class="flex flex-wrap gap-1 mt-2">
            <NTag v-for="(count, status) in batchProgress.byStatus" :key="status" size="tiny" round
                  :type="status === 'completed' ? 'success' : status === 'failed' ? 'error' : 'info'">
              {{ status }}: {{ count }}
            </NTag>
          </div>
        </div>

        <!-- 历史场次 -->
        <div class="flex-1 bg-bg-surface rounded-lg border border-bg-border min-h-0 flex flex-col">
          <!-- 头部 -->
          <div class="flex items-center justify-between px-3 py-2.5 border-b border-bg-border">
            <div class="flex items-center gap-2">
              <button
                class="w-7 h-7 flex items-center justify-center rounded-md text-muted hover:text-accent hover:bg-bg-elevated transition-colors"
                @click="showSessionList = false"
                title="收起会话列表"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
                  <line x1="9" x2="9" y1="3" y2="21"/>
                </svg>
              </button>
              <span class="text-sm font-medium">{{ mode === 'auto' ? '场次历史' : '调试会话' }}</span>
            </div>
            <button
              class="w-7 h-7 flex items-center justify-center rounded-md text-muted hover:text-accent hover:bg-bg-elevated transition-colors"
              @click="refreshSessions"
              title="刷新"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
                <path d="M21 3v5h-5"/>
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
                <path d="M8 16H3v5"/>
              </svg>
            </button>
          </div>

          <!-- 列表 -->
          <div ref="sessionListRef" class="flex-1 overflow-auto p-2 space-y-1" @scroll="onSessionListScroll">
            <div v-if="mode === 'auto' && recentSessions.length === 0" class="text-xs text-muted text-center py-12">
              <div class="flex flex-col items-center gap-2 opacity-60">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                <span>暂无场次</span>
              </div>
            </div>
            <div v-if="mode === 'manual' && debugSessions.length === 0" class="text-xs text-muted text-center py-12">
              <div class="flex flex-col items-center gap-2 opacity-60">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                <span>暂无调试会话</span>
              </div>
            </div>

            <!-- 自动对练：practice sessions -->
            <div
              v-for="s in recentSessions"
              v-if="mode === 'auto'"
              :key="s.id"
              class="group rounded-lg border transition-all cursor-pointer"
              :class="[
                s.id === runningSessionId
                  ? 'border-accent/40 bg-accent/5'
                  : 'border-transparent hover:border-bg-border hover:bg-bg-elevated'
              ]"
              @click="loadSession(s)"
            >
              <div class="px-3 py-2.5 flex items-start gap-2.5">
                <div
                  class="w-7 h-7 rounded-md flex items-center justify-center text-xs font-medium flex-shrink-0 mt-0.5"
                  :style="{ background: avatarColor(s.characterSlug), color: '#fff' }"
                >
                  {{ avatarInitial(s.characterSlug) }}
                </div>
                <div class="flex-1 min-w-0">
                  <div class="text-sm truncate font-medium leading-6 flex items-center gap-1.5">
                    <span class="truncate">{{ characterNameBySlug(s.characterSlug) }}</span>
                    <NTag size="tiny" :type="s.status === 'completed' ? 'success' : s.status === 'failed' ? 'error' : 'info'">{{ s.status }}</NTag>
                  </div>
                  <div class="text-xs text-muted mt-0.5 flex items-center gap-1.5">
                    <span>{{ s.id === runningSessionId && turns.size ? turns.size : s.turnCount }} 轮</span>
                    <span>·</span>
                    <span>{{ modeNameById(s.counselorModeId) }}</span>
                    <span>·</span>
                    <span>{{ encounterLabel(s) }}</span>
                    <template v-if="s.crisisOutcome && s.crisisOutcome !== 'none'">
                      <span>·</span>
                      <span :class="s.crisisOutcome === 'incomplete' ? 'text-warning' : 'text-ok'">
                        {{ s.crisisOutcome === 'safety_plan_completed' ? '安全计划已完成' : s.crisisOutcome === 'escalated' ? '已升级求助' : '安全计划未完成' }}
                      </span>
                    </template>
                  </div>
                  <!-- AF-314: 对练时间 / 时长 / 成本，悬浮提示给完整时间与排障字段 -->
                  <div
                    class="text-[11px] text-muted/90 mt-0.5 flex items-center gap-1.5 min-w-0"
                    :title="practiceSessionTooltip(s)"
                  >
                    <span class="flex-shrink-0">对练 {{ formatPracticeTime(s.startedAt) }}</span>
                    <span>·</span>
                    <span class="truncate">{{ practiceDurationText(s) }}</span>
                    <template v-if="practiceCostText(s)">
                      <span>·</span>
                      <span class="truncate">{{ practiceCostText(s) }}</span>
                    </template>
                  </div>
                  <!-- AF-314: 来访者/咨询师模型，完整 ID 在悬浮提示里 -->
                  <div
                    class="text-[11px] text-muted/90 mt-0.5 flex items-center gap-1.5 min-w-0"
                    :title="practiceSessionTooltip(s)"
                  >
                    <span class="flex-shrink-0">模型</span>
                    <span class="truncate">{{ practiceModelSummary(s) }}</span>
                  </div>
                </div>

              </div>
            </div>

            <!-- 手动调试：debug sessions -->
            <div
              v-for="s in debugSessions"
              v-if="mode === 'manual'"
              :key="s.id"
              class="group rounded-lg border transition-all cursor-pointer"
              :class="[
                s.id === manualDebugSessionId
                  ? 'border-accent/40 bg-accent/5'
                  : 'border-transparent hover:border-bg-border hover:bg-bg-elevated'
              ]"
              @click="loadDebugSession(s)"
            >
              <div class="px-3 py-2.5 flex items-start gap-2.5">
                <div
                  class="w-7 h-7 rounded-md flex items-center justify-center text-xs font-medium flex-shrink-0 mt-0.5"
                  :style="{ background: avatarColor(s.characterSlug), color: '#fff' }"
                >
                  {{ avatarInitial(s.characterSlug) }}
                </div>
                <div class="flex-1 min-w-0">
                  <div class="text-sm truncate font-medium leading-6 flex items-center gap-1.5">
                    <span class="truncate" :title="s.title">{{ sessionDisplayTitle(s) }}</span>
                    <NTag v-if="!s.active" size="tiny" :bordered="false" type="warning">已离线</NTag>
                  </div>
                  <div class="text-xs text-muted mt-0.5 flex items-center gap-1.5">
                    <span>{{ s.turnCount }} 轮</span>
                    <!-- 离线会话的"继续调试"按钮 (常驻, 不 hover 才显示) -->
                    <button
                      v-if="!s.active"
                      class="text-[10px] text-accent hover:underline cursor-pointer"
                      :disabled="resumingSessionId === s.id"
                      @click.stop="resumeDebugSession(s)"
                    >
                      {{ resumingSessionId === s.id ? '恢复中…' : '继续调试' }}
                    </button>
                  </div>
                </div>

                <!-- hover 操作按钮 -->
                <div class="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 pt-0.5">
                  <button
                    class="w-6 h-6 flex items-center justify-center rounded text-muted hover:text-accent hover:bg-bg-surface transition-colors"
                    title="重命名"
                    @click.stop="openManualEditDialog(s)"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                    </svg>
                  </button>
                  <button
                    class="w-6 h-6 flex items-center justify-center rounded text-muted hover:text-danger hover:bg-bg-surface transition-colors"
                    title="删除"
                    @click.stop="openManualDeleteConfirm(s)"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M3 6h18"/>
                      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- 无限滚动加载提示 -->
          <div v-if="mode === 'auto' && sessionTotal > 0" class="flex-shrink-0 px-2 py-1.5 border-t border-bg-border text-center">
            <span v-if="sessionLoadingMore" class="text-xs text-muted">加载中...</span>
            <span v-else-if="recentSessions.length >= sessionTotal" class="text-xs text-muted opacity-60">— 已加载全部 {{ sessionTotal }} 场 —</span>
            <span v-else class="text-xs text-muted opacity-60">下滑加载更多 ({{ recentSessions.length }}/{{ sessionTotal }})</span>
          </div>
        </div>
      </div>

      <!-- 中栏: 对话流 -->
      <div class="w-[42%] flex-shrink-0 flex flex-col bg-bg-surface rounded-lg border border-bg-border min-w-0 h-full min-h-0">
        <!-- 当前会话信息栏 -->
        <div v-if="sessionMeta" class="px-4 py-2.5 border-b border-bg-border bg-bg-elevated/30 flex items-center gap-3 flex-shrink-0">
          <div class="flex items-center gap-1.5 text-xs">
            <span class="text-muted">角色</span>
            <span class="font-medium text-gray-200">{{ characterNameBySlug(sessionMeta.characterSlug) }}</span>
          </div>
          <span class="w-px h-3 bg-bg-border"></span>
          <div class="flex items-center gap-1.5 text-xs">
            <span class="text-muted">咨询师模式</span>
            <span class="font-medium text-gray-200">{{ modeNameById(sessionMeta.counselorModeId) }}</span>
          </div>
        </div>
        <div id="ap-messages" class="flex-1 overflow-auto p-4 space-y-4">
          <!-- 未开始：只有空态提示 -->
          <NEmpty v-if="messages.length === 0 && !running" :description="mode === 'auto' ? '选择角色和咨询师模式，点「跑一场」开始自动对练' : '选择角色，点「开启调试会话」开始手动调试'" />

          <!-- 刚启动、第一轮还没回来：单独的启动状态，不和空态文案叠在一起 -->
          <div v-if="messages.length === 0 && running" class="flex flex-col items-center justify-center h-full gap-3 text-muted">
            <div class="flex items-center gap-1.5">
              <span class="typing-dot"></span>
              <span class="typing-dot" style="animation-delay: 0.15s"></span>
              <span class="typing-dot" style="animation-delay: 0.3s"></span>
            </div>
            <span class="text-xs">对练已启动，正在生成第一轮对话…</span>
          </div>

          <div v-for="(msg, i) in messages" :key="i" class="group flex gap-2.5" :class="msg.role === 'counselor' ? 'flex-row-reverse' : 'flex-row'">
            <div
              class="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-medium flex-shrink-0 mt-4"
              :style="{ background: msg.role === 'counselor' ? '#7c8db5' : '#7ab59e', color: '#fff' }"
            >
              {{ msg.role === 'counselor' ? '咨' : '访' }}
            </div>
            <div class="flex flex-col max-w-[70%]" :class="msg.role === 'counselor' ? 'items-end' : 'items-start'">
              <div class="text-[11px] text-muted/80 mb-1 px-1">
                {{ msg.role === 'counselor' ? 'AI 咨询师' : 'AI 来访者' }}
                <NTag v-if="msg.crisis" size="tiny" type="error" class="ml-1">⚠ 危机</NTag>
              </div>
              <div
                class="px-3.5 py-2.5 text-sm leading-relaxed shadow-sm"
                :class="msg.role === 'counselor'
                  ? 'bg-accent/15 text-text-primary rounded-2xl rounded-br-md'
                  : 'bg-bg-elevated/80 text-text-secondary rounded-2xl rounded-bl-md'"
              >
                <div class="whitespace-pre-wrap">{{ msg.text }}</div>
              </div>

              <!-- 气泡下方小工具（hover 才显示） -->
              <div class="flex gap-1 mt-1 px-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  class="w-6 h-6 flex items-center justify-center rounded-md text-muted hover:text-accent hover:bg-bg-surface transition-colors"
                  @click="copyMessage(msg.text)"
                  title="复制文本"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                  </svg>
                </button>
                <button
                  v-if="msg.role === 'visitor' && msg.trace"
                  class="w-6 h-6 flex items-center justify-center rounded-md bg-accent/15 border border-accent/30 shadow-sm hover:bg-accent/25 text-accent transition-colors"
                  @click="showTrace(msg.trace!)"
                  title="查看这轮的调试数据"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="11" cy="11" r="8"/>
                    <path d="m21 21-4.3-4.3"/>
                  </svg>
                </button>
                <!-- AF-395: 三模型语音对比，只在点击时调用；已生成过的二次点击只回放缓存 -->
                <button
                  v-for="p in (msg.role === 'visitor' ? TTS_PROVIDERS : [])"
                  :key="p.id"
                  class="h-6 min-w-6 px-1 flex items-center justify-center rounded-md text-[9px] font-semibold border transition-colors"
                  :class="ttsStates[ttsKey(msg.turnIndex, p.id)]?.status === 'error'
                    ? 'border-red-400/50 text-red-400 bg-red-400/10'
                    : ttsPlayingKey === ttsKey(msg.turnIndex, p.id)
                      ? 'border-accent text-accent bg-accent/20'
                      : 'border-border/60 text-muted hover:text-accent hover:border-accent/50 hover:bg-accent/10'"
                  :title="ttsTitle(msg.turnIndex, p)"
                  @click.stop="playDebugTts(msg.turnIndex, p.id)"
                >
                  {{ ttsBadge(msg.turnIndex, p.id) }}
                </button>
              </div>
            </div>
          </div>

          <!-- 运行中指示器：只在自动模式显示 -->
          <div v-if="mode === 'auto' && running && messages.length > 0" class="flex gap-2.5 items-start">
            <div class="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-medium flex-shrink-0 mt-4 bg-[#7c8db5] text-white">咨</div>
            <div class="bg-bg-elevated/80 rounded-2xl rounded-br-md px-4 py-3 shadow-sm flex items-center gap-1.5" title="咨询师正在生成下一句">
              <span class="typing-dot"></span>
              <span class="typing-dot" style="animation-delay: 0.15s"></span>
              <span class="typing-dot" style="animation-delay: 0.3s"></span>
            </div>
          </div>
          <!-- 结束提示：只在自动对练模式显示 -->
          <div v-if="mode === 'auto' && !running && messages.length > 0" class="flex justify-center pt-1 pb-2">
            <span class="text-[11px] text-muted">
              本场已结束 · {{ endReasonLabel }} · 共 {{ finalTurnCount || turns.size }} 轮
            </span>
          </div>
        </div>

        <!-- 手动调试模式：底部输入框 -->
        <div v-if="mode === 'manual'" class="border-t border-bg-border p-3 flex gap-2">
          <NInput
            v-model:value="manualInput"
            placeholder="输入咨询师的话，回车发送…"
            size="medium"
            type="textarea"
            :autosize="{ minRows: 1, maxRows: 3 }"
            @keyup.enter="sendManualTurn"
          />
          <NButton size="medium" type="primary" :disabled="!manualInput.trim()" @click="sendManualTurn">发送</NButton>
        </div>
      </div>

      <!-- 右栏: BDI 调试面板 -->
      <div class="flex-1 flex flex-col bg-bg-surface rounded-lg border border-bg-border min-h-0">
        <div class="px-3 py-2 border-b border-bg-border flex items-center justify-between">
          <span class="text-xs font-medium">调试面板</span>
          <NButton size="tiny" quaternary :disabled="messages.length === 0" @click="exportJSON">导出 JSON</NButton>
        </div>
        <div class="flex-1 min-h-0">
          <DebugTracePanel
            :trace="currentTrace"
            :bdi-history="bdiHistory"
            :turn-index="finalTurnCount || messages.filter(m => m.role === 'visitor').length"
            :messages="messages"
          />
        </div>
      </div>
    </div>

    <!-- 批量跑 Modal -->
    <NModal v-model:show="showBatchModal" preset="card" title="批量跑对练" style="max-width: 500px">
      <div class="space-y-4">
        <div>
          <div class="text-xs text-muted mb-2">选择来访者角色（可多选）</div>
          <NCheckbox.Group v-model:value="batchSelectedCharacters">
            <NSpace vertical>
              <NCheckbox v-for="c in characters" :key="c.slug" :value="c.slug">
                {{ c.codename || c.slug }}
              </NCheckbox>
            </NSpace>
          </NCheckbox.Group>
        </div>
        <div>
          <div class="text-xs text-muted mb-2">选择咨询师模式（可多选）</div>
          <NCheckbox.Group v-model:value="batchSelectedModes">
            <NSpace vertical>
              <NCheckbox v-for="m in modes.filter(x => x.enabled === 1)" :key="m.id" :value="m.id">
                {{ m.name }}
              </NCheckbox>
            </NSpace>
          </NCheckbox.Group>
        </div>
        <div>
          <div class="text-xs text-muted mb-2">接触方式</div>
          <NSpace>
            <NSelect v-model:value="batchEncounterMode" :options="encounterModeOptions" size="small" style="width: 140px" />
            <NSelect
              v-if="batchEncounterMode === 'online'"
              v-model:value="batchEncounterChannel"
              :options="encounterChannelOptions"
              size="small"
              style="width: 100px"
            />
          </NSpace>
        </div>
        <div class="flex gap-4">
          <div>
            <div class="text-xs text-muted mb-1">每场景轮数</div>
            <NInputNumber v-model:value="batchMaxTurns" :min="3" :max="50" size="small" />
          </div>
          <div>
            <div class="text-xs text-muted mb-1">每组合重复</div>
            <NInputNumber v-model:value="batchRepeats" :min="1" :max="10" size="small" />
          </div>
        </div>
        <div class="text-xs text-muted">
          将入队 <strong>{{ batchSelectedCharacters.length * batchSelectedModes.length * batchRepeats }}</strong> 场
        </div>
        <NButton type="primary" block @click="startBatch">开始批量跑</NButton>
      </div>
    </NModal>

    <!-- 手动模式：重命名调试会话弹窗 -->
    <NModal
      v-model:show="manualEditDialogVisible"
      preset="card"
      title="重命名调试会话"
      style="width: 400px"
      :bordered="false"
    >
      <NInput
        v-model:value="manualEditTitleValue"
        placeholder="输入会话标题"
        @keyup.enter="submitManualEditTitle"
        autofocus
        :disabled="manualEditLoading"
        maxlength="50"
        show-count
      />
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton size="small" :disabled="manualEditLoading" @click="manualEditDialogVisible = false">取消</NButton>
          <NButton size="small" type="primary" :loading="manualEditLoading" :disabled="!manualEditTitleValue.trim()" @click="submitManualEditTitle">保存</NButton>
        </div>
      </template>
    </NModal>

    <!-- 手动模式：删除调试会话确认弹窗 -->
    <NModal
      v-model:show="manualDeleteConfirmVisible"
      preset="card"
      title="删除调试会话"
      style="width: 400px"
      :bordered="false"
    >
      <p class="text-sm text-text-secondary leading-relaxed mb-3">
        确定要删除这个调试会话吗？删除后对话记录将无法恢复。
      </p>
      <div v-if="manualDeletingSessionTitle" class="p-3 rounded bg-error/10 border border-error/20 text-sm text-error mb-2">
        {{ manualDeletingSessionTitle }}
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton size="small" :disabled="manualDeleteLoading" @click="manualDeleteConfirmVisible = false">取消</NButton>
          <NButton size="small" type="error" :loading="manualDeleteLoading" @click="confirmManualDelete">确认删除</NButton>
        </div>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
#ap-messages::-webkit-scrollbar {
  width: 6px;
}
#ap-messages::-webkit-scrollbar-track {
  background: transparent;
}
#ap-messages::-webkit-scrollbar-thumb {
  background: #2a2f3d;
  border-radius: 3px;
}

.typing-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #8a93a8;
  animation: typing-bounce 1.4s infinite ease-in-out both;
}
@keyframes typing-bounce {
  0%, 80%, 100% {
    transform: scale(0.6);
    opacity: 0.4;
  }
  40% {
    transform: scale(1);
    opacity: 1;
  }
}
</style>
