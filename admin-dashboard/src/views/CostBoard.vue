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
import EmptyState from '@/components/EmptyState.vue'

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

// n-data-table 列定义
const costColumns = [
  {
    title: () => t('cost.time'),
    key: 'startedAt',
    width: 150,
  },
  {
    title: () => t('cost.visitor'),
    key: 'visitorAlias',
  },
  {
    title: () => t('cost.token'),
    key: 'tokens',
    width: 120,
    align: 'right' as const,
    render: (row: SessionCost) => row.tokens.toLocaleString(),
  },
  {
    title: () => t('cost.cost'),
    key: 'costCny',
    width: 100,
    align: 'right' as const,
    render: (row: SessionCost) => `¥${row.costCny.toFixed(2)}`,
  },
]
</script>

<template>
  <div class="p-6 max-w-6xl mx-auto">
    <h1 class="text-lg font-semibold mb-4">{{ t('cost.title') }}</h1>

    <!-- 空状态 -->
    <EmptyState
      v-if="!trend.length"
      icon="cost"
      title="暂无成本数据"
      description="后端尚未提供成本聚合 API。完成对练后，这里会展示每日 Token 消耗、成本统计和会话排行。"
      pendingTag="Pending: WP24 成本聚合 API"
    />

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
      <n-card :title="t('cost.recentSessions')" size="small">
        <n-data-table
          :columns="costColumns"
          :data="sessions"
          :bordered="false"
          size="small"
        />
      </n-card>
    </template>
  </div>
</template>
