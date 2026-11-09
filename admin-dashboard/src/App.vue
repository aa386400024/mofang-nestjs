<script setup lang="ts">
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
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

// 渲染图标辅助函数
function renderIcon(icon: Component) {
  return () => h(NIcon, null, { default: () => h(icon) })
}

// ─── SVG 图标（Ionicons 风格） ───
const iconProps = { width: '16', height: '16', viewBox: '0 0 24 24', fill: 'currentColor' }

const SpeedometerIcon = () => h('svg', iconProps, [
  h('path', { d: 'M12 2a10 10 0 0 0-10 10c0 5.52 4.48 10 10 10s10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8 0-1.85.63-3.55 1.69-4.9L12 12l6.31-6.9C19.37 8.45 20 10.15 20 12c0 4.41-3.59 8-8 8z' }),
])
const ChatIcon = () => h('svg', iconProps, [
  h('path', { d: 'M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z' }),
])
const PersonIcon = () => h('svg', iconProps, [
  h('path', { d: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z' }),
])
const BrainIcon = () => h('svg', iconProps, [
  h('path', { d: 'M12 2C8 2 5 4 5 7c0 1.5.5 2.5 1 3-.5.5-1 1.5-1 3 0 3 3 5 7 5v2c-2 0-4 2-4 4h8c0-2-2-4-4-4v-2c4 0 7-2 7-5 0-1.5-.5-2.5-1-3 .5-.5 1-1.5 1-3 0-3-3-5-7-5z' }),
])
const FitnessIcon = () => h('svg', iconProps, [
  h('path', { d: 'M20.57 14.86L22 13.43 20.57 12 17 15.57 8.43 7 12 3.43 10.57 2 9.14 3.43 7.71 2 5.57 4.14 4.14 5.57 2 7.71 3.43 9.14 2 10.57 3.43 12 13.43 10.57 14.86 12 16.29 13.43 14.86 14.86 16.29 16.29 14.86 18.43 12.71 19.86 11.29 21 9.14 19.86 7.71 18.43 9.14 17 10.57 15.57 14.86 12 18.43 10.57 20.57 12 22 13.43 20.57 14.86z' }),
])
const DocumentIcon = () => h('svg', iconProps, [
  h('path', { d: 'M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z' }),
])
const ShieldIcon = () => h('svg', iconProps, [
  h('path', { d: 'M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z' }),
])
const CashIcon = () => h('svg', iconProps, [
  h('path', { d: 'M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.16H6.69c.12 2.19 1.76 3.42 3.46 3.83V21h3v-2.15c1.95-.37 3.5-1.37 3.5-3.55 0-2.84-2.43-3.81-4.85-4.4z' }),
])
const ChartIcon = () => h('svg', iconProps, [
  h('path', { d: 'M5 9.2h3V19H5V9.2zM10.6 5h2.8v14h-2.8V5zm5.6 8H19v6h-2.8v-6z' }),
])
const BranchIcon = () => h('svg', iconProps, [
  h('path', { d: 'M6 2c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6H6zm7 7V3.5L18.5 9H13z' }),
])
const CubeIcon = () => h('svg', iconProps, [
  h('path', { d: 'M12 2L2 7v10l10 5 10-5V7L12 2zm0 2.18L19.82 8 12 11.82 4.18 8 12 4.18zM4 9.82l7 3.5v7.36l-7-3.5V9.82zm16 0v7.36l-7 3.5v-7.36l7-3.5z' }),
])
const SettingsIcon = () => h('svg', iconProps, [
  h('path', { d: 'M19.14 12.99c.04-.32.06-.64.06-.99s-.02-.67-.06-.99l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.32-.06.65-.06.99s.02.67.06.99l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z' }),
])
const SearchIcon = () => h('svg', iconProps, [
  h('path', { d: 'M15.5 14h-.79l-.28-.28c.79-.92 1.26-2.1 1.26-3.42 0-2.76-2.24-5-5-5s-5 2.24-5 5 2.24 5 5 5c1.32 0 2.5-.47 3.42-1.26l.28.28v.79l4.25 4.25c.41.41 1.08.41 1.49 0 .41-.41.41-1.08 0-1.49L15.5 14zm-6 0c-1.93 0-3.5-1.57-3.5-3.5S7.57 7 9.5 7s3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z' }),
])
const MoonIcon = () => h('svg', iconProps, [
  h('path', { d: 'M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z' }),
])
const SunnyIcon = () => h('svg', iconProps, [
  h('path', { d: 'M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0-5l2.39 4.78L19 6l-2.5 4.5L21 12l-4.5 1.5L19 18l-4.61-.78L12 22l-2.39-4.78L5 18l2.5-4.5L3 12l4.5-1.5L5 6l4.61.78L12 2z' }),
])

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const toggleLang = () => setLang(locale.value === 'zh-CN' ? 'en' : 'zh-CN')

// 全局错误捕获
const hasError = ref(false)
const errorMessage = ref('')

onErrorCaptured((err) => {
  console.error('页面错误:', err)
  hasError.value = true
  errorMessage.value = err instanceof Error ? err.message : '未知错误'
  return false // 阻止错误向上冒泡
})

// 刷新页面
function handleRefresh() {
  window.location.reload()
}

// 退出登录
function handleLogout() {
  sessionStorage.removeItem('admin_basic_auth')
  router.push('/login')
}

// ─── 全局搜索命令面板 ───
const searchVisible = ref(false)
const searchQuery = ref('')

// ─── 导航菜单配置 ───
const activeMenuKey = ref(route.path)

const menuOptions = computed<MenuOption[]>(() => [
  {
    label: '概览',
    key: 'overview',
    icon: renderIcon(AnalyticsOutline),
    children: [
      { label: '仪表盘', key: '/dashboard' },
      { label: '会话列表', key: '/sessions' },
      { label: '角色列表', key: '/characters' },
      { label: '记忆浏览器', key: '/memories' },
    ],
  },
  {
    label: '训练',
    key: 'training',
    icon: renderIcon(SchoolOutline),
    children: [
      { label: '自动对练', key: '/auto-practice' },
      { label: '评测报告', key: '/eval-reports' },
    ],
  },
  {
    label: '监控',
    key: 'monitor',
    icon: renderIcon(PulseOutline),
    children: [
      { label: 'PsyGuard 监控', key: '/psyguard' },
      { label: '成本看板', key: '/cost' },
      { label: '审议统计', key: '/deliberation-stats' },
      { label: '闸门决策', key: '/gate-decisions' },
    ],
  },
  {
    label: '系统',
    key: 'system',
    icon: renderIcon(SettingsOutline),
    children: [
      { label: '系统架构', key: '/architecture' },
      { label: '参数校准', key: '/calibrator' },
    ],
  },
])

// 菜单点击跳转
function onMenuSelect(key: string) {
  // 分组 key（overview/training/monitor/system）不跳转，只展开
  if (['overview', 'training', 'monitor', 'system'].includes(key)) return
  router.push(key)
}

// 所有可跳转的页面
const allPages = [
  { name: '仪表盘', path: '/dashboard', keywords: 'dashboard 首页 概览' },
  { name: '会话列表', path: '/sessions', keywords: 'sessions 会话 对话 记录' },
  { name: '角色列表', path: '/characters', keywords: 'characters 角色 人物 来访者' },
  { name: '记忆浏览器', path: '/memories', keywords: 'memories 记忆 向量 库' },
  { name: '自动对练', path: '/auto-practice', keywords: 'auto practice 对练 训练 调试' },
  { name: '评测报告', path: '/eval-reports', keywords: 'eval reports 评测 报告 质量' },
  { name: 'PsyGuard 监控', path: '/psyguard', keywords: 'psyguard 监控 安全 风险 危机' },
  { name: '成本看板', path: '/cost', keywords: 'cost 成本 token 消耗 费用' },
  { name: '审议统计', path: '/deliberation-stats', keywords: 'deliberation 审议 统计 闸门' },
  { name: '闸门决策', path: '/gate-decisions', keywords: 'gate decisions 闸门 决策 trace' },
  { name: '系统架构', path: '/architecture', keywords: 'architecture 架构 图 技术栈' },
  { name: '参数校准', path: '/calibrator', keywords: 'calibrator 参数 校准 调参' },
]

// 搜索过滤
const filteredPages = computed(() => {
  const q = searchQuery.value.toLowerCase().trim()
  if (!q) return allPages
  return allPages.filter(p =>
    p.name.toLowerCase().includes(q) ||
    p.keywords.toLowerCase().includes(q) ||
    p.path.includes(q)
  )
})

// 打开搜索
function openSearch() {
  searchVisible.value = true
  searchQuery.value = ''
}

// 跳转到页面并关闭
function goTo(path: string) {
  router.push(path)
  searchVisible.value = false
}

// 快捷键监听
function handleKeydown(e: KeyboardEvent) {
  // ⌘K / Ctrl+K 打开搜索
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault()
    searchVisible.value = !searchVisible.value
  }
  // Esc 关闭
  if (e.key === 'Escape') {
    searchVisible.value = false
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})

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

// ─── 面包屑 ───
const breadcrumbs = computed(() => {
  const path = route.path
  const crumbs: { label: string; path?: string }[] = []

  // 根
  crumbs.push({ label: '首页', path: '/dashboard' })

  if (path.startsWith('/sessions')) {
    crumbs.push({ label: '会话', path: '/sessions' })
    if (route.params.id) {
      crumbs.push({ label: `会话详情 #${route.params.id}` })
    }
  } else if (path.startsWith('/characters')) {
    crumbs.push({ label: '角色', path: '/characters' })
    if (route.params.id) {
      crumbs.push({ label: `角色详情 #${route.params.id}` })
    }
  } else if (path.startsWith('/memories')) {
    crumbs.push({ label: '记忆浏览器' })
  } else if (path.startsWith('/psyguard')) {
    crumbs.push({ label: 'PsyGuard 监控' })
  } else if (path.startsWith('/cost')) {
    crumbs.push({ label: '成本看板' })
  } else if (path.startsWith('/deliberation-stats')) {
    crumbs.push({ label: '审议统计' })
  } else if (path.startsWith('/gate-decisions')) {
    crumbs.push({ label: '闸门决策' })
  } else if (path.startsWith('/architecture')) {
    crumbs.push({ label: '系统架构' })
  } else if (path.startsWith('/calibrator')) {
    crumbs.push({ label: '参数校准' })
  } else if (path.startsWith('/auto-practice')) {
    crumbs.push({ label: '自动对练' })
  } else if (path.startsWith('/eval-reports')) {
    crumbs.push({ label: '评测报告' })
  }

  return crumbs
})

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

      <!-- 全局错误页面 -->
      <div v-if="hasError" class="min-h-screen flex items-center justify-center bg-bg-base">
        <div class="text-center max-w-md">
          <div class="text-6xl mb-4">😵</div>
          <h2 class="text-xl font-semibold mb-2">页面出错了</h2>
          <p class="text-sm text-muted mb-6">{{ errorMessage }}</p>
          <div class="flex items-center justify-center gap-3">
            <n-button type="primary" @click="handleRefresh">刷新页面</n-button>
            <n-button @click="hasError = false">返回上一页</n-button>
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
              <span class="font-semibold text-sm">心塑引擎控制台</span>
            </div>
        <n-menu
          mode="horizontal"
          :value="activeMenuKey"
          :options="menuOptions"
          class="flex-1"
          @update:value="onMenuSelect"
        />
        <div class="ml-auto flex items-center gap-3 text-xs font-mono">
          <!-- 搜索按钮 -->
          <button
            @click="openSearch"
            class="px-2.5 py-1.5 rounded border border-bg-border hover:bg-bg-elevated text-muted flex items-center gap-1.5"
            title="全局搜索 (⌘K)"
          >
            <n-icon size="16"><search-outline /></n-icon>
            <span class="text-[10px] text-muted">⌘K</span>
          </button>

          <button @click="toggleTheme" class="px-2 py-1 rounded border border-bg-border hover:bg-bg-elevated text-muted"
                  :title="isLight ? 'Switch to dark' : 'Switch to light'">
            <n-icon size="16">
              <moon-outline v-if="isLight" />
              <sunny-outline v-else />
            </n-icon>
          </button>
          <button @click="toggleLang" class="px-2 py-1 rounded border border-bg-border hover:bg-bg-elevated text-muted">
            {{ t('lang.switch') }}
          </button>
          <button @click="handleLogout" class="px-2 py-1 rounded border border-bg-border hover:bg-bg-elevated text-muted" title="退出登录">
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
          <!-- 搜索输入框 -->
          <div class="p-3 border-b border-bg-border">
            <NInput
              v-model:value="searchQuery"
              placeholder="搜索页面、会话、角色…"
              size="large"
              autofocus
              @keyup.enter="filteredPages[0] && goTo(filteredPages[0].path)"
            />
          </div>
          <!-- 搜索结果 -->
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
              没有匹配的结果
            </div>
          </div>
          <!-- 底部提示 -->
          <div class="px-4 py-2 border-t border-bg-border text-xs text-muted flex items-center gap-4">
            <span>↑↓ 选择</span>
            <span>↵ 跳转</span>
            <span>Esc 关闭</span>
          </div>
        </div>
      </div>
    </Teleport>
  </n-config-provider>
</template>
