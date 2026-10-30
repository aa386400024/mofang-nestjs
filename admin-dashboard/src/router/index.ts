import { createRouter, createWebHashHistory } from 'vue-router'
import Dashboard from '@/views/Dashboard.vue'
import SessionsList from '@/views/SessionsList.vue'
import SessionDetail from '@/views/SessionDetail.vue'
import CharactersList from '@/views/CharactersList.vue'
import CharacterDetail from '@/views/CharacterDetail.vue'
import MemoryBrowser from '@/views/MemoryBrowser.vue'
import PsyGuardMonitor from '@/views/PsyGuardMonitor.vue'
import CostBoard from '@/views/CostBoard.vue'

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/dashboard' },
    { path: '/dashboard', component: Dashboard },
    { path: '/sessions', component: SessionsList },
    { path: '/sessions/:id', component: SessionDetail, props: true },
    { path: '/characters', component: CharactersList },
    { path: '/characters/:slug', component: CharacterDetail, props: true },
    { path: '/memories', component: MemoryBrowser },
    { path: '/psyguard', component: PsyGuardMonitor },
    { path: '/cost', component: CostBoard },
  ],
})
