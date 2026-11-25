<script setup lang="ts">
import { computed, ref } from 'vue'
import { NProgress, NTag } from 'naive-ui'
import { use } from 'echarts/core'
import { LineChart, RadarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent, RadarComponent, MarkLineComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import VChart from 'vue-echarts'
import type { BdiSnapshotPoint, TurnTrace } from '@/api/types'
import { formatMetric, formatSigned } from '@/utils/trace-format'

use([LineChart, RadarChart, GridComponent, TooltipComponent, LegendComponent, RadarComponent, MarkLineComponent, CanvasRenderer])

const props = defineProps<{
  trace: TurnTrace | null
  bdiHistory: BdiSnapshotPoint[]
  turnIndex: number
}>()

const emit = defineEmits<{
  (e: 'select-turn', turnIndex: number): void
}>()

type BdiView = 'current' | 'trend'

const bdiView = ref<BdiView>('current')
const showDetails = ref(false)

const CORE_BELIEF_LABELS: Record<string, string> = {
  conditional_self_worth: '条件化自我价值',
  abandonment: '被抛弃',
  unrelenting_standards: '严苛标准',
  defectiveness: '缺陷感',
  emotional_inhibition: '情绪压抑',
  mistrust: '不信任',
  subjugation: '顺从',
  failure: '失败感',
  isolation: '孤立',
}

const DIMENSIONS: Array<{ key: keyof BdiSnapshotPoint; label: string; color: string }> = [
  { key: 'trust', label: '信任', color: '#7ec9a0' },
  { key: 'safety', label: '安全感', color: '#5ba8e8' },
  { key: 'bond', label: '联结感', color: '#b87ae8' },
  { key: 'arousal', label: '唤醒', color: '#e8c87a' },
  { key: 'resistanceVerbal', label: '阻抗·话量', color: '#e87a7a' },
]

const selectedPoint = computed<BdiSnapshotPoint | null>(() => {
  const exact = props.bdiHistory.find((point) => point.turnIndex === props.turnIndex)
  if (exact) return exact
  if (props.trace?.bdiSnapshot) {
    const s = props.trace.bdiSnapshot
    return {
      turnIndex: props.trace.turnIndex,
      trust: s.trust,
      safety: s.safety,
      bond: s.bond,
      valence: s.valence,
      arousal: s.arousal,
      resistance: s.resistance,
      resistanceVerbal: s.resistanceVerbal,
      resistanceDepth: s.resistanceDepth,
      resistanceStyle: s.resistanceStyle,
      anxiousSecure: s.anxiousSecure,
      transference: s.transference,
      coreBeliefActivation: s.coreBeliefActivation,
      coreBeliefActivationPeak: s.coreBeliefActivationPeak,
    }
  }
  return props.bdiHistory[props.bdiHistory.length - 1] ?? null
})

function finite(value: number | undefined | null): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

const availableDims = computed(() => {
  const point = selectedPoint.value
  if (!point) return []
  return DIMENSIONS.filter((dim) => finite(point[dim.key] as number | undefined))
})

const snapshotChips = computed(() => {
  const point = selectedPoint.value
  if (!point) return []
  return availableDims.value.map((dim) => ({
    ...dim,
    value: point[dim.key] as number,
  }))
})

const radarOption = computed(() => {
  const point = selectedPoint.value
  const dims = availableDims.value
  if (!point || dims.length < 3) return null
  return {
    tooltip: {
      trigger: 'item',
      backgroundColor: '#1e222d',
      borderColor: '#2a2f3d',
      textStyle: { color: '#e5e7eb', fontSize: 12 },
    },
    radar: {
      shape: 'polygon',
      indicator: dims.map((dim) => ({ name: dim.label, max: 1 })),
      splitNumber: 4,
      axisName: { color: '#9ca3af', fontSize: 10 },
      splitLine: { lineStyle: { color: '#2a2f3d' } },
      splitArea: { areaStyle: { color: ['rgba(42,47,61,0.18)', 'rgba(42,47,61,0.32)'] } },
    },
    series: [{
      type: 'radar',
      name: `第 ${props.turnIndex} 轮`,
      symbolSize: 4,
      lineStyle: { width: 2, color: '#7ec9a0' },
      areaStyle: { color: 'rgba(126,201,160,0.16)' },
      data: [{
        name: `第 ${props.turnIndex} 轮`,
        value: dims.map((dim) => point[dim.key] as number),
      }],
    }],
  }
})

const valence = computed(() => selectedPoint.value?.valence ?? null)
const valencePercent = computed(() => {
  if (valence.value === null || !Number.isFinite(valence.value)) return 50
  return Math.max(0, Math.min(100, ((valence.value + 1) / 2) * 100))
})
const valenceClass = computed(() => {
  if (valence.value === null) return 'text-muted'
  return valence.value > 0.05 ? 'text-success' : valence.value < -0.05 ? 'text-error' : 'text-muted'
})

const resistanceRows = computed(() => {
  const point = selectedPoint.value
  if (!point) return []
  const defs = [
    { key: 'resistanceVerbal' as const, label: '话量' },
    { key: 'resistanceDepth' as const, label: '深度' },
    { key: 'resistanceStyle' as const, label: '风格' },
  ]
  return defs
    .filter((def) => finite(point[def.key]))
    .map((def) => ({ ...def, value: point[def.key] as number }))
})

const transferenceRows = computed(() => {
  const t = selectedPoint.value?.transference
  if (!t) return []
  return [
    { key: 'positive', label: '正向', value: t.positive, color: '#7ec9a0' },
    { key: 'negative', label: '负向', value: t.negative, color: '#e87a7a' },
    { key: 'dependency', label: '依赖', value: t.dependency, color: '#e8c87a' },
  ].filter((row) => finite(row.value))
})

const coreBeliefs = computed(() => {
  const point = selectedPoint.value
  if (!point?.coreBeliefActivation) return []
  return Object.entries(point.coreBeliefActivation)
    .filter(([, value]) => finite(value))
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => ({ key, label: CORE_BELIEF_LABELS[key] ?? key, value }))
})

const deltaRows = computed(() => {
  const d = props.trace?.deltaDetail
  if (!d) return []
  return [
    { key: 'trust', label: '信任', value: d.trust },
    { key: 'safety', label: '安全感', value: d.safety },
    { key: 'bond', label: '联结', value: d.bond },
    { key: 'valence', label: '效价', value: d.valence },
    { key: 'arousal', label: '唤醒', value: d.arousal },
    { key: 'verbal', label: '阻抗话量', value: d.verbal },
    { key: 'depth', label: '阻抗深度', value: d.depth },
    { key: 'style', label: '阻抗风格', value: d.style },
  ]
})

const maxDelta = computed(() => {
  const rows = deltaRows.value
  if (rows.length === 0) return null
  return rows.reduce((current, row) => (Math.abs(row.value) > Math.abs(current.value) ? row : current))
})

/** 折叠状态下也能看到细节摘要，避免关键变化被藏起来。 */
const detailSummary = computed(() => {
  const chips: Array<{ label: string; value: string }> = []
  if (resistanceRows.value.length > 0) {
    chips.push({
      label: '阻抗',
      value: resistanceRows.value.map((row) => `${row.label} ${formatMetric(row.value)}`).join(' / '),
    })
  }
  if (transferenceRows.value.length > 0) {
    chips.push({
      label: '移情',
      value: transferenceRows.value.map((row) => `${row.label} ${formatMetric(row.value)}`).join(' / '),
    })
  }
  if (coreBeliefs.value.length > 0) {
    const strongest = coreBeliefs.value[0]
    if (strongest) {
      chips.push({
        label: '信念',
        value: `峰值 ${formatMetric(selectedPoint.value?.coreBeliefActivationPeak)} · ${strongest.label} ${formatMetric(strongest.value)}`,
      })
    }
  }
  if (maxDelta.value) {
    chips.push({ label: 'Δ 最大', value: `${maxDelta.value.label} ${formatSigned(maxDelta.value.value)}` })
  }
  return chips
})

const trendSeries = computed(() => {
  const points = props.bdiHistory
  if (points.length === 0) return []
  return DIMENSIONS
    .map((dim) => ({
      ...dim,
      data: points.map((point) => {
        const value = point[dim.key] as number | undefined
        return finite(value) ? value : null
      }),
    }))
    .filter((series) => series.data.some((value) => value !== null))
})

const trendOption = computed(() => {
  const points = props.bdiHistory
  if (points.length === 0) return null
  const dimSeries = trendSeries.value.map((series, index) => ({
    name: series.label,
    type: 'line',
    yAxisIndex: 0,
    smooth: true,
    connectNulls: false,
    data: series.data,
    symbol: 'circle',
    symbolSize: 4,
    lineStyle: { width: 1.5, color: series.color },
    itemStyle: { color: series.color },
    ...(index === 0 ? {
      markLine: {
        symbol: 'none',
        silent: true,
        lineStyle: { color: '#e8c87a', type: 'dashed', width: 1 },
        label: { show: true, formatter: '选中', color: '#e8c87a', fontSize: 9 },
        data: [{ xAxis: String(props.turnIndex) }],
      },
    } : {}),
  }))
  const valenceData = points.map((point) => (finite(point.valence) ? point.valence : null))
  const hasValence = valenceData.some((value) => value !== null)
  const valenceSeries = hasValence ? [{
    name: '效价（右轴）',
    type: 'line',
    yAxisIndex: 1,
    smooth: true,
    connectNulls: false,
    data: valenceData,
    symbol: 'circle',
    symbolSize: 4,
    lineStyle: { width: 1.5, type: 'dashed', color: '#c890a8' },
    itemStyle: { color: '#c890a8' },
  }] : []
  const series = [...dimSeries, ...valenceSeries]
  if (series.length === 0) return null
  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      backgroundColor: '#1e222d',
      borderColor: '#2a2f3d',
      textStyle: { color: '#e5e7eb', fontSize: 12 },
    },
    legend: {
      textStyle: { color: '#9ca3af', fontSize: 10 },
      top: 0,
      itemWidth: 10,
      itemHeight: 6,
      data: series.map((item) => item.name),
    },
    grid: { left: 40, right: 46, top: 34, bottom: 24 },
    xAxis: {
      type: 'category',
      data: points.map((point) => String(point.turnIndex)),
      axisLabel: { color: '#6b7280', fontSize: 9, formatter: (value: string) => `轮${value}` },
      axisLine: { lineStyle: { color: '#2a2f3d' } },
      axisPointer: { label: { show: false } },
    },
    yAxis: [
      {
        type: 'value',
        name: '0~1',
        min: 0,
        max: 1,
        nameTextStyle: { color: '#6b7280', fontSize: 9 },
        axisLabel: { color: '#6b7280', fontSize: 9 },
        splitLine: { lineStyle: { color: '#2a2f3d' } },
      },
      {
        type: 'value',
        name: '效价',
        min: -1,
        max: 1,
        nameTextStyle: { color: '#c890a8', fontSize: 9 },
        axisLabel: { color: '#c890a8', fontSize: 9 },
        splitLine: { show: false },
      },
    ],
    series,
  }
})

function onTrendClick(params: { dataIndex?: number }): void {
  const index = params.dataIndex
  if (index === undefined) return
  const point = props.bdiHistory[index]
  if (point) emit('select-turn', point.turnIndex)
}

function coreBeliefTagType(value: number): 'success' | 'warning' | 'error' | 'info' {
  if (value >= 0.7) return 'error'
  if (value >= 0.4) return 'warning'
  if (value > 0) return 'info'
  return 'success'
}
</script>

<template>
  <div class="min-h-0">
    <div class="sticky top-0 z-10 flex items-center justify-between gap-2 px-3 py-2 bg-bg-surface border-b border-bg-border">
      <div class="min-w-0">
        <div class="text-xs text-muted truncate">BDI 快照 · 第 {{ turnIndex }} 轮</div>
        <div class="text-[9px] text-muted truncate">0~1 维度与效价分轴展示</div>
      </div>
      <div class="flex items-center gap-0.5 bg-bg-elevated rounded p-0.5 flex-shrink-0">
        <button
          class="px-2 py-0.5 text-[11px] rounded transition-colors"
          :class="bdiView === 'current' ? 'bg-accent text-white' : 'text-muted hover:text-text-primary'"
          @click="bdiView = 'current'"
        >
          本轮
        </button>
        <button
          class="px-2 py-0.5 text-[11px] rounded transition-colors"
          :class="bdiView === 'trend' ? 'bg-accent text-white' : 'text-muted hover:text-text-primary'"
          @click="bdiView = 'trend'"
        >
          走势
        </button>
      </div>
    </div>

    <div v-if="!selectedPoint" class="text-xs text-muted text-center py-8">发送一轮后显示</div>

    <template v-else>
      <div v-if="bdiView === 'current'" class="p-3 space-y-2.5">
        <div class="grid gap-2" style="grid-template-columns: repeat(auto-fit, minmax(180px, 1fr))">
          <div class="min-w-0 bg-bg-elevated rounded p-1">
            <VChart v-if="radarOption" :option="radarOption" :autoresize="true" class="w-full" style="height: 160px" />
            <div v-else class="h-[160px] flex items-center justify-center text-[11px] text-muted text-center px-3">
              当前轮缺少足够的多维状态（至少需要 3 个 0~1 维度）
            </div>
          </div>

          <div class="min-w-0 bg-bg-elevated rounded p-2.5 flex flex-col justify-between gap-2">
            <div class="flex flex-wrap items-center gap-1">
              <NTag v-if="selectedPoint.anxiousSecure" size="tiny" type="warning" :bordered="false">
                象限 · {{ selectedPoint.anxiousSecure }}
              </NTag>
              <span class="text-[10px] text-muted">第 {{ turnIndex }} 轮</span>
            </div>
            <div class="grid grid-cols-2 gap-x-3 gap-y-1">
              <div v-for="item in snapshotChips" :key="item.key" class="flex items-center justify-between gap-2 text-[11px] min-w-0">
                <span class="text-muted truncate">{{ item.label }}</span>
                <span class="font-mono flex-shrink-0">{{ formatMetric(item.value) }}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="rounded-lg border border-bg-border bg-bg-elevated px-2.5 py-2">
          <div class="flex items-center justify-between gap-2">
            <span class="text-[11px] text-muted">效价 valence</span>
            <span class="text-xs font-mono font-medium" :class="valenceClass">{{ formatSigned(valence) }}</span>
          </div>
          <div class="relative h-1.5 rounded-full mt-1.5 bg-gradient-to-r from-red-500/40 via-bg-border to-emerald-500/40">
            <div class="absolute top-1/2 -translate-y-1/2 w-0.5 h-3 bg-accent rounded-full" :style="{ left: `${valencePercent}%` }"></div>
            <div class="absolute top-0 bottom-0 left-1/2 w-px bg-bg-border"></div>
          </div>
          <div class="flex justify-between text-[9px] text-muted mt-1">
            <span>-1 负向</span>
            <span>0</span>
            <span>+1 正向</span>
          </div>
        </div>

        <div v-if="detailSummary.length" class="flex flex-wrap items-center gap-1">
          <span v-for="chip in detailSummary" :key="chip.label" class="rounded bg-bg-elevated px-1.5 py-0.5 text-[10px] text-muted">
            <span class="text-text-secondary">{{ chip.label }}</span> {{ chip.value }}
          </span>
        </div>

        <button class="text-[10px] text-accent hover:underline flex items-center gap-1" @click="showDetails = !showDetails">
          {{ showDetails ? '▾' : '▸' }} {{ showDetails ? '收起状态细节' : '展开状态细节（阻抗 / 移情 / 信念 / Δ）' }}
        </button>

        <div v-if="showDetails" class="grid gap-2" style="grid-template-columns: repeat(auto-fit, minmax(180px, 1fr))">
          <div v-if="resistanceRows.length" class="rounded-lg border border-bg-border bg-bg-elevated p-2.5">
            <div class="text-[11px] text-muted mb-2">阻抗三维</div>
            <div class="space-y-1.5">
              <div v-for="row in resistanceRows" :key="row.key" class="flex items-center gap-2 text-[11px]">
                <span class="w-8 text-muted">{{ row.label }}</span>
                <div class="flex-1"><NProgress type="line" :percentage="row.value * 100" :show-text="false" :show-indicator="false" /></div>
                <span class="w-8 text-right font-mono">{{ formatMetric(row.value) }}</span>
              </div>
            </div>
          </div>

          <div v-if="transferenceRows.length" class="rounded-lg border border-bg-border bg-bg-elevated p-2.5">
            <div class="text-[11px] text-muted mb-2">移情三态</div>
            <div class="grid grid-cols-3 gap-2">
              <div v-for="row in transferenceRows" :key="row.key" class="text-center">
                <div class="text-[10px] text-muted">{{ row.label }}</div>
                <div class="text-xs font-mono font-medium">{{ formatMetric(row.value) }}</div>
                <div class="h-1 rounded-full mt-1" :style="{ background: row.color, opacity: 0.25 + row.value * 0.75 }"></div>
              </div>
            </div>
          </div>

          <div v-if="coreBeliefs.length" class="rounded-lg border border-bg-border bg-bg-elevated p-2.5">
            <div class="flex items-center justify-between mb-2">
              <span class="text-[11px] text-muted">核心信念激活</span>
              <span class="text-[10px] text-muted">峰值 {{ formatMetric(selectedPoint.coreBeliefActivationPeak) }}</span>
            </div>
            <div class="flex flex-wrap gap-1">
              <NTag v-for="belief in coreBeliefs" :key="belief.key" size="tiny" :type="coreBeliefTagType(belief.value)" :bordered="false">
                {{ belief.label }} {{ formatMetric(belief.value) }}
              </NTag>
            </div>
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
            <div v-if="trace?.deltaDetail?.events?.length" class="flex flex-wrap gap-1 mt-2">
              <NTag v-for="event in trace.deltaDetail.events" :key="event" size="tiny" type="info" :bordered="false">{{ event }}</NTag>
            </div>
          </div>
        </div>
      </div>

      <div v-else class="p-3 space-y-2">
        <div v-if="trendOption" class="bg-bg-elevated rounded p-1">
          <VChart :option="trendOption" :autoresize="true" class="w-full" style="height: 250px" @click="onTrendClick" />
        </div>
        <div v-else class="text-xs text-muted text-center py-10">还没有可用的历史轮次数据</div>
        <div class="text-[10px] text-muted leading-relaxed">
          左轴 0~1：信任 / 安全感 / 联结 / 唤醒 / 阻抗话量；右轴效价 -1~1。点击趋势点可切换到该轮，黄色虚线为当前选中轮。
        </div>
      </div>
    </template>
  </div>
</template>
