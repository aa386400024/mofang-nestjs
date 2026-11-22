<script setup lang="ts">
import { computed } from 'vue'
import { use } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import VChart from 'vue-echarts'
import type { TurnTrace } from '@/api/types'

use([LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])

const props = defineProps<{ turns: TurnTrace[] }>()

const option = computed(() => {
  const turns = props.turns
  const indices = turns.map(t => `轮${t.turnIndex}`)
  // 只画有数据的曲线（后端补了 safety / bond 后自动出现）
  const allSeries = [
    { name: '信任', key: 'trust', data: turns.map(t => t.bdiSnapshot.trust), color: '#7ec9a0' },
    { name: '安全感', key: 'safety', data: turns.map(t => t.bdiSnapshot.safety), color: '#5ba8e8' },
    { name: '联结感', key: 'bond', data: turns.map(t => t.bdiSnapshot.bond), color: '#b87ae8' },
    { name: '效价', key: 'valence', data: turns.map(t => t.bdiSnapshot.valence), color: '#c890a8' },
    { name: '唤醒', key: 'arousal', data: turns.map(t => t.bdiSnapshot.arousal), color: '#e8c87a' },
    { name: '阻抗', key: 'resistance', data: turns.map(t => t.bdiSnapshot.resistance), color: '#e87a7a' },
  ]
  // 过滤掉全是 undefined 的曲线
  const series = allSeries.filter(s => s.data.some(v => v !== undefined && v !== null))
  return {
    tooltip: { trigger: 'axis', backgroundColor: '#1e222d', borderColor: '#2a2f3d', textStyle: { color: '#e5e7eb', fontSize: 12 } },
    legend: { textStyle: { color: '#9ca3af', fontSize: 11 }, top: 0 },
    grid: { left: 40, right: 16, top: 30, bottom: 24 },
    xAxis: {
      type: 'category', data: indices,
      axisLabel: { color: '#6b7280', fontSize: 10 },
      axisLine: { lineStyle: { color: '#2a2f3d' } },
    },
    yAxis: {
      type: 'value', min: -1, max: 1,
      axisLabel: { color: '#6b7280', fontSize: 10 },
      splitLine: { lineStyle: { color: '#2a2f3d' } },
    },
    series: series.map(s => ({
      name: s.name, type: 'line', smooth: true, data: s.data,
      symbol: 'circle', symbolSize: 5,
      lineStyle: { width: 2, color: s.color },
      itemStyle: { color: s.color },
    })),
  }
})
</script>

<template>
  <VChart :option="option" :autoresize="true" style="height: 220px" />
</template>
