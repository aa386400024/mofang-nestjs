<template>
  <div class="h-full flex flex-col bg-bg-surface rounded-lg border border-bg-border min-w-0">
    <!-- 头部 -->
    <div class="flex items-center justify-between px-3 py-2.5 border-b border-bg-border">
      <div class="flex items-center gap-2">
        <button
          class="w-7 h-7 flex items-center justify-center rounded-md text-muted hover:text-accent hover:bg-bg-elevated transition-colors"
          @click="$emit('collapse')"
          title="收起会话列表"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
            <line x1="9" x2="9" y1="3" y2="21"/>
          </svg>
        </button>
        <span class="text-sm font-medium text-text-primary">会话历史</span>
      </div>
      <button
        class="w-7 h-7 flex items-center justify-center rounded-md text-muted hover:text-accent hover:bg-bg-elevated transition-colors"
        @click="loadSessions"
        :disabled="loading"
        title="刷新"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :class="{ 'animate-spin': loading }">
          <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
          <path d="M21 3v5h-5"/>
          <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
          <path d="M8 16H3v5"/>
        </svg>
      </button>
    </div>

    <!-- 会话列表 -->
    <div class="flex-1 overflow-auto p-2 space-y-1">
      <div v-if="sessions.length === 0 && !loading" class="text-xs text-muted text-center py-12">
        <div class="flex flex-col items-center gap-2 opacity-60">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <span>暂无历史会话</span>
        </div>
      </div>

      <div
        v-for="session in sessions"
        :key="session.id"
        class="group rounded-lg border transition-all cursor-pointer"
        :class="[
          selectedId === session.id
            ? 'border-accent/40 bg-accent/5'
            : 'border-transparent hover:border-bg-border hover:bg-bg-elevated'
        ]"
        :title="session.characterSlug"
        @click="$emit('select', session.id)"
      >
        <div class="px-3 py-2.5 flex items-start gap-2.5">
          <!-- 角色色块头像 -->
          <div
            class="w-7 h-7 rounded-md flex items-center justify-center text-xs font-medium flex-shrink-0 mt-0.5"
            :style="{ background: avatarColor(session.characterSlug), color: '#fff' }"
          >
            {{ avatarInitial(session.characterSlug) }}
          </div>

          <!-- 内容区 -->
          <div class="flex-1 min-w-0">
            <!-- 标题行 -->
            <div class="text-sm text-text-primary truncate font-medium leading-6">
              {{ session.title || '未命名会话' }}
            </div>
            <!-- 元信息行：只放轮次 + 时间，slug 由头像颜色区分，hover title 提示 -->
            <div class="text-xs text-muted mt-0.5 flex items-center gap-1.5">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              <span>{{ session.turnCount }} 轮</span>
              <span class="text-muted/40">·</span>
              <span>{{ formatTime(session.updatedAt) }}</span>
            </div>
          </div>

          <!-- hover 操作 -->
          <div class="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 pt-0.5">
            <button
              class="w-6 h-6 flex items-center justify-center rounded text-muted hover:text-accent hover:bg-bg-surface transition-colors"
              @click.stop="openEditDialog(session)"
              title="编辑标题"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
              </svg>
            </button>
            <button
              class="w-6 h-6 flex items-center justify-center rounded text-muted hover:text-danger hover:bg-bg-surface transition-colors"
              @click.stop="confirmDelete(session)"
              title="删除"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6h18"/>
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                <line x1="10" x2="10" y1="11" y2="17"/>
                <line x1="14" x2="14" y1="11" y2="17"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 编辑标题 Modal -->
    <NModal
      v-model:show="editDialogVisible"
      preset="card"
      title="编辑会话标题"
      style="width: 400px"
      :bordered="false"
    >
      <NInput
        v-model:value="editTitleValue"
        placeholder="输入会话标题"
        @keyup.enter="submitEdit"
        autofocus
      />
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton size="small" @click="editDialogVisible = false">取消</NButton>
          <NButton size="small" type="primary" :loading="editLoading" @click="submitEdit">保存</NButton>
        </div>
      </template>
    </NModal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { NButton, NModal, NInput, useDialog, useMessage } from 'naive-ui'
import { api } from '@/api/client'

interface DebugSessionSummary {
  id: string
  title: string
  characterSlug: string
  createdAt: string
  updatedAt: string
  turnCount: number
}

defineProps<{
  selectedId: string | null
}>()

const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'collapse'): void
}>()

const message = useMessage()
const dialog = useDialog()
const sessions = ref<DebugSessionSummary[]>([])
const loading = ref(false)

// 编辑标题 Modal 状态
const editDialogVisible = ref(false)
const editTitleValue = ref('')
const editTargetId = ref<string | null>(null)
const editLoading = ref(false)

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

function openEditDialog(session: DebugSessionSummary) {
  editTargetId.value = session.id
  editTitleValue.value = session.title || ''
  editDialogVisible.value = true
}

async function submitEdit() {
  if (!editTargetId.value) return
  const newTitle = editTitleValue.value.trim()
  editLoading.value = true
  try {
    await api.debugSession.update(editTargetId.value, newTitle)
    const session = sessions.value.find(s => s.id === editTargetId.value)
    if (session) session.title = newTitle
    message.success('标题已更新')
    editDialogVisible.value = false
  } catch (e) {
    message.error('更新标题失败')
    console.error(e)
  } finally {
    editLoading.value = false
  }
}

function confirmDelete(session: DebugSessionSummary) {
  dialog.warning({
    title: '删除会话',
    content: `确定删除「${session.title || '未命名会话'}」吗？此操作不可恢复。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await api.debugSession.remove(session.id)
        sessions.value = sessions.value.filter(s => s.id !== session.id)
        message.success('会话已删除')
      } catch (e) {
        message.error('删除失败')
        console.error(e)
      }
    },
  })
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

// 角色 slug → 首字母（头像显示）
function avatarInitial(slug: string): string {
  if (!slug) return '?'
  return slug.charAt(0).toUpperCase()
}

// 角色 slug → 稳定的色调（hash 后选一组低饱和色）
function avatarColor(slug: string): string {
  const palette = [
    '#7c8db5',
    '#9b8ab5',
    '#7ab59e',
    '#c2957e',
    '#b57e9b',
    '#8ab5c2',
  ]
  let hash = 0
  for (let i = 0; i < slug.length; i++) {
    hash = (hash * 31 + slug.charCodeAt(i)) >>> 0
  }
  return palette[hash % palette.length]
}

onMounted(() => {
  loadSessions()
})

defineExpose({ loadSessions })
</script>
