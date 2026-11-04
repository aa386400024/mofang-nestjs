<script setup lang="ts">
import { ref, onMounted, h } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { api } from '@/api/client'
import type { CharacterBaseline } from '@/api/types'
import EmptyState from '@/components/EmptyState.vue'

const { t } = useI18n()
const router = useRouter()
const rows = ref<CharacterBaseline[]>([])
const loading = ref(true)
const err = ref('')

onMounted(async () => {
  try { rows.value = await api.characters() }
  catch (e) { err.value = String(e) }
  finally { loading.value = false }
})

// n-data-table 列定义
const columns = [
  {
    title: () => t('characters.codename'),
    key: 'codename',
    width: 120,
  },
  {
    title: 'slug',
    key: 'slug',
    width: 120,
  },
  {
    title: () => t('characters.attachmentStyle'),
    key: 'attachmentStyle',
    width: 120,
    render: (row: CharacterBaseline) => row.attachmentStyle ?? '—',
  },
  {
    title: 'trust',
    key: 'baseline.trust',
    width: 80,
    align: 'center' as const,
    render: (row: CharacterBaseline) => row.baseline.trust.toFixed(2),
  },
  {
    title: 'valence',
    key: 'baseline.valence',
    width: 80,
    align: 'center' as const,
    render: (row: CharacterBaseline) => row.baseline.valence.toFixed(2),
  },
  {
    title: 'arousal',
    key: 'baseline.arousal',
    width: 80,
    align: 'center' as const,
    render: (row: CharacterBaseline) => row.baseline.arousal.toFixed(2),
  },
  {
    title: 'resist',
    key: 'baseline.resist',
    width: 80,
    align: 'center' as const,
    render: (row: CharacterBaseline) => row.baseline.resist.toFixed(2),
  },
  {
    title: () => t('characters.enabled'),
    key: 'enabled',
    width: 80,
    align: 'center' as const,
    render: (row: CharacterBaseline) =>
      h('span', { class: 'chip ' + (row.enabled ? 'bg-ok/15 text-ok' : 'bg-danger/15 text-danger') }, row.enabled ? '✓' : '✗'),
  },
  {
    title: () => t('characters.auditStatus'),
    key: 'auditStatus',
    width: 100,
    align: 'center' as const,
    render: (row: CharacterBaseline) => row.auditStatus ?? '—',
  },
]
</script>

<template>
  <div class="p-6 max-w-5xl mx-auto">
    <h1 class="text-lg font-semibold mb-4">{{ t('characters.title') }}</h1>
    <EmptyState
      v-if="loading"
      icon="users"
      title="加载中…"
      description="正在获取角色池列表"
    />
    <EmptyState
      v-else-if="err"
      icon="users"
      title="加载失败"
      :description="err"
      pendingTag="Error: API 请求失败"
    />
    <EmptyState
      v-else-if="!rows.length"
      icon="users"
      title="暂无角色"
      description="角色池为空。在 character_profiles 表中添加角色后，这里会展示 BDI 基线和上下架状态。"
      pendingTag="等待角色数据"
    />
    <n-data-table
      v-else
      :columns="columns"
      :data="rows"
      :bordered="false"
      size="small"
      :row-props="(row: CharacterBaseline) => ({
        style: 'cursor: pointer;',
        onClick: () => router.push(`/characters/${row.slug}`),
      })"
    />
  </div>
</template>
