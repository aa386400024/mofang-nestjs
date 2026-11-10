import { createRouter, createWebHashHistory } from 'vue-router'

// 路由懒加载：动态 import 实现代码分割
const Dashboard = () => import('@/views/Dashboard.vue')
const SessionsList = () => import('@/views/SessionsList.vue')
const SessionDetail = () => import('@/views/SessionDetail.vue')
const CharactersList = () => import('@/views/CharactersList.vue')
const CharacterDetail = () => import('@/views/CharacterDetail.vue')
const MemoryBrowser = () => import('@/views/MemoryBrowser.vue')
const PsyGuardMonitor = () => import('@/views/PsyGuardMonitor.vue')
const CostBoard = () => import('@/views/CostBoard.vue')
const DeliberationStats = () => import('@/views/DeliberationStats.vue')
const GateDecisions = () => import('@/views/GateDecisions.vue')
const ArchitectureDiagram = () => import('@/views/ArchitectureDiagram.vue')
const ParamCalibrator = () => import('@/views/ParamCalibrator.vue')
const AutoPractice = () => import('@/views/AutoPractice.vue')
const EvalReports = () => import('@/views/EvalReports.vue')
const AnnotationTool = () => import('@/views/AnnotationTool.vue')
const Login = () => import('@/views/Login.vue')

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
    { path: '/gate-decisions', component: GateDecisions },
    { path: '/architecture', component: ArchitectureDiagram },
    { path: '/calibrator', component: ParamCalibrator },
    { path: '/auto-practice', component: AutoPractice },
    { path: '/eval-reports', component: EvalReports },
    { path: '/quality/annotation', component: AnnotationTool },
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
