<script setup lang="ts">
// WP-K 批次回归页：历史批量跑场的指标时间轴 + 基线/候选回归对比（契约 §6 五条）。
// 图表分三层：层1 列表行趋势 / 规模 / 构成；层2 单批快照下钻；层3 对比报告差值。
import { ref, computed, onMounted } from 'vue'
import { NButton, NTag } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { api } from '@/api/client'
import type { BatchSummaryRow, BatchMetricsV1, CompareCandidateReport } from '@/api/types'
import EmptyState from '@/components/EmptyState.vue'
import Skeleton from '@/components/Skeleton.vue'
import BatchTrendChart from '@/components/BatchTrendChart.vue'
import BatchScaleChart from '@/components/BatchScaleChart.vue'
import BatchSnapshotPanel from '@/components/BatchSnapshotPanel.vue'
import MetricCatalogCard from '@/components/MetricCatalogCard.vue'
import MetricInfoTooltip from '@/components/MetricInfoTooltip.vue'
import CompareReportCard from '@/components/CompareReportCard.vue'
import BatchRowItem from '@/components/BatchRowItem.vue'
import { shortHash, isLegacyBatch } from '@/components/batchRegressionMeta'
import { loadMetricCatalog } from '@/components/metricCatalog'

const { t } = useI18n()

// ─── 状态 ───
const rows = ref<BatchSummaryRow[]>([])
const loading = ref(true)
const err = ref('')
const baseId = ref<string | null>(null)
const candidateIds = ref<string[]>([])
const reports = ref<CompareCandidateReport[] | null>(null)
const comparing = ref(false)
/** 是否展开 legacy（未采集快照）历史批次分组。 */
const showLegacy = ref(false)

// ─── 快照下钻（层2） ───
const snapshotId = ref<string | null>(null)
const snapshotData = ref<BatchMetricsV1 | null>(null)
const snapshotLoading = ref(false)
const snapshotErr = ref('')

/** 候选批上限（后端契约 §2.3：最多 10）。 */
const MAX_CANDIDATES = 10

// ─── 派生 ───
// 有快照、可参与对比的批次；legacy 批次收进折叠分组，不进默认视野。
const validRows = computed(() => rows.value.filter((row) => !isLegacyBatch(row)))
const legacyRows = computed(() => rows.value.filter((row) => isLegacyBatch(row)))

// 折线 / 规模图只画有数据的批次，按时间升序；列表接口默认按创建时间倒序。
const trendRows = computed(() =>
  [...validRows.value].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
)

const baseRow = computed(() => rows.value.find((r) => r.batchId === baseId.value) ?? null)

const stats = computed(() => ({
  valid: validRows.value.length,
  legacy: legacyRows.value.length,
  invalid: rows.value.filter((row) => row.valid === 0).length,
}))

const snapshotRow = computed(() => rows.value.find((r) => r.batchId === snapshotId.value) ?? null)

// ─── 选择 ───
function setBase(row: BatchSummaryRow) {
  if (isLegacyBatch(row)) return
  baseId.value = row.batchId
  candidateIds.value = candidateIds.value.filter((id) => id !== row.batchId)
}

function toggleCandidate(row: BatchSummaryRow) {
  if (isLegacyBatch(row) || row.batchId === baseId.value) return
  const idx = candidateIds.value.indexOf(row.batchId)
  if (idx >= 0) {
    candidateIds.value.splice(idx, 1)
  } else if (candidateIds.value.length < MAX_CANDIDATES) {
    candidateIds.value.push(row.batchId)
  }
}

// ─── 数据 ───
async function loadBatches() {
  loading.value = true
  err.value = ''
  try {
    // 批次量级远小于场次，首版单页加载；分页 / 排序 / 过滤参数已在 API 层预留。
    const res = await api.batchRegression.listBatches({ page: 1, pageSize: 50 })
    rows.value = res.data
  } catch (e) {
    err.value = String(e)
  } finally {
    loading.value = false
  }
}

async function runCompare() {
  if (!baseId.value || candidateIds.value.length === 0) return
  comparing.value = true
  reports.value = null
  err.value = ''
  try {
    const res = await api.batchRegression.compareBatches(baseId.value, candidateIds.value)
    reports.value = res.data
  } catch (e) {
    err.value = String(e)
  } finally {
    comparing.value = false
  }
}

// ─── 快照下钻 ───
async function openSnapshot(row: BatchSummaryRow) {
  if (isLegacyBatch(row)) return
  // 再次点击同一批 = 收起。
  if (snapshotId.value === row.batchId) {
    closeSnapshot()
    return
  }
  snapshotId.value = row.batchId
  snapshotLoading.value = true
  snapshotErr.value = ''
  snapshotData.value = null
  try {
    const res = await api.batchRegression.batchMetrics(row.batchId)
    if (res.data.legacy) {
      snapshotErr.value = t('batchRegression.reasons.metricsNotCollected')
    } else {
      snapshotData.value = res.data
    }
  } catch (e) {
    snapshotErr.value = String(e)
  } finally {
    snapshotLoading.value = false
  }
}

function closeSnapshot() {
  snapshotId.value = null
  snapshotData.value = null
  snapshotErr.value = ''
}

onMounted(() => {
  void loadMetricCatalog()
  void loadBatches()
})

function candidateRow(batchId: string): BatchSummaryRow | null {
  return rows.value.find((r) => r.batchId === batchId) ?? null
}
</script>

<template>
  <div class="p-6 max-w-7xl mx-auto">
    <!-- 标题 -->
    <div class="mb-6">
      <h1 class="text-lg font-semibold text-gray-100">{{ t('batchRegression.title') }}</h1>
      <p class="text-xs text-muted mt-1">{{ t('batchRegression.subtitle') }}</p>
    </div>

    <!-- 加载 / 错误 / 空态 -->
    <Skeleton v-if="loading" type="card-list" :count="5" />
    <EmptyState
      v-else-if="err"
      icon="warning"
      :title="t('batchRegression.errorTitle')"
      :description="err"
      :retry-text="t('batchRegression.retry')"
      :on-retry="loadBatches"
    />
    <EmptyState
      v-else-if="rows.length === 0"
      icon="doc"
      :title="t('batchRegression.emptyTitle')"
      :description="t('batchRegression.emptyDesc')"
    />

    <template v-else>
      <!-- 层1 · 批次构成统计卡 -->
      <div class="grid grid-cols-3 gap-4 mb-4">
        <div class="card p-4">
          <div class="text-xs text-muted mb-1">{{ t('batchRegression.stats.valid') }}</div>
          <div class="text-2xl font-mono font-semibold">{{ stats.valid }}</div>
        </div>
        <div class="card p-4">
          <div class="text-xs text-muted mb-1">{{ t('batchRegression.stats.legacy') }}</div>
          <div class="text-2xl font-mono font-semibold">{{ stats.legacy }}</div>
        </div>
        <div class="card p-4">
          <div class="text-xs text-muted mb-1">{{ t('batchRegression.stats.invalid') }}</div>
          <div class="text-2xl font-mono font-semibold">{{ stats.invalid }}</div>
        </div>
      </div>

      <!-- 层1 · 趋势折线 + 规模柱状图 -->
      <div class="grid grid-cols-2 gap-4 mb-4">
        <div class="card p-4">
          <h3 class="text-sm font-medium mb-3">{{ t('batchRegression.chart.trendTitle') }}</h3>
          <BatchTrendChart :rows="trendRows" />
        </div>
        <div class="card p-4">
          <h3 class="text-sm font-medium mb-3">{{ t('batchRegression.chart.scaleTitle') }}</h3>
          <BatchScaleChart :rows="trendRows" />
        </div>
      </div>

      <!-- 指标字典：验收判据 + 族目录 -->
      <MetricCatalogCard />

      <!-- 批次选择列表 -->
      <div class="card p-0 mb-4">
        <div class="hidden md:grid grid-cols-[minmax(0,1fr)_repeat(4,96px)_120px] gap-3 px-4 py-2 text-[10px] uppercase tracking-wider text-muted border-b border-border">
          <span>{{ t('batchRegression.batchColumn') }}</span>
          <span v-for="key in ['explorationRate', 'depthDeltaAvg', 'safetyDeltaAvg', 'positiveEventRate']" :key="key" class="text-right inline-flex items-center justify-end gap-1">
            {{ t(`batchRegression.metrics.${key}`) }}
            <MetricInfoTooltip :row-field="key" />
          </span>
          <span class="text-right">{{ t('batchRegression.fingerprint') }}</span>
        </div>

        <BatchRowItem
          v-for="row in validRows"
          :key="row.batchId"
          :row="row"
          :is-base="row.batchId === baseId"
          :is-candidate="candidateIds.includes(row.batchId)"
          @select-base="setBase(row)"
          @toggle-candidate="toggleCandidate(row)"
          @view-snapshot="openSnapshot(row)"
        />

        <!-- legacy 历史批次折叠组（快照未采集，不可参与对比） -->
        <template v-if="legacyRows.length > 0">
          <div
            class="flex items-center gap-2 px-4 py-3 border-t border-border/50 cursor-pointer select-none hover:bg-white/5"
            @click="showLegacy = !showLegacy"
          >
            <span class="text-muted text-xs w-3">{{ showLegacy ? '▾' : '▸' }}</span>
            <NTag size="tiny" :bordered="false" type="default">
              {{ t('batchRegression.legacyGroupTitle') }}
            </NTag>
            <span class="text-xs text-muted">({{ legacyRows.length }})</span>
          </div>
          <template v-if="showLegacy">
            <BatchRowItem
              v-for="row in legacyRows"
              :key="row.batchId"
              :row="row"
              :is-base="row.batchId === baseId"
              :is-candidate="candidateIds.includes(row.batchId)"
              @select-base="setBase(row)"
              @toggle-candidate="toggleCandidate(row)"
              @view-snapshot="openSnapshot(row)"
            />
          </template>
        </template>
      </div>

      <!-- 层2 · 单批快照下钻面板 -->
      <div v-if="snapshotId" class="card p-4 mb-4">
        <div class="flex items-center gap-3 mb-3">
          <h3 class="text-sm font-medium">{{ t('batchRegression.panel.title') }}</h3>
          <span v-if="snapshotRow" class="font-mono text-xs text-gray-200">
            {{ shortHash(snapshotRow.batchId) }}
          </span>
          <NButton size="tiny" quaternary class="ml-auto" @click="closeSnapshot">
            {{ t('batchRegression.snapshotClose') }}
          </NButton>
        </div>

        <Skeleton v-if="snapshotLoading" type="card-list" :count="3" />
        <EmptyState
          v-else-if="snapshotErr"
          icon="warning"
          :title="t('batchRegression.errorTitle')"
          :description="snapshotErr"
        />
        <BatchSnapshotPanel v-else-if="snapshotData" :snapshot="snapshotData" />
      </div>

      <!-- 对比操作栏 -->
      <div class="flex items-center gap-3 mb-4 flex-wrap">
        <span class="text-xs text-muted">
          {{ t('batchRegression.baseLabel') }}:
          <span class="font-mono text-gray-200">{{ baseRow ? shortHash(baseRow.batchId) : '—' }}</span>
        </span>
        <span class="text-xs text-muted">
          {{ t('batchRegression.candidateLabel') }}: {{ candidateIds.length }} / {{ MAX_CANDIDATES }}
        </span>
        <NButton
          type="primary"
          size="small"
          class="ml-auto"
          :loading="comparing"
          :disabled="!baseId || candidateIds.length === 0"
          @click="runCompare"
        >
          {{ comparing ? t('batchRegression.comparingButton') : t('batchRegression.compareButton') }}
        </NButton>
      </div>

      <!-- 层3 · 对比结果 -->
      <div v-if="reports" class="space-y-3">
        <CompareReportCard
          v-for="report in reports"
          :key="report.batchId"
          :report="report"
          :candidate-row="candidateRow(report.batchId)"
        />
      </div>
    </template>
  </div>
</template>
