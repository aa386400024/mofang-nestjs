<script setup lang="ts">
// WP-K 批次回归页 · 指标字典汇总卡：验收判据表（按咨询师模式分档）+ 指标族目录摘要。
// 目录运行时从后端 /metrics/catalog 拉取（本地兜底）；本卡只展示说明，不复算验收结论。
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { getExpectationList, getTierList, getCatalogMeta, catalogTick, expectationText } from './metricCatalog'
import type { TierView } from './metricCatalog'
import { metricLabel } from './batchRegressionMeta'

const { t } = useI18n()

const FAMILIES = [
  'dimensions',
  'events',
  'strategies',
  'outcomes',
  'scalars',
]

// 引用 catalogTick 建立响应依赖：远端目录加载完成后重算判据表与版本标注。
const tiers = computed(() => {
  void catalogTick.value
  return getTierList()
})

const selectedTierId = ref('baseline')

const currentTier = computed<TierView | null>(
  () => tiers.value.find((t) => t.id === selectedTierId.value) ?? tiers.value[0] ?? null,
)

const expectationList = computed(() => {
  void catalogTick.value
  return currentTier.value ? getExpectationList(currentTier.value.id) : []
})

const catalogMeta = computed(() => {
  void catalogTick.value
  return getCatalogMeta()
})
</script>

<template>
  <div class="card p-4 mb-4">
    <h3 class="text-sm font-medium mb-2">{{ t('batchRegression.catalog.cardTitle') }}</h3>
    <p class="text-xs text-muted mb-3">{{ t('batchRegression.catalog.cardDesc') }}</p>
    <div v-if="catalogMeta.dictionaryVersion" class="text-[11px] text-muted mb-3">
      {{ t('batchRegression.catalog.versionLabel') }}：{{ catalogMeta.dictionaryVersion }} · {{ catalogMeta.acceptanceVersion }}
      <span :class="catalogMeta.source === 'remote' ? 'text-ok' : 'text-warning'">
        ({{ t(`batchRegression.catalog.source.${catalogMeta.source}`) }})
      </span>
    </div>

    <!-- 判据档位切换 -->
    <div class="flex items-center gap-2 mb-2 flex-wrap">
      <span class="text-xs text-muted">{{ t('batchRegression.catalog.tierTitle') }}</span>
      <button
        v-for="tier in tiers"
        :key="tier.id"
        class="px-2 py-0.5 rounded text-xs border"
        :class="tier.id === selectedTierId ? 'border-gray-400 text-gray-200' : 'border-border/60 text-muted'"
        @click="selectedTierId = tier.id"
      >
        {{ tier.label }}
      </button>
    </div>
    <div v-if="currentTier" class="text-[11px] text-muted mb-3 flex items-center gap-2 flex-wrap">
      <span v-if="currentTier.provisional" class="chip text-warning">{{ t('batchRegression.catalog.tierProvisional') }}</span>
      <span>{{ currentTier.note }}</span>
    </div>

    <!-- 验收判据表 -->
    <div class="text-xs text-muted mb-2">{{ t('batchRegression.catalog.expectationTitle') }}</div>
    <table class="w-full text-xs mb-4">
      <thead>
        <tr class="text-muted border-b border-border">
          <th class="text-left font-normal py-2 pr-3">{{ t('batchRegression.catalog.colMetric') }}</th>
          <th class="text-left font-normal py-2 pr-3">{{ t('batchRegression.catalog.colKind') }}</th>
          <th class="text-left font-normal py-2 pr-3">{{ t('batchRegression.catalog.colRange') }}</th>
          <th class="text-left font-normal py-2">{{ t('batchRegression.catalog.colRationale') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="entry in expectationList" :key="entry.metricId" class="border-b border-border/50 last:border-0">
          <td class="py-2 pr-3 text-gray-200">{{ metricLabel(entry.metricId) }}</td>
          <td class="py-2 pr-3 text-muted">{{ t(`batchRegression.catalog.kind.${entry.expectation.kind}`) }}</td>
          <td class="py-2 pr-3 font-mono">{{ expectationText(entry.expectation) }}</td>
          <td class="py-2 text-muted">{{ entry.expectation.rationale }}</td>
        </tr>
      </tbody>
    </table>

    <!-- 指标族目录摘要 -->
    <div class="text-xs text-muted mb-2">{{ t('batchRegression.catalog.familyTitle') }}</div>
    <div class="grid grid-cols-5 gap-3">
      <div v-for="family in FAMILIES" :key="family" class="rounded-lg border border-border/60 p-3">
        <div class="text-xs font-medium text-gray-200 mb-1">{{ t(`batchRegression.catalog.family.${family}`) }}</div>
        <div class="text-[11px] text-muted">{{ t(`batchRegression.catalog.familyDesc.${family}`) }}</div>
      </div>
    </div>
  </div>
</template>
