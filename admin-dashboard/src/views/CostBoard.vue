<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { use } from 'echarts/core'
import { BarChart, LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import VChart from 'vue-echarts'
import { api } from '@/api/client'
import type { CostTrendPoint, SessionCost } from '@/api/types'
import InfoTooltip from '@/components/InfoTooltip.vue'

const { t } = useI18n()
use([BarChart, LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])

const trend = ref<CostTrendPoint[]>([])
const sessions = ref<SessionCost[]>([])

onMounted(async () => {
  const [tr, s] = await Promise.all([api.costTrend(), api.sessionCosts()])
  trend.value = tr
  sessions.value = s
})

const totalTokens = trend.value.reduce((a, tr) => a + tr.tokens, 0)
const totalCost = trend.value.reduce((a, tr) => a + tr.costCny, 0)
const totalSessions = trend.value.reduce((a, tr) => a + tr.sessions, 0)
const avgCost = totalSessions ? totalCost / totalSessions : 0

const tokenChart = {
  tooltip: { trigger: 'axis', backgroundColor: '#1e222d', borderColor: '#2a2f3d', textStyle: { color: '#e5e7eb', fontSize: 12 } },
  legend: { textStyle: { color: '#9ca3af', fontSize: 11 }, top: 0 },
  grid: { left: 50, right: 20, top: 30, bottom: 24 },
  xAxis: {
    type: 'category', data: trend.value.map(tr => tr.date),
    axisLabel: { color: '#6b7280', fontSize: 10 },
    axisLine: { lineStyle: { color: '#2a2f3d' } },
  },
  yAxis: [
    { type: 'value', name: 'tokens', axisLabel: { color: '#6b7280', fontSize: 10 }, splitLine: { lineStyle: { color: '#2a2f3d' } } },
    { type: 'value', name: '¥', axisLabel: { color: '#6b7280', fontSize: 10 }, splitLine: { show: false } },
  ],
  series: [
    { name: 'Tokens', type: 'bar', data: trend.value.map(tr => tr.tokens), itemStyle: { color: 'rgba(126,201,160,0.6)', borderRadius: [3, 3, 0, 0] } },
    { name: 'Cost (¥)', type: 'line', yAxisIndex: 1, data: trend.value.map(tr => tr.costCny), smooth: true, lineStyle: { width: 2, color: '#e8c87a' }, itemStyle: { color: '#e8c87a' } },
  ],
}
</script>

<template>
  <div class="p-6 max-w-6xl mx-auto">
    <h1 class="text-lg font-semibold mb-4">{{ t('cost.title') }}</h1>
    <div v-if="!trend.length" class="text-muted text-sm">…</div>
    <template v-else>
      <!-- 汇总卡片 -->
      <div class="grid grid-cols-4 gap-3 mb-4">
        <div class="card p-4">
          <div class="text-[10px] uppercase tracking-wider text-muted mb-1 flex items-center">
            {{ t('cost.totalTokens') }}
            <InfoTooltip :text="t('cost.totalTokensTooltip')" />
          </div>
          <div class="font-mono text-lg text-gray-100">{{ totalTokens.toLocaleString() }}</div>
        </div>
        <div class="card p-4">
          <div class="text-[10px] uppercase tracking-wider text-muted mb-1 flex items-center">
            {{ t('cost.totalCost') }}
            <InfoTooltip :text="t('cost.totalCostTooltip')" />
          </div>
          <div class="font-mono text-lg text-gray-100">¥{{ totalCost.toFixed(2) }}</div>
        </div>
        <div class="card p-4">
          <div class="text-[10px] uppercase tracking-wider text-muted mb-1 flex items-center">
            {{ t('cost.sessions') }}
            <InfoTooltip :text="t('cost.sessionsTooltip')" />
          </div>
          <div class="font-mono text-lg text-gray-100">{{ totalSessions }}</div>
        </div>
        <div class="card p-4">
          <div class="text-[10px] uppercase tracking-wider text-muted mb-1 flex items-center">
            {{ t('cost.avgCost') }}
            <InfoTooltip :text="t('cost.avgCostTooltip')" />
          </div>
          <div class="font-mono text-lg text-accent">¥{{ avgCost.toFixed(2) }}</div>
        </div>
      </div>

      <!-- 趋势图 -->
      <div class="card p-4 mb-4">
        <h2 class="text-xs uppercase tracking-wider text-muted mb-3">{{ t('cost.trend') }}</h2>
        <VChart :option="tokenChart" :autoresize="true" style="height: 260px" />
      </div>

      <!-- 会话成本排行 -->
      <div class="card overflow-hidden">
        <div class="px-4 py-3 border-b border-bg-border">
          <h2 class="text-xs uppercase tracking-wider text-muted">{{ t('cost.recentSessions') }}</h2>
        </div>
        <table class="w-full text-sm">
          <thead class="bg-bg-elevated text-muted text-xs uppercase">
            <tr>
              <th class="text-left px-4 py-2 font-medium">{{ t('cost.time') }}</th>
              <th class="text-left px-4 py-2 font-medium">{{ t('cost.visitor') }}</th>
              <th class="text-right px-4 py-2 font-medium">{{ t('cost.token') }}</th>
              <th class="text-right px-4 py-2 font-medium">{{ t('cost.cost') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in sessions" :key="s.sessionId" class="border-t border-bg-border hover:bg-bg-elevated">
              <td class="px-4 py-2.5 font-mono text-xs text-muted">{{ s.startedAt }}</td>
              <td class="px-4 py-2.5">{{ s.visitorAlias }}</td>
              <td class="px-4 py-2.5 text-right font-mono text-xs">{{ s.tokens.toLocaleString() }}</td>
              <td class="px-4 py-2.5 text-right font-mono text-xs text-accent">¥{{ s.costCny.toFixed(2) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>
