<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { TrajectoryState } from '@/api/types'

const { t } = useI18n()
defineProps<{ state: TrajectoryState | null }>()

const nodeIcon = (ty: string) =>
  ty === 'entry' ? '●' : ty === 'crisis' ? '▲' : ty === 'exit' ? '■' : '◆'
const nodeColor = (ty: string) =>
  ty === 'entry' ? 'text-ok' : ty === 'crisis' ? 'text-danger' : ty === 'exit' ? 'text-muted' : 'text-accent'
const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '—'
</script>

<template>
  <div v-if="state" class="card p-4 mt-4">
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-xs uppercase tracking-wider text-muted">{{ t('sessionDetail.trajectory') }}</h2>
      <span class="chip bg-accent/15 text-accent font-mono text-xs">{{ state.scriptId }}</span>
    </div>
    <p class="text-sm text-gray-200 mb-3">{{ state.scriptName }}</p>

    <!-- 节点路径 breadcrumb -->
    <div class="flex items-center gap-1 mb-4 text-xs">
      <span v-for="(p, i) in state.path" :key="i" class="flex items-center gap-1">
        <span class="text-muted">{{ p }}</span>
        <span v-if="i < state.path.length - 1" class="text-muted/50">→</span>
      </span>
    </div>

    <!-- 已触发节点时间线 -->
    <div class="space-y-2">
      <div v-for="n in state.triggered" :key="n.nodeId"
           class="flex gap-3 p-2.5 rounded"
           :class="n.nodeId === state.currentNode ? 'bg-accent/10 border border-accent/30' : 'bg-bg-base/40'">
        <span class="font-mono text-sm shrink-0 mt-0.5" :class="nodeColor(n.type)">{{ nodeIcon(n.type) }}</span>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-sm text-gray-200">{{ n.label }}</span>
            <span v-if="n.nodeId === state.currentNode" class="chip bg-accent/20 text-accent text-[10px]">{{ t('sessionDetail.current') }}</span>
          </div>
          <p v-if="n.description" class="text-xs text-muted mt-0.5">{{ n.description }}</p>
        </div>
        <span class="text-[10px] text-muted font-mono shrink-0 mt-1">{{ fmtTime(n.triggeredAt) }}</span>
      </div>
    </div>
  </div>
</template>
