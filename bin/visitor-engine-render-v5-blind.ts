#!/usr/bin/env node
// V2026-11-22 建立 (AF-281 · 生产引擎渲染路径 V5 A/B 盲评):
//   职责: 用生产 `TurnRenderOrchestrator` + 真实 `LlmService` 路由链，按固定 12 轮咨询师脚本
//         生成 shared / seed-v5 两臂各 12 场会话，再交给两个独立 AI 评分员盲评。
//   边界: 不启动服务、不写库、不把模型/臂身份写进评分输入；报告不输出台词原文。
//         真实上游要 key / 计费 / 网络，只在切流前人工执行。

import 'reflect-metadata';

import type { ConfigService } from '@nestjs/config';
import { config as loadEnvFile } from 'dotenv';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createRaterEndpoint, type RaterEndpoint } from './realism-rater-runtime.js';
import {
  analyzeArmObjective,
  analyzeArmScores,
  projectVisitorSpeech,
  type SimArmObjective,
  type SimArmScores,
  type SimDifficulty,
  type SimProvider,
  type SimScoredSession,
  type SimSessionRecord,
  type SimTurnRecord,
} from './visitor-sim-analysis.js';
import { COUNSELOR_SCRIPT } from './visitor-sim-prompts.js';
import {
  buildRealismRaterCompactPrompt,
  buildRealismRaterPrompt,
  parseRealismRating,
  REALISM_DIMENSIONS,
  type RealismBlindPacket,
  type RealismDimension,
  type RealismRating,
} from '../src/auto-practice/metrics/visitor-realism-rating.js';
import { VISITOR_POOL_TEMPLATE_SEEDS, type VisitorPoolTemplateSeed } from '../src/counselor/config/visitor-pool-seed.js';
import type { ChatCaller } from '../src/engine-adapters/rendering/llm-render.adapter.js';
import { buildRenderSpec } from '../src/engine-adapters/rendering/spec-assembler.js';
import type { StreamingRenderPort } from '../src/engine-adapters/rendering/streaming-render.port.js';
import { TurnRenderOrchestrator } from '../src/engine-adapters/rendering/turn-render-orchestrator.js';
import { buildEngineRenderPort, RenderConfigFactory } from '../src/engine-adapters/wiring/render-config.factory.js';
import { RouterChatCaller } from '../src/engine-adapters/wiring/router-chat-caller.js';
import type {
  AttachmentStyle,
  BdiSnapshot,
  BehaviorStrategy,
  EngineSessionPort,
  EngineTurnOutput,
  MemoryStore,
  OpenEngineSessionInput,
} from '../src/engine-core/index.js';
import { createEmptyBdiSnapshot } from '../src/engine-core/index.js';
import { AIProviderId, LLMCapability } from '../src/llm/common/enums/llm.enums.js';
import { DoubaoChatProvider } from '../src/llm/providers/doubao.provider.js';
import { MinimaxChatProvider } from '../src/llm/providers/minimax.provider.js';
import { LlmRouterService } from '../src/llm/registry/llm-router.service.js';
import { ProviderRegistryService } from '../src/llm/registry/provider-registry.service.js';
import type { VisitorPromptVariant } from '../src/shared/realism/visitor-prompt-variants.js';

const TURNS_PER_SESSION = COUNSELOR_SCRIPT.length;
const DEFAULT_OUT = join('data', 'phase25-exit', 'af280-engine-render-v5');
const DEFAULT_PERSONAS = [
  'vpt_self_worth_intellectualization_l1',
  'vpt_intimate_avoidance_l1',
  'vpt_parenting_projection_l1',
  'vpt_grief_avoidance_l1',
] as const;
const DIFFICULTIES: readonly SimDifficulty[] = ['L1', 'L2', 'L3'];
const ARMS: readonly { readonly key: string; readonly variant: VisitorPromptVariant }[] = [
  { key: 'shared', variant: 'shared' as const },
  { key: 'seed-v5', variant: 'seed-v5' as const },
];
const RATER_SPECS = [
  { raterId: 'R1' as const, provider: 'doubao' as const, temperature: 0, thinking: 'enabled' as const },
  { raterId: 'R2' as const, provider: 'doubao' as const, temperature: 0, thinking: 'enabled' as const },
];

function arg(name: string, fallback: string | null = null): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

function fail(message: string): never {
  console.error(`[FAIL] ${message}`);
  process.exit(1);
}

function numberArg(name: string, fallback: number): number {
  const value = arg(name);
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) fail(`${name} 必须是正数`);
  return parsed;
}

function envRequired(key: string): string {
  const value = process.env[key]?.trim() ?? '';
  if (value.length === 0) fail(`缺少 ${key}（不会打印密钥）`);
  return value;
}

function loadEnvOnce(): void {
  if (!existsSync('.env')) fail('缺少 .env');
  const result = loadEnvFile({ path: '.env' });
  if (result.error) fail(`加载 .env 失败: ${result.error.message}`);
}

function resolvePersonas(): readonly string[] {
  const raw = arg('--personas');
  if (raw === null || raw.trim().length === 0) return DEFAULT_PERSONAS;
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function resolveDifficulties(): readonly SimDifficulty[] {
  const raw = arg('--difficulties');
  if (raw === null || raw.trim().length === 0) return DIFFICULTIES;
  const parsed = raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (parsed.some((item) => !(DIFFICULTIES as readonly string[]).includes(item))) {
    fail(`--difficulties 只允许 ${DIFFICULTIES.join(',')}`);
  }
  return parsed as readonly SimDifficulty[];
}

function seedFor(personaId: string): VisitorPoolTemplateSeed {
  const seed = VISITOR_POOL_TEMPLATE_SEEDS.find((item) => item.id === personaId);
  if (seed === undefined) fail(`未知 persona：${personaId}`);
  return seed;
}

interface DifficultyProfile {
  readonly trust: number;
  readonly resistance: { verbal: number; depth: number; style: number };
  readonly emotion: { label: BdiSnapshot['emotion']['label']; valence: number; arousal: number };
  readonly strategy: BehaviorStrategy;
  readonly encounter: 'in_person' | 'online_voice' | 'online_text';
  readonly attachmentStyle: AttachmentStyle;
  readonly forbidden: readonly string[];
  readonly trajectory: string;
}

function difficultyProfile(difficulty: SimDifficulty, seed: VisitorPoolTemplateSeed): DifficultyProfile {
  const attachmentType = seed.script.innerWorkingModel.attachmentType;
  const attachmentStyle: AttachmentStyle = attachmentType === 'avoidant' ? 'avoidant' : attachmentType === 'anxious' ? 'anxious' : 'secure';
  if (difficulty === 'L1') {
    return {
      trust: 0.48,
      resistance: { verbal: 0.25, depth: 0.2, style: 0.2 },
      emotion: { label: 'anxious', valence: -0.35, arousal: 0.55 },
      strategy: 'simple_response',
      encounter: 'in_person',
      attachmentStyle,
      forbidden: ['主动提问', '总结咨询师的话', '解释心理机制'],
      trajectory: seed.presentingComplaint,
    };
  }
  if (difficulty === 'L2') {
    return {
      trust: 0.34,
      resistance: { verbal: 0.45, depth: 0.5, style: 0.38 },
      emotion: { label: 'guarded', valence: -0.45, arousal: 0.4 },
      strategy: 'resistance',
      encounter: 'online_voice',
      attachmentStyle,
      forbidden: ['主动推进剧情', '一次性交底', '突然领悟'],
      trajectory: seed.presentingComplaint,
    };
  }
  return {
    trust: 0.22,
    resistance: { verbal: 0.66, depth: 0.72, style: 0.52 },
    emotion: { label: 'guarded', valence: -0.6, arousal: 0.28 },
    strategy: 'resistance',
    encounter: 'online_text',
    attachmentStyle,
    forbidden: ['主动推进剧情', '一次性交底', '突然领悟', '说出任何抽象心理标签'],
    trajectory: seed.presentingComplaint,
  };
}

interface SessionRun {
  readonly arm: string;
  readonly variant: VisitorPromptVariant;
  readonly seed: VisitorPoolTemplateSeed;
  readonly difficulty: SimDifficulty;
  readonly profile: DifficultyProfile;
  readonly record: SimSessionRecord;
  readonly messages: readonly { readonly role: 'counselor' | 'visitor'; readonly text: string }[];
}

interface ScoreInput {
  readonly arm: string;
  readonly record: SimSessionRecord;
  readonly packet: RealismBlindPacket;
  readonly personaCard: string;
}

interface SessionCacheEntry {
  readonly record: SimSessionRecord;
  readonly packet: RealismBlindPacket;
  readonly personaCard: string;
}

function buildSnapshot(profile: DifficultyProfile, seed: VisitorPoolTemplateSeed): BdiSnapshot {
  const base = createEmptyBdiSnapshot();
  const coreBeliefs = seed.script.innerWorkingModel.coreBeliefs.map((statement, index) => ({
    theme: `af281_${String(index)}`,
    statement,
    activationTags: [],
  }));
  return {
    ...base,

    trust: profile.trust,
    safety: profile.trust * 0.9,
    bond: profile.trust * 1.1,
    emotion: profile.emotion,
    resistance: profile.resistance,
    transference: { positive: 0.1, negative: 0.05, dependency: 0.05 },
    coreBeliefs,
  };
}

function buildFakeSession(profile: DifficultyProfile, seed: VisitorPoolTemplateSeed): EngineSessionPort {
  let turnIndex = 0;
  return {
    openSession: (input: OpenEngineSessionInput) => ({ handleId: `af281-${input.sessionId}`, sessionId: input.sessionId }),
    turn: async (): Promise<EngineTurnOutput> => {
      turnIndex += 1;
      const snapshot = buildSnapshot(profile, seed);
      return {
        reply: '',
        snapshot,
        turnIndex,
        intention: {
          strategy: profile.strategy,
          emotion: profile.emotion,
          resistance: profile.resistance,
          transference: snapshot.transference,
          forbiddenBehaviors: [],
        },
      };
    },
    closeSession: (): void => undefined,
  };
}

function buildOrchestrator(
  session: EngineSessionPort,
  port: StreamingRenderPort,
  seed: VisitorPoolTemplateSeed,
  profile: DifficultyProfile,
): TurnRenderOrchestrator {
  return new TurnRenderOrchestrator({
    session,
    renderer: port,
    memories: { remember: async (): Promise<void> => undefined } as unknown as MemoryStore,
    resolveSession: () => ({ tenantId: 'af281', sessionId: `af281-${seed.id}`, visitorId: `af281-${seed.id}` }),
    assembler: (input) =>
      buildRenderSpec({
        ...input,
        roleForbiddenBehaviors: profile.forbidden,
        trajectoryNote: profile.trajectory,
        attachmentStyle: profile.attachmentStyle,
        encounter: { mode: profile.encounter },
        characterLabel: seed.codename,
      }),
    tokenBudget: { maxCompletionTokens: 240, contextTokens: 4000 },
  });
}

function buildRouter(config: ConfigService, primaryProvider: SimProvider): { router: LlmRouterService; caller: ChatCaller } {
  process.env['LLM_DEFAULT_CHAT_PROVIDER'] = primaryProvider;
  const doubaoModel = envNonEmpty('VISITOR_DOUBAO_MODEL', 'LLM_DOUBAO_MODEL') ?? 'doubao-seed-character-260628';
  const doubao = new DoubaoChatProvider({ defaultChatModel: doubaoModel });
  const registry = new ProviderRegistryService();
  registry.registerChat(doubao, {
    id: AIProviderId.DOUBAO,
    displayName: 'AF-281 doubao',
    baseUrl: doubao.baseUrl,
    apiKey: '',
    capabilities: [LLMCapability.CHAT],
    defaultModels: { [LLMCapability.CHAT]: doubaoModel },
    defaultChatModel: doubaoModel,
    enabled: true,
  });
  const minimaxModel = envNonEmpty('MINIMAX_LLM_MODEL') ?? 'MiniMax-M3';
  const minimax = new MinimaxChatProvider({
    baseUrl: process.env.MINIMAX_BASE_URL,
    defaultChatModel: minimaxModel,
  });
  registry.registerChat(minimax, {
    id: AIProviderId.MINIMAX,
    displayName: 'AF-281 minimax',
    baseUrl: minimax.baseUrl,
    apiKey: '',
    capabilities: [LLMCapability.CHAT],
    defaultModels: { [LLMCapability.CHAT]: minimaxModel },
    defaultChatModel: minimaxModel,
    enabled: true,
  });
  const router = new LlmRouterService(registry, config);
  return { router, caller: new RouterChatCaller(router) };
}

/** 取第一个非空 env 值；空串不算配置。 */
function envNonEmpty(...keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value !== undefined && value.length > 0) return value;
  }
  return undefined;
}

function buildArmPort(
  caller: ChatCaller,
  config: ConfigService,
  router: LlmRouterService,
  variant: VisitorPromptVariant,
): StreamingRenderPort {
  const factory = new RenderConfigFactory(config, router);
  return buildEngineRenderPort(caller, factory.build(), undefined, undefined, variant);
}

async function runSession(
  port: StreamingRenderPort,
  seed: VisitorPoolTemplateSeed,
  difficulty: SimDifficulty,
  arm: (typeof ARMS)[number],
): Promise<SessionRun> {
  const profile = difficultyProfile(difficulty, seed);
  const session = buildFakeSession(profile, seed);
  const orchestrator = buildOrchestrator(session, port, seed, profile);
  const handle = session.openSession({ sessionId: `af281-${arm.key}-${seed.id}-${difficulty}`, tenantId: 'af281', visitorId: seed.id });
  const turns: SimTurnRecord[] = [];
  const messages: { role: 'counselor' | 'visitor'; text: string }[] = [];
  try {
    for (const counselor of COUNSELOR_SCRIPT) {
      let firstDeltaAt: number | undefined;
      const startedAt = performance.now();
      const result = await orchestrator.turnStream(
        handle.handleId,
        { userText: counselor },
        {
          onDelta: () => {
            firstDeltaAt ??= performance.now();
          },
        },
      );
      const raw = result.reply;
      const visitor = projectVisitorSpeech(raw);
      messages.push({ role: 'counselor', text: counselor }, { role: 'visitor', text: visitor });
      turns.push({
        turnIndex: turns.length + 1,
        counselor,
        visitor,
        visitorRaw: raw,
        firstTokenMs: Math.round((firstDeltaAt ?? performance.now()) - startedAt),
        totalMs: Math.round(performance.now() - startedAt),
        promptTokens: result.render.usage?.promptTokens ?? 0,
        completionTokens: result.render.usage?.completionTokens ?? 0,
        reasoningTokens: result.render.usage?.reasoningTokens ?? 0,
        finishReason: result.render.finishReason ?? '',
      });
    }
  } finally {
    session.closeSession(handle.handleId);
  }
  const record: SimSessionRecord = {
    sessionId: handle.sessionId,
    arm: arm.key,
    provider: 'doubao',
    model: envNonEmpty('VISITOR_DOUBAO_MODEL') ?? 'doubao-seed-character-260628',
    promptVariant: arm.variant,
    personaId: seed.id,
    personaLabel: seed.codename,
    difficulty,
    scene: profile.encounter,
    turns,
  };
  return { arm: arm.key, variant: arm.variant, seed, difficulty, profile, record, messages };
}

function personaCard(run: SessionRun): string {
  const { seed, difficulty } = run;
  const script = seed.script;
  return [
    '## 来访者 persona 卡',
    `- 代号：${seed.codename}；年龄区间：${seed.ageRange}；难度档：${difficulty}`,
    `- 职业：${script.basics.occupation}；主诉：${seed.presentingComplaint}`,
    `- 依恋类型：${script.innerWorkingModel.attachmentType}；防御：${script.innerWorkingModel.defenseMechanisms.join('、')}`,
    `- 核心信念：${script.innerWorkingModel.coreBeliefs.join('；')}`,
    `- 当前阻抗基线：话量 ${String(run.profile.resistance.verbal)}／深度 ${String(run.profile.resistance.depth)}／风格 ${String(run.profile.resistance.style)}`,
  ].join('\n');
}

function toPacket(run: SessionRun): RealismBlindPacket {
  return {
    packetId: createPacketId(run.record.sessionId),
    scene: run.profile.encounter,
    turns: run.messages.map((message, index) => ({ turnIndex: index + 1, role: message.role, text: message.text })),
  };
}

function createPacketId(sessionId: string): string {
  let hash = 0;
  for (let index = 0; index < sessionId.length; index += 1) {
    hash = (hash * 31 + (sessionId.codePointAt(index) ?? 0)) % 0x1_00_00_00_00;
  }
  return `af281_${Math.abs(hash).toString(16).padStart(8, '0').slice(-8)}`;
}

function scoreInputFromRun(run: SessionRun): ScoreInput {
  return { arm: run.arm, record: run.record, packet: toPacket(run), personaCard: personaCard(run) };
}

function loadSessionCache(path: string): readonly ScoreInput[] {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { sessions?: readonly SessionCacheEntry[] };
  if (parsed.sessions === undefined) fail(`会话缓存格式不合法：${path}`);
  return parsed.sessions.map((entry) => ({
    arm: entry.record.arm,
    record: entry.record,
    packet: entry.packet,
    personaCard: entry.personaCard,
  }));
}

async function callRater(
  endpoint: RaterEndpoint,
  packet: RealismBlindPacket,
  persona: string,
  raterId: 'R1' | 'R2',
): Promise<{ rating: RealismRating; attempts: number }> {
  let lastError = '';
  for (let attempt = 0; attempt <= 2; attempt += 1) {
    const base = attempt === 0 ? buildRealismRaterPrompt(packet, raterId) : buildRealismRaterCompactPrompt(packet, raterId, lastError);
    const user = [`请结合这份 persona 卡理解来访者的基线，再按五维锚点打分。`, '', persona, '', base.user].join('\n');
    try {
      const response = await endpoint.providerInstance.chat(
        {
          model: endpoint.model,
          messages: [
            { role: 'system', content: base.system },
            { role: 'user', content: user },
          ],
          temperature: attempt === 0 ? endpoint.temperature : 0.2,
          maxCompletionTokens: 4000,
          ...(endpoint.reasoningEffort === undefined ? {} : { reasoningEffort: endpoint.reasoningEffort }),
        },
        endpoint.apiKey,
        AbortSignal.timeout(90_000),
      );
      const parsed = parseRealismRating(response.content, packet);
      if (parsed.ok) return { rating: parsed.rating, attempts: attempt };
      lastError = parsed.error;
      console.warn(
        `[RATER_SHAPE] ${raterId} attempt=${String(attempt)} finish=${response.finishReason} chars=${String(response.content.length)} error=${parsed.error}`,
      );
    } catch (error: unknown) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(`${raterId}_parse_failed:${lastError}`);
}

async function main(): Promise<void> {
  loadEnvOnce();
  envRequired('LLM_DOUBAO_API_KEY');
  envRequired('MINIMAX_API_KEY');
  envRequired('MINIMAX_BASE_URL');
  envRequired('MINIMAX_LLM_MODEL');

  const outDir = arg('--out', DEFAULT_OUT) ?? DEFAULT_OUT;
  const personas = resolvePersonas();
  const difficulties = resolveDifficulties();
  const concurrency = Math.floor(numberArg('--concurrency', 2));
  const sourcePath = arg('--from-sessions');

  mkdirSync(outDir, { recursive: true });
  let scoreInputs: readonly ScoreInput[];
  if (sourcePath === null) {
    const config = { get: <T>(key: string): T | undefined => process.env[key] as T | undefined } as unknown as ConfigService;
    const { router, caller } = buildRouter(config, 'doubao');
    const ports = new Map<string, StreamingRenderPort>();
    for (const arm of ARMS) ports.set(arm.key, buildArmPort(caller, config, router, arm.variant));

    const jobs: { seed: VisitorPoolTemplateSeed; difficulty: SimDifficulty; arm: (typeof ARMS)[number] }[] = [];
    for (const personaId of personas) {
      const seed = seedFor(personaId);
      for (const difficulty of difficulties) {
        for (const arm of ARMS) jobs.push({ seed, difficulty, arm });
      }
    }

    console.log(
      `[PLAN] sessions=${String(jobs.length)} turns=${String(TURNS_PER_SESSION)} personas=${String(personas.length)} concurrency=${String(concurrency)}`,
    );
    const runs = await mapLimit(jobs, concurrency, async (job, index) => {
      const port = ports.get(job.arm.key);
      if (port === undefined) fail(`未装配 arm 端口：${job.arm.key}`);
      const run = await runSession(port, job.seed, job.difficulty, job.arm);
      console.log(
        `[SESSION] ${String(index + 1)}/${String(jobs.length)} arm=${job.arm.key} persona=${job.seed.id} difficulty=${job.difficulty}`,
      );
      return run;
    });
    scoreInputs = runs.map(scoreInputFromRun);
    const cache: readonly SessionCacheEntry[] = runs.map((run) => ({
      record: run.record,
      packet: toPacket(run),
      personaCard: personaCard(run),
    }));
    writeFileSync(join(outDir, 'sessions.json'), `${JSON.stringify({ sessions: cache }, null, 2)}\n`, 'utf8');
  } else {
    scoreInputs = loadSessionCache(sourcePath);
  }
  const records = scoreInputs.map((input) => input.record);

  const raterEndpoints = RATER_SPECS.map((spec) => ({
    ...spec,
    endpoint: createRaterEndpoint(
      {
        provider: spec.provider,
        temperature: spec.temperature,
        thinking: spec.thinking,
      },
      { timeoutMs: 90_000 },
    ),
  }));

  for (const rater of raterEndpoints) {
    console.log(`[RATER] ${rater.raterId} provider=${rater.provider} model=${rater.endpoint.model}`);
  }

  const scored: SimScoredSession[] = [];
  for (const input of scoreInputs) {
    const scores = [];
    for (const rater of raterEndpoints) {
      const rated = await callRater(rater.endpoint, input.packet, input.personaCard, 'R1');
      scores.push({
        raterId: rater.raterId,
        provider: rater.provider,
        model: rater.endpoint.model,
        dimensions: Object.fromEntries(
          REALISM_DIMENSIONS.map((dimension) => [dimension, rated.rating.dimensions[dimension].score]),
        ) as Record<RealismDimension, number>,
        overall: rated.rating.overall,
        parseRetries: rated.attempts,
        promptTokens: 0,
        completionTokens: 0,
        reasoningTokens: 0,
      });
      console.log(
        `[SCORE] ${input.packet.packetId} ${rater.raterId} overall=${String(rated.rating.overall)} retries=${String(rated.attempts)}`,
      );
    }
    scored.push({ sessionId: input.record.sessionId, arm: input.arm, difficulty: input.record.difficulty, scores });
  }
  writeFileSync(join(outDir, 'ratings.json'), `${JSON.stringify({ sessions: scored }, null, 2)}\n`, 'utf8');

  const objectives: SimArmObjective[] = ARMS.map((arm) => analyzeArmObjective(records.filter((record) => record.arm === arm.key)));
  const scoresByArm: SimArmScores[] = ARMS.map((arm) => analyzeArmScores(scored.filter((session) => session.arm === arm.key)));

  const baseline = objectives.find((item) => item.arm === 'shared');
  const v5 = objectives.find((item) => item.arm === 'seed-v5');
  const baselineScores = scoresByArm.find((item) => item.arm === 'shared');
  const v5Scores = scoresByArm.find((item) => item.arm === 'seed-v5');
  if (baseline === undefined || v5 === undefined || baselineScores === undefined || v5Scores === undefined) {
    fail('缺少 shared 或 seed-v5 的指标/评分');
  }

  const hardGates = [
    { id: 'ai-reveal-zero', passed: v5.overall.aiRevealCount === 0, observed: v5.overall.aiRevealCount, threshold: '= 0' },
    { id: 'advice-zero', passed: v5.overall.adviceCount === 0, observed: v5.overall.adviceCount, threshold: '= 0' },
    { id: 'summary-zero', passed: v5.overall.summaryCount === 0, observed: v5.overall.summaryCount, threshold: '= 0' },
    { id: 'plot-zero', passed: v5.overall.plotCount === 0, observed: v5.overall.plotCount, threshold: '= 0' },
    {
      id: 'raw-bracket-zero',
      passed: v5.overall.rawStageDirectionCount === 0,
      observed: v5.overall.rawStageDirectionCount,
      threshold: '= 0',
    },
    { id: 'tag-error-rate', passed: v5.overall.tagErrorRate < 0.01, observed: v5.overall.tagErrorRate, threshold: '< 0.01' },
    {
      id: 'l3-short-vs-shared',
      passed:
        (v5.byDifficulty.find((item) => item.difficulty === 'L3')?.shortTurnRate ?? 0) /
          Math.max(0.000001, baseline.byDifficulty.find((item) => item.difficulty === 'L3')?.shortTurnRate ?? 0) >=
        0.8,
      observed: v5.byDifficulty.find((item) => item.difficulty === 'L3')?.shortTurnRate ?? 0,
      threshold: '>= shared 的 80%',
    },
    { id: 'first-token-p95', passed: v5.overall.firstTokenP95Ms < 1500, observed: v5.overall.firstTokenP95Ms, threshold: '< 1500ms' },
  ];
  const softGates = [
    {
      id: 'mean-vs-shared',
      passed: v5Scores.meanOverall >= baselineScores.meanOverall - 0.2,
      observed: v5Scores.meanOverall,
      threshold: `>= ${String(baselineScores.meanOverall - 0.2)}`,
    },
    {
      id: 'cooperation-vs-shared',
      passed: v5.overall.cooperationIndex <= baseline.overall.cooperationIndex,
      observed: v5.overall.cooperationIndex,
      threshold: `<= ${String(baseline.overall.cooperationIndex)}`,
    },
    {
      id: 'cross-rater-kappa',
      passed: (v5Scores.agreement.linearWeightedKappa ?? 0) >= 0.4,
      observed: v5Scores.agreement.linearWeightedKappa,
      threshold: '>= 0.4',
    },
    { id: 'mean-abs-delta', passed: v5Scores.meanAbsOverallDelta <= 0.3, observed: v5Scores.meanAbsOverallDelta, threshold: '<= 0.3' },
    { id: 'length-std', passed: v5.overall.visibleCharsStd >= 0.5, observed: v5.overall.visibleCharsStd, threshold: '>= 0.5' },
  ];
  const hardFailures = hardGates.filter((gate) => !gate.passed).map((gate) => gate.id);
  const softFailures = softGates.filter((gate) => !gate.passed).map((gate) => gate.id);
  const verdict = hardFailures.length > 0 ? 'fail' : softFailures.length > 0 ? 'conditional' : 'pass';

  const report = {
    taskId: 'AF-281',
    generatedAt: new Date().toISOString(),
    runtime: 'production TurnRenderOrchestrator + RenderConfigFactory + LlmRouterService',
    turnsPerSession: TURNS_PER_SESSION,
    sessionsPerArm: records.filter((record) => record.arm === 'shared').length,
    personas: [...new Set(records.map((record) => record.personaId))],
    difficulties: [...new Set(records.map((record) => record.difficulty))],
    arms: ARMS.map((arm) => ({ key: arm.key, promptVariant: arm.variant })),
    raters: raterEndpoints.map((rater) => ({ raterId: rater.raterId, provider: rater.provider, model: rater.endpoint.model })),
    objectives,
    scores: scoresByArm,
    hardGates,
    softGates,
    hardFailures,
    softFailures,
    verdict,
    armSessionMap: records.map((record) => ({
      arm: record.arm,
      sessionId: record.sessionId,
      personaId: record.personaId,
      difficulty: record.difficulty,
    })),
  };

  mkdirSync(outDir, { recursive: true });
  if (arg('--dump-raw') === '1' && sourcePath === null) {
    writeFileSync(
      join(outDir, 'debug-raw.jsonl'),
      `${records
        .map((record) =>
          JSON.stringify({
            arm: record.arm,
            sessionId: record.sessionId,
            difficulty: record.difficulty,
            turns: record.turns.map((turn) => ({ turnIndex: turn.turnIndex, raw: turn.visitorRaw })),
          }),
        )
        .join('\n')}\n`,
      'utf8',
    );
  }
  writeFileSync(join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(join(outDir, 'summary.md'), renderSummary(report, objectives, scoresByArm), 'utf8');
  console.log(JSON.stringify({ ok: verdict !== 'fail', verdict, hardFailures, softFailures, outDir }, null, 2));
  if (verdict === 'fail') process.exit(2);
}

function renderSummary(report: Record<string, unknown>, objectives: readonly SimArmObjective[], scores: readonly SimArmScores[]): string {
  const lines = [
    '# AF-281 生产引擎渲染路径 V5 A/B 盲评',
    '',
    `- 生成时间：${String(report['generatedAt'])}`,
    `- 生产路径：${String(report['runtime'])}`,
    `- 会话数：每臂 ${String(report['sessionsPerArm'])} 场 × ${String(report['turnsPerSession'])} 轮`,
    `- 判定：${String(report['verdict'])}`,
    '',
    '## 门槛',
  ];
  const gates = [
    ...(report['hardGates'] as { id: string; passed: boolean; observed: unknown; threshold: string }[]),
    ...(report['softGates'] as { id: string; passed: boolean; observed: unknown; threshold: string }[]),
  ];
  for (const gate of gates) lines.push(`- ${gate.passed ? 'PASS' : 'FAIL'} ${gate.id}：${String(gate.observed)}（门槛 ${gate.threshold}）`);
  lines.push(
    '',
    '## 客观指标',
    '',
    '| arm | AI暴露 | 建议 | 总结 | 剧情 | 原始括号 | 标记错误率 | L3短答率 | 首token P95 | 过度配合 | 字数std |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const item of objectives) {
    const o = item.overall;
    lines.push(
      `| ${item.arm} | ${String(o.aiRevealCount)} | ${String(o.adviceCount)} | ${String(o.summaryCount)} | ${String(o.plotCount)} | ${String(o.rawStageDirectionCount)} | ${String(o.tagErrorRate)} | ${String(item.byDifficulty.find((d) => d.difficulty === 'L3')?.shortTurnRate ?? 0)} | ${String(o.firstTokenP95Ms)}ms | ${String(o.cooperationIndex)} | ${String(o.visibleCharsStd)} |`,
    );
  }
  lines.push('', '## 盲评', '', '| arm | 均值 | κ | 绝对差 | 分布 |', '| --- | --- | --- | --- | --- |');
  for (const item of scores) {
    lines.push(
      `| ${item.arm} | ${String(item.meanOverall)} | ${String(item.agreement.linearWeightedKappa ?? 'null')} | ${String(item.meanAbsOverallDelta)} | ${JSON.stringify(item.distribution)} |`,
    );
  }
  lines.push('', '> AI 代理评分，非真人督导双标；不声称临床达标。报告不包含台词原文。');
  return `${lines.join('\n')}\n`;
}

async function mapLimit<T, R>(items: readonly T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length }, () => null as unknown as R);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await task(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker()));
  return results;
}

main().catch((error: unknown) => {
  console.error(`[FAIL] 未捕获异常: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(3);
});
