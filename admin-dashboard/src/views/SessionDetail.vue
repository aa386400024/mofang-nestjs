<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/api/client'
import type { SessionDetail, TurnTrace, MemoryEntry, MemoryType } from '@/api/types'
import InfoTooltip from '@/components/InfoTooltip.vue'
import BdiTrajectoryChart from '@/components/BdiTrajectoryChart.vue'
import SafetyVerdictPanel from '@/components/SafetyVerdictPanel.vue'
import ReportPanel from '@/components/ReportPanel.vue'
import TrajectoryPanel from '@/components/TrajectoryPanel.vue'

const { t } = useI18n()
const props = defineProps<{ id: string }>()
const data = ref<SessionDetail | null>(null)
const loading = ref(true)
const err = ref('')
const selectedTurn = ref(0)
const trajectory = ref<Awaited<ReturnType<typeof api.trajectory>>>(null)
const sessionMemories = ref<MemoryEntry[]>([])
const highlightMemory = ref<string | null>(null)

// mock：记忆 id → 轮次映射（后端补 originTurnIndex 后切换）
const memoryTurnMap: Record<string, number> = {
  m001: 1, m002: 2, m003: 1, m004: 2,
  m005: 1, m006: 2, m007: 1,
  m010: 0, m011: 1, m012: 2, m013: 1,
  m014: 1, m015: 2,
}

const typeMeta: Record<MemoryType, { label: string; color: string }> = {
  fact: { label: '事实', color: 'bg-blue-500/15 text-blue-400' },
  emotion: { label: '情感', color: 'bg-accent/15 text-accent' },
  relationship: { label: '关系', color: 'bg-purple-500/15 text-purple-400' },
  event: { label: '事件', color: 'bg-warn/15 text-warn' },
  preference: { label: '偏好', color: 'bg-ok/15 text-ok' },
}

onMounted(async () => {
  try {
    data.value = await api.session(props.id)
    if (data.value.traces.length) selectedTurn.value = data.value.traces[0].turnIndex
    trajectory.value = await api.trajectory(props.id)
    sessionMemories.value = await api.sessionMemories(props.id)
  } catch (e) { err.value = String(e) }
  finally { loading.value = false }
})

const turn = computed<TurnTrace | null>(() =>
  data.value?.traces.find(t => t.turnIndex === selectedTurn.value) ?? null
)

// 当前轮次对应的记忆
const memoriesForTurn = computed(() =>
  sessionMemories.value.filter(m => memoryTurnMap[m.id] === selectedTurn.value)
)

const clickMemory = (m: MemoryEntry) => {
  const turnIdx = memoryTurnMap[m.id]
  if (turnIdx !== undefined) selectedTurn.value = turnIdx
  highlightMemory.value = m.id
}
</script>

<template>
  <div class="p-6 max-w-6xl mx-auto">
    <button class="text-sm text-muted hover:text-accent mb-4" @click="$router.push('/sessions')">{{ t('sessionDetail.back') }}</button>
    <div v-if="loading" class="text-muted text-sm">…</div>
    <div v-else-if="err" class="text-danger text-sm">{{ err }}</div>
    <template v-else-if="data">
      <div class="flex items-center gap-6 mb-5 text-sm">
        <span class="font-semibold text-base">{{ data.visitorAlias }}</span>
        <span class="chip bg-bg-elevated text-muted">{{ data.status }}</span>
        <RouterLink to="/memories" class="text-xs text-accent hover:underline underline-offset-2">
          {{ t('sessionDetail.viewMemories') }} →
        </RouterLink>
        <span class="ml-auto flex gap-4 text-xs text-muted font-mono">
          <span>{{ data.traces.length }} trace</span>
          <span>{{ sessionMemories.length }} {{ t('sessionDetail.memories') }}</span>
        </span>
      </div>
      <div class="grid grid-cols-2 gap-4">
          <div class="card p-4">
            <h2 class="text-xs uppercase text-muted mb-3">{{ t('sessionDetail.transcript') }}</h2>
            <div class="space-y-3 max-h-[600px] overflow-y-auto">
              <div v-for="(tr, i) in data.transcript" :key="i"
                   class="flex cursor-pointer"
                   :class="tr.role === 'visitor' ? 'justify-end' : ''"
                   @click="selectedTurn = Math.floor(i / 2)">
                <div class="max-w-[80%] px-3 py-2 rounded-lg transition"
                     :class="[tr.role === 'visitor'
                       ? 'bg-accent/15 border border-accent/30'
                       : 'bg-bg-elevated border border-bg-border',
                       Math.floor(i / 2) === selectedTurn ? 'ring-1 ring-accent/50' : '']">
                  <div class="text-[10px] mb-0.5" :class="tr.role === 'visitor' ? 'text-accent-muted' : 'text-muted'">
                    {{ tr.role === 'visitor' ? t('nav.sessions') : t('characters.title') }} · {{ t('sessionDetail.turnLabel') }}{{ Math.floor(i / 2) + 1 }}
                  </div>
                  <div class="text-sm">{{ tr.text }}</div>
                </div>
              </div>
              <div v-if="!data.transcript.length" class="text-muted text-sm">—</div>
            </div>
          </div>
        <div class="space-y-4">
          <div class="card p-3">
            <h2 class="text-xs uppercase text-muted mb-2">{{ t('sessionDetail.turnTrace') }}</h2>
            <div class="flex flex-wrap gap-1">
              <button v-for="tr in data.traces" :key="tr.turnIndex"
                      class="w-8 h-8 rounded text-xs font-mono"
                      :class="tr.turnIndex === selectedTurn ? 'bg-accent text-bg-base' : 'bg-bg-elevated text-muted'"
                      @click="selectedTurn = tr.turnIndex">{{ tr.turnIndex }}</button>
              <span v-if="!data.traces.length" class="text-muted text-xs">—</span>
            </div>
          </div>
          <div v-if="turn" class="card p-4">
            <h2 class="text-xs uppercase tracking-wider text-muted mb-3">{{ t('sessionDetail.bdiSnapshot') }}</h2>
            <div class="grid grid-cols-2 gap-3">
              <div class="bg-bg-base/60 rounded p-3">
                <div class="text-[10px] uppercase tracking-wider text-muted mb-1 flex items-center">trust<InfoTooltip :text="t('sessionDetail.trustDesc')" /></div>
                <div class="font-mono text-lg text-gray-100">{{ turn.bdi.trust.toFixed(2) }}</div>
              </div>
              <div class="bg-bg-base/60 rounded p-3">
                <div class="text-[10px] uppercase tracking-wider text-muted mb-1 flex items-center">valence<InfoTooltip :text="t('sessionDetail.valenceDesc')" /></div>
                <div class="font-mono text-lg text-gray-100">{{ turn.bdi.valence.toFixed(2) }}</div>
              </div>
              <div class="bg-bg-base/60 rounded p-3">
                <div class="text-[10px] uppercase tracking-wider text-muted mb-1 flex items-center">arousal<InfoTooltip :text="t('sessionDetail.arousalDesc')" /></div>
                <div class="font-mono text-lg text-gray-100">{{ turn.bdi.arousal.toFixed(2) }}</div>
              </div>
              <div class="bg-bg-base/60 rounded p-3">
                <div class="text-[10px] uppercase tracking-wider text-muted mb-1 flex items-center">resistance<InfoTooltip :text="t('sessionDetail.resistanceDesc')" /></div>
                <div class="font-mono text-lg text-gray-100">{{ turn.bdi.resistance.toFixed(2) }}</div>
              </div>
            </div>
            <div class="mt-3 pt-3 border-t border-bg-border flex items-center justify-between">
              <span class="text-[10px] uppercase tracking-wider text-muted">{{ t('sessionDetail.emotionLabel') }}</span>
              <span class="chip bg-accent/15 text-accent">{{ turn.bdi.attachmentType }}</span>
            </div>
          </div>
          <div v-if="turn" class="card p-4">
            <h2 class="text-xs uppercase tracking-wider text-muted mb-3">{{ t('sessionDetail.llmUsage') }}</h2>
            <div class="grid grid-cols-2 gap-3">
              <div class="bg-bg-base/60 rounded p-3">
                <div class="text-[10px] uppercase tracking-wider text-muted mb-1 flex items-center">completion<InfoTooltip :text="t('sessionDetail.completionDesc')" /></div>
                <div class="font-mono text-lg text-gray-100">{{ turn.usage.completionTokens }}</div>
              </div>
              <div class="bg-bg-base/60 rounded p-3">
                <div class="text-[10px] uppercase tracking-wider text-muted mb-1 flex items-center">reasoning<InfoTooltip :text="t('sessionDetail.reasoningDesc')" /></div>
                <div class="font-mono text-lg text-warn">{{ turn.usage.reasoningTokens }}</div>
              </div>
            </div>
          </div>
          <!-- 安全判定 -->
          <SafetyVerdictPanel :verdict="turn?.safety ?? null" />
          <!-- RenderSpec prompt 预览 -->
          <div v-if="turn?.render" class="card p-4">
            <h2 class="text-xs uppercase tracking-wider text-muted mb-3 flex items-center">
              {{ t('sessionDetail.renderSpec') }}
              <InfoTooltip :text="t('sessionDetail.renderSpecTooltip')" />
            </h2>
            <div class="space-y-2.5">
              <div v-if="turn.render.system" class="bg-bg-base/40 rounded p-2.5">
                <div class="text-[10px] uppercase tracking-wider text-accent-muted mb-1">{{ t('sessionDetail.system') }}</div>
                <p class="text-xs text-gray-300 leading-relaxed">{{ turn.render.system }}</p>
              </div>
              <div v-if="turn.render.context" class="bg-bg-base/40 rounded p-2.5">
                <div class="text-[10px] uppercase tracking-wider text-warn mb-1">{{ t('sessionDetail.context') }}</div>
                <p class="text-xs text-gray-300 leading-relaxed whitespace-pre-line">{{ turn.render.context }}</p>
              </div>
              <div v-if="turn.render.instructions" class="bg-bg-base/40 rounded p-2.5">
                <div class="text-[10px] uppercase tracking-wider text-ok mb-1">{{ t('sessionDetail.instructions') }}</div>
                <p class="text-xs text-gray-300 leading-relaxed">{{ turn.render.instructions }}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- BDI 轨迹 -->
      <div v-if="data.traces.length > 1" class="mt-4 card p-4">
        <h2 class="text-xs uppercase tracking-wider text-muted mb-3 flex items-center">
          {{ t('sessionDetail.bdiTrajectory') }}
          <InfoTooltip :text="t('sessionDetail.bdiTrajectoryTooltip')" />
        </h2>
        <BdiTrajectoryChart :turns="data.traces" />
      </div>

      <!-- Token 消耗逐轮 -->
      <div v-if="data.traces.length > 1" class="mt-4 card p-4">
        <h2 class="text-xs uppercase tracking-wider text-muted mb-3">{{ t('sessionDetail.tokenPerTurn') }}</h2>
        <div class="space-y-1.5">
          <div v-for="tr in data.traces" :key="tr.turnIndex"
               class="flex items-center gap-2 cursor-pointer"
               :class="tr.turnIndex === selectedTurn ? 'opacity-100' : 'opacity-70'"
               @click="selectedTurn = tr.turnIndex">
            <span class="text-[10px] font-mono text-muted w-8">T{{ tr.turnIndex }}</span>
            <div class="flex-1 h-4 bg-bg-elevated rounded overflow-hidden">
              <div class="h-full rounded bg-accent/50"
                   :style="{ width: `${(tr.usage.completionTokens / Math.max(...data.traces.map(t => t.usage.completionTokens))) * 100}%` }"></div>
            </div>
            <span class="text-[10px] font-mono text-muted w-12 text-right">{{ tr.usage.completionTokens }}</span>
          </div>
        </div>
      </div>

      <!-- 本场记忆 -->
      <div v-if="sessionMemories.length" class="mt-4 card p-4">
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-xs uppercase tracking-wider text-muted flex items-center gap-1.5">
            {{ t('sessionDetail.sessionMemories') }}
            <InfoTooltip :text="t('sessionDetail.sessionMemoriesTooltip')" />
          </h2>
          <div class="flex gap-2 text-[10px] text-muted">
            <span>{{ sessionMemories.length }} {{ t('memories.count') }}</span>
            <span class="text-accent">{{ sessionMemories.filter(m => m.source === 'long_term').length }} {{ t('memories.longTerm') }}</span>
            <span v-if="sessionMemories.some(m => m.supersededBy)" class="text-warn">{{ sessionMemories.filter(m => m.supersededBy).length }} {{ t('memories.supersededShort') }}</span>
          </div>
        </div>
        <div class="space-y-1.5">
          <div v-for="m in sessionMemories" :key="m.id"
               class="flex items-start gap-2.5 p-2 rounded cursor-pointer transition"
               :class="[highlightMemory === m.id ? 'bg-accent/10' : 'hover:bg-bg-elevated/50',
                        m.supersededBy ? 'opacity-50' : '']"
               @click="clickMemory(m)">
            <span class="chip shrink-0 mt-0.5 text-[10px]" :class="typeMeta[m.type].color">
              {{ typeMeta[m.type].label }}
            </span>
            <div class="flex-1 min-w-0">
              <p class="text-sm text-gray-200" :class="m.supersededBy ? 'line-through' : ''">{{ m.content }}</p>
              <div class="text-[10px] text-muted mt-0.5 font-mono">
                T{{ memoryTurnMap[m.id] ?? '?' }} · imp {{ m.importance.toFixed(1) }}
                <span v-if="m.supersededBy" class="text-warn ml-2">→ {{ m.supersededBy }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 剧本轨迹 -->
      <TrajectoryPanel :state="trajectory" />

      <!-- 复盘报告 -->
      <ReportPanel :report="data.report" />
    </template>
  </div>
</template>
