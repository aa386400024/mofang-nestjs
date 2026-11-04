<script setup lang="ts">
import { ref, onMounted, computed, h } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { api } from '@/api/client'
import type { SessionSummary } from '@/api/types'
import InfoTooltip from '@/components/InfoTooltip.vue'
import EmptyState from '@/components/EmptyState.vue'

const { t } = useI18n()
const router = useRouter()
const rows = ref<SessionSummary[]>([])
const loading = ref(true)
const err = ref('')

onMounted(async () => {
  try { rows.value = await api.sessions(20) }
  catch (e) { err.value = String(e) }
  finally { loading.value = false }
})

const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
const fmtTime = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '—'
const statusColor = computed(() => (s: string) =>
  s === 'completed' ? 'text-ok' : s === 'no_content' ? 'text-muted' : 'text-danger'
)

const stats = computed(() => {
  const total = rows.value.length
  const tokens = rows.value.reduce((a, r) => a + r.totalTokens, 0)
  const avgDur = total ? Math.round(rows.value.reduce((a, r) => a + r.durationSec, 0) / total) : 0
  const done = rows.value.filter(r => r.status === 'completed').length
  return { total, tokens, avgDur, done }
})

// n-data-table 列定义
const columns = [
  {
    title: () => t('sessions.time'),
    key: 'startedAt',
    width: 100,
    render: (row: SessionSummary) => fmtTime(row.startedAt),
  },
  {
    title: () => t('sessions.visitor'),
    key: 'visitorAlias',
  },
  {
    title: () => t('sessions.duration'),
    key: 'durationSec',
    width: 100,
    render: (row: SessionSummary) => fmtDur(row.durationSec),
  },
  {
    title: () => t('sessions.token'),
    key: 'totalTokens',
    width: 120,
    align: 'right' as const,
    render: (row: SessionSummary) => row.totalTokens.toLocaleString(),
  },
  {
    title: () => t('sessions.status'),
    key: 'status',
    width: 120,
    render: (row: SessionSummary) => h('span', { class: 'chip ' + statusColor.value(row.status) }, row.status),
  },
]
</script>

<template>
  <div class="p-6 max-w-5xl mx-auto">
    <h1 class="text-lg font-semibold mb-4">{{ t('sessions.title') }}</h1>
    <EmptyState
      v-if="loading"
      icon="list"
      title="加载中…"
      description="正在获取会话列表"
    />
    <EmptyState
      v-else-if="err"
      icon="list"
      title="加载失败"
      :description="err"
      pendingTag="Error: API 请求失败"
    />
    <EmptyState
      v-else-if="!rows.length"
      icon="list"
      title="暂无会话记录"
      description="完成第一场对练后，这里会展示会话列表、Token 消耗和时长统计。"
      pendingTag="等待第一场对练数据"
    />
    <template v-else>
      <!-- 统计条 -->
      <div class="grid grid-cols-4 gap-3 mb-4">
        <div class="card p-3">
          <div class="text-[10px] uppercase tracking-wider text-muted mb-1 flex items-center">
            {{ t('sessions.total') }}
            <InfoTooltip :text="t('sessions.totalTooltip')" />
          </div>
          <div class="font-mono text-lg text-gray-100">{{ stats.total }}</div>
        </div>
        <div class="card p-3">
          <div class="text-[10px] uppercase tracking-wider text-muted mb-1 flex items-center">
            {{ t('sessions.completed') }}
            <InfoTooltip :text="t('sessions.completedTooltip')" />
          </div>
          <div class="font-mono text-lg text-ok">{{ stats.done }}</div>
        </div>
        <div class="card p-3">
          <div class="text-[10px] uppercase tracking-wider text-muted mb-1 flex items-center">
            {{ t('sessions.tokens') }}
            <InfoTooltip :text="t('sessions.tokensTooltip')" />
          </div>
          <div class="font-mono text-lg text-gray-100">{{ stats.tokens.toLocaleString() }}</div>
        </div>
        <div class="card p-3">
          <div class="text-[10px] uppercase tracking-wider text-muted mb-1 flex items-center">
            {{ t('sessions.avgDuration') }}
            <InfoTooltip :text="t('sessions.avgDurationTooltip')" />
          </div>
          <div class="font-mono text-lg text-gray-100">{{ fmtDur(stats.avgDur) }}</div>
        </div>
      </div>

      <n-data-table
        :columns="columns"
        :data="rows"
        :bordered="false"
        size="small"
        :row-props="(row: SessionSummary) => ({
          style: 'cursor: pointer;',
          onClick: () => router.push(`/sessions/${row.sessionId}`),
        })"
      />
    </template>
  </div>
</template>
