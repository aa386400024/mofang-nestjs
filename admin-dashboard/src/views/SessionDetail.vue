<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { api } from '@/api/client'
import type { SessionDetail, TurnTrace } from '@/api/types'
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
    if (data.value.traces.length) selectedTurn.value = data.value.traces[0].turnIndex
  } catch (e) { err.value = String(e) }
  finally { loading.value = false }
})

const turn = computed<TurnTrace | null>(() =>
  data.value?.traces.find(t => t.turnIndex === selectedTurn.value) ?? null
)
</script>

<template>
  <div class="p-6 max-w-6xl mx-auto">
    <button class="text-sm text-muted hover:text-accent mb-4" @click="$router.back()">← 返回</button>
    <div v-if="loading" class="text-muted text-sm">加载中…</div>
    <div v-else-if="err" class="text-danger text-sm">{{ err }}</div>
    <template v-else-if="data">
      <div class="flex items-center gap-6 mb-5 text-sm">
        <span class="font-semibold text-base">{{ data.visitorAlias }}</span>
        <span class="chip bg-bg-elevated text-muted">{{ data.status }}</span>
        <span class="ml-auto flex gap-4 text-xs text-muted font-mono">
          <span>{{ data.traces.length }} 轮 trace</span>
        </span>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div class="card p-4">
          <h2 class="text-xs uppercase text-muted mb-3">逐字稿</h2>
          <div class="space-y-3 max-h-[600px] overflow-y-auto">
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
            <div v-if="!data.transcript.length" class="text-muted text-sm">暂无逐字稿</div>
          </div>
        </div>
        <div class="space-y-4">
          <div class="card p-3">
            <h2 class="text-xs uppercase text-muted mb-2">轮次 trace</h2>
            <div class="flex flex-wrap gap-1">
              <button v-for="t in data.traces" :key="t.turnIndex"
                      class="w-8 h-8 rounded text-xs font-mono"
                      :class="t.turnIndex === selectedTurn ? 'bg-accent text-bg-base' : 'bg-bg-elevated text-muted'"
                      @click="selectedTurn = t.turnIndex">{{ t.turnIndex }}</button>
              <span v-if="!data.traces.length" class="text-muted text-xs">暂无 trace（需开启引擎后新开会话）</span>
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
              <span class="text-[10px] uppercase tracking-wider text-muted flex items-center">情绪标签<InfoTooltip text="当前情绪状态标签，由 valence × arousal 象限映射" /></span>
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
                <div class="text-[10px] uppercase tracking-wider text-muted mb-1 flex items-center">reasoning<InfoTooltip text="思考 token：推理模型的内部推理消耗" /></div>
                <div class="font-mono text-lg text-warn">{{ turn.usage.reasoningTokens }}</div>
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
          <!-- RenderSpec prompt 预览（后端暂未捕获，占位） -->
          <div v-if="turn?.render" class="card p-4">
            <h2 class="text-xs uppercase tracking-wider text-muted mb-3 flex items-center">
              RenderSpec Prompt
              <InfoTooltip text="实际发给 LLM 的渲染规格" />
            </h2>
            <div class="space-y-2.5">
              <div v-if="turn.render.system" class="bg-bg-base/40 rounded p-2.5">
                <div class="text-[10px] uppercase tracking-wider text-accent-muted mb-1">System</div>
                <p class="text-xs text-gray-300 leading-relaxed">{{ turn.render.system }}</p>
              </div>
              <div v-if="turn.render.context" class="bg-bg-base/40 rounded p-2.5">
                <div class="text-[10px] uppercase tracking-wider text-warn mb-1">Context</div>
                <p class="text-xs text-gray-300 leading-relaxed whitespace-pre-line">{{ turn.render.context }}</p>
              </div>
              <div v-if="turn.render.instructions" class="bg-bg-base/40 rounded p-2.5">
                <div class="text-[10px] uppercase tracking-wider text-ok mb-1">Instructions</div>
                <p class="text-xs text-gray-300 leading-relaxed">{{ turn.render.instructions }}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- BDI 轨迹 -->
      <div v-if="data.traces.length > 1" class="mt-4 card p-4">
        <h2 class="text-xs uppercase tracking-wider text-muted mb-3 flex items-center">
          BDI 状态轨迹
          <InfoTooltip text="整场会话中角色 trust/valence/arousal/resistance 的逐轮变化" />
        </h2>
        <BdiTrajectoryChart :turns="data.traces" />
      </div>

      <!-- 复盘报告（后端 WP18 落地后补全） -->
      <div class="mt-6 card p-5">
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-xs uppercase tracking-wider text-muted">复盘报告</h2>
          <span class="chip" :class="data.report.status === 'completed' ? 'bg-ok/10 text-ok' : 'bg-warn/10 text-warn'">
            {{ data.report.status }}
          </span>
        </div>
        <div v-if="data.report.techStats" class="text-sm text-gray-300 font-mono text-xs">
          <pre>{{ JSON.stringify(data.report.techStats, null, 2) }}</pre>
        </div>
        <div v-else class="text-sm text-muted">暂无报告数据</div>
      </div>
    </template>
  </div>
</template>
