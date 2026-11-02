<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/api/client'
import type { CharacterBaseline } from '@/api/types'

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
    <div v-if="loading" class="text-muted text-sm">…</div>
    <div v-else-if="err" class="text-danger text-sm">{{ err }}</div>
    <div v-else-if="!rows.length" class="text-muted text-sm">—</div>
    <div v-else class="card overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-bg-elevated text-muted text-xs uppercase">
          <tr>
            <th class="text-left px-4 py-2 font-medium">{{ t('characters.codename') }}</th>
            <th class="text-left px-4 py-2 font-medium">{{ t('characters.slug') }}</th>
            <th class="text-left px-4 py-2 font-medium">{{ t('characters.complaint') }}</th>
            <th class="text-left px-4 py-2 font-medium">{{ t('characters.defense') }}</th>
            <th class="text-left px-4 py-2 font-medium">{{ t('characters.issue') }}</th>
            <th class="text-center px-4 py-2 font-medium">{{ t('characters.difficulty') }}</th>
            <th class="text-right px-4 py-2 font-medium">{{ t('characters.emotionBaseline') }}</th>
            <th class="text-right px-4 py-2 font-medium">{{ t('characters.defenseLevel') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in rows" :key="c.slug" class="border-t border-bg-border hover:bg-bg-elevated cursor-pointer"
              @click="$router.push(`/characters/${c.slug}`)">
            <td class="px-4 py-2.5 font-medium">{{ c.codename }}</td>
            <td class="px-4 py-2.5 font-mono text-xs text-muted">{{ c.slug }}</td>
            <td class="px-4 py-2.5 text-xs text-gray-300 max-w-[200px] truncate">{{ c.presentingComplaint }}</td>
            <td class="px-4 py-2.5"><span class="chip bg-bg-elevated text-accent">{{ c.defenseType }}</span></td>
            <td class="px-4 py-2.5 text-xs text-muted">{{ c.issueDomain }}</td>
            <td class="px-4 py-2.5 text-center font-mono text-xs">{{ c.difficulty }}</td>
            <td class="px-4 py-2.5 text-right font-mono text-xs">{{ c.emotionBaseline.toFixed(2) }}</td>
            <td class="px-4 py-2.5 text-right font-mono text-xs">{{ c.defenseLevel.toFixed(2) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
