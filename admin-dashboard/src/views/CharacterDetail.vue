<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/api/client'
import type { CharacterDetail, CharacterSession } from '@/api/types'

const { t } = useI18n()
const props = defineProps<{ slug: string }>()
const data = ref<CharacterDetail | null>(null)
const charSessions = ref<CharacterSession[]>([])
const loading = ref(true)

onMounted(async () => {
  try {
    data.value = await api.character(props.slug)
    charSessions.value = await api.characterSessions(props.slug)
  }
  finally { loading.value = false }
})

// ─── 审核 / 数据状态标注 ───
// 数据源是真 API (WP30): 后端从 character_profiles 直接返回 auditStatus 真值
// (draft / approved / rejected) —— 只有 approved 会被引擎 resolver 命中.
// 这里**原样显示**后端值, 不再自己造一个 "pending" 兜底:
// 之前那层兜底是给 mock 用的 (mock 里没有这个字段), 现在字段有真值了,
// 再兜一层反而会把"后端没给"和"后端给了 draft"混成同一个提示.
const auditStatus = computed(() => data.value?.auditStatus ?? '—')
</script>

<template>
  <div class="p-6 max-w-4xl mx-auto">
    <n-button size="small" quaternary class="mb-4" @click="$router.push('/characters')">{{ t('characterDetail.back') }}</n-button>
    <div v-if="loading" class="text-muted text-sm">…</div>
    <template v-else-if="data">
      <div class="flex items-center gap-2 mb-5">
        <span class="text-lg font-semibold">{{ data.codename }}</span>
        <n-tag size="small" :bordered="false">{{ data.attachmentStyle ?? '—' }}</n-tag>
        <n-tag size="small" :bordered="false" :type="data.enabled ? 'success' : 'error'">
          {{ data.enabled ? 'enabled' : 'disabled' }}
        </n-tag>
        <n-tag size="small" :bordered="false" :type="auditStatus === 'approved' ? 'success' : auditStatus === 'rejected' ? 'error' : 'warning'">
          {{ auditStatus }}
        </n-tag>
      </div>

      <!-- BDI 基线 -->
      <n-card :title="t('characterDetail.bdiBaseline')" size="small" class="mb-4">
        <n-grid cols="4" responsive="screen">
          <n-gi v-for="(val, key) in data.baseline" :key="key">
            <div class="text-center py-2">
              <div class="text-[10px] uppercase tracking-wider text-muted mb-1">{{ key }}</div>
              <div class="font-mono text-lg">{{ val.toFixed(2) }}</div>
            </div>
          </n-gi>
        </n-grid>
      </n-card>

      <!-- 历史会话 -->
      <n-card v-if="charSessions.length" :title="t('characterDetail.historySessions')" size="small" class="mt-4" :header-style="{ paddingBottom: '8px' }">
        <template #header-extra>
          <n-tag size="tiny" :bordered="false">{{ charSessions.length }}</n-tag>
        </template>
        <div class="space-y-1.5">
          <RouterLink v-for="s in charSessions" :key="s.sessionId"
                     :to="`/sessions/${s.sessionId}`"
                     class="flex items-center gap-3 p-2.5 rounded hover:bg-bg-elevated transition">
            <span class="text-xs font-mono text-muted w-24">{{ s.startedAt }}</span>
            <span class="text-xs flex-1">{{ s.visitorAlias }}</span>
            <n-tag size="tiny" :bordered="false" :type="s.status === 'completed' ? 'success' : 'warning'">{{ s.status }}</n-tag>
            <span class="text-xs font-mono text-muted w-16 text-right">{{ s.totalTokens }} tokens</span>
          </RouterLink>
        </div>
      </n-card>
    </template>
  </div>
</template>
