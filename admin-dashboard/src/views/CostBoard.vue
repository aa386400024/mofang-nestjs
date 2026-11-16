<script setup lang="ts">
import { ref, computed, onMounted, h } from 'vue'
import { useI18n } from 'vue-i18n'
import { use } from 'echarts/core'
import { BarChart, LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import VChart from 'vue-echarts'
import { NTag } from 'naive-ui'
import { api } from '@/api/client'
import type { CostTrendPoint, SessionCost } from '@/api/types'
import InfoTooltip from '@/components/InfoTooltip.vue'
import EmptyState from '@/components/EmptyState.vue'
import Skeleton from '@/components/Skeleton.vue'

const { t } = useI18n()
use([BarChart, LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])

const trend = ref<CostTrendPoint[]>([])
const sessions = ref<SessionCost[]>([])
const loading = ref(true)
const err = ref('')

onMounted(async () => {
  try {
    const [tr, s] = await Promise.all([api.costTrend(), api.sessionCosts()])
    trend.value = tr
    sessions.value = s
  } catch (e) { err.value = String(e) }
  finally { loading.value = false }
})

// ─── 汇总卡片 ───
const totalTokens = computed(() => trend.value.reduce((a, tr) => a + tr.tokens, 0))
const totalCost = computed(() => trend.value.reduce((a, tr) => a + tr.costCny, 0))
const totalSessions = computed(() => trend.value.reduce((a, tr) => a + tr.sessions, 0))
const avgCost = computed(() => (totalSessions.value ? totalCost.value / totalSessions.value : 0))

// 分来源汇总
const formalSessions = computed(() => trend.value.reduce((a, tr) => a + (tr.sessionsFormal ?? 0), 0))
const autoPracticeSessions = computed(() => trend.value.reduce((a, tr) => a + (tr.sessionsAutoPractice ?? 0), 0))
const formalCost = computed(() => trend.value.reduce((a, tr) => a + (tr.costFormal ?? 0), 0))
const autoPracticeCost = computed(() => trend.value.reduce((a, tr) => a + (tr.costAutoPractice ?? 0), 0))
const formalTokens = computed(() => trend.value.reduce((a, tr) => a + (tr.tokensFormal ?? 0), 0))
const autoPracticeTokens = computed(() => trend.value.reduce((a, tr) => a + (tr.tokensAutoPractice ?? 0), 0))

const hasSessions = computed(() => totalSessions.value > 0)
const hasTokenStats = computed(() => totalTokens.value > 0)
const hasAutoPractice = computed(() => autoPracticeSessions.value > 0)

// ─── 分组柱状图：分来源会话数 + 成本 ───
const trendChart = computed(() => ({
  tooltip: {
    trigger: 'axis',
    backgroundColor: '#1e222d',
    borderColor: '#2a2f3d',
    textStyle: { color: '#e5e7eb', fontSize: 12 },
    axisPointer: { type: 'shadow' },
  },
  legend: {
    textStyle: { color: '#9ca3af', fontSize: 11 },
    top: 0,
    data: ['正式训练会话', '自动对练场次', '总成本(¥)'],
  },
  grid: { left: 50, right: 50, top: 40, bottom: 24 },
  xAxis: {
    type: 'category',
    data: trend.value.map(tr => tr.date),
    axisLabel: { color: '#6b7280', fontSize: 10 },
    axisLine: { lineStyle: { color: '#2a2f3d' } },
  },
  yAxis: [
    {
      type: 'value',
      name: '场次',
      axisLabel: { color: '#6b7280', fontSize: 10 },
      splitLine: { lineStyle: { color: '#2a2f3d' } },
    },
    {
      type: 'value',
      name: '¥',
      axisLabel: { color: '#6b7280', fontSize: 10 },
      splitLine: { show: false },
    },
  ],
  series: [
    {
      name: '正式训练会话',
      type: 'bar',
      stack: 'sessions',
      data: trend.value.map(tr => tr.sessionsFormal ?? 0),
      itemStyle: { color: '#5eb88a', borderRadius: [0, 0, 0, 0] },
    },
    {
      name: '自动对练场次',
      type: 'bar',
      stack: 'sessions',
      data: trend.value.map(tr => tr.sessionsAutoPractice ?? 0),
      itemStyle: { color: '#7a9eff', borderRadius: [3, 3, 0, 0] },
    },
    {
      name: '总成本(¥)',
      type: 'line',
      yAxisIndex: 1,
      data: trend.value.map(tr => tr.costCny),
      smooth: true,
      lineStyle: { width: 2, color: '#e8c87a' },
      itemStyle: { color: '#e8c87a' },
    },
  ],
}))

// ─── 会话列表 ───
const costColumns = [
  {
    title: () => t('cost.time'),
    key: 'startedAt',
    width: 150,
  },
  {
    title: '来源',
    key: 'source',
    width: 110,
    render: (row: SessionCost) => {
      const source = row.source ?? 'formal'
      if (source === 'auto_practice') {
        return h(NTag, { size: 'small', bordered: false, type: 'info' }, () => '自动对练')
      }
      return h(NTag, { size: 'small', bordered: false, type: 'success' }, () => '正式训练')
    },
  },
  {
    title: () => t('cost.visitor'),
    key: 'visitorAlias',
    render: (row: SessionCost) => h('div', { class: 'flex items-center gap-2' }, [
      h('span', null, row.visitorAlias),
      row.characterSlug && h(NTag, { size: 'tiny', bordered: false, type: 'info' }, () => row.characterSlug),
    ]),
  },
  {
    title: () => t('cost.token'),
    key: 'totalTokens',
    width: 120,
    align: 'right' as const,
    render: (row: SessionCost) => row.totalTokens.toLocaleString(),
  },
  {
    title: () => t('cost.cost'),
    key: 'costCny',
    width: 100,
    align: 'right' as const,
    render: (row: SessionCost) => `¥${row.costCny.toFixed(4)}`,
  },
  {
    title: () => t('cost.basis'),
    key: 'costBasis',
    width: 96,
    align: 'right' as const,
    render: (row: SessionCost) => {
      if (row.costBasis === 'full') return t('cost.basisFull')
      if (row.costBasis === 'estimated') return '无口径记录'
      return t('cost.basisOutputOnly')
    },
  },
]
</script>

<template>
  <div class="p-6 max-w-6xl mx-auto">
    <h1 class="text-lg font-semibold mb-4">{{ t('cost.title') }}</h1>

    <Skeleton v-if="loading" type="card-list" :count="4" />
    <EmptyState
      v-else-if="err"
      icon="warning"
      title="加载失败"
      :description="err"
      retry-text="重试"
      @retry="loadData"
    />
    <EmptyState
      v-else-if="!hasSessions"
      icon="cost"
      :title="t('cost.emptyTitle')"
      :description="t('cost.emptyDescription')"
    />

    <template v-else>
      <n-alert v-if="!hasTokenStats" type="warning" class="mb-4" :show-icon="true">
        {{ t('cost.noTokenStats') }}
      </n-alert>

      <!-- 汇总卡片：合计 + 分来源 -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <!-- 总场次 -->
        <div class="card p-4">
          <div class="text-[10px] uppercase tracking-wider text-muted mb-1 flex items-center">
            总会话数
            <InfoTooltip text="正式训练 + 自动对练合计" />
          </div>
          <div class="font-mono text-lg text-gray-100">{{ totalSessions }}</div>
          <div class="text-xs text-muted mt-1">
            正式 {{ formalSessions }} · 对练 {{ autoPracticeSessions }}
          </div>
        </div>

        <!-- 总成本 -->
        <div class="card p-4">
          <div class="text-[10px] uppercase tracking-wider text-muted mb-1 flex items-center">
            总成本
            <InfoTooltip text="所有会话的 LLM 成本合计" />
          </div>
          <div class="font-mono text-lg text-gray-100">¥{{ totalCost.toFixed(4) }}</div>
          <div class="text-xs text-muted mt-1">
            正式 ¥{{ formalCost.toFixed(2) }} · 对练 ¥{{ autoPracticeCost.toFixed(2) }}
          </div>
        </div>

        <!-- 总 token -->
        <div class="card p-4">
          <div class="text-[10px] uppercase tracking-wider text-muted mb-1 flex items-center">
            {{ t('cost.totalTokens') }}
            <InfoTooltip :text="t('cost.totalTokensTooltip')" />
          </div>
          <div class="font-mono text-lg text-gray-100">{{ totalTokens.toLocaleString() }}</div>
          <div class="text-xs text-muted mt-1">
            正式 {{ formalTokens.toLocaleString() }} · 对练 {{ autoPracticeTokens.toLocaleString() }}
          </div>
        </div>

        <!-- 场均成本 -->
        <div class="card p-4">
          <div class="text-[10px] uppercase tracking-wider text-muted mb-1 flex items-center">
            {{ t('cost.avgCost') }}
            <InfoTooltip :text="t('cost.avgCostTooltip')" />
          </div>
          <div class="font-mono text-lg text-accent">¥{{ avgCost.toFixed(4) }}</div>
        </div>
      </div>

      <!-- 趋势图：堆叠柱状图 + 成本线 -->
      <div class="card p-4 mb-4">
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-xs uppercase tracking-wider text-muted">{{ t('cost.trend') }}</h2>
          <div v-if="hasAutoPractice" class="text-xs text-muted">
            堆叠柱状图：正式训练 + 自动对练
          </div>
        </div>
        <VChart :option="trendChart" :autoresize="true" style="height: 280px" />
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
