import { createRouter, createWebHashHistory } from 'vue-router'
import Dashboard from '@/views/Dashboard.vue'
import SessionsList from '@/views/SessionsList.vue'
import SessionDetail from '@/views/SessionDetail.vue'
import CharactersList from '@/views/CharactersList.vue'
import CharacterDetail from '@/views/CharacterDetail.vue'
import MemoryBrowser from '@/views/MemoryBrowser.vue'
import PsyGuardMonitor from '@/views/PsyGuardMonitor.vue'
import CostBoard from '@/views/CostBoard.vue'
import DeliberationStats from '@/views/DeliberationStats.vue'
import ArchitectureDiagram from '@/views/ArchitectureDiagram.vue'
import ParamCalibrator from '@/views/ParamCalibrator.vue'
import DebugChat from '@/views/DebugChat.vue'
import AutoPractice from '@/views/AutoPractice.vue'
import Login from '@/views/Login.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/login', component: Login, meta: { public: true } },
    { path: '/', redirect: '/dashboard' },
    { path: '/dashboard', component: Dashboard },
    { path: '/sessions', component: SessionsList },
    { path: '/sessions/:id', component: SessionDetail, props: true },
    { path: '/characters', component: CharactersList },
    { path: '/characters/:slug', component: CharacterDetail, props: true },
    { path: '/memories', component: MemoryBrowser },
    { path: '/psyguard', component: PsyGuardMonitor },
    { path: '/cost', component: CostBoard },
    { path: '/deliberation-stats', component: DeliberationStats },
    { path: '/architecture', component: ArchitectureDiagram },
    { path: '/calibrator', component: ParamCalibrator },
    { path: '/debug-chat', component: DebugChat },
    { path: '/auto-practice', component: AutoPractice },
  ],
})

// 路由守卫：没登录跳登录页
router.beforeEach((to) => {
  const isAuthenticated = !!sessionStorage.getItem('admin_basic_auth')
  const isPublic = to.meta.public === true

  if (!isAuthenticated && !isPublic) {
    return '/login'
  }
  if (isAuthenticated && to.path === '/login') {
    return '/dashboard'
  }
})

export default router
