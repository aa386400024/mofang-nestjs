import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * 全局主题状态（dark / light）
 * - isLight: 是否为浅色主题
 * - toggle(): 切换并持久化到 localStorage
 * - init(): 应用启动时从 localStorage 恢复并同步 DOM class
 */
export const useThemeStore = defineStore('theme', () => {
  const isLight = ref(localStorage.getItem('theme') === 'light')

  function toggle() {
    isLight.value = !isLight.value
    document.documentElement.classList.toggle('light', isLight.value)
    localStorage.setItem('theme', isLight.value ? 'light' : 'dark')
  }

  function init() {
    if (isLight.value) {
      document.documentElement.classList.add('light')
    }
  }

  return { isLight, toggle, init }
})
