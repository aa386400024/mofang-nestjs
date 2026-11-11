<script setup lang="ts">
// WP-K 批次回归页 · 批次列表行（有效批与 legacy 历史批复用同一行模板）。
import { NButton, NCheckbox, NTag } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { BatchSummaryRow } from '@/api/types'
import { formatMetric, shortHash, formatBatchTime, isLegacyBatch } from './batchRegressionMeta'

const props = defineProps<{
  row: BatchSummaryRow
  /** 是否当前基线批。 */
  isBase: boolean
  /** 是否已勾选为候选批。 */
  isCandidate: boolean
}>()

const emit = defineEmits<{
  'select-base': []
  'toggle-candidate': []
  'view-snapshot': []
}>()

const { t } = useI18n()

const legacy = isLegacyBatch(props.row)
const selectable = !legacy
</script>

<template>
  <div
    class="grid grid-cols-[minmax(0,1fr)_repeat(4,96px)_120px] gap-3 items-center px-4 py-3 border-b border-border/50 last:border-0"
    :class="{ 'opacity-50': legacy }"
  >
    <!-- 标识 + 选择 -->
    <div class="min-w-0">
      <div class="flex items-center gap-2 flex-wrap">
        <NCheckbox
          :checked="isCandidate"
          :disabled="!selectable || isBase"
          @update:checked="emit('toggle-candidate')"
        />
        <NButton
          size="tiny"
          :quaternary="!isBase"
          :type="isBase ? 'primary' : 'default'"
          :disabled="!selectable"
          @click="emit('select-base')"
        >
          {{ isBase ? t('batchRegression.baselineTag') : t('batchRegression.setBaseline') }}
        </NButton>
        <span class="font-mono text-xs text-gray-200">{{ shortHash(row.batchId) }}</span>
        <NButton v-if="selectable" size="tiny" quaternary @click="emit('view-snapshot')">
          {{ t('batchRegression.snapshotButton') }}
        </NButton>
        <NTag v-if="row.valid === 0" size="tiny" :bordered="false" type="warning">
          {{ t('batchRegression.validInvalid') }}
        </NTag>
        <NTag v-if="legacy" size="tiny" :bordered="false" type="default">
          {{ t('batchRegression.legacyTag') }}
        </NTag>
      </div>
      <div class="text-xs text-muted mt-1">
        {{ row.totalSessions }} {{ t('batchRegression.sessionsUnit') }} ·
        {{ row.totalTurns }} {{ t('batchRegression.turnsUnit') }} ·
        {{ formatBatchTime(row.createdAt) }}
        <span v-if="row.note" class="italic"> · {{ row.note }}</span>
      </div>
    </div>

    <!-- 四个冗余标量 -->
    <span class="text-right font-mono text-xs">{{ formatMetric(row.explorationRate) }}</span>
    <span class="text-right font-mono text-xs">{{ formatMetric(row.depthDeltaAvg) }}</span>
    <span class="text-right font-mono text-xs">{{ formatMetric(row.safetyDeltaAvg) }}</span>
    <span class="text-right font-mono text-xs">{{ formatMetric(row.positiveEventRate) }}</span>

    <!-- 指纹 -->
    <span class="text-right font-mono text-xs text-muted" :title="row.configFingerprint ?? ''">
      {{ shortHash(row.configFingerprint) }}
    </span>
  </div>
</template>
