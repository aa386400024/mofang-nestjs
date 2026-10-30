<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { ReportDetail } from '@/api/types'
import DimensionsRadar from './DimensionsRadar.vue'

const { t } = useI18n()
defineProps<{ report: ReportDetail }>()

const dimLabels: Record<string, string> = {
  empathy: t('report.dimensions.empathy'),
  activeListening: t('report.dimensions.activeListening'),
  questioning: t('report.dimensions.questioning'),
  boundary: t('report.dimensions.boundary'),
  response: t('report.dimensions.response'),
  professionalism: t('report.dimensions.professionalism'),
}

const annoColor = (ty: string) =>
  ty === 'good' ? 'border-ok/40 bg-ok/5'
  : ty === 'warn' ? 'border-warn/40 bg-warn/5'
  : 'border-danger/40 bg-danger/5'
</script>

<template>
  <div class="mt-4 card p-5">
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-xs uppercase tracking-wider text-muted">{{ t('sessionDetail.report') }}</h2>
      <span class="chip" :class="report.status === 'completed' ? 'bg-ok/10 text-ok' : 'bg-warn/10 text-warn'">
        {{ report.status }}
      </span>
    </div>

    <!-- 六维雷达 -->
    <div v-if="report.dimensions" class="mb-4">
      <DimensionsRadar :dimensions="report.dimensions" :labels="dimLabels" />
    </div>

    <!-- annotations -->
    <div v-if="(report.annotations ?? []).length" class="space-y-2">
      <div v-for="(a, i) in (report.annotations ?? [])" :key="i"
           class="rounded border p-3" :class="annoColor(a.type)">
        <div class="flex items-center gap-2 mb-1">
          <span class="text-[10px] font-mono uppercase" :class="a.type === 'good' ? 'text-ok' : a.type === 'warn' ? 'text-warn' : 'text-danger'">
            {{ a.type === 'good' ? t('report.good') : a.type === 'warn' ? t('report.warn') : t('report.error') }}
          </span>
          <span class="text-[10px] text-muted">{{ a.category }}</span>
        </div>
        <p class="text-sm text-gray-200">{{ a.message }}</p>
        <p v-if="a.suggestion" class="text-xs text-muted mt-1">→ {{ a.suggestion }}</p>
      </div>
    </div>

    <!-- techStats 折叠 -->
    <details v-if="report.techStats" class="mt-3">
      <summary class="text-xs text-muted cursor-pointer hover:text-gray-300">{{ t('sessionDetail.techStats') }}</summary>
      <pre class="text-[10px] text-muted mt-2 font-mono bg-bg-base/50 rounded p-2 overflow-x-auto">{{ JSON.stringify(report.techStats, null, 2) }}</pre>
    </details>

    <div v-if="!report.dimensions && !(report.annotations ?? []).length && !report.techStats" class="text-sm text-muted">
      {{ t('sessionDetail.noReport') }}
    </div>
  </div>
</template>
