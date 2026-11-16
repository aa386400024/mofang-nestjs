<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NTag, NSelect, NDatePicker } from 'naive-ui'
import { use } from 'echarts/core'
import { BarChart, LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import VChart from 'vue-echarts'
import { api } from '@/api/client'
import type { GateTraceRecord, GateReason, GateStatsResponse } from '@/api/types'
import EmptyState from '@/components/EmptyState.vue'
import InfoTooltip from '@/components/InfoTooltip.vue'
import Skeleton from '@/components/Skeleton.vue'

const { t } = useI18n()
use([BarChart, LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])

// ─── 状态 ───
const traces = ref<GateTraceRecord[]>([])
const total = ref(0)
const loading = ref(true)
const err = ref('')
const expandedId = ref<number | null>(null)
const stats = ref<GateStatsResponse | null>(null)

// 筛选
const filterSessionId = ref('')
const filterDecision = ref<'' | 'run' | 'skip'>(null as any)
const filterMode = ref<'' | 'shadow' | 'effect'>(null as any)
const filterReasons = ref<GateReason[]>([])
const filterDateRange = ref<[number, number] | null>(null)
const page = ref(1)
const pageSize = 20

// ─── reason 中文映射（12 个枚举，后端恒含全量）───
const reasonLabel: Record<GateReason, string> = {
  crisis_skip: '危机跳过（合规红线）',
  first_turn_baseline: '首轮基线',
  key_event: '关键事件硬触发',
  cooldown: '冷却期',
  quota_exceeded: '配额超限',
  circuit_open: '熔断中',
  unknown_event_type: '未知事件类型',
  alliance_delta_high: '同盟维度变化大',
  resistance_delta_high: '阻抗维度变化大',
  calm_turn: '平静对话',
  rule_confident: '规则置信',
  gate_error: '闸门异常（自动放行）',
}

const reasonOptions = (Object.keys(reasonLabel) as GateReason[]).map(r => ({
  label: reasonLabel[r],
  value: r,
}))

// ─── 加载 ───
async function loadTraces() {
  loading.value = true
  err.value = ''
  try {
    const startDate = filterDateRange.value
      ? new Date(filterDateRange.value[0]).toISOString().slice(0, 10)
      : undefined
    const endDate = filterDateRange.value
      ? new Date(filterDateRange.value[1]).toISOString().slice(0, 10)
      : undefined
    const res = await api.gateTraces({
      page: page.value,
      pageSize,
      sessionId: filterSessionId.value || undefined,
      decision: filterDecision.value || undefined,
      mode: filterMode.value || undefined,
      reason: filterReasons.value.length ? filterReasons.value.join(',') : undefined,
      startDate,
      endDate,
    })
    traces.value = res.items
    total.value = res.total
  } catch (e) {
    err.value = String(e)
  } finally {
    loading.value = false
  }
}

async function loadStats() {
  try {
    stats.value = await api.gateStats(7)
  } catch {
    stats.value = null
  }
}

onMounted(() => {
  loadTraces()
  loadStats()
})
watch([filterSessionId, filterDecision, filterMode, filterReasons, filterDateRange], () => {
  page.value = 1
  loadTraces()
})
watch(page, loadTraces)

// ─── 顶部汇总（来自 /gate/stats?days=7，真实服务端数字）───
const summary = computed(() => {
  const s = stats.value
  if (!s || s.dates.length === 0) {
    return { total: 0, run: 0, skip: 0, runRate: 0, effectShare: 0 }
  }
  const total = s.totalDecisions.reduce((a, b) => a + b, 0)
  const run = s.runDecisions.reduce((a, b) => a + b, 0)
  const skip = s.skipDecisions.reduce((a, b) => a + b, 0)
  const effect = s.byMode.effect.reduce((a, b) => a + b, 0)
  return {
    total,
    run,
    skip,
    runRate: total ? run / total : 0,
    effectShare: total ? effect / total : 0,
  }
})

// ─── 按天趋势图 ───
const trendChart = computed(() => {
  const s = stats.value
  if (!s) return {}
  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1e222d',
      borderColor: '#2a2f3d',
      textStyle: { color: '#e5e7eb', fontSize: 12 },
    },
    legend: {
      textStyle: { color: '#9ca3af', fontSize: 11 },
      top: 0,
      data: ['跑审议', '跳过'],
    },
    grid: { left: 40, right: 16, top: 36, bottom: 24 },
    xAxis: {
      type: 'category',
      data: s.dates.map(d => d.slice(5)),
      axisLabel: { color: '#6b7280', fontSize: 10 },
      axisLine: { lineStyle: { color: '#2a2f3d' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#6b7280', fontSize: 10 },
      splitLine: { lineStyle: { color: '#2a2f3d' } },
    },
    series: [
      {
        name: '跑审议',
        type: 'bar',
        stack: 'total',
        data: s.runDecisions,
        itemStyle: { color: '#5eb88a', borderRadius: [0, 0, 0, 0] },
      },
      {
        name: '跳过',
        type: 'bar',
        stack: 'total',
        data: s.skipDecisions,
        itemStyle: { color: '#e8c87a', borderRadius: [3, 3, 0, 0] },
      },
    ],
  }
})

// ─── 决策标签颜色 ───
function decisionTagType(decision: 'run' | 'skip'): 'success' | 'default' {
  return decision === 'run' ? 'success' : 'default'
}
function modeTagType(mode: 'shadow' | 'effect'): 'info' | 'warning' {
  return mode === 'shadow' ? 'info' : 'warning'
}

// ─── 展开/收起 ───
function toggleExpand(id: number) {
  expandedId.value = expandedId.value === id ? null : id
}

// ─── 时间格式化 ───
function formatTime(iso: string): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return iso
  }
}

// ─── delta 格式化 ───
function formatDelta(delta: Record<string, number> | null): string {
  if (!delta) return '—'
  return Object.entries(delta)
    .map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v.toFixed(3)}`)
    .join(' · ')
}
</script>

<template>
  <div class="p-6 max-w-7xl mx-auto">
    <!-- 标题 -->
    <div class="mb-6">
      <h1 class="text-lg font-semibold text-gray-100">审议闸门决策</h1>
      <p class="text-xs text-muted mt-1">
        每轮审议闸门的决策记录：为什么跑 / 为什么不跑。列表与详情查 MySQL 永久库，趋势查 Redis 写时计数器（90 天）。
      </p>
    </div>

    <!-- 顶部汇总（近 7 天真实数字）-->
    <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
      <div class="card p-4">
        <div class="text-[10px] uppercase tracking-wider text-muted mb-1 flex items-center">
          近 7 天决策数
          <InfoTooltip text="来自 /gate/stats，含 shadow + effect 两条/轮" />
        </div>
        <div class="font-mono text-lg text-gray-100">{{ summary.total }}</div>
      </div>
      <div class="card p-4">
        <div class="text-[10px] uppercase tracking-wider text-muted mb-1">跑审议</div>
        <div class="font-mono text-lg text-emerald-400">{{ summary.run }}</div>
      </div>
      <div class="card p-4">
        <div class="text-[10px] uppercase tracking-wider text-muted mb-1">跳过</div>
        <div class="font-mono text-lg text-gray-300">{{ summary.skip }}</div>
      </div>
      <div class="card p-4">
        <div class="text-[10px] uppercase tracking-wider text-muted mb-1">触发率</div>
        <div class="font-mono text-lg text-blue-400">{{ (summary.runRate * 100).toFixed(1) }}%</div>
      </div>
      <div class="card p-4">
        <div class="text-[10px] uppercase tracking-wider text-muted mb-1">生效模式占比</div>
        <div class="font-mono text-lg text-amber-400">{{ (summary.effectShare * 100).toFixed(1) }}%</div>
      </div>
    </div>

    <!-- 按天趋势图 -->
    <div v-if="stats && stats.dates.length > 0" class="card p-4 mb-4">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-xs uppercase tracking-wider text-muted">近 7 天决策趋势</h2>
        <div class="text-xs text-muted">堆叠：跑 / 跳过</div>
      </div>
      <VChart :option="trendChart" :autoresize="true" style="height: 220px" />
    </div>

    <!-- 筛选栏 -->
    <div class="flex flex-wrap gap-3 mb-4 items-center">
      <n-input
        v-model:value="filterSessionId"
        placeholder="按 sessionId 筛选（双口径）"
        size="small"
        clearable
        class="w-64"
      />
      <NSelect
        v-model:value="filterDecision"
        :options="[
          { label: '全部决策', value: '' },
          { label: '跑审议', value: 'run' },
          { label: '跳过', value: 'skip' },
        ]"
        size="small"
        class="w-32"
      />
      <NSelect
        v-model:value="filterMode"
        :options="[
          { label: '全部模式', value: '' },
          { label: '影子', value: 'shadow' },
          { label: '生效', value: 'effect' },
        ]"
        size="small"
        class="w-32"
      />
      <NSelect
        v-model:value="filterReasons"
        :options="reasonOptions"
        multiple
        size="small"
        placeholder="按原因筛选"
        class="w-56"
      />
      <NDatePicker
        v-model:value="filterDateRange"
        type="daterange"
        size="small"
        clearable
        class="w-56"
      />
    </div>

    <!-- 加载/错误/空态 -->
    <Skeleton v-if="loading" type="card-list" :count="5" />
    <EmptyState
      v-else-if="err"
      icon="warning"
      title="加载失败"
      :description="err"
      retry-text="重试"
      @retry="loadTraces"
    />
    <EmptyState
      v-else-if="traces.length === 0"
      icon="shield"
      title="暂无闸门决策记录"
      description="跑几轮对话后，这里会显示每轮的审议闸门决策"
    />

    <!-- 决策列表 -->
    <div v-else class="space-y-2">
      <div
        v-for="trace in traces"
        :key="trace.id"
        class="card p-0 cursor-pointer hover:border-accent/40 transition-colors"
        @click="toggleExpand(trace.id)"
      >
        <!-- 头部行 -->
        <div class="flex items-center gap-3 px-4 py-3">
          <NTag :type="decisionTagType(trace.decision)" size="small" bordered="false">
            {{ trace.decision === 'run' ? '跑审议' : '跳过' }}
          </NTag>
          <NTag :type="modeTagType(trace.mode)" size="small" bordered="false">
            {{ trace.mode === 'shadow' ? '影子' : '生效' }}
          </NTag>
          <span class="text-xs text-muted">轮次 {{ trace.turnIndex }}</span>
          <span class="text-sm text-gray-300">{{ reasonLabel[trace.reason] || trace.reason }}</span>
          <span class="text-xs text-muted ml-auto">{{ formatTime(trace.recordedAt) }}</span>
          <n-icon size="12" class="text-muted transition-transform" :class="{ 'rotate-180': expandedId === trace.id }">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </n-icon>
        </div>

        <!-- 展开详情 -->
        <div v-if="expandedId === trace.id" class="px-4 pb-4 pt-0 border-t border-border">
          <div class="grid grid-cols-2 gap-4 pt-3 text-sm">
            <div>
              <div class="text-xs text-muted mb-1">引擎 sessionId</div>
              <div class="text-gray-300 font-mono text-xs break-all">{{ trace.sessionId }}</div>
            </div>
            <div>
              <div class="text-xs text-muted mb-1">落库 dbSessionId</div>
              <div class="text-gray-300 font-mono text-xs break-all">
                {{ trace.dbSessionId ?? '—' }}
              </div>
            </div>
            <div>
              <div class="text-xs text-muted mb-1">记录 id</div>
              <div class="text-gray-300 font-mono text-xs">{{ trace.id }}</div>
            </div>
            <div>
              <div class="text-xs text-muted mb-1">判定耗时</div>
              <div class="text-gray-300">{{ trace.elapsedMs.toFixed(1) }} ms</div>
            </div>
            <div class="col-span-2">
              <div class="text-xs text-muted mb-1">阈值（同盟 / 阻抗 / 平静）</div>
              <div class="text-gray-300 font-mono text-xs">
                {{ trace.thresholdUsed.alliance.toFixed(3) }} /
                {{ trace.thresholdUsed.resistance.toFixed(3) }} /
                {{ trace.thresholdUsed.calm.toFixed(3) }}
              </div>
            </div>
            <div class="col-span-2">
              <div class="text-xs text-muted mb-1">Delta 摘要</div>
              <div class="text-gray-300 text-xs">{{ formatDelta(trace.deltaSummary) }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 分页 -->
    <div v-if="total > pageSize" class="flex justify-center mt-6">
      <n-pagination
        v-model:page="page"
        :page-count="Math.ceil(total / pageSize)"
        size="small"
      />
    </div>
  </div>
</template>
