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

use([BarChart, GridComponent, TooltipComponent, CanvasRenderer])

const { t } = useI18n()
const data = ref<DashboardStats | null>(null)
const weekly = ref<{ date: string; count: number }[]>([])
const loading = ref(true)

onMounted(async () => {
  try {
    data.value = await api.dashboard()
    weekly.value = await api.weeklySessions()
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
    <div v-if="loading" class="text-muted text-sm">…</div>
    <template v-else-if="data">
      <!-- 核心指标卡片 -->
      <div class="grid grid-cols-4 gap-3 mb-4">
        <div class="card p-4">
          <div class="text-[10px] uppercase tracking-wider text-muted mb-1">{{ t('dashboard.totalSessions') }}</div>
          <div class="font-mono text-2xl text-gray-100">{{ data.totalSessions }}</div>
          <div class="text-[10px] text-muted mt-1">{{ t('dashboard.todayNew') }} {{ data.todaySessions }}</div>
        </div>
        <div class="card p-4">
          <div class="text-[10px] uppercase tracking-wider text-muted mb-1">{{ t('dashboard.crisisHits') }}</div>
          <div class="font-mono text-2xl text-danger">{{ data.crisisHits }}</div>
          <div class="text-[10px] text-muted mt-1">{{ t('dashboard.crisisDesc') }}</div>
        </div>
        <div class="card p-4">
          <div class="text-[10px] uppercase tracking-wider text-muted mb-1">{{ t('dashboard.totalTokens') }}</div>
          <div class="font-mono text-2xl text-gray-100">{{ data.totalTokens.toLocaleString() }}</div>
          <div class="text-[10px] text-muted mt-1">{{ t('dashboard.estCost') }} {{ fmtCost(data.estimatedCostCny) }}</div>
        </div>
        <div class="card p-4" :class="data.psyguard.status === 'ok' ? '' : 'border-warn/50'">
          <div class="text-[10px] uppercase tracking-wider text-muted mb-1">{{ t('dashboard.psyguard') }}</div>
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full" :class="data.psyguard.status === 'ok' ? 'bg-ok' : 'bg-warn'"></span>
            <span class="font-mono text-lg text-gray-100">{{ data.psyguard.status === 'ok' ? t('dashboard.running') : t('dashboard.degraded') }}</span>
          </div>
          <div class="text-[10px] text-muted mt-1">{{ t('dashboard.p90') }} {{ data.psyguard.p90Ms }}ms · {{ data.psyguard.totalRequests }} {{ t('dashboard.requests') }}</div>
        </div>
      </div>

      <!-- 近 7 天会话趋势 -->
      <div class="card p-4 mb-4">
        <h2 class="text-xs uppercase tracking-wider text-muted mb-3">{{ t('dashboard.weeklyTrend') }}</h2>
        <VChart :option="{
          tooltip: { trigger: 'axis', backgroundColor: '#1e222d', borderColor: '#2a2f3d', textStyle: { color: '#e5e7eb', fontSize: 12 } },
          grid: { left: 30, right: 16, top: 10, bottom: 24 },
          xAxis: { type: 'category', data: weekly.map(w => w.date), axisLabel: { color: '#6b7280', fontSize: 10 }, axisLine: { lineStyle: { color: '#2a2f3d' } } },
          yAxis: { type: 'value', minInterval: 1, axisLabel: { color: '#6b7280', fontSize: 10 }, splitLine: { lineStyle: { color: '#2a2f3d' } } },
          series: [{ type: 'bar', data: weekly.map(w => w.count), itemStyle: { color: 'rgba(200,144,168,0.6)', borderRadius: [3, 3, 0, 0] } }],
        }" :autoresize="true" style="height: 160px" />
      </div>

      <!-- 风险类别分布 -->
      <div class="card p-4">
        <h2 class="text-xs uppercase tracking-wider text-muted mb-3 flex items-center">
          {{ t('dashboard.riskDist') }}
          <InfoTooltip :text="t('dashboard.riskDistTooltip')" />
        </h2>
        <div class="space-y-2">
          <div v-for="(count, cat) in data.psyguard.byCategory" :key="cat" class="flex items-center gap-3">
            <span class="text-xs font-mono w-40 text-gray-300 flex items-center">
              {{ riskLabel(cat) }}
              <InfoTooltip :text="riskDesc(cat)" />
            </span>
            <div class="flex-1 h-2 bg-bg-elevated rounded overflow-hidden">
              <div class="h-full rounded" :class="cat === 'neutral' ? 'bg-bg-border' : 'bg-accent/60'"
                   :style="{ width: `${Math.min(100, count / data.psyguard.totalRequests * 100 * 5)}%` }"></div>
            </div>
            <span class="text-xs font-mono text-muted w-12 text-right">{{ count }}</span>
          </div>
        </div>
      </div>

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
