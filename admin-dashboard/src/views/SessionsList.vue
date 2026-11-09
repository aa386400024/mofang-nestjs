<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { NInput, NSelect, NPagination, NTag } from 'naive-ui'
import { api } from '@/api/client'
import type { SessionSummary } from '@/api/types'
import EmptyState from '@/components/EmptyState.vue'
import Skeleton from '@/components/Skeleton.vue'

const router = useRouter()
const rows = ref<SessionSummary[]>([])
const loading = ref(true)
const err = ref('')

// ─── 搜索 & 筛选 ───
const searchQuery = ref('')
const statusFilter = ref<string>('all')

// ─── 分页 ───
const page = ref(1)
const pageSize = 10

onMounted(async () => {
  try { rows.value = await api.sessions(100) }
  catch (e) { err.value = String(e) }
  finally { loading.value = false }
})

const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
const fmtTime = (iso: string | null) => iso ? new Date(iso).toLocaleString('zh-CN', {
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
}) : '—'

// ─── 状态映射 ───
const statusMap: Record<string, { label: string; type: 'success' | 'warning' | 'error' | 'default'; color: string }> = {
  completed: { label: '已完成', type: 'success', color: '#3d9a6e' },
  active: { label: '进行中', type: 'warning', color: '#b88a3a' },
  no_content: { label: '空局', type: 'default', color: '#9ca3af' },
  parse_error: { label: '解析错误', type: 'error', color: '#c85a5a' },
}

// ─── 统计 ───
const stats = computed(() => {
  const total = rows.value.length
  const tokens = rows.value.reduce((a, r) => a + r.totalTokens, 0)
  const avgDur = total ? Math.round(rows.value.reduce((a, r) => a + r.durationSec, 0) / total) : 0
  const done = rows.value.filter(r => r.status === 'completed').length
  const noContent = rows.value.filter(r => r.status === 'no_content').length
  return {
    total,
    done,
    doneRate: total ? ((done / total) * 100).toFixed(1) + '%' : '—',
    noContent,
    tokens,
    avgDur,
  }
})

// ─── 筛选 & 搜索后的列表 ───
const filteredRows = computed(() => {
  let result = rows.value

  // 状态筛选
  if (statusFilter.value !== 'all') {
    result = result.filter(r => r.status === statusFilter.value)
  }

  // 搜索
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(r =>
      r.visitorAlias?.toLowerCase().includes(q) ||
      r.sessionId.toLowerCase().includes(q)
    )
  }

  return result
})

// ─── 分页后的列表 ───
const pagedRows = computed(() => {
  const start = (page.value - 1) * pageSize
  return filteredRows.value.slice(start, start + pageSize)
})

// 切换筛选时重置页码
function resetPage() {
  page.value = 1
}
</script>

<template>
  <div class="p-6 max-w-6xl mx-auto">
    <!-- 页面标题 -->
    <div class="mb-6">
      <h1 class="text-xl font-semibold">会话列表</h1>
      <p class="text-sm text-muted mt-1">所有咨询师训练会话记录，支持搜索和筛选</p>
    </div>

    <!-- 三态：加载 / 错误 / 空 -->
    <Skeleton v-if="loading" type="card-list" :count="5" />
    <EmptyState v-else-if="err" icon="warning" title="加载失败" :description="err" retry-text="重试" @retry="onMounted" />
    <EmptyState
      v-else-if="!rows.length"
      icon="list"
      title="暂无会话记录"
      description="完成第一场对练后，这里会展示会话列表、Token 消耗和时长统计。"
      pendingTag="等待第一场对练数据"
    />

    <template v-else>
      <!-- 统计卡片 -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div class="card p-4">
          <div class="text-xs text-muted mb-1">总会话数</div>
          <div class="text-2xl font-mono font-semibold">{{ stats.total }}</div>
        </div>
        <div class="card p-4">
          <div class="text-xs text-muted mb-1">完成率</div>
          <div class="text-2xl font-mono font-semibold text-ok">{{ stats.doneRate }}</div>
          <div class="text-xs text-muted mt-1">{{ stats.done }} / {{ stats.total }} 已完成</div>
        </div>
        <div class="card p-4">
          <div class="text-xs text-muted mb-1">总 Token 消耗</div>
          <div class="text-2xl font-mono font-semibold">{{ stats.tokens.toLocaleString() }}</div>
        </div>
        <div class="card p-4">
          <div class="text-xs text-muted mb-1">平均时长</div>
          <div class="text-2xl font-mono font-semibold">{{ fmtDur(stats.avgDur) }}</div>
        </div>
      </div>

      <!-- 工具栏：搜索 + 筛选 -->
      <div class="flex items-center gap-3 mb-4">
        <NInput
          v-model:value="searchQuery"
          placeholder="搜索访客名 / 会话 ID…"
          clearable
          class="w-64"
          @update:value="resetPage"
        />
        <NSelect
          v-model:value="statusFilter"
          :options="[
            { label: '全部状态', value: 'all' },
            { label: '已完成', value: 'completed' },
            { label: '进行中', value: 'active' },
            { label: '空局', value: 'no_content' },
            { label: '解析错误', value: 'parse_error' },
          ]"
          class="w-40"
          @update:value="resetPage"
        />
        <div class="ml-auto text-sm text-muted">
          共 {{ filteredRows.length }} 条
        </div>
      </div>

      <!-- 会话卡片列表 -->
      <div class="space-y-3">
        <div
          v-for="row in pagedRows"
          :key="row.sessionId"
          class="card p-4 hover:bg-bg-elevated cursor-pointer transition-colors"
          @click="router.push(`/sessions/${row.sessionId}`)"
        >
          <div class="flex items-center justify-between">
            <!-- 左：访客名 + 时间 -->
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center text-accent font-medium">
                {{ row.visitorAlias?.slice(0, 1)?.toUpperCase() || '?' }}
              </div>
              <div>
                <div class="font-medium">{{ row.visitorAlias || '未命名访客' }}</div>
                <div class="text-xs text-muted">{{ fmtTime(row.startedAt) }}</div>
              </div>
            </div>

            <!-- 右：状态 + 指标 -->
            <div class="flex items-center gap-4">
              <div class="text-right">
                <div class="text-sm font-mono">{{ fmtDur(row.durationSec) }}</div>
                <div class="text-xs text-muted">时长</div>
              </div>
              <div class="text-right">
                <div class="text-sm font-mono">{{ row.totalTokens.toLocaleString() }}</div>
                <div class="text-xs text-muted">Tokens</div>
              </div>
              <NTag :type="statusMap[row.status]?.type || 'default'" size="small">
                {{ statusMap[row.status]?.label || row.status }}
              </NTag>
            </div>
          </div>
        </div>
      </div>

      <!-- 分页 -->
      <div class="flex justify-center mt-6" v-if="filteredRows.length > pageSize">
        <NPagination
          v-model:page="page"
          :page-size="pageSize"
          :item-count="filteredRows.length"
          show-size-picker
        />
      </div>
    </template>
  </div>
</template>
