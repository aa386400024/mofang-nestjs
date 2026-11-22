#!/usr/bin/env node
// V2026-11-21 建立 (AF-216 · R6 事件的条件分布探针):
//   职责: 用**真实生产 prompt 拼装**对同一角色跑 steady / guarded / flooded 三组，
//         统计停顿长度、改口位置、短答与碎片形态，验证条件分布是否真的随状态变化。
//
//   边界:
//     · 不启动服务、不写 DB、不跑完整对练；只是 LLM 探针；
//     · 报告只落计数与分类，不落台词原文；
//     · 明确标注 AI 代理预评审，不是真人督导，不做临床达标结论；
//     · 没有 API key 时只能 dry-run，显式报错，不伪造结果。

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AdaptiveRenderSpec } from '../src/engine-adapters/rendering/render-risk.js';
import { buildVisitorMessages } from '../src/engine-adapters/rendering/turn-render-orchestrator.js';
import { MinimaxChatProvider } from '../src/llm/providers/minimax.provider.js';
import { stripReasoningBlocks } from '../src/shared/llm/reasoning-text.js';
import { inspectRealismEventDistribution, type RealismEventDistribution } from '../src/shared/realism/index.js';

const DEFAULT_OUT = join('data', 'phase25-exit', 'af216-realism-event-conditioning', 'report.json');
const DEFAULT_MODEL_TIMEOUT_MS = 45_000;
const PROBE_STIMULUS = '你最近睡得怎么样？如果不想说具体的，也可以只说说现在的感觉。';

interface RoleFixture {
  readonly role: 'restrained' | 'emotional' | 'chaotic_disorganized';
  readonly attachmentStyle: AdaptiveRenderSpec['attachmentStyle'];
  readonly narrativeStyle: AdaptiveRenderSpec['narrativeStyle'];
  readonly expressionTone: AdaptiveRenderSpec['expressionTone'];
}

interface StateFixture {
  readonly state: 'steady' | 'guarded' | 'flooded';
  readonly trust: number;
  readonly arousal: number;
  readonly verbalResistance: number;
  readonly depthResistance: number;
  readonly styleResistance: number;
}

const ROLES: readonly RoleFixture[] = [
  { role: 'restrained', attachmentStyle: 'secure', narrativeStyle: 'structured', expressionTone: 'restrained' },
  { role: 'emotional', attachmentStyle: 'secure', narrativeStyle: 'structured', expressionTone: 'emotional' },
  {
    role: 'chaotic_disorganized',
    attachmentStyle: 'disorganized',
    narrativeStyle: 'disorganized',
    expressionTone: 'restrained',
  },
];

const STATES: readonly StateFixture[] = [
  { state: 'steady', trust: 0.6, arousal: 0.4, verbalResistance: 0.3, depthResistance: 0.3, styleResistance: 0.3 },
  { state: 'guarded', trust: 0.2, arousal: 0.4, verbalResistance: 0.7, depthResistance: 0.3, styleResistance: 0.3 },
  { state: 'flooded', trust: 0.5, arousal: 0.8, verbalResistance: 0.4, depthResistance: 0.8, styleResistance: 0.4 },
];

function arg(name: string, fallback: string | null = null): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

function numberArg(name: string, fallback: number): number {
  const raw = arg(name);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.error(`[FAIL] ${name} 必须是正数`);
    process.exit(1);
  }
  return parsed;
}

function fail(message: string): never {
  console.error(`[FAIL] ${message}`);
  process.exit(1);
}

function makeSpec(role: RoleFixture, state: StateFixture): AdaptiveRenderSpec {
  return {
    taskKind: 'chat',
    intention: {
      strategy: 'simple_response',
      emotion: { label: 'neutral', valence: 0, arousal: state.arousal },
      resistance: { verbal: state.verbalResistance, depth: state.depthResistance, style: state.styleResistance },
      transference: { positive: 0, negative: 0, dependency: 0 },
      forbiddenBehaviors: [],
    },
    emotion: { label: 'neutral', valence: 0, arousal: state.arousal },
    resistance: { verbal: state.verbalResistance, depth: state.depthResistance, style: state.styleResistance },
    transference: { positive: 0, negative: 0, dependency: 0 },
    trust: state.trust,
    bond: 0.5,
    attachmentStyle: role.attachmentStyle,
    narrativeStyle: role.narrativeStyle,
    expressionTone: role.expressionTone,
    coreBeliefs: [],
    forbiddenBehaviors: [],
    recall: [],
    recentTurns: [{ role: 'counselor', text: PROBE_STIMULUS }],
    tokenBudget: { maxCompletionTokens: 160, contextTokens: 1024 },
    encounter: { mode: 'in_person' },
  };
}

function messageText(content: unknown): string {
  return typeof content === 'string' ? content : '';
}

function promptMaterial(spec: AdaptiveRenderSpec): { system: string; user: string } {
  const messages = buildVisitorMessages(spec);
  const system = messageText(messages.find((message) => message.role === 'system')?.content);
  const user = messageText(messages.find((message) => message.role === 'user')?.content) || PROBE_STIMULUS;
  return { system, user };
}

function promptHash(system: string): string {
  return createHash('sha256').update(system).digest('hex').slice(0, 16);
}

interface SampleDistribution {
  readonly finishReason: string;
  readonly chars: number;
  readonly distribution: RealismEventDistribution;
}

interface GroupResult {
  readonly role: RoleFixture['role'];
  readonly state: StateFixture['state'];
  readonly promptHash: string;
  readonly samples: readonly SampleDistribution[];
}

function sampleSummary(sample: SampleDistribution): {
  readonly shortAnswer: boolean;
  readonly longPause: boolean;
  readonly midRepair: boolean;
  readonly repair: boolean;
} {
  const distribution = sample.distribution;
  return {
    shortAnswer: distribution.shortAnswer,
    longPause: distribution.pauseSpanClasses.held + distribution.pauseSpanClasses.broken > 0,
    midRepair: distribution.repairPositions.mid_sentence > 0,
    repair: distribution.counts.repair > 0,
  };
}

function rate(samples: readonly SampleDistribution[], pick: (sample: SampleDistribution) => boolean): number {
  if (samples.length === 0) return 0;
  return Math.round((samples.filter(pick).length / samples.length) * 1000) / 1000;
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

interface ProbeConfig {
  readonly provider: MinimaxChatProvider;
  readonly model: string;
  readonly apiKey: string;
  readonly samplesPerGroup: number;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
}

interface AggregateCell {
  readonly samples: number;
  readonly shortAnswerRate: number;
  readonly longPauseRate: number;
  readonly midRepairRate: number;
  readonly avgSentences: number | null;
  readonly avgClauses: number | null;
}

type ProbeState = StateFixture['state'];

async function probeOne(
  config: ProbeConfig,
  role: RoleFixture,
  state: StateFixture,
  sampleIndex: number,
  material: { system: string; user: string },
): Promise<SampleDistribution> {
  const response = await config.provider.chat(
    {
      model: config.model,
      messages: [
        { role: 'system', content: material.system },
        { role: 'user', content: material.user },
      ],
      temperature: sampleIndex === 0 ? 0.65 : 0.9,
      // 模型把思考 token 计入生成长度；--max-output-tokens 只约束可见台词，
      // 内部额外留 400 token 思考余量，避免 160 全被思考吃光后返回空内容。
      maxCompletionTokens: config.maxOutputTokens + 400,
      reasoningEffort: 'low',
    },
    config.apiKey,
    AbortSignal.timeout(config.timeoutMs),
  );
  const text = stripReasoningBlocks(response.content ?? '').trim();
  if (text.length === 0) {
    const raw = response as unknown as Record<string, unknown>;
    const reasoning = typeof raw['reasoningContent'] === 'string' ? raw['reasoningContent'] : '';
    console.error(
      `[EMPTY] keys=${Object.keys(raw).join(',')} contentLen=${(response.content ?? '').length} reasoningLen=${reasoning.length} finish=${response.finishReason}`,
    );
    fail(`${role.role}/${state.state} 第 ${sampleIndex + 1} 次返回空内容`);
  }
  const distribution = inspectRealismEventDistribution(text);
  const summary = sampleSummary({ finishReason: response.finishReason, chars: text.length, distribution });
  console.log(
    `[PROBE] ${role.role}/${state.state}#${sampleIndex + 1} finish=${response.finishReason} chars=${text.length} short=${summary.shortAnswer} longPause=${summary.longPause} midRepair=${summary.midRepair} pause=${JSON.stringify(distribution.pauseSpanClasses)} repair=${JSON.stringify(distribution.repairPositions)}`,
  );
  return { finishReason: response.finishReason, chars: text.length, distribution };
}

async function probeGroup(config: ProbeConfig, role: RoleFixture, state: StateFixture): Promise<GroupResult> {
  const material = promptMaterial(makeSpec(role, state));
  const samples: SampleDistribution[] = [];
  for (let sampleIndex = 0; sampleIndex < config.samplesPerGroup; sampleIndex += 1) {
    samples.push(await probeOne(config, role, state, sampleIndex, material));
  }
  return { role: role.role, state: state.state, promptHash: promptHash(material.system), samples };
}

function aggregateGroups(groups: readonly GroupResult[]): Record<ProbeState, AggregateCell> {
  const states: readonly ProbeState[] = ['steady', 'guarded', 'flooded'];
  return Object.fromEntries(
    states.map((state) => {
      const samples = groups.filter((group) => group.state === state).flatMap((group) => group.samples);
      return [
        state,
        {
          samples: samples.length,
          shortAnswerRate: rate(samples, (sample) => sample.distribution.shortAnswer),
          longPauseRate: rate(
            samples,
            (sample) => sample.distribution.pauseSpanClasses.held + sample.distribution.pauseSpanClasses.broken > 0,
          ),
          midRepairRate: rate(samples, (sample) => sample.distribution.repairPositions.mid_sentence > 0),
          avgSentences: average(samples.map((sample) => sample.distribution.sentences)),
          avgClauses: average(samples.map((sample) => sample.distribution.clauses)),
        },
      ];
    }),
  ) as Record<ProbeState, AggregateCell>;
}

function writeReport(input: {
  readonly outPath: string;
  readonly model: string;
  readonly samplesPerGroup: number;
  readonly groups: readonly GroupResult[];
  readonly aggregate: Record<ProbeState, AggregateCell>;
  readonly gates: { readonly guardedShortAnswerHigher: boolean; readonly floodedLongOrMidRepairHigher: boolean };
}): void {
  const report = {
    version: 'af216-realism-event-conditioning-1.0.0',
    generatedAt: new Date().toISOString(),
    model: input.model,
    humanSupervision: false,
    clinicalAcceptanceEligible: false,
    disclaimer: 'AI 代理预评审，不是真人督导，不构成临床验收；本探针只比较同一角色在不同状态带的语言事件分布，不评价临床质量。',
    samplesPerGroup: input.samplesPerGroup,
    aggregate: input.aggregate,
    gates: input.gates,
    groups: input.groups,
  };
  const absoluteOut = join(process.cwd(), input.outPath);
  mkdirSync(join(absoluteOut, '..'), { recursive: true });
  writeFileSync(absoluteOut, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`[DONE] report=${input.outPath} gates=${JSON.stringify(input.gates)} textPersisted=false`);
  if (!existsSync(absoluteOut)) fail('报告未落盘');
}

function printDryRun(): void {
  for (const role of ROLES) {
    for (const state of STATES) {
      const material = promptMaterial(makeSpec(role, state));
      console.log(`[DRY] ${role.role}/${state.state} hash=${promptHash(material.system)} systemChars=${material.system.length}`);
    }
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const samplesPerGroup = numberArg('--samples', 3);
  const maxOutputTokens = numberArg('--max-output-tokens', 160);
  const timeoutMs = numberArg('--timeout-ms', DEFAULT_MODEL_TIMEOUT_MS);
  const outPath = arg('--out') ?? DEFAULT_OUT;
  const model = arg('--model') ?? process.env.MINIMAX_LLM_MODEL;
  const apiKey = process.env.MINIMAX_API_KEY;
  process.env['RENDER_REALISM_MODE'] = 'active';

  if (dryRun) {
    printDryRun();
    return;
  }
  if (!model) fail('缺少 --model 或 MINIMAX_LLM_MODEL');
  if (!apiKey) fail('缺少 MINIMAX_API_KEY（不会打印密钥）');

  const provider = new MinimaxChatProvider({
    baseUrl: process.env.MINIMAX_BASE_URL,
    defaultChatModel: process.env.MINIMAX_LLM_MODEL,
    requestTimeoutMs: timeoutMs,
    maxRetries: 1,
  });
  const config: ProbeConfig = { provider, model, apiKey, samplesPerGroup, maxOutputTokens, timeoutMs };
  const roleFilter = arg('--roles')?.split(',') ?? null;
  const stateFilter = arg('--states')?.split(',') ?? null;
  const targetGroupsRaw = arg('--target-groups');
  const targetGroups = targetGroupsRaw === null ? null : Number.parseInt(targetGroupsRaw, 10);

  const selectedRoles = ROLES.filter((item) => roleFilter === null || roleFilter.includes(item.role));
  const selectedStates = STATES.filter((item) => stateFilter === null || stateFilter.includes(item.state));
  if (targetGroups !== null && targetGroups !== selectedRoles.length * selectedStates.length) {
    fail(`--target-groups=${targetGroups} 与实际分组 ${selectedRoles.length}x${selectedStates.length} 不一致`);
  }

  const groups: GroupResult[] = [];
  for (const role of selectedRoles) {
    for (const state of selectedStates) {
      groups.push(await probeGroup(config, role, state));
    }
  }

  const aggregate = aggregateGroups(groups);
  const gates = {
    guardedShortAnswerHigher: aggregate.guarded.shortAnswerRate > aggregate.steady.shortAnswerRate,
    floodedLongOrMidRepairHigher:
      aggregate.flooded.longPauseRate > aggregate.guarded.longPauseRate ||
      aggregate.flooded.midRepairRate > aggregate.guarded.midRepairRate,
  };
  writeReport({ outPath, model, samplesPerGroup, groups, aggregate, gates });
  if (!gates.guardedShortAnswerHigher || !gates.floodedLongOrMidRepairHigher) {
    fail('条件分布闸门未通过：说明 prompt 还没把状态差异传导到输出');
  }
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
