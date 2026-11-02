<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { use } from 'echarts/core'
import { LineChart, BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import VChart from 'vue-echarts'
import { api } from '@/api/client'
import type { PsyGuardStats, PsyGuardTrendPoint } from '@/api/types'
import InfoTooltip from '@/components/InfoTooltip.vue'

const { t } = useI18n()
use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])

const stats = ref<PsyGuardStats | null>(null)
const trend = ref<PsyGuardTrendPoint[]>([])

onMounted(async () => {
  const [s, tr] = await Promise.all([api.psyguard(), api.psyguardTrend()])
  stats.value = s
  trend.value = tr
})

const riskLabel = (cat: string) => t(`risk.${cat}.label`)
const riskDesc = (cat: string) => t(`risk.${cat}.desc`)

const latencyOption = {
  tooltip: { trigger: 'axis', backgroundColor: '#1e222d', borderColor: '#2a2f3d', textStyle: { color: '#e5e7eb', fontSize: 12 } },
  legend: { textStyle: { color: '#9ca3af', fontSize: 11 }, top: 0 },
  grid: { left: 50, right: 20, top: 30, bottom: 24 },
  xAxis: {
    type: 'category',
    data: trend.value.map(tr => tr.ts),
    axisLabel: { color: '#6b7280', fontSize: 10 },
    axisLine: { lineStyle: { color: '#2a2f3d' } },
  },
  yAxis: {
    type: 'value', name: 'ms',
    axisLabel: { color: '#6b7280', fontSize: 10 },
    splitLine: { lineStyle: { color: '#2a2f3d' } },
  },
  series: [
    { name: 'p50', type: 'line', smooth: true, data: trend.value.map(tr => tr.p50Ms), lineStyle: { width: 2, color: '#7ec9a0' }, itemStyle: { color: '#7ec9a0' } },
    { name: 'p90', type: 'line', smooth: true, data: trend.value.map(tr => tr.p90Ms), lineStyle: { width: 2, color: '#e87a7a' }, itemStyle: { color: '#e87a7a' } },
  ],
}

const requestsOption = {
  tooltip: { trigger: 'axis', backgroundColor: '#1e222d', borderColor: '#2a2f3d', textStyle: { color: '#e5e7eb', fontSize: 12 } },
  grid: { left: 50, right: 20, top: 16, bottom: 24 },
  xAxis: {
    type: 'category',
    data: trend.value.map(tr => tr.ts),
    axisLabel: { color: '#6b7280', fontSize: 10 },
    axisLine: { lineStyle: { color: '#2a2f3d' } },
  },
  yAxis: {
    type: 'value',
    axisLabel: { color: '#6b7280', fontSize: 10 },
    splitLine: { lineStyle: { color: '#2a2f3d' } },
  },
  series: [{
    name: 'requests', type: 'bar', data: trend.value.map(tr => tr.requests),
    itemStyle: { color: 'rgba(200,144,168,0.6)', borderRadius: [3, 3, 0, 0] },
  }],
}
</script>

<template>
  <div class="p-6 max-w-6xl mx-auto">
    <h1 class="text-lg font-semibold mb-4">{{ t('psyguard.title') }}</h1>
    <div v-if="!stats" class="text-muted text-sm">…</div>
    <template v-else>
      <!-- 状态卡片 -->
      <div class="grid grid-cols-4 gap-3 mb-4">
        <div class="card p-4" :class="stats.status === 'ok' ? '' : 'border-warn/50'">
          <div class="text-[10px] uppercase tracking-wider text-muted mb-1 flex items-center">
            {{ t('psyguard.status') }}
            <InfoTooltip :text="t('psyguard.statusTooltip')" />
          </div>
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full" :class="stats.status === 'ok' ? 'bg-ok' : 'bg-warn'"></span>
            <span class="font-mono text-lg text-gray-100">{{ stats.status === 'ok' ? t('psyguard.running') : t('psyguard.degraded') }}</span>
          </div>
        </div>
        <div class="card p-4">
          <div class="text-[10px] uppercase tracking-wider text-muted mb-1 flex items-center">
            {{ t('psyguard.p50') }}
            <InfoTooltip :text="t('psyguard.p50Tooltip')" />
          </div>
          <div class="font-mono text-lg text-gray-100">{{ stats.p50Ms }}<span class="text-xs text-muted ml-1">ms</span></div>
        </div>
        <div class="card p-4">
          <div class="text-[10px] uppercase tracking-wider text-muted mb-1 flex items-center">
            {{ t('psyguard.p90') }}
            <InfoTooltip :text="t('psyguard.p90Tooltip')" />
          </div>
          <div class="font-mono text-lg" :class="stats.p90Ms > 500 ? 'text-warn' : 'text-gray-100'">{{ stats.p90Ms }}<span class="text-xs text-muted ml-1">ms</span></div>
        </div>
        <div class="card p-4">
          <div class="text-[10px] uppercase tracking-wider text-muted mb-1 flex items-center">
            {{ t('psyguard.totalRequests') }}
            <InfoTooltip :text="t('psyguard.totalRequestsTooltip')" />
          </div>
          <div class="font-mono text-lg text-gray-100">{{ stats.totalRequests.toLocaleString() }}</div>
        </div>
      </div>

      <!-- 延迟趋势 -->
      <div class="card p-4 mb-4">
        <h2 class="text-xs uppercase tracking-wider text-muted mb-3">{{ t('psyguard.latencyTrend') }}</h2>
        <VChart :option="latencyOption" :autoresize="true" style="height: 240px" />
      </div>

      <div class="grid grid-cols-2 gap-4">
        <!-- 请求量 -->
        <div class="card p-4">
          <h2 class="text-xs uppercase tracking-wider text-muted mb-3">{{ t('psyguard.requestDist') }}</h2>
          <VChart :option="requestsOption" :autoresize="true" style="height: 200px" />
        </div>
        <!-- 类别分布 -->
        <div class="card p-4">
          <h2 class="text-xs uppercase tracking-wider text-muted mb-3 flex items-center">
            {{ t('psyguard.riskDist') }}
            <InfoTooltip :text="t('psyguard.riskDistTooltip')" />
          </h2>
          <div class="space-y-2.5">
            <div v-for="(count, cat) in stats.byCategory" :key="cat" class="flex items-center gap-3">
              <span class="text-xs font-mono w-36 text-gray-300 flex items-center">
                {{ riskLabel(cat) }}
                <InfoTooltip :text="riskDesc(cat)" />
              </span>
              <div class="flex-1 h-2 bg-bg-elevated rounded overflow-hidden">
                <div class="h-full rounded" :class="cat === 'neutral' ? 'bg-bg-border' : 'bg-accent/60'"
                     :style="{ width: `${Math.min(100, count / stats.totalRequests * 100 * 5)}%` }"></div>
              </div>
              <span class="text-xs font-mono text-muted w-10 text-right">{{ count }}</span>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
