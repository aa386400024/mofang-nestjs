<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <header class="border-b border-bg-border bg-bg-surface px-6 py-3 flex items-center gap-6">
      <div class="flex items-center gap-2">
        <div class="w-2.5 h-2.5 rounded-full bg-accent"></div>
        <span class="font-semibold text-sm">引擎调试器</span>
      </div>
      <nav class="flex gap-1 text-sm">
        <RouterLink to="/sessions" class="px-3 py-1.5 rounded hover:bg-bg-elevated" active-class="bg-bg-elevated text-accent">会话</RouterLink>
        <RouterLink to="/characters" class="px-3 py-1.5 rounded hover:bg-bg-elevated" active-class="bg-bg-elevated text-accent">角色池</RouterLink>
      </nav>
      <div class="ml-auto flex items-center gap-2 text-xs font-mono">
        <span class="w-1.5 h-1.5 rounded-full bg-ok"></span>
        <span class="text-muted">引擎在线</span>
      </div>
    </header>
    <main class="flex-1 overflow-auto">
      <RouterView />
    </main>
  </div>
</template>
