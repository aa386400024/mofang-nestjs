<script setup lang="ts">
// WP-K 批次回归页 · 对比报告差值条形图：逐指标 delta 横向条，按 |delta| 排序，按判定方向着色。
// 只渲染可比报告（incomparable 的 items 为空，组件回退空态）。
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { use } from 'echarts/core'
import { BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import VChart from 'vue-echarts'
import type { CompareCandidateReport, RegressionItem } from '@/api/types'
import { metricLabel, formatDelta } from './batchRegressionMeta'

use([BarChart, GridComponent, TooltipComponent, CanvasRenderer])

const props = defineProps<{
  report: CompareCandidateReport
}>()

const { t } = useI18n()

/** 方向着色：改善绿 / 中性灰 / 回退红（与报告卡片 movement 标签口径一致）。 */
const MOVEMENT_COLOR: Record<RegressionItem['movement'], string> = {
  improved: '#7ec9a0',
  neutral: '#6b7280',
  regressed: '#e87a7a',
}

const rows = computed(() =>
  props.report.items
    .filter((item) => item.delta !== null)
    .sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0)),
)

const option = computed(() => {
  if (rows.value.length === 0) return null

  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: '#1e222d',
      borderColor: '#2a2f3d',
      textStyle: { color: '#e5e7eb', fontSize: 12 },
      // value 为 delta；明细（基线 / 候选数值）见卡片差分表。
      valueFormatter: (value: number | null) => formatDelta(value),
    },
    grid: { left: 150, right: 32, top: 12, bottom: 24 },
    xAxis: {
      type: 'value',
      axisLabel: { color: '#6b7280', fontSize: 10 },
      splitLine: { lineStyle: { color: '#2a2f3d' } },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: rows.value.map((item) => metricLabel(item.metricId)),
      axisLabel: { color: '#9ca3af', fontSize: 10 },
      axisLine: { lineStyle: { color: '#2a2f3d' } },
    },
    series: [
      {
        type: 'bar',
        data: rows.value.map((item) => ({
          value: item.delta,
          itemStyle: { color: MOVEMENT_COLOR[item.movement], borderRadius: [0, 3, 3, 0] },
        })),
        label: {
          show: true,
          position: 'right',
          color: '#9ca3af',
          fontSize: 10,
          formatter: (params: { value: number | null }) => formatDelta(params.value),
        },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: '#6b7280', type: 'dashed', width: 1 },
          data: [{ xAxis: 0 }],
        },
      },
    ],
  }
})
</script>

<template>
  <VChart v-if="option" :option="option" :autoresize="true" style="height: 220px" />
  <div v-else class="h-40 flex items-center justify-center text-muted text-sm">
    {{ t('batchRegression.deltaChartEmpty') }}
  </div>
</template>
