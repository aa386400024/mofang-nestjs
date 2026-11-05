<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { use } from 'echarts/core'
import { LineChart, BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import VChart from 'vue-echarts'
import { api } from '@/api/client'
import type { PsyGuardStats, PsyGuardTrend } from '@/api/types'
import InfoTooltip from '@/components/InfoTooltip.vue'
import EmptyState from '@/components/EmptyState.vue'

const { t } = useI18n()
use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])

const stats = ref<PsyGuardStats | null>(null)
const trend = ref<PsyGuardTrend | null>(null)

onMounted(async () => {
  const [s, tr] = await Promise.all([api.psyguard(), api.psyguardTrend()])
  stats.value = s
  trend.value = tr
})

const riskLabel = (cat: string) => t(`risk.${cat}.label`)
const riskDesc = (cat: string) => t(`risk.${cat}.desc`)

/**
 * 趋势点 (后端返的行数恒等于窗口天数).
 */
const points = computed(() => trend.value?.points ?? [])

/**
 * ⚠️ 图表配置必须是 **computed**:
 *   `onMounted` 里才拿到数据, 若在 setup 里直接算一次 option, 那个 option 的
 *   `data` 会永远是**请求发出前**的空数组 —— 图表渲染出来是一条空的轴.
 *   (这正是 WP31 成本看板踩过的同一个坑: 汇总卡片永远显示 0.)
 */
const latencyOption = computed(() => ({
  tooltip: { trigger: 'axis', backgroundColor: '#1e222d', borderColor: '#2a2f3d', textStyle: { color: '#e5e7eb', fontSize: 12 } },
  legend: { textStyle: { color: '#9ca3af', fontSize: 11 }, top: 0 },
  grid: { left: 50, right: 20, top: 30, bottom: 24 },
  xAxis: {
    type: 'category',
    data: points.value.map(tr => tr.ts),
    axisLabel: { color: '#6b7280', fontSize: 10 },
    axisLine: { lineStyle: { color: '#2a2f3d' } },
  },
  yAxis: {
    type: 'value', name: 'ms',
    axisLabel: { color: '#6b7280', fontSize: 10 },
    splitLine: { lineStyle: { color: '#2a2f3d' } },
  },
  series: [
    { name: 'p50', type: 'line', smooth: true, data: points.value.map(tr => tr.p50Ms), lineStyle: { width: 2, color: '#7ec9a0' }, itemStyle: { color: '#7ec9a0' } },
    { name: 'p90', type: 'line', smooth: true, data: points.value.map(tr => tr.p90Ms), lineStyle: { width: 2, color: '#e87a7a' }, itemStyle: { color: '#e87a7a' } },
  ],
}))

const requestsOption = computed(() => ({
  tooltip: { trigger: 'axis', backgroundColor: '#1e222d', borderColor: '#2a2f3d', textStyle: { color: '#e5e7eb', fontSize: 12 } },
  grid: { left: 50, right: 20, top: 16, bottom: 24 },
  xAxis: {
    type: 'category',
    data: points.value.map(tr => tr.ts),
    axisLabel: { color: '#6b7280', fontSize: 10 },
    axisLine: { lineStyle: { color: '#2a2f3d' } },
  },
  yAxis: {
    type: 'value',
    axisLabel: { color: '#6b7280', fontSize: 10 },
    splitLine: { lineStyle: { color: '#2a2f3d' } },
  },
  series: [{
    name: 'requests', type: 'bar', data: points.value.map(tr => tr.requests),
    itemStyle: { color: 'rgba(200,144,168,0.6)', borderRadius: [3, 3, 0, 0] },
  }],
}))
</script>

<template>
  <div class="p-6 max-w-6xl mx-auto">
    <h1 class="text-lg font-semibold mb-4">{{ t('psyguard.title') }}</h1>
    <EmptyState
      v-if="!stats"
      icon="shield"
      :title="t('psyguard.loading')"
      :description="t('psyguard.loadingDesc')"
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
        <!-- ⚠️ 指标未采集 → 显示 "—" 而不是 0 (0 会被读成"没调用过") -->
        <n-gi>
          <n-card size="small">
            <n-statistic :label="t('psyguard.p50')" :value="stats.metricsAvailable ? stats.p50Ms : '—'">
              <template #suffix>
                <span class="text-xs text-muted ml-1">{{ stats.metricsAvailable ? 'ms' : t('psyguard.metricsUnavailable') }}</span>
              </template>
            </n-statistic>
          </n-card>
        </n-gi>
        <n-gi>
          <n-card size="small">
            <n-statistic :label="t('psyguard.p90')" :value="stats.metricsAvailable ? stats.p90Ms : '—'">
              <template #suffix>
                <span class="text-xs text-muted ml-1">{{ stats.metricsAvailable ? 'ms' : t('psyguard.metricsUnavailable') }}</span>
              </template>
            </n-statistic>
          </n-card>
        </n-gi>
        <n-gi>
          <n-card size="small">
            <n-statistic :label="t('psyguard.totalRequests')" :value="stats.metricsAvailable ? stats.totalRequests.toLocaleString() : '—'" />
          </n-card>
        </n-gi>
      </n-grid>

      <!-- ⚠️ 指标未采集 → 不画"贴着 0 的假曲线" (那看着像"服务很闲", 实际是"我们没在数") -->
      <n-card v-if="!stats.metricsAvailable" size="small" class="mb-4">
        <div class="text-muted text-sm">
          {{ t('psyguard.metricsUnavailableDesc') }}
        </div>
      </n-card>
      <template v-else>
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
    </template>
  </div>
</template>
