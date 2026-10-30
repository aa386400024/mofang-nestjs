<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { SafetyVerdict } from '@/api/types'

const { t } = useI18n()
defineProps<{ verdict: SafetyVerdict | null }>()

const levelColor = (l: string) =>
  l === 'block' ? 'text-danger border-danger/50'
  : l === 'warn' ? 'text-warn border-warn/50'
  : 'text-ok border-ok/30'
</script>

<template>
  <div v-if="verdict" class="card p-4">
    <h2 class="text-xs uppercase tracking-wider text-muted mb-3">{{ t('sessionDetail.safety') }}</h2>
    <div class="space-y-2 text-sm">
      <div class="flex items-center justify-between">
        <span class="text-muted">{{ t('sessionDetail.rule') }}</span>
        <span class="chip" :class="levelColor(verdict.ruleLevel)">{{ verdict.ruleLevel }}</span>
      </div>
      <div v-if="(verdict.ruleCategories ?? []).length" class="text-xs text-muted ml-4">
        {{ (verdict.ruleCategories ?? []).join(', ') }}
      </div>
      <div class="flex items-center justify-between">
        <span class="text-muted">{{ t('sessionDetail.psyguard') }}</span>
        <span class="chip" :class="verdict.probeLevel ? levelColor(verdict.probeLevel) : 'text-muted'">
          {{ verdict.probeLevel ?? t('sessionDetail.notCalled') }}
        </span>
      </div>
      <div v-if="(verdict.probeCategories ?? []).length" class="text-xs text-muted ml-4">
        {{ (verdict.probeCategories ?? []).join(', ') }}
        <span v-if="verdict.probeScore !== null" class="ml-2 font-mono">score={{ verdict.probeScore?.toFixed(2) }}</span>
      </div>
      <div class="border-t border-bg-border pt-2 flex items-center justify-between">
        <span class="text-muted font-medium">{{ t('sessionDetail.final') }}</span>
        <span class="chip" :class="levelColor(verdict.level)">{{ verdict.level }}</span>
      </div>
      <div v-if="(verdict.finalCategories ?? []).length" class="text-xs text-muted ml-4">
        {{ (verdict.finalCategories ?? []).join(', ') }}
      </div>
    </div>
  </div>
</template>
