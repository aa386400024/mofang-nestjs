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
  <div class="p-6 max-w-6xl mx-auto space-y-6">
    <!-- 标题 + 时间选择器 -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-lg font-semibold">{{ t('deliberation.title') }}</h1>
        <p class="text-sm text-muted mt-1">{{ t('deliberation.subtitle') }}</p>
      </div>
      <n-radio-group v-model:value="days" size="small">
        <n-radio :value="7">最近 7 天</n-radio>
        <n-radio :value="30">最近 30 天</n-radio>
        <n-radio :value="0">累计</n-radio>
      </n-radio-group>
    </div>

    <!-- 窗口口径提示 -->
    <n-alert v-if="stats && stats.window.mode !== 'all'" type="info" :show-icon="true" class="text-xs">
      当前显示最近 {{ stats.window.days }} 天的数据，其中 {{ stats.window.daysCovered }} 天有数据
      （日 key 从 2026-11-08 才开始记录，之前的历史数据只有累计值）
    </n-alert>

    <!-- 加载 / 错误 / 空态 -->
    <div v-if="loading" class="text-center py-20 text-muted text-sm">
      {{ t('deliberation.loading') }}
    </div>
    <div v-else-if="err" class="text-center py-20 text-error text-sm">
      {{ t('deliberation.error') }}: {{ err }}
    </div>
    <EmptyState v-else-if="!stats || stats.totalTurns === 0"
      :title="t('deliberation.emptyTitle')"
      :desc="t('deliberation.emptyDesc')" />

    <!-- 数据面板 -->
    <template v-else>
      <!-- 汇总卡片 -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <n-card size="small">
          <div class="text-xs text-muted">{{ t('deliberation.totalTurns') }}</div>
          <div class="text-2xl font-semibold mt-1 font-mono">{{ stats.totalTurns }}</div>
        </n-card>
        <n-card size="small">
          <div class="text-xs text-muted">{{ t('deliberation.successRate') }}</div>
          <div class="text-2xl font-semibold mt-1 font-mono" :class="stats.successRate > 0.9 ? 'text-ok' : stats.successRate > 0.7 ? 'text-warning' : 'text-error'">
            {{ pct(stats.successRate) }}
          </div>
        </n-card>
        <n-card size="small">
          <div class="text-xs text-muted">{{ t('deliberation.avgDuration') }}</div>
          <div class="text-2xl font-semibold mt-1 font-mono">{{ Math.round(stats.avgDurationMs) }} ms</div>
        </n-card>
        <n-card size="small">
          <div class="text-xs text-muted">{{ t('deliberation.p95Duration') }}</div>
          <div class="text-2xl font-semibold mt-1 font-mono">{{ Math.round(stats.p95DurationMs) }} ms</div>
        </n-card>
      </div>

      <!-- 闸门决策入口（WP-C） -->
      <div class="mt-4 mb-2">
        <RouterLink to="/gate-decisions" class="inline-flex items-center gap-2 text-sm text-accent hover:underline">
          查看闸门决策详情 →
        </RouterLink>
      </div>

      <!-- 第二行：耗时 + 过期率 -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <n-card size="small">
          <div class="text-xs text-muted">{{ t('deliberation.maxDuration') }}</div>
          <div class="text-xl font-semibold mt-1 font-mono">{{ Math.round(stats.maxDurationMs) }} ms</div>
        </n-card>
        <n-card size="small">
          <div class="text-xs text-muted">{{ t('deliberation.staleRate') }}</div>
          <div class="text-xl font-semibold mt-1 font-mono" :class="stats.staleRate > 0.1 ? 'text-warning' : ''">
            {{ pct(stats.staleRate) }}
          </div>
        </n-card>
        <n-card size="small">
          <div class="text-xs text-muted">{{ t('deliberation.avgDeltaDiff') }}</div>
          <div class="text-xl font-semibold mt-1 font-mono">{{ stats.avgDeltaDiffAbs.toFixed(3) }}</div>
        </n-card>
        <n-card size="small">
          <div class="text-xs text-muted">{{ t('deliberation.flaggedRate') }}</div>
          <div class="text-xl font-semibold mt-1 font-mono">{{ pct(stats.flaggedTurnRate) }}</div>
        </n-card>
      </div>

      <!-- 第三行：失败原因 + 被砍维度 -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <n-card size="small">
          <template #header>{{ t('deliberation.failureByReason') }}</template>
          <v-chart v-if="failurePie" :option="failurePie" class="h-64" />
          <div v-else class="h-64 flex items-center justify-center text-muted text-sm">
            {{ t('deliberation.noFailures') }}
          </div>
        </n-card>
        <n-card size="small">
          <template #header>{{ t('deliberation.capByDimension') }}</template>
          <v-chart v-if="capBar" :option="capBar" class="h-64" />
          <div v-else class="h-64 flex items-center justify-center text-muted text-sm">
            {{ t('deliberation.noCapped') }}
          </div>
        </n-card>
      </div>

      <!-- 第四行：临床 flagged + token 消耗 -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <n-card size="small">
          <template #header>{{ t('deliberation.clinicalByRule') }}</template>
          <div v-if="clinicalEntries.length > 0" class="space-y-2 py-2">
            <div v-for="[rule, count] in clinicalEntries" :key="rule" class="flex items-center justify-between text-sm">
              <span class="text-muted font-mono text-xs">{{ rule }}</span>
              <span class="font-mono font-semibold">{{ count }}</span>
            </div>
          </div>
          <div v-else class="py-8 text-center text-muted text-sm">
            {{ t('deliberation.noClinicalFlags') }}
          </div>
        </n-card>
        <n-card size="small">
          <template #header>{{ t('deliberation.tokenUsage') }}</template>
          <div class="space-y-3 py-2">
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted">{{ t('deliberation.avgPromptTokens') }}</span>
              <span class="font-mono font-semibold">{{ Math.round(stats.avgPromptTokens) }}</span>
            </div>
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted">{{ t('deliberation.avgCompletionTokens') }}</span>
              <span class="font-mono font-semibold">{{ Math.round(stats.avgCompletionTokens) }}</span>
            </div>
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted">{{ t('deliberation.avgRetryCount') }}</span>
              <span class="font-mono font-semibold">{{ stats.avgRetryCount.toFixed(2) }}</span>
            </div>
          </div>
        </n-card>
      </div>

      <!-- 底部说明 -->
      <n-alert type="info" :show-icon="true" class="text-xs">
        {{ t('deliberation.note') }}
      </n-alert>
    </template>
  </div>
</template>
