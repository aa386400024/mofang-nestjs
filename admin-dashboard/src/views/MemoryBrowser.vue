<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/api/client'
import type { MemoryEntry, MemoryType } from '@/api/types'
import InfoTooltip from '@/components/InfoTooltip.vue'

const { t } = useI18n()
const rows = ref<MemoryEntry[]>([])
const loading = ref(true)
const search = ref('')
const showSuperseded = ref(true)
const viewMode = ref<'group' | 'timeline'>('group')
const activeTypes = ref<Set<MemoryType>>(new Set())
const impFilter = ref<'all' | 'high' | 'critical'>('all')

onMounted(async () => {
  try { rows.value = await api.memories() }
  finally { loading.value = false }
})

const typeMeta: Record<MemoryType, { label: string; color: string; dot: string }> = {
  fact: { label: '事实', color: 'bg-blue-500/15 text-blue-400', dot: 'bg-blue-400' },
  emotion: { label: '情感', color: 'bg-accent/15 text-accent', dot: 'bg-accent' },
  relationship: { label: '关系', color: 'bg-purple-500/15 text-purple-400', dot: 'bg-purple-400' },
  event: { label: '事件', color: 'bg-warn/15 text-warn', dot: 'bg-warn' },
  preference: { label: '偏好', color: 'bg-ok/15 text-ok', dot: 'bg-ok' },
}

const allTypes = Object.keys(typeMeta) as MemoryType[]

const toggleType = (ty: MemoryType) => {
  if (activeTypes.value.has(ty)) activeTypes.value.delete(ty)
  else activeTypes.value.add(ty)
  activeTypes.value = new Set(activeTypes.value)
}

// 过滤后的记忆
const filtered = computed(() => {
  return rows.value.filter(m => {
    if (!showSuperseded.value && m.supersededBy) return false
    if (activeTypes.value.size && !activeTypes.value.has(m.type)) return false
    if (impFilter.value === 'high' && m.importance < 0.8) return false
    if (impFilter.value === 'critical' && m.importance < 0.9) return false
    if (search.value) {
      const q = search.value.toLowerCase()
      return m.content.toLowerCase().includes(q) || m.visitorId.toLowerCase().includes(q)
    }
    return true
  })
})

// 按 visitorId 分组
const groups = computed(() => {
  const map = new Map<string, { alias: string; entries: MemoryEntry[] }>()
  for (const m of filtered.value) {
    if (!map.has(m.visitorId)) map.set(m.visitorId, { alias: m.visitorAlias ?? m.visitorId, entries: [] })
    map.get(m.visitorId)!.entries.push(m)
  }
  return Array.from(map.entries()).map(([visitorId, g]) => ({
    visitorId,
    alias: g.alias,
    total: g.entries.length,
    longTerm: g.entries.filter(e => e.source === 'long_term').length,
    superseded: g.entries.filter(e => e.supersededBy).length,
    entries: g.entries.sort((a, b) => b.importance - a.importance),
  }))
})

// 时间线模式（按时间排序）
const timeline = computed(() =>
  [...filtered.value].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
)

const stats = computed(() => ({
  total: rows.value.length,
  longTerm: rows.value.filter(r => r.source === 'long_term').length,
  superseded: rows.value.filter(r => r.supersededBy).length,
  visitors: new Set(rows.value.map(r => r.visitorId)).size,
}))

// 类型分布
const typeDist = computed(() => {
  const counts: Partial<Record<MemoryType, number>> = {}
  for (const m of rows.value) counts[m.type] = (counts[m.type] ?? 0) + 1
  const total = rows.value.length || 1
  return allTypes.map(ty => ({ type: ty, count: counts[ty] ?? 0, pct: ((counts[ty] ?? 0) / total) * 100 }))
})

const fmtDate = (iso: string) => new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
const impColor = (v: number) => v >= 0.9 ? 'bg-danger' : v >= 0.8 ? 'bg-warn' : v >= 0.6 ? 'bg-accent/60' : 'bg-ok/50'
const impTextColor = (v: number) => v >= 0.9 ? 'text-danger' : v >= 0.8 ? 'text-warn' : 'text-muted'
</script>

<template>
  <div class="p-6 max-w-5xl mx-auto">
    <h1 class="text-lg font-semibold mb-4">{{ t('memories.title') }}</h1>
    <div v-if="loading" class="text-muted text-sm">…</div>
    <template v-else>
      <!-- 统计卡片 -->
      <div class="grid grid-cols-4 gap-3 mb-4">
        <div class="card p-3">
          <div class="text-[10px] uppercase tracking-wider text-muted mb-1">{{ t('memories.total') }}</div>
          <div class="font-mono text-lg text-gray-100">{{ stats.total }}</div>
        </div>
        <div class="card p-3">
          <div class="text-[10px] uppercase tracking-wider text-muted mb-1">{{ t('memories.visitors') }}</div>
          <div class="font-mono text-lg text-gray-100">{{ stats.visitors }}</div>
        </div>
        <div class="card p-3">
          <div class="text-[10px] uppercase tracking-wider text-muted mb-1">{{ t('memories.longTermCount') }}</div>
          <div class="font-mono text-lg text-accent">{{ stats.longTerm }}</div>
        </div>
        <div class="card p-3">
          <div class="text-[10px] uppercase tracking-wider text-muted mb-1">{{ t('memories.supersededCount') }}</div>
          <div class="font-mono text-lg text-warn">{{ stats.superseded }}</div>
        </div>
      </div>

      <!-- 类型分布条 -->
      <div class="flex h-1.5 rounded overflow-hidden mb-2 bg-bg-elevated">
        <div v-for="d in typeDist" :key="d.type"
             class="h-full transition-all" :class="typeMeta[d.type].dot"
             :style="{ width: `${d.pct}%` }"></div>
      </div>
      <div class="flex gap-3 mb-4 text-[10px] text-muted">
        <span v-for="d in typeDist" :key="d.type" class="flex items-center gap-1">
          <span class="w-1.5 h-1.5 rounded-full" :class="typeMeta[d.type].dot"></span>
          {{ typeMeta[d.type].label }} {{ d.count }}
        </span>
      </div>

      <!-- 工具栏 -->
      <div class="mb-4 flex flex-wrap gap-2 items-center">
        <input v-model="search" :placeholder="t('memories.searchPlaceholder')"
               class="bg-bg-elevated border border-bg-border rounded px-3 py-1.5 text-sm text-gray-200 w-56 outline-none focus:border-accent/50" />

        <!-- 类型筛选 chip -->
        <button v-for="ty in allTypes" :key="ty"
                class="chip text-[10px] transition"
                :class="activeTypes.has(ty) ? typeMeta[ty].color : 'bg-bg-elevated text-muted opacity-50 hover:opacity-80'"
                @click="toggleType(ty)">
          {{ typeMeta[ty].label }}
        </button>

        <span class="w-px h-4 bg-bg-border mx-1"></span>

        <!-- 重要度筛选 -->
        <div class="flex gap-1">
          <button class="chip text-[10px] transition"
                  :class="impFilter === 'all' ? 'bg-accent/20 text-accent' : 'bg-bg-elevated text-muted opacity-60'"
                  @click="impFilter = 'all'">{{ t('memories.impAll') }}</button>
          <button class="chip text-[10px] transition"
                  :class="impFilter === 'high' ? 'bg-warn/20 text-warn' : 'bg-bg-elevated text-muted opacity-60'"
                  @click="impFilter = 'high'">≥0.8</button>
          <button class="chip text-[10px] transition"
                  :class="impFilter === 'critical' ? 'bg-danger/20 text-danger' : 'bg-bg-elevated text-muted opacity-60'"
                  @click="impFilter = 'critical'">≥0.9</button>
        </div>

        <label class="flex items-center gap-1.5 text-xs text-muted cursor-pointer ml-2">
          <input type="checkbox" v-model="showSuperseded" class="accent-accent" />
          {{ t('memories.showSuperseded') }}
        </label>

        <!-- 视图切换 -->
        <div class="ml-auto flex gap-1">
          <button class="chip text-[10px]" :class="viewMode === 'group' ? 'bg-accent/20 text-accent' : 'bg-bg-elevated text-muted'" @click="viewMode = 'group'">{{ t('memories.viewGroup') }}</button>
          <button class="chip text-[10px]" :class="viewMode === 'timeline' ? 'bg-accent/20 text-accent' : 'bg-bg-elevated text-muted'" @click="viewMode = 'timeline'">{{ t('memories.viewTimeline') }}</button>
        </div>
      </div>

      <!-- 分组视图 -->
      <div v-if="viewMode === 'group'">
        <div v-for="g in groups" :key="g.visitorId" class="mb-5">
          <RouterLink :to="`/characters/${g.visitorId}`" class="flex items-center gap-2 mb-2 hover:opacity-80 transition">
            <span class="font-medium text-sm text-gray-100">{{ g.alias }}</span>
            <span class="font-mono text-xs text-muted">{{ g.visitorId }}</span>
            <span class="chip bg-bg-elevated text-muted text-[10px]">{{ g.total }} {{ t('memories.count') }}</span>
            <span class="chip bg-accent/10 text-accent text-[10px]">{{ g.longTerm }} {{ t('memories.longTerm') }}</span>
            <span v-if="g.superseded" class="chip bg-warn/10 text-warn text-[10px]">{{ g.superseded }} {{ t('memories.supersededShort') }}</span>
            <span class="text-xs text-muted ml-1">→</span>
          </RouterLink>

          <div class="space-y-1.5">
            <div v-for="m in g.entries" :key="m.id"
                 class="card p-3 flex items-start gap-3"
                 :class="m.supersededBy ? 'opacity-50' : ''">
              <span class="chip shrink-0 mt-0.5 text-[10px]" :class="typeMeta[m.type].color">
                {{ typeMeta[m.type].label }}
              </span>
              <div class="flex-1 min-w-0">
                <p class="text-sm text-gray-200" :class="m.supersededBy ? 'line-through' : ''">
                  {{ m.content }}
                </p>
                <div class="text-[10px] text-muted mt-1 font-mono flex items-center gap-3">
                  <span>{{ fmtDate(m.createdAt) }}</span>
                  <RouterLink v-if="m.sourceSessionId" :to="`/sessions/${m.sourceSessionId}`"
                              class="text-accent/70 hover:text-accent underline underline-offset-2">
                    {{ m.sourceSessionId }}
                  </RouterLink>
                  <span v-if="m.supersededBy" class="text-warn">→ {{ m.supersededBy }}</span>
                </div>
              </div>
              <div class="shrink-0 w-20 mt-1">
                <div class="text-[9px] text-muted text-right mb-0.5 flex items-center justify-end gap-1">
                  {{ t('memories.importance') }}
                  <InfoTooltip :text="t('memories.importanceTooltip')" />
                </div>
                <div class="h-1.5 bg-bg-elevated rounded overflow-hidden">
                  <div class="h-full rounded" :class="impColor(m.importance)" :style="{ width: `${m.importance * 100}%` }"></div>
                </div>
                <div class="text-[9px] text-right mt-0.5 font-mono" :class="impTextColor(m.importance)">{{ m.importance.toFixed(1) }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 时间线视图 -->
      <div v-else class="relative pl-5">
        <div class="absolute left-1.5 top-2 bottom-2 w-px bg-bg-border"></div>
        <div v-for="m in timeline" :key="m.id"
             class="relative mb-3 last:mb-0"
             :class="m.supersededBy ? 'opacity-50' : ''">
          <span class="absolute -left-5 top-1.5 w-2.5 h-2.5 rounded-full border-2 border-bg-surface"
                :class="typeMeta[m.type].dot"></span>
          <div class="card p-3">
            <div class="flex items-center gap-2 mb-1">
              <span class="text-[10px] font-mono text-muted">{{ fmtDate(m.createdAt) }}</span>
              <RouterLink :to="`/characters/${m.visitorId}`" class="text-xs text-accent/80 hover:text-accent">{{ m.visitorAlias ?? m.visitorId }}</RouterLink>
              <span class="chip text-[9px]" :class="typeMeta[m.type].color">{{ typeMeta[m.type].label }}</span>
              <span class="chip text-[9px]" :class="m.source === 'long_term' ? 'bg-accent/15 text-accent' : 'bg-bg-elevated text-muted'">{{ m.source }}</span>
            </div>
            <p class="text-sm text-gray-200" :class="m.supersededBy ? 'line-through' : ''">{{ m.content }}</p>
            <div class="text-[10px] text-muted mt-1 font-mono flex items-center gap-3">
              <RouterLink v-if="m.sourceSessionId" :to="`/sessions/${m.sourceSessionId}`"
                          class="text-accent/70 hover:text-accent underline underline-offset-2">
                {{ m.sourceSessionId }}
              </RouterLink>
              <span v-if="m.supersededBy" class="text-warn">→ {{ m.supersededBy }} {{ t('memories.supersededBy') }}</span>
              <span class="ml-auto" :class="impTextColor(m.importance)">imp {{ m.importance.toFixed(1) }}</span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="!filtered.length" class="text-muted text-sm text-center py-12">{{ t('memories.empty') }}</div>
    </template>
  </div>
</template>
