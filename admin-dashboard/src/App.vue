<script setup lang="ts">
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { setLang } from '@/i18n'
import { ref, onMounted, computed } from 'vue'
import { darkTheme, lightTheme } from 'naive-ui'

const { t, locale } = useI18n()
const route = useRoute()
const toggleLang = () => setLang(locale.value === 'zh-CN' ? 'en' : 'zh-CN')

const isLight = ref(false)
const toggleTheme = () => {
  isLight.value = !isLight.value
  document.documentElement.classList.toggle('light', isLight.value)
  localStorage.setItem('theme', isLight.value ? 'light' : 'dark')
}

// Naive UI 主题覆盖：匹配现有 CSS 变量配色
const naiveThemeOverrides = computed(() => isLight.value ? {
  common: {
    primaryColor: '#a8557a',
    primaryColorHover: '#b86688',
    primaryColorPressed: '#984466',
    primaryColorSuppl: '#a8557a',
    successColor: '#3d9a6e',
    warningColor: '#b88a3a',
    errorColor: '#c85a5a',
    borderRadius: '6px',
    fontFamily: 'inherit',
  },
  Card: {
    color: '#ffffff',
    colorModal: '#ffffff',
    borderColor: '#d1d1d6',
  },
  Table: {
    thColor: '#f5f5f7',
    tdColor: '#ffffff',
    tdColorHover: '#e8e8ed',
    borderColor: '#d1d1d6',
  },
} : {
  common: {
    primaryColor: '#c890a8',
    primaryColorHover: '#d8a0b8',
    primaryColorPressed: '#b88098',
    primaryColorSuppl: '#c890a8',
    successColor: '#7ec9a0',
    warningColor: '#e8c87a',
    errorColor: '#e87a7a',
    borderRadius: '6px',
    fontFamily: 'inherit',
  },
  Card: {
    color: '#161922',
    colorModal: '#161922',
    borderColor: '#2a2f3d',
  },
  Table: {
    thColor: '#1e222d',
    tdColor: '#161922',
    tdColorHover: '#1e222d',
    borderColor: '#2a2f3d',
  },
})

// 登录页不显示导航
const isLoginPage = computed(() => route.path === '/login')

onMounted(() => {
  const saved = localStorage.getItem('theme')
  if (saved === 'light') {
    isLight.value = true
    document.documentElement.classList.add('light')
  }
})
</script>

<template>
  <n-config-provider :theme="isLight ? lightTheme : darkTheme" :theme-overrides="naiveThemeOverrides">
    <n-message-provider>
      <n-dialog-provider>
      <div>
        <!-- 登录页：只显示内容 -->
        <RouterView v-if="isLoginPage" />

        <!-- 其他页面：带导航栏 -->
        <div v-else class="min-h-screen flex flex-col">
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
          <span class="w-px h-4 bg-bg-border mx-1 self-center"></span>
          <RouterLink to="/architecture" class="px-3 py-1.5 rounded hover:bg-bg-elevated" active-class="bg-bg-elevated text-accent">{{ t('nav.architecture') }}</RouterLink>
          <RouterLink to="/calibrator" class="px-3 py-1.5 rounded hover:bg-bg-elevated" active-class="bg-bg-elevated text-accent">{{ t('nav.calibrator') }}</RouterLink>
          <span class="w-px h-4 bg-bg-border mx-1 self-center"></span>
          <RouterLink to="/debug-chat" class="px-3 py-1.5 rounded hover:bg-bg-elevated" active-class="bg-bg-elevated text-accent">{{ t('nav.debugChat') }}</RouterLink>
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
      </div>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>
