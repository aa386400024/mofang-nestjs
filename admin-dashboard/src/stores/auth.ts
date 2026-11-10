import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getAuthHeader, clearAuth } from '@/api/client'

/**
 * 全局鉴权状态（Basic Auth）
 * - isAuthenticated: 是否已有凭据
 * - login(): 由 Login 页调用，传入 base64 编码的 user:pass
 * - logout(): 清凭据，跳登录页（由调用方处理路由跳转）
 */
export const useAuthStore = defineStore('auth', () => {
  const isAuthenticated = ref(!!sessionStorage.getItem('admin_basic_auth'))

  function login(encodedCredentials: string) {
    sessionStorage.setItem('admin_basic_auth', encodedCredentials)
    isAuthenticated.value = true
  }

  function logout() {
    clearAuth()
    isAuthenticated.value = false
  }

  const authHeader = computed(() => getAuthHeader())

  return { isAuthenticated, login, logout, authHeader }
})
