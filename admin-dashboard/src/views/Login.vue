<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const loading = ref(false)
const error = ref('')

const form = reactive({
  username: '',
  password: '',
})

const handleLogin = async () => {
  if (!form.username || !form.password) return
  loading.value = true
  error.value = ''

  // 存凭据到 sessionStorage
  const encoded = btoa(`${form.username}:${form.password}`)
  sessionStorage.setItem('admin_basic_auth', encoded)

  // 测试一下能不能通
  try {
    const r = await fetch('/admin/api/health', {
      headers: { Authorization: `Basic ${encoded}` },
    })
    if (r.ok) {
      router.push('/dashboard')
    } else if (r.status === 401) {
      error.value = '用户名或密码错误'
      sessionStorage.removeItem('admin_basic_auth')
    } else {
      // 后端没配鉴权，也放行
      router.push('/dashboard')
    }
  } catch {
    error.value = '连接失败，请检查后端服务'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-bg-base relative overflow-hidden">
    <!-- 背景装饰 -->
    <div class="absolute inset-0 overflow-hidden">
      <div class="absolute -top-40 -right-40 w-96 h-96 rounded-full bg-accent/5 blur-3xl"></div>
      <div class="absolute -bottom-40 -left-40 w-96 h-96 rounded-full bg-accent/5 blur-3xl"></div>
      <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-accent/3 blur-3xl"></div>
    </div>

    <div class="relative z-10 w-full max-w-sm">
      <!-- Logo -->
      <div class="text-center mb-8">
        <div class="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-accent/10 mb-4">
          <div class="w-5 h-5 rounded-md bg-accent"></div>
        </div>
        <h1 class="text-xl font-semibold text-gray-100">心塑 · Admin</h1>
        <p class="text-sm text-muted mt-1">心理训练引擎调试控制台</p>
      </div>

      <!-- 登录卡片 -->
      <n-card class="backdrop-blur-xl" embedded>
        <n-form @submit.prevent="handleLogin">
          <n-form-item label="用户名">
            <n-input v-model:value="form.username" placeholder="请输入用户名" autocomplete="username" />
          </n-form-item>
          <n-form-item label="密码">
            <n-input v-model:value="form.password" type="password" show-password-on="click" placeholder="请输入密码" autocomplete="current-password" />
          </n-form-item>

          <n-alert v-if="error" :show-icon="false" type="error" class="mb-4">
            {{ error }}
          </n-alert>

          <n-button
            type="primary"
            block
            :loading="loading"
            :disabled="!form.username || !form.password"
            @click="handleLogin"
          >
            {{ loading ? '登录中…' : '登 录' }}
          </n-button>
        </n-form>
      </n-card>

      <p class="text-center text-xs text-muted mt-6">
        心塑 App · 后端调试管理后台
      </p>
    </div>
  </div>
</template>

<style scoped>
/* 覆盖浏览器 autofill 默认样式 */
input:-webkit-autofill,
input:-webkit-autofill:hover,
input:-webkit-autofill:focus {
  -webkit-text-fill-color: #e5e7eb;
  -webkit-box-shadow: 0 0 0 1000px #1e222d inset;
  transition: background-color 5000s ease-in-out 0s;
}
</style>
