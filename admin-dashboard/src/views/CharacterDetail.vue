<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/api/client'
import type { CharacterDetail, MemoryEntry, MemoryType, CharacterSession } from '@/api/types'
import InfoTooltip from '@/components/InfoTooltip.vue'

const { t } = useI18n()
const props = defineProps<{ slug: string }>()
const data = ref<CharacterDetail | null>(null)
const memories = ref<MemoryEntry[]>([])
const charSessions = ref<CharacterSession[]>([])
const loading = ref(true)

onMounted(async () => {
  try {
    data.value = await api.character(props.slug)
    memories.value = await api.memories(props.slug)
    charSessions.value = await api.characterSessions(props.slug)
  }
  finally { loading.value = false }
})

// ─── 审核 / 数据状态标注 (WP26 · P2-35) ───
// 这个页面的数据源仍是 **mock** (admin-dashboard/src/api/client.ts 的 `character()`),
// 后端 /admin/api/characters/:slug 还没接上 —— mock 里**没有** auditStatus 字段.
// 之前页面右上角直接渲染 `data.auditStatus ?? '—'`: 一片 "—" 会被读成"没问题 / 没有待办",
// 而真实含义是"这段数据还没接真实来源" —— 状态标注缺失, 人会误判.
// 现在: 后端没给审核状态时**显式标 pending** (待接入 / 待审核), 并用 warn 色与
// 已过审 (ok) / 已驳回 (danger) 区分开 —— 视觉口径跟页面上既有的 chip 一致.
const auditStatus = computed(() => data.value?.auditStatus ?? 'pending')
const auditStatusClass = computed(() => {
  switch (auditStatus.value) {
    case 'approved': return 'bg-ok/15 text-ok'
    case 'rejected': return 'bg-danger/15 text-danger'
    default: return 'bg-warn/15 text-warn'
  }
})

// 记忆类型配置
const typeMeta: Record<MemoryType, { color: string; dot: string }> = {
  fact: { color: 'bg-blue-500', dot: 'bg-blue-400' },
  emotion: { color: 'bg-accent', dot: 'bg-accent' },
  relationship: { color: 'bg-purple-500', dot: 'bg-purple-400' },
  event: { color: 'bg-warn', dot: 'bg-warn' },
  preference: { color: 'bg-ok', dot: 'bg-ok' },
}

// 按时间排序的记忆
const sortedMemories = () => [...memories.value].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

// 类型分布
const typeDistribution = () => {
  const counts: Partial<Record<MemoryType, number>> = {}
  for (const m of memories.value) counts[m.type] = (counts[m.type] ?? 0) + 1
  const total = memories.value.length || 1
  return Object.entries(counts).map(([type, count]) => ({
    type: type as MemoryType,
    count: count!,
    pct: (count! / total) * 100,
  }))
}
</script>

<template>
  <div class="p-6 max-w-4xl mx-auto">
    <n-button size="small" quaternary class="mb-4" @click="$router.push('/characters')">{{ t('characterDetail.back') }}</n-button>
    <div v-if="loading" class="text-muted text-sm">…</div>
    <template v-else-if="data">
      <div class="flex items-center gap-2 mb-5">
        <span class="text-lg font-semibold">{{ data.codename }}</span>
        <n-tag size="small" :bordered="false">{{ data.attachmentStyle ?? '—' }}</n-tag>
        <n-tag size="small" :bordered="false" :type="data.enabled ? 'success' : 'error'">
          {{ data.enabled ? 'enabled' : 'disabled' }}
        </n-tag>
        <n-tag size="small" :bordered="false" :type="auditStatus === 'approved' ? 'success' : auditStatus === 'rejected' ? 'error' : 'warning'">
          {{ auditStatus }}
        </n-tag>
        <span class="ml-auto text-xs text-warn" v-if="auditStatus === 'pending'">待接入真实 API (mock 数据)</span>
      </div>

      <!-- BDI 基线 -->
      <n-card :title="t('characterDetail.bdiBaseline')" size="small" class="mb-4">
        <n-grid cols="4" responsive="screen">
          <n-gi v-for="(val, key) in data.baseline" :key="key">
            <div class="text-center py-2">
              <div class="text-[10px] uppercase tracking-wider text-muted mb-1">{{ key }}</div>
              <div class="font-mono text-lg">{{ val.toFixed(2) }}</div>
            </div>
          </n-gi>
        </n-grid>
      </n-card>

      <!-- 历史会话 -->
      <n-card v-if="charSessions.length" :title="t('characterDetail.historySessions')" size="small" class="mt-4" :header-style="{ paddingBottom: '8px' }">
        <template #header-extra>
          <n-tag size="tiny" :bordered="false">{{ charSessions.length }}</n-tag>
        </template>
        <div class="space-y-1.5">
          <RouterLink v-for="s in charSessions" :key="s.sessionId"
                     :to="`/sessions/${s.sessionId}`"
                     class="flex items-center gap-3 p-2.5 rounded hover:bg-bg-elevated transition">
            <span class="text-xs font-mono text-muted w-24">{{ s.startedAt }}</span>
            <span class="text-xs flex-1">{{ s.visitorAlias }}</span>
            <n-tag size="tiny" :bordered="false" :type="s.status === 'completed' ? 'success' : 'warning'">{{ s.status }}</n-tag>
            <span class="text-xs font-mono text-muted w-16 text-right">{{ s.totalTokens }} tokens</span>
          </RouterLink>
        </div>
      </n-card>

      <!-- 该角色积累的记忆 -->
      <n-card v-if="memories.length" :title="t('characterDetail.memories')" size="small" class="mt-4" :header-style="{ paddingBottom: '8px' }">
        <template #header-extra>
          <n-tag size="tiny" :bordered="false">{{ memories.length }} {{ t('memories.count') }}</n-tag>
        </template>

        <!-- 类型分布条 -->
        <div class="flex h-1.5 rounded overflow-hidden mb-4 bg-bg-elevated">
          <div v-for="d in typeDistribution()" :key="d.type"
               class="h-full" :class="typeMeta[d.type].color"
               :style="{ width: `${d.pct}%` }"></div>
        </div>
        <div class="flex gap-3 mb-4 text-[10px] text-muted">
          <span v-for="d in typeDistribution()" :key="d.type" class="flex items-center gap-1">
            <span class="w-1.5 h-1.5 rounded-full" :class="typeMeta[d.type].dot"></span>
            {{ d.type }} {{ d.count }}
          </span>
        </div>

        <!-- 时间轴 -->
        <div class="relative pl-5">
          <div class="absolute left-1.5 top-2 bottom-2 w-px bg-bg-border"></div>
          <div v-for="m in sortedMemories()" :key="m.id"
               class="relative mb-3 last:mb-0"
               :class="m.supersededBy ? 'opacity-50' : ''">
            <!-- 节点圆点 -->
            <span class="absolute -left-5 top-1.5 w-2.5 h-2.5 rounded-full border-2 border-bg-surface"
                  :class="typeMeta[m.type].dot"></span>
            <div class="flex items-center gap-2 mb-0.5">
              <span class="text-[10px] font-mono text-muted">{{ new Date(m.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }}</span>
              <n-tag size="tiny" :bordered="false" :type="m.source === 'long_term' ? 'primary' : 'default'">{{ m.source }}</n-tag>
              <span class="text-[10px] font-mono text-muted/70">imp {{ m.importance.toFixed(1) }}</span>
            </div>
            <p class="text-sm" :class="m.supersededBy ? 'line-through' : ''">{{ m.content }}</p>
            <p v-if="m.supersededBy" class="text-[10px] text-warn mt-0.5">→ {{ t('memories.supersededBy') }} {{ m.supersededBy }}</p>
          </div>
        </div>
      </n-card>
    </template>
  </div>
</template>
