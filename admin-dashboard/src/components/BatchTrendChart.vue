<script setup lang="ts">
// WP-K 批次回归页 · 批次时间轴多系列趋势折线（契约 §6.1：批次按时间排列，关键指标可切换显隐）。
// 数据源是列表行的冗余标量（快照计算时同源写入），不逐批拉快照。
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { use } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import VChart from 'vue-echarts'
import type { BatchSummaryRow } from '@/api/types'
import { shortHash, formatBatchTime } from './batchRegressionMeta'

use([LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])

const props = defineProps<{
  rows: BatchSummaryRow[]
}>()

const { t } = useI18n()

/** 四个冗余标量系列（顺序与列表表头一致）。 */
const SERIES = [
  { key: 'explorationRate', color: '#7ec9a0' },
  { key: 'depthDeltaAvg', color: '#5ba8e8' },
  { key: 'safetyDeltaAvg', color: '#b87ae8' },
  { key: 'positiveEventRate', color: '#e8c87a' },
] as const

type SeriesKey = (typeof SERIES)[number]['key']

const option = computed(() => {
  const rows = props.rows
  const labels = rows.map((row) => `${formatBatchTime(row.createdAt)} ${shortHash(row.batchId)}`)
  const series = SERIES.map((def, index) => ({
    name: t(`batchRegression.metrics.${def.key}`),
    type: 'line' as const,
    smooth: true,
    symbol: 'circle',
    symbolSize: 5,
    connectNulls: false,
    lineStyle: { width: 2, color: def.color },
    itemStyle: { color: def.color },
    data: rows.map((row) => {
      const value = row[def.key as SeriesKey]
      return value === null ? '-' : Number(value.toFixed(4))
    }),
    // 零轴参考线（仅挂首个系列，避免重复渲染）。
    markLine: index === 0 ? {
      silent: true,
      symbol: 'none',
      lineStyle: { color: '#6b7280', type: 'dashed', width: 1 },
      data: [{ yAxis: 0 }],
    } : undefined,
  }))

  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1e222d',
      borderColor: '#2a2f3d',
      textStyle: { color: '#e5e7eb', fontSize: 12 },
    },
    legend: { textStyle: { color: '#9ca3af', fontSize: 11 }, top: 0 },
    grid: { left: 48, right: 16, top: 30, bottom: 28 },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: { color: '#6b7280', fontSize: 10 },
      axisLine: { lineStyle: { color: '#2a2f3d' } },
    },
    yAxis: {
      type: 'value',
      min: -1,
      max: 1,
      axisLabel: { color: '#6b7280', fontSize: 10 },
      splitLine: { lineStyle: { color: '#2a2f3d' } },
    },
    series,
  }
})
</script>

<template>
  <VChart :option="option" :autoresize="true" style="height: 240px" />
</template>
