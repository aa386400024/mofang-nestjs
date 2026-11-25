<script setup lang="ts">
import { ref, computed } from 'vue'
import { NTabs, NTabPane, NTag, NButton, useMessage } from 'naive-ui'
import type { BdiSnapshotPoint, DeltaDetail, IntentionSummary, TurnTrace } from '@/api/types'
import BdiStatePanel from '@/components/BdiStatePanel.vue'
import { formatMetric, formatSigned, stringifyTraceJson } from '@/utils/trace-format'

const props = defineProps<{
  trace: TurnTrace | null
  bdiHistory: BdiSnapshotPoint[]
  turnIndex: number
  messages?: Array<{ role: string; text: string; trace?: TurnTrace; turnIndex?: number }>
  selectedTurnIndex?: number | null
}>()

const emit = defineEmits<{
  (e: 'select-turn', turnIndex: number): void
}>()

const message = useMessage()
const activeTab = ref('bdi')
const showFullPrompt = ref(false)
const showBasicInfo = ref(false)
const showAllMessages = ref(false)
const showDeliberation = ref(false)

const eventTagList = computed(() => {
  const keys = props.trace?.eventTags ?? []
  const labels = props.trace?.eventTagLabels ?? []
  return keys.map((key, i) => ({ key, label: labels[i] ?? key }))
})

/** 选中轮的 BDI 点；优先按 turnIndex 精确匹配，旧 trace 缺失字段时从本轮 trace 投影，最后才回退 last。 */
const snapshotBdi = computed<BdiSnapshotPoint | null>(() => {
  const exact = props.bdiHistory.find((point) => point.turnIndex === props.turnIndex)
  if (exact) return exact
  const traceBdi = props.trace?.bdiSnapshot
  if (traceBdi) {
    return {
      turnIndex: props.trace?.turnIndex ?? props.turnIndex,
      trust: traceBdi.trust,
      safety: traceBdi.safety,
      bond: traceBdi.bond,
      valence: traceBdi.valence,
      arousal: traceBdi.arousal,
      resistance: traceBdi.resistance,
      resistanceVerbal: traceBdi.resistanceVerbal,
      resistanceDepth: traceBdi.resistanceDepth,
      resistanceStyle: traceBdi.resistanceStyle,
      anxiousSecure: traceBdi.anxiousSecure,
      transference: traceBdi.transference,
      coreBeliefActivation: traceBdi.coreBeliefActivation,
      coreBeliefActivationPeak: traceBdi.coreBeliefActivationPeak,
    }
  }
  return props.bdiHistory[props.bdiHistory.length - 1] ?? null
})

const intention = computed<IntentionSummary | null>(() => props.trace?.intention ?? null)

const STRATEGY_LABELS: Record<string, string> = {
  simple_response: '简短回应',
  request: '请求',
  recounting: '叙述',
  cognitive_exploration: '认知探索',
  affective_exploration: '情绪探索',
  insight: '领悟',
  discussing_plans: '讨论计划',
  resistance: '阻抗',
}

const strategyLabel = computed(() => {
  const strategy = intention.value?.strategy
  if (!strategy) return null
  return STRATEGY_LABELS[strategy] ?? strategy
})

const forbiddenBehaviors = computed(() => intention.value?.forbiddenBehaviors ?? [])

const emotionText = computed(() => {
  const emotion = intention.value?.emotion
  if (!emotion) return null
  const label = emotion.label ?? '未标注'
  const valence = formatSigned(emotion.valence)
  const arousal = formatMetric(emotion.arousal)
  return `${label}（效价 ${valence} / 唤醒 ${arousal}）`
})

const usageRows = computed(() => {
  const usage = props.trace?.llmUsage
  if (!usage) return []
  return [
    { label: '输入 token', value: usage.promptTokens === null ? '上游未报' : String(usage.promptTokens) },
    { label: '缓存命中', value: usage.cachedTokens === null || usage.cachedTokens === undefined ? '上游未报' : String(usage.cachedTokens) },
    { label: '输出 token', value: String(usage.completionTokens) },
    { label: '思考 token', value: String(usage.reasoningTokens) },
    { label: '首 token', value: usage.ttftMs === undefined ? '—' : `${usage.ttftMs}ms` },
    { label: '结束原因', value: usage.finishReason ?? '—' },
  ]
})

const promptText = computed(() => {
  const spec = props.trace?.renderSpec
  return spec?.promptFull || spec?.promptPreview || ''
})

const promptIsFull = computed(() => Boolean(props.trace?.renderSpec?.promptFull))

const promptParagraphs = computed(() => {
  const text = promptText.value
  if (!text) return []
  return text.split(/\n\s*\n/).map((p: string) => p.trim()).filter((p: string) => p.length > 0).map((para: string) => {
    let type = 'default'
    let title = ''
    if (para.includes('你正在扮演') && para.includes('来访者')) { type = 'role'; title = '角色设定' }
    else if (para.includes('说话方式')) { type = 'speech'; title = '说话方式' }
    else if (para.includes('内在状态') || para.includes('此刻的内在状态')) { type = 'inner'; title = '内在状态' }
    else if (para.includes('这一轮怎么说')) { type = 'turn'; title = '本轮策略' }
    return { para, type, title }
  })
})

const selectedMessages = computed(() => {
  const list = props.messages ?? []
  const visitor = list.filter((m) => m.role === 'visitor')
  if (showAllMessages.value) return visitor
  return visitor.filter((m, index) => m.turnIndex === props.turnIndex || (m.turnIndex === undefined && index === visitor.length - 1))
})

const allVisitorMessages = computed(() => (props.messages ?? []).filter((m) => m.role === 'visitor'))

const jsonPayload = computed(() => ({
  turnIndex: props.turnIndex,
  bdiSnapshot: snapshotBdi.value,
  trace: props.trace,
}))

const jsonText = computed(() => stringifyTraceJson(jsonPayload.value, 4))

const deltaRows = computed(() => {
  const d: DeltaDetail | null | undefined = props.trace?.deltaDetail
  if (!d) return []
  return [
    { key: 'trust', label: '信任', value: d.trust },
    { key: 'safety', label: '安全感', value: d.safety },
    { key: 'bond', label: '联结', value: d.bond },
    { key: 'valence', label: '效价', value: d.valence },
    { key: 'arousal', label: '唤醒', value: d.arousal },
    { key: 'verbal', label: '话量', value: d.verbal },
    { key: 'depth', label: '深度', value: d.depth },
    { key: 'style', label: '风格', value: d.style },
  ]
})

async function copyText(text: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    message.success(`已复制${label}`)
  } catch {
    message.error('复制失败')
  }
}

function copyTraceJson(): void {
  void copyText(jsonText.value, ' JSON')
}

function copyPrompt(): void {
  void copyText(promptText.value, ' prompt')
}

function messageTurnLabel(msg: { turnIndex?: number }, index: number): string {
  return msg.turnIndex !== undefined ? `第 ${msg.turnIndex} 轮` : `第 ${index + 1} 条`
}
</script>

<template>
  <NTabs v-model:value="activeTab" size="small" type="line" class="h-full min-h-0 flex flex-col" style="height: 100%">
    <!-- Tab 1: BDI 状态 -->
    <NTabPane name="bdi" tab="BDI 状态" class="flex-1 min-h-0 overflow-auto">
      <BdiStatePanel
        :trace="trace"
        :bdi-history="bdiHistory"
        :turn-index="turnIndex"
        @select-turn="(index) => emit('select-turn', index)"
      />
    </NTabPane>

    <!-- Tab 2: 事件分类 + 本轮决策 -->
    <NTabPane name="events" tab="事件分类" class="flex-1 min-h-0 overflow-auto">
      <div class="p-3 space-y-3">
        <div v-if="!trace" class="text-xs text-muted text-center py-8">发送一轮后显示</div>
        <template v-else>
          <div v-if="eventTagList.length" class="flex flex-wrap gap-1.5">
            <NTag size="tiny" v-for="evt in eventTagList" :key="evt.key" type="info" round>{{ evt.label }}</NTag>
          </div>
          <div v-else class="text-xs text-muted">本轮无事件标签（后端 eventTags 为空）</div>

          <div v-if="intention" class="rounded-lg border border-bg-border bg-bg-elevated p-2.5 space-y-2">
            <div class="flex items-center justify-between gap-2">
              <span class="text-[11px] text-muted">本轮意图</span>
              <NTag v-if="strategyLabel" size="tiny" type="success" :bordered="false">{{ strategyLabel }}</NTag>
            </div>
            <div v-if="emotionText" class="text-[11px] text-muted">情绪：<span class="text-text-secondary">{{ emotionText }}</span></div>
            <div v-if="intention.resistance" class="text-[11px] text-muted">
              阻抗：话量 {{ formatMetric(intention.resistance.verbal) }} / 深度 {{ formatMetric(intention.resistance.depth) }} / 风格 {{ formatMetric(intention.resistance.style) }}
            </div>
            <div v-if="intention.transference" class="text-[11px] text-muted">
              移情：正向 {{ formatMetric(intention.transference.positive) }} / 负向 {{ formatMetric(intention.transference.negative) }} / 依赖 {{ formatMetric(intention.transference.dependency) }}
            </div>
            <div v-if="intention.rationale" class="text-[11px] leading-relaxed bg-bg-surface rounded p-2 border border-bg-border">
              <span class="text-muted">决策理由：</span>{{ intention.rationale }}
            </div>
            <div v-if="forbiddenBehaviors.length">
              <div class="text-[10px] text-muted mb-1">本轮禁止行为</div>
              <div class="flex flex-wrap gap-1">
                <NTag v-for="item in forbiddenBehaviors" :key="item" size="tiny" type="warning" :bordered="false">{{ item }}</NTag>
              </div>
            </div>
          </div>

          <div v-if="trace.gateDecision" class="rounded-lg border border-bg-border bg-bg-elevated p-2.5 text-[11px]">
            <div class="flex items-center justify-between gap-2">
              <span class="text-muted">审议闸门</span>
              <NTag size="tiny" :type="trace.gateDecision.decision === 'run' ? 'success' : 'warning'" :bordered="false">
                {{ trace.gateDecision.decision === 'run' ? '放行' : '跳过' }}
              </NTag>
            </div>
            <div class="text-muted mt-1">原因：{{ trace.gateDecision.reason }} · 阈值 {{ trace.gateDecision.thresholdUsed }}</div>
          </div>

          <div v-if="deltaRows.length" class="rounded-lg border border-bg-border bg-bg-elevated p-2.5">
            <div class="text-[11px] text-muted mb-2">本轮 Δ（相对上一轮）</div>
            <div class="grid grid-cols-4 gap-1.5">
              <div v-for="row in deltaRows" :key="row.key" class="text-center">
                <div class="text-[9px] text-muted">{{ row.label }}</div>
                <div class="text-[11px] font-mono" :class="row.value > 0 ? 'text-success' : row.value < 0 ? 'text-error' : 'text-muted'">
                  {{ formatSigned(row.value) }}
                </div>
              </div>
            </div>
          </div>

          <div v-if="trace.deliberationTrace" class="rounded-lg border border-bg-border bg-bg-elevated p-2.5">
            <button class="text-[11px] text-accent hover:underline flex items-center gap-1" @click="showDeliberation = !showDeliberation">
              {{ showDeliberation ? '▾' : '▸' }} 审议 trace {{ showDeliberation ? '收起' : '展开' }}
            </button>
            <pre v-if="showDeliberation" class="text-[10px] font-mono mt-2 max-h-48 overflow-auto whitespace-pre-wrap">{{ stringifyTraceJson(trace.deliberationTrace, 4) }}</pre>
          </div>
        </template>
      </div>
    </NTabPane>

    <!-- Tab 3: 安全判定 + 模型用量 -->
    <NTabPane name="safety" tab="安全判定" class="flex-1 min-h-0 overflow-auto">
      <div class="p-3 space-y-3">
        <div v-if="!trace" class="text-xs text-muted text-center py-8">发送一轮后显示</div>
        <template v-else>
          <div class="text-center py-2">
            <NTag v-if="trace.crisis?.detected" size="small" type="error">检测到风险：{{ trace.crisis.category ?? '未知类别' }}</NTag>
            <NTag v-else size="small" type="success">本轮未检测到风险</NTag>
          </div>
          <div v-if="trace.degraded" class="text-[11px] text-warning bg-warning/10 border border-warning/20 rounded p-2">
            本轮走了渲染降级（LLM 失败/超时回兜底句）
          </div>
          <div v-if="usageRows.length" class="rounded-lg border border-bg-border bg-bg-elevated p-2.5">
            <div class="text-[11px] text-muted mb-2">本轮模型用量</div>
            <div class="grid grid-cols-2 gap-1.5">
              <div v-for="row in usageRows" :key="row.label" class="flex items-center justify-between gap-2 text-[11px]">
                <span class="text-muted">{{ row.label }}</span>
                <span class="font-mono">{{ row.value }}</span>
              </div>
            </div>
          </div>
        </template>
      </div>
    </NTabPane>

    <!-- Tab 4: 渲染 prompt -->
    <NTabPane name="prompt" tab="渲染 prompt" class="flex-1 min-h-0 overflow-auto">
      <div class="p-3 space-y-3">
        <div v-if="!promptText" class="text-xs text-muted text-center py-8">发送一轮后显示</div>
        <div v-else :key="trace?.turnIndex">
          <div class="flex items-center justify-between gap-2 mb-3">
            <div class="text-[10px] text-muted">{{ promptIsFull ? '完整 prompt' : 'prompt preview（后端仅 500 字）' }}</div>
            <NButton size="tiny" quaternary @click="copyPrompt">复制</NButton>
          </div>
          <div class="flex flex-wrap gap-1.5 mb-3">
            <NTag size="tiny" v-for="evt in eventTagList" :key="evt.key" type="info" round>{{ evt.label }}</NTag>
          </div>
          <div class="mb-3">
            <button class="text-xs text-accent hover:underline flex items-center gap-1 mb-1.5" @click="showBasicInfo = !showBasicInfo">
              {{ showBasicInfo ? '▾' : '▸' }} {{ showBasicInfo ? '收起基础设定' : '展开基础设定（角色 / 说话方式）' }}
            </button>
            <div v-if="showBasicInfo" class="space-y-2">
              <div v-for="(item, i) in promptParagraphs.filter((p: any) => p.type === 'role' || p.type === 'speech')" :key="i"
                   class="text-xs leading-relaxed bg-bg-elevated rounded-lg p-2.5 border border-bg-border border-l-2"
                   :class="{ 'border-l-blue-400': item.type === 'role', 'border-l-cyan-400': item.type === 'speech' }">
                <div v-if="item.title" class="text-[10px] text-muted font-medium mb-1.5">{{ item.title }}</div>
                <div class="space-y-1.5">
                  <div v-for="(line, j) in item.para.split('\n').filter((l: string) => l.trim())" :key="j" class="flex gap-1.5">
                    <span class="text-muted mt-0.5">•</span>
                    <span class="flex-1">{{ line.trim() }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div v-for="(item, i) in promptParagraphs.filter((p: any) => p.type === 'turn')" :key="'turn-' + i"
               class="text-xs leading-relaxed bg-bg-elevated rounded-lg p-2.5 border border-bg-border border-l-green-400 mb-3">
            <div class="text-[10px] text-muted font-medium mb-1.5">{{ item.title }}</div>
            <div class="space-y-1.5">
              <div v-for="(line, j) in item.para.split('\n').filter((l: string) => l.trim())" :key="j" class="flex gap-1.5">
                <span class="text-accent mt-0.5">•</span>
                <span class="flex-1">{{ line.trim() }}</span>
              </div>
            </div>
          </div>
          <div>
            <button class="text-xs text-accent hover:underline flex items-center gap-1" @click="showFullPrompt = !showFullPrompt">
              {{ showFullPrompt ? '▾' : '▸' }} {{ showFullPrompt ? '收起完整 prompt' : '展开完整 prompt' }}
            </button>
            <pre v-if="showFullPrompt" class="whitespace-pre-wrap break-word font-mono text-xs leading-relaxed bg-bg-elevated rounded-lg p-3 border border-bg-border mt-2 max-h-96 overflow-auto">{{ promptText }}</pre>
          </div>
        </div>
      </div>
    </NTabPane>

    <!-- Tab 5: LLM 原始输出 -->
    <NTabPane name="raw" tab="LLM 原始输出" class="flex-1 min-h-0 overflow-auto">
      <div class="p-3">
        <div class="flex items-center justify-between gap-2 mb-2">
          <span class="text-[10px] text-muted">默认只显示第 {{ turnIndex }} 轮</span>
          <NButton size="tiny" quaternary @click="showAllMessages = !showAllMessages">
            {{ showAllMessages ? '只看选中轮' : '显示全部轮次' }}
          </NButton>
        </div>
        <div v-if="allVisitorMessages.length === 0" class="text-xs text-muted text-center py-8">发送一轮后显示</div>
        <div v-else class="space-y-3">
          <div v-for="(msg, i) in (showAllMessages ? allVisitorMessages : selectedMessages)" :key="i" class="text-xs">
            <div class="text-muted mb-1">{{ messageTurnLabel(msg, i) }}来访回应：</div>
            <div class="whitespace-pre-wrap bg-bg-elevated rounded p-2 border border-bg-border">{{ msg.text }}</div>
          </div>
          <div v-if="!showAllMessages && selectedMessages.length === 0" class="text-[11px] text-muted">该轮没有可显示的来访文本。</div>
        </div>
      </div>
    </NTabPane>

    <!-- Tab 6: 原始数据（完整 trace JSON） -->
    <NTabPane name="json" tab="原始 JSON" class="flex-1 min-h-0 overflow-auto">
      <div class="p-3">
        <div v-if="!trace && !snapshotBdi" class="text-xs text-muted text-center py-8">发送一轮后显示</div>
        <template v-else>
          <div class="flex justify-between items-center mb-2 gap-2">
            <span class="text-xs text-muted">第 {{ turnIndex }} 轮 trace · 数值 4 位</span>
            <NButton size="tiny" quaternary @click="copyTraceJson">复制 JSON</NButton>
          </div>
          <pre class="text-xs font-mono bg-bg-elevated rounded p-2 overflow-auto max-h-96">{{ jsonText }}</pre>
        </template>
      </div>
    </NTabPane>
  </NTabs>
</template>
