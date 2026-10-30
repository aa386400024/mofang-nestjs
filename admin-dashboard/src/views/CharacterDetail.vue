<script setup lang="ts">
import { ref, onMounted } from 'vue'
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

const fivePsItems = [
  { key: 'presenting', label: t('characterDetail.presenting') },
  { key: 'predisposing', label: t('characterDetail.predisposing') },
  { key: 'precipitating', label: t('characterDetail.precipitating') },
  { key: 'perpetuating', label: t('characterDetail.perpetuating') },
  { key: 'protecting', label: t('characterDetail.protecting') },
] as const

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
    <button class="text-sm text-muted hover:text-accent mb-4" @click="$router.push('/characters')">{{ t('characterDetail.back') }}</button>
    <div v-if="loading" class="text-muted text-sm">…</div>
    <template v-else-if="data">
      <div class="flex items-center gap-4 mb-5">
        <span class="text-lg font-semibold">{{ data.codename }}</span>
        <span class="chip bg-bg-elevated text-muted">{{ data.difficulty }}</span>
        <span class="chip bg-bg-elevated text-muted">{{ data.defenseType }}</span>
        <span class="ml-auto text-xs text-muted font-mono">{{ data.sessionCount }} {{ t('characterDetail.historySessions') }}</span>
      </div>

      <!-- 基本信息 -->
      <div class="card p-4 mb-4">
        <h2 class="text-xs uppercase tracking-wider text-muted mb-3">{{ t('characterDetail.basicInfo') }}</h2>
        <div class="grid grid-cols-2 gap-3 text-sm">
          <div><span class="text-muted text-xs">{{ t('characterDetail.age') }}：</span>{{ data.ageRange }}</div>
          <div><span class="text-muted text-xs">{{ t('characterDetail.domain') }}：</span>{{ data.issueDomain }}</div>
          <div class="col-span-2"><span class="text-muted text-xs">{{ t('characterDetail.complaint') }}：</span>{{ data.presentingComplaint }}</div>
        </div>
      </div>

      <!-- 5Ps -->
      <div class="card p-4 mb-4">
        <h2 class="text-xs uppercase tracking-wider text-muted mb-3">{{ t('characterDetail.fivePs') }}</h2>
        <div class="space-y-3">
          <div v-for="item in fivePsItems" :key="item.key" class="flex gap-3">
            <span class="text-xs font-mono w-20 text-accent shrink-0 pt-0.5">{{ item.label }}</span>
            <p class="text-sm text-gray-300 leading-relaxed">{{ data.fivePs[item.key] || '—' }}</p>
          </div>
        </div>
      </div>

      <!-- BDI 基线 + 表达风格 -->
      <div class="grid grid-cols-2 gap-4">
        <div class="card p-4">
          <h2 class="text-xs uppercase tracking-wider text-muted mb-3">{{ t('characterDetail.bdiBaseline') }}</h2>
          <div class="space-y-2 text-sm">
            <div class="flex justify-between">
              <span class="text-muted">{{ t('characterDetail.emotionBaseline') }}</span>
              <span class="font-mono">{{ data.emotionBaseline.toFixed(2) }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-muted">{{ t('characters.defenseLevel') }}</span>
              <span class="font-mono">{{ data.defenseLevel.toFixed(2) }}</span>
            </div>
          </div>
        </div>
        <div class="card p-4">
          <h2 class="text-xs uppercase tracking-wider text-muted mb-3">{{ t('characterDetail.expressionStyle') }}</h2>
          <div class="space-y-2 text-sm">
            <div class="flex justify-between">
              <span class="text-muted">{{ t('characterDetail.speechVolume') }}</span>
              <span class="font-mono">{{ data.expressionStyle.speechVolumeBaseline.toFixed(2) }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-muted">{{ t('characterDetail.narrativeStyle') }}</span>
              <span class="chip bg-bg-elevated text-muted">{{ data.expressionStyle.narrativeStyle }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-muted">{{ t('characterDetail.tone') }}</span>
              <span class="chip bg-accent/15 text-accent">{{ data.expressionStyle.expressionTone }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 历史会话 -->
      <div v-if="charSessions.length" class="card p-4 mt-4">
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-xs uppercase tracking-wider text-muted">{{ t('characterDetail.historySessions') }}</h2>
          <span class="chip bg-bg-elevated text-muted text-[10px]">{{ charSessions.length }}</span>
        </div>
        <div class="space-y-1.5">
          <RouterLink v-for="s in charSessions" :key="s.sessionId"
                     :to="`/sessions/${s.sessionId}`"
                     class="flex items-center gap-3 p-2.5 rounded bg-bg-base/40 hover:bg-bg-elevated transition">
            <span class="text-xs font-mono text-muted w-24">{{ s.startedAt }}</span>
            <span class="text-xs text-gray-300 flex-1">{{ s.visitorAlias }}</span>
            <span class="chip text-[10px]" :class="s.status === 'completed' ? 'bg-ok/10 text-ok' : 'bg-warn/10 text-warn'">{{ s.status }}</span>
            <span class="text-xs font-mono text-muted w-16 text-right">{{ s.totalTokens }} tokens</span>
          </RouterLink>
        </div>
      </div>

      <!-- 该角色积累的记忆 -->
      <div v-if="memories.length" class="card p-4 mt-4">
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-xs uppercase tracking-wider text-muted">{{ t('characterDetail.memories') }}</h2>
          <span class="chip bg-bg-elevated text-muted text-[10px]">{{ memories.length }} {{ t('memories.count') }}</span>
        </div>

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
              <span class="chip text-[9px]" :class="m.source === 'long_term' ? 'bg-accent/15 text-accent' : 'bg-bg-elevated text-muted'">{{ m.source }}</span>
              <span class="text-[10px] font-mono text-muted/70">imp {{ m.importance.toFixed(1) }}</span>
            </div>
            <p class="text-sm text-gray-200" :class="m.supersededBy ? 'line-through' : ''">{{ m.content }}</p>
            <p v-if="m.supersededBy" class="text-[10px] text-warn mt-0.5">→ {{ t('memories.supersededBy') }} {{ m.supersededBy }}</p>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
