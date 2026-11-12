<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { use } from 'echarts/core'
import { GraphChart } from 'echarts/charts'
import { TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import VChart from 'vue-echarts'

use([GraphChart, TooltipComponent, LegendComponent, CanvasRenderer])

const { t } = useI18n()
const router = useRouter()

// ========== 类型定义 ==========

type NodeStatus = 'done' | 'partial' | 'planned'

interface ArchNode {
  id: string
  name: string
  x: number
  y: number
  layer: number
  desc: string
  status: NodeStatus
  route?: string
}

interface ArchLink {
  source: string
  target: string
}

interface ModuleItem {
  name: string
  desc: string
  path: string
  route?: string
}

interface ModuleGroup {
  title: string
  boundaryKey: string
  items: ModuleItem[]
}

interface FlowNode {
  name: string
  desc: string
  route?: string
}

interface FlowStage {
  title: string
  desc: string
  nodes: FlowNode[]
}

interface ExtGroup {
  title: string
  items: ModuleItem[]
}

interface LineageItem {
  title: string
  desc: string
  tag: string
}

// ========== 视图 A · 七层概念架构 ==========

const layers = [
  { id: 7, name: '⑦ 观测与调试设施层', y: 80, color: '#8b5cf6', desc: 'trace / 校准 / 自动对练 / 批次回归 / 标注 / 质量评估' },
  { id: 6, name: '⑥ 伦理安全层', y: 200, color: '#ef4444', desc: '规则 → 模型探测 → 双向校验 → 会后审计' },
  { id: 5, name: '⑤ 渲染调度层', y: 320, color: '#f59e0b', desc: '结构化意图 → 口语化 / 语音 / 语气' },
  { id: 4, name: '④ 记忆系统层', y: 440, color: '#10b981', desc: '三级记忆 + 召回策略 + 遗忘曲线' },
  { id: 3, name: '③ 关系与情绪层', y: 560, color: '#06b6d4', desc: '同盟三维 + 移情 + 情绪动态' },
  { id: 2, name: '② BDI 推理层（混合式）', y: 680, color: '#3b82f6', desc: '状态骨架 + LLM 审议 + 约束校验' },
  { id: 1, name: '① 纯层内核', y: 800, color: '#6366f1', desc: '状态定义 / 纯函数算子 / 端口契约' },
]

const nodes: ArchNode[] = [
  // ① 纯层内核 (y=800)
  { id: 'state-model', name: '状态模型', x: 180, y: 800, layer: 1, desc: 'BDI 状态值语义，readonly 快照', status: 'done' },
  { id: 'pure-operators', name: '纯函数算子', x: 390, y: 800, layer: 1, desc: '事件 → delta → 状态迁移，纯函数无 IO', status: 'done' },
  { id: 'delta-cap', name: 'Delta Cap', x: 600, y: 800, layer: 1, desc: '单回合非对称上限，防状态跳变', status: 'done' },
  { id: 'ports', name: '端口契约', x: 810, y: 800, layer: 1, desc: 'LLM / 仓储 / 记忆 / 探测端口注入', status: 'done' },

  // ② BDI 推理层 (y=680)
  { id: 'state-skeleton', name: '状态骨架', x: 180, y: 680, layer: 2, desc: '信念 / 愿望 / 意图 / 情绪 / 移情结构在，算子待充实', status: 'partial' },
  { id: 'deliberation-engine', name: 'LLM 审议引擎', x: 390, y: 680, layer: 2, desc: '审议处理器与钩子，shadow / effective 模式', status: 'partial', route: '/deliberation-stats' },
  { id: 'constraint-gate', name: '约束校验层', x: 600, y: 680, layer: 2, desc: '输出守卫 / 降级 / 安全规则，约束审议结果落状态', status: 'partial' },
  { id: 'personality-op', name: '人格调节算子', x: 810, y: 680, layer: 2, desc: '依恋与人格特质对 delta 的调节倍率', status: 'done' },

  // ③ 关系与情绪层 (y=560)
  { id: 'alliance-3d', name: '同盟三维', x: 180, y: 560, layer: 3, desc: 'trust / safety / bond 独立建模', status: 'done' },
  { id: 'transference', name: '移情系统', x: 390, y: 560, layer: 3, desc: '正 / 负 / 依赖三态，触发式演化待补', status: 'partial' },
  { id: 'emotion-dynamic', name: '情绪动态', x: 600, y: 560, layer: 3, desc: '离散情绪 + 效价 / 唤醒，传导性与粒度待补', status: 'partial' },
  { id: 'decay-cross-session', name: '跨会话衰减', x: 810, y: 560, layer: 3, desc: '情绪 / 阻抗 / 同盟差异化半衰期', status: 'done' },

  // ④ 记忆系统层 (y=440)
  { id: 'working-memory', name: '工作记忆', x: 180, y: 440, layer: 4, desc: '最近轮次滑窗 + 注意焦点', status: 'done' },
  { id: 'session-summary', name: '会话记忆', x: 390, y: 440, layer: 4, desc: '滚动摘要 + 最终摘要，层次化议题待补', status: 'partial' },
  { id: 'long-term-memory', name: '长时记忆', x: 600, y: 440, layer: 4, desc: 'Qdrant 向量召回 + 重要性衰减', status: 'partial' },
  { id: 'recall-strategy', name: '召回策略', x: 810, y: 440, layer: 4, desc: 'Top-K + 时间衰减 + 冲突消解；情绪偏差待补', status: 'partial' },

  // ⑤ 渲染调度层 (y=320)
  { id: 'spec-assembler', name: 'Spec 组装', x: 140, y: 320, layer: 5, desc: 'BDI 状态 → 结构化渲染意图', status: 'done' },
  { id: 'llm-render', name: 'LLM 渲染适配', x: 330, y: 320, layer: 5, desc: '流式渲染编排、风险、截断与降级', status: 'done' },
  { id: 'expression-style', name: '表达风格', x: 520, y: 320, layer: 5, desc: '阻抗-表达映射 / 口语化 / 非语言元素', status: 'planned' },
  { id: 'emotion-granularity', name: '情绪粒度', x: 710, y: 320, layer: 5, desc: '细颗粒情绪表达，而非粗标签', status: 'planned' },
  { id: 'tts-render', name: 'TTS 渲染', x: 900, y: 320, layer: 5, desc: '语音合成 / 语气词 / 停顿', status: 'partial' },

  // ⑥ 伦理安全层 (y=200)
  { id: 'rule-safety', name: '规则禁言', x: 180, y: 200, layer: 6, desc: '输入侧规则阻断与高危词检测', status: 'done' },
  { id: 'psyguard', name: 'PsyGUARD 探测', x: 390, y: 200, layer: 6, desc: 'RoBERTa 模型实时风险探测', status: 'done', route: '/psyguard' },
  { id: 'output-verify', name: '输出侧校验', x: 600, y: 200, layer: 6, desc: 'AI 输出过校验，不诱导危险行为', status: 'partial' },
  { id: 'post-audit', name: '会后审计', x: 810, y: 200, layer: 6, desc: '决策与伦理标签留痕，全量伦理回溯待补', status: 'partial' },

  // ⑦ 观测与调试设施层 (y=80)
  { id: 'debug-panel', name: '调试面板', x: 80, y: 80, layer: 7, desc: '每轮 BDI delta / 事件 / prompt 快照', status: 'partial', route: '/sessions' },
  { id: 'trace-system', name: 'Trace 系统', x: 230, y: 80, layer: 7, desc: '整场会话 trace 与回放对比', status: 'partial', route: '/sessions' },
  { id: 'param-calibrate', name: '参数校准', x: 380, y: 80, layer: 7, desc: '可视化调参，不改代码', status: 'partial', route: '/calibrator' },
  { id: 'auto-practice', name: '自动对练', x: 530, y: 80, layer: 7, desc: 'AI 咨询师 × AI 来访者双向对练', status: 'partial', route: '/auto-practice' },
  { id: 'batch-regression', name: '批次回归', x: 680, y: 80, layer: 7, desc: '指标字典 / 配置指纹 / 快照 / 四态判定', status: 'partial', route: '/batch-regression' },
  { id: 'annotation', name: '标注台', x: 830, y: 80, layer: 7, desc: '批次派生队列 / 逐字稿冻结 / 轮级标注', status: 'partial', route: '/quality/annotation' },
  { id: 'quality-assess', name: '质量评估', x: 980, y: 80, layer: 7, desc: '评测数据集 / 指标 / 报告', status: 'partial', route: '/eval-reports' },
]

const links: ArchLink[] = [
  // 内核 → BDI 推理层
  { source: 'state-model', target: 'state-skeleton' },
  { source: 'pure-operators', target: 'state-skeleton' },
  { source: 'delta-cap', target: 'state-skeleton' },
  { source: 'ports', target: 'state-skeleton' },
  { source: 'personality-op', target: 'state-skeleton' },
  { source: 'deliberation-engine', target: 'state-skeleton' },

  // BDI 推理层 → 关系与情绪层
  { source: 'state-skeleton', target: 'alliance-3d' },
  { source: 'state-skeleton', target: 'emotion-dynamic' },
  { source: 'state-skeleton', target: 'transference' },
  { source: 'constraint-gate', target: 'spec-assembler' },

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

  // 伦理安全层 → 观测层
  { source: 'rule-safety', target: 'post-audit' },
  { source: 'psyguard', target: 'post-audit' },
  { source: 'output-verify', target: 'post-audit' },

  // 跨层留痕
  { source: 'spec-assembler', target: 'debug-panel' },
  { source: 'state-skeleton', target: 'debug-panel' },
  { source: 'alliance-3d', target: 'trace-system' },

  // 调试设施内部
  { source: 'auto-practice', target: 'batch-regression' },
  { source: 'annotation', target: 'batch-regression' },
]

const statusColor: Record<NodeStatus, string> = {
  done: '#7ec9a0',
  partial: '#e8c87a',
  planned: '#6b7280',
}

const statusLabel = computed<Record<NodeStatus, string>>(() => ({
  done: t('arch.statusDone'),
  partial: t('arch.statusPartial'),
  planned: t('arch.statusPlanned'),
}))

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
            ● ${statusLabel.value[node.status]}
          </div>
        `
      }
      return ''
    },
  },
  legend: {
    data: [
      { name: statusLabel.value.done, icon: 'circle' },
      { name: statusLabel.value.partial, icon: 'circle' },
      { name: statusLabel.value.planned, icon: 'circle' },
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
        lineStyle: { width: 2.5, opacity: 0.9 },
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
      links: links.map(l => ({ source: l.source, target: l.target })),
    },
  ],
  graphic: [
    ...layers.map(l => ({
      type: 'rect',
      left: 50,
      shape: { x: 50, y: l.y - 45, width: 1150, height: 90, r: 8 },
      style: { fill: l.color + '11', stroke: l.color + '44', lineWidth: 1, dash: [4, 4] },
    })),
    ...layers.map(l => ({
      type: 'text',
      right: 30,
      top: l.y - 12,
      style: { text: l.name, fill: l.color, fontSize: 13, fontWeight: 600, textAlign: 'right' },
    })),
  ],
})

function onNodeClick(params: any) {
  const id = params?.data?.id
  const node = nodes.find(n => n.id === id)
  if (node?.route) router.push(node.route)
}

// ========== 视图 B · 模块代码地图 ==========

const moduleGroups: ModuleGroup[] = [
  {
    title: '① 纯层内核 · engine-core',
    boundaryKey: 'coreBoundary',
    items: [
      { name: '领域模型', desc: 'BDI 快照、信念 / 愿望 / 意图 / 情绪 / 移情 / 角色画像、事件与端口契约', path: 'src/engine-core/domain' },
      { name: '认知算子', desc: 'delta 表、状态迁移、意图规划、人格算子、规则分类、会话衰减；渲染守卫、安全评估、轨迹应用', path: 'src/engine-core/cognition' },
      { name: '记忆策略', desc: '工作窗、召回策略、重要性衰减、晋升、冲突消解', path: 'src/engine-core/memory' },
      { name: '运行端口', desc: '会话端口、审议钩子端口', path: 'src/engine-core/runtime' },
      { name: '内存实现', desc: '仓储 / 会话 / 记忆的内存态实现，供测试与离线运行', path: 'src/engine-core/in-memory' },
    ],
  },
  {
    title: '② 装配适配层 · engine-adapters',
    boundaryKey: 'adapterBoundary',
    items: [
      { name: 'LLM 审议', desc: '审议处理器 / 服务 / 钩子、模式配置与统计', path: 'src/engine-adapters/deliberation', route: '/deliberation-stats' },
      { name: '审议闸门', desc: '触发式判定、配额、闸门决策留痕', path: 'src/engine-adapters/deliberation-gate', route: '/gate-decisions' },
      { name: '渲染适配', desc: 'Spec 组装、LLM 渲染、流式端口、风险、截断、降级、轮次编排', path: 'src/engine-adapters/rendering' },
      { name: '持久化', desc: 'Redis 状态仓储、Qdrant 记忆仓储、滚动 / 最终摘要', path: 'src/engine-adapters/persistence' },
      { name: '评测设施', desc: '数据集、ground truth、指标、runner 与报告', path: 'src/engine-adapters/eval', route: '/eval-reports' },
      { name: '向量嵌入', desc: 'OpenAI 兼容向量嵌入适配', path: 'src/engine-adapters/embedder' },
      { name: '观测', desc: '会话成本留痕', path: 'src/engine-adapters/observability', route: '/cost' },
      { name: '引擎装配', desc: '模块装配、角色池与基线标定、风险探测、轨迹脚本、delta 审计、幂等', path: 'src/engine-adapters/wiring' },
    ],
  },
  {
    title: '③ 内部调试设施 · auto-practice',
    boundaryKey: 'practiceBoundary',
    items: [
      { name: 'AI 咨询师', desc: '咨询师 prompt 组装、历史窗、生成 / 降级策略', path: 'src/auto-practice/counselor', route: '/auto-practice' },
      { name: '指标与判据', desc: '指标字典、批次指标计算、判据阈值分档、回归判定', path: 'src/auto-practice/metrics', route: '/batch-regression' },
      { name: '实体与种子', desc: '咨询师模式、批次 / 会话 / 轮次实体与模式种子', path: 'src/auto-practice/entities' },
      { name: '队列与执行', desc: '对练队列、执行器、批次健康检查', path: 'src/auto-practice' },
      { name: '配置指纹', desc: '配置 / prompt / 推断三段指纹，支撑可复现与不可比判定', path: 'src/auto-practice' },
      { name: '语义解析', desc: '语义标签解析、流式预处理与持久化', path: 'src/auto-practice/semantic' },
    ],
  },
  {
    title: '④ 其他业务模块',
    boundaryKey: 'otherModules',
    items: [
      { name: '账号体系', desc: 'JWT、Redis blacklist、OAuth、多端 session', path: 'src/user · src/auth' },
      { name: '计费', desc: '订阅与账单', path: 'src/billing' },
      { name: '语音与 LLM', desc: 'ASR / TTS 适配、多厂商 LLM 抽象', path: 'src/voice · src/llm' },
      { name: 'Phase1 遗留模块', desc: '旧 AI 引擎、陪伴、日记、游戏化等独立模块', path: 'src/ai-engine · src/companion · …' },
    ],
  },
]

// ========== 视图 C · 一轮会话数据流 ==========

const flowStages: FlowStage[] = [
  {
    title: '接入与幂等',
    desc: '会话请求进入，装载状态并保证轮次幂等',
    nodes: [
      { name: 'WS / HTTP 会话入口', desc: '引擎控制器与流式后端适配', route: '/sessions' },
      { name: '轮次幂等', desc: 'turnId 去重，重复提交不重复迁移状态' },
      { name: '快照装载', desc: '从仓储装载当前 BDI 会话快照' },
    ],
  },
  {
    title: '事件判定',
    desc: '把咨询师发言识别为结构化会话事件',
    nodes: [
      { name: '事件词典匹配', desc: '事件词表与会话事件模型' },
      { name: '规则分类器', desc: '规则轨事件判定，触发条件求值' },
    ],
  },
  {
    title: '状态迁移',
    desc: '纯函数算子计算增量并生成新快照',
    nodes: [
      { name: 'Delta 表增量', desc: '事件 → 各状态维度增量' },
      { name: 'Delta Cap', desc: '单回合非对称上限裁剪，防跳变' },
      { name: '系数调节', desc: '人格 / 同盟 / 衰减系数作用于增量' },
      { name: '新快照', desc: '值语义整体替换，同 seed 同配置可复现' },
    ],
  },
  {
    title: '审议与意图',
    desc: '闸门决定是否审议，约束校验后产出意图',
    nodes: [
      { name: '闸门触发判定', desc: '场景隔离与配额，决定是否调用审议', route: '/gate-decisions' },
      { name: 'LLM 审议', desc: '影子 / 生效模式，输出变更建议', route: '/deliberation-stats' },
      { name: '约束校验', desc: '守卫与降级，审议结果过校验后落状态' },
      { name: '意图规划', desc: '行为策略选择与意图锁定' },
    ],
  },
  {
    title: '渲染与风险',
    desc: '决策转成口语表达，并过双向风险校验',
    nodes: [
      { name: 'Spec 组装', desc: '状态 → 结构化渲染意图' },
      { name: 'LLM 流式渲染', desc: '口语化生成与流式下发' },
      { name: '语义解析', desc: '语气 / 标签解析与预处理' },
      { name: 'TTS', desc: '语音合成与停顿语气' },
      { name: '风险探测', desc: '输入 / 输出双向探测，学生风险闸门', route: '/psyguard' },
    ],
  },
  {
    title: '留痕与记忆',
    desc: '整场可追溯，记忆按规则晋升与召回',
    nodes: [
      { name: 'Delta 审计', desc: '逐轮状态差分留痕' },
      { name: '成本与指纹', desc: 'Token 成本、配置 / prompt / 推断指纹落库', route: '/cost' },
      { name: '快照持久化', desc: '会话快照与批次指标落库', route: '/batch-regression' },
      { name: '记忆晋升召回', desc: '重要性衰减、晋升与下次召回', route: '/memories' },
    ],
  },
]

// ========== 视图 D · 外部系统拓扑 ==========

const externalGroups: ExtGroup[] = [
  {
    title: '客户端',
    items: [
      { name: 'Flutter 用户端', desc: '学员与 AI 来访者对练；独立仓库，本仓不修改', path: 'frontend/xin_su_app' },
      { name: 'Flutter 咨询师端', desc: '咨询师视角与管控；独立仓库', path: 'frontend/xin_su_app' },
    ],
  },
  {
    title: '后端服务',
    items: [
      { name: 'NestJS API', desc: '本仓 mofang-nestjs：引擎 + 业务模块', path: 'backend/mofang-nestjs' },
      { name: 'Admin Dashboard', desc: '本仓 Vue3 管理后台', path: 'admin-dashboard' },
    ],
  },
  {
    title: '数据与队列',
    items: [
      { name: 'MySQL', desc: 'TypeORM 业务与引擎实体', path: 'relational store' },
      { name: 'Redis', desc: 'BDI 状态仓储、会话与缓存', path: 'cache / state store' },
      { name: 'BullMQ', desc: '自动对练异步队列', path: 'async queue' },
      { name: 'Qdrant', desc: '长时记忆向量库', path: 'vector store' },
    ],
  },
  {
    title: '模型服务',
    items: [
      { name: 'LLM 多厂商', desc: 'OpenAI 兼容协议可插拔 provider', path: 'src/llm' },
      { name: 'TTS', desc: 'MiniMax 语音合成', path: 'voice adapter' },
      { name: 'PsyGUARD', desc: 'Python RoBERTa 风险探测，HTTP 调用', path: 'backend/mofang-psyguard', route: '/psyguard' },
    ],
  },
  {
    title: '观测与通道',
    items: [
      { name: 'Socket.IO / SSE', desc: '实时对话流式通道', path: 'realtime' },
      { name: 'Prometheus', desc: '引擎指标采集', path: 'metrics' },
      { name: 'Sentry', desc: '错误上报', path: 'error reporting' },
    ],
  },
]

// ========== 视图 E · 版本与血缘 ==========

const lineageItems: LineageItem[] = [
  {
    title: '快照 Schema v1',
    desc: '批次指标快照结构版本；结构变更才提升 schemaVersion，快照兼容历史读取。',
    tag: 'schema',
  },
  {
    title: '判据版本 intake-v2',
    desc: '基线档 + cold 候选档；判据版本与历史随指标 catalog 下发，前端不另算阈值。',
    tag: 'criteria',
  },
  {
    title: '三段配置指纹',
    desc: 'config-fingerprint（引擎配置）、prompt-fingerprint（提示词）、inference-fingerprint（运行推断）；同 seed 同配置逐字同输出。',
    tag: 'fingerprint',
  },
  {
    title: '回归四态与不可比',
    desc: '达标 / 未达标 / 退化 / 不可比；配置或指纹不一致的批次标记 incomparable，不参与横向对比。',
    tag: 'regression',
  },
  {
    title: '角色配置版本',
    desc: '角色画像版本化管理，基线标定与历史角色可追溯、可回滚。',
    tag: 'character',
  },
]

const refDocs = [
  { name: 'engine-endstate-blueprint-v1.0.md', desc: '终局形态白皮书（七层架构北极星）' },
  { name: 'hybrid-bdi-agent-blueprint-v1.0.md', desc: '混合式 BDI：状态骨架 + LLM 审议 + 约束校验' },
  { name: 'ai-engine-roadmap-v1.1.md', desc: '引擎路线图与阶段规划' },
  { name: 'microservices-evolution-plan.md', desc: '微服务演进边界与规则' },
]
</script>

<template>
  <div class="p-6 max-w-7xl mx-auto">
    <!-- 标题 -->
    <div class="mb-6">
      <h1 class="text-xl font-semibold">{{ t('arch.title') }}</h1>
      <p class="text-sm text-muted mt-1">{{ t('arch.subtitle') }}</p>
    </div>

    <n-tabs type="line" size="small" animated>
      <!-- 视图 A · 概念分层 -->
      <n-tab-pane :name="'layers'" :tab="t('arch.tabLayers')">
        <div class="card p-4 mb-6">
          <VChart ref="chartRef" :option="option" class="w-full" style="height: 900px" @click="onNodeClick" />
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div class="card p-4">
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
      </n-tab-pane>

      <!-- 视图 B · 模块代码地图 -->
      <n-tab-pane :name="'modules'" :tab="t('arch.tabModules')">
        <div class="space-y-5">
          <div v-for="group in moduleGroups" :key="group.title" class="card p-4">
            <h3 class="font-semibold mb-1">{{ group.title }}</h3>
            <p class="text-xs text-muted mb-3">{{ t(`arch.${group.boundaryKey}`) }}</p>
            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              <div v-for="item in group.items" :key="item.name"
                   class="bg-bg-elevated border border-bg-border rounded-lg p-3">
                <div class="flex items-center justify-between gap-2 mb-1.5">
                  <span class="text-sm font-medium">{{ item.name }}</span>
                  <RouterLink v-if="item.route" :to="item.route" class="text-xs text-accent hover:underline shrink-0">打开</RouterLink>
                </div>
                <p class="text-xs text-muted leading-relaxed mb-2">{{ item.desc }}</p>
                <span class="chip text-[10px] text-muted bg-bg-surface border border-bg-border">{{ item.path }}</span>
              </div>
            </div>
          </div>
        </div>
      </n-tab-pane>

      <!-- 视图 C · 会话数据流 -->
      <n-tab-pane :name="'flow'" :tab="t('arch.tabFlow')">
        <div class="space-y-3">
          <template v-for="(stage, si) in flowStages" :key="stage.title">
            <div class="card p-4">
              <div class="flex items-start gap-3 mb-3">
                <span class="chip text-accent bg-bg-elevated border border-bg-border font-mono">{{ String(si + 1).padStart(2, '0') }}</span>
                <div>
                  <h3 class="font-semibold">{{ stage.title }}</h3>
                  <p class="text-xs text-muted">{{ stage.desc }}</p>
                </div>
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                <div v-for="node in stage.nodes" :key="node.name"
                     class="bg-bg-elevated border border-bg-border rounded-lg p-3">
                  <div class="flex items-center justify-between gap-2 mb-1">
                    <span class="text-sm font-medium">{{ node.name }}</span>
                    <RouterLink v-if="node.route" :to="node.route" class="text-xs text-accent hover:underline shrink-0">打开</RouterLink>
                  </div>
                  <p class="text-xs text-muted leading-relaxed">{{ node.desc }}</p>
                </div>
              </div>
            </div>
            <div v-if="si < flowStages.length - 1" class="flex justify-center text-muted text-xs">↓</div>
          </template>
        </div>
      </n-tab-pane>

      <!-- 视图 D · 外部系统拓扑 -->
      <n-tab-pane :name="'external'" :tab="t('arch.tabExternal')">
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <div v-for="group in externalGroups" :key="group.title" class="card p-4">
            <h3 class="font-semibold mb-3">{{ group.title }}</h3>
            <div class="space-y-3">
              <div v-for="item in group.items" :key="item.name"
                   class="bg-bg-elevated border border-bg-border rounded-lg p-3">
                <div class="flex items-center justify-between gap-2 mb-1">
                  <span class="text-sm font-medium">{{ item.name }}</span>
                  <RouterLink v-if="item.route" :to="item.route" class="text-xs text-accent hover:underline shrink-0">监控</RouterLink>
                </div>
                <p class="text-xs text-muted leading-relaxed mb-2">{{ item.desc }}</p>
                <span class="chip text-[10px] text-muted bg-bg-surface border border-bg-border">{{ item.path }}</span>
              </div>
            </div>
          </div>
        </div>
      </n-tab-pane>

      <!-- 视图 E · 版本与血缘 -->
      <n-tab-pane :name="'lineage'" :tab="t('arch.tabLineage')">
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <div v-for="item in lineageItems" :key="item.title" class="card p-4">
            <div class="flex items-center justify-between gap-2 mb-2">
              <h3 class="font-semibold">{{ item.title }}</h3>
              <span class="chip text-[10px] text-accent bg-bg-elevated border border-bg-border">{{ item.tag }}</span>
            </div>
            <p class="text-xs text-muted leading-relaxed">{{ item.desc }}</p>
          </div>
        </div>
      </n-tab-pane>
    </n-tabs>

    <!-- 参考文档 -->
    <div class="mt-6">
      <div class="text-xs text-muted mb-2">{{ t('arch.refDoc') }}：</div>
      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <div v-for="doc in refDocs" :key="doc.name" class="card p-3">
          <div class="text-xs font-mono text-accent mb-1">{{ doc.name }}</div>
          <div class="text-xs text-muted">{{ doc.desc }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
