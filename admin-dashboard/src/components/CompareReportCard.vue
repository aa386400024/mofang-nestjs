<script setup lang="ts">
// WP-K 批次回归页 · 单个候选批的对比报告卡片（契约 §6.2 差分表 / §6.3 指纹段 / §6.4 incomparable 横幅）。
// 纪律：incomparable 只给警示横幅 + 原因，禁止渲染成"变好/变坏"的红绿结论。
import { computed } from 'vue'
import { NTag, NTooltip } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type {
  CompareCandidateReport,
  BatchSummaryRow,
  BatchVerdict,
  ConfigSegment,
} from '@/api/types'
import { metricLabel, formatMetric, formatDelta, shortHash } from './batchRegressionMeta'
import MetricInfoTooltip from './MetricInfoTooltip.vue'
import CompareDeltaChart from './CompareDeltaChart.vue'

const props = defineProps<{
  report: CompareCandidateReport
  candidateRow: BatchSummaryRow | null
}>()

const { t } = useI18n()

const VERDICT_TAG: Record<BatchVerdict, 'success' | 'default' | 'error' | 'warning'> = {
  improved: 'success',
  neutral: 'default',
  regressed: 'error',
  incomparable: 'warning',
}

const MOVEMENT_TAG: Record<'improved' | 'neutral' | 'regressed', 'success' | 'default' | 'error'> = {
  improved: 'success',
  neutral: 'default',
  regressed: 'error',
}

/** 快照缺失：后端 compare 推 METRICS_NOT_COLLECTED（契约 §2.3）。 */
const isLegacy = computed(() => props.report.reasons.includes('METRICS_NOT_COLLECTED'))

const incomparable = computed(() => props.report.verdict === 'incomparable')

function formatReason(reason: string): string {
  if (reason === 'METRICS_NOT_COLLECTED') return t('batchRegression.reasons.metricsNotCollected')
  return reason
}

function segmentLabel(segment: ConfigSegment): string {
  return t(`batchRegression.segments.${segment}`)
}

function formatTime(iso: string): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return iso
  }
}
</script>

<template>
  <div class="card p-4">
    <!-- 头部：结论标签 + 批次标识 + 规模时间 -->
    <div class="flex items-center gap-3 flex-wrap">
      <NTag :type="VERDICT_TAG[report.verdict]" size="small" :bordered="false">
        {{ t(`batchRegression.verdict.${report.verdict}`) }}
      </NTag>
      <span class="font-mono text-xs text-gray-200">{{ shortHash(report.batchId) }}</span>
      <NTag v-if="isLegacy" size="tiny" :bordered="false" type="default">
        {{ t('batchRegression.legacyTag') }}
      </NTag>
      <span v-if="candidateRow" class="text-xs text-muted">
        {{ candidateRow.totalSessions }} {{ t('batchRegression.sessionsUnit') }} ·
        {{ candidateRow.totalTurns }} {{ t('batchRegression.turnsUnit') }} ·
        {{ formatTime(candidateRow.createdAt) }}
      </span>
      <span v-if="candidateRow?.note" class="text-xs text-muted italic ml-auto">
        {{ candidateRow.note }}
      </span>
    </div>

    <!-- §6.4 incomparable 横幅：显式原因，不渲染好坏结论 -->
    <div
      v-if="incomparable"
      class="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3"
    >
      <div class="text-xs font-medium text-amber-300 mb-1.5">
        {{ t('batchRegression.incomparableTitle') }}
      </div>
      <ul class="space-y-1">
        <li
          v-for="(reason, i) in report.reasons"
          :key="i"
          class="text-xs text-amber-200/90 flex items-start gap-1.5"
        >
          <span class="mt-1.5 w-1 h-1 rounded-full bg-amber-400 shrink-0" />
          {{ formatReason(reason) }}
        </li>
      </ul>
    </div>

    <!-- §6.3 配置指纹变化段 -->
    <div v-if="report.changedSegments.length > 0" class="mt-3 flex items-center gap-2 flex-wrap">
      <span class="text-xs text-muted">{{ t('batchRegression.changedSegmentsTitle') }}:</span>
      <NTooltip v-for="segment in report.changedSegments" :key="segment">
        <template #trigger>
          <NTag size="tiny" :bordered="false" type="info">{{ segmentLabel(segment) }}</NTag>
        </template>
        {{ segment }}
      </NTooltip>
    </div>

    <!-- §6.2 差分表（仅可比时渲染；incomparable 不出现红绿指标结论） -->
    <div v-if="!incomparable" class="mt-3">
      <div v-if="report.items.length === 0" class="text-xs text-muted py-2">
        {{ t('batchRegression.noComparableMetrics') }}
      </div>
      <table v-else class="w-full text-xs">
        <thead>
          <tr class="text-muted border-b border-border">
            <th class="text-left font-normal py-2 pr-3">{{ t('batchRegression.colMetric') }}</th>
            <th class="text-right font-normal py-2 pr-3">{{ t('batchRegression.colBase') }}</th>
            <th class="text-right font-normal py-2 pr-3">{{ t('batchRegression.colCandidate') }}</th>
            <th class="text-right font-normal py-2 pr-3">{{ t('batchRegression.colDelta') }}</th>
            <th class="text-right font-normal py-2">{{ t('batchRegression.colMovement') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in report.items" :key="item.metricId" class="border-b border-border/50 last:border-0">
            <td class="py-2 pr-3 text-gray-200">
              {{ metricLabel(item.metricId) }}
              <MetricInfoTooltip :metric-id="item.metricId" />
            </td>
            <td class="py-2 pr-3 text-right font-mono">{{ formatMetric(item.base) }}</td>
            <td class="py-2 pr-3 text-right font-mono">{{ formatMetric(item.candidate) }}</td>
            <td class="py-2 pr-3 text-right font-mono">{{ formatDelta(item.delta) }}</td>
            <td class="py-2 text-right">
              <NTag :type="MOVEMENT_TAG[item.movement]" size="tiny" :bordered="false">
                {{ t(`batchRegression.movement.${item.movement}`) }}
              </NTag>
            </td>
          </tr>
        </tbody>
      </table>
      <CompareDeltaChart
        v-if="report.items.some((item) => item.delta !== null)"
        :report="report"
        class="mt-3"
      />
    </div>
  </div>
</template>
