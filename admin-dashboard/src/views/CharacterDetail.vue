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

// ─── 中英双语映射（中文为主，括号里英文浅灰辅助）───
// BDI 维度名
const bdiLabels: Record<string, { zh: string; en: string }> = {
  trust: { zh: '信任度', en: 'trust' },
  safety: { zh: '安全感', en: 'safety' },
  bond: { zh: '联结感', en: 'bond' },
  valence: { zh: '效价', en: 'valence' },
  arousal: { zh: '唤醒度', en: 'arousal' },
  resist: { zh: '阻抗', en: 'resist' },
}
// 审核状态
const auditLabels: Record<string, { zh: string; en: string }> = {
  draft: { zh: '草稿', en: 'draft' },
  approved: { zh: '已通过', en: 'approved' },
  rejected: { zh: '已拒绝', en: 'rejected' },
}
// 启用状态
const enabledLabels: Record<string, { zh: string; en: string }> = {
  enabled: { zh: '已启用', en: 'enabled' },
  disabled: { zh: '已禁用', en: 'disabled' },
}
// 依附风格（依恋类型）
const attachmentLabels: Record<string, { zh: string; en: string }> = {
  secure: { zh: '安全型', en: 'secure' },
  anxious: { zh: '焦虑型', en: 'anxious' },
  avoidant: { zh: '回避型', en: 'avoidant' },
  disorganized: { zh: '混乱型', en: 'disorganized' },
}
// 会话状态
const sessionStatusLabels: Record<string, { zh: string; en: string }> = {
  completed: { zh: '已完成', en: 'completed' },
  active: { zh: '进行中', en: 'active' },
}
</script>

<template>
  <div class="p-6 max-w-4xl mx-auto">
    <n-button size="small" quaternary class="mb-4" @click="$router.push('/characters')">{{ t('characterDetail.back') }}</n-button>
    <div v-if="loading" class="text-muted text-sm">…</div>
    <template v-else-if="data">
      <div class="flex items-center gap-2 mb-5">
        <span class="text-lg font-semibold">{{ data.codename }}</span>
        <n-tag size="small" :bordered="false">
          <template v-if="attachmentLabels[data.attachmentStyle ?? '']">
            {{ attachmentLabels[data.attachmentStyle ?? ''].zh }}
            <span class="text-muted ml-1">({{ attachmentLabels[data.attachmentStyle ?? ''].en }})</span>
          </template>
          <template v-else>{{ data.attachmentStyle ?? '—' }}</template>
        </n-tag>
        <n-tag size="small" :bordered="false" :type="data.enabled ? 'success' : 'error'">
          {{ enabledLabels[data.enabled ? 'enabled' : 'disabled'].zh }}
          <span class="text-muted ml-1">({{ enabledLabels[data.enabled ? 'enabled' : 'disabled'].en }})</span>
        </n-tag>
        <n-tag size="small" :bordered="false" :type="auditStatus === 'approved' ? 'success' : auditStatus === 'rejected' ? 'error' : 'warning'">
          <template v-if="auditLabels[auditStatus]">
            {{ auditLabels[auditStatus].zh }}
            <span class="text-muted ml-1">({{ auditLabels[auditStatus].en }})</span>
          </template>
          <template v-else>{{ auditStatus }}</template>
        </n-tag>
      </div>

      <!-- BDI 基线 -->
      <n-card :title="t('characterDetail.bdiBaseline')" size="small" class="mb-4">
        <n-grid cols="4" responsive="screen">
          <n-gi v-for="(val, key) in data.baseline" :key="key">
            <div class="text-center py-2">
              <div class="text-[11px] tracking-wider text-muted mb-1">
                <template v-if="bdiLabels[key]">
                  <span class="text-default">{{ bdiLabels[key].zh }}</span>
                  <span class="text-muted ml-1">({{ bdiLabels[key].en }})</span>
                </template>
                <template v-else>{{ key }}</template>
              </div>
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
            <n-tag size="tiny" :bordered="false" :type="s.status === 'completed' ? 'success' : 'warning'">
              <template v-if="sessionStatusLabels[s.status]">
                {{ sessionStatusLabels[s.status].zh }}
                <span class="text-muted ml-0.5">({{ sessionStatusLabels[s.status].en }})</span>
              </template>
              <template v-else>{{ s.status }}</template>
            </n-tag>
            <span class="text-xs font-mono text-muted w-16 text-right">{{ s.totalTokens }} tokens</span>
          </RouterLink>
        </div>
      </n-card>
    </template>
  </div>
</template>
