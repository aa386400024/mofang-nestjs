<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, h } from 'vue'
import { useMessage, NTooltip, NIcon, NSelect } from 'naive-ui'
import { HelpCircleOutline } from '@vicons/ionicons5'
import { api } from '@/api/client'
import type {
  AnnotationRow, AnnotationDetail, AnnotationLabel, AnnotationReveal,
  AnnotationConsistency, AnnotationBatchSummary, AnnotationSaveBody,
} from '@/api/types'

const message = useMessage()

/** 可复用的 ⓘ 提示图标 (hover 显示文字). */
function HelpTip({ text }: { text: string }) {
  return h(NTooltip, { trigger: 'hover', placement: 'left', style: { maxWidth: '280px' } }, {
    trigger: () => h(NIcon, { size: 13, class: 'text-gray-500 hover:text-blue-400 cursor-help ml-1' }, () => h(HelpCircleOutline)),
    default: () => text,
  })
}

const LABELS: { value: AnnotationLabel; label: string; hint: string }[] = [
  { value: 'recounting', label: '叙述', hint: 'recounting' },
  { value: 'resistance', label: '阻抗', hint: 'resistance' },
  { value: 'simple_response', label: '简单回应', hint: 'simple_response' },
  { value: 'affective', label: '情感流露', hint: 'affective' },
  { value: 'cognitive_exploration', label: '认知探索', hint: 'cognitive_exploration' },
]

const ATTACHMENT_CN: Record<string, string> = {
  secure: '安全型',
  anxious: '焦虑型',
  avoidant: '回避型',
  disorganized: '混乱型',
}

/**
 * 字段释义 (hover 显示).
 * 口径来源: src/quality/quality-annotation.constants.ts + DTO 注释.
 */
const HINTS = {
  exploration: '来访者第一次从「讲外部事实」转到「讲内在体验/模式」的轮次。全场只答表面 → 留空。回车可直接定位到该轮。',
  label: '整场的主导话语功能（不是某一句的标签）。先看全场反复出现什么，再看关键节点卡在哪。',
  crisis: '0=无/仅话题触及 1=被动意念「活着没意思」 2=主动意念「我想死」 3=计划/准备/实施。标整场最高档。',
  crisisFirst: '危机表述第一次出现的那一轮。危机档为 0（无危机）时留空。',
  shouldEnd: '这场已无新信息增量、应开始收尾的轮次（咨询师重复问已答过的内容）。通常 ≥ 探索开始轮次；两者之间是有效探索窗口。',
  review: '拿不准的场次勾上，第二轮复查时优先看这些，不要硬猜。',
  notes: '写判断依据（为什么定这一轮、为什么选这个标签），复查和校准词表时靠它。',
  progress: '按批次或全量查看标注队列：读逐字稿 → 填探索轮次/主导标签/危机档/该断轮次 → 保存。Ctrl+Enter 保存并跳到下一场。',
  reveal: '你刚保存的人工标签 vs 自动判定的结果。一致率高说明自动判定靠谱，分歧大说明哪里需要修。',
  consistency: '所有已标场次的汇总：标签一致率、危机档一致率、探索轮次 MAE（越小越好）。跨版本口径不可比时会挂横幅遮住数字。',
  firstBadTurn: '从第几轮开始「不对」（离题 / 崩 / 共情缺失）；整场无问题 → 留空。',
  badTurns: '明确有问题的轮次清单，逗号分隔；最多 10 个，不能超出本场轮数。',
  turnNote: '轮级说明：只写观察到的事实，不写评分、等级或对错。',
} as const

const LABEL_HINTS: Record<AnnotationLabel, string> = {
  recounting: '给事实/症状/时间线，信息在前、情绪在后。如「好几个月了」「工作照常」',
  resistance: '回避、模糊化、淡化壳、转移、拒绝确认关键信息。如「说不具体」「算是……吧」「是家里人」',
  simple_response: '极短附和，不构成信息。如「嗯」「还行吧」「两种都有」',
  affective: '情绪直接出现：哭、怒、委屈、绝望、「我撑不住了」',
  cognitive_exploration: '反思自己的模式/归因/内在体验。如「别人靠不住，最后还是得自己来」',
}

const CHARACTER_CN: Record<string, string> = {
  vpt_grief_avoidance_l1: '哀伤·回避',
  vpt_depression_avoidant_l1: '抑郁·回避',
  vpt_intimate_avoidance_l1: '亲密关系·回避',
  vpt_self_worth_intellectualization_l1: '自我价值·理智化',
  vpt_workplace_intellectualization_l1: '职场·理智化',
  vpt_social_anxious_l1: '社交·焦虑',
  vpt_trauma_disorganized_l1: '创伤·混乱',
  vpt_general_secure_l1: '通用·安全',
}

/** 不可比原因码 → 中文（未知码原样展示）。 */
const REASON_CN: Record<string, string> = {
  MIXED_ENGINE_VERSION: '批次内混了不同引擎版本',
  MIXED_PROMPT_VERSION: '批次内混了不同 prompt 模板',
  NO_LABELED_SESSION: '该批还没有已标注场次',
  TRANSCRIPT_MISSING_PARTIAL: '存在逐字稿已缺失的已标场次，对比口径不完整',
}

/** 只告警码 → 中文（不阻断可比性）。 */
const WARNING_CN: Record<string, string> = {
  SMALL_SAMPLE: '样本 < 5 场，仅供参考',
  ENGINE_VERSION_DIRTY: '基线来自脏工作区（引擎版本带 -dirty）',
}

function codeText(map: Record<string, string>, code: string): string {
  return map[code] ?? code
}

const loading = ref(true)
const saving = ref(false)
const list = ref<AnnotationRow[]>([])
const done = ref(0)
const total = ref(0)
const current = ref<AnnotationDetail | null>(null)
const reveal = ref<AnnotationReveal | null>(null)

// ── 批次维度（WP-N） ──
const batches = ref<AnnotationBatchSummary[]>([])
const batchWarnings = ref<string[]>([])
/** '' = 全部历史（不传 batchId，向后兼容口径）。 */
const selectedBatchId = ref<string>('')

const batchOptions = computed(() => [
  { label: '全部历史（不传批次）', value: '' },
  ...batches.value.map((b) => {
    const valid = b.valid !== false
    return {
      label: `${b.batchId} · ${b.sessions}场 / ${b.annotatableSessions}可标${valid ? '' : '（无效批次）'}`,
      value: b.batchId,
      disabled: !valid,
    }
  }),
])

/** 「拿不准」折叠卡: 词表速查 + 主动问 AI. 默认收起, 不主动锚定. */
const assistantOpen = ref(false)
const aiHint = ref<AnnotationReveal | null>(null)
const aiHintLoading = ref(false)
async function askAiHint() {
  if (!current.value) return
  aiHintLoading.value = true
  try {
    aiHint.value = await api.qualityAnnotation.auto(rowRef(current.value.row))
  } catch (e) {
    message.error(`AI 建议获取失败: ${(e as Error).message}`)
  } finally {
    aiHintLoading.value = false
  }
}
const consistency = ref<AnnotationConsistency | null>(null)
const highlightTurn = ref<number | null>(null)

const startedAt = ref(Date.now())
const bubbleRefs = ref<HTMLElement[]>([])

const form = ref({
  firstExplorationTurn: null as number | null,
  dominantLabel: null as AnnotationLabel | null,
  crisisPeakLevel: 0,
  crisisFirstTurn: null as number | null,
  shouldEndTurn: null as number | null,
  needsReview: false,
  notes: '',
  firstBadTurn: null as number | null,
  badTurnsText: '',
  turnNote: '',
})

const pendingRows = computed(() => list.value.filter((r) => r.dominantLabel === null))

/** 派生行 id 为 null 时用 debugSessionId 当 ref（契约 §三：ref = 行 UUID 或 debugSessionId）。 */
function rowRef(row: AnnotationRow): string {
  return row.id ?? row.debugSessionId
}

const currentRef = computed(() => (current.value ? rowRef(current.value.row) : null))

function batchQuery(): { batchId: string } | undefined {
  return selectedBatchId.value ? { batchId: selectedBatchId.value } : undefined
}

/** 解析 badTurns 文本 → 升序去重数组；非法输入抛错。 */
function parseBadTurns(text: string, turnCount: number | null): number[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  const parts = trimmed.split(/[,，、\s]+/).filter(Boolean)
  const turns: number[] = []
  for (const p of parts) {
    const n = Number(p)
    if (!Number.isInteger(n) || n < 1) throw new Error(`轮次必须是 ≥1 的整数: "${p}"`)
    if (turnCount !== null && n > turnCount) throw new Error(`轮次 ${n} 超出本场轮数 ${turnCount}`)
    turns.push(n)
  }
  const unique = [...new Set(turns)].sort((a, b) => a - b)
  if (unique.length > 10) throw new Error('问题轮次最多 10 个')
  return unique
}

// ── 一致性口径守卫 ──
const consistencyComparable = computed(() => consistency.value?.scope?.comparable ?? true)
const scopeReasons = computed(() => consistency.value?.scope?.incomparableReasons ?? [])
const scopeWarnings = computed(() => consistency.value?.scope?.warnings ?? [])

async function refresh() {
  loading.value = true
  try {
    const res = await api.qualityAnnotation.list('all', batchQuery())
    list.value = res.items
    done.value = res.done
    total.value = res.total
    try {
      const batchRes = await api.qualityAnnotation.listBatches()
      batches.value = batchRes.data
      batchWarnings.value = batchRes.warnings
    } catch {
      /* 批次清单未就绪不阻塞队列 */
    }
    try {
      consistency.value = await api.qualityAnnotation.consistency(batchQuery())
    } catch {
      /* 未就绪 */
    }
    if (!current.value && pendingRows.value.length > 0) {
      const first = pendingRows.value[0]
      if (first) await openRow(rowRef(first))
    }
  } catch (e) {
    message.error(`加载失败: ${(e as Error).message}`)
  } finally {
    loading.value = false
  }
}

async function onBatchChange() {
  reveal.value = null
  highlightTurn.value = null
  assistantOpen.value = false
  aiHint.value = null
  aiHintLoading.value = false
  current.value = null
  await refresh()
}

async function openRow(ref: string) {
  reveal.value = null
  highlightTurn.value = null
  assistantOpen.value = false
  aiHint.value = null
  aiHintLoading.value = false
  try {
    current.value = await api.qualityAnnotation.detail(ref)
    const row = current.value.row
    form.value = {
      firstExplorationTurn: row.firstExplorationTurn,
      dominantLabel: row.dominantLabel,
      crisisPeakLevel: row.crisisPeakLevel,
      crisisFirstTurn: row.crisisFirstTurn,
      shouldEndTurn: row.shouldEndTurn,
      needsReview: row.needsReview,
      notes: row.notes ?? '',
      firstBadTurn: row.firstBadTurn,
      badTurnsText: row.badTurns ?? '',
      turnNote: row.turnNote ?? '',
    }
    startedAt.value = Date.now()
    await nextTick()
  } catch (e) {
    message.error(`加载详情失败: ${(e as Error).message}`)
  }
}

async function saveAndNext(next = true) {
  if (!current.value || !currentRef.value) return
  let badTurns: number[] = []
  try {
    badTurns = parseBadTurns(form.value.badTurnsText, current.value.row.turnCount)
  } catch (e) {
    message.error(`问题轮次填写有误: ${(e as Error).message}`)
    return
  }
  saving.value = true
  try {
    const durationMs = Date.now() - startedAt.value
    const body: AnnotationSaveBody = {
      firstExplorationTurn: form.value.firstExplorationTurn,
      dominantLabel: form.value.dominantLabel,
      crisisPeakLevel: form.value.crisisPeakLevel,
      crisisFirstTurn: form.value.crisisFirstTurn,
      shouldEndTurn: form.value.shouldEndTurn,
      needsReview: form.value.needsReview,
      durationMs,
      notes: form.value.notes || undefined,
      firstBadTurn: form.value.firstBadTurn,
      badTurns: badTurns.length > 0 ? badTurns.join(',') : null,
      turnNote: form.value.turnNote.trim() || undefined,
    }
    await api.qualityAnnotation.save(currentRef.value, body)
    try {
      reveal.value = await api.qualityAnnotation.reveal(currentRef.value)
    } catch {
      /* 未就绪 */
    }
    message.success('已保存')
    await refresh()
    if (next && pendingRows.value.length > 0) {
      const n = pendingRows.value[0]
      if (n) await openRow(rowRef(n))
    }
  } catch (e) {
    message.error(`保存失败: ${(e as Error).message}`)
  } finally {
    saving.value = false
  }
}

/** 跳到第 n 轮气泡并高亮 */
async function jumpToTurn(turn: number | null | undefined) {
  if (!turn) return
  highlightTurn.value = turn
  await nextTick()
  const el = bubbleRefs.value.find((b) => b?.dataset?.turn === String(turn))
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

function onKey(e: KeyboardEvent) {
  const target = e.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault(); saveAndNext(true); return
  }
  const idx = Number(e.key) - 1
  const picked = LABELS[idx]
  if (idx >= 0 && picked) {
    form.value.dominantLabel = picked.value; return
  }
  if (e.key === 'ArrowRight') {
    e.preventDefault(); const next = pendingRows.value[0]; if (next) openRow(rowRef(next))
  }
}

onMounted(() => { window.addEventListener('keydown', onKey); refresh() })
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="flex gap-4 p-4" style="height: calc(100vh - 120px)">
    <!-- 左栏: 队列 -->
    <aside class="w-64 shrink-0 flex flex-col gap-3">
      <!-- 批次选择 -->
      <div class="p-3 rounded-lg bg-white/5 border border-white/10">
        <div class="text-xs text-gray-400 mb-1">批次</div>
        <NSelect
          v-model:value="selectedBatchId"
          :options="batchOptions"
          size="small"
          @update:value="onBatchChange"
        />
        <div v-for="w in batchWarnings" :key="w" class="text-[10px] text-amber-400 mt-1">{{ w }}</div>
      </div>

      <div class="p-3 rounded-lg bg-white/5 border border-white/10">
        <div class="text-sm font-medium text-gray-100 mb-1 flex items-center gap-0.5">
          标注进度 {{ done }} / {{ total }}
          <HelpTip :text="HINTS.progress" />
        </div>
        <n-progress type="line" :percentage="total ? (done / total) * 100 : 0" :height="4"
                    :show-indicator="false" color="#3b82f6" rail-color="rgba(255,255,255,0.1)" />
        <div class="text-[11px] text-gray-500 mt-2">→ 下一条 · 1~5 标签 · Ctrl+Enter 保存</div>
      </div>

      <!-- 整体校准概览 (跨场聚合, 与单场操作无关) -->
      <div v-if="consistency && consistency.total > 0" class="p-3 rounded-lg bg-white/5 border border-white/10">
        <div class="text-xs font-medium text-gray-200 mb-2 flex items-center gap-0.5">
          校准概览
          <HelpTip :text="HINTS.consistency" />
        </div>
        <div v-if="!consistencyComparable" class="p-2 rounded bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-200 space-y-1">
          <div>该口径不可比，一致率数字不展示：</div>
          <div v-for="r in scopeReasons" :key="r">· {{ codeText(REASON_CN, r) }}</div>
        </div>
        <template v-else>
          <div v-if="consistency.labeled === 0" class="text-[11px] text-gray-500 leading-relaxed">
            还没有已完成标注的场次，指标算不出来。标完第一场后这里就会出值。
          </div>
          <div v-else class="text-[11px] space-y-1">
            <div class="flex justify-between">
              <span class="text-gray-400">标签一致率</span>
              <span :class="(consistency.labelAgreement ?? 0) >= 0.8 ? 'text-green-400' : 'text-amber-400'">
                {{ consistency.labelAgreement?.toFixed(2) ?? '—' }}
              </span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-400">危机档一致率</span>
              <span :class="(consistency.crisisAgreement ?? 0) >= 0.8 ? 'text-green-400' : 'text-amber-400'">
                {{ consistency.crisisAgreement?.toFixed(2) ?? '—' }}
              </span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-400">探索轮次 MAE</span>
              <span :class="(consistency.explorationTurnMae ?? 99) <= 2 ? 'text-green-400' : 'text-amber-400'">
                {{ consistency.explorationTurnMae?.toFixed(2) ?? '—' }}
              </span>
            </div>
            <div v-if="consistency.labeled < 5" class="pt-1 text-amber-400">样本 &lt; 5 场，仅供参考</div>
          </div>
        </template>
        <div v-for="w in scopeWarnings" :key="w" class="pt-1 text-[10px] text-amber-400">· {{ codeText(WARNING_CN, w) }}</div>
      </div>
      <div class="flex-1 overflow-auto rounded-lg bg-white/5 border border-white/10 p-2">
        <div v-for="row in list" :key="rowRef(row)"
             class="p-2 mb-1 rounded cursor-pointer text-xs hover:bg-white/10"
             :class="[rowRef(row) === currentRef ? 'bg-blue-500/20' : '', row.dominantLabel !== null ? 'opacity-50' : '']"
             :title="row.characterSlug"
             @click="openRow(rowRef(row))">
          <div class="flex justify-between items-center gap-2">
            <span class="truncate text-gray-200">{{ CHARACTER_CN[row.characterSlug] ?? row.characterSlug }}</span>
            <span v-if="row.dominantLabel === null" class="text-blue-400 shrink-0">待标</span>
            <span v-else-if="row.needsReview" class="text-amber-400 shrink-0">复审</span>
            <span v-else class="text-green-400 shrink-0">✓</span>
          </div>
          <div class="text-gray-500 mt-0.5">{{ ATTACHMENT_CN[row.attachmentStyle] ?? row.attachmentStyle }}</div>
          <div class="flex gap-1 mt-0.5 flex-wrap">
            <span v-if="row.id === null" class="text-[10px] text-gray-400">未落行</span>
            <span v-if="row.transcriptSource === 'missing'" class="text-[10px] text-amber-400">逐字稿缺失</span>
          </div>
        </div>
      </div>
    </aside>

    <!-- 中栏: 逐字稿 -->
    <main class="flex-1 flex flex-col gap-3 rounded-lg bg-white/5 border border-white/10 p-4 overflow-auto">
      <div v-if="!current" class="m-auto text-gray-500">没有待标注场次</div>
      <template v-else>
        <div class="flex items-center justify-between px-2 py-1 border-b border-white/10 text-xs text-gray-400">
          <div>
            <span v-if="current.characterLabel" class="text-gray-100 font-medium mr-2">{{ current.characterLabel }}</span>
            <span class="text-gray-300">{{ CHARACTER_CN[current.row.characterSlug] ?? current.row.characterSlug }}</span>
            <span class="ml-2 px-1.5 py-0.5 rounded bg-white/10 text-gray-300">{{ ATTACHMENT_CN[current.row.attachmentStyle] ?? current.row.attachmentStyle }}</span>
          </div>
          <div class="text-gray-500">{{ current.messages.length }} 轮</div>
        </div>
        <div class="flex gap-2 text-[10px] text-gray-500 px-2 flex-wrap">
          <span v-if="current.row.batchId">批次 {{ current.row.batchId }}</span>
          <span v-if="current.row.engineVersion">引擎 {{ current.row.engineVersion }}</span>
          <span v-if="current.row.promptVersion">prompt {{ current.row.promptVersion }}</span>
        </div>
        <div v-if="current.row.transcriptSource === 'missing'" class="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200">
          逐字稿已淘汰 / 缺失，无法定位台词。本场仍可填写标签与档位；轮级定位功能不可用。
        </div>
        <div v-for="(m, i) in current.messages" v-else :key="i"
             :ref="(el) => (bubbleRefs[i] = el as HTMLElement)"
             :data-turn="m.turnIndex"
             class="flex" :class="m.role === 'visitor' ? 'justify-start' : 'justify-end'">
          <div class="max-w-[75%] px-3 py-2 rounded-lg text-sm leading-relaxed"
               :class="[
                 m.role === 'visitor' ? 'bg-blue-500/15 text-blue-50' : 'bg-white/10 text-gray-100',
                 highlightTurn === m.turnIndex ? 'ring-2 ring-blue-400' : ''
               ]">
            <div class="text-[10px] text-gray-400 mb-1">{{ m.turnIndex }}轮 · {{ m.role === 'visitor' ? '来访者' : '咨询师' }}</div>
            <div class="whitespace-pre-wrap">{{ m.text }}</div>
          </div>
        </div>
      </template>
    </main>

    <!-- 右栏: 标注面板 -->
    <aside class="w-80 shrink-0 rounded-lg bg-white/5 border border-white/10 p-4 overflow-auto">
      <div v-if="!current" class="text-gray-500 text-sm">—</div>
      <template v-else>
        <div class="text-sm font-medium text-gray-100 mb-3">标注本场</div>

        <div class="mb-4">
          <div class="text-xs text-gray-400 mb-1 flex justify-between items-center">
            <span class="flex items-center gap-0.5">
              探索开始轮次
              <HelpTip :text="HINTS.exploration" />
            </span>
            <button v-if="form.firstExplorationTurn" class="text-blue-400 hover:underline" @click="jumpToTurn(form.firstExplorationTurn)">定位</button>
          </div>
          <input v-model.number="form.firstExplorationTurn" type="number" min="1" placeholder="填完按回车直接定位"
                 class="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-sm text-gray-100"
                 @keyup.enter="jumpToTurn(form.firstExplorationTurn)" />
        </div>

        <div class="mb-4">
          <div class="text-xs text-gray-400 mb-1 flex items-center gap-0.5">
            主导标签（按 1~5 快捷键）
            <HelpTip :text="HINTS.label" />
          </div>
          <div v-for="(l, i) in LABELS" :key="l.value"
               class="flex items-center gap-2 p-1.5 rounded cursor-pointer hover:bg-white/10"
               :class="form.dominantLabel === l.value ? 'bg-blue-500/20' : ''"
               @click="form.dominantLabel = l.value">
            <span class="text-[10px] text-gray-500 w-4">{{ i + 1 }}</span>
            <span class="text-sm text-gray-100">{{ l.label }}</span>
            <span class="text-[10px] text-gray-500">{{ l.hint }}</span>
            <HelpTip :text="LABEL_HINTS[l.value]" />
          </div>
        </div>

        <div class="mb-4">
          <div class="text-xs text-gray-400 mb-1 flex justify-between items-center">
            <span class="flex items-center gap-0.5">
              危机峰值 <span class="text-blue-400">{{ form.crisisPeakLevel }}</span> / 3
              <HelpTip :text="HINTS.crisis" />
            </span>
            <button v-if="form.crisisFirstTurn" class="text-blue-400 hover:underline" @click="jumpToTurn(form.crisisFirstTurn)">定位</button>
          </div>
          <input v-model.number="form.crisisPeakLevel" type="range" min="0" max="3" step="1" class="w-full mb-2" />
          <div class="flex items-center gap-1 text-[10px] text-gray-500 mb-1">
            <span>0 无</span><span class="flex-1"></span><span>1 被动</span><span class="flex-1"></span><span>2 主动</span><span class="flex-1"></span><span>3 计划/实施</span>
          </div>
          <input v-model.number="form.crisisFirstTurn" type="number" min="1" placeholder="危机首次出现轮次（无则留空）"
                 class="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-sm text-gray-100"
                 @keyup.enter="jumpToTurn(form.crisisFirstTurn)" />
        </div>

        <div class="mb-4">
          <div class="text-xs text-gray-400 mb-1 flex items-center gap-0.5">
            该断轮次
            <HelpTip :text="HINTS.shouldEnd" />
          </div>
          <input v-model.number="form.shouldEndTurn" type="number" min="1" placeholder="填完按回车直接定位"
                 class="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-sm text-gray-100"
                 @keyup.enter="jumpToTurn(form.shouldEndTurn)" />
        </div>

        <!-- 轮级最小集（WP-N：事实描述，禁评分/等级） -->
        <div class="mb-4">
          <div class="text-xs text-gray-400 mb-1 flex items-center gap-0.5">
            从第几轮开始不对
            <HelpTip :text="HINTS.firstBadTurn" />
          </div>
          <input v-model.number="form.firstBadTurn" type="number" min="1" placeholder="整场无问题 → 留空"
                 class="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-sm text-gray-100" />
        </div>

        <div class="mb-4">
          <div class="text-xs text-gray-400 mb-1 flex items-center gap-0.5">
            问题轮次
            <HelpTip :text="HINTS.badTurns" />
          </div>
          <input v-model="form.badTurnsText" type="text" placeholder="逗号分隔，如 7, 12（最多 10 个）"
                 class="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-sm text-gray-100" />
        </div>

        <div class="mb-4">
          <div class="text-xs text-gray-400 mb-1 flex items-center gap-0.5">
            轮级说明
            <HelpTip :text="HINTS.turnNote" />
          </div>
          <textarea v-model="form.turnNote" rows="2" placeholder="只写观察到的事实，不写评分 / 等级"
                    class="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-sm text-gray-100"></textarea>
        </div>

        <label class="flex items-center gap-1 mb-4 text-sm text-gray-200 cursor-pointer">
          <input v-model="form.needsReview" type="checkbox" class="accent-blue-500" /> 存疑 / 待复审
          <HelpTip :text="HINTS.review" />
        </label>

        <div class="mb-4">
          <div class="text-xs text-gray-400 mb-1 flex items-center gap-0.5">
            备注
            <HelpTip :text="HINTS.notes" />
          </div>
          <textarea v-model="form.notes" rows="3"
                    class="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-sm text-gray-100"></textarea>
        </div>

        <!-- 拿不准? 折叠卡: 词表速查 + 主动问 AI. 默认收起, 不主动锚定. -->
        <div class="mb-4 rounded-lg border border-white/10 overflow-hidden">
          <button class="w-full flex items-center justify-between px-3 py-2 text-xs text-gray-400 hover:bg-white/5"
                  @click="assistantOpen = !assistantOpen">
            <span>📖 拿不准？展开看词表速查 / 问 AI</span>
            <span>{{ assistantOpen ? '▾' : '▸' }}</span>
          </button>
          <div v-if="assistantOpen" class="px-3 py-2 border-t border-white/10 space-y-2 text-xs">
            <div class="text-gray-300 font-medium">主导标签速查</div>
            <div v-for="l in LABELS" :key="l.value" class="text-gray-400 leading-relaxed">
              <span class="text-gray-200">{{ l.label }}</span>：{{ LABEL_HINTS[l.value] }}
            </div>
            <div class="text-gray-300 font-medium pt-1">危机峰值速查</div>
            <div class="text-gray-400 leading-relaxed">
              0=无/仅话题触及 · 1=被动意念「活着没意思」 · 2=主动意念「我想死」 · 3=计划/准备/实施
            </div>
            <div class="pt-2 border-t border-white/5">
              <button v-if="!aiHint"
                      class="w-full border border-blue-400/40 text-blue-300 rounded py-1.5 hover:bg-blue-500/10 disabled:opacity-50"
                      :disabled="aiHintLoading" @click="askAiHint">
                {{ aiHintLoading ? '规则判定中…' : '拿不准？问 AI 这场规则怎么判' }}
              </button>
              <div v-else class="p-2 rounded bg-blue-500/10 border border-blue-500/20">
                <div class="text-blue-200 mb-1">规则判定（仅参考，你自己定）</div>
                <div class="flex justify-between"><span class="text-blue-300">探索轮次</span><span class="text-blue-100">{{ aiHint.auto.explorationTurn ?? '—' }}</span></div>
                <div class="flex justify-between"><span class="text-blue-300">主导标签</span><span class="text-blue-100">{{ aiHint.auto.dominantLabel ?? '—' }}</span></div>
                <div class="flex justify-between"><span class="text-blue-300">危机档</span><span class="text-blue-100">{{ aiHint.auto.crisisLevel }}</span></div>
                <div class="text-blue-200/60 mt-1">不同意是正常的——这正是要校准的地方。</div>
              </div>
            </div>
          </div>
        </div>

        <button class="w-full bg-blue-600 hover:bg-blue-500 text-white rounded py-2 text-sm disabled:opacity-50"
                :disabled="saving" @click="saveAndNext(true)">保存并下一个（Ctrl+Enter）</button>

        <div v-if="reveal" class="mt-4 p-3 rounded bg-green-500/10 border border-green-500/20 text-xs text-green-100">
          <div class="font-medium mb-1 flex items-center gap-0.5">
            自动判定对照（保存后可见）
            <HelpTip :text="HINTS.reveal" />
          </div>
          <div class="flex justify-between"><span>探索轮次</span><span>{{ reveal.auto.explorationTurn ?? '—' }}</span></div>
          <div class="flex justify-between"><span>主导标签</span><span>{{ reveal.auto.dominantLabel ?? '—' }}</span></div>
          <div class="flex justify-between"><span>危机档</span><span>{{ reveal.auto.crisisLevel }}</span></div>
        </div>
      </template>
    </aside>
  </div>
</template>
