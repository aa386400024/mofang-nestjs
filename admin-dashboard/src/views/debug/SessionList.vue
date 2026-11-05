<template>
  <div class="h-full flex flex-col bg-bg-surface rounded-lg border border-bg-border min-w-0">
    <!-- 头部 -->
    <div class="flex items-center justify-between px-3 py-2 border-b border-bg-border">
      <div class="flex items-center gap-2">
        <button
          class="w-6 h-6 flex items-center justify-center rounded text-muted hover:text-accent hover:bg-bg-elevated"
          @click="$emit('collapse')"
          title="收起会话列表"
        >
          ☰
        </button>
        <span class="text-sm font-medium text-text-primary">会话历史</span>
      </div>
      <NButton size="tiny" quaternary @click="loadSessions" :loading="loading">
        刷新
      </NButton>
    </div>

    <!-- 会话列表 -->
    <div class="flex-1 overflow-auto p-2 space-y-1">
      <div v-if="sessions.length === 0 && !loading" class="text-xs text-muted text-center py-8">
        暂无历史会话
      </div>

      <div
        v-for="session in sessions"
        :key="session.id"
        class="group rounded-lg border border-transparent hover:border-bg-border hover:bg-bg-elevated cursor-pointer transition-all"
        :class="selectedId === session.id ? 'border-accent/30 bg-accent/5' : ''"
        @click="$emit('select', session.id)"
      >
        <div class="px-3 py-2">
          <!-- 标题行 -->
          <div class="flex items-center justify-between gap-2">
            <div class="text-sm text-text-primary truncate flex-1">
              {{ session.title || '未命名会话' }}
            </div>
            <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                class="w-5 h-5 flex items-center justify-center rounded text-muted hover:text-accent"
                @click.stop="editTitle(session)"
                title="编辑标题"
              >
                ✏️
              </button>
              <button
                class="w-5 h-5 flex items-center justify-center rounded text-muted hover:text-danger"
                @click.stop="deleteSession(session.id)"
                title="删除"
              >
                🗑️
              </button>
            </div>
          </div>
          <!-- 元信息行 -->
          <div class="text-xs text-muted mt-1 flex gap-2">
            <span>{{ session.characterSlug }}</span>
            <span>·</span>
            <span>{{ session.turnCount }} 轮</span>
            <span>·</span>
            <span>{{ formatTime(session.updatedAt) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { NButton, useMessage } from 'naive-ui'
import { api } from '@/api/client'

interface DebugSessionSummary {
  id: string
  title: string
  characterSlug: string
  createdAt: string
  updatedAt: string
  turnCount: number
}

const props = defineProps<{
  selectedId: string | null
}>()

const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'collapse'): void
}>()

const message = useMessage()
const sessions = ref<DebugSessionSummary[]>([])
const loading = ref(false)

async function loadSessions() {
  loading.value = true
  try {
    const data = await api.debugSession.list()
    sessions.value = data
  } catch (e) {
    message.error('加载会话列表失败')
    console.error(e)
  } finally {
    loading.value = false
  }
}

async function editTitle(session: DebugSessionSummary) {
  const newTitle = prompt('编辑会话标题', session.title || '')
  if (newTitle === null) return
  try {
    await api.debugSession.update(session.id, newTitle)
    session.title = newTitle
    message.success('标题已更新')
  } catch (e) {
    message.error('更新标题失败')
    console.error(e)
  }
}

async function deleteSession(id: string) {
  if (!confirm('确定删除这个会话吗？')) return
  try {
    await api.debugSession.remove(id)
    sessions.value = sessions.value.filter(s => s.id !== id)
    message.success('会话已删除')
  } catch (e) {
    message.error('删除失败')
    console.error(e)
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天前`
  return d.toLocaleDateString()
}

onMounted(() => {
  loadSessions()
})

defineExpose({ loadSessions })
</script>
