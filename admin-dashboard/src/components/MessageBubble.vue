<script setup lang="ts">
import { ref } from 'vue'

interface Props {
  role: 'counselor' | 'visitor'
  text: string
  crisis?: boolean
  trace?: unknown
  turnIndex?: number
}

const props = defineProps<Props>()

function copyText() {
  navigator.clipboard.writeText(props.text)
}

function showTrace() {
  // emit 给父组件
}
</script>

<template>
  <div class="group flex gap-2.5" :class="role === 'counselor' ? 'flex-row-reverse' : 'flex-row'">
    <div
      class="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-medium flex-shrink-0 mt-4"
      :style="{ background: role === 'counselor' ? '#7c8db5' : '#7ab59e', color: '#fff' }"
    >
      {{ role === 'counselor' ? '咨' : '访' }}
    </div>
    <div class="flex flex-col max-w-[70%]" :class="role === 'counselor' ? 'items-end' : 'items-start'">
      <div class="text-[11px] text-muted/80 mb-1 px-1">
        {{ role === 'counselor' ? 'AI 咨询师' : 'AI 来访者' }}
        <span v-if="crisis" class="text-red-400 ml-1">⚠ 危机</span>
      </div>
      <div
        class="px-3.5 py-2.5 text-sm leading-relaxed shadow-sm"
        :class="role === 'counselor'
          ? 'bg-accent/15 text-text-primary rounded-2xl rounded-br-md'
          : 'bg-bg-elevated/80 text-text-secondary rounded-2xl rounded-bl-md'"
      >
        <div class="whitespace-pre-wrap">{{ text }}</div>
      </div>
      <div class="flex gap-1 mt-1 px-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          class="w-6 h-6 flex items-center justify-center rounded-md text-muted hover:text-accent hover:bg-bg-surface transition-colors"
          @click="copyText"
          title="复制文本"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </button>
        <button
          v-if="role === 'visitor' && trace"
          class="w-6 h-6 flex items-center justify-center rounded-md bg-accent/15 border border-accent/30 shadow-sm hover:bg-accent/25 text-accent transition-colors"
          @click="$emit('show-trace', trace)"
          title="查看这轮的调试数据"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <path d="m21 21-4.3-4.3"/>
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>
