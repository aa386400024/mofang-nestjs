<script setup lang="ts">
// WP-K 批次回归页 · 单批快照下钻面板：八维首末雷达、维度变化、事件 / 策略率、出口分布、
// 覆盖率环图，以及按模式 / 按角色的分组切片。数据来自 batchMetrics 端点快照 v1。
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { use } from 'echarts/core'
import { RadarChart, BarChart, PieChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import VChart from 'vue-echarts'
import type { BatchMetricsV1, MetricsSlice } from '@/api/types'
import {
  TRACKED_DIMENSIONS,
  TRACKED_EVENTS,
  TRACKED_STRATEGIES,
  SESSION_OUTCOMES,
  dimensionLabel,
  eventLabel,
  strategyLabel,
  outcomeLabel,
} from './batchRegressionMeta'
import MetricInfoTooltip from './MetricInfoTooltip.vue'

use([RadarChart, BarChart, PieChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])

const props = defineProps<{
  snapshot: BatchMetricsV1
}>()

const { t } = useI18n()

const BLUE = '#5ba8e8'
const GREEN = '#7ec9a0'
const PURPLE = '#b87ae8'
const YELLOW = '#e8c87a'
const RED = '#e87a7a'
const GRAY = '#6b7280'

/** 取快照指标；缺失返回 null（不补 0，避免掩盖未采集）。 */
function num(id: string): number | null {
  const value = props.snapshot.metrics[id]
  return value === null || value === undefined ? null : value
}

// ─── 八维首末雷达 ───
const radarOption = computed(() => ({
  tooltip: { trigger: 'item', backgroundColor: '#1e222d', borderColor: '#2a2f3d', textStyle: { color: '#e5e7eb', fontSize: 12 } },
  legend: { textStyle: { color: '#9ca3af', fontSize: 11 }, top: 0 },
  radar: {
    indicator: TRACKED_DIMENSIONS.map((dim) => ({ name: dimensionLabel(dim), min: 0, max: 1 })),
    radius: '62%',
    splitNumber: 4,
    axisName: { color: '#9ca3af', fontSize: 11 },
    splitLine: { lineStyle: { color: '#2a2f3d' } },
    splitArea: { areaStyle: { color: ['transparent'] } },
    axisLine: { lineStyle: { color: '#2a2f3d' } },
  },
  series: [
    {
      type: 'radar',
      data: [
        {
          name: t('batchRegression.panel.first'),
          value: TRACKED_DIMENSIONS.map((dim) => num(`dim.${dim}.first_avg`) ?? 0),
          lineStyle: { color: BLUE, width: 2 },
          itemStyle: { color: BLUE },
          areaStyle: { color: 'rgba(91,168,232,0.15)' },
        },
        {
          name: t('batchRegression.panel.last'),
          value: TRACKED_DIMENSIONS.map((dim) => num(`dim.${dim}.last_avg`) ?? 0),
          lineStyle: { color: GREEN, width: 2 },
          itemStyle: { color: GREEN },
          areaStyle: { color: 'rgba(126,201,160,0.15)' },
        },
      ],
    },
  ],
}))

// ─── 维度平均变化（横向条；中性蓝，不按正负暗示好坏结论） ───
const dimDeltaOption = computed(() => {
  const rows = TRACKED_DIMENSIONS.map((dim) => ({ label: dimensionLabel(dim), value: num(`dim.${dim}.delta_avg`) }))
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: '#1e222d', borderColor: '#2a2f3d', textStyle: { color: '#e5e7eb', fontSize: 12 } },
    grid: { left: 80, right: 28, top: 12, bottom: 24 },
    xAxis: { type: 'value', axisLabel: { color: '#6b7280', fontSize: 10 }, splitLine: { lineStyle: { color: '#2a2f3d' } } },
    yAxis: { type: 'category', inverse: true, data: rows.map((r) => r.label), axisLabel: { color: '#9ca3af', fontSize: 10 }, axisLine: { lineStyle: { color: '#2a2f3d' } } },
    series: [{
      type: 'bar',
      data: rows.map((r) => ({ value: r.value, itemStyle: { color: BLUE, borderRadius: [0, 3, 3, 0] } })),
      markLine: {
        silent: true,
        symbol: 'none',
        lineStyle: { color: '#6b7280', type: 'dashed', width: 1 },
        data: [{ xAxis: 0 }],
      },
    }],
  }
})

// ─── 事件率 / 策略率（横向条） ───
function rateBarOption(ids: readonly string[], prefix: 'event' | 'strategy', labelOf: (id: string) => string, color: string) {
  const rows = ids.map((id) => ({ label: labelOf(id), value: num(`${prefix}.${id}.rate`) }))
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: '#1e222d', borderColor: '#2a2f3d', textStyle: { color: '#e5e7eb', fontSize: 12 } },
    grid: { left: 96, right: 28, top: 12, bottom: 24 },
    xAxis: { type: 'value', max: 1, axisLabel: { color: '#6b7280', fontSize: 10 }, splitLine: { lineStyle: { color: '#2a2f3d' } } },
    yAxis: { type: 'category', inverse: true, data: rows.map((r) => r.label), axisLabel: { color: '#9ca3af', fontSize: 10 }, axisLine: { lineStyle: { color: '#2a2f3d' } } },
    series: [{
      type: 'bar',
      data: rows.map((r) => ({ value: r.value, itemStyle: { color, borderRadius: [0, 3, 3, 0] } })),
    }],
  }
}

const eventOption = computed(() => rateBarOption(TRACKED_EVENTS, 'event', eventLabel, PURPLE))
const strategyOption = computed(() => rateBarOption(TRACKED_STRATEGIES, 'strategy', strategyLabel, YELLOW))

// ─── 出口分布（纵向柱；按出口语义着色） ───
const OUTCOME_COLOR: Record<string, string> = {
  completed: GREEN,
  crisis_ended: YELLOW,
  stagnant: GRAY,
  failed: RED,
}

const outcomeOption = computed(() => ({
  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: '#1e222d', borderColor: '#2a2f3d', textStyle: { color: '#e5e7eb', fontSize: 12 } },
  grid: { left: 40, right: 16, top: 12, bottom: 30 },
  xAxis: { type: 'category', data: SESSION_OUTCOMES.map(outcomeLabel), axisLabel: { color: '#9ca3af', fontSize: 10 }, axisLine: { lineStyle: { color: '#2a2f3d' } } },
  yAxis: { type: 'value', minInterval: 1, axisLabel: { color: '#6b7280', fontSize: 10 }, splitLine: { lineStyle: { color: '#2a2f3d' } } },
  series: [{
    type: 'bar',
    data: SESSION_OUTCOMES.map((outcome) => ({
      value: num(`session.outcome.${outcome}`) ?? 0,
      itemStyle: { color: OUTCOME_COLOR[outcome], borderRadius: [3, 3, 0, 0] },
    })),
  }],
}))

// ─── 覆盖率环图 ───
const coverageOption = computed(() => {
  const { includedSessions, skippedSessions } = props.snapshot.coverage
  return {
    tooltip: { trigger: 'item', backgroundColor: '#1e222d', borderColor: '#2a2f3d', textStyle: { color: '#e5e7eb', fontSize: 12 } },
    legend: { textStyle: { color: '#9ca3af', fontSize: 11 }, bottom: 0 },
    series: [{
      type: 'pie',
      radius: ['42%', '68%'],
      center: ['50%', '45%'],
      label: { color: '#9ca3af', fontSize: 11 },
      itemStyle: { borderColor: '#161922', borderWidth: 2 },
      data: [
        { name: t('batchRegression.panel.included'), value: includedSessions, itemStyle: { color: GREEN } },
        { name: t('batchRegression.panel.skipped'), value: skippedSessions, itemStyle: { color: RED } },
      ],
    }],
  }
})

// ─── 分组切片（模式 / 角色） ───
interface GroupRow { id: string; sessions: number; turns: number }

function groupRows(sliceMap: Record<string, MetricsSlice>): GroupRow[] {
  return Object.entries(sliceMap)
    .map(([id, slice]) => ({ id, sessions: slice.sessions, turns: slice.turns }))
    .sort((a, b) => b.sessions - a.sessions)
}

const modeRows = computed(() => groupRows(props.snapshot.byMode))
const characterRows = computed(() => groupRows(props.snapshot.byCharacter))

const coverage = computed(() => props.snapshot.coverage)
</script>

<template>
  <div class="space-y-4">
    <!-- 覆盖统计 -->
    <div class="grid grid-cols-4 gap-4">
      <div class="card p-4">
        <div class="text-xs text-muted mb-1">{{ t('batchRegression.panel.expected') }}</div>
        <div class="text-2xl font-mono font-semibold">{{ coverage.expectedSessions }}</div>
      </div>
      <div class="card p-4">
        <div class="text-xs text-muted mb-1">{{ t('batchRegression.panel.included') }}</div>
        <div class="text-2xl font-mono font-semibold text-ok">{{ coverage.includedSessions }}</div>
      </div>
      <div class="card p-4">
        <div class="text-xs text-muted mb-1">{{ t('batchRegression.panel.skipped') }}</div>
        <div class="text-2xl font-mono font-semibold">{{ coverage.skippedSessions }}</div>
      </div>
      <div class="card p-4">
        <div class="text-xs text-muted mb-1">{{ t('batchRegression.panel.totalTurns') }}</div>
        <div class="text-2xl font-mono font-semibold">{{ coverage.totalTurns }}</div>
      </div>
    </div>

    <!-- 图表网格 -->
    <div class="grid grid-cols-2 gap-4">
      <div class="card p-4">
        <h3 class="text-sm font-medium mb-3">{{ t('batchRegression.panel.radarTitle') }}</h3>
        <VChart :option="radarOption" :autoresize="true" class="h-64" />
      </div>
      <div class="card p-4">
        <h3 class="text-sm font-medium mb-3">{{ t('batchRegression.panel.coverageTitle') }}</h3>
        <VChart :option="coverageOption" :autoresize="true" class="h-64" />
      </div>
      <div class="card p-4">
        <h3 class="text-sm font-medium mb-3">{{ t('batchRegression.panel.dimDeltaTitle') }}
          <MetricInfoTooltip metric-id="dim.trust.delta_avg" />
        </h3>
        <VChart :option="dimDeltaOption" :autoresize="true" class="h-64" />
      </div>
      <div class="card p-4">
        <h3 class="text-sm font-medium mb-3">{{ t('batchRegression.panel.outcomeTitle') }}</h3>
        <VChart :option="outcomeOption" :autoresize="true" class="h-64" />
      </div>
      <div class="card p-4">
        <h3 class="text-sm font-medium mb-3">{{ t('batchRegression.panel.eventTitle') }}
          <MetricInfoTooltip metric-id="event.empathy.rate" />
        </h3>
        <VChart :option="eventOption" :autoresize="true" class="h-64" />
      </div>
      <div class="card p-4">
        <h3 class="text-sm font-medium mb-3">{{ t('batchRegression.panel.strategyTitle') }}
          <MetricInfoTooltip metric-id="strategy.simple_response.rate" />
        </h3>
        <VChart :option="strategyOption" :autoresize="true" class="h-64" />
      </div>
    </div>

    <!-- 分组切片 -->
    <div class="grid grid-cols-2 gap-4">
      <div class="card p-4">
        <h3 class="text-sm font-medium mb-3">{{ t('batchRegression.panel.groupByMode') }}</h3>
        <div v-if="modeRows.length" class="space-y-2 py-1">
          <div v-for="row in modeRows" :key="row.id" class="flex items-center justify-between text-sm">
            <span class="text-muted font-mono text-xs">{{ row.id }}</span>
            <span class="font-mono text-xs">
              {{ row.sessions }} {{ t('batchRegression.panel.colSessions') }} · {{ row.turns }} {{ t('batchRegression.panel.colTurns') }}
            </span>
          </div>
        </div>
        <div v-else class="py-8 text-center text-muted text-sm">{{ t('batchRegression.panel.noGroup') }}</div>
      </div>
      <div class="card p-4">
        <h3 class="text-sm font-medium mb-3">{{ t('batchRegression.panel.groupByCharacter') }}</h3>
        <div v-if="characterRows.length" class="space-y-2 py-1">
          <div v-for="row in characterRows" :key="row.id" class="flex items-center justify-between text-sm">
            <span class="text-muted font-mono text-xs">{{ row.id }}</span>
            <span class="font-mono text-xs">
              {{ row.sessions }} {{ t('batchRegression.panel.colSessions') }} · {{ row.turns }} {{ t('batchRegression.panel.colTurns') }}
            </span>
          </div>
        </div>
        <div v-else class="py-8 text-center text-muted text-sm">{{ t('batchRegression.panel.noGroup') }}</div>
      </div>
    </div>
  </div>
</template>
