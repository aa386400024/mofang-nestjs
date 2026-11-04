<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/api/client'
import type { SessionDetail, TurnTrace, MemoryEntry, MemoryType, DeltaDetail, CapReport } from '@/api/types'
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
    if (data.value.traces.length) selectedTurn.value = data.value.traces[0]?.turnIndex ?? 0
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

// ─── 调试面板：delta 明细（mock，后端补真实数据后替换） ───
// 从前后两轮快照差值推算 delta，作为前端 UI 的 mock 数据
const deltaDetail = computed<DeltaDetail | null>(() => {
  if (!data.value || !turn.value) return null
  const idx = turn.value.turnIndex
  if (idx === 0) return null // 第一轮没有前值

  const prev = data.value.traces.find(t => t.turnIndex === idx - 1)?.bdiSnapshot
  const curr = turn.value.bdiSnapshot
  if (!prev || !curr) return null

  return {
    trust: curr.trust - prev.trust,
    safety: 0, // mock，后端补
    bond: 0,   // mock，后端补
    valence: curr.valence - prev.valence,
    arousal: curr.arousal - prev.arousal,
    verbal: 0, // mock，后端补
    depth: 0,  // mock，后端补
    style: 0,  // mock，后端补
    events: ['empathy'], // mock，后端补
  }
})

// ─── 调试面板：cap 砍幅报告（mock） ───
const capReport = computed<CapReport | null>(() => {
  if (!deltaDetail.value) return null
  const dims: (keyof DeltaDetail)[] = ['trust', 'valence', 'arousal']
  const capped: CapReport['capped'] = []

  // 假设 cap 阈值是 ±0.2，超过就模拟被砍了
  dims.forEach(dim => {
    const val = deltaDetail.value![dim] as number
    if (Math.abs(val) > 0.2) {
      capped.push({
        dimension: dim,
        rawDelta: val,
        cappedDelta: val > 0 ? 0.2 : -0.2,
        capLimit: val > 0 ? 0.2 : -0.2,
      })
    }
  })

  return { capped, hasCapped: capped.length > 0 }
})

// ─── 调试面板：信念激活状态（mock，WP57 做完后接入真实数据） ───
const beliefActivation = computed<Record<string, number>>(() => {
  if (!turn.value) return {}
  // mock：根据 trust 和 resistance 模拟信念激活
  const trust = turn.value.bdiSnapshot.trust
  const resistance = turn.value.bdiSnapshot.resistance
  return {
    '我不值得被爱': resistance * 0.8,
    '别人会伤害我': resistance * 0.6,
    '我必须完美': 0.3, // mock
  }
})
</script>

<template>
  <div class="p-6 max-w-6xl mx-auto">
    <n-button size="small" quaternary class="mb-4" @click="$router.push('/sessions')">{{ t('sessionDetail.back') }}</n-button>
    <div v-if="loading" class="text-muted text-sm">…</div>
    <div v-else-if="err" class="text-danger text-sm">{{ err }}</div>
    <template v-else-if="data">
      <div class="flex items-center gap-3 mb-5 text-sm">
        <span class="font-semibold text-base">{{ data.visitorAlias }}</span>
        <n-tag size="small" :bordered="false">{{ data.status }}</n-tag>
        <RouterLink to="/memories" class="text-xs text-accent hover:underline underline-offset-2">
          {{ t('sessionDetail.viewMemories') }} →
        </RouterLink>
        <span class="ml-auto flex gap-4 text-xs text-muted font-mono">
          <span>{{ data.traces.length }} trace</span>
          <span>{{ sessionMemories.length }} {{ t('sessionDetail.memories') }}</span>
        </span>
      </div>
      <n-grid cols="2" responsive="screen" class="gap-4">
          <!-- 对话记录 -->
          <n-card :title="t('sessionDetail.transcript')" size="small">
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
          </n-card>

        <!-- 右侧面板 -->
        <div class="space-y-4">
          <!-- 轮次切换 -->
          <n-card :title="t('sessionDetail.turnTrace')" size="small" :title-style="{ fontSize: '12px' }">
            <div class="flex flex-wrap gap-1">
              <n-button v-for="tr in data.traces" :key="tr.turnIndex"
                        size="tiny"
                        :type="tr.turnIndex === selectedTurn ? 'primary' : 'default'"
                        @click="selectedTurn = tr.turnIndex">{{ tr.turnIndex }}</n-button>
              <span v-if="!data.traces.length" class="text-muted text-xs">—</span>
            </div>
          </n-card>

          <!-- BDI 快照 -->
          <n-card v-if="turn" :title="t('sessionDetail.bdiSnapshot')" size="small">
            <n-grid cols="2" responsive="screen" class="gap-3">
              <div v-for="(val, key) in turn.bdiSnapshot" :key="key" v-if="typeof val === 'number'" class="bg-bg-base/60 rounded p-3">
                <div class="text-[10px] uppercase tracking-wider text-muted mb-1">{{ key }}</div>
                <div class="font-mono text-lg">{{ val.toFixed(2) }}</div>
              </div>
            </n-grid>
            <div class="mt-3 pt-3 border-t border-bg-border flex items-center justify-between">
              <span class="text-[10px] uppercase tracking-wider text-muted">{{ t('sessionDetail.emotionLabel') }}</span>
              <n-tag size="small" :bordered="false" type="primary">{{ turn.bdiSnapshot.anxiousSecure ?? '—' }}</n-tag>
            </div>
          </n-card>

          <!-- 调试面板：Delta 明细 -->
          <n-card v-if="deltaDetail" size="small" :title="t('calibrator.deltaDetail')">
            <template #header-extra>
              <n-tag size="tiny" :bordered="false">{{ t('calibrator.mock') }}</n-tag>
            </template>
            <div class="space-y-1.5 text-xs font-mono">
              <div v-for="(val, key) in deltaDetail" :key="key" v-if="typeof val === 'number'"
                   class="flex items-center justify-between">
                <span class="text-muted">{{ key }}</span>
                <span :class="[val > 0 ? 'text-ok' : val < 0 ? 'text-danger' : 'text-muted']">
                  {{ val > 0 ? '+' : '' }}{{ val.toFixed(3) }}
                </span>
              </div>
            </div>
            <div v-if="deltaDetail.events.length" class="mt-2 pt-2 border-t border-bg-border">
              <span class="text-[10px] text-muted">触发事件：</span>
              <span class="text-xs font-mono text-accent">{{ deltaDetail.events.join(', ') }}</span>
            </div>
          </n-card>

          <!-- 调试面板：Cap 砍幅 -->
          <n-card v-if="capReport?.hasCapped" size="small" :title="t('calibrator.capCapped')" :bordered="false" class="border-l-2 border-l-warn">
            <template #header-extra>
              <n-tag size="tiny" :bordered="false" type="warning">{{ t('calibrator.mock') }}</n-tag>
            </template>
            <div class="space-y-1 text-xs">
              <div v-for="c in capReport.capped" :key="c.dimension" class="font-mono">
                <span class="text-muted">{{ c.dimension }}</span>
                <span class="text-danger line-through ml-2">{{ c.rawDelta.toFixed(3) }}</span>
                <span class="text-warn ml-2">→ {{ c.cappedDelta.toFixed(3) }}</span>
              </div>
            </div>
          </n-card>

          <!-- 调试面板：信念激活状态 -->
          <n-card v-if="Object.keys(beliefActivation).length" size="small" :title="t('calibrator.beliefActivation')">
            <template #header-extra>
              <n-tag size="tiny" :bordered="false">{{ t('calibrator.mock') }}</n-tag>
            </template>
            <div class="space-y-2">
              <div v-for="(level, theme) in beliefActivation" :key="theme">
                <div class="flex items-center justify-between text-xs mb-1">
                  <span>{{ theme }}</span>
                  <span class="font-mono text-muted">{{ level.toFixed(2) }}</span>
                </div>
                <n-progress type="line" :percentage="level * 100" :show-text="false" />
              </div>
            </div>
          </n-card>

          <!-- LLM 用量 -->
          <n-card v-if="turn?.llmUsage" :title="t('sessionDetail.llmUsage')" size="small">
            <n-grid cols="2" responsive="screen" class="gap-3">
              <div class="bg-bg-base/60 rounded p-3">
                <div class="text-[10px] uppercase tracking-wider text-muted mb-1">completion</div>
                <div class="font-mono text-lg">{{ turn.llmUsage.completionTokens }}</div>
              </div>
              <div class="bg-bg-base/60 rounded p-3">
                <div class="text-[10px] uppercase tracking-wider text-muted mb-1">reasoning</div>
                <div class="font-mono text-lg text-warn">{{ turn.llmUsage.reasoningTokens }}</div>
              </div>
            </n-grid>
          </n-card>

          <!-- 安全判定 -->
          <SafetyVerdictPanel :verdict="null" />

          <!-- RenderSpec prompt 预览 -->
          <n-card v-if="turn?.renderSpec?.promptPreview" :title="t('sessionDetail.renderSpec')" size="small">
            <div class="bg-bg-base/40 rounded p-2.5">
              <div class="text-[10px] uppercase tracking-wider text-accent-muted mb-1">prompt preview</div>
              <p class="text-xs leading-relaxed">{{ turn.renderSpec.promptPreview }}</p>
            </div>
          </n-card>
        </div>
      </n-grid>

      <!-- BDI 轨迹 -->
      <n-card v-if="data.traces.length > 1" :title="t('sessionDetail.bdiTrajectory')" size="small" class="mt-4">
        <BdiTrajectoryChart :turns="data.traces" />
      </n-card>

      <!-- Token 消耗逐轮 -->
      <n-card v-if="data.traces.length > 1" :title="t('sessionDetail.tokenPerTurn')" size="small" class="mt-4">
        <div class="space-y-1.5">
          <div v-for="tr in data.traces" :key="tr.turnIndex"
               class="flex items-center gap-2 cursor-pointer"
               :class="tr.turnIndex === selectedTurn ? 'opacity-100' : 'opacity-70'"
               @click="selectedTurn = tr.turnIndex">
            <span class="text-[10px] font-mono text-muted w-8">T{{ tr.turnIndex }}</span>
            <n-progress type="line" :percentage="((tr.llmUsage?.completionTokens ?? 0) / Math.max(...data.traces.map(t => t.llmUsage?.completionTokens ?? 0), 1)) * 100" :show-text="false" class="flex-1" />
            <span class="text-[10px] font-mono text-muted w-12 text-right">{{ tr.llmUsage?.completionTokens ?? 0 }}</span>
          </div>
        </div>
      </n-card>

      <!-- 本场记忆 -->
      <n-card v-if="sessionMemories.length" :title="t('sessionDetail.sessionMemories')" size="small" class="mt-4">
        <template #header-extra>
          <div class="flex gap-2 text-[10px] text-muted">
            <span>{{ sessionMemories.length }} {{ t('memories.count') }}</span>
            <span class="text-accent">{{ sessionMemories.filter(m => m.source === 'long_term').length }} {{ t('memories.longTerm') }}</span>
            <span v-if="sessionMemories.some(m => m.supersededBy)" class="text-warn">{{ sessionMemories.filter(m => m.supersededBy).length }} {{ t('memories.supersededShort') }}</span>
          </div>
        </template>
        <div class="space-y-1.5">
          <div v-for="m in sessionMemories" :key="m.id"
               class="flex items-start gap-2.5 p-2 rounded cursor-pointer transition"
               :class="[highlightMemory === m.id ? 'bg-accent/10' : 'hover:bg-bg-elevated/50',
                        m.supersededBy ? 'opacity-50' : '']"
               @click="clickMemory(m)">
            <n-tag size="small" :bordered="false" class="shrink-0 mt-0.5">
              {{ typeMeta[m.type].label }}
            </n-tag>
            <div class="flex-1 min-w-0">
              <p class="text-sm" :class="m.supersededBy ? 'line-through' : ''">{{ m.content }}</p>
              <div class="text-[10px] text-muted mt-0.5 font-mono">
                T{{ memoryTurnMap[m.id] ?? '?' }} · imp {{ m.importance.toFixed(1) }}
                <span v-if="m.supersededBy" class="text-warn ml-2">→ {{ m.supersededBy }}</span>
              </div>
            </div>
          </div>
        </div>
      </n-card>

      <!-- 剧本轨迹 -->
      <TrajectoryPanel :state="trajectory" />

      <!-- 复盘报告 -->
      <ReportPanel :report="data.report" />
    </template>
  </div>
</template>
