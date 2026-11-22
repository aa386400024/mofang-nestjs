<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { use } from 'echarts/core'
import { PieChart, BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import VChart from 'vue-echarts'
import { api } from '@/api/client'
import type { DeliberationStats } from '@/api/types'
import EmptyState from '@/components/EmptyState.vue'
import { NRadioGroup, NRadio, NAlert } from 'naive-ui'

const { t } = useI18n()
use([PieChart, BarChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])

const stats = ref<DeliberationStats | null>(null)
const loading = ref(true)
const err = ref('')

// 时间范围: 7 = 最近 7 天, 30 = 最近 30 天, 0 = 累计
const days = ref<number>(7)

async function loadStats() {
  loading.value = true
  err.value = ''
  try {
    stats.value = await api.deliberationStats(days.value === 0 ? undefined : days.value)
  } catch (e) {
    err.value = String(e)
  } finally {
    loading.value = false
  }
}

onMounted(loadStats)
watch(days, loadStats)

// ─── 百分比格式化 ───
const pct = (v: number) => (v * 100).toFixed(1) + '%'

// ─── 失败原因分布饼图 ───
const failurePie = computed(() => {
  if (!stats.value) return null
  const entries = Object.entries(stats.value.failureByErrorCode)
  if (entries.length === 0) return null
  return {
    tooltip: { trigger: 'item', backgroundColor: '#1e222d', borderColor: '#2a2f3d', textStyle: { color: '#e5e7eb', fontSize: 12 } },
    legend: { textStyle: { color: '#9ca3af', fontSize: 11 }, bottom: 0 },
    series: [{
      type: 'pie',
      radius: ['40%', '70%'],
      center: ['50%', '45%'],
      data: entries.map(([name, value]) => ({ name, value })),
      label: { color: '#9ca3af', fontSize: 11 },
      itemStyle: { borderColor: '#161922', borderWidth: 2 },
    }],
  }
})

// ─── 被砍维度分布柱状图 ───
const capBar = computed(() => {
  if (!stats.value) return null
  const entries = Object.entries(stats.value.capByDimension)
  if (entries.length === 0) return null
  return {
    tooltip: { trigger: 'axis', backgroundColor: '#1e222d', borderColor: '#2a2f3d', textStyle: { color: '#e5e7eb', fontSize: 12 } },
    grid: { left: 60, right: 20, top: 20, bottom: 30 },
    xAxis: {
      type: 'category',
      data: entries.map(([name]) => name),
      axisLabel: { color: '#6b7280', fontSize: 10, rotate: 30 },
      axisLine: { lineStyle: { color: '#2a2f3d' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#6b7280', fontSize: 10 },
      splitLine: { lineStyle: { color: '#2a2f3d' } },
    },
    series: [{
      type: 'bar',
      data: entries.map(([, value]) => value),
      itemStyle: { color: 'rgba(232,200,122,0.7)', borderRadius: [3, 3, 0, 0] },
    }],
  }
})

// ─── 临床 flagged 分布 ───
const clinicalEntries = computed(() => {
  if (!stats.value) return []
  return Object.entries(stats.value.clinicalByRule)
})
</script>

<template>
  <div class="p-6 max-w-6xl mx-auto">
    <!-- 标题 + 时间选择器 -->
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-xl font-semibold">审议统计</h1>
        <p class="text-sm text-muted mt-1">审议引擎运行状态、成功率和耗时分布</p>
      </div>
      <NRadioGroup v-model:value="days" size="small">
        <NRadio :value="7">最近 7 天</NRadio>
        <NRadio :value="30">最近 30 天</NRadio>
        <NRadio :value="0">累计</NRadio>
      </NRadioGroup>
    </div>

    <!-- 三态 -->
    <EmptyState v-if="loading" icon="chart" title="加载中…" description="正在获取审议统计数据" />
    <EmptyState
      v-else-if="err"
      icon="warning"
      title="加载失败"
      :description="err"
      retry-text="重试"
      @retry="loadStats"
    />
    <EmptyState
      v-else-if="!stats || stats.totalTurns === 0"
      icon="chart"
      title="暂无审议数据"
      description="完成几场对练后，这里会展示审议统计和质量指标"
    />

    <template v-else>
      <!-- 窗口口径提示 -->
      <NAlert v-if="stats.window.mode !== 'all'" type="info" :show-icon="true" class="text-xs mb-4">
        当前显示最近 {{ stats.window.days }} 天的数据，其中 {{ stats.window.daysCovered }} 天有数据
      </NAlert>

      <!-- 第一行：核心指标 -->
      <div class="grid grid-cols-4 gap-4 mb-4">
        <div class="card p-4">
          <div class="text-xs text-muted mb-1">总审议轮次</div>
          <div class="text-2xl font-mono font-semibold">{{ stats.totalTurns }}</div>
        </div>
        <div class="card p-4">
          <div class="text-xs text-muted mb-1">成功率</div>
          <div
            class="text-2xl font-mono font-semibold"
            :class="stats.successRate > 0.9 ? 'text-ok' : stats.successRate > 0.7 ? 'text-warn' : 'text-error'"
          >
            {{ pct(stats.successRate) }}
          </div>
        </div>
        <div class="card p-4">
          <div class="text-xs text-muted mb-1">平均耗时</div>
          <div class="text-2xl font-mono font-semibold">{{ Math.round(stats.avgDurationMs) }} ms</div>
        </div>
        <div class="card p-4">
          <div class="text-xs text-muted mb-1">P95 耗时</div>
          <div class="text-2xl font-mono font-semibold">{{ Math.round(stats.p95DurationMs) }} ms</div>
        </div>
      </div>

      <!-- 第二行：质量指标 -->
      <div class="grid grid-cols-4 gap-4 mb-6">
        <div class="card p-4">
          <div class="text-xs text-muted mb-1">最大耗时</div>
          <div class="text-xl font-mono font-semibold">{{ Math.round(stats.maxDurationMs) }} ms</div>
        </div>
        <div class="card p-4">
          <div class="text-xs text-muted mb-1">过期率</div>
          <div
            class="text-xl font-mono font-semibold"
            :class="stats.staleRate > 0.1 ? 'text-warn' : ''"
          >
            {{ pct(stats.staleRate) }}
          </div>
        </div>
        <div class="card p-4">
          <div class="text-xs text-muted mb-1">平均 Delta 偏差</div>
          <div class="text-xl font-mono font-semibold">{{ stats.avgDeltaDiffAbs.toFixed(3) }}</div>
        </div>
        <div class="card p-4">
          <div class="text-xs text-muted mb-1">Flagged 率</div>
          <div class="text-xl font-mono font-semibold">{{ pct(stats.flaggedTurnRate) }}</div>
        </div>
      </div>

      <!-- 闸门决策入口 -->
      <div class="mb-4">
        <RouterLink to="/gate-decisions" class="inline-flex items-center gap-2 text-sm text-accent hover:underline">
          查看闸门决策详情 →
        </RouterLink>
      </div>

      <!-- 第三行：图表 -->
      <div class="grid grid-cols-2 gap-4 mb-6">
        <div class="card p-4">
          <h3 class="text-sm font-medium mb-3">失败原因分布</h3>
          <VChart v-if="failurePie" :option="failurePie" :autoresize="true" class="h-64" />
          <div v-else class="h-64 flex items-center justify-center text-muted text-sm">
            暂无失败记录
          </div>
        </div>
        <div class="card p-4">
          <h3 class="text-sm font-medium mb-3">被砍维度分布</h3>
          <VChart v-if="capBar" :option="capBar" :autoresize="true" class="h-64" />
          <div v-else class="h-64 flex items-center justify-center text-muted text-sm">
            暂无被砍记录
          </div>
        </div>
      </div>

      <!-- 第四行：明细 -->
      <div class="grid grid-cols-2 gap-4">
        <div class="card p-4">
          <h3 class="text-sm font-medium mb-3">临床 Flagged 规则</h3>
          <div v-if="clinicalEntries.length > 0" class="space-y-2 py-2">
            <div v-for="[rule, count] in clinicalEntries" :key="rule" class="flex items-center justify-between text-sm">
              <span class="text-muted font-mono text-xs">{{ rule }}</span>
              <span class="font-mono font-semibold">{{ count }}</span>
            </div>
          </div>
          <div v-else class="py-8 text-center text-muted text-sm">
            暂无临床 flagged
          </div>
        </div>
        <div class="card p-4">
          <h3 class="text-sm font-medium mb-3">Token 消耗</h3>
          <div class="space-y-3 py-2">
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted">平均 Prompt Tokens</span>
              <span class="font-mono font-semibold">{{ Math.round(stats.avgPromptTokens) }}</span>
            </div>
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted">平均 Completion Tokens</span>
              <span class="font-mono font-semibold">{{ Math.round(stats.avgCompletionTokens) }}</span>
            </div>
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted">平均重试次数</span>
              <span class="font-mono font-semibold">{{ stats.avgRetryCount.toFixed(2) }}</span>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
