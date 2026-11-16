<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { NTag } from 'naive-ui'
import { api } from '@/api/client'
import type { EvalReportListItem, EvalReportStatus } from '@/api/types'
import EmptyState from '@/components/EmptyState.vue'
import InfoTooltip from '@/components/InfoTooltip.vue'
import Skeleton from '@/components/Skeleton.vue'

// ─── 状态 ───
const reports = ref<EvalReportListItem[]>([])
const total = ref(0)
const loading = ref(true)
const err = ref('')
const expandedId = ref<string | null>(null)

// 筛选
const filterStatus = ref<'' | EvalReportStatus>('')
const page = ref(1)
const pageSize = 20

// ─── 状态标签 ───
function statusTagType(status: EvalReportStatus): 'success' | 'warning' | 'error' {
  switch (status) {
    case 'ok': return 'success'
    case 'degraded': return 'warning'
    case 'failed': return 'error'
    default: return 'default'
  }
}

function statusLabel(status: EvalReportStatus): string {
  switch (status) {
    case 'ok': return '正常'
    case 'degraded': return '降级'
    case 'failed': return '失败'
    default: return status
  }
}

// ─── 加载 ───
async function loadData() {
  loading.value = true
  err.value = ''
  try {
    const res = await api.evalReports({
      page: page.value,
      pageSize,
      status: filterStatus.value || undefined,
    })
    reports.value = res.items
    total.value = res.total
  } catch (e) {
    err.value = String(e)
  } finally {
    loading.value = false
  }
}

onMounted(loadData)
watch([filterStatus, page], () => {
  if (filterStatus.value) page.value = 1
  loadData()
})

// ─── 统计卡片 ───
const stats = computed(() => {
  const list = reports.value
  const total = list.length
  const ok = list.filter(r => r.status === 'ok').length
  const degraded = list.filter(r => r.status === 'degraded').length
  const failed = list.filter(r => r.status === 'failed').length
  const f1Values = list.map(r => r.triggerF1).filter((v): v is number => v != null)
  const avgF1 = f1Values.length ? f1Values.reduce((a, b) => a + b, 0) / f1Values.length : 0
  return { total, ok, degraded, failed, avgF1 }
})

// ─── 展开/收起 ───
function toggleExpand(id: string) {
  expandedId.value = expandedId.value === id ? null : id
}

// ─── 时间格式化 ───
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

// ─── F1 颜色 ───
function f1Color(f1: number | null): string {
  if (f1 == null) return 'text-muted'
  if (f1 >= 0.8) return 'text-emerald-400'
  if (f1 >= 0.6) return 'text-amber-400'
  return 'text-red-400'
}
</script>

<template>
  <div class="p-6 max-w-7xl mx-auto">
    <!-- 标题 -->
    <div class="mb-6">
      <h1 class="text-lg font-semibold text-gray-100">评测质量看板</h1>
      <p class="text-xs text-muted mt-1">
        离线批量评测报告：触发 F1、方向准确率、基线对比告警，追踪引擎调参后的质量变化。
      </p>
    </div>

    <!-- 统计卡片 -->
    <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
      <div class="card p-4">
        <div class="text-[10px] uppercase tracking-wider text-muted mb-1">报告总数</div>
        <div class="font-mono text-lg text-gray-100">{{ stats.total }}</div>
      </div>
      <div class="card p-4">
        <div class="text-[10px] uppercase tracking-wider text-muted mb-1">正常</div>
        <div class="font-mono text-lg text-emerald-400">{{ stats.ok }}</div>
      </div>
      <div class="card p-4">
        <div class="text-[10px] uppercase tracking-wider text-muted mb-1">降级</div>
        <div class="font-mono text-lg text-amber-400">{{ stats.degraded }}</div>
      </div>
      <div class="card p-4">
        <div class="text-[10px] uppercase tracking-wider text-muted mb-1">失败</div>
        <div class="font-mono text-lg text-red-400">{{ stats.failed }}</div>
      </div>
      <div class="card p-4">
        <div class="text-[10px] uppercase tracking-wider text-muted mb-1 flex items-center">
          平均触发 F1
          <InfoTooltip text="闸门触发准确率：F1 >= 0.8 为健康，0.6-0.8 需关注，<0.6 告警" />
        </div>
        <div class="font-mono text-lg" :class="f1Color(stats.avgF1 || null)">
          {{ stats.avgF1 ? stats.avgF1.toFixed(3) : '—' }}
        </div>
      </div>
    </div>

    <!-- 筛选栏 -->
    <div class="flex flex-wrap gap-3 mb-4">
      <n-select
        v-model:value="filterStatus"
        :options="[
          { label: '全部状态', value: '' },
          { label: '正常', value: 'ok' },
          { label: '降级', value: 'degraded' },
          { label: '失败', value: 'failed' },
        ]"
        size="small"
        class="w-36"
      />
      <div class="flex items-center gap-2 text-xs text-muted ml-auto">
        <InfoTooltip text="数据来自 eval_reports 表，每次离线评测跑完落一份" />
        <span>数据口径</span>
      </div>
    </div>

    <!-- 加载/错误/空态 -->
    <Skeleton v-if="loading" type="card-list" :count="5" />
    <EmptyState
      v-else-if="err"
      icon="warning"
      title="加载失败"
      :description="err"
      retry-text="重试"
      @retry="loadData"
    />
    <EmptyState
      v-else-if="reports.length === 0"
      icon="doc"
      title="暂无评测报告"
      description="跑一次离线批量评测后，这里会显示质量指标和基线对比"
    />

    <!-- 报告列表 -->
    <div v-else class="space-y-2">
      <div
        v-for="report in reports"
        :key="report.id"
        class="card p-0 cursor-pointer hover:border-accent/40 transition-colors"
        @click="toggleExpand(report.id)"
      >
        <!-- 头部行 -->
        <div class="flex items-center gap-3 px-4 py-3">
          <NTag :type="statusTagType(report.status)" size="small" bordered="false">
            {{ statusLabel(report.status) }}
          </NTag>
          <span class="text-xs text-muted">{{ report.datasetVersion }}</span>
          <NTag v-if="report.mode === 'full'" size="tiny" bordered="false" type="info">full</NTag>
          <span class="text-sm text-gray-300">
            触发 F1 <span :class="f1Color(report.triggerF1)">{{ report.triggerF1?.toFixed(3) ?? '—' }}</span>
          </span>
          <span v-if="report.warningCount > 0" class="text-xs text-amber-400">
            {{ report.warningCount }} 条告警
          </span>
          <span class="text-xs text-muted ml-auto">{{ formatTime(report.createdAt) }}</span>
          <n-icon size="12" class="text-muted transition-transform" :class="{ 'rotate-180': expandedId === report.id }">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </n-icon>
        </div>

        <!-- 展开详情 -->
        <div v-if="expandedId === report.id" class="px-4 pb-4 pt-0 border-t border-border">
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 pt-3 text-sm">
            <div>
              <div class="text-xs text-muted mb-1">报告 ID</div>
              <div class="text-gray-300 font-mono text-xs break-all">{{ report.reportId }}</div>
            </div>
            <div>
              <div class="text-xs text-muted mb-1">方向准确率</div>
              <div class="text-gray-300 font-mono text-xs">
                {{ report.directionAccuracy?.toFixed(3) ?? '—' }}
              </div>
            </div>
            <div>
              <div class="text-xs text-muted mb-1">成本</div>
              <div class="text-gray-300 font-mono text-xs">
                {{ report.costCny != null ? '¥' + report.costCny.toFixed(4) : '—' }}
              </div>
            </div>
            <div>
              <div class="text-xs text-muted mb-1">告警数</div>
              <div class="text-gray-300">{{ report.warningCount }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 分页 -->
    <div v-if="total > pageSize" class="flex justify-center mt-6">
      <n-pagination
        v-model:page="page"
        :page-count="Math.ceil(total / pageSize)"
        size="small"
      />
    </div>
  </div>
</template>
