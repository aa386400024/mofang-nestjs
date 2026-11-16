<script setup lang="ts">
import { ref, computed } from 'vue'
import { NTabs, NTabPane, NTag, NProgress, NButton } from 'naive-ui'
import type { TurnTrace } from '@/api/types'

// BDI 快照点 (每轮记录一次)
export interface BdiSnapshotPoint {
  turnIndex: number
  trust: number
  safety: number
  bond: number
  valence: number
  arousal: number
}

const props = defineProps<{
  trace: TurnTrace | null
  bdiHistory: BdiSnapshotPoint[]
  turnIndex: number
  messages?: Array<{ role: string; text: string; trace?: TurnTrace }>
}>()

const activeTab = ref('bdi')
const showFullPrompt = ref(false)
const showBasicInfo = ref(false)

// 事件标签中英映射
const eventTagMap: Record<string, string> = {
  empathy: '共情回应',
  open_probe: '开放提问',
  micro_expression: '微表情分析',
  emotion_reflection: '情感反映',
  normalization: '正常化',
  open_discussion: '开放讨论',
  resistance: '抵抗',
  empty: '空情绪',
}

const strategyMap: Record<string, string> = {
  resistance: '抵抗',
  empathy: '共情回应',
  open_probe: '开放提问',
  emotion_reflection: '情感反映',
}

const eventTagList = computed(() => {
  const trace = props.trace as any
  const raw = trace?.eventTags ?? trace?.operatorTags ?? trace?.intention
  if (Array.isArray(raw)) {
    return raw.map(key => ({ key, label: eventTagMap[key] ?? key }))
  }
  if (raw && typeof raw === 'object') {
    const tags: { key: string; label: string }[] = []
    if (raw.strategy) tags.push({ key: 'strategy', label: strategyMap[raw.strategy] ?? raw.strategy })
    if (raw.emotion?.label) tags.push({ key: 'emotion', label: eventTagMap[raw.emotion.label] ?? raw.emotion.label })
    return tags
  }
  return [{ key: 'empathy', label: '共情回应' }, { key: 'open_probe', label: '开放提问' }]
})

const promptParagraphs = computed(() => {
  const text = props.trace?.renderSpec?.promptFull
  if (!text) return []
  const paras = text.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0)
  return paras.map(para => {
    let type = 'default'
    let title = ''
    if (para.includes('你正在扮演') && para.includes('来访者')) { type = 'role'; title = '角色设定' }
    else if (para.includes('说话方式')) { type = 'speech'; title = '说话方式' }
    else if (para.includes('内在状态')) { type = 'inner'; title = '内在状态' }
    else if (para.includes('这一轮怎么说')) { type = 'turn'; title = '本轮策略' }
    return { para, type, title }
  })
})

const innerStateCards = computed(() => {
  const trace = props.trace as any
  if (!trace) return []
  const cards: { label: string; value: number | null; display: string }[] = []
  if (trace.bdiSnapshot?.trust != null) cards.push({ label: '信任度', value: trace.bdiSnapshot.trust, display: trace.bdiSnapshot.trust.toFixed(2) })
  if (trace.bdiSnapshot?.safety != null) cards.push({ label: '安全感', value: trace.bdiSnapshot.safety, display: trace.bdiSnapshot.safety.toFixed(2) })
  if (trace.bdiSnapshot?.bond != null) cards.push({ label: '联结感', value: trace.bdiSnapshot.bond, display: trace.bdiSnapshot.bond.toFixed(2) })
  if (trace.bdiSnapshot?.valence != null) cards.push({ label: '效价', value: (trace.bdiSnapshot.valence + 1) / 2, display: trace.bdiSnapshot.valence.toFixed(2) })
  if (trace.bdiSnapshot?.arousal != null) cards.push({ label: '唤醒度', value: trace.bdiSnapshot.arousal, display: trace.bdiSnapshot.arousal.toFixed(2) })
  if (trace.eventTags?.resistance?.verbal != null) cards.push({ label: '阻抗·话量', value: trace.eventTags.resistance.verbal, display: trace.eventTags.resistance.verbal.toFixed(2) })
  return cards
})

const visitorMessages = computed(() => {
  if (!props.messages) return []
  return props.messages.filter(m => m.role === 'visitor')
})
</script>

<template>
  <NTabs v-model:value="activeTab" size="small" type="line" class="flex-1 flex flex-col">
    <!-- Tab 1: BDI 状态 -->
    <NTabPane name="bdi" tab="BDI 状态" class="flex-1 overflow-auto">
      <div class="p-3 space-y-4">
        <div v-if="bdiHistory.length === 0" class="text-xs text-muted text-center py-8">发送一轮后显示</div>
        <template v-else>
          <div>
            <div class="text-xs text-muted mb-2">历史趋势</div>
            <div class="bg-bg-elevated rounded p-2">
              <svg viewBox="0 0 200 100" class="w-full h-24">
                <line x1="0" y1="25" x2="200" y2="25" stroke="#2a2f3d" stroke-width="0.5" />
                <line x1="0" y1="50" x2="200" y2="50" stroke="#2a2f3d" stroke-width="0.5" />
                <line x1="0" y1="75" x2="200" y2="75" stroke="#2a2f3d" stroke-width="0.5" />
                <polyline :points="bdiHistory.map((p, i) => `${(i / Math.max(bdiHistory.length - 1, 1)) * 190 + 5},${100 - p.trust * 100}`).join(' ')" fill="none" stroke="#c890a8" stroke-width="1.5" />
                <polyline :points="bdiHistory.map((p, i) => `${(i / Math.max(bdiHistory.length - 1, 1)) * 190 + 5},${100 - p.safety * 100}`).join(' ')" fill="none" stroke="#7ec9a0" stroke-width="1.5" />
                <polyline :points="bdiHistory.map((p, i) => `${(i / Math.max(bdiHistory.length - 1, 1)) * 190 + 5},${100 - p.bond * 100}`).join(' ')" fill="none" stroke="#e8c87a" stroke-width="1.5" />
              </svg>
              <div class="flex gap-3 mt-1 text-xs justify-center">
                <span class="flex items-center gap-1"><span class="w-2 h-0.5 bg-[#c890a8] inline-block"></span>trust</span>
                <span class="flex items-center gap-1"><span class="w-2 h-0.5 bg-[#7ec9a0] inline-block"></span>safety</span>
                <span class="flex items-center gap-1"><span class="w-2 h-0.5 bg-[#e8c87a] inline-block"></span>bond</span>
              </div>
            </div>
          </div>
          <div>
            <div class="text-xs text-muted mb-2">当前快照（第 {{ turnIndex }} 轮）</div>
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
    <NTabPane name="events" tab="事件分类" class="flex-1 overflow-auto">
      <div class="p-3">
        <div v-if="!trace" class="text-xs text-muted text-center py-8">发送一轮后显示</div>
        <div v-else class="space-y-3">
          <div class="flex flex-wrap gap-1.5">
            <NTag size="tiny" v-for="evt in eventTagList" :key="evt.key" type="info" round>{{ evt.label }}</NTag>
          </div>
          <div v-if="(trace as any).eventTags && typeof (trace as any).eventTags === 'object'"
               class="text-xs space-y-2 bg-bg-elevated rounded p-2.5 border border-bg-border">
            <div v-if="(trace as any).eventTags.rationale" class="text-muted leading-relaxed">{{ (trace as any).eventTags.rationale }}</div>
            <div v-if="(trace as any).eventTags.forbiddenBehaviors?.length" class="space-y-1">
              <div class="text-muted text-[10px]">禁止行为：</div>
              <div v-for="fb in (trace as any).eventTags.forbiddenBehaviors" :key="fb" class="text-red-400 text-[11px]">• {{ fb }}</div>
            </div>
          </div>
        </div>
      </div>
    </NTabPane>

    <!-- Tab 3: 安全判定 -->
    <NTabPane name="safety" tab="安全判定" class="flex-1 overflow-auto">
      <div class="p-3">
        <div v-if="!trace" class="text-xs text-muted text-center py-8">发送一轮后显示</div>
        <div v-else class="text-center py-4">
          <NTag v-if="trace.crisis?.detected" size="small" type="error">检测到风险：{{ trace.crisis.category ?? '未知类别' }}</NTag>
          <NTag v-else size="small" type="success">本轮未检测到风险</NTag>
        </div>
      </div>
    </NTabPane>

    <!-- Tab 4: 渲染 prompt -->
    <NTabPane name="prompt" tab="渲染 prompt" class="flex-1 overflow-auto">
      <div class="p-3 space-y-3">
        <div v-if="!trace?.renderSpec?.promptFull" class="text-xs text-muted text-center py-8">发送一轮后显示</div>
        <div v-else :key="trace.turnIndex">
          <div class="flex flex-wrap gap-1.5 mb-3">
            <NTag size="tiny" v-for="evt in eventTagList" :key="evt.key" type="info" round>{{ evt.label }}</NTag>
          </div>
          <div v-if="innerStateCards.length" class="mb-3">
            <div class="text-[10px] text-muted font-medium mb-1.5">内在状态</div>
            <div class="grid grid-cols-2 gap-2">
              <div v-for="card in innerStateCards" :key="card.label" class="bg-bg-elevated rounded-lg p-2 border border-bg-border">
                <div class="text-[10px] text-muted mb-1">{{ card.label }}</div>
                <div class="text-xs font-mono font-medium mb-1">{{ card.display }}</div>
                <div class="h-1 bg-bg-border rounded-full overflow-hidden">
                  <div class="h-full bg-accent rounded-full transition-all" :style="{ width: `${(card.value ?? 0) * 100}%` }"></div>
                </div>
              </div>
            </div>
            <div v-if="(trace as any).eventTags?.forbiddenBehaviors?.length" class="mt-2">
              <div class="text-[10px] text-muted mb-1">禁止行为</div>
              <div v-for="fb in (trace as any).eventTags.forbiddenBehaviors" :key="fb" class="text-red-400 text-[11px]">• {{ fb }}</div>
            </div>
          </div>
          <div class="mb-3">
            <button class="text-xs text-accent hover:underline flex items-center gap-1 mb-1.5" @click="showBasicInfo = !showBasicInfo">
              {{ showBasicInfo ? '▾' : '▸' }} {{ showBasicInfo ? '收起基础设定' : '展开基础设定（角色 / 说话方式）' }}
            </button>
            <div v-if="showBasicInfo" class="space-y-2">
              <div v-for="(item, i) in promptParagraphs.filter(p => p.type === 'role' || p.type === 'speech')" :key="i"
                   class="text-xs leading-relaxed bg-bg-elevated rounded-lg p-2.5 border border-bg-border border-l-2"
                   :class="{ 'border-l-blue-400': item.type === 'role', 'border-l-cyan-400': item.type === 'speech' }">
                <div v-if="item.title" class="text-[10px] text-muted font-medium mb-1.5">{{ item.title }}</div>
                <div class="space-y-1.5">
                  <div v-for="(line, j) in item.para.split('\n').filter(l => l.trim())" :key="j" class="flex gap-1.5">
                    <span class="text-muted mt-0.5">•</span>
                    <span class="flex-1">{{ line.trim() }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div v-for="(item, i) in promptParagraphs.filter(p => p.type === 'turn')" :key="'turn-' + i"
               class="text-xs leading-relaxed bg-bg-elevated rounded-lg p-2.5 border border-bg-border border-l-green-400 mb-3">
            <div class="text-[10px] text-muted font-medium mb-1.5">{{ item.title }}</div>
            <div class="space-y-1.5">
              <div v-for="(line, j) in item.para.split('\n').filter(l => l.trim())" :key="j" class="flex gap-1.5">
                <span class="text-accent mt-0.5">•</span>
                <span class="flex-1">{{ line.trim() }}</span>
              </div>
            </div>
          </div>
          <div>
            <button class="text-xs text-accent hover:underline flex items-center gap-1" @click="showFullPrompt = !showFullPrompt">
              {{ showFullPrompt ? '▾' : '▸' }} {{ showFullPrompt ? '收起完整 Prompt' : '展开完整 Prompt（原始字符串）' }}
            </button>
            <div v-if="showFullPrompt" class="whitespace-pre-wrap break-word font-mono text-xs leading-relaxed bg-bg-elevated rounded-lg p-3 border border-bg-border mt-2">
              {{ trace.renderSpec!.promptFull }}
            </div>
          </div>
        </div>
      </div>
    </NTabPane>

    <!-- Tab 5: LLM 原始输出 -->
    <NTabPane name="raw" tab="LLM 原始输出" class="flex-1 overflow-auto">
      <div class="p-3">
        <div v-if="visitorMessages.length === 0" class="text-xs text-muted text-center py-8">发送一轮后显示</div>
        <div v-else class="space-y-3">
          <div v-for="(msg, i) in visitorMessages" :key="i" class="text-xs">
            <div class="text-muted mb-1">第 {{ i + 1 }} 轮来访回应：</div>
            <div class="whitespace-pre-wrap bg-bg-elevated rounded p-2 border border-bg-border">{{ msg.text }}</div>
          </div>
        </div>
      </div>
    </NTabPane>

    <!-- Tab 6: 原始数据（完整 trace JSON） -->
    <NTabPane name="json" tab="原始 JSON" class="flex-1 overflow-auto">
      <div class="p-3">
        <div v-if="bdiHistory.length === 0" class="text-xs text-muted text-center py-8">发送一轮后显示</div>
        <template v-else>
          <div class="flex justify-between items-center mb-2">
            <span class="text-xs text-muted">第 {{ turnIndex }} 轮 trace</span>
            <NButton size="tiny" quaternary @click="navigator.clipboard.writeText(JSON.stringify({ turnIndex, bdiSnapshot: bdiHistory[bdiHistory.length - 1], trace }, null, 2))">复制 JSON</NButton>
          </div>
          <pre class="text-xs font-mono bg-bg-elevated rounded p-2 overflow-auto max-h-96">{{ JSON.stringify({ turnIndex, bdiSnapshot: bdiHistory[bdiHistory.length - 1], trace }, null, 2) }}</pre>
        </template>
      </div>
    </NTabPane>
  </NTabs>
</template>
