<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/api/client'
import EmptyState from '@/components/EmptyState.vue'

const { t } = useI18n()

// ─── 类型 ───
interface GateDecisionTrace {
  sessionId: string
  turnIndex: number
  mode: 'shadow' | 'effect'
  decision: 'run' | 'skip'
  reason: string
  deltaSummary: Record<string, number>
  thresholdUsed: number
  elapsedMs: number
  timestamp: string
}

interface GateStats {
  total: number
  runCount: number
  skipCount: number
  runRate: number
  reasonDistribution: Record<string, number>
  avgElapsedMs: number
}

// ─── 状态 ───
const traces = ref<GateDecisionTrace[]>([])
const stats = ref<GateStats | null>(null)
const loading = ref(true)
const err = ref('')

// 筛选
const filterSessionId = ref('')
const filterDecision = ref<'' | 'run' | 'skip'>('')
const filterReason = ref('')

// ─── 加载 ───
async function loadData() {
  loading.value = true
  err.value = ''
  try {
    // TODO: 等后端接口好了再对接，现在 mock
    // traces.value = await api.gateDecisions({ sessionId: filterSessionId.value || undefined, decision: filterDecision.value || undefined })
    // stats.value = await api.gateStats({ sessionId: filterSessionId.value || undefined })

    // mock 数据（后端接口好了删掉）
    traces.value = []
    stats.value = null
  } catch (e) {
    err.value = String(e)
  } finally {
    loading.value = false
  }
}

onMounted(loadData)
watch([filterSessionId, filterDecision, filterReason], loadData)

// ─── 计算属性 ───
const filteredTraces = computed(() => {
  let list = traces.value
  if (filterSessionId.value) {
    list = list.filter(t => t.sessionId.includes(filterSessionId.value))
  }
  if (filterDecision.value) {
    list = list.filter(t => t.decision === filterDecision.value)
  }
  if (filterReason.value) {
    list = list.filter(t => t.reason === filterReason.value)
  }
  return list.sort((a, b) => b.turnIndex - a.turnIndex)
})

// ─── 原因中文映射 ───
const reasonLabel: Record<string, string> = {
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
}

function getReasonLabel(reason: string): string {
  return reasonLabel[reason] || reason
}

// ─── 决策标签颜色 ───
function decisionClass(decision: string): string {
  return decision === 'run'
    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
    : 'bg-gray-500/20 text-gray-400 border-gray-500/30'
}

// ─── delta 展示 ───
function formatDelta(delta: Record<string, number>): string {
  return Object.entries(delta)
    .map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v.toFixed(3)}`)
    .join(' · ')
}
</script>

<template>
  <div class="p-6 max-w-7xl mx-auto">
    <!-- 标题 -->
    <div class="mb-6">
      <h1 class="text-2xl font-bold text-gray-100">审议闸门决策</h1>
      <p class="text-sm text-gray-500 mt-1">查看每轮审议闸门的决策记录：为什么跑 / 为什么不跑</p>
    </div>

    <!-- 统计概览 -->
    <div v-if="stats" class="grid grid-cols-4 gap-4 mb-6">
      <div class="bg-gray-800/50 rounded-lg p-4 border border-gray-700/50">
        <div class="text-xs text-gray-500 mb-1">总决策数</div>
        <div class="text-2xl font-bold text-gray-100">{{ stats.total }}</div>
      </div>
      <div class="bg-gray-800/50 rounded-lg p-4 border border-gray-700/50">
        <div class="text-xs text-gray-500 mb-1">跑审议</div>
        <div class="text-2xl font-bold text-emerald-400">{{ stats.runCount }}</div>
      </div>
      <div class="bg-gray-800/50 rounded-lg p-4 border border-gray-700/50">
        <div class="text-xs text-gray-500 mb-1">跳过</div>
        <div class="text-2xl font-bold text-gray-400">{{ stats.skipCount }}</div>
      </div>
      <div class="bg-gray-800/50 rounded-lg p-4 border border-gray-700/50">
        <div class="text-xs text-gray-500 mb-1">触发率</div>
        <div class="text-2xl font-bold text-blue-400">{{ (stats.runRate * 100).toFixed(1) }}%</div>
      </div>
    </div>

    <!-- 筛选栏 -->
    <div class="flex gap-3 mb-4">
      <input
        v-model="filterSessionId"
        placeholder="按 sessionId 筛选..."
        class="bg-gray-800/50 border border-gray-700/50 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500/50 w-64"
      />
      <select
        v-model="filterDecision"
        class="bg-gray-800/50 border border-gray-700/50 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500/50"
      >
        <option value="">全部决策</option>
        <option value="run">跑审议</option>
        <option value="skip">跳过</option>
      </select>
      <select
        v-model="filterReason"
        class="bg-gray-800/50 border border-gray-700/50 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500/50"
      >
        <option value="">全部原因</option>
        <option v-for="(label, key) in reasonLabel" :key="key" :value="key">{{ label }}</option>
      </select>
    </div>

    <!-- 加载/错误/空状态 -->
    <div v-if="loading" class="text-center py-12 text-gray-500">加载中...</div>
    <div v-else-if="err" class="text-center py-12 text-red-400">{{ err }}</div>
    <EmptyState v-else-if="filteredTraces.length === 0" title="暂无闸门决策记录" description="跑几轮对话后，这里会显示每轮的审议闸门决策" />

    <!-- 决策列表 -->
    <div v-else class="space-y-2">
      <div
        v-for="trace in filteredTraces"
        :key="`${trace.sessionId}-${trace.turnIndex}-${trace.mode}`"
        class="bg-gray-800/30 rounded-lg p-4 border border-gray-700/30 hover:border-gray-600/50 transition-colors"
      >
        <div class="flex items-center gap-3 mb-2">
          <span
            class="px-2 py-0.5 rounded text-xs font-medium border"
            :class="decisionClass(trace.decision)"
          >
            {{ trace.decision === 'run' ? '跑审议' : '跳过' }}
          </span>
          <span class="text-xs text-gray-500">轮次 {{ trace.turnIndex }}</span>
          <span class="text-xs text-gray-600">{{ trace.mode === 'shadow' ? '影子' : '生效' }}</span>
          <span class="text-xs text-gray-600 ml-auto">{{ trace.timestamp }}</span>
        </div>
        <div class="text-sm text-gray-300 mb-1">
          <span class="text-gray-500">原因：</span>{{ getReasonLabel(trace.reason) }}
        </div>
        <div class="text-xs text-gray-500">
          <span class="text-gray-600">delta：</span>{{ formatDelta(trace.deltaSummary) }}
        </div>
        <div class="text-xs text-gray-600 mt-1">
          阈值 {{ trace.thresholdUsed.toFixed(3) }} · 耗时 {{ trace.elapsedMs.toFixed(1) }}ms
        </div>
      </div>
    </div>
  </div>
</template>
