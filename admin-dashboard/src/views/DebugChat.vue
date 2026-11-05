<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { NSelect, NInput, NButton, NSkeleton, NEmpty, NTag, NTabs, NTabPane, NStatistic, NProgress, NSpin, useMessage, useDialog } from 'naive-ui'
import { api } from '@/api/client'
import type { CharacterBaseline, TurnTrace } from '@/api/types'

const { t } = useI18n()
const router = useRouter()
const message = useMessage()
const dialog = useDialog()

// ========== 状态 ==========
const characters = ref<CharacterBaseline[]>([])
const selectedCharacterSlug = ref<string | null>(null)
const sessionId = ref<string | null>(null)
const turnIndex = ref(0)
const loading = ref(false)
const sending = ref(false)
const inputText = ref('')
const messages = ref<Array<{ role: 'counselor' | 'visitor'; text: string; trace?: TurnTrace }>>([])
const activeTab = ref('bdi')

// 当前轮次的 trace（右侧调试面板用）
const currentTrace = ref<TurnTrace | null>(null)

// BDI 状态历史（每轮记录一次）
interface BdiSnapshotPoint {
  turnIndex: number
  trust: number
  safety: number
  bond: number
  valence: number
  arousal: number
}
const bdiHistory = ref<BdiSnapshotPoint[]>([])

// ========== 分栏拖拽 ==========
const chatPaneWidth = ref<number>(50) // 百分比
const isDragging = ref(false)
const MIN_PANE_PCT = 25 // 最小 25%，两边都是

function onDragStart(e: MouseEvent) {
  isDragging.value = true
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'

  const onMouseMove = (e: MouseEvent) => {
    const container = document.getElementById('debug-chat-main')
    if (!container) return
    const rect = container.getBoundingClientRect()
    const pct = ((e.clientX - rect.left) / rect.width) * 100
    chatPaneWidth.value = Math.max(MIN_PANE_PCT, Math.min(100 - MIN_PANE_PCT, pct))
  }

  const onMouseUp = () => {
    isDragging.value = false
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
  }

  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
  e.preventDefault()
}

// ========== 计算属性 ==========
const canSend = computed(() => !!sessionId.value && !!inputText.value.trim() && !sending.value)
const selectedCharacter = computed(() => characters.value.find(c => c.slug === selectedCharacterSlug.value))

// ========== 方法 ==========
async function loadCharacters() {
  try {
    const list = await api.characters()
    characters.value = list
  } catch (e) {
    console.error('加载角色列表失败', e)
  }
}

async function startSession() {
  if (!selectedCharacterSlug.value) return
  loading.value = true
  try {
    const res = await fetch('/admin/api/debug/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ characterSlug: selectedCharacterSlug.value }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    sessionId.value = data.sessionId
    turnIndex.value = 0
    messages.value = []
    currentTrace.value = null
    bdiHistory.value = []
    message.success(t('debugChat.startSession') + ' ✅')
  } catch (e) {
    console.error('创建调试会话失败', e)
    message.error(t('debugChat.startSession') + ' ❌')
  } finally {
    loading.value = false
  }
}

async function sendTurn() {
  if (!canSend.value || !sessionId.value) return
  const text = inputText.value.trim()
  inputText.value = ''
  sending.value = true

  // 先把咨询师消息加上
  messages.value.push({ role: 'counselor', text })

  try {
    // TODO: 后端补 POST /admin/api/debug/session/:id/turn 接口
    // const res = await fetch(`/admin/api/debug/session/${sessionId.value}/turn`, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json', ...authHeaders() },
    //   body: JSON.stringify({ counselorText: text }),
    // })
    // const data = await res.json()

    // 临时 mock 来访回应
    await new Promise(r => setTimeout(r, 800))
    const mockVisitorText = '（来访回应 mock —— 后端接口好了替换）'
    messages.value.push({ role: 'visitor', text: mockVisitorText })
    turnIndex.value++

    // mock BDI 状态历史数据
    bdiHistory.value.push({
      turnIndex: turnIndex.value,
      trust: 0.3 + Math.random() * 0.2,
      safety: 0.5 + Math.random() * 0.1,
      bond: 0.2 + Math.random() * 0.15,
      valence: 0.4 + Math.random() * 0.2,
      arousal: 0.5 + Math.random() * 0.1,
    })

    // TODO: 后端返回 trace 后赋值
    // currentTrace.value = data.trace
  } catch (e) {
    message.error(t('debugChat.send') + ' ❌')
  } finally {
    sending.value = false
    await nextTick()
    scrollToBottom()
  }
}

function scrollToBottom() {
  const el = document.getElementById('debug-chat-messages')
  if (el) el.scrollTop = el.scrollHeight
}

function gotoHistoryDetail() {
  if (sessionId.value) {
    router.push(`/sessions/${sessionId.value}`)
  }
}

function exportTrace() {
  const data = {
    sessionId: sessionId.value,
    characterSlug: selectedCharacterSlug.value,
    turnCount: turnIndex.value,
    messages: messages.value,
    exportedAt: new Date().toISOString(),
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `debug-trace-${sessionId.value}.json`
  a.click()
  URL.revokeObjectURL(url)
  message.success('trace 已导出')
}

// 快捷测试话术
const quickPrompts = [
  { label: '共情回应', text: '听起来你最近压力很大，能跟我说说具体是什么事吗？' },
  { label: '开放提问', text: '你刚才说的那件事，对你来说意味着什么？' },
  { label: '沉默', text: '……' },
  { label: '情绪爆发', text: '我真的受够了！为什么所有人都不理解我？！' },
  { label: '试探边界', text: '你会把我们说的话告诉别人吗？' },
]

function sendQuickPrompt(text: string) {
  inputText.value = text
  sendTurn()
}

function resetSession() {
  dialog.warning({
    title: t('debugChat.resetTitle'),
    content: t('debugChat.resetContent'),
    positiveText: t('debugChat.resetConfirm'),
    negativeText: t('debugChat.resetCancel'),
    onPositiveClick: () => {
      sessionId.value = null
      selectedCharacterSlug.value = null
      messages.value = []
      turnIndex.value = 0
      currentTrace.value = null
      bdiHistory.value = []
      message.success(t('debugChat.reset') + ' ✅')
    },
  })
}

function copyMessage(text: string) {
  navigator.clipboard.writeText(text).then(() => {
    message.success(t('debugChat.copySuccess'))
  })
}

function editMessage(text: string) {
  inputText.value = text
  // 聚焦输入框
  nextTick(() => {
    const el = document.querySelector('#debug-chat-main input') as HTMLInputElement
    el?.focus()
  })
}

function authHeaders(): Record<string, string> {
  const auth = sessionStorage.getItem('admin_basic_auth')
  return auth ? { Authorization: auth } : {}
}

// ========== 生命周期 ==========
onMounted(() => {
  loadCharacters()
})
</script>

<template>
  <div class="h-full flex flex-col p-4 gap-4">
    <!-- 顶部工具栏 -->
    <div class="flex items-center gap-3 flex-wrap">
      <div class="flex items-center gap-2">
        <span class="text-sm text-muted">{{ t('debugChat.character') }}</span>
        <NSelect
          v-model:value="selectedCharacterSlug"
          :options="characters.map(c => ({ label: c.codename || c.slug, value: c.slug }))"
          :placeholder="t('debugChat.selectCharacter')"
          style="width: 200px"
          size="small"
          :disabled="!!sessionId"
        />
        <NButton
          size="small"
          type="primary"
          :loading="loading"
          :disabled="!selectedCharacterSlug || !!sessionId"
          @click="startSession"
        >
          {{ t('debugChat.startSession') }}
        </NButton>
        <NButton
          v-if="sessionId"
          size="small"
          quaternary
          @click="sessionId = null; selectedCharacterSlug = null; messages = []; turnIndex = 0; currentTrace = null"
        >
          {{ t('debugChat.endSession') }}
        </NButton>
      </div>

      <div class="ml-auto flex items-center gap-2 text-xs text-muted font-mono">
        <span v-if="sessionId">{{ t('debugChat.session') }} {{ sessionId.slice(0, 8) }}...</span>
        <span v-if="sessionId">{{ t('debugChat.turns') }} {{ turnIndex }}</span>
        <NButton v-if="sessionId" size="tiny" quaternary @click="resetSession" class="text-muted hover:text-danger">
          {{ t('debugChat.reset') }}
        </NButton>
        <NButton v-if="sessionId" size="tiny" @click="exportTrace">
          {{ t('debugChat.exportTrace') }}
        </NButton>
        <NButton v-if="sessionId" size="tiny" @click="gotoHistoryDetail">
          {{ t('debugChat.viewFullTrace') }}
        </NButton>
      </div>
    </div>

    <!-- 主区域：左右分栏（可拖拽调整宽度） -->
    <div id="debug-chat-main" class="flex-1 flex min-h-0 gap-0">
      <!-- 左边：聊天窗口 -->
      <div
        class="flex flex-col bg-bg-surface rounded-lg border border-bg-border min-w-0"
        :style="{ width: chatPaneWidth + '%' }"
      >
        <!-- 消息列表 -->
        <div id="debug-chat-messages" class="flex-1 overflow-auto p-4 space-y-4">
          <NEmpty v-if="messages.length === 0" :description="t('debugChat.emptyState')" />

          <div v-for="(msg, i) in messages" :key="i" class="group flex" :class="msg.role === 'counselor' ? 'justify-end' : 'justify-start'">
            <div
              class="max-w-[70%] rounded-lg px-3 py-2 text-sm relative"
              :class="msg.role === 'counselor'
                ? 'bg-accent/20 text-text-primary rounded-br-none'
                : 'bg-bg-elevated text-text-secondary rounded-bl-none'"
            >
              <div class="text-xs text-muted/70 mb-1">{{ msg.role === 'counselor' ? t('debugChat.counselor') : t('debugChat.visitor') }}</div>
              <div class="whitespace-pre-wrap">{{ msg.text }}</div>

              <!-- hover 操作按钮 -->
              <div class="absolute -bottom-6 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 text-xs">
                <button
                  class="px-1.5 py-0.5 rounded bg-bg-elevated border border-bg-border hover:bg-bg-border text-muted"
                  @click="copyMessage(msg.text)"
                  title="Copy"
                >
                  {{ t('debugChat.copy') }}
                </button>
                <button
                  v-if="msg.role === 'visitor'"
                  class="px-1.5 py-0.5 rounded bg-bg-elevated border border-bg-border hover:bg-bg-border text-muted"
                  @click="editMessage(msg.text)"
                  :title="t('debugChat.editQuoteTip')"
                >
                  {{ t('debugChat.editQuote') }}
                </button>
              </div>
            </div>
          </div>

          <NSpin v-if="sending && messages[messages.length - 1]?.role === 'counselor'" size="small" />
        </div>

        <!-- 输入框 -->
        <div class="border-t border-bg-border p-3 space-y-2">
          <!-- 快捷话术 -->
          <div v-if="sessionId" class="flex flex-wrap gap-1">
            <span class="text-xs text-muted self-center mr-1">{{ t('debugChat.quickPrompts') }}</span>
            <NButton
              v-for="q in quickPrompts"
              :key="q.label"
              size="tiny"
              quaternary
              @click="sendQuickPrompt(q.text)"
              :disabled="sending"
            >
              {{ q.label }}
            </NButton>
          </div>
          <div class="flex gap-2">
            <NInput
              v-model:value="inputText"
              :placeholder="t('debugChat.inputPlaceholder')"
              size="small"
              @keyup.enter="sendTurn"
              :disabled="!sessionId || sending"
            />
            <NButton
              type="primary"
              size="small"
              :loading="sending"
              :disabled="!canSend"
              @click="sendTurn"
            >
              {{ t('debugChat.send') }}
            </NButton>
          </div>
        </div>
      </div>

      <!-- 拖拽手柄 -->
      <div
        class="w-1.5 flex-shrink-0 cursor-col-resize hover:bg-accent/30 transition-colors mx-1 rounded-full"
        :class="{ 'bg-accent/50': isDragging }"
        @mousedown="onDragStart"
        title="拖拽调整宽度"
      ></div>

      <!-- 右边：调试面板 -->
      <div class="flex-1 flex flex-col bg-bg-surface rounded-lg border border-bg-border min-w-0">
        <NTabs v-model:value="activeTab" size="small" type="line" class="flex-1 flex flex-col">
          <!-- Tab 1: BDI 状态 -->
          <NTabPane name="bdi" :tab="t('debugChat.tabs.bdi')" class="flex-1 overflow-auto">
            <div class="p-3 space-y-4">
              <div v-if="bdiHistory.length === 0" class="text-xs text-muted text-center py-8">
                {{ t('debugChat.noData') }}
              </div>
              <template v-else>
                <!-- 历史趋势图 -->
                <div>
                  <div class="text-xs text-muted mb-2">{{ t('debugChat.bdiHistory') }}</div>
                  <div class="bg-bg-elevated rounded p-2">
                    <svg viewBox="0 0 200 100" class="w-full h-24">
                      <!-- 网格线 -->
                      <line x1="0" y1="25" x2="200" y2="25" stroke="#2a2f3d" stroke-width="0.5" />
                      <line x1="0" y1="50" x2="200" y2="50" stroke="#2a2f3d" stroke-width="0.5" />
                      <line x1="0" y1="75" x2="200" y2="75" stroke="#2a2f3d" stroke-width="0.5" />

                      <!-- trust 线 -->
                      <polyline
                        :points="bdiHistory.map((p, i) => `${(i / Math.max(bdiHistory.length - 1, 1)) * 190 + 5},${100 - p.trust * 100}`).join(' ')"
                        fill="none"
                        stroke="#c890a8"
                        stroke-width="1.5"
                      />
                      <!-- safety 线 -->
                      <polyline
                        :points="bdiHistory.map((p, i) => `${(i / Math.max(bdiHistory.length - 1, 1)) * 190 + 5},${100 - p.safety * 100}`).join(' ')"
                        fill="none"
                        stroke="#7ec9a0"
                        stroke-width="1.5"
                      />
                      <!-- bond 线 -->
                      <polyline
                        :points="bdiHistory.map((p, i) => `${(i / Math.max(bdiHistory.length - 1, 1)) * 190 + 5},${100 - p.bond * 100}`).join(' ')"
                        fill="none"
                        stroke="#e8c87a"
                        stroke-width="1.5"
                      />
                    </svg>
                    <div class="flex gap-3 mt-1 text-xs justify-center">
                      <span class="flex items-center gap-1"><span class="w-2 h-0.5 bg-[#c890a8] inline-block"></span>trust</span>
                      <span class="flex items-center gap-1"><span class="w-2 h-0.5 bg-[#7ec9a0] inline-block"></span>safety</span>
                      <span class="flex items-center gap-1"><span class="w-2 h-0.5 bg-[#e8c87a] inline-block"></span>bond</span>
                    </div>
                  </div>
                </div>

                <!-- 当前快照数值 -->
                <div>
                  <div class="text-xs text-muted mb-2">{{ t('debugChat.currentSnapshot', { n: turnIndex }) }}</div>
                  <div class="space-y-2">
                    <div v-for="dim in bdiHistory[bdiHistory.length - 1] ? Object.keys(bdiHistory[bdiHistory.length - 1]).filter(k => k !== 'turnIndex') : []" :key="dim"
                         class="flex items-center gap-2 text-xs">
                      <span class="w-20 text-muted">{{ dim }}</span>
                      <NProgress type="line" :percentage="((bdiHistory[bdiHistory.length - 1] as any)[dim] ?? 0) * 100" :show-text="false" class="flex-1" />
                      <span class="w-12 text-right font-mono">{{ ((bdiHistory[bdiHistory.length - 1] as any)[dim] ?? 0).toFixed(2) }}</span>
                    </div>
                  </div>
                </div>
              </template>
            </div>
          </NTabPane>

          <!-- Tab 2: 事件分类 -->
          <NTabPane name="events" :tab="t('debugChat.tabs.events')" class="flex-1 overflow-auto">
            <div class="p-3">
              <div v-if="!currentTrace" class="text-xs text-muted text-center py-8">
                {{ t('debugChat.noData') }}
              </div>
              <div v-else class="space-y-2">
                <NTag size="tiny" v-for="evt in ['empathy', 'open_probe']" :key="evt" type="info">
                  {{ evt }}
                </NTag>
              </div>
            </div>
          </NTabPane>

          <!-- Tab 3: 安全判定 -->
          <NTabPane name="safety" :tab="t('debugChat.tabs.safety')" class="flex-1 overflow-auto">
            <div class="p-3">
              <div v-if="!currentTrace" class="text-xs text-muted text-center py-8">
                {{ t('debugChat.noData') }}
              </div>
              <div v-else>
                <NTag size="tiny" type="success">{{ t('debugChat.noData') }}</NTag>
              </div>
            </div>
          </NTabPane>

          <!-- Tab 4: 记忆召回 -->
          <NTabPane name="memory" :tab="t('debugChat.tabs.memory')" class="flex-1 overflow-auto">
            <div class="p-3">
              <div class="text-xs text-muted text-center py-8">
                {{ t('debugChat.noData') }}
              </div>
            </div>
          </NTabPane>

          <!-- Tab 5: 渲染 prompt -->
          <NTabPane name="prompt" :tab="t('debugChat.tabs.prompt')" class="flex-1 overflow-auto">
            <div class="p-3">
              <div class="text-xs text-muted text-center py-8">
                {{ t('debugChat.noData') }}
              </div>
            </div>
          </NTabPane>

          <!-- Tab 6: LLM 原始输出 -->
          <NTabPane name="raw" :tab="t('debugChat.tabs.raw')" class="flex-1 overflow-auto">
            <div class="p-3">
              <div class="text-xs text-muted text-center py-8">
                {{ t('debugChat.noData') }}
              </div>
            </div>
          </NTabPane>

          <!-- Tab 7: 审议对比（规则 delta vs LLM 审议 delta） -->
          <NTabPane name="compare" :tab="t('debugChat.tabs.compare')" class="flex-1 overflow-auto">
            <div class="p-3">
              <div v-if="bdiHistory.length === 0" class="text-xs text-muted text-center py-8">
                {{ t('debugChat.noData') }}
              </div>
              <template v-else>
                <div class="text-xs text-muted mb-3">{{ t('debugChat.currentSnapshot', { n: turnIndex }) }}</div>
                <div class="space-y-2">
                  <div v-for="dim in ['trust', 'safety', 'bond', 'valence', 'arousal']" :key="dim"
                       class="text-xs">
                    <div class="flex justify-between mb-1">
                      <span class="text-muted">{{ dim }}</span>
                      <span class="font-mono">
                        <span class="text-accent">{{ t('debugChat.ruleDelta') }}: +0.05</span>
                        <span class="text-muted mx-1">{{ t('debugChat.diff') }}</span>
                        <span class="text-warn">{{ t('debugChat.deliberationDelta') }}: +0.08</span>
                      </span>
                    </div>
                    <div class="h-1.5 bg-bg-elevated rounded overflow-hidden flex">
                      <div class="bg-accent" style="width: 25%"></div>
                      <div class="bg-warn" style="width: 15%"></div>
                    </div>
                  </div>
                </div>
                <div class="mt-4 text-xs text-muted border-t border-bg-border pt-3">
                  <div>{{ t('debugChat.largestDiff') }}：trust (+0.03)</div>
                  <div class="mt-1">
                    <span class="text-warn">⚠️ {{ t('debugChat.diffWarning') }}</span>
                  </div>
                </div>
              </template>
            </div>
          </NTabPane>

          <!-- Tab 8: 原始数据（完整 trace JSON） -->
          <NTabPane name="json" :tab="t('debugChat.tabs.json')" class="flex-1 overflow-auto">
            <div class="p-3">
              <div v-if="bdiHistory.length === 0" class="text-xs text-muted text-center py-8">
                {{ t('debugChat.noData') }}
              </div>
              <template v-else>
                <div class="flex justify-between items-center mb-2">
                  <span class="text-xs text-muted">{{ t('debugChat.traceForTurn', { n: turnIndex }) }}</span>
                  <NButton size="tiny" quaternary @click="copyMessage(JSON.stringify({
                    turnIndex,
                    bdiSnapshot: bdiHistory[bdiHistory.length - 1],
                    messages: messages.value.slice(-2),
                  }, null, 2))">
                    {{ t('debugChat.copyJson') }}
                  </NButton>
                </div>
                <pre class="text-xs font-mono bg-bg-elevated rounded p-2 overflow-auto max-h-96">
{{ JSON.stringify({
  turnIndex,
  bdiSnapshot: bdiHistory[bdiHistory.length - 1],
  ruleDelta: { trust: 0.05, safety: 0.02, bond: 0.01 },
  deliberationDelta: { trust: 0.08, safety: 0.03 },
  operatorTags: ['empathy', 'micro_expression'],
  reason: '咨询师语气温和，但未直接回应来访情绪',
}, null, 2) }}
                </pre>
              </template>
            </div>
          </NTabPane>
        </NTabs>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 聊天窗口消息区滚动条 */
#debug-chat-messages::-webkit-scrollbar {
  width: 6px;
}
#debug-chat-messages::-webkit-scrollbar-track {
  background: transparent;
}
#debug-chat-messages::-webkit-scrollbar-thumb {
  background: #2a2f3d;
  border-radius: 3px;
}
</style>
