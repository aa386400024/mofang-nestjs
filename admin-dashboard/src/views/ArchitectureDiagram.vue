<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { use } from 'echarts/core'
import { GraphChart } from 'echarts/charts'
import { TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import VChart from 'vue-echarts'

use([GraphChart, TooltipComponent, LegendComponent, CanvasRenderer])

const { t } = useI18n()

// ========== 架构图数据 ==========
// 七层架构，从下到上（y 越小越靠上）

interface ArchNode {
  id: string
  name: string
  x: number
  y: number
  layer: number
  desc: string
  status: 'done' | 'in-progress' | 'planned'
}

interface ArchLink {
  source: string
  target: string
  label?: string
}

// 层定义（y 坐标中心）
const layers = [
  { id: 7, name: '⑦ 观测与调优层', y: 80, color: '#8b5cf6', desc: 'trace / AB / 参数校准 / 调试面板' },
  { id: 6, name: '⑥ 伦理安全层', y: 200, color: '#ef4444', desc: '规则 → 模型探测 → 会后审计' },
  { id: 5, name: '⑤ 渲染调度层', y: 320, color: '#f59e0b', desc: '结构化意图 → 口语化 / 语音 / 语气' },
  { id: 4, name: '④ 记忆系统层', y: 440, color: '#10b981', desc: '三级记忆 + 召回策略 + 遗忘曲线' },
  { id: 3, name: '③ 关系与情绪层', y: 560, color: '#06b6d4', desc: '同盟三维 + 移情 + 情绪动态' },
  { id: 2, name: '② BDI 推理层', y: 680, color: '#3b82f6', desc: '信念 / 愿望 / 意图完整循环' },
  { id: 1, name: '① 纯层内核', y: 800, color: '#6366f1', desc: '状态定义 / 纯函数算子 / 端口契约' },
]

// 节点定义
const nodes: ArchNode[] = [
  // ⑦ 观测与调优层 (y=80)
  { id: 'debug-panel', name: '调试面板', x: 150, y: 80, layer: 7, desc: '每轮 BDI delta trace / prompt 快照', status: 'in-progress' },
  { id: 'trace-system', name: 'Trace 系统', x: 350, y: 80, layer: 7, desc: '整场会话完整 trace，可回放对比', status: 'planned' },
  { id: 'ab-test', name: 'AB 实验', x: 550, y: 80, layer: 7, desc: '参数 A/B 对比，效果差异分析', status: 'planned' },
  { id: 'param-calibrate', name: '参数校准工具', x: 750, y: 80, layer: 7, desc: '心理咨询师可视化调参，不用改代码', status: 'planned' },
  { id: 'quality-assess', name: '质量评估', x: 950, y: 80, layer: 7, desc: '自动输出仿真质量分', status: 'planned' },

  // ⑥ 伦理安全层 (y=200)
  { id: 'rule-safety', name: '规则禁言', x: 200, y: 200, layer: 6, desc: '输入侧规则阻断，高危词检测', status: 'done' },
  { id: 'psyguard', name: 'PsyGUARD 探测', x: 400, y: 200, layer: 6, desc: 'RoBERTa 模型实时风险探测', status: 'done' },
  { id: 'output-verify', name: '输出侧校验', x: 600, y: 200, layer: 6, desc: 'AI 输出也过校验，不诱导自伤', status: 'planned' },
  { id: 'post-audit', name: '会后审计', x: 800, y: 200, layer: 6, desc: '伦理标签全留痕，高风险场次标记', status: 'planned' },

  // ⑤ 渲染调度层 (y=320)
  { id: 'spec-assembler', name: 'Spec 组装', x: 150, y: 320, layer: 5, desc: 'BDI 状态 → 结构化渲染意图', status: 'done' },
  { id: 'expression-style', name: '表达风格', x: 350, y: 320, layer: 5, desc: '阻抗-表达映射 / 口语化 / 非语言', status: 'planned' },
  { id: 'emotion-granularity', name: '情绪粒度', x: 550, y: 320, layer: 5, desc: '细颗粒情绪表达，不是粗标签', status: 'planned' },
  { id: 'tts-render', name: 'TTS 渲染', x: 750, y: 320, layer: 5, desc: '语音合成 / 语气词 / 停顿', status: 'in-progress' },

  // ④ 记忆系统层 (y=440)
  { id: 'working-memory', name: '工作记忆', x: 150, y: 440, layer: 4, desc: '最近 8 轮滑窗 + 注意焦点', status: 'done' },
  { id: 'session-summary', name: '会话记忆', x: 380, y: 440, layer: 4, desc: '滚动摘要 + 最终摘要（WP37/55/61）', status: 'in-progress' },
  { id: 'long-term-memory', name: '长时记忆', x: 610, y: 440, layer: 4, desc: 'Qdrant 向量召回 + 遗忘曲线', status: 'in-progress' },
  { id: 'recall-strategy', name: '召回策略', x: 840, y: 440, layer: 4, desc: 'Top-K + 时间衰减 + 冲突消解', status: 'planned' },

  // ③ 关系与情绪层 (y=560)
  { id: 'alliance-3d', name: '同盟三维', x: 150, y: 560, layer: 3, desc: 'trust / safety / bond 独立建模', status: 'done' },
  { id: 'transference', name: '移情系统', x: 370, y: 560, layer: 3, desc: '正/负/依赖三态，触发式演化', status: 'in-progress' },
  { id: 'emotion-dynamic', name: '情绪动态', x: 590, y: 560, layer: 3, desc: '离散情绪 + 效价/唤醒 + 传导性', status: 'in-progress' },
  { id: 'decay-cross-session', name: '跨会话衰减', x: 810, y: 560, layer: 3, desc: '情绪/阻抗/同盟差异化半衰期', status: 'done' },

  // ② BDI 推理层 (y=680)
  { id: 'belief-layer', name: '信念层', x: 150, y: 680, layer: 2, desc: '核心信念 / 短期信念 / 记忆信念', status: 'in-progress' },
  { id: 'desire-layer', name: '愿望层', x: 380, y: 680, layer: 2, desc: '底层愿望 + 情境愿望生成', status: 'planned' },
  { id: 'intention-layer', name: '意图层', x: 610, y: 680, layer: 2, desc: '多策略权衡选择，不是规则映射', status: 'planned' },
  { id: 'personality-op', name: '人格调节算子', x: 840, y: 680, layer: 2, desc: '依恋调节 + 人格特质调节（WP34）', status: 'done' },

  // ① 纯层内核 (y=800)
  { id: 'state-model', name: '状态模型', x: 150, y: 800, layer: 1, desc: 'BDI 状态值语义，readonly', status: 'done' },
  { id: 'pure-operators', name: '纯函数算子', x: 380, y: 800, layer: 1, desc: '事件 → delta → 状态迁移', status: 'done' },
  { id: 'delta-cap', name: 'Delta Cap', x: 610, y: 800, layer: 1, desc: '单回合非对称上限，防跳变', status: 'done' },
  { id: 'ports', name: '端口契约', x: 840, y: 800, layer: 1, desc: 'LLM / 日志 / env 注入端口', status: 'done' },
]

// 连线定义
const links: ArchLink[] = [
  // 内核 → BDI 推理层
  { source: 'state-model', target: 'belief-layer' },
  { source: 'pure-operators', target: 'belief-layer' },
  { source: 'pure-operators', target: 'desire-layer' },
  { source: 'delta-cap', target: 'belief-layer' },
  { source: 'personality-op', target: 'belief-layer' },

  // BDI 推理层 → 关系与情绪层
  { source: 'belief-layer', target: 'alliance-3d' },
  { source: 'belief-layer', target: 'emotion-dynamic' },
  { source: 'intention-layer', target: 'alliance-3d' },
  { source: 'transference', target: 'alliance-3d' },

  // 关系与情绪层 → 记忆系统层
  { source: 'alliance-3d', target: 'session-summary' },
  { source: 'emotion-dynamic', target: 'long-term-memory' },
  { source: 'decay-cross-session', target: 'long-term-memory' },

  // 记忆系统层 → 渲染调度层
  { source: 'working-memory', target: 'spec-assembler' },
  { source: 'session-summary', target: 'spec-assembler' },
  { source: 'long-term-memory', target: 'spec-assembler' },
  { source: 'recall-strategy', target: 'spec-assembler' },

  // 渲染调度层 → 伦理安全层
  { source: 'spec-assembler', target: 'output-verify' },
  { source: 'tts-render', target: 'output-verify' },

  // 伦理安全层 → 观测调优层
  { source: 'rule-safety', target: 'post-audit' },
  { source: 'psyguard', target: 'post-audit' },
  { source: 'output-verify', target: 'post-audit' },

  // 跨层连线
  { source: 'spec-assembler', target: 'debug-panel' },
  { source: 'belief-layer', target: 'debug-panel' },
  { source: 'alliance-3d', target: 'trace-system' },
]

// 状态颜色
const statusColor: Record<string, string> = {
  done: '#10b981',      // 绿色 - 已完成
  'in-progress': '#f59e0b',  // 橙色 - 进行中
  planned: '#6b7280',    // 灰色 - 规划中
}

const statusLabel: Record<string, string> = {
  done: '已完成',
  'in-progress': '进行中',
  planned: '规划中',
}

// ========== ECharts 配置 ==========
const chartRef = ref()

const option = ref({
  tooltip: {
    trigger: 'item',
    formatter: (params: any) => {
      if (params.dataType === 'node') {
        const node = nodes.find(n => n.id === params.data.id)
        if (!node) return params.name
        return `
          <div style="font-weight:600;margin-bottom:4px">${node.name}</div>
          <div style="color:#666;font-size:12px">${node.desc}</div>
          <div style="margin-top:4px;font-size:11px;color:${statusColor[node.status]}">
            ● ${statusLabel[node.status]}
          </div>
        `
      }
      return ''
    },
  },
  legend: {
    data: [
      { name: '已完成', icon: 'circle' },
      { name: '进行中', icon: 'circle' },
      { name: '规划中', icon: 'circle' },
    ],
    bottom: 10,
    textStyle: { color: '#888', fontSize: 12 },
  },
  series: [
    {
      type: 'graph',
      layout: 'none',
      symbolSize: [120, 40],
      symbol: 'roundRect',
      roam: true,
      label: {
        show: true,
        color: '#fff',
        fontSize: 12,
        fontWeight: 500,
      },
      edgeSymbol: ['none', 'arrow'],
      edgeSymbolSize: 6,
      lineStyle: {
        color: '#4b5563',
        width: 1.5,
        curveness: 0.1,
        opacity: 0.6,
      },
      emphasis: {
        lineStyle: {
          width: 2.5,
          opacity: 0.9,
        },
      },
      data: nodes.map(n => ({
        id: n.id,
        name: n.name,
        x: n.x,
        y: n.y,
        itemStyle: {
          color: layers.find(l => l.id === n.layer)?.color + 'cc',
          borderColor: statusColor[n.status],
          borderWidth: 2,
          borderRadius: 6,
        },
      })),
      links: links.map(l => ({
        source: l.source,
        target: l.target,
      })),
    },
  ],
  // 自定义层背景（用 graphic 组件画）
  graphic: layers.map(l => ({
    type: 'rect',
    left: 50,
    shape: {
      x: 50,
      y: l.y - 45,
      width: 1050,
      height: 90,
      r: 8,
    },
    style: {
      fill: l.color + '11',
      stroke: l.color + '44',
      lineWidth: 1,
      dash: [4, 4],
    },
  })),
})

// 层标签（用 graphic text）
const layerLabels = layers.map(l => ({
  type: 'text',
  right: 30,
  top: l.y - 12,
  style: {
    text: l.name,
    fill: l.color,
    fontSize: 13,
    fontWeight: 600,
    textAlign: 'right',
  },
}))

// 把层标签合并进 graphic
option.value.graphic = [...(option.value.graphic as any[]), ...layerLabels]

// 完成度统计
const layerProgress = [
  { layer: '① 纯层内核', percent: 90, color: '#6366f1' },
  { layer: '② BDI 推理层', percent: 30, color: '#3b82f6' },
  { layer: '③ 关系与情绪层', percent: 50, color: '#06b6d4' },
  { layer: '④ 记忆系统层', percent: 40, color: '#10b981' },
  { layer: '⑤ 渲染调度层', percent: 25, color: '#f59e0b' },
  { layer: '⑥ 伦理安全层', percent: 60, color: '#ef4444' },
  { layer: '⑦ 观测调优层', percent: 20, color: '#8b5cf6' },
]

const overallProgress = 40
</script>

<template>
  <div class="p-6 max-w-7xl mx-auto">
    <!-- 标题 -->
    <div class="mb-6">
      <h1 class="text-lg font-semibold mb-2">{{ t('arch.title') }}</h1>
      <p class="text-sm text-muted">{{ t('arch.subtitle') }}</p>
    </div>

    <!-- 进度概览卡片 -->
    <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-6">
      <div class="bg-bg-surface border border-bg-border rounded-lg p-3 text-center">
        <div class="text-2xl font-bold text-accent">{{ overallProgress }}%</div>
        <div class="text-xs text-muted mt-1">{{ t('arch.overallProgress') }}</div>
      </div>
      <div v-for="item in layerProgress" :key="item.layer"
           class="bg-bg-surface border border-bg-border rounded-lg p-3">
        <div class="text-xs text-muted mb-1">{{ item.layer }}</div>
        <div class="flex items-center gap-2">
          <div class="flex-1 h-1.5 bg-bg-elevated rounded-full overflow-hidden">
            <div class="h-full rounded-full"
                 :style="{ width: item.percent + '%', backgroundColor: item.color }"></div>
          </div>
          <span class="text-xs font-mono" :style="{ color: item.color }">{{ item.percent }}%</span>
        </div>
      </div>
    </div>

    <!-- 架构图 -->
    <div class="bg-bg-surface border border-bg-border rounded-lg p-4">
      <v-chart ref="chartRef" :option="option" class="w-full" style="height: 900px" />
    </div>

    <!-- 说明 -->
    <div class="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
      <div class="bg-bg-surface border border-bg-border rounded-lg p-4">
        <h3 class="font-semibold mb-2">{{ t('arch.endgoal') }}</h3>
        <p class="text-muted text-sm leading-relaxed">
          临床级可信、工程级可控、对标专业心理咨询师执业训练标准的 AI 来访仿真引擎。
          不是"更聪明的聊天机器人"，是"可以拿来训练心理咨询师执业能力的仿真系统"。
        </p>
      </div>
      <div class="bg-bg-surface border border-bg-border rounded-lg p-4">
        <h3 class="font-semibold mb-2">{{ t('arch.principles') }}</h3>
        <ul class="text-muted text-sm leading-relaxed space-y-1">
          <li>{{ t('arch.principle1') }}</li>
          <li>{{ t('arch.principle2') }}</li>
          <li>{{ t('arch.principle3') }}</li>
        </ul>
      </div>
    </div>

    <!-- 参考链接 -->
    <div class="mt-4 text-xs text-muted">
      详细文档：<code>docs/architecture/engine-endstate-blueprint-v1.0.md</code>
    </div>
  </div>
</template>
