<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '@/api/client'
import type { CharacterBaseline } from '@/api/types'
import EmptyState from '@/components/EmptyState.vue'
import { NTag, NPagination } from 'naive-ui'
import { use } from 'echarts/core'
import { RadarChart } from 'echarts/charts'
import { TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import VChart from 'vue-echarts'

use([RadarChart, TooltipComponent, CanvasRenderer])

const router = useRouter()
const rows = ref<CharacterBaseline[]>([])
const loading = ref(true)
const err = ref('')

// ─── 分页 (前端假分页, 后端补分页参数后切换成真分页) ───
const page = ref(1)
const pageSize = 12

const pagedRows = computed(() => {
  const start = (page.value - 1) * pageSize
  return rows.value.slice(start, start + pageSize)
})

// ─── 审核状态映射 ───
const auditTypeMap: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
  approved: 'success',
  draft: 'warning',
  rejected: 'error',
}
const auditLabelMap: Record<string, string> = {
  approved: '已通过',
  draft: '草稿',
  rejected: '已拒绝',
}

// ─── 依恋类型映射 ───
const attachmentLabels: Record<string, string> = {
  secure: '安全型',
  anxious: '焦虑型',
  avoidant: '回避型',
  disorganized: '混乱型',
}

// ─── 头像颜色 (跟 AutoPractice 同款哈希逻辑) ───
const avatarColors = ['#7c8db5', '#7ab59e', '#b59e7c', '#9e7cb5', '#7cb5b5', '#b57c8d', '#8db57c', '#b57c9e']
function avatarColor(slug: string): string {
  let hash = 0
  for (let i = 0; i < slug.length; i++) hash = (hash * 31 + slug.charCodeAt(i)) & 0xffff
  return avatarColors[hash % avatarColors.length]
}

// BDI 指标的迷你进度条 (0-1 范围)
function miniBar(value: number): string {
  return `${Math.min(Math.max(value * 100, 0), 100)}%`
}

// 生成单个角色的迷你雷达图 option
// 只放 0~1 的"程度类"维度: 信任 / 唤醒 / 阻抗
// 效价 [-1,1] 有正负方向, 不放进雷达图, 单独做情绪刻度尺
function radarOption(char: CharacterBaseline) {
  const trust = Math.round(char.baseline.trust * 100)
  const arousal = Math.round(char.baseline.arousal * 100)
  const resist = Math.round(char.baseline.resist * 100)

  return {
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(30, 30, 40, 0.95)',
      borderColor: '#404050',
      textStyle: { color: '#e0e0e0', fontSize: 12 },
      formatter: () => {
        return `
          <div style="font-size:12px;">
            <div style="margin-bottom:4px;color:#9ca3af;">BDI 基线</div>
            <div>信任: <b>${(trust / 100).toFixed(2)}</b></div>
            <div>唤醒: <b>${(arousal / 100).toFixed(2)}</b></div>
            <div>阻抗: <b>${(resist / 100).toFixed(2)}</b></div>
          </div>
        `
      },
    },
    radar: {
      indicator: [
        { name: '信任', max: 100 },
        { name: '唤醒', max: 100 },
        { name: '阻抗', max: 100 },
      ],
      radius: '68%',
      center: ['50%', '56%'],
      splitNumber: 3,
      axisName: { color: '#9ca3af', fontSize: 10 },
      splitLine: { lineStyle: { color: '#2a2f3d' } },
      splitArea: { areaStyle: { color: ['transparent'] } },
      axisLine: { lineStyle: { color: '#2a2f3d' } },
    },
    series: [{
      type: 'radar',
      data: [{
        value: [trust, arousal, resist],
        areaStyle: { color: 'rgba(124, 141, 181, 0.3)' },
        lineStyle: { color: '#7c8db5', width: 1.5 },
        itemStyle: { color: '#7c8db5' },
        symbolSize: 3,
      }],
    }],
  }
}

// 效价 → 情绪刻度尺位置百分比 (-1 → 0%, 0 → 50%, +1 → 100%)
function valencePosition(valence: number): string {
  return `${((valence + 1) / 2) * 100}%`
}
// 效价颜色: 负红 正绿
function valenceColor(valence: number): string {
  if (valence < -0.2) return '#f87171'
  if (valence > 0.2) return '#4ade80'
  return '#9ca3af'
}

onMounted(async () => {
  try { rows.value = await api.characters() }
  catch (e) { err.value = String(e) }
  finally { loading.value = false }
})

function openDetail(slug: string) {
  router.push(`/characters/${slug}`)
}
</script>

<template>
  <div class="p-6 max-w-7xl mx-auto">
    <!-- 标题栏 -->
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-xl font-bold text-gray-100">角色池</h1>
        <p class="text-sm text-gray-500 mt-1">引擎角色基线 · 只有「已通过」且启用的角色才会被 resolver 命中</p>
      </div>
      <div class="text-sm text-gray-500 font-mono">
        共 {{ rows.length }} 个角色
      </div>
    </div>

    <!-- 加载态 -->
    <EmptyState
      v-if="loading"
      icon="users"
      title="加载中…"
      description="正在获取角色池列表"
    />

    <!-- 错误态 -->
    <EmptyState
      v-else-if="err"
      icon="users"
      title="加载失败"
      :description="err"
      pendingTag="Error: API 请求失败"
    />

    <!-- 空态 -->
    <EmptyState
      v-else-if="!rows.length"
      icon="users"
      title="暂无角色"
      description="角色池为空。在 character_profiles 表中添加角色后，这里会展示 BDI 基线和上下架状态。"
      pendingTag="等待角色数据"
    />

    <!-- 卡片网格 -->
    <template v-else>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        <div
          v-for="char in pagedRows"
          :key="char.slug"
          class="group bg-gray-800/40 rounded-xl border border-gray-700/40 overflow-hidden cursor-pointer transition-all duration-200 hover:bg-gray-800/70 hover:border-gray-600/60 hover:shadow-lg hover:shadow-black/20 hover:-translate-y-0.5"
          @click="openDetail(char.slug)"
        >
          <!-- 卡片头部: 头像 + 名字 + slug -->
          <div class="p-4 pb-3">
            <div class="flex items-center gap-3">
              <!-- 头像 -->
              <div
                class="w-11 h-11 rounded-lg flex items-center justify-center text-base font-semibold text-white flex-shrink-0"
                :style="{ background: avatarColor(char.slug) }"
              >
                {{ char.codename?.slice(0, 1) || char.slug.slice(0, 1).toUpperCase() }}
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-sm font-semibold text-gray-100 truncate">
                  {{ char.codename || char.slug }}
                </div>
                <div class="text-xs text-gray-500 font-mono truncate mt-0.5">
                  {{ char.slug }}
                </div>
              </div>
            </div>
          </div>

          <!-- 状态标签行 -->
          <div class="px-4 pb-3 flex flex-wrap gap-1.5">
            <NTag
              size="tiny"
              :bordered="false"
              :type="auditTypeMap[char.auditStatus ?? ''] || 'default'"
            >
              {{ auditLabelMap[char.auditStatus ?? ''] || char.auditStatus || '—' }}
            </NTag>
            <NTag
              size="tiny"
              :bordered="false"
              :type="char.enabled ? 'success' : 'error'"
            >
              {{ char.enabled ? '已启用' : '已禁用' }}
            </NTag>
            <NTag v-if="char.attachmentStyle" size="tiny" :bordered="false" type="info">
              {{ attachmentLabels[char.attachmentStyle] || char.attachmentStyle }}
            </NTag>
          </div>

          <!-- BDI 画像区: 雷达图(程度维度) + 效价情绪刻度尺(方向维度) -->
          <div class="px-4 pb-4 pt-2">
            <VChart
              :option="radarOption(char)"
              :autoresize="true"
              style="height: 140px"
            />
            <!-- 效价情绪刻度尺: 左红(负面) — 中灰(中性) — 右绿(正面) -->
            <div class="mt-1 px-1">
              <div class="flex items-center justify-between text-[9px] text-muted mb-1">
                <span>情绪基调</span>
                <span class="font-mono" :style="{ color: valenceColor(char.baseline.valence) }">
                  {{ char.baseline.valence > 0 ? '+' : '' }}{{ char.baseline.valence.toFixed(2) }}
                </span>
              </div>
              <div class="relative h-1.5 rounded-full bg-gradient-to-r from-red-500/40 via-gray-600/40 to-green-500/40">
                <!-- 中间中性刻度线 -->
                <div class="absolute left-1/2 top-0 bottom-0 w-px bg-gray-500/60 -translate-x-1/2" />
                <!-- 指针圆点 -->
                <div
                  class="absolute top-1/2 w-2.5 h-2.5 rounded-full border-2 border-white shadow"
                  :style="{
                    left: valencePosition(char.baseline.valence),
                    transform: 'translate(-50%, -50%)',
                    background: valenceColor(char.baseline.valence),
                  }"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 分页 -->
      <div v-if="rows.length > pageSize" class="mt-6 flex justify-center">
        <NPagination
          v-model:page="page"
          :page-size="pageSize"
          :item-count="rows.length"
          show-size-picker={false}
          show-quick-jumper={false}
        />
      </div>
    </template>
  </div>
</template>
