<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/api/client'
import type { CharacterBaseline } from '@/api/types'
import EmptyState from '@/components/EmptyState.vue'

const { t } = useI18n()
const rows = ref<CharacterBaseline[]>([])
const loading = ref(true)
const err = ref('')

onMounted(async () => {
  try { rows.value = await api.characters() }
  catch (e) { err.value = String(e) }
  finally { loading.value = false }
})
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
    <div v-else class="card overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-bg-elevated text-muted text-xs uppercase">
          <tr>
            <th class="text-left px-4 py-2 font-medium">{{ t('characters.codename') }}</th>
            <th class="text-left px-4 py-2 font-medium">slug</th>
            <th class="text-left px-4 py-2 font-medium">{{ t('characters.attachmentStyle') }}</th>
            <th class="text-center px-4 py-2 font-medium">trust</th>
            <th class="text-center px-4 py-2 font-medium">valence</th>
            <th class="text-center px-4 py-2 font-medium">arousal</th>
            <th class="text-center px-4 py-2 font-medium">resist</th>
            <th class="text-center px-4 py-2 font-medium">{{ t('characters.enabled') }}</th>
            <th class="text-center px-4 py-2 font-medium">{{ t('characters.auditStatus') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in rows" :key="c.slug" class="border-t border-bg-border hover:bg-bg-elevated cursor-pointer"
              @click="$router.push(`/characters/${c.slug}`)">
            <td class="px-4 py-2.5 font-medium">{{ c.codename }}</td>
            <td class="px-4 py-2.5 font-mono text-xs text-muted">{{ c.slug }}</td>
            <td class="px-4 py-2.5 text-xs text-gray-300">{{ c.attachmentStyle ?? '—' }}</td>
            <td class="px-4 py-2.5 text-center font-mono text-xs">{{ c.baseline.trust.toFixed(2) }}</td>
            <td class="px-4 py-2.5 text-center font-mono text-xs">{{ c.baseline.valence.toFixed(2) }}</td>
            <td class="px-4 py-2.5 text-center font-mono text-xs">{{ c.baseline.arousal.toFixed(2) }}</td>
            <td class="px-4 py-2.5 text-center font-mono text-xs">{{ c.baseline.resist.toFixed(2) }}</td>
            <td class="px-4 py-2.5 text-center">
              <span class="chip" :class="c.enabled ? 'bg-ok/15 text-ok' : 'bg-danger/15 text-danger'">
                {{ c.enabled ? '✓' : '✗' }}
              </span>
            </td>
            <td class="px-4 py-2.5 text-center text-xs">{{ c.auditStatus ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
