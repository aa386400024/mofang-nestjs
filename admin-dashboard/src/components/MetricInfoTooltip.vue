<script setup lang="ts">
// WP-K 批次回归页 · 指标说明浮层：口径 / 单位 / 取值域 / 方向 / 验收区间与临床依据。
// 目录运行时从后端拉取（本地兜底）；未登记指标不渲染入口。
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { getMetricInfo, getMetricInfoByRowField, expectationText, catalogTick, type MetricDirection, type MetricInfo, type MetricUnit } from './metricCatalog'

const props = defineProps<{
  /** 快照指标 id（优先）。 */
  metricId?: string
  /** 前端列表行字段名（趋势表头用）。 */
  rowField?: string
}>()

const { t } = useI18n()

const info = computed<MetricInfo | null>(() => {
  void catalogTick.value
  if (props.metricId) return getMetricInfo(props.metricId)
  if (props.rowField) return getMetricInfoByRowField(props.rowField)
  return null
})

const DIRECTION_CLASS: Record<MetricDirection, string> = {
  higher_is_better: 'text-ok',
  lower_is_better: 'text-error',
  neutral: 'text-muted',
}

function unitText(unit: MetricUnit): string {
  return t(`batchRegression.catalog.unit.${unit}`)
}

function boundsText(bounds: [number, number] | null): string {
  if (!bounds) return t('batchRegression.catalog.unbounded')
  return `[${bounds[0]}, ${bounds[1]}]`
}
</script>

<template>
  <span v-if="info" class="relative inline-flex items-center group cursor-help align-middle">
    <svg class="w-3 h-3 text-muted group-hover:text-accent transition-colors" fill="currentColor" viewBox="0 0 20 20">
      <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" />
    </svg>
    <span class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 px-3 py-2.5 rounded-lg bg-bg-elevated border border-border text-left shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
      <div class="flex items-center gap-2 mb-1.5">
        <span class="text-xs font-medium text-gray-100">{{ info.label }}</span>
        <span class="text-[10px] uppercase tracking-wide" :class="DIRECTION_CLASS[info.direction]">
          {{ t(`batchRegression.catalog.direction.${info.direction}`) }}
        </span>
      </div>
      <div class="text-[11px] text-gray-300 leading-relaxed mb-1.5">{{ info.definition }}</div>
      <div class="text-[11px] text-muted">
        {{ t('batchRegression.catalog.unitLabel') }}：{{ unitText(info.unit) }}
        · {{ t('batchRegression.catalog.boundsLabel') }}：{{ boundsText(info.bounds) }}
      </div>
      <div v-if="info.expectation" class="mt-2 pt-2 border-t border-border/50">
        <div class="text-[11px] text-gray-300">
          {{ t('batchRegression.catalog.expectationLabel') }}：<span class="font-mono">{{ expectationText(info.expectation) }}</span>
        </div>
        <div class="text-[11px] text-muted leading-relaxed mt-1">{{ info.expectation.rationale }}</div>
      </div>
      <div v-else class="mt-2 pt-2 border-t border-border/50 text-[11px] text-muted">
        {{ t('batchRegression.catalog.noExpectation') }}
      </div>
    </span>
  </span>
</template>
