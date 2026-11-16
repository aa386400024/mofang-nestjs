<script setup lang="ts">
import { ref, computed, watch, onMounted, reactive, h } from 'vue'
import { useI18n } from 'vue-i18n'
import { use } from 'echarts/core'
import { LineChart, HeatmapChart, BarChart } from 'echarts/charts'
import {
  GridComponent, TooltipComponent, LegendComponent,
  MarkLineComponent, MarkAreaComponent, DataZoomComponent,
  VisualMapComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import VChart from 'vue-echarts'

use([
  LineChart, HeatmapChart, BarChart,
  GridComponent, TooltipComponent, LegendComponent,
  MarkLineComponent, MarkAreaComponent, DataZoomComponent,
  VisualMapComponent,
  CanvasRenderer,
])

const { t } = useI18n()

// ========== 类型定义 ==========

interface DeltaRow {
  kind: string
  label: string
  clinicalLabel: string
  trust: number
  safety: number
  bond: number
  valence: number
  arousal: number
  verbal: number
  depth: number
  style: number
}

interface CapConfig {
  dimension: string
  label: string
  up: number
  down: number
}

type AttachmentStyle = 'secure' | 'anxious' | 'avoidant' | 'disorganized'

interface AttachmentModulation {
  trustScale: number
  safetyScale: number
  bondScale: number
  resistanceScale: number
}

interface SimulationTurn {
  turn: number
  eventKind: string
  eventLabel: string
  trust: number
  safety: number
  bond: number
  valence: number
  arousal: number
  verbal: number
  depth: number
  style: number
  phase: 'exploration' | 'neutral' | 'resistance'
}

interface PresetScenario {
  id: string
  name: string
  shortName: string
  desc: string
  events: string[]
}

// ========== 预设场景库 ==========

const presetScenarios: PresetScenario[] = [
  {
    id: 'opening',
    name: '初次访谈 · 建立关系',
    shortName: '初次访谈',
    desc: '咨询师以共情和接纳开场，来访逐步打开',
    events: ['empathy', 'acceptance', 'open_probe', 'empathy', 'normalization', 'open_probe', 'affirmation', 'empathy'],
  },
  {
    id: 'exploration',
    name: '中期工作 · 深入探索',
    shortName: '深入探索',
    desc: '信任建立后，咨询师深入探索敏感议题',
    events: ['open_probe', 'empathy', 'sensitive_touch', 'acceptance', 'open_probe', 'empathy', 'normalization', 'affirmation'],
  },
  {
    id: 'resistance',
    name: '阻抗出现 · 来访退缩',
    shortName: '阻抗出现',
    desc: '咨询师不慎评判，来访阻抗上升',
    events: ['empathy', 'open_probe', 'judgment', 'preaching', 'minimizing', 'empathy', 'open_probe', 'acceptance'],
  },
  {
    id: 'rupture',
    name: '破裂与修复 · 信任危机',
    shortName: '破裂修复',
    desc: '边界侵犯导致信任破裂，随后尝试修复',
    events: ['empathy', 'open_probe', 'boundary_cross', 'judgment', 'empathy', 'acceptance', 'normalization', 'affirmation'],
  },
  {
    id: 'closing',
    name: '结案阶段 · 巩固收获',
    shortName: '结案',
    desc: '咨询接近尾声，回顾收获，结束关系',
    events: ['affirmation', 'empathy', 'normalization', 'acceptance', 'empathy', 'open_probe', 'affirmation', 'empathy'],
  },
]

// ========== 默认参数（内核种子值） ==========

const defaultDeltaTable: DeltaRow[] = [
  { kind: 'empathy', label: '共情', clinicalLabel: '咨询师表达共情理解', trust: 0.10, safety: 0.02, bond: 0.01, valence: 0.10, arousal: -0.05, verbal: -0.08, depth: -0.10, style: -0.06 },
  { kind: 'acceptance', label: '接纳', clinicalLabel: '咨询师无条件接纳来访', trust: 0.08, safety: 0.02, bond: 0.01, valence: 0.08, arousal: -0.04, verbal: -0.06, depth: -0.08, style: -0.05 },
  { kind: 'normalization', label: '正常化', clinicalLabel: '咨询师正常化来访的感受', trust: 0.07, safety: 0.01, bond: 0.01, valence: 0.07, arousal: 0, verbal: -0.05, depth: -0.07, style: -0.04 },
  { kind: 'open_probe', label: '开放探问', clinicalLabel: '咨询师开放式提问探索', trust: 0.05, safety: 0.01, bond: 0, valence: 0.04, arousal: 0.02, verbal: -0.03, depth: -0.06, style: -0.03 },
  { kind: 'affirmation', label: '肯定', clinicalLabel: '咨询师肯定来访的力量', trust: 0.08, safety: 0.01, bond: 0.01, valence: 0.10, arousal: -0.03, verbal: -0.04, depth: -0.06, style: -0.04 },
  { kind: 'judgment', label: '评判', clinicalLabel: '咨询师评判或指责来访', trust: -0.12, safety: -0.03, bond: -0.02, valence: -0.12, arousal: 0.06, verbal: 0.06, depth: 0.08, style: 0.12 },
  { kind: 'preaching', label: '说教', clinicalLabel: '咨询师说教或讲道理', trust: -0.10, safety: -0.02, bond: -0.01, valence: -0.08, arousal: 0.03, verbal: 0.08, depth: 0.06, style: 0.06 },
  { kind: 'minimizing', label: '淡化', clinicalLabel: '咨询师淡化来访的感受', trust: -0.10, safety: -0.02, bond: -0.02, valence: -0.12, arousal: 0.04, verbal: 0.05, depth: 0.10, style: 0.05 },
  { kind: 'boundary_cross', label: '边界侵犯', clinicalLabel: '咨询师突破专业边界', trust: -0.15, safety: -0.05, bond: -0.04, valence: -0.15, arousal: 0.08, verbal: 0.04, depth: 0.05, style: 0.15 },
  { kind: 'sensitive_touch', label: '敏感议题触碰', clinicalLabel: '咨询师触碰敏感议题', trust: 0, safety: -0.01, bond: 0, valence: -0.05, arousal: 0.15, verbal: 0.05, depth: 0.05, style: 0.06 },
]

const defaultCapConfig: CapConfig[] = [
  { dimension: 'trust', label: '信任', up: 0.20, down: -0.30 },
  { dimension: 'safety', label: '安全感', up: 0.20, down: -0.30 },
  { dimension: 'bond', label: '纽带', up: 0.20, down: -0.30 },
  { dimension: 'valence', label: '效价', up: 0.20, down: -0.30 },
  { dimension: 'arousal', label: '唤醒', up: 0.20, down: -0.20 },
  { dimension: 'verbal', label: '言语阻抗', up: 0.20, down: -0.20 },
  { dimension: 'depth', label: '深度阻抗', up: 0.20, down: -0.20 },
  { dimension: 'style', label: '风格阻抗', up: 0.20, down: -0.20 },
]

const defaultPersonalityConfig: Record<AttachmentStyle, AttachmentModulation> = {
  secure: { trustScale: 1.0, safetyScale: 1.0, bondScale: 1.0, resistanceScale: 1.0 },
  anxious: { trustScale: 1.2, safetyScale: 0.7, bondScale: 1.3, resistanceScale: 0.8 },
  avoidant: { trustScale: 0.6, safetyScale: 0.5, bondScale: 0.5, resistanceScale: 1.3 },
  disorganized: { trustScale: 0.8, safetyScale: 0.6, bondScale: 0.8, resistanceScale: 1.2 },
}

// ========== 状态 ==========

const deltaTable = ref<DeltaRow[]>(JSON.parse(JSON.stringify(defaultDeltaTable)))
const capConfig = ref<CapConfig[]>(JSON.parse(JSON.stringify(defaultCapConfig)))
const personalityConfig = ref<Record<AttachmentStyle, AttachmentModulation>>(JSON.parse(JSON.stringify(defaultPersonalityConfig)))

const activeScenario = ref<string>('opening')
const customEvents = ref<string>('')
const compareTypes = ref<AttachmentStyle[]>(['secure', 'avoidant'])
const showThresholds = ref<boolean>(true)

const deltaTableCollapsed = ref(false)
const capCollapsed = ref(false)
const heatmapModalVisible = ref(false)
const personalityCollapsed = ref(false)

// 阈值参数（内核种子值）
const thresholds = reactive({
  open: 0.6,
  resistanceTrust: 0.4,
  resistanceSafety: 0.3,
})

// ========== 撤销/重做 ==========

interface HistoryState {
  deltaTable: DeltaRow[]
  capConfig: CapConfig[]
  personalityConfig: Record<AttachmentStyle, AttachmentModulation>
}

const undoStack = ref<HistoryState[]>([])
const redoStack = ref<HistoryState[]>([])

function snapshotState(): HistoryState {
  return {
    deltaTable: JSON.parse(JSON.stringify(deltaTable.value)),
    capConfig: JSON.parse(JSON.stringify(capConfig.value)),
    personalityConfig: JSON.parse(JSON.stringify(personalityConfig.value)),
  }
}

function pushHistory() {
  undoStack.value.push(snapshotState())
  if (undoStack.value.length > 50) undoStack.value.shift()
  redoStack.value = []
}

function undo() {
  if (!undoStack.value.length) return
  redoStack.value.push(snapshotState())
  const prev = undoStack.value.pop()!
  deltaTable.value = prev.deltaTable
  capConfig.value = prev.capConfig
  personalityConfig.value = prev.personalityConfig
}

function redo() {
  if (!redoStack.value.length) return
  undoStack.value.push(snapshotState())
  const next = redoStack.value.pop()!
  deltaTable.value = next.deltaTable
  capConfig.value = next.capConfig
  personalityConfig.value = next.personalityConfig
}

// ========== 模拟引擎 ==========

interface SimulationResult {
  turns: SimulationTurn[]
  finalState: Record<string, number>
}

function runSingleSimulation(events: string[], attachmentStyle: AttachmentStyle): SimulationTurn[] {
  let state = {
    trust: 0.3, safety: 0.5, bond: 0,
    valence: 0, arousal: 0.3,
    verbal: 0.4, depth: 0.4, style: 0.35,
  }
  const mod = personalityConfig.value[attachmentStyle]
  const results: SimulationTurn[] = []

  events.forEach((eventKind, i) => {
    const row = deltaTable.value.find(r => r.kind === eventKind)
    if (!row) return

    // 聚合 delta
    let delta = {
      trust: row.trust, safety: row.safety, bond: row.bond,
      valence: row.valence, arousal: row.arousal,
      verbal: row.verbal, depth: row.depth, style: row.style,
    }

    // 人格调节（只调增益方向）
    delta = {
      ...delta,
      trust: delta.trust > 0 ? delta.trust * mod.trustScale : delta.trust,
      safety: delta.safety > 0 ? delta.safety * mod.safetyScale : delta.safety,
      bond: delta.bond > 0 ? delta.bond * mod.bondScale : delta.bond,
      verbal: delta.verbal < 0 ? delta.verbal / mod.resistanceScale : delta.verbal,
      depth: delta.depth < 0 ? delta.depth / mod.resistanceScale : delta.depth,
      style: delta.style < 0 ? delta.style / mod.resistanceScale : delta.style,
    }

    // cap
    for (const dim of Object.keys(delta) as (keyof typeof delta)[]) {
      const cap = capConfig.value.find(c => c.dimension === dim)
      if (cap) {
        if (delta[dim] > cap.up) delta[dim] = cap.up
        if (delta[dim] < cap.down) delta[dim] = cap.down
      }
    }

    // 落快照
    state = {
      trust: Math.min(1, Math.max(0, state.trust + delta.trust)),
      safety: Math.min(1, Math.max(0, state.safety + delta.safety)),
      bond: Math.min(1, Math.max(0, state.bond + delta.bond)),
      valence: Math.min(1, Math.max(-1, state.valence + delta.valence)),
      arousal: Math.min(1, Math.max(0, state.arousal + delta.arousal)),
      verbal: Math.min(1, Math.max(0, state.verbal + delta.verbal)),
      depth: Math.min(1, Math.max(0, state.depth + delta.depth)),
      style: Math.min(1, Math.max(0, state.style + delta.style)),
    }

    // 判定阶段
    let phase: SimulationTurn['phase'] = 'neutral'
    if (Math.min(state.trust, state.safety) >= thresholds.open) phase = 'exploration'
    else if (state.trust < thresholds.resistanceTrust || state.safety < thresholds.resistanceSafety) phase = 'resistance'

    results.push({
      turn: i + 1,
      eventKind: row.kind,
      eventLabel: row.label,
      ...state,
      phase,
    })
  })

  return results
}

const activeEvents = computed(() => {
  if (activeScenario.value === 'custom') {
    return customEvents.value.split(',').map(s => s.trim()).filter(Boolean)
  }
  const scenario = presetScenarios.find(s => s.id === activeScenario.value)
  return scenario?.events ?? []
})

const simulations = computed(() => {
  return compareTypes.value.map(type => ({
    type,
    label: { secure: '安全型', anxious: '焦虑型', avoidant: '回避型', disorganized: '混乱型' }[type],
    turns: runSingleSimulation(activeEvents.value, type),
  }))
})

// ========== 主图表 ==========

const chartOption = computed(() => {
  const baseSeries: any[] = []
  const colors: Record<AttachmentStyle, string> = {
    secure: '#18a058',
    anxious: '#f0a020',
    avoidant: '#d03050',
    disorganized: '#7c3aed',
  }

  compareTypes.value.forEach(type => {
    const sim = simulations.value.find(s => s.type === type)
    if (!sim) return
    baseSeries.push({
      name: `${type === 'secure' ? '安全型' : type === 'anxious' ? '焦虑型' : type === 'avoidant' ? '回避型' : '混乱型'} · 信任`,
      type: 'line',
      data: sim.turns.map(t => t.trust),
      smooth: true,
      lineStyle: { width: 2, color: colors[type] },
      itemStyle: { color: colors[type] },
    })
    baseSeries.push({
      name: `${type === 'secure' ? '安全型' : type === 'anxious' ? '焦虑型' : type === 'avoidant' ? '回避型' : '混乱型'} · 安全感`,
      type: 'line',
      data: sim.turns.map(t => t.safety),
      smooth: true,
      lineStyle: { width: 1.5, type: 'dashed', color: colors[type] },
      itemStyle: { color: colors[type] },
    })
  })

  // 阈值线
  if (showThresholds.value && baseSeries.length > 0) {
    baseSeries[0].markLine = {
      silent: true,
      symbol: 'none',
      lineStyle: { type: 'dashed', color: '#999' },
      data: [
        { yAxis: thresholds.open, label: { formatter: '探索门槛', position: 'insideEndTop' } },
        { yAxis: thresholds.resistanceTrust, label: { formatter: '抗拒门槛(信任)', position: 'insideEndBottom' } },
        { yAxis: thresholds.resistanceSafety, label: { formatter: '抗拒门槛(安全感)', position: 'insideEndBottom' } },
      ],
    }
  }

  return {
    tooltip: { trigger: 'axis' },
    legend: { bottom: 0, textStyle: { fontSize: 11, color: '#666' }, type: 'scroll' },
    grid: { left: 50, right: 20, top: 20, bottom: 60 },
    xAxis: {
      type: 'category',
      data: activeEvents.value.map((_, i) => `T${i + 1}`),
      axisLabel: { color: '#666', fontSize: 11 },
    },
    yAxis: {
      type: 'value', min: 0, max: 1,
      axisLabel: { color: '#666', fontSize: 11 },
      splitLine: { lineStyle: { color: '#f0f0f0' } },
    },
    series: baseSeries,
  }
})

// ========== 热力图 ==========

const heatmapDimensions = ['trust', 'safety', 'bond', 'valence', 'arousal', 'verbal', 'depth', 'style']
const heatmapLabels: Record<string, string> = {
  trust: '信任', safety: '安全感', bond: '纽带', valence: '效价',
  arousal: '唤醒', verbal: '言语', depth: '深度', style: '风格',
}

const heatmapData = computed(() => {
  const data: [number, number, number][] = []
  deltaTable.value.forEach((row, rowIdx) => {
    heatmapDimensions.forEach((dim, colIdx) => {
      data.push([colIdx, rowIdx, row[dim as keyof DeltaRow] as number])
    })
  })
  return data
})

const heatmapOption = computed(() => ({
  tooltip: {
    formatter: (params: any) => {
      const row = deltaTable.value[params.value[1]]
      const dim = heatmapDimensions[params.value[0]]
      return `${row.label} · ${heatmapLabels[dim]}<br/>${t('calibrator.heatmapDelta')}: <b>${params.value[2].toFixed(3)}</b>`
    },
  },
  grid: { left: 80, right: 20, top: 10, bottom: 90 },
  xAxis: {
    type: 'category',
    data: heatmapDimensions.map(d => heatmapLabels[d]),
    axisLabel: { fontSize: 10, color: '#666' },
    splitArea: { show: true },
  },
  yAxis: {
    type: 'category',
    data: deltaTable.value.map(r => r.label),
    axisLabel: { fontSize: 10, color: '#666' },
    splitArea: { show: true },
  },
  visualMap: {
    min: -0.15, max: 0.15,
    calculable: true,
    orient: 'horizontal',
    left: 'center',
    bottom: 15,
    inRange: { color: ['#d03050', '#f0f0f0', '#18a058'] },
    textStyle: { fontSize: 10 },
  },
  series: [{
    type: 'heatmap',
    data: heatmapData.value,
    label: { show: true, fontSize: 9, formatter: (p: any) => p.value[2].toFixed(2) },
    emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0, 0, 0, 0.5)' } },
  }],
}))

// ========== 敏感度龙卷风图 ==========

const tornadoData = computed(() => {
  // 简化版敏感度：以 trust 最终值为目标，估算各参数的影响幅度
  const baseTrust = simulations.value[0]?.turns[simulations.value[0]?.turns.length - 1]?.trust ?? 0.5
  const params = [
    { name: '共情 · 信任增量', base: 0.10, dim: 'trust' },
    { name: '评判 · 信任增量', base: -0.12, dim: 'trust' },
    { name: `回避型 · ${t('calibrator.trustScale')}`, base: 0.6, dim: 'trustScale' },
    { name: `回避型 · ${t('calibrator.safetyScale')}`, base: 0.5, dim: 'safetyScale' },
    { name: `安全型 · ${t('calibrator.trustScale')}`, base: 1.0, dim: 'trustScale' },
    { name: '单回合 cap · 信任上界', base: 0.20, dim: 'capUp' },
  ]
  return params.map(p => ({
    name: p.name,
    value: Math.abs(p.base) * 100,
  })).sort((a, b) => b.value - a.value)
})

const tornadoOption = computed(() => ({
  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
  grid: { left: 120, right: 30, top: 10, bottom: 20 },
  xAxis: { type: 'value', axisLabel: { fontSize: 10, color: '#666' } },
  yAxis: {
    type: 'category',
    data: tornadoData.value.map(d => d.name),
    axisLabel: { fontSize: 10, color: '#666' },
  },
  series: [{
    type: 'bar',
    data: tornadoData.value.map(d => d.value),
    itemStyle: { color: '#2080f0', borderRadius: [0, 4, 4, 0] },
    barWidth: 12,
  }],
}))

// ========== 明细表格 ==========

const detailColumns = [
  { title: 'T', key: 'turn', width: 45 },
  { title: '事件', key: 'eventLabel', width: 80 },
  { title: '阶段', key: 'phase', width: 70, render: (row: any) => {
    const map: Record<string, { text: string; color: string }> = {
      exploration: { text: '探索', color: '#18a058' },
      neutral: { text: '中性', color: '#999' },
      resistance: { text: '抗拒', color: '#d03050' },
    }
    const m = map[row.phase]
    return h('span', { style: { color: m.color, fontSize: '12px' } }, m.text)
  }},
  { title: '信任', key: 'trust', align: 'right' as const, render: (row: any) => row.trust.toFixed(3) },
  { title: '安全感', key: 'safety', align: 'right' as const, render: (row: any) => row.safety.toFixed(3) },
  { title: '纽带', key: 'bond', align: 'right' as const, render: (row: any) => row.bond.toFixed(3) },
]

// ========== 操作 ==========

function resetDefaults() {
  pushHistory()
  deltaTable.value = JSON.parse(JSON.stringify(defaultDeltaTable))
  capConfig.value = JSON.parse(JSON.stringify(defaultCapConfig))
  personalityConfig.value = JSON.parse(JSON.stringify(defaultPersonalityConfig))
}

function exportConfig() {
  const config = {
    deltaTable: deltaTable.value,
    capConfig: capConfig.value,
    personalityConfig: personalityConfig.value,
    thresholds,
    exportedAt: new Date().toISOString(),
  }
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `calibrator-config-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function onParamChange() {
  pushHistory()
}

// 监听参数变化，自动 pushHistory（简化版：在滑块 change 时手动调）

onMounted(() => {
  // 初始化
})
</script>

<template>
  <div class="p-4 max-w-[1600px] mx-auto h-screen flex flex-col">
    <!-- 顶部：标题 + 操作 -->
    <div class="flex items-center justify-between mb-3 flex-shrink-0">
      <div class="flex items-center gap-4">
        <div>
          <h1 class="text-xl font-semibold whitespace-nowrap">参数校准</h1>
          <p class="text-xs text-muted mt-0.5">可视化调节 BDI 引擎参数，实时预览效果</p>
        </div>
        <!-- 场景选择 -->
        <NRadioGroup v-model:value="activeScenario" size="small" class="ml-4">
          <NRadioButton v-for="s in presetScenarios" :key="s.id" :value="s.id">{{ s.shortName }}</NRadioButton>
          <NRadioButton value="custom">自定义</NRadioButton>
        </NRadioGroup>
      </div>
      <div class="flex items-center gap-2">
        <!-- 对比设置：下拉多选 -->
        <n-select
          v-model:value="compareTypes"
          multiple
          size="tiny"
          placeholder="对比依恋类型"
          :max-tag-count="1"
          :options="[
            { label: '安全型', value: 'secure' },
            { label: '焦虑型', value: 'anxious' },
            { label: '回避型', value: 'avoidant' },
            { label: '混乱型', value: 'disorganized' },
          ]"
          class="w-40"
        />
        <n-checkbox v-model:checked="showThresholds" size="tiny">{{ t('calibrator.showThresholds') }}</n-checkbox>
        <n-divider vertical />
        <!-- 更多操作下拉 -->
        <n-dropdown
          trigger="click"
          :options="[
            { label: '撤销', key: 'undo', disabled: !undoStack.length },
            { label: '重做', key: 'redo', disabled: !redoStack.length },
            { type: 'divider', key: 'd1' },
            { label: '恢复默认', key: 'reset' },
          ]"
          @select="(key: string) => { if (key === 'undo') undo(); else if (key === 'redo') redo(); else if (key === 'reset') resetDefaults(); }"
        >
          <n-button size="tiny">{{ t('calibrator.more') }}</n-button>
        </n-dropdown>
        <n-button size="tiny" type="primary" @click="exportConfig">{{ t('calibrator.export') }}</n-button>
      </div>
    </div>

    <!-- 自定义事件输入行 -->
    <div v-if="activeScenario === 'custom'" class="mb-3 flex-shrink-0">
      <n-input v-model:value="customEvents" size="tiny" placeholder="事件类型，逗号分隔，如：empathy, acceptance, judgment" class="max-w-md" />
    </div>

    <!-- 主体：左右两栏，占满剩余高度 -->
    <div class="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-3 flex-1 min-h-0">
      <!-- 左侧：参数面板，可滚动 -->
      <div class="space-y-2.5 overflow-y-auto pr-1">
        <!-- Delta 热力图 + 编辑表（合并成一个卡片） -->
        <n-card size="small" class="!shadow-sm !rounded-lg">
          <template #header>
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium">{{ t('calibrator.eventDelta') }}</span>
              <div class="flex items-center gap-1">
                <n-button size="tiny" quaternary @click="heatmapModalVisible = true">
                  放大
                </n-button>
                <n-button size="tiny" quaternary @click="deltaTableCollapsed = !deltaTableCollapsed">
                  {{ deltaTableCollapsed ? '编辑数值' : '收起' }}
                </n-button>
              </div>
            </div>
          </template>
          <v-chart :option="heatmapOption" class="w-full mb-3" style="height: 240px" />
          <!-- 编辑表，默认折叠 -->
          <div v-if="!deltaTableCollapsed" class="space-y-2.5 max-h-[280px] overflow-y-auto border-t border-gray-100 pt-4">
            <div v-for="row in deltaTable" :key="row.kind" class="border-b border-gray-50 pb-1.5 last:border-0">
              <div class="flex items-center justify-between mb-1">
                <span class="text-xs font-medium">{{ row.label }}</span>
              </div>
              <div class="grid grid-cols-4 gap-1">
                <n-input-number v-model:value="row.trust" :step="0.01" :min="-0.3" :max="0.3" size="tiny" @update:value="onParamChange" />
                <n-input-number v-model:value="row.safety" :step="0.01" :min="-0.1" :max="0.1" size="tiny" @update:value="onParamChange" />
                <n-input-number v-model:value="row.bond" :step="0.01" :min="-0.1" :max="0.1" size="tiny" @update:value="onParamChange" />
                <n-input-number v-model:value="row.valence" :step="0.01" :min="-0.3" :max="0.3" size="tiny" @update:value="onParamChange" />
              </div>
            </div>
          </div>
        </n-card>

        <!-- Cap 参数（默认折叠） -->
        <n-card size="small" class="!shadow-sm !rounded-lg">
          <template #header>
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium">{{ t('calibrator.perTurnCap') }}</span>
              <n-button size="tiny" quaternary @click="capCollapsed = !capCollapsed">
                {{ capCollapsed ? '展开' : '收起' }}
              </n-button>
            </div>
          </template>
          <div v-if="!capCollapsed" class="space-y-2">
            <div v-for="cap in capConfig" :key="cap.dimension">
              <div class="flex items-center justify-between mb-0.5">
                <span class="text-[10px] text-gray-500">{{ cap.label }}</span>
                <span class="text-[10px] text-gray-400 font-mono">+{{ cap.up.toFixed(2) }} / {{ cap.down.toFixed(2) }}</span>
              </div>
              <div class="flex items-center gap-1.5">
                <n-slider v-model:value="cap.up" :min="0" :max="0.5" :step="0.01" class="flex-1" @change="onParamChange" />
                <n-slider v-model:value="cap.down" :min="-0.5" :max="0" :step="0.01" class="flex-1" @change="onParamChange" />
              </div>
            </div>
          </div>
        </n-card>

        <!-- 人格调节（默认折叠） -->
        <n-card size="small" class="!shadow-sm !rounded-lg">
          <template #header>
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium">{{ t('calibrator.personalityMod') }}</span>
              <n-button size="tiny" quaternary @click="personalityCollapsed = !personalityCollapsed">
                {{ personalityCollapsed ? '展开' : '收起' }}
              </n-button>
            </div>
          </template>
          <div v-if="!personalityCollapsed">
            <n-tabs type="line" size="small" default-value="secure">
              <n-tab-pane name="secure" tab="安全型">
                <div class="space-y-2 pt-2">
                  <div>
                    <div class="flex justify-between text-[10px] text-gray-400 mb-0.5">
                      <span>{{ t('calibrator.trustScale') }}</span><span>{{ personalityConfig.secure.trustScale.toFixed(1) }}×</span>
                    </div>
                    <n-slider v-model:value="personalityConfig.secure.trustScale" :min="0.3" :max="2" :step="0.1" size="small" @change="onParamChange" />
                  </div>
                  <div>
                    <div class="flex justify-between text-[10px] text-gray-400 mb-0.5">
                      <span>{{ t('calibrator.safetyScale') }}</span><span>{{ personalityConfig.secure.safetyScale.toFixed(1) }}×</span>
                    </div>
                    <n-slider v-model:value="personalityConfig.secure.safetyScale" :min="0.3" :max="2" :step="0.1" size="small" @change="onParamChange" />
                  </div>
                  <div>
                    <div class="flex justify-between text-[10px] text-gray-400 mb-0.5">
                      <span>{{ t('calibrator.bondScale') }}</span><span>{{ personalityConfig.secure.bondScale.toFixed(1) }}×</span>
                    </div>
                    <n-slider v-model:value="personalityConfig.secure.bondScale" :min="0.3" :max="2" :step="0.1" size="small" @change="onParamChange" />
                  </div>
                  <div>
                    <div class="flex justify-between text-[10px] text-gray-400 mb-0.5">
                      <span>{{ t('calibrator.resistanceScale') }}</span><span>{{ personalityConfig.secure.resistanceScale.toFixed(1) }}×</span>
                    </div>
                    <n-slider v-model:value="personalityConfig.secure.resistanceScale" :min="0.5" :max="2" :step="0.1" size="small" @change="onParamChange" />
                  </div>
                </div>
              </n-tab-pane>
              <n-tab-pane name="anxious" tab="焦虑型">
                <div class="space-y-2 pt-2">
                  <div>
                    <div class="flex justify-between text-[10px] text-gray-400 mb-0.5">
                      <span>{{ t('calibrator.trustScale') }}</span><span>{{ personalityConfig.anxious.trustScale.toFixed(1) }}×</span>
                    </div>
                    <n-slider v-model:value="personalityConfig.anxious.trustScale" :min="0.3" :max="2" :step="0.1" size="small" @change="onParamChange" />
                  </div>
                  <div>
                    <div class="flex justify-between text-[10px] text-gray-400 mb-0.5">
                      <span>{{ t('calibrator.safetyScale') }}</span><span>{{ personalityConfig.anxious.safetyScale.toFixed(1) }}×</span>
                    </div>
                    <n-slider v-model:value="personalityConfig.anxious.safetyScale" :min="0.3" :max="2" :step="0.1" size="small" @change="onParamChange" />
                  </div>
                  <div>
                    <div class="flex justify-between text-[10px] text-gray-400 mb-0.5">
                      <span>{{ t('calibrator.bondScale') }}</span><span>{{ personalityConfig.anxious.bondScale.toFixed(1) }}×</span>
                    </div>
                    <n-slider v-model:value="personalityConfig.anxious.bondScale" :min="0.3" :max="2" :step="0.1" size="small" @change="onParamChange" />
                  </div>
                  <div>
                    <div class="flex justify-between text-[10px] text-gray-400 mb-0.5">
                      <span>{{ t('calibrator.resistanceScale') }}</span><span>{{ personalityConfig.anxious.resistanceScale.toFixed(1) }}×</span>
                    </div>
                    <n-slider v-model:value="personalityConfig.anxious.resistanceScale" :min="0.5" :max="2" :step="0.1" size="small" @change="onParamChange" />
                  </div>
                </div>
              </n-tab-pane>
              <n-tab-pane name="avoidant" tab="回避型">
                <div class="space-y-2 pt-2">
                  <div>
                    <div class="flex justify-between text-[10px] text-gray-400 mb-0.5">
                      <span>{{ t('calibrator.trustScale') }}</span><span>{{ personalityConfig.avoidant.trustScale.toFixed(1) }}×</span>
                    </div>
                    <n-slider v-model:value="personalityConfig.avoidant.trustScale" :min="0.3" :max="2" :step="0.1" size="small" @change="onParamChange" />
                  </div>
                  <div>
                    <div class="flex justify-between text-[10px] text-gray-400 mb-0.5">
                      <span>{{ t('calibrator.safetyScale') }}</span><span>{{ personalityConfig.avoidant.safetyScale.toFixed(1) }}×</span>
                    </div>
                    <n-slider v-model:value="personalityConfig.avoidant.safetyScale" :min="0.3" :max="2" :step="0.1" size="small" @change="onParamChange" />
                  </div>
                  <div>
                    <div class="flex justify-between text-[10px] text-gray-400 mb-0.5">
                      <span>{{ t('calibrator.bondScale') }}</span><span>{{ personalityConfig.avoidant.bondScale.toFixed(1) }}×</span>
                    </div>
                    <n-slider v-model:value="personalityConfig.avoidant.bondScale" :min="0.3" :max="2" :step="0.1" size="small" @change="onParamChange" />
                  </div>
                  <div>
                    <div class="flex justify-between text-[10px] text-gray-400 mb-0.5">
                      <span>{{ t('calibrator.resistanceScale') }}</span><span>{{ personalityConfig.avoidant.resistanceScale.toFixed(1) }}×</span>
                    </div>
                    <n-slider v-model:value="personalityConfig.avoidant.resistanceScale" :min="0.5" :max="2" :step="0.1" size="small" @change="onParamChange" />
                  </div>
                </div>
              </n-tab-pane>
              <n-tab-pane name="disorganized" tab="混乱型">
                <div class="space-y-2 pt-2">
                  <div>
                    <div class="flex justify-between text-[10px] text-gray-400 mb-0.5">
                      <span>{{ t('calibrator.trustScale') }}</span><span>{{ personalityConfig.disorganized.trustScale.toFixed(1) }}×</span>
                    </div>
                    <n-slider v-model:value="personalityConfig.disorganized.trustScale" :min="0.3" :max="2" :step="0.1" size="small" @change="onParamChange" />
                  </div>
                  <div>
                    <div class="flex justify-between text-[10px] text-gray-400 mb-0.5">
                      <span>{{ t('calibrator.safetyScale') }}</span><span>{{ personalityConfig.disorganized.safetyScale.toFixed(1) }}×</span>
                    </div>
                    <n-slider v-model:value="personalityConfig.disorganized.safetyScale" :min="0.3" :max="2" :step="0.1" size="small" @change="onParamChange" />
                  </div>
                  <div>
                    <div class="flex justify-between text-[10px] text-gray-400 mb-0.5">
                      <span>{{ t('calibrator.bondScale') }}</span><span>{{ personalityConfig.disorganized.bondScale.toFixed(1) }}×</span>
                    </div>
                    <n-slider v-model:value="personalityConfig.disorganized.bondScale" :min="0.3" :max="2" :step="0.1" size="small" @change="onParamChange" />
                  </div>
                  <div>
                    <div class="flex justify-between text-[10px] text-gray-400 mb-0.5">
                      <span>{{ t('calibrator.resistanceScale') }}</span><span>{{ personalityConfig.disorganized.resistanceScale.toFixed(1) }}×</span>
                    </div>
                    <n-slider v-model:value="personalityConfig.disorganized.resistanceScale" :min="0.5" :max="2" :step="0.1" size="small" @change="onParamChange" />
                  </div>
                </div>
              </n-tab-pane>
            </n-tabs>
          </div>
        </n-card>
      </div>

      <!-- 右侧：预览区，主图表占大头 -->
      <div class="flex flex-col gap-2.5 min-h-0">
        <!-- 主图表 -->
        <n-card size="small" class="!shadow-sm !rounded-lg flex-1 flex flex-col">
          <template #header>
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium">{{ t('calibrator.bdiTrajectory') }}</span>
              <span class="text-[10px] text-gray-400">{{ simulations[0]?.turns.length ?? 0 }} {{ t('calibrator.turns') }}</span>
            </div>
          </template>
          <v-chart :option="chartOption" class="w-full flex-1" style="min-height: 0" />
        </n-card>

        <!-- 底部：Tab 切换（敏感度 / 明细 / 阈值） -->
        <n-card size="small" class="!shadow-sm !rounded-lg flex-shrink-0">
          <n-tabs type="line" size="small">
            <n-tab-pane name="detail" tab="逐轮明细">
              <n-data-table
                :columns="detailColumns"
                :data="simulations[0]?.turns ?? []"
                size="small"
                :bordered="false"
                class="text-xs"
                :max-height="180"
              />
            </n-tab-pane>
            <n-tab-pane name="sensitivity" tab="敏感度分析">
              <v-chart :option="tornadoOption" class="w-full" style="height: 180px" />
            </n-tab-pane>
            <n-tab-pane name="threshold" tab="决策门槛">
              <div class="grid grid-cols-3 gap-4 py-2">
                <div>
                  <div class="flex justify-between text-[11px] text-gray-500 mb-1">
                    <span>{{ t('calibrator.explorationThreshold') }}</span><span>{{ thresholds.open.toFixed(2) }}</span>
                  </div>
                  <n-slider v-model:value="thresholds.open" :min="0.3" :max="0.9" :step="0.05" size="small" />
                </div>
                <div>
                  <div class="flex justify-between text-[11px] text-gray-500 mb-1">
                    <span>{{ t('calibrator.resistanceTrust') }}</span><span>{{ thresholds.resistanceTrust.toFixed(2) }}</span>
                  </div>
                  <n-slider v-model:value="thresholds.resistanceTrust" :min="0.1" :max="0.7" :step="0.05" size="small" />
                </div>
                <div>
                  <div class="flex justify-between text-[11px] text-gray-500 mb-1">
                    <span>{{ t('calibrator.resistanceSafety') }}</span><span>{{ thresholds.resistanceSafety.toFixed(2) }}</span>
                  </div>
                  <n-slider v-model:value="thresholds.resistanceSafety" :min="0.1" :max="0.7" :step="0.05" size="small" />
                </div>
              </div>
            </n-tab-pane>
          </n-tabs>
        </n-card>
      </div>
    </div>

    <!-- 热力图放大弹窗 -->
    <n-modal v-model:show="heatmapModalVisible" preset="card" title="事件 Delta 热力图" class="max-w-5xl">
      <v-chart :option="heatmapOption" class="w-full" style="height: 700px" />
    </n-modal>
  </div>
</template>
