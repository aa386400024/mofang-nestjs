<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { use } from 'echarts/core'
import { BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import VChart from 'vue-echarts'
import { api } from '@/api/client'
import type { DashboardStats } from '@/api/types'
import InfoTooltip from '@/components/InfoTooltip.vue'
import EmptyState from '@/components/EmptyState.vue'

use([BarChart, GridComponent, TooltipComponent, CanvasRenderer])

const { t } = useI18n()
const data = ref<DashboardStats | null>(null)
const weekly = ref<{ date: string; count: number }[]>([])
const recentSessions = ref<Awaited<ReturnType<typeof api.sessions>>>([])
const loading = ref(true)

onMounted(async () => {
  try {
    data.value = await api.dashboard()
    weekly.value = await api.weeklySessions()
    recentSessions.value = await api.sessions(5)
  }
  finally { loading.value = false }
})

const fmtCost = (v: number) => `¥${v.toFixed(2)}`
const riskLabel = (cat: string) => t(`risk.${cat}.label`)
const riskDesc = (cat: string) => t(`risk.${cat}.desc`)
</script>

<template>
  <div class="p-6 max-w-6xl mx-auto">
    <h1 class="text-lg font-semibold mb-4">{{ t('dashboard.title') }}</h1>
    <EmptyState
      v-if="loading"
      icon="chart"
      :title="t('dashboard.loading')"
      :description="t('dashboard.loadingDesc')"
    />
    <EmptyState
      v-else-if="!data"
      icon="chart"
      :title="t('dashboard.emptyTitle')"
      :description="t('dashboard.emptyDesc')"
      pendingTag="Pending: Dashboard 聚合 API"
    />
    <template v-else-if="data">
      <!-- 核心指标卡片 -->
      <div class="grid grid-cols-4 gap-4 mb-6">
        <!-- 总会话数 -->
        <div class="card p-5 hover:bg-bg-elevated transition">
          <div class="flex items-start justify-between mb-3">
            <div class="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <svg class="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <n-tag size="tiny" :bordered="false" type="info">+{{ data.todaySessions }} {{ t('dashboard.today') }}</n-tag>
          </div>
          <div class="text-2xl font-semibold text-gray-100 mb-1">{{ data.totalSessions }}</div>
          <div class="text-xs text-muted">{{ t('dashboard.totalSessions') }}</div>
        </div>

        <!-- 危机命中数 -->
        <div class="card p-5 hover:bg-bg-elevated transition">
          <div class="flex items-start justify-between mb-3">
            <div class="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center">
              <svg class="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
          </div>
          <div class="text-2xl font-semibold text-gray-100 mb-1">{{ data.crisisHits }}</div>
          <div class="text-xs text-muted">{{ t('dashboard.crisisHits') }}</div>
        </div>

        <!-- 总 Token 数 -->
        <div class="card p-5 hover:bg-bg-elevated transition">
          <div class="flex items-start justify-between mb-3">
            <div class="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
              <svg class="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <n-tag size="tiny" :bordered="false" type="warning">{{ fmtCost(data.estimatedCostCny) }}</n-tag>
          </div>
          <div class="text-2xl font-semibold text-gray-100 mb-1">{{ data.totalTokens.toLocaleString() }}</div>
          <div class="text-xs text-muted">{{ t('dashboard.totalTokens') }}</div>
        </div>

        <!-- PsyGuard 状态 -->
        <div class="card p-5 hover:bg-bg-elevated transition">
          <div class="flex items-start justify-between mb-3">
            <div class="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
              <svg class="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.021 12.021 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <span class="flex items-center gap-1.5 text-xs">
              <span class="w-1.5 h-1.5 rounded-full" :class="data.psyguard.status === 'ok' ? 'bg-ok' : 'bg-warn'"></span>
              <span :class="data.psyguard.status === 'ok' ? 'text-ok' : 'text-warn'">
                {{ data.psyguard.status === 'ok' ? t('dashboard.running') : t('dashboard.degraded') }}
              </span>
            </span>
          </div>
          <div class="text-2xl font-semibold text-gray-100 mb-1">{{ data.psyguard.p90Ms }}ms</div>
          <div class="text-xs text-muted">PsyGuard p90 · {{ data.psyguard.totalRequests }} {{ t('dashboard.requests') }}</div>
        </div>
      </div>

      <!-- 近 7 天会话趋势 -->
      <n-card :title="t('dashboard.weeklyTrend')" size="small" class="mb-4">
        <VChart :option="{
          tooltip: { trigger: 'axis', backgroundColor: '#1e222d', borderColor: '#2a2f3d', textStyle: { color: '#e5e7eb', fontSize: 12 } },
          grid: { left: 30, right: 16, top: 10, bottom: 24 },
          xAxis: { type: 'category', data: weekly.map(w => w.date), axisLabel: { color: '#6b7280', fontSize: 10 }, axisLine: { lineStyle: { color: '#2a2f3d' } } },
          yAxis: { type: 'value', minInterval: 1, axisLabel: { color: '#6b7280', fontSize: 10 }, splitLine: { lineStyle: { color: '#2a2f3d' } } },
          series: [{ type: 'bar', data: weekly.map(w => w.count), itemStyle: { color: 'rgba(200,144,168,0.6)', borderRadius: [3, 3, 0, 0] } }],
        }" :autoresize="true" style="height: 160px" />
      </n-card>

      <!-- 风险类别分布 -->
      <n-card :title="t('dashboard.riskDist')" size="small" class="mb-4">
        <div class="space-y-2">
          <div v-for="(count, cat) in data.psyguard.byCategory" :key="cat" class="flex items-center gap-3">
            <span class="text-xs font-mono w-40 text-gray-300 flex items-center">
              {{ riskLabel(cat) }}
              <InfoTooltip :text="riskDesc(cat)" />
            </span>
            <n-progress type="line" :percentage="Math.min(100, count / data.psyguard.totalRequests * 100 * 5)" :show-text="false" class="flex-1" />
            <span class="text-xs font-mono text-muted w-12 text-right">{{ count }}</span>
          </div>
        </div>
      </n-card>

      <!-- 最近会话 -->
      <n-card :title="t('dashboard.recentSessions')" size="small" class="mb-4">
        <div v-if="!recentSessions.length" class="text-muted text-sm">{{ t('dashboard.noRecentSessions') }}</div>
        <div v-else class="space-y-2">
          <RouterLink
            v-for="s in recentSessions"
            :key="s.sessionId"
            :to="`/sessions/${s.sessionId}`"
            class="flex items-center gap-3 p-2 rounded hover:bg-bg-elevated transition"
          >
            <div class="flex-1 min-w-0">
              <div class="text-sm text-gray-200 truncate">{{ s.visitorAlias }}</div>
              <div class="text-xs text-muted mt-0.5 font-mono">
                {{ s.startedAt ? new Date(s.startedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—' }}
                · {{ s.durationSec }}s · {{ s.totalTokens }} tokens
              </div>
            </div>
            <n-tag size="tiny" :bordered="false" :type="s.status === 'completed' ? 'success' : 'warning'">
              {{ s.status }}
            </n-tag>
          </RouterLink>
        </div>
      </n-card>

      <!-- 快捷入口 -->
      <div class="grid grid-cols-3 gap-3 mt-4">
        <RouterLink to="/sessions" class="card p-4 hover:bg-bg-elevated transition cursor-pointer">
          <div class="text-sm font-medium text-gray-200">{{ t('nav.sessions') }} →</div>
          <div class="text-xs text-muted mt-1">{{ t('sessionDetail.transcript') }} / BDI / {{ t('sessionDetail.safety') }}</div>
        </RouterLink>
        <RouterLink to="/characters" class="card p-4 hover:bg-bg-elevated transition cursor-pointer">
          <div class="text-sm font-medium text-gray-200">{{ t('nav.characters') }} →</div>
          <div class="text-xs text-muted mt-1">{{ t('characterDetail.basicInfo') }} / 5Ps / {{ t('characterDetail.expressionStyle') }}</div>
        </RouterLink>
        <RouterLink to="/memories" class="card p-4 hover:bg-bg-elevated transition cursor-pointer">
          <div class="text-sm font-medium text-gray-200">{{ t('nav.memories') }} →</div>
          <div class="text-xs text-muted mt-1">{{ t('memories.longTerm') }} / {{ t('memories.supersededShort') }}</div>
        </RouterLink>
        <RouterLink to="/psyguard" class="card p-4 hover:bg-bg-elevated transition cursor-pointer">
          <div class="text-sm font-medium text-gray-200">{{ t('nav.psyguard') }} →</div>
          <div class="text-xs text-muted mt-1">{{ t('psyguard.latencyTrend') }} / {{ t('psyguard.riskDist') }}</div>
        </RouterLink>
        <RouterLink to="/cost" class="card p-4 hover:bg-bg-elevated transition cursor-pointer">
          <div class="text-sm font-medium text-gray-200">{{ t('nav.cost') }} →</div>
          <div class="text-xs text-muted mt-1">{{ t('cost.trend') }} / {{ t('cost.avgCost') }}</div>
        </RouterLink>
      </div>
    </template>
  </div>
</template>
