<script setup lang="ts">
defineProps<{ text: string }>()
</script>

<template>
  <span class="relative inline-flex items-center group cursor-help ml-1">
    <svg class="w-3 h-3 text-muted group-hover:text-accent transition-colors" fill="currentColor" viewBox="0 0 20 20">
      <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/>
    </svg>
    <span class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 rounded bg-bg-elevated border border-bg-border text-xs text-gray-200 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-xl">
      {{ text }}
      <span class="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-bg-border"></span>
    </span>
  </span>
</template>
