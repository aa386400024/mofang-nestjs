<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { use } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import VChart from 'vue-echarts'

use([LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])

const { t } = useI18n()

// ========== 参数定义（mock，对齐内核种子值） ==========

// delta 表：事件类型 → 各维度增量
interface DeltaRow {
  kind: string
  label: string
  trust: number
  safety: number
  bond: number
  valence: number
  arousal: number
  verbal: number
  depth: number
  style: number
}

const deltaTable = ref<DeltaRow[]>([
  { kind: 'empathy', label: '共情', trust: 0.10, safety: 0.02, bond: 0.01, valence: 0.10, arousal: -0.05, verbal: -0.08, depth: -0.10, style: -0.06 },
  { kind: 'acceptance', label: '接纳', trust: 0.08, safety: 0.02, bond: 0.01, valence: 0.08, arousal: -0.04, verbal: -0.06, depth: -0.08, style: -0.05 },
  { kind: 'normalization', label: '正常化', trust: 0.07, safety: 0.01, bond: 0.01, valence: 0.07, arousal: 0, verbal: -0.05, depth: -0.07, style: -0.04 },
  { kind: 'open_probe', label: '开放探问', trust: 0.05, safety: 0.01, bond: 0, valence: 0.04, arousal: 0.02, verbal: -0.03, depth: -0.06, style: -0.03 },
  { kind: 'affirmation', label: '肯定', trust: 0.08, safety: 0.01, bond: 0.01, valence: 0.10, arousal: -0.03, verbal: -0.04, depth: -0.06, style: -0.04 },
  { kind: 'judgment', label: '评判', trust: -0.12, safety: -0.03, bond: -0.02, valence: -0.12, arousal: 0.06, verbal: 0.06, depth: 0.08, style: 0.12 },
  { kind: 'preaching', label: '说教', trust: -0.10, safety: -0.02, bond: -0.01, valence: -0.08, arousal: 0.03, verbal: 0.08, depth: 0.06, style: 0.06 },
  { kind: 'minimizing', label: '淡化', trust: -0.10, safety: -0.02, bond: -0.02, valence: -0.12, arousal: 0.04, verbal: 0.05, depth: 0.10, style: 0.05 },
  { kind: 'boundary_cross', label: '边界侵犯', trust: -0.15, safety: -0.05, bond: -0.04, valence: -0.15, arousal: 0.08, verbal: 0.04, depth: 0.05, style: 0.15 },
  { kind: 'sensitive_touch', label: '敏感议题触碰', trust: 0, safety: -0.01, bond: 0, valence: -0.05, arousal: 0.15, verbal: 0.05, depth: 0.05, style: 0.06 },
])

// cap 参数
interface CapConfig {
  dimension: string
  up: number
  down: number
}

const capConfig = ref<CapConfig[]>([
  { dimension: 'trust', up: 0.20, down: -0.30 },
  { dimension: 'safety', up: 0.20, down: -0.30 },
  { dimension: 'bond', up: 0.20, down: -0.30 },
  { dimension: 'valence', up: 0.20, down: -0.30 },
  { dimension: 'arousal', up: 0.20, down: -0.20 },
  { dimension: 'verbal', up: 0.20, down: -0.20 },
  { dimension: 'depth', up: 0.20, down: -0.20 },
  { dimension: 'style', up: 0.20, down: -0.20 },
])

// 人格调节系数
const personalityConfig = ref({
  secure: { trustMod: 1.0, resistanceMod: 1.0 },
  anxious: { trustMod: 1.3, resistanceMod: 0.8 },
  avoidant: { trustMod: 0.6, resistanceMod: 1.2 },
  disorganized: { trustMod: 0.8, resistanceMod: 1.0 },
})

// ========== 模拟对话预览 ==========

interface SimulatedTurn {
  turn: number
  counselorEvent: string
  trust: number
  safety: number
  bond: number
  valence: number
  arousal: number
  verbal: number
  depth: number
  style: number
}

const simulation = ref<SimulatedTurn[]>([])
const simulationEvents = ref<string[]>(['empathy', 'empathy', 'open_probe', 'acceptance', 'judgment', 'empathy', 'open_probe', 'affirmation'])

function runSimulation() {
  let state = { trust: 0.3, safety: 0.5, bond: 0, valence: 0, arousal: 0.3, verbal: 0.4, depth: 0.4, style: 0.35 }
  const results: SimulatedTurn[] = []

  simulationEvents.value.forEach((eventKind, i) => {
    const row = deltaTable.value.find(r => r.kind === eventKind)
    if (!row) return

    // 聚合 delta
    const delta = {
      trust: row.trust, safety: row.safety, bond: row.bond,
      valence: row.valence, arousal: row.arousal,
      verbal: row.verbal, depth: row.depth, style: row.style,
    }

    // cap
    for (const dim of Object.keys(delta) as (keyof typeof delta)[]) {
      const cap = capConfig.value.find(c => c.dimension === dim)
      if (cap) {
        if (delta[dim] > cap.up) delta[dim] = cap.up
        if (delta[dim] < cap.down) delta[dim] = cap.down
      }
    }

    // 落快照
    state = {
      trust: Math.min(1, Math.max(0, state.trust + delta.trust)),
      safety: Math.min(1, Math.max(0, state.safety + delta.safety)),
      bond: Math.min(1, Math.max(0, state.bond + delta.bond)),
      valence: Math.min(1, Math.max(-1, state.valence + delta.valence)),
      arousal: Math.min(1, Math.max(0, state.arousal + delta.arousal)),
      verbal: Math.min(1, Math.max(0, state.verbal + delta.verbal)),
      depth: Math.min(1, Math.max(0, state.depth + delta.depth)),
      style: Math.min(1, Math.max(0, state.style + delta.style)),
    }

    results.push({ turn: i + 1, counselorEvent: row.label, ...state })
  })

  simulation.value = results
}

watch([deltaTable, capConfig], () => runSimulation(), { deep: true })

onMounted(() => runSimulation())

// ========== ECharts 配置 ==========

const chartOption = computed(() => ({
  tooltip: { trigger: 'axis' },
  legend: { data: ['信任', '安全感', '纽带', '情绪效价'], bottom: 0, textStyle: { color: '#888', fontSize: 11 } },
  grid: { left: 40, right: 20, top: 20, bottom: 40 },
  xAxis: { type: 'category', data: simulation.value.map(t => `T${t.turn}`), axisLabel: { color: '#666', fontSize: 11 } },
  yAxis: { type: 'value', min: -0.3, max: 1, axisLabel: { color: '#666', fontSize: 11 } },
  series: [
    { name: t('calibrator.trust'), type: 'line', data: simulation.value.map(t => t.trust), smooth: true, lineStyle: { width: 2 } },
    { name: t('calibrator.safety'), type: 'line', data: simulation.value.map(t => t.safety), smooth: true, lineStyle: { width: 2 } },
    { name: t('calibrator.bond'), type: 'line', data: simulation.value.map(t => t.bond), smooth: true, lineStyle: { width: 2 } },
    { name: t('calibrator.valence'), type: 'line', data: simulation.value.map(t => t.valence), smooth: true, lineStyle: { width: 2 } },
  ],
}))

// ========== n-data-table 列定义 ==========

const simColumns = [
  { title: 'T', key: 'turn', width: 50, render: (row: any) => `T${row.turn}` },
  { title: '事件', key: 'counselorEvent' },
  { title: '信任', key: 'trust', align: 'right' as const, render: (row: any) => row.trust.toFixed(3) },
  { title: '安全感', key: 'safety', align: 'right' as const, render: (row: any) => row.safety.toFixed(3) },
  { title: '纽带', key: 'bond', align: 'right' as const, render: (row: any) => row.bond.toFixed(3) },
  { title: '效价', key: 'valence', align: 'right' as const, render: (row: any) => row.valence.toFixed(3) },
]

// ========== 导出配置 ==========

function exportConfig() {
  const config = {
    deltaTable: deltaTable.value,
    capConfig: capConfig.value,
    personalityConfig: personalityConfig.value,
    exportedAt: new Date().toISOString(),
  }
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `belief-config-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function resetDefaults() {
  alert(t('calibrator.resetDefaults') + '（mock）')
}
</script>

<template>
  <div class="p-6 max-w-7xl mx-auto">
    <!-- 标题 -->
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-lg font-semibold mb-1">{{ t('calibrator.title') }}</h1>
        <p class="text-sm text-muted">{{ t('calibrator.subtitle') }}</p>
      </div>
      <div class="flex gap-2">
        <n-button @click="resetDefaults">{{ t('calibrator.resetDefaults') }}</n-button>
        <n-button type="primary" @click="exportConfig">{{ t('calibrator.exportConfig') }}</n-button>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- 左列：参数面板 -->
      <div class="space-y-6">
        <!-- delta 表 -->
        <n-card :title="t('calibrator.deltaTable')" size="small">
          <p class="text-xs text-muted mb-3">{{ t('calibrator.deltaTableDesc') }}</p>
          <div class="space-y-3 max-h-96 overflow-y-auto">
            <div v-for="row in deltaTable" :key="row.kind" class="border-b border-bg-border pb-3 last:border-0">
              <div class="flex items-center justify-between mb-2">
                <span class="text-sm font-medium">{{ row.label }}</span>
                <span class="text-xs text-muted font-mono">{{ row.kind }}</span>
              </div>
              <div class="grid grid-cols-4 gap-2 text-xs">
                <div class="flex flex-col gap-1">
                  <span class="text-muted text-xs">{{ t('calibrator.trust') }}</span>
                  <n-input-number v-model:value="row.trust" :step="0.01" :min="-0.3" :max="0.3" size="small" />
                </div>
                <div class="flex flex-col gap-1">
                  <span class="text-muted text-xs">{{ t('calibrator.safety') }}</span>
                  <n-input-number v-model:value="row.safety" :step="0.01" :min="-0.1" :max="0.1" size="small" />
                </div>
                <div class="flex flex-col gap-1">
                  <span class="text-muted text-xs">{{ t('calibrator.bond') }}</span>
                  <n-input-number v-model:value="row.bond" :step="0.01" :min="-0.1" :max="0.1" size="small" />
                </div>
                <div class="flex flex-col gap-1">
                  <span class="text-muted text-xs">{{ t('calibrator.valence') }}</span>
                  <n-input-number v-model:value="row.valence" :step="0.01" :min="-0.3" :max="0.3" size="small" />
                </div>
              </div>
            </div>
          </div>
        </n-card>

        <!-- cap 参数 -->
        <n-card :title="t('calibrator.capConfig')" size="small">
          <p class="text-xs text-muted mb-3">{{ t('calibrator.capConfigDesc') }}</p>
          <div class="space-y-2">
            <div v-for="cap in capConfig" :key="cap.dimension" class="flex items-center gap-3 text-xs">
              <span class="w-16 text-muted font-mono">{{ cap.dimension }}</span>
              <div class="flex items-center gap-1 flex-1">
                <span class="text-muted">{{ t('calibrator.up') }}</span>
                <n-input-number v-model:value="cap.up" :step="0.01" :min="0" :max="0.5" size="small" class="flex-1" />
              </div>
              <div class="flex items-center gap-1 flex-1">
                <span class="text-muted">{{ t('calibrator.down') }}</span>
                <n-input-number v-model:value="cap.down" :step="0.01" :min="-0.5" :max="0" size="small" class="flex-1" />
              </div>
            </div>
          </div>
        </n-card>

        <!-- 人格调节 -->
        <n-card :title="t('calibrator.personalityConfig')" size="small">
          <p class="text-xs text-muted mb-3">{{ t('calibrator.personalityConfigDesc') }}</p>
          <div class="space-y-3">
            <div v-for="(val, key) in personalityConfig" :key="key" class="border-b border-bg-border pb-2 last:border-0">
              <div class="text-sm font-medium mb-2">{{ key }}</div>
              <div class="grid grid-cols-2 gap-2 text-xs">
                <div class="flex items-center gap-2">
                  <span class="text-muted">{{ t('calibrator.trustMod') }}</span>
                  <n-input-number v-model:value="val.trustMod" :step="0.1" :min="0.5" :max="2" size="small" class="flex-1" />
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-muted">{{ t('calibrator.resistanceMod') }}</span>
                  <n-input-number v-model:value="val.resistanceMod" :step="0.1" :min="0.5" :max="2" size="small" class="flex-1" />
                </div>
              </div>
            </div>
          </div>
        </n-card>
      </div>

      <!-- 右列：预览区 -->
      <div class="space-y-6">
        <!-- 模拟对话 -->
        <n-card :title="t('calibrator.simulation')" size="small">
          <p class="text-xs text-muted mb-3">{{ t('calibrator.simulationDesc') }}</p>

          <!-- 事件序列编辑 -->
          <div class="mb-4">
            <label class="text-xs text-muted block mb-2">{{ t('calibrator.eventSequence') }}</label>
            <n-input :value="simulationEvents.join(', ')"
                     @update:value="(v: string) => simulationEvents = v.split(',').map(s => s.trim()).filter(Boolean)"
                     size="small" />
          </div>

          <!-- 轨迹图 -->
          <v-chart :option="chartOption" class="w-full" style="height: 300px" />

          <!-- 明细表格 -->
          <n-data-table :columns="simColumns" :data="simulation" size="small" class="mt-4" :bordered="false" />
        </n-card>

        <!-- 说明卡片 -->
        <n-card :title="t('calibrator.usageGuide')" size="small">
          <ul class="text-xs text-muted space-y-1 leading-relaxed">
            <li>• {{ t('calibrator.usageGuide1') }}</li>
            <li>• {{ t('calibrator.usageGuide2') }}</li>
            <li>• {{ t('calibrator.usageGuide3') }}</li>
            <li>• {{ t('calibrator.usageGuide4') }}</li>
            <li>• {{ t('calibrator.usageGuide5') }}</li>
          </ul>
        </n-card>
      </div>
    </div>
  </div>
</template>
