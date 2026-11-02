<script setup lang="ts">
import { computed } from 'vue'
import { use } from 'echarts/core'
import { RadarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import VChart from 'vue-echarts'

use([RadarChart, GridComponent, TooltipComponent, CanvasRenderer])

const props = defineProps<{
  dimensions: Record<string, number>
  labels: Record<string, string>
}>()

const option = computed(() => ({
  radar: {
    indicator: Object.keys(props.dimensions).map(k => ({
      name: props.labels[k] ?? k,
      max: 100,
    })),
    radius: '65%',
    splitNumber: 4,
    axisName: { color: '#9ca3af', fontSize: 11 },
    splitLine: { lineStyle: { color: '#2a2f3d' } },
    splitArea: { areaStyle: { color: ['transparent'] } },
    axisLine: { lineStyle: { color: '#2a2f3d' } },
  },
  series: [{
    type: 'radar',
    data: [{
      value: Object.values(props.dimensions),
      name: '六维评分',
      areaStyle: { color: 'rgba(200,144,168,0.25)' },
      lineStyle: { color: '#c890a8', width: 2 },
      itemStyle: { color: '#c890a8' },
    }],
  }],
}))
</script>

<template>
  <VChart :option="option" :autoresize="true" style="height: 260px" />
</template>
