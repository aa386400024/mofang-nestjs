<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api } from '@/api/client'
import type { CharacterBaseline } from '@/api/types'

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
    <h1 class="text-lg font-semibold mb-4">角色池</h1>
    <div v-if="loading" class="text-muted text-sm">加载中…</div>
    <div v-else-if="err" class="text-danger text-sm">{{ err }}</div>
    <div v-else class="card overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-bg-elevated text-muted text-xs uppercase">
          <tr>
            <th class="text-left px-4 py-2 font-medium">代号</th>
            <th class="text-left px-4 py-2 font-medium">slug</th>
            <th class="text-left px-4 py-2 font-medium">依恋</th>
            <th class="text-right px-4 py-2 font-medium">trust</th>
            <th class="text-right px-4 py-2 font-medium">resist</th>
            <th class="text-right px-4 py-2 font-medium">valence</th>
            <th class="text-right px-4 py-2 font-medium">arousal</th>
            <th class="text-left px-4 py-2 font-medium">状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in rows" :key="c.slug" class="border-t border-bg-border">
            <td class="px-4 py-2.5 font-medium">{{ c.codename }}</td>
            <td class="px-4 py-2.5 font-mono text-xs text-muted">{{ c.slug }}</td>
            <td class="px-4 py-2.5"><span class="chip bg-bg-elevated text-accent">{{ c.attachmentType }}</span></td>
            <td class="px-4 py-2.5 text-right font-mono text-xs">{{ c.trust.toFixed(2) }}</td>
            <td class="px-4 py-2.5 text-right font-mono text-xs">{{ c.resistance.toFixed(2) }}</td>
            <td class="px-4 py-2.5 text-right font-mono text-xs">{{ c.valence.toFixed(2) }}</td>
            <td class="px-4 py-2.5 text-right font-mono text-xs">{{ c.arousal.toFixed(2) }}</td>
            <td class="px-4 py-2.5"><span class="chip bg-bg-elevated text-ok">{{ c.status }}</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
