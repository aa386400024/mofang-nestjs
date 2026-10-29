<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { api } from '@/api/client'
import type { SessionSummary } from '@/api/types'

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
</script>

<template>
  <div class="p-6 max-w-5xl mx-auto">
    <h1 class="text-lg font-semibold mb-4">会话列表</h1>
    <div v-if="loading" class="text-muted text-sm">加载中…</div>
    <div v-else-if="err" class="text-danger text-sm">{{ err }}</div>
    <template v-else>
      <!-- 统计条 -->
      <div class="grid grid-cols-4 gap-3 mb-4">
        <div class="card p-3">
          <div class="text-[10px] uppercase tracking-wider text-muted mb-1">总会话</div>
          <div class="font-mono text-lg text-gray-100">{{ stats.total }}</div>
        </div>
        <div class="card p-3">
          <div class="text-[10px] uppercase tracking-wider text-muted mb-1">已完成</div>
          <div class="font-mono text-lg text-ok">{{ stats.done }}</div>
        </div>
        <div class="card p-3">
          <div class="text-[10px] uppercase tracking-wider text-muted mb-1">总 Token</div>
          <div class="font-mono text-lg text-gray-100">{{ stats.tokens.toLocaleString() }}</div>
        </div>
        <div class="card p-3">
          <div class="text-[10px] uppercase tracking-wider text-muted mb-1">平均时长</div>
          <div class="font-mono text-lg text-gray-100">{{ fmtDur(stats.avgDur) }}</div>
        </div>
      </div>

      <div class="card overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-bg-elevated text-muted text-xs uppercase">
          <tr>
            <th class="text-left px-4 py-2 font-medium">时间</th>
            <th class="text-left px-4 py-2 font-medium">角色</th>
            <th class="text-left px-4 py-2 font-medium">时长</th>
            <th class="text-right px-4 py-2 font-medium">Token</th>
            <th class="text-left px-4 py-2 font-medium">状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.sessionId"
              class="border-t border-bg-border hover:bg-bg-elevated cursor-pointer"
              @click="$router.push(`/sessions/${r.sessionId}`)">
            <td class="px-4 py-2.5 font-mono text-xs">{{ fmtTime(r.startedAt) }}</td>
            <td class="px-4 py-2.5">{{ r.visitorAlias }}</td>
            <td class="px-4 py-2.5 font-mono text-xs">{{ fmtDur(r.durationSec) }}</td>
            <td class="px-4 py-2.5 text-right font-mono text-xs">{{ r.totalTokens.toLocaleString() }}</td>
            <td class="px-4 py-2.5"><span class="chip" :class="statusColor(r.status)">{{ r.status }}</span></td>
          </tr>
        </tbody>
      </table>
      </div>
    </template>
  </div>
</template>
