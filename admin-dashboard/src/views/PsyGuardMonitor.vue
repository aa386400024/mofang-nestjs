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
const loading = ref(true)
const err = ref('')

async function loadData() {
  loading.value = true
  err.value = ''
  try {
    const [s, tr] = await Promise.all([api.psyguard(), api.psyguardTrend()])
    stats.value = s
    trend.value = tr
  } catch (e) {
    err.value = String(e)
  } finally {
    loading.value = false
  }
}

onMounted(loadData)

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

// ─── 风险类别百分比 ───
const riskCategories = computed(() => {
  if (!stats.value || !stats.value.totalRequests) return []
  return Object.entries(stats.value.byCategory as Record<string, number>)
    .map(([cat, count]) => ({
      cat,
      label: riskLabel(cat),
      desc: riskDesc(cat),
      count,
      pct: ((count / stats.value!.totalRequests) * 100).toFixed(1),
    }))
    .sort((a, b) => b.count - a.count)
})
</script>

<template>
  <div class="p-6 max-w-6xl mx-auto">
    <!-- 页面标题 -->
    <div class="mb-6">
      <h1 class="text-xl font-semibold">PsyGuard 监控</h1>
      <p class="text-sm text-muted mt-1">危机识别模型运行状态、延迟和命中分布</p>
    </div>

    <!-- 三态 -->
    <EmptyState v-if="loading" icon="shield" title="加载中…" description="正在获取 PsyGuard 监控数据" />
    <EmptyState
      v-else-if="err"
      icon="warning"
      title="加载失败"
      :description="err"
      retry-text="重试"
      @retry="loadData"
    />
    <EmptyState
      v-else-if="!stats"
      icon="shield"
      title="暂无数据"
      description="PsyGuard 服务尚未产生数据"
    />

    <template v-else>
      <!-- 统计卡片 -->
      <div class="grid grid-cols-4 gap-4 mb-6">
        <div class="card p-4">
          <div class="text-xs text-muted mb-1">服务状态</div>
          <div class="flex items-center gap-2 mt-1">
            <span class="w-2.5 h-2.5 rounded-full" :class="stats.status === 'ok' ? 'bg-ok' : 'bg-warn'"></span>
            <span class="font-mono text-lg">{{ stats.status === 'ok' ? '运行中' : '降级' }}</span>
          </div>
        </div>
        <div class="card p-4">
          <div class="text-xs text-muted mb-1">P50 延迟</div>
          <div class="text-2xl font-mono font-semibold">{{ stats.metricsAvailable ? stats.p50Ms : '—' }}</div>
          <div class="text-xs text-muted mt-1">{{ stats.metricsAvailable ? 'ms' : '未采集' }}</div>
        </div>
        <div class="card p-4">
          <div class="text-xs text-muted mb-1">P90 延迟</div>
          <div class="text-2xl font-mono font-semibold">{{ stats.metricsAvailable ? stats.p90Ms : '—' }}</div>
          <div class="text-xs text-muted mt-1">{{ stats.metricsAvailable ? 'ms' : '未采集' }}</div>
        </div>
        <div class="card p-4">
          <div class="text-xs text-muted mb-1">总请求数</div>
          <div class="text-2xl font-mono font-semibold">{{ stats.metricsAvailable ? stats.totalRequests.toLocaleString() : '—' }}</div>
        </div>
      </div>

      <!-- 指标未采集提示 -->
      <div v-if="!stats.metricsAvailable" class="card p-4 mb-6 text-muted text-sm">
        指标数据尚未采集，可能是服务刚启动或尚未配置监控埋点。
      </div>

      <template v-else>
        <!-- 延迟趋势图 -->
        <div class="card p-4 mb-6">
          <h3 class="text-sm font-medium mb-3">延迟趋势</h3>
          <VChart :option="latencyOption" :autoresize="true" style="height: 240px" />
        </div>

        <div class="grid grid-cols-2 gap-4">
          <!-- 请求量柱状图 -->
          <div class="card p-4">
            <h3 class="text-sm font-medium mb-3">每日请求量</h3>
            <VChart :option="requestsOption" :autoresize="true" style="height: 200px" />
          </div>

          <!-- 风险类别分布 -->
          <div class="card p-4">
            <h3 class="text-sm font-medium mb-3">风险类别分布</h3>
            <div class="space-y-3">
              <div v-for="item in riskCategories" :key="item.cat" class="flex items-center gap-3">
                <span class="text-xs w-24 text-gray-300">{{ item.label }}</span>
                <div class="flex-1 h-2 bg-bg-elevated rounded-full overflow-hidden">
                  <div
                    class="h-full rounded-full bg-accent/60"
                    :style="{ width: Math.min(100, parseFloat(item.pct) * 5) + '%' }"
                  ></div>
                </div>
                <span class="text-xs font-mono text-muted w-12 text-right">{{ item.count }}</span>
              </div>
            </div>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>
