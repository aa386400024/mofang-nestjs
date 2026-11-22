<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/api/client'
import type { MemoryEntry, MemorySource } from '@/api/types'
import InfoTooltip from '@/components/InfoTooltip.vue'
import EmptyState from '@/components/EmptyState.vue'
import { NInput, NTag, NDivider, NRadioGroup, NRadioButton, NCheckbox } from 'naive-ui'

const { t } = useI18n()
const rows = ref<MemoryEntry[]>([])
/**
 * 数据源状态: 'qdrant' = 读到了 (可能 0 条); 'unavailable' = 向量库读不到.
 *
 * ⚠️ 这两件事**必须分开**: "读不到" 与 "没有" 是完全不同的运维结论 ——
 *   前者要去查 Qdrant, 后者就是真的没产生记忆.
 */
const source = ref<'qdrant' | 'unavailable'>('qdrant')
const loading = ref(true)
const err = ref('')
const search = ref('')
const showSuperseded = ref(true)
const viewMode = ref<'group' | 'timeline'>('group')
const activeSources = ref<Set<MemorySource>>(new Set())
const impFilter = ref<'all' | 'high' | 'critical'>('all')

async function loadData() {
  loading.value = true
  err.value = ''
  try {
    const data = await api.memories()
    rows.value = data.entries
    source.value = data.source
  } catch (e) {
    err.value = String(e)
  } finally {
    loading.value = false
  }
}

onMounted(loadData)

/**
 * 来源 chip 的元数据.
 *
 * ⚠️ 原来的 `type` (事实/情感/关系/事件/偏好) 是**前端自造**的内容分类 ——
 *   后端没有任何分类器, 那个维度是假的. 现在只留内核**真有的**来源维度:
 *   轮次原文 / 会话摘要 / 人工注入.
 */
const sourceMeta: Record<MemorySource, { label: string; color: string; dot: string }> = {
  turn: { label: '轮次原文', color: 'bg-blue-500/15 text-blue-400', dot: 'bg-blue-400' },
  summary: { label: '会话摘要', color: 'bg-accent/15 text-accent', dot: 'bg-accent' },
  manual: { label: '人工注入', color: 'bg-ok/15 text-ok', dot: 'bg-ok' },
}

const allSources = Object.keys(sourceMeta) as MemorySource[]

const toggleSource = (src: MemorySource) => {
  if (activeSources.value.has(src)) activeSources.value.delete(src)
  else activeSources.value.add(src)
  activeSources.value = new Set(activeSources.value)
}

// 过滤后的记忆
const filtered = computed(() => {
  return rows.value.filter(m => {
    if (!showSuperseded.value && m.supersededBy) return false
    if (activeSources.value.size && !activeSources.value.has(m.source)) return false
    if (impFilter.value === 'high' && m.importance < 0.8) return false
    if (impFilter.value === 'critical' && m.importance < 0.9) return false
    if (search.value) {
      const q = search.value.toLowerCase()
      return m.content.toLowerCase().includes(q) || m.visitorId.toLowerCase().includes(q)
    }
    return true
  })
})

// 按归属作用域分组 (visitorId = "{学员id}:{角色key}")
const groups = computed(() => {
  const map = new Map<string, { entries: MemoryEntry[] }>()
  for (const m of filtered.value) {
    if (!map.has(m.visitorId)) map.set(m.visitorId, { entries: [] })
    map.get(m.visitorId)!.entries.push(m)
  }
  return Array.from(map.entries()).map(([visitorId, g]) => ({
    visitorId,
    alias: visitorId,
    total: g.entries.length,
    longTerm: g.entries.filter(e => e.tier === 'long_term').length,
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
  longTerm: rows.value.filter(r => r.tier === 'long_term').length,
  superseded: rows.value.filter(r => r.supersededBy).length,
  visitors: new Set(rows.value.map(r => r.visitorId)).size,
}))

// 来源分布
const sourceDist = computed(() => {
  const counts: Partial<Record<MemorySource, number>> = {}
  for (const m of rows.value) counts[m.source] = (counts[m.source] ?? 0) + 1
  const total = rows.value.length || 1
  return allSources.map(src => ({ source: src, count: counts[src] ?? 0, pct: ((counts[src] ?? 0) / total) * 100 }))
})

const fmtDate = (iso: string) => new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
const impColor = (v: number) => v >= 0.9 ? 'bg-danger' : v >= 0.8 ? 'bg-warn' : v >= 0.6 ? 'bg-accent/60' : 'bg-ok/50'
const impTextColor = (v: number) => v >= 0.9 ? 'text-danger' : v >= 0.8 ? 'text-warn' : 'text-muted'
</script>

<template>
  <div class="p-6 max-w-5xl mx-auto">
    <!-- 页面标题 -->
    <div class="mb-6">
      <h1 class="text-xl font-semibold">记忆浏览器</h1>
      <p class="text-sm text-muted mt-1">查看 AI 咨询师积累的长期记忆和会话摘要</p>
    </div>

    <!-- 三态 -->
    <EmptyState v-if="loading" icon="memory" title="加载中…" description="正在获取记忆库数据" />
    <EmptyState
      v-else-if="err"
      icon="warning"
      title="加载失败"
      :description="err"
      retry-text="重试"
      @retry="loadData"
    />
    <EmptyState
      v-else-if="source === 'unavailable'"
      icon="warning"
      title="向量库不可用"
      description="Qdrant 向量数据库连接失败，请检查服务状态"
    />
    <EmptyState
      v-else-if="!rows.length"
      icon="memory"
      title="暂无记忆数据"
      description="完成几场对练后，这里会展示 AI 咨询师积累的记忆"
    />

    <template v-else>
      <!-- 统计卡片 -->
      <div class="grid grid-cols-4 gap-4 mb-6">
        <div class="card p-4">
          <div class="text-xs text-muted mb-1">记忆总数</div>
          <div class="text-2xl font-mono font-semibold">{{ stats.total }}</div>
        </div>
        <div class="card p-4">
          <div class="text-xs text-muted mb-1">访客数</div>
          <div class="text-2xl font-mono font-semibold">{{ stats.visitors }}</div>
        </div>
        <div class="card p-4">
          <div class="text-xs text-muted mb-1">长期记忆</div>
          <div class="text-2xl font-mono font-semibold text-accent">{{ stats.longTerm }}</div>
        </div>
        <div class="card p-4">
          <div class="text-xs text-muted mb-1">被替代</div>
          <div class="text-2xl font-mono font-semibold text-warn">{{ stats.superseded }}</div>
        </div>
      </div>

      <!-- 来源分布条 -->
      <div class="flex h-1.5 rounded overflow-hidden mb-2 bg-bg-elevated">
        <div v-for="d in sourceDist" :key="d.source"
             class="h-full transition-all" :class="sourceMeta[d.source].dot"
             :style="{ width: `${d.pct}%` }"></div>
      </div>
      <div class="flex gap-3 mb-6 text-xs text-muted">
        <span v-for="d in sourceDist" :key="d.source" class="flex items-center gap-1">
          <span class="w-1.5 h-1.5 rounded-full" :class="sourceMeta[d.source].dot"></span>
          {{ sourceMeta[d.source].label }} {{ d.count }}
        </span>
      </div>

      <!-- 工具栏 -->
      <div class="mb-6 flex flex-wrap gap-2 items-center">
        <NInput v-model:value="search" placeholder="搜索记忆内容 / 访客 ID…" size="small" class="w-56" />

        <!-- 来源筛选 chip -->
        <NTag
          v-for="src in allSources"
          :key="src"
          checkable
          :checked="activeSources.has(src)"
          size="small"
          @update:checked="() => toggleSource(src)"
        >
          {{ sourceMeta[src].label }}
        </NTag>

        <NDivider vertical />

        <!-- 重要度筛选 -->
        <NRadioGroup v-model:value="impFilter" size="small">
          <NRadioButton value="all">全部</NRadioButton>
          <NRadioButton value="high">≥0.8</NRadioButton>
          <NRadioButton value="critical">≥0.9</NRadioButton>
        </NRadioGroup>

        <NCheckbox v-model:checked="showSuperseded" size="small" class="ml-2">
          显示被替代的
        </NCheckbox>

        <!-- 视图切换 -->
        <NRadioGroup v-model:value="viewMode" size="small" class="ml-auto">
          <NRadioButton value="group">分组视图</NRadioButton>
          <NRadioButton value="timeline">时间线</NRadioButton>
        </NRadioGroup>
      </div>

      <!-- 分组视图 -->
      <div v-if="viewMode === 'group'">
        <div v-for="g in groups" :key="g.visitorId" class="mb-6">
          <RouterLink :to="`/characters/${g.visitorId}`" class="flex items-center gap-2 mb-3 hover:opacity-80 transition">
            <span class="font-medium">{{ g.alias }}</span>
            <span class="font-mono text-xs text-muted">{{ g.visitorId }}</span>
            <span class="chip bg-bg-elevated text-muted text-xs">{{ g.total }} 条</span>
            <span class="chip bg-accent/10 text-accent text-xs">{{ g.longTerm }} 长期</span>
            <span v-if="g.superseded" class="chip bg-warn/10 text-warn text-xs">{{ g.superseded }} 已替代</span>
            <span class="text-muted ml-1">→</span>
          </RouterLink>

          <div class="space-y-2">
            <div v-for="m in g.entries" :key="m.id"
                 class="card p-3 flex items-start gap-3"
                 :class="m.supersededBy ? 'opacity-50' : ''">
              <span class="chip shrink-0 mt-0.5 text-xs" :class="sourceMeta[m.source].color">
                {{ sourceMeta[m.source].label }}
              </span>
              <div class="flex-1 min-w-0">
                <p class="text-sm" :class="m.supersededBy ? 'line-through' : ''">
                  {{ m.content }}
                </p>
                <div class="text-xs text-muted mt-1 font-mono flex items-center gap-3">
                  <span>{{ fmtDate(m.createdAt) }}</span>
                  <RouterLink v-if="m.sessionId" :to="`/sessions/${m.sessionId}`"
                              class="text-accent/70 hover:text-accent underline underline-offset-2">
                    {{ m.sessionId }}
                  </RouterLink>
                  <span v-if="m.supersededBy" class="text-warn">→ {{ m.supersededBy }}</span>
                </div>
              </div>
              <div class="shrink-0 w-20 mt-1">
                <div class="text-[10px] text-muted text-right mb-0.5 flex items-center justify-end gap-1">
                  重要度
                  <InfoTooltip text="记忆的重要程度，越高越容易被召回" />
                </div>
                <div class="h-1.5 bg-bg-elevated rounded overflow-hidden">
                  <div class="h-full rounded" :class="impColor(m.importance)" :style="{ width: `${m.importance * 100}%` }"></div>
                </div>
                <div class="text-[10px] text-right mt-0.5 font-mono" :class="impTextColor(m.importance)">{{ m.importance.toFixed(1) }}</div>
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
                :class="sourceMeta[m.source].dot"></span>
          <div class="card p-3">
            <div class="flex items-center gap-2 mb-1">
              <span class="text-xs font-mono text-muted">{{ fmtDate(m.createdAt) }}</span>
              <RouterLink :to="`/characters/${m.visitorId}`" class="text-xs text-accent/80 hover:text-accent">{{ m.visitorId }}</RouterLink>
              <span class="chip text-xs" :class="sourceMeta[m.source].color">{{ sourceMeta[m.source].label }}</span>
              <span class="chip text-xs" :class="m.tier === 'long_term' ? 'bg-accent/15 text-accent' : 'bg-bg-elevated text-muted'">{{ m.tier }}</span>
            </div>
            <p class="text-sm" :class="m.supersededBy ? 'line-through' : ''">{{ m.content }}</p>
            <div class="text-xs text-muted mt-1 font-mono flex items-center gap-3">
              <RouterLink v-if="m.sessionId" :to="`/sessions/${m.sessionId}`"
                          class="text-accent/70 hover:text-accent underline underline-offset-2">
                {{ m.sessionId }}
              </RouterLink>
              <span v-if="m.supersededBy" class="text-warn">→ {{ m.supersededBy }} 已替代</span>
              <span class="ml-auto" :class="impTextColor(m.importance)">重要度 {{ m.importance.toFixed(1) }}</span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="!filtered.length" class="text-muted text-sm text-center py-12">
        没有匹配筛选条件的记忆
      </div>
    </template>
  </div>
</template>
