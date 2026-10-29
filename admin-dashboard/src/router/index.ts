import { createRouter, createWebHashHistory } from 'vue-router'
import SessionsList from '@/views/SessionsList.vue'
import SessionDetail from '@/views/SessionDetail.vue'
import CharactersList from '@/views/CharactersList.vue'

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/sessions' },
    { path: '/sessions', component: SessionsList },
    { path: '/sessions/:id', component: SessionDetail, props: true },
    { path: '/characters', component: CharactersList },
  ],
})
