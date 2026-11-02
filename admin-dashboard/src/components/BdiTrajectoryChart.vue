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
  const series = [
    { name: 'trust', data: turns.map(t => t.bdi.trust), color: '#7ec9a0' },
    { name: 'valence', data: turns.map(t => t.bdi.valence), color: '#c890a8' },
    { name: 'arousal', data: turns.map(t => t.bdi.arousal), color: '#e8c87a' },
    { name: 'resistance', data: turns.map(t => t.bdi.resistance), color: '#e87a7a' },
  ]
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
