<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/api/client'
import type { SessionDetail, TurnTrace, MemoryEntry, MemorySource, DeltaDetail, CapReport } from '@/api/types'
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

// delta 审计 (WP58: 每轮事件 + 原始 delta + cap 砍幅明细)
const deltaAudit = ref<Awaited<ReturnType<typeof api.debugSession.deltaAudit>> | null>(null)
const deltaAuditLoading = ref(false)
const showDeltaAudit = ref(false)

// 记忆来源配置 (V2026-11-05: 与内核口径对齐 —— 原来的"事实/情感/关系"是前端自造的假维度)
const typeMeta: Record<MemorySource, { label: string; color: string }> = {
  turn: { label: '轮次原文', color: 'bg-blue-500/15 text-blue-400' },
  summary: { label: '会话摘要', color: 'bg-accent/15 text-accent' },
  manual: { label: '人工注入', color: 'bg-ok/15 text-ok' },
}

// ─── 中英双语映射（中文为主，括号里英文浅灰辅助）───
// 会话状态
const sessionStatusLabels: Record<string, { zh: string; en: string }> = {
  completed: { zh: '已完成', en: 'completed' },
  active: { zh: '进行中', en: 'active' },
  no_content: { zh: '空局', en: 'no_content' },
  parse_error: { zh: '解析错误', en: 'parse_error' },
}
// BDI 情绪标签
const emotionLabels: Record<string, { zh: string; en: string }> = {
  anxiousSecure: { zh: '焦虑安全', en: 'anxiousSecure' },
  secure: { zh: '安全型', en: 'secure' },
  anxious: { zh: '焦虑型', en: 'anxious' },
  avoidant: { zh: '回避型', en: 'avoidant' },
}

onMounted(async () => {
  try {
    data.value = await api.session(props.id)
    if (data.value.traces.length) selectedTurn.value = data.value.traces[0]?.turnIndex ?? 0
    trajectory.value = await api.trajectory(props.id)
    sessionMemories.value = await api.sessionMemories(props.id)
    // delta 审计: 懒加载, 用户点开才拉 (不是每场都有数据, 避免空请求)
  } catch (e) { err.value = String(e) }
  finally { loading.value = false }
})

// 懒加载 delta 审计 (用户点"展开"才请求)
async function loadDeltaAudit() {
  if (deltaAudit.value || deltaAuditLoading.value) return
  deltaAuditLoading.value = true
  try {
    deltaAudit.value = await api.debugSession.deltaAudit(props.id)
  } catch (e) {
    // 审计接口可能 404 (老会话没有审计数据), 静默失败
    console.warn('delta audit 加载失败', e)
  } finally {
    deltaAuditLoading.value = false
  }
}

const turn = computed<TurnTrace | null>(() =>
  data.value?.traces.find(t => t.turnIndex === selectedTurn.value) ?? null
)

// 点记忆 → 高亮它（不再跳轮次）。
// 之前这里靠一张写死的 id→轮次假表（m001 → 1 …）来跳轮 —— 那是 mock 数据，
// 真记忆的 id 根本不在表里，跳转会跳到一个**不相关**的轮次。
// 现在后端记忆契约里没有"来源轮次"字段，就不跳：只高亮，等后端补 originTurnIndex 再接。
const clickMemory = (m: MemoryEntry) => {
  highlightMemory.value = m.id
}

// 审议闸门原因中文映射（WP-C）
const gateReasonLabels: Record<string, string> = {
  crisis_skip: '危机跳过（合规红线）',
  first_turn_baseline: '首轮基线',
  key_event: '关键事件硬触发',
  cooldown: '冷却期',
  quota_exceeded: '配额超限',
  circuit_open: '熔断中',
  unknown_event_type: '未知事件类型',
  alliance_delta_high: '同盟维度变化大',
  resistance_delta_high: '阻抗维度变化大',
  calm_turn: '平静对话',
  rule_confident: '规则置信',
}
function gateReasonLabel(reason: string): string {
  return gateReasonLabels[reason] || reason
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

// ─── BDI 快照分组指标（大厂级 UI） ───
interface MetricItem {
  key: string
  label: string
  value?: number
  delta?: number
}

// 从前一轮快照计算 delta
const prevSnapshot = computed(() => {
  if (!data.value || !turn.value) return null
  const idx = turn.value.turnIndex
  if (idx === 0) return null
  return data.value.traces.find(t => t.turnIndex === idx - 1)?.bdiSnapshot ?? null
})

const calcDelta = (curr?: number, prev?: number): number | undefined => {
  if (curr === undefined || prev === undefined) return undefined
  return curr - prev
}

const allianceMetrics = computed<MetricItem[]>(() => {
  if (!turn.value) return []
  const s = turn.value.bdiSnapshot
  const p = prevSnapshot.value
  return [
    { key: 'trust', label: '信任', value: s.trust, delta: calcDelta(s.trust, p?.trust) },
    { key: 'safety', label: '安全感', value: s.safety, delta: calcDelta(s.safety, p?.safety) },
    { key: 'bond', label: '联结感', value: s.bond, delta: calcDelta(s.bond, p?.bond) },
  ]
})

const emotionMetrics = computed<MetricItem[]>(() => {
  if (!turn.value) return []
  const s = turn.value.bdiSnapshot
  const p = prevSnapshot.value
  return [
    { key: 'valence', label: '效价', value: s.valence, delta: calcDelta(s.valence, p?.valence) },
    { key: 'arousal', label: '唤醒', value: s.arousal, delta: calcDelta(s.arousal, p?.arousal) },
  ]
})

const resistanceMetrics = computed<MetricItem[]>(() => {
  if (!turn.value) return []
  const s = turn.value.bdiSnapshot
  const p = prevSnapshot.value
  return [
    { key: 'resistance', label: `总${t('sessionDetail.resistanceLabel')}`, value: s.resistance, delta: calcDelta(s.resistance, p?.resistance) },
    { key: 'verbal', label: '话量', value: s.resistanceVerbal, delta: calcDelta(s.resistanceVerbal, p?.resistanceVerbal) },
    { key: 'depth', label: '深度', value: s.resistanceDepth, delta: calcDelta(s.resistanceDepth, p?.resistanceDepth) },
    { key: 'style', label: '风格', value: s.resistanceStyle, delta: calcDelta(s.resistanceStyle, p?.resistanceStyle) },
  ]
})

const deltaArrow = (delta: number): string => {
  if (delta > 0.001) return `↑${delta.toFixed(2)}`
  if (delta < -0.001) return `↓${Math.abs(delta).toFixed(2)}`
  return '—'
}

const deltaArrowClass = (delta: number): string => {
  if (delta > 0.001) return 'text-ok'
  if (delta < -0.001) return 'text-danger'
  return 'text-muted'
}

// ─── Delta 明细分组 ───
const deltaAlliance = computed(() => {
  if (!deltaDetail.value) return []
  return [
    { key: 'trust', label: '信任', value: deltaDetail.value.trust },
    { key: 'safety', label: '安全感', value: deltaDetail.value.safety },
    { key: 'bond', label: '联结感', value: deltaDetail.value.bond },
  ]
})

const deltaEmotion = computed(() => {
  if (!deltaDetail.value) return []
  return [
    { key: 'valence', label: '效价', value: deltaDetail.value.valence },
    { key: 'arousal', label: '唤醒', value: deltaDetail.value.arousal },
  ]
})

const deltaResistance = computed(() => {
  if (!deltaDetail.value) return []
  return [
    { key: 'verbal', label: '话量', value: deltaDetail.value.verbal },
    { key: 'depth', label: '深度', value: deltaDetail.value.depth },
    { key: 'style', label: '风格', value: deltaDetail.value.style },
  ]
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
        <n-tag size="small" :bordered="false">
          <template v-if="sessionStatusLabels[data.status]">
            {{ sessionStatusLabels[data.status].zh }}
            <span class="text-muted ml-1">({{ sessionStatusLabels[data.status].en }})</span>
          </template>
          <template v-else>{{ data.status }}</template>
        </n-tag>
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
            <!-- 关系组 -->
            <div class="mb-3">
              <div class="text-[10px] uppercase tracking-wider text-muted mb-2">{{ t('sessionDetail.relationship') }}</div>
              <div class="grid grid-cols-3 gap-2">
                <div v-for="item in allianceMetrics" :key="item.key" class="bg-bg-base/60 rounded p-2.5">
                  <div class="text-[10px] text-muted mb-0.5">{{ item.label }}</div>
                  <div class="flex items-baseline gap-1">
                    <span class="font-mono text-base">{{ item.value?.toFixed(2) ?? '—' }}</span>
                    <span v-if="item.delta !== undefined" :class="deltaArrowClass(item.delta)" class="text-[10px] font-mono">
                      {{ deltaArrow(item.delta) }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <!-- {{ t('sessionDetail.emotion') }}组 -->
            <div class="mb-3">
              <div class="text-[10px] uppercase tracking-wider text-muted mb-2">{{ t('sessionDetail.emotion') }}</div>
              <div class="grid grid-cols-2 gap-2">
                <div v-for="item in emotionMetrics" :key="item.key" class="bg-bg-base/60 rounded p-2.5">
                  <div class="text-[10px] text-muted mb-0.5">{{ item.label }}</div>
                  <div class="flex items-baseline gap-1">
                    <span class="font-mono text-base">{{ item.value?.toFixed(2) ?? '—' }}</span>
                    <span v-if="item.delta !== undefined" :class="deltaArrowClass(item.delta)" class="text-[10px] font-mono">
                      {{ deltaArrow(item.delta) }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <!-- {{ t('sessionDetail.resistanceLabel') }}组 -->
            <div>
              <div class="text-[10px] uppercase tracking-wider text-muted mb-2">{{ t('sessionDetail.resistanceLabel') }}</div>
              <div class="grid grid-cols-3 gap-2">
                <div v-for="item in resistanceMetrics" :key="item.key" class="bg-bg-base/60 rounded p-2.5">
                  <div class="text-[10px] text-muted mb-0.5">{{ item.label }}</div>
                  <div class="flex items-baseline gap-1">
                    <span class="font-mono text-base">{{ item.value?.toFixed(2) ?? '—' }}</span>
                    <span v-if="item.delta !== undefined" :class="deltaArrowClass(item.delta)" class="text-[10px] font-mono">
                      {{ deltaArrow(item.delta) }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div class="mt-3 pt-3 border-t border-bg-border flex items-center justify-between">
              <span class="text-[10px] uppercase tracking-wider text-muted">{{ t('sessionDetail.emotionLabel') }}</span>
              <n-tag size="small" :bordered="false" type="primary">
                <template v-if="turn.bdiSnapshot.anxiousSecure && emotionLabels[turn.bdiSnapshot.anxiousSecure]">
                  {{ emotionLabels[turn.bdiSnapshot.anxiousSecure].zh }}
                  <span class="text-muted ml-1">({{ emotionLabels[turn.bdiSnapshot.anxiousSecure].en }})</span>
                </template>
                <template v-else>{{ turn.bdiSnapshot.anxiousSecure ?? '—' }}</template>
              </n-tag>
            </div>
          </n-card>

          <!-- 调试面板：Delta 明细 -->
          <n-card v-if="deltaDetail" size="small" :title="t('calibrator.deltaDetail')">
            <template #header-extra>
              <n-tag size="tiny" :bordered="false" type="warning">{{ t('sessionDetail.pendingBackend') }}</n-tag>
            </template>
            <!-- 关系 delta -->
            <div class="mb-2.5">
              <div class="text-[10px] uppercase tracking-wider text-muted mb-1.5">{{ t('sessionDetail.relationship') }}</div>
              <div class="space-y-1">
                <div v-for="item in deltaAlliance" :key="item.key" class="flex items-center justify-between text-xs font-mono">
                  <span class="text-muted">{{ item.label }}</span>
                  <span :class="deltaArrowClass(item.value)">
                    {{ item.value > 0 ? '+' : '' }}{{ item.value.toFixed(3) }}
                  </span>
                </div>
              </div>
            </div>
            <!-- {{ t('sessionDetail.emotion') }} delta -->
            <div class="mb-2.5">
              <div class="text-[10px] uppercase tracking-wider text-muted mb-1.5">{{ t('sessionDetail.emotion') }}</div>
              <div class="space-y-1">
                <div v-for="item in deltaEmotion" :key="item.key" class="flex items-center justify-between text-xs font-mono">
                  <span class="text-muted">{{ item.label }}</span>
                  <span :class="deltaArrowClass(item.value)">
                    {{ item.value > 0 ? '+' : '' }}{{ item.value.toFixed(3) }}
                  </span>
                </div>
              </div>
            </div>
            <!-- {{ t('sessionDetail.resistanceLabel') }} delta -->
            <div class="mb-2.5">
              <div class="text-[10px] uppercase tracking-wider text-muted mb-1.5">{{ t('sessionDetail.resistanceLabel') }}</div>
              <div class="space-y-1">
                <div v-for="item in deltaResistance" :key="item.key" class="flex items-center justify-between text-xs font-mono">
                  <span class="text-muted">{{ item.label }}</span>
                  <span :class="deltaArrowClass(item.value)">
                    {{ item.value > 0 ? '+' : '' }}{{ item.value.toFixed(3) }}
                  </span>
                </div>
              </div>
            </div>
            <!-- 触发事件 -->
            <div v-if="deltaDetail.events.length" class="mt-2 pt-2 border-t border-bg-border">
              <div class="text-[10px] uppercase tracking-wider text-muted mb-1.5">{{ t('sessionDetail.triggerEvent') }}</div>
              <div class="flex flex-wrap gap-1">
                <n-tag v-for="ev in deltaDetail.events" :key="ev" size="tiny" :bordered="false" type="info">
                  {{ ev }}
                </n-tag>
              </div>
            </div>
          </n-card>

          <!-- 调试面板：Cap 砍幅 -->
          <n-card v-if="capReport?.hasCapped" size="small" :title="t('calibrator.capCapped')" :bordered="false" class="border-l-2 border-l-warn">
            <template #header-extra>
              <n-tag size="tiny" :bordered="false" type="warning">{{ t('sessionDetail.pendingBackend') }}</n-tag>
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
              <n-tag size="tiny" :bordered="false" type="warning">{{ t('sessionDetail.pendingBackend') }}</n-tag>
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

          <!-- 审议闸门决策（WP-C） -->
          <n-card v-if="turn?.gateDecision" title="审议闸门" size="small">
            <div class="flex items-center gap-2">
              <span
                class="px-2 py-0.5 rounded text-xs font-medium border"
                :class="turn.gateDecision.decision === 'run'
                  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                  : 'bg-gray-500/15 text-gray-400 border-gray-500/30'"
              >
                {{ turn.gateDecision.decision === 'run' ? '跑审议' : '跳过' }}
              </span>
              <span class="text-xs text-muted">{{ gateReasonLabel(turn.gateDecision.reason) }}</span>
            </div>
            <div class="text-[10px] text-muted mt-2">
              阈值 {{ turn.gateDecision.thresholdUsed.toFixed(3) }}
            </div>
          </n-card>

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

      <!-- Delta 审计 (WP58: 每轮事件 + 原始 delta + cap 砍幅明细) -->
      <n-card size="small" class="mt-4">
        <template #header>
          <span class="text-sm font-medium">Delta 审计</span>
          <n-tag size="tiny" :bordered="false" type="info" class="ml-2">调试</n-tag>
        </template>
        <template #header-extra>
          <n-button
            size="tiny"
            quaternary
            :loading="deltaAuditLoading"
            @click="showDeltaAudit = !showDeltaAudit; loadDeltaAudit()"
          >
            {{ showDeltaAudit ? '收起' : '展开' }}
          </n-button>
        </template>

        <!-- 收起状态: 提示 -->
        <div v-if="!showDeltaAudit" class="text-xs text-muted">
          查看每一轮触发了什么事件、原始 delta 是多少、哪些维度被 cap 砍了。
        </div>

        <!-- 展开状态 -->
        <div v-else class="space-y-3">
          <div v-if="deltaAuditLoading" class="text-xs text-muted py-4 text-center">加载中…</div>
          <div v-else-if="!deltaAudit || !deltaAudit.turns.length" class="text-xs text-muted py-4 text-center">
            本场没有 delta 审计数据 (老会话或未开启审计)
          </div>
          <div v-else class="space-y-2">
            <div v-for="turn in deltaAudit.turns" :key="turn.turnIndex"
                 class="bg-bg-base/40 rounded p-3 border border-bg-border">
              <!-- 轮次标题行 -->
              <div class="flex items-center gap-2 mb-2">
                <span class="text-xs font-mono font-medium">T{{ turn.turnIndex }}</span>
                <n-tag v-if="turn.crisisDetected" size="tiny" :bordered="false" type="error">⚠ 危机</n-tag>
                <n-tag v-if="turn.capApplied" size="tiny" :bordered="false" type="warning">⚠ 有砍幅</n-tag>
              </div>

              <!-- 触发事件 -->
              <div v-if="turn.events.length" class="mb-2">
                <div class="text-[10px] uppercase tracking-wider text-muted mb-1">触发事件</div>
                <div class="flex flex-wrap gap-1">
                  <n-tag v-for="ev in turn.events" :key="ev" size="tiny" :bordered="false" type="info">
                    {{ ev }}
                  </n-tag>
                </div>
              </div>

              <!-- delta 对比表 -->
              <div class="grid grid-cols-3 gap-2 text-xs">
                <div v-for="(val, dim) in turn.rawDeltas" :key="dim"
                     class="flex items-center justify-between font-mono">
                  <span class="text-muted">{{ dim }}</span>
                  <span :class="val > 0.001 ? 'text-ok' : val < -0.001 ? 'text-danger' : 'text-muted'">
                    {{ val > 0 ? '+' : '' }}{{ val.toFixed(3) }}
                  </span>
                </div>
              </div>

              <!-- cap 砍幅明细 (如果有) -->
              <div v-if="turn.capApplied" class="mt-2 pt-2 border-t border-bg-border">
                <div class="text-[10px] uppercase tracking-wider text-muted mb-1.5">砍幅明细</div>
                <div class="space-y-1">
                  <div v-for="(cappedVal, dim) in turn.cappedDeltas" :key="dim"
                       class="flex items-center justify-between text-xs font-mono">
                    <span class="text-muted">{{ dim }}</span>
                    <span>
                      <span class="line-through text-danger mr-2">{{ turn.rawDeltas[dim]?.toFixed(3) }}</span>
                      <span class="text-warn">→ {{ cappedVal.toFixed(3) }}</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </n-card>

      <!-- 本场记忆 -->
      <n-card v-if="sessionMemories.length" :title="t('sessionDetail.sessionMemories')" size="small" class="mt-4">
        <template #header-extra>
          <div class="flex gap-2 text-[10px] text-muted">
            <span>{{ sessionMemories.length }} {{ t('memories.count') }}</span>
            <span class="text-accent">{{ sessionMemories.filter(m => m.tier === 'long_term').length }} {{ t('memories.longTerm') }}</span>
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
              {{ typeMeta[m.source].label }}
            </n-tag>
            <div class="flex-1 min-w-0">
              <p class="text-sm" :class="m.supersededBy ? 'line-through' : ''">{{ m.content }}</p>
              <div class="text-[10px] text-muted mt-0.5 font-mono">
                {{ new Date(m.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }} · imp {{ m.importance.toFixed(1) }}
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
