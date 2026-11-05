<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
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
// ⚠️ 这几个数**必须用 computed** —— 之前是在 setup 里求值一次的常量,
// 那时 trend 还是空数组 → 页面永远显示 0. 数据是异步到的, 汇总得跟着数据走。
const totalTokens = computed(() => trend.value.reduce((a, tr) => a + tr.tokens, 0))
const totalCost = computed(() => trend.value.reduce((a, tr) => a + tr.costCny, 0))
const totalSessions = computed(() => trend.value.reduce((a, tr) => a + tr.sessions, 0))
const avgCost = computed(() => (totalSessions.value ? totalCost.value / totalSessions.value : 0))

// 有会话但一个 token 都没有 → 多半是留痕没开（成本数据来自留痕快照）。
const hasSessions = computed(() => totalSessions.value > 0)
const hasTokenStats = computed(() => totalTokens.value > 0)

const tokenChart = computed(() => ({
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
}))

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
    // 成本口径: 上游没报输入侧用量时, 这个数只是**下界** —— 得让人看得出区别。
    title: () => t('cost.basis'),
    key: 'costBasis',
    width: 96,
    align: 'right' as const,
    render: (row: SessionCost) => (row.costBasis === 'full' ? t('cost.basisFull') : t('cost.basisOutputOnly')),
  },
]
</script>

<template>
  <div class="p-6 max-w-6xl mx-auto">
    <h1 class="text-lg font-semibold mb-4">{{ t('cost.title') }}</h1>

    <div v-if="loading" class="text-muted text-sm">…</div>
    <div v-else-if="err" class="text-danger text-sm">{{ err }}</div>

    <!-- 空状态：窗口内一场会话都没有 -->
    <EmptyState
      v-else-if="!hasSessions"
      icon="cost"
      :title="t('cost.emptyTitle')"
      :description="t('cost.emptyDescription')"
    />

    <template v-else>
      <!-- 有会话但没有 token 统计：数据来自调试留痕，留痕没开就是 0 -->
      <n-alert v-if="!hasTokenStats" type="warning" class="mb-4" :show-icon="true">
        {{ t('cost.noTokenStats') }}
      </n-alert>

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
          <div class="font-mono text-lg text-gray-100">¥{{ totalCost.toFixed(4) }}</div>
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
          <div class="font-mono text-lg text-accent">¥{{ avgCost.toFixed(4) }}</div>
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
