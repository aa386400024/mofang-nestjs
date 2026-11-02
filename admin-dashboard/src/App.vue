<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { setLang } from '@/i18n'
import { ref, onMounted } from 'vue'

const { t, locale } = useI18n()
const toggleLang = () => setLang(locale.value === 'zh-CN' ? 'en' : 'zh-CN')

const isLight = ref(false)
const toggleTheme = () => {
  isLight.value = !isLight.value
  document.documentElement.classList.toggle('light', isLight.value)
  localStorage.setItem('theme', isLight.value ? 'light' : 'dark')
}

onMounted(() => {
  const saved = localStorage.getItem('theme')
  if (saved === 'light') {
    isLight.value = true
    document.documentElement.classList.add('light')
  }
})
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <header class="border-b border-bg-border bg-bg-surface px-6 py-3 flex items-center gap-6">
      <div class="flex items-center gap-2">
        <div class="w-2.5 h-2.5 rounded-full bg-accent"></div>
        <span class="font-semibold text-sm">{{ t('app.title') }}</span>
      </div>
      <nav class="flex gap-1 text-sm">
        <RouterLink to="/dashboard" class="px-3 py-1.5 rounded hover:bg-bg-elevated" active-class="bg-bg-elevated text-accent">{{ t('nav.dashboard') }}</RouterLink>
        <RouterLink to="/sessions" class="px-3 py-1.5 rounded hover:bg-bg-elevated" active-class="bg-bg-elevated text-accent">{{ t('nav.sessions') }}</RouterLink>
        <RouterLink to="/characters" class="px-3 py-1.5 rounded hover:bg-bg-elevated" active-class="bg-bg-elevated text-accent">{{ t('nav.characters') }}</RouterLink>
        <RouterLink to="/memories" class="px-3 py-1.5 rounded hover:bg-bg-elevated" active-class="bg-bg-elevated text-accent">{{ t('nav.memories') }}</RouterLink>
        <span class="w-px h-4 bg-bg-border mx-1 self-center"></span>
        <RouterLink to="/psyguard" class="px-3 py-1.5 rounded hover:bg-bg-elevated" active-class="bg-bg-elevated text-accent">{{ t('nav.psyguard') }}</RouterLink>
        <RouterLink to="/cost" class="px-3 py-1.5 rounded hover:bg-bg-elevated" active-class="bg-bg-elevated text-accent">{{ t('nav.cost') }}</RouterLink>
      </nav>
      <div class="ml-auto flex items-center gap-3 text-xs font-mono">
        <button @click="toggleTheme" class="px-2 py-1 rounded border border-bg-border hover:bg-bg-elevated text-muted"
                :title="isLight ? 'Switch to dark' : 'Switch to light'">
          {{ isLight ? '🌙' : '☀️' }}
        </button>
        <button @click="toggleLang" class="px-2 py-1 rounded border border-bg-border hover:bg-bg-elevated text-muted">
          {{ t('lang.switch') }}
        </button>
        <span class="w-1.5 h-1.5 rounded-full bg-ok"></span>
        <span class="text-muted">{{ t('app.online') }}</span>
      </div>
    </header>
    <main class="flex-1 overflow-auto">
      <RouterView />
    </main>
  </div>
</template>
