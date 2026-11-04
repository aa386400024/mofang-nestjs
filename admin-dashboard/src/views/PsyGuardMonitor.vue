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
import EmptyState from '@/components/EmptyState.vue'

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
    <EmptyState
      v-if="!stats"
      icon="shield"
      title="暂无 PsyGuard 数据"
      description="后端尚未提供 PsyGuard 监控 API。接入后，这里会展示延迟趋势、请求量和风险类别分布。"
      pendingTag="Pending: PsyGuard 监控 API"
    />
    <template v-else>
      <!-- 状态卡片 -->
      <n-grid cols="4" responsive="screen" class="mb-4">
        <n-gi>
          <n-card size="small">
            <n-statistic :label="t('psyguard.status')">
              <template #default>
                <div class="flex items-center gap-2">
                  <span class="w-2.5 h-2.5 rounded-full" :class="stats.status === 'ok' ? 'bg-ok' : 'bg-warn'"></span>
                  <span class="font-mono text-lg">{{ stats.status === 'ok' ? t('psyguard.running') : t('psyguard.degraded') }}</span>
                </div>
              </template>
            </n-statistic>
          </n-card>
        </n-gi>
        <n-gi>
          <n-card size="small">
            <n-statistic :label="t('psyguard.p50')" :value="stats.p50Ms">
              <template #suffix>
                <span class="text-xs text-muted ml-1">ms</span>
              </template>
            </n-statistic>
          </n-card>
        </n-gi>
        <n-gi>
          <n-card size="small">
            <n-statistic :label="t('psyguard.p90')" :value="stats.p90Ms">
              <template #suffix>
                <span class="text-xs text-muted ml-1">ms</span>
              </template>
            </n-statistic>
          </n-card>
        </n-gi>
        <n-gi>
          <n-card size="small">
            <n-statistic :label="t('psyguard.totalRequests')" :value="stats.totalRequests.toLocaleString()" />
          </n-card>
        </n-gi>
      </n-grid>

      <!-- 延迟趋势 -->
      <n-card :title="t('psyguard.latencyTrend')" size="small" class="mb-4">
        <VChart :option="latencyOption" :autoresize="true" style="height: 240px" />
      </n-card>

      <n-grid cols="2" responsive="screen" class="gap-4">
        <!-- 请求量 -->
        <n-gi>
          <n-card :title="t('psyguard.requestDist')" size="small">
            <VChart :option="requestsOption" :autoresize="true" style="height: 200px" />
          </n-card>
        </n-gi>
        <!-- 类别分布 -->
        <n-gi>
          <n-card :title="t('psyguard.riskDist')" size="small">
            <div class="space-y-2.5">
              <div v-for="(count, cat) in stats.byCategory" :key="cat" class="flex items-center gap-3">
                <span class="text-xs font-mono w-36 text-gray-300 flex items-center">
                  {{ riskLabel(cat) }}
                  <InfoTooltip :text="riskDesc(cat)" />
                </span>
                <n-progress type="line" :percentage="Math.min(100, count / stats.totalRequests * 100 * 5)" :show-text="false" class="flex-1" />
                <span class="text-xs font-mono text-muted w-10 text-right">{{ count }}</span>
              </div>
            </div>
          </n-card>
        </n-gi>
      </n-grid>
    </template>
  </div>
</template>
