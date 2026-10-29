<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { api } from '@/api/client'
import type { SessionDetail, TurnTrace } from '@/api/types'
import DimensionsRadar from '@/components/DimensionsRadar.vue'
import InfoTooltip from '@/components/InfoTooltip.vue'
import BdiTrajectoryChart from '@/components/BdiTrajectoryChart.vue'

const props = defineProps<{ id: string }>()
const data = ref<SessionDetail | null>(null)
const loading = ref(true)
const err = ref('')
const selectedTurn = ref(0)

onMounted(async () => {
  try {
    data.value = await api.session(props.id)
    if (data.value.turns.length) selectedTurn.value = data.value.turns[0].turnIndex
  } catch (e) { err.value = String(e) }
  finally { loading.value = false }
})

const turn = computed<TurnTrace | null>(() =>
  data.value?.turns.find(t => t.turnIndex === selectedTurn.value) ?? null
)

const dimLabels: Record<string, string> = {
  empathy: '共情', activeListening: '主动倾听', questioning: '提问',
  boundary: '边界', response: '回应', professionalism: '专业度',
}
const scoreColor = (v: number | null) =>
  v == null ? 'text-muted' : v >= 80 ? 'text-ok' : v >= 60 ? 'text-accent' : 'text-warn'
const scoreLabel = (v: number | null) =>
  v == null ? '—' : v >= 85 ? '优秀' : v >= 70 ? '良好' : v >= 60 ? '合格' : v >= 40 ? '待提升' : '需加强'
</script>

<template>
  <div class="p-6 max-w-6xl mx-auto">
    <button class="text-sm text-muted hover:text-accent mb-4" @click="$router.back()">← 返回</button>
    <div v-if="loading" class="text-muted text-sm">加载中…</div>
    <div v-else-if="err" class="text-danger text-sm">{{ err }}</div>
    <template v-else-if="data">
      <div class="flex items-center gap-6 mb-5 text-sm">
        <span class="font-semibold text-base">{{ data.visitorAlias }}</span>
        <span class="text-muted font-mono text-xs">{{ data.characterSlug }}</span>
        <span class="chip bg-bg-elevated text-muted">{{ data.status }}</span>
        <span class="ml-auto flex gap-4 text-xs text-muted font-mono">
          <span>{{ data.turns.length }} 轮</span>
          <span>{{ data.totalTokens.toLocaleString() }} tok</span>
        </span>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div class="card p-4">
          <h2 class="text-xs uppercase text-muted mb-3">逐字稿</h2>
          <div class="space-y-3">
            <div v-for="(t, i) in data.transcript" :key="i"
                 class="flex" :class="t.role === 'visitor' ? 'justify-end' : ''">
              <div class="max-w-[80%] px-3 py-2 rounded-lg"
                   :class="t.role === 'visitor'
                     ? 'bg-accent/15 border border-accent/30'
                     : 'bg-bg-elevated border border-bg-border'">
                <div class="text-[10px] mb-0.5" :class="t.role === 'visitor' ? 'text-accent-muted' : 'text-muted'">
                  {{ t.role === 'visitor' ? '来访' : '咨询师' }}
                </div>
                <div class="text-sm">{{ t.text }}</div>
              </div>
            </div>
          </div>
        </div>
        <div class="space-y-4">
          <div class="card p-3">
            <h2 class="text-xs uppercase text-muted mb-2">轮次</h2>
            <div class="flex flex-wrap gap-1">
              <button v-for="t in data.turns" :key="t.turnIndex"
                      class="w-8 h-8 rounded text-xs font-mono"
                      :class="t.turnIndex === selectedTurn ? 'bg-accent text-bg-base' : 'bg-bg-elevated text-muted'"
                      @click="selectedTurn = t.turnIndex">{{ t.turnIndex }}</button>
            </div>
          </div>
          <div v-if="turn" class="card p-4">
            <h2 class="text-xs uppercase tracking-wider text-muted mb-3">BDI 快照</h2>
            <div class="grid grid-cols-2 gap-3">
              <div class="bg-bg-base/60 rounded p-3">
                <div class="text-[10px] uppercase tracking-wider text-muted mb-1 flex items-center">trust<InfoTooltip text="信任度：来访对咨询师的信任程度，越高越愿意敞开心扉（0~1）" /></div>
                <div class="font-mono text-lg text-gray-100">{{ turn.bdi.trust.toFixed(2) }}</div>
              </div>
              <div class="bg-bg-base/60 rounded p-3">
                <div class="text-[10px] uppercase tracking-wider text-muted mb-1 flex items-center">valence<InfoTooltip text="情绪效价：正负情绪倾向，负值=低落/消极，正值=积极（-1~1）" /></div>
                <div class="font-mono text-lg text-gray-100">{{ turn.bdi.valence.toFixed(2) }}</div>
              </div>
              <div class="bg-bg-base/60 rounded p-3">
                <div class="text-[10px] uppercase tracking-wider text-muted mb-1 flex items-center">arousal<InfoTooltip text="唤醒度：情绪唤起水平，高=紧张/焦虑/激动，低=平静/倦怠（0~1）" /></div>
                <div class="font-mono text-lg text-gray-100">{{ turn.bdi.arousal.toFixed(2) }}</div>
              </div>
              <div class="bg-bg-base/60 rounded p-3">
                <div class="text-[10px] uppercase tracking-wider text-muted mb-1 flex items-center">resistance<InfoTooltip text="阻抗：来访的心理防御强度，高=回避/抗拒话题，低=开放配合（0~1）" /></div>
                <div class="font-mono text-lg text-gray-100">{{ turn.bdi.resistance.toFixed(2) }}</div>
              </div>
            </div>
            <div class="mt-3 pt-3 border-t border-bg-border flex items-center justify-between">
              <span class="text-[10px] uppercase tracking-wider text-muted flex items-center">attachment<InfoTooltip text="依恋类型：来访的依恋风格，anxious=焦虑型，avoidant=回避型，secure=安全型" /></span>
              <span class="chip bg-accent/15 text-accent">{{ turn.bdi.attachmentType }}</span>
            </div>
          </div>
          <div v-if="turn" class="card p-4">
            <h2 class="text-xs uppercase tracking-wider text-muted mb-3">LLM Usage</h2>
            <div class="grid grid-cols-2 gap-3">
              <div class="bg-bg-base/60 rounded p-3">
                <div class="text-[10px] uppercase tracking-wider text-muted mb-1 flex items-center">completion<InfoTooltip text="生成 token 数：来访这一轮实际回复消耗的 token 总量" /></div>
                <div class="font-mono text-lg text-gray-100">{{ turn.usage.completionTokens }}</div>
              </div>
              <div class="bg-bg-base/60 rounded p-3">
                <div class="text-[10px] uppercase tracking-wider text-muted mb-1 flex items-center">reasoning<InfoTooltip text="思考 token：推理模型的内部推理消耗，voice render 走低 reasoningEffort 应较少" /></div>
                <div class="font-mono text-lg text-warn">{{ turn.usage.reasoningTokens }}</div>
              </div>
              <div class="bg-bg-base/60 rounded p-3">
                <div class="text-[10px] uppercase tracking-wider text-muted mb-1 flex items-center">TTFT<InfoTooltip text="首 token 延迟：从发出请求到收到第一个字的毫秒数，越低越流畅" /></div>
                <div class="font-mono text-lg text-gray-100">{{ turn.usage.ttftMs }}<span class="text-xs text-muted ml-0.5">ms</span></div>
              </div>
              <div class="bg-bg-base/60 rounded p-3">
                <div class="text-[10px] uppercase tracking-wider text-muted mb-1 flex items-center">finish<InfoTooltip text="结束原因：stop=正常说完，length=被 token 上限截断" /></div>
                <div class="font-mono text-lg text-gray-100">{{ turn.usage.finishReason }}</div>
              </div>
            </div>
          </div>
          <div v-if="turn" class="card p-4" :class="turn.crisis.detected ? 'border-danger/50 bg-danger/5' : ''">
            <h2 class="text-xs uppercase tracking-wider text-muted mb-2">危机检测</h2>
            <div v-if="turn.crisis.detected" class="text-sm text-danger flex items-center gap-2">
              <span class="w-1.5 h-1.5 rounded-full bg-danger"></span>{{ turn.crisis.category }}
            </div>
            <div v-else class="text-sm text-muted flex items-center gap-2">
              <span class="w-1.5 h-1.5 rounded-full bg-bg-border"></span>无
            </div>
          </div>

          <!-- RenderSpec prompt 预览 -->
          <div v-if="turn" class="card p-4">
            <h2 class="text-xs uppercase tracking-wider text-muted mb-3 flex items-center">
              RenderSpec Prompt
              <InfoTooltip text="实际发给 LLM 的渲染规格，分 system/context/instructions 三段" />
            </h2>
            <div class="flex gap-2 mb-3">
              <span class="chip bg-bg-elevated text-muted">{{ turn.render.taskKind }}</span>
              <span class="chip bg-bg-elevated text-muted">effort: {{ turn.render.effort }}</span>
              <span class="chip bg-bg-elevated text-muted">{{ turn.render.maxTokens }} tok</span>
            </div>
            <div class="space-y-2.5">
              <div class="bg-bg-base/40 rounded p-2.5">
                <div class="text-[10px] uppercase tracking-wider text-accent-muted mb-1">System</div>
                <p class="text-xs text-gray-300 leading-relaxed">{{ turn.render.system }}</p>
              </div>
              <div class="bg-bg-base/40 rounded p-2.5">
                <div class="text-[10px] uppercase tracking-wider text-warn mb-1">Context</div>
                <p class="text-xs text-gray-300 leading-relaxed whitespace-pre-line">{{ turn.render.context }}</p>
              </div>
              <div class="bg-bg-base/40 rounded p-2.5">
                <div class="text-[10px] uppercase tracking-wider text-ok mb-1">Instructions</div>
                <p class="text-xs text-gray-300 leading-relaxed">{{ turn.render.instructions }}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- BDI 轨迹 -->
      <div v-if="data.turns.length > 1" class="mt-4 card p-4">
        <h2 class="text-xs uppercase tracking-wider text-muted mb-3 flex items-center">
          BDI 状态轨迹
          <InfoTooltip text="整场会话中角色 trust/valence/arousal/resistance 的逐轮变化，曲线越平滑说明角色情绪越稳定" />
        </h2>
        <BdiTrajectoryChart :turns="data.turns" />
      </div>

      <!-- 复盘报告 -->
      <div v-if="data.report.status === 'completed'" class="mt-6 card overflow-hidden">
        <!-- 头部 -->
        <div class="px-5 pt-4 pb-3 border-b border-bg-border flex items-center justify-between">
          <h2 class="text-xs uppercase tracking-wider text-muted">复盘报告</h2>
          <span class="chip bg-ok/10 text-ok">已生成</span>
        </div>

        <div class="p-5">
          <!-- 上三栏：总分 | 雷达图 | annotations -->
          <div class="grid grid-cols-3 gap-6 mb-5">
            <!-- 总分仪表盘 -->
            <div class="flex flex-col items-center justify-center bg-bg-base/40 rounded-lg py-6">
              <div class="text-[10px] uppercase tracking-wider text-muted mb-2 flex items-center">综合评分<InfoTooltip text="整场会话的综合评分，由六维加权计算，0~100" /></div>
              <div class="font-mono text-5xl font-light" :class="scoreColor(data.report.overallScore)">
                {{ data.report.overallScore }}
              </div>
              <div class="mt-2 text-xs" :class="scoreColor(data.report.overallScore)">
                {{ scoreLabel(data.report.overallScore) }}
              </div>
            </div>

            <!-- 雷达图 -->
            <div v-if="data.report.dimensions" class="flex items-center justify-center">
              <DimensionsRadar :dimensions="data.report.dimensions" :labels="dimLabels" />
            </div>
            <div v-else class="flex items-center justify-center text-sm text-muted">暂无评分数据</div>

            <!-- annotations -->
            <div v-if="data.report.annotations.length" class="space-y-2.5">
              <div class="text-[10px] uppercase tracking-wider text-muted mb-2">关键标注</div>
              <div v-for="(a, i) in data.report.annotations" :key="i"
                   class="flex gap-2.5 text-sm p-2 rounded bg-bg-base/30">
                <span class="mt-1 w-1.5 h-1.5 rounded-full shrink-0"
                      :class="a.type === 'good' ? 'bg-ok' : a.type === 'warn' ? 'bg-warn' : 'bg-danger'"></span>
                <div>
                  <div class="text-xs font-medium mb-0.5"
                       :class="a.type === 'good' ? 'text-ok' : a.type === 'warn' ? 'text-warn' : 'text-danger'">
                    {{ a.category }}
                  </div>
                  <div class="text-gray-300 leading-relaxed">{{ a.message }}</div>
                </div>
              </div>
            </div>
          </div>

          <!-- 成长建议 -->
          <div v-if="data.report.growthSuggestions.length" class="border-t border-bg-border pt-4">
            <div class="text-[10px] uppercase tracking-wider text-muted mb-2.5">成长建议</div>
            <div class="grid grid-cols-2 gap-2.5">
              <div v-for="(s, i) in data.report.growthSuggestions" :key="i"
                   class="flex gap-2.5 p-3 rounded bg-bg-base/30 text-sm text-gray-300 leading-relaxed">
                <span class="text-accent font-mono shrink-0">{{ String(i + 1).padStart(2, '0') }}</span>
                <span>{{ s }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="data.report.status !== 'completed'" class="mt-6 card p-5">
        <div class="text-sm text-muted">报告状态: {{ data.report.status }}</div>
      </div>
    </template>
  </div>
</template>
