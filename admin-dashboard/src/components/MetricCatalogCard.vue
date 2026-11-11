<script setup lang="ts">
// WP-K 批次回归页 · 指标字典汇总卡：验收判据表（8 条 intake 档）+ 指标族目录摘要。
// 目录运行时从后端 /metrics/catalog 拉取（本地兜底）；本卡只展示说明，不复算验收结论。
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { getExpectationList, getCatalogMeta, catalogTick, expectationText } from './metricCatalog'
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
const expectationList = computed(() => {
  void catalogTick.value
  return getExpectationList()
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
