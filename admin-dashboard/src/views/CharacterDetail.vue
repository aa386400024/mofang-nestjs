<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { use } from 'echarts/core'
import { RadarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import VChart from 'vue-echarts'
import { api } from '@/api/client'
import type { CharacterDetail, CharacterSession } from '@/api/types'
import EmptyState from '@/components/EmptyState.vue'

use([RadarChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])

const { t } = useI18n()
const props = defineProps<{ slug: string }>()
const data = ref<CharacterDetail | null>(null)
const charSessions = ref<CharacterSession[]>([])
const loading = ref(true)
const err = ref('')

onMounted(async () => {
  try {
    data.value = await api.character(props.slug)
    charSessions.value = await api.characterSessions(props.slug)
  } catch (e) {
    err.value = String(e)
  } finally { loading.value = false }
})

// ─── 审核 / 数据状态标注 ───
const auditStatus = computed(() => data.value?.auditStatus ?? '—')

// ─── 中英双语映射 ───
const bdiLabels: Record<string, { zh: string; en: string }> = {
  trust: { zh: '信任度', en: 'trust' },
  safety: { zh: '安全感', en: 'safety' },
  bond: { zh: '联结感', en: 'bond' },
  valence: { zh: '效价', en: 'valence' },
  arousal: { zh: '唤醒度', en: 'arousal' },
  resist: { zh: '阻抗', en: 'resist' },
}
const auditLabels: Record<string, { zh: string; en: string }> = {
  draft: { zh: '草稿', en: 'draft' },
  approved: { zh: '已通过', en: 'approved' },
  rejected: { zh: '已拒绝', en: 'rejected' },
}
const enabledLabels: Record<string, { zh: string; en: string }> = {
  enabled: { zh: '已启用', en: 'enabled' },
  disabled: { zh: '已禁用', en: 'disabled' },
}
const attachmentLabels: Record<string, { zh: string; en: string }> = {
  secure: { zh: '安全型', en: 'secure' },
  anxious: { zh: '焦虑型', en: 'anxious' },
  avoidant: { zh: '回避型', en: 'avoidant' },
  disorganized: { zh: '混乱型', en: 'disorganized' },
}
const sessionStatusLabels: Record<string, { zh: string; en: string }> = {
  completed: { zh: '已完成', en: 'completed' },
  active: { zh: '进行中', en: 'active' },
}

// ─── 头像颜色（跟列表页统一） ───
const avatarColor = computed(() => {
  const slug = data.value?.slug ?? ''
  const colors = [
    'bg-blue-500/20 text-blue-400',
    'bg-emerald-500/20 text-emerald-400',
    'bg-amber-500/20 text-amber-400',
    'bg-rose-500/20 text-rose-400',
    'bg-indigo-500/20 text-indigo-400',
    'bg-cyan-500/20 text-cyan-400',
  ]
  let hash = 0
  for (let i = 0; i < slug.length; i++) hash = (hash * 31 + slug.charCodeAt(i)) >>> 0
  return colors[hash % colors.length]
})

// ─── 雷达图配置 ───
const radarOption = computed(() => {
  if (!data.value) return {}
  const indicators = Object.keys(bdiLabels).map(k => ({
    name: bdiLabels[k].zh,
    max: 1,
  }))
  const values = Object.keys(bdiLabels).map(k => data.value?.baseline[k] ?? 0)
  return {
    tooltip: { trigger: 'item', backgroundColor: '#1e222d', borderColor: '#2a2f3d', textStyle: { color: '#e5e7eb', fontSize: 12 } },
    radar: {
      indicator: indicators,
      shape: 'polygon',
      splitNumber: 4,
      axisName: { color: '#9ca3af', fontSize: 11 },
      splitLine: { lineStyle: { color: '#2a2f3d' } },
      splitArea: { areaStyle: { color: ['rgba(255,255,255,0.02)', 'rgba(255,255,255,0.04)'] } },
      axisLine: { lineStyle: { color: '#2a2f3d' } },
    },
    series: [{
      type: 'radar',
      data: [{
        value: values,
        name: '基线值',
        areaStyle: { color: 'rgba(200,144,168,0.3)' },
        lineStyle: { color: 'rgba(200,144,168,0.8)' },
        itemStyle: { color: 'rgba(200,144,168,1)' },
      }],
    }],
  }
})

// ─── 5P 结构映射 ───
const fivePLabels: Record<string, { zh: string; en: string }> = {
  presenting: { zh: '呈现问题', en: 'Presenting' },
  predisposing: { zh: '易感因素', en: 'Predisposing' },
  precipitating: { zh: '触发事件', en: 'Precipitating' },
  perpetuating: { zh: '维持因素', en: 'Perpetuating' },
  protecting: { zh: '保护因素', en: 'Protecting' },
}
</script>

<template>
  <div class="p-6 max-w-5xl mx-auto">
    <n-button size="small" quaternary class="mb-4" @click="$router.push('/characters')">
      ← {{ t('characterDetail.back') }}
    </n-button>

    <!-- 加载态 -->
    <EmptyState v-if="loading" icon="chart" title="加载中..." description="正在加载角色详情" />

    <!-- 错误态 -->
    <EmptyState v-else-if="err" icon="warning" title="加载失败" :description="err" />

    <template v-else-if="data">
      <!-- 顶部：头像 + 基本信息 -->
      <div class="card p-6 mb-5">
        <div class="flex items-start gap-5">
          <!-- 大头像 -->
          <div :class="['w-20 h-20 rounded-2xl flex items-center justify-center text-2xl font-bold', avatarColor]">
            {{ data.codename?.charAt(0)?.toUpperCase() ?? '?' }}
          </div>

          <div class="flex-1">
            <div class="flex items-center gap-2 mb-2">
              <span class="text-xl font-semibold text-gray-100">{{ data.codename }}</span>
              <n-tag size="small" :bordered="false">
                <template v-if="attachmentLabels[data.attachmentStyle ?? '']">
                  {{ attachmentLabels[data.attachmentStyle ?? ''].zh }}
                  <span class="text-muted ml-1">({{ attachmentLabels[data.attachmentStyle ?? ''].en }})</span>
                </template>
                <template v-else>{{ data.attachmentStyle ?? '—' }}</template>
              </n-tag>
              <n-tag size="small" :bordered="false" :type="data.enabled ? 'success' : 'error'">
                {{ enabledLabels[data.enabled ? 'enabled' : 'disabled'].zh }}
              </n-tag>
              <n-tag size="small" :bordered="false" :type="auditStatus === 'approved' ? 'success' : auditStatus === 'rejected' ? 'error' : 'warning'">
                <template v-if="auditLabels[auditStatus]">
                  {{ auditLabels[auditStatus].zh }}
                </template>
                <template v-else>{{ auditStatus }}</template>
              </n-tag>
            </div>
            <div class="text-sm text-muted">
              共 {{ data.sessionCount ?? charSessions.length }} 场历史会话
            </div>
          </div>
        </div>
      </div>

      <!-- BDI 基线：雷达图 + 数值 -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        <!-- 雷达图 -->
        <n-card title="BDI 基线雷达图" size="small">
          <VChart :option="radarOption" :autoresize="true" style="height: 280px" />
        </n-card>

        <!-- 数值列表 -->
        <n-card :title="t('characterDetail.bdiBaseline')" size="small">
          <div class="space-y-3 py-2">
            <div v-for="(val, key) in data.baseline" :key="key" class="flex items-center gap-3">
              <span class="text-xs w-20 text-gray-300">
                <template v-if="bdiLabels[key]">{{ bdiLabels[key].zh }}</template>
                <template v-else>{{ key }}</template>
              </span>
              <n-progress
                type="line"
                :percentage="Math.round(val * 100)"
                :show-text="false"
                class="flex-1"
                :color="key === 'valence' ? '#f59e0b' : '#c890a8'"
              />
              <span class="text-xs font-mono text-muted w-12 text-right">{{ val.toFixed(2) }}</span>
            </div>
          </div>
        </n-card>
      </div>

      <!-- 5P 结构 -->
      <n-card title="5P 结构分析" size="small" class="mb-5">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
          <div v-for="(val, key) in data.fivePs" :key="key" class="p-3 rounded-lg bg-bg-elevated/50">
            <div class="text-xs font-medium text-gray-300 mb-1">
              <template v-if="fivePLabels[key]">
                {{ fivePLabels[key].zh }}
                <span class="text-muted ml-1">({{ fivePLabels[key].en }})</span>
              </template>
              <template v-else>{{ key }}</template>
            </div>
            <div class="text-sm text-muted leading-relaxed">{{ val || '—' }}</div>
          </div>
        </div>
      </n-card>

      <!-- 表达风格 -->
      <n-card title="表达风格" size="small" class="mb-5">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 py-2">
          <div>
            <div class="text-xs text-muted mb-1">语速基线</div>
            <div class="text-sm font-mono">{{ data.expressionStyle?.speechVolumeBaseline ?? '—' }}</div>
          </div>
          <div>
            <div class="text-xs text-muted mb-1">叙事风格</div>
            <div class="text-sm">{{ data.expressionStyle?.narrativeStyle || '—' }}</div>
          </div>
          <div>
            <div class="text-xs text-muted mb-1">表达语气</div>
            <div class="text-sm">{{ data.expressionStyle?.expressionTone || '—' }}</div>
          </div>
        </div>
      </n-card>

      <!-- 历史会话：卡片式 -->
      <n-card v-if="charSessions.length" :title="t('characterDetail.historySessions')" size="small">
        <template #header-extra>
          <n-tag size="tiny" :bordered="false">{{ charSessions.length }}</n-tag>
        </template>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 py-2">
          <RouterLink
            v-for="s in charSessions"
            :key="s.sessionId"
            :to="`/sessions/${s.sessionId}`"
            class="p-4 rounded-lg bg-bg-elevated/50 hover:bg-bg-elevated transition"
          >
            <div class="flex items-center justify-between mb-2">
              <span class="text-sm font-medium text-gray-200">{{ s.visitorAlias }}</span>
              <n-tag size="tiny" :bordered="false" :type="s.status === 'completed' ? 'success' : 'warning'">
                <template v-if="sessionStatusLabels[s.status]">
                  {{ sessionStatusLabels[s.status].zh }}
                </template>
                <template v-else>{{ s.status }}</template>
              </n-tag>
            </div>
            <div class="text-xs text-muted font-mono">
              {{ s.startedAt }} · {{ s.totalTokens }} tokens
            </div>
          </RouterLink>
        </div>
      </n-card>
    </template>
  </div>
</template>
