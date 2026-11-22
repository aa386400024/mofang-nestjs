<script setup lang="ts">
// WP-K 批次回归页 · 批次规模柱状图（场次 / 轮数；计数口径，与比率折线分轴）。
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { use } from 'echarts/core'
import { BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import VChart from 'vue-echarts'
import type { BatchSummaryRow } from '@/api/types'
import { shortHash, formatBatchTime } from './batchRegressionMeta'

use([BarChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])

const props = defineProps<{
  rows: BatchSummaryRow[]
}>()

const { t } = useI18n()

const option = computed(() => {
  const rows = props.rows
  const labels = rows.map((row) => `${formatBatchTime(row.createdAt)} ${shortHash(row.batchId)}`)

  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1e222d',
      borderColor: '#2a2f3d',
      textStyle: { color: '#e5e7eb', fontSize: 12 },
    },
    legend: { textStyle: { color: '#9ca3af', fontSize: 11 }, top: 0 },
    grid: { left: 48, right: 48, top: 30, bottom: 28 },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: { color: '#6b7280', fontSize: 10 },
      axisLine: { lineStyle: { color: '#2a2f3d' } },
    },
    yAxis: [
      {
        type: 'value',
        name: t('batchRegression.chart.sessions'),
        nameTextStyle: { color: '#6b7280', fontSize: 10 },
        axisLabel: { color: '#6b7280', fontSize: 10 },
        splitLine: { lineStyle: { color: '#2a2f3d' } },
      },
      {
        type: 'value',
        name: t('batchRegression.chart.turns'),
        nameTextStyle: { color: '#6b7280', fontSize: 10 },
        axisLabel: { color: '#6b7280', fontSize: 10 },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: t('batchRegression.chart.sessions'),
        type: 'bar',
        yAxisIndex: 0,
        data: rows.map((row) => row.totalSessions),
        itemStyle: { color: '#5ba8e8', borderRadius: [3, 3, 0, 0] },
      },
      {
        name: t('batchRegression.chart.turns'),
        type: 'bar',
        yAxisIndex: 1,
        data: rows.map((row) => row.totalTurns),
        itemStyle: { color: '#b87ae8', borderRadius: [3, 3, 0, 0] },
      },
    ],
  }
})
</script>

<template>
  <VChart :option="option" :autoresize="true" style="height: 240px" />
</template>
