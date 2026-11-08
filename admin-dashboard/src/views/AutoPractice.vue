<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
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

// 当前运行中的场次
const runningSessionId = ref<string | null>(null)
const running = ref(false)

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
const finalTurnCount = ref(0)

/** 结束原因的展示文案（自然收尾 / 轮数上限 / 危机 / 停滞 / 异常）. */
const endReasonLabel = computed(() => {
  switch (exitReason.value) {
    case 'natural_close':
      return '咨询师自然收尾'
    case 'max_turns':
      return '达到轮数上限'
    case 'crisis':
      return '触发危机保护'
    case 'stagnant':
      return '对话停滞'
    case 'interrupted':
      return '进程重启中断'
    case 'error':
      return '异常结束'
    default:
      return sessionStatus.value || '已结束'
  }
})
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

// 历史场次列表
const recentSessions = ref<PracticeSession[]>([])
// 刚点「跑一场」但后端还没落库时的占位行（保证左栏立刻有条目，不闪）
const pendingRow = ref<PracticeSession | null>(null)

// 批量跑面板
const showBatchModal = ref(false)
const batchSelectedCharacters = ref<string[]>([])
const batchSelectedModes = ref<string[]>([])
const batchMaxTurns = ref(15)
const batchRepeats = ref(1)
const activeBatchId = ref<string | null>(null)
const batchProgress = ref<BatchProgress | null>(null)
let batchPollTimer: ReturnType<typeof setInterval> | null = null

// WS
let socket: Socket | null = null

// ========== 计算属性 ==========
const canStart = computed(() => !!selectedCharacterSlug.value && !!selectedModeId.value && !running.value)
const modeOptions = computed(() => modes.value.filter(m => m.enabled === 1).map(m => ({ label: m.name, value: m.id })))

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

/** 拉一次场次列表，保留本地占位行，并同步当前场次的元信息. */
async function syncSessions() {
  try {
    const list = await api.autoPractice.listSessions()
    const arr = list.slice(0, 20)
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
      applySessionEnd(cur.status, cur.exitReason ?? '', cur.crisisEnded === 1, cur.turnCount)
    }
  } catch (e) {
    console.warn('[auto-practice] 场次列表同步失败', e)
  }
}

/** 统一处理"这一场结束了". */
function applySessionEnd(status: string, reason: string, crisis: boolean, turnCount: number) {
  running.value = false
  sessionStatus.value = status
  exitReason.value = reason
  crisisDetected.value = crisis
  finalTurnCount.value = turnCount
  pendingRow.value = null
  void syncSessions()
}

async function loadInitial() {
  try {
    const [chars, modeList, sessions] = await Promise.all([
      api.characters(),
      api.autoPractice.listModes(),
      api.autoPractice.listSessions(),
    ])
    characters.value = chars
    modes.value = modeList
    recentSessions.value = sessions.slice(0, 20)
    // 自动恢复运行中的场次（页面刷新后）
    const runningSession = sessions.find(s => s.status === 'running')
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
    applySessionEnd(p.status, p.exitReason, p.crisisEnded, p.turnCount)
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
    })
    runningSessionId.value = res.practiceSessionId
    sessionMeta.value = {
      characterSlug: charSlug,
      counselorModeId: modeId,
      debugSessionId: res.debugSessionId ?? '',
    }
    // 乐观插入：后端 fire-and-forget 落库有延迟，先占一行，左栏立刻有条目
    pendingRow.value = {
      id: res.practiceSessionId,
      debugSessionId: res.debugSessionId ?? '',
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
  const data = {
    exportedAt: new Date().toISOString(),
    session: {
      practiceSessionId: runningSessionId.value,
      characterSlug: sessionMeta.value?.characterSlug ?? selectedCharacterSlug.value,
      counselorModeId: sessionMeta.value?.counselorModeId ?? selectedModeId.value,
      status: running.value ? 'running' : sessionStatus.value,
      turnCount: finalTurnCount.value || turns.size,
      exitReason: exitReason.value,
      crisisEnded: crisisDetected.value,
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
onMounted(() => {
  loadInitial()
  startPolling() // 元信息轮询常开（批量跑 / 后台跑的场次也能看到轮次与状态变化）
})

onUnmounted(() => {
  if (socket) socket.disconnect()
  if (batchPollTimer) clearInterval(batchPollTimer)
  stopPolling()
})
</script>

<template>
  <div class="h-full flex flex-col p-4 gap-4">
    <!-- 顶部工具栏 -->
    <div class="flex items-center gap-3 flex-wrap bg-bg-surface rounded-lg border border-bg-border p-3">
      <div class="flex items-center gap-2">
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
      <div class="flex items-center gap-2">
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
      <div class="flex items-center gap-2">
        <span class="text-sm text-muted">轮数</span>
        <NInputNumber v-model:value="maxTurns" :min="3" :max="50" size="small" style="width: 80px" :disabled="running" />
      </div>
      <NButton type="primary" size="small" :loading="running" :disabled="!canStart" @click="startPractice">
        ▶ 跑一场
      </NButton>
      <NButton size="small" quaternary @click="showBatchModal = true">
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
      <div class="w-64 flex-shrink-0 flex flex-col gap-3 min-h-0">
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
          />
          <div class="flex flex-wrap gap-1 mt-2">
            <NTag v-for="(count, status) in batchProgress.byStatus" :key="status" size="tiny" round
                  :type="status === 'completed' ? 'success' : status === 'failed' ? 'error' : 'info'">
              {{ status }}: {{ count }}
            </NTag>
          </div>
        </div>

        <!-- 历史场次 -->
        <div class="flex-1 bg-bg-surface rounded-lg border border-bg-border p-3 min-h-0 overflow-auto">
          <div class="text-xs font-medium mb-2">最近场次</div>
          <div v-if="recentSessions.length === 0" class="text-xs text-muted text-center py-4">暂无</div>
          <div
            v-for="s in recentSessions"
            :key="s.id"
            class="text-xs p-2 rounded cursor-pointer hover:bg-bg-elevated mb-1 border border-transparent hover:border-bg-border transition-colors"
            :class="{ 'border-accent/40 bg-accent/5': s.id === runningSessionId }"
            @click="loadSession(s)"
          >
            <div class="flex items-center justify-between">
              <span class="font-mono">{{ (s.characterSlug || '—').slice(0, 12) }}</span>
              <NTag size="tiny" :type="s.status === 'completed' ? 'success' : s.status === 'failed' ? 'error' : 'info'">{{ s.status }}</NTag>
            </div>
            <div class="text-muted mt-1 flex items-center gap-1.5">
              <span>{{ s.id === runningSessionId && turns.size ? turns.size : s.turnCount }} 轮</span>
              <span>·</span>
              <span>{{ s.counselorModeId }}</span>
              <span v-if="s.status === 'running'" class="inline-block w-1.5 h-1.5 rounded-full bg-warn animate-pulse ml-auto"></span>
            </div>
          </div>
        </div>
      </div>

      <!-- 中栏: 对话流 -->
      <div class="flex-1 flex flex-col bg-bg-surface rounded-lg border border-bg-border min-w-0 h-full min-h-0">
        <div id="ap-messages" class="flex-1 overflow-auto p-4 space-y-4">
          <!-- 未开始：只有空态提示 -->
          <NEmpty v-if="messages.length === 0 && !running" description="选择角色和咨询师模式，点「跑一场」开始自动对练" />

          <!-- 刚启动、第一轮还没回来：单独的启动状态，不和空态文案叠在一起 -->
          <div v-if="messages.length === 0 && running" class="flex flex-col items-center justify-center h-full gap-3 text-muted">
            <div class="flex items-center gap-1.5">
              <span class="typing-dot"></span>
              <span class="typing-dot" style="animation-delay: 0.15s"></span>
              <span class="typing-dot" style="animation-delay: 0.3s"></span>
            </div>
            <span class="text-xs">对练已启动，正在生成第一轮对话…</span>
          </div>

          <div v-for="(msg, i) in messages" :key="i" class="flex gap-2.5" :class="msg.role === 'counselor' ? 'flex-row-reverse' : 'flex-row'">
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
            </div>
          </div>

          <!-- 运行中指示器：只在已有对话时作为"下一轮生成中"出现 -->
          <div v-if="running && messages.length > 0" class="flex gap-2.5 items-start">
            <div class="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-medium flex-shrink-0 mt-4 bg-[#7c8db5] text-white">咨</div>
            <div class="bg-bg-elevated/80 rounded-2xl rounded-br-md px-4 py-3 shadow-sm flex items-center gap-1.5" title="咨询师正在生成下一句">
              <span class="typing-dot"></span>
              <span class="typing-dot" style="animation-delay: 0.15s"></span>
              <span class="typing-dot" style="animation-delay: 0.3s"></span>
            </div>
          </div>
          <!-- 结束提示：把结束原因说清楚（自然收尾 / 轮数上限 / 危机 / 停滞） -->
          <div v-if="!running && messages.length > 0" class="flex justify-center pt-1 pb-2">
            <span class="text-[11px] text-muted">
              本场已结束 · {{ endReasonLabel }} · 共 {{ finalTurnCount || turns.size }} 轮
            </span>
          </div>
        </div>
      </div>

      <!-- 右栏: BDI 调试面板 -->
      <div class="w-80 flex-shrink-0 bg-bg-surface rounded-lg border border-bg-border flex flex-col min-h-0">
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
