<script setup lang="ts">
import { RouterView, useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { setLang } from '@/i18n'
import { ref, onMounted, onUnmounted, computed, onErrorCaptured } from 'vue'
import { darkTheme, lightTheme, NInput, NMenu, NIcon } from 'naive-ui'
import type { MenuOption } from 'naive-ui'
import type { Component } from 'vue'
import { h } from 'vue'
import {
  AnalyticsOutline,
  SchoolOutline,
  PulseOutline,
  SettingsOutline,
  SearchOutline,
  MoonOutline,
  SunnyOutline,
  RocketOutline,
  LogOutOutline,
} from '@vicons/ionicons5'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'

function renderIcon(icon: Component) {
  return () => h(NIcon, null, { default: () => h(icon) })
}

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const theme = useThemeStore()
const toggleLang = () => setLang(locale.value === 'zh-CN' ? 'en' : 'zh-CN')

// 全局错误捕获
const hasError = ref(false)
const errorMessage = ref('')

onErrorCaptured((err) => {
  console.error('页面错误:', err)
  hasError.value = true
  errorMessage.value = err instanceof Error ? err.message : '未知错误'
  return false
})

function handleRefresh() {
  window.location.reload()
}

function handleLogout() {
  auth.logout()
  router.push('/login')
}

// ─── 全局搜索命令面板 ───
const searchVisible = ref(false)
const searchQuery = ref('')

const activeMenuKey = ref(route.path)

const menuOptions = computed<MenuOption[]>(() => [
  {
    label: t('nav.groupOverview'),
    key: 'overview',
    icon: renderIcon(AnalyticsOutline),
    children: [
      { label: t('nav.dashboard'), key: '/dashboard' },
      { label: t('nav.sessions'), key: '/sessions' },
      { label: t('nav.characters'), key: '/characters' },
      { label: t('nav.memories'), key: '/memories' },
    ],
  },
  {
    label: t('nav.groupTraining'),
    key: 'training',
    icon: renderIcon(SchoolOutline),
    children: [
      { label: t('nav.autoPractice'), key: '/auto-practice' },
      { label: t('nav.batchRegression'), key: '/batch-regression' },
      { label: t('nav.evalReports'), key: '/eval-reports' },
      { label: t('nav.annotation'), key: '/quality/annotation' },
    ],
  },
  {
    label: t('nav.groupMonitor'),
    key: 'monitor',
    icon: renderIcon(PulseOutline),
    children: [
      { label: t('nav.psyguard'), key: '/psyguard' },
      { label: t('nav.cost'), key: '/cost' },
      { label: t('nav.deliberationStats'), key: '/deliberation-stats' },
      { label: t('nav.gateDecisions'), key: '/gate-decisions' },
    ],
  },
  {
    label: t('nav.groupSystem'),
    key: 'system',
    icon: renderIcon(SettingsOutline),
    children: [
      { label: t('nav.architecture'), key: '/architecture' },
      { label: t('nav.calibrator'), key: '/calibrator' },
    ],
  },
])

function onMenuSelect(key: string) {
  if (['overview', 'training', 'monitor', 'system'].includes(key)) return
  router.push(key)
}

const allPages = computed(() => [
  { name: t('nav.dashboard'), path: '/dashboard', keywords: 'dashboard 首页 概览' },
  { name: t('nav.sessions'), path: '/sessions', keywords: 'sessions 会话 对话 记录' },
  { name: t('nav.characters'), path: '/characters', keywords: 'characters 角色 人物 来访者' },
  { name: t('nav.memories'), path: '/memories', keywords: 'memories 记忆 向量 库' },
  { name: t('nav.autoPractice'), path: '/auto-practice', keywords: 'auto practice 对练 训练 调试' },
  { name: t('nav.batchRegression'), path: '/batch-regression', keywords: 'batch regression 批次 回归 对比 历史 效果' },
  { name: t('nav.evalReports'), path: '/eval-reports', keywords: 'eval reports 评测 报告 质量' },
  { name: t('nav.annotation'), path: '/quality/annotation', keywords: 'annotation 标注 锚点 质量 人工' },
  { name: t('nav.psyguard'), path: '/psyguard', keywords: 'psyguard 监控 安全 风险 危机' },
  { name: t('nav.cost'), path: '/cost', keywords: 'cost 成本 token 消耗 费用' },
  { name: t('nav.deliberationStats'), path: '/deliberation-stats', keywords: 'deliberation 审议 统计 闸门' },
  { name: t('nav.gateDecisions'), path: '/gate-decisions', keywords: 'gate decisions 闸门 决策 trace' },
  { name: t('nav.architecture'), path: '/architecture', keywords: 'architecture 架构 图 技术栈' },
  { name: t('nav.calibrator'), path: '/calibrator', keywords: 'calibrator 参数 校准 调参' },
])

const filteredPages = computed(() => {
  const q = searchQuery.value.toLowerCase().trim()
  if (!q) return allPages
  return allPages.filter(p =>
    p.name.toLowerCase().includes(q) ||
    p.keywords.toLowerCase().includes(q) ||
    p.path.includes(q)
  )
})

function openSearch() {
  searchVisible.value = true
  searchQuery.value = ''
}

function goTo(path: string) {
  router.push(path)
  searchVisible.value = false
}

function handleKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault()
    searchVisible.value = !searchVisible.value
  }
  if (e.key === 'Escape') {
    searchVisible.value = false
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
  theme.init()
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})

// Naive UI 主题覆盖
const naiveThemeOverrides = computed(() => theme.isLight ? {
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

const isLoginPage = computed(() => route.path === '/login')

const breadcrumbs = computed(() => {
  const path = route.path
  const crumbs: { label: string; path?: string }[] = []
  crumbs.push({ label: t('common.home'), path: '/dashboard' })

  if (path.startsWith('/sessions')) {
    crumbs.push({ label: t('nav.sessions'), path: '/sessions' })
    if (route.params.id) crumbs.push({ label: `#${route.params.id}` })
  } else if (path.startsWith('/characters')) {
    crumbs.push({ label: t('nav.characters'), path: '/characters' })
    if (route.params.id) crumbs.push({ label: `#${route.params.id}` })
  } else if (path.startsWith('/memories')) {
    crumbs.push({ label: t('nav.memories') })
  } else if (path.startsWith('/psyguard')) {
    crumbs.push({ label: t('nav.psyguard') })
  } else if (path.startsWith('/cost')) {
    crumbs.push({ label: t('nav.cost') })
  } else if (path.startsWith('/deliberation-stats')) {
    crumbs.push({ label: t('nav.deliberationStats') })
  } else if (path.startsWith('/gate-decisions')) {
    crumbs.push({ label: t('nav.gateDecisions') })
  } else if (path.startsWith('/architecture')) {
    crumbs.push({ label: t('nav.architecture') })
  } else if (path.startsWith('/calibrator')) {
    crumbs.push({ label: t('nav.calibrator') })
  } else if (path.startsWith('/auto-practice')) {
    crumbs.push({ label: t('nav.autoPractice') })
  } else if (path.startsWith('/batch-regression')) {
    crumbs.push({ label: t('nav.batchRegression') })
  } else if (path.startsWith('/eval-reports')) {
    crumbs.push({ label: t('nav.evalReports') })
  } else if (path.startsWith('/quality/annotation')) {
    crumbs.push({ label: t('nav.annotation') })
  }

  return crumbs
})
</script>

<template>
  <n-config-provider :theme="theme.isLight ? lightTheme : darkTheme" :theme-overrides="naiveThemeOverrides">
    <n-message-provider>
      <n-dialog-provider>

      <!-- 全局错误页面 -->
      <div v-if="hasError" class="min-h-screen flex items-center justify-center bg-bg-base">
        <div class="text-center max-w-md">
          <div class="text-6xl mb-4">😵</div>
          <h2 class="text-xl font-semibold mb-2">{{ t('common.pageErrorTitle') }}</h2>
          <p class="text-sm text-muted mb-6">{{ errorMessage || t('common.pageErrorDesc') }}</p>
          <div class="flex items-center justify-center gap-3">
            <n-button type="primary" @click="handleRefresh">{{ t('common.pageErrorRefresh') }}</n-button>
            <n-button @click="hasError = false">{{ t('common.pageErrorBack') }}</n-button>
          </div>
        </div>
      </div>

      <div v-else>
        <!-- 登录页：只显示内容 -->
        <RouterView v-if="isLoginPage" />

        <!-- 其他页面：带导航栏 -->
        <div v-else class="h-screen flex flex-col">
          <header class="border-b border-bg-border bg-bg-surface px-4 md:px-6 py-3 flex items-center gap-4 md:gap-6">
            <div class="flex items-center gap-2 cursor-pointer hover:opacity-80" @click="router.push('/dashboard')">
              <n-icon size="18" class="text-accent"><rocket-outline /></n-icon>
              <span class="font-semibold text-sm">{{ t('app.consoleTitle') }}</span>
            </div>
        <n-menu
          mode="horizontal"
          :value="activeMenuKey"
          :options="menuOptions"
          class="flex-1"
          @update:value="onMenuSelect"
        />
        <div class="ml-auto flex items-center gap-3 text-xs font-mono">
          <button
            @click="openSearch"
            class="px-2.5 py-1.5 rounded border border-bg-border hover:bg-bg-elevated text-muted flex items-center gap-1.5"
            :title="t('common.searchHint')"
          >
            <n-icon size="16"><search-outline /></n-icon>
            <span class="text-[10px] text-muted">⌘K</span>
          </button>

          <button @click="theme.toggle" class="px-2 py-1 rounded border border-bg-border hover:bg-bg-elevated text-muted"
                  :title="theme.isLight ? 'Switch to dark' : 'Switch to light'">
            <n-icon size="16">
              <moon-outline v-if="theme.isLight" />
              <sunny-outline v-else />
            </n-icon>
          </button>
          <button @click="toggleLang" class="px-2 py-1 rounded border border-bg-border hover:bg-bg-elevated text-muted">
            {{ t('lang.switch') }}
          </button>
          <button @click="handleLogout" class="px-2 py-1 rounded border border-bg-border hover:bg-bg-elevated text-muted" :title="t('app.logout')">
            <n-icon size="16"><log-out-outline /></n-icon>
          </button>
          <span class="w-1.5 h-1.5 rounded-full bg-ok"></span>
          <span class="text-muted">{{ t('app.online') }}</span>
        </div>
      </header>

      <!-- 面包屑 -->
      <div v-if="breadcrumbs.length > 1" class="px-6 py-2 border-b border-bg-border text-xs text-muted bg-bg-surface/50 flex items-center gap-1">
        <template v-for="(crumb, i) in breadcrumbs" :key="i">
          <RouterLink :to="crumb.path || ''" class="hover:text-accent">
            {{ crumb.label }}
          </RouterLink>
          <span v-if="i < breadcrumbs.length - 1" class="mx-1">/</span>
        </template>
      </div>

      <main class="flex-1 overflow-auto">
        <RouterView v-slot="{ Component }">
          <Transition name="fade" mode="out-in">
            <component :is="Component" />
          </Transition>
        </RouterView>
      </main>
    </div>
      </div>
      </n-dialog-provider>
    </n-message-provider>

    <!-- 全局搜索命令面板 -->
    <Teleport to="body">
      <div
        v-if="searchVisible"
        class="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-black/50"
        @click.self="searchVisible = false"
      >
        <div class="w-full max-w-xl bg-bg-surface border border-bg-border rounded-xl shadow-2xl overflow-hidden">
          <div class="p-3 border-b border-bg-border">
            <NInput
              v-model:value="searchQuery"
              :placeholder="t('common.searchPlaceholder')"
              size="large"
              autofocus
              @keyup.enter="filteredPages[0] && goTo(filteredPages[0].path)"
            />
          </div>
          <div class="max-h-80 overflow-y-auto py-2">
            <div
              v-for="page in filteredPages"
              :key="page.path"
              class="px-4 py-2.5 hover:bg-bg-elevated cursor-pointer flex items-center gap-3"
              @click="goTo(page.path)"
            >
              <span class="text-sm">{{ page.name }}</span>
              <span class="ml-auto text-xs text-muted font-mono">{{ page.path }}</span>
            </div>
            <div v-if="filteredPages.length === 0" class="px-4 py-8 text-center text-muted text-sm">
              {{ t('common.noResults') }}
            </div>
          </div>
          <div class="px-4 py-2 border-t border-bg-border text-xs text-muted flex items-center gap-4">
            <span>{{ t('common.upDownHint') }}</span>
            <span>{{ t('common.enterHint') }}</span>
            <span>{{ t('common.escHint') }}</span>
          </div>
        </div>
      </div>
    </Teleport>
  </n-config-provider>
</template>
