#!/usr/bin/env node
// V2026-11-22 建立 (AF-255 · 引擎渲染路径豆包端到端 smoke):
//   职责: 用生产 `RenderConfigFactory` + `buildEngineRenderPort` + 真实 `LlmService`，
//         让 `VISITOR_LLM_PROVIDER=doubao` 走一遍「候选装配 → 渲染适配器 → 豆包」。
//   边界: 只读 .env；单次短请求；不启动 Nest、不写库、不打印密钥与完整 prompt。
//
//   为什么不进 CI: 真实上游要 key / 计费 / 网络；CI 必须离线可复现。本脚本只在
//   灰度前 / 发版前人工执行，作为「引擎渲染路径真的能出话」的证据。

import 'reflect-metadata';

import type { ConfigService } from '@nestjs/config';
import { config as loadEnvFile } from 'dotenv';
import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { LlmService } from '../src/agent/llm/llm.service.js';
import type { RollingSummaryPort } from '../src/engine-adapters/persistence/rolling-session-summary.service.js';
import type { ChatCaller } from '../src/engine-adapters/rendering/llm-render.adapter.js';
import type { StreamingRenderPort } from '../src/engine-adapters/rendering/streaming-render.port.js';
import { MAX_HISTORY_TURNS, TurnRenderOrchestrator } from '../src/engine-adapters/rendering/turn-render-orchestrator.js';
import { createLlmServiceChatCaller } from '../src/engine-adapters/wiring/llm-service-chat-caller.js';
import { buildEngineRenderPort, RenderConfigFactory } from '../src/engine-adapters/wiring/render-config.factory.js';
import { RouterChatCaller } from '../src/engine-adapters/wiring/router-chat-caller.js';
import type {
  BdiSnapshot,
  EngineSessionPort,
  EngineTurnOutput,
  MemoryStore,
  OpenEngineSessionInput,
  RenderContextTurn,
  RenderResult,
  RenderSpec,
} from '../src/engine-core/index.js';
import { AIProviderId, LLMCapability } from '../src/llm/common/enums/llm.enums.js';
import type { ChatCompletionRequest } from '../src/llm/common/interfaces/chat-provider.interface.js';
import { DoubaoChatProvider } from '../src/llm/providers/doubao.provider.js';
import { MinimaxChatProvider } from '../src/llm/providers/minimax.provider.js';
import { LlmRouterService } from '../src/llm/registry/llm-router.service.js';
import { ProviderRegistryService } from '../src/llm/registry/provider-registry.service.js';

const DEFAULT_MAX_TOKENS = 160;
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_TURNS = 1;

/** 多轮 smoke 的咨询师台词：覆盖入睡、夜间醒来、反刍、持续时间、期待与作业。 */
const MULTI_TURN_COUNSELOR_PROMPTS = [
  '最近这一周，你睡得怎么样？',
  '听起来夜里很难熬，白天会补觉吗？',
  '躺下之后，有没有什么事一直在脑子里转？',
  '这种状态大概持续多久了？',
  '你希望我们今天从哪里开始聊？',
  '如果这周试着记录一下睡眠，你觉得可行吗？',
] as const;

/** 并发 smoke 的独立开场：每路一个会话，避免同文案互相掩盖串话。 */
const CONCURRENCY_COUNSELOR_PROMPTS = [
  '最近这一周，你睡得怎么样？',
  '白天会不会补觉？',
  '躺下之后，脑子里在想什么？',
  '这种状态大概持续多久了？',
  '夜里会醒吗？',
  '醒来之后还能睡着吗？',
  '最近工作上有变化吗？',
  '你希望我们先聊哪件事？',
] as const;

function arg(name: string, fallback: string | null = null): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

function fail(message: string, exitCode = 1): never {
  console.error(`[FAIL] ${message}`);
  process.exit(exitCode);
}

function numberArg(name: string, fallback: number): number {
  const value = arg(name);
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) fail(`${name} 必须是正数`);
  return parsed;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function loadEnvOnce(): void {
  if (!existsSync('.env')) return;
  const result = loadEnvFile({ path: '.env' });
  if (result.error) fail(`加载 .env 失败: ${result.error.message}`);
}

function envRequired(key: string): string {
  const value = process.env[key]?.trim() ?? '';
  if (value.length === 0) fail(`缺少 ${key}（不会打印密钥）`);
  return value;
}

function truncate(text: string, max: number): string {
  const clean = text.replaceAll(/\s+/gu, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}

/** 单轮 smoke 的可回执摘要。 */
interface TurnSummary {
  turn: number;
  counselor: string;
  providerHint: string | null;
  model: string | null;
  elapsedMs: number;
  ttftMs: number | null;
  deltas: number;
  chars: number;
  usage: RenderResult['usage'] | null;
  finishReason: string | null;
  fallbackUsed: boolean;
  degraded: boolean;
  guardLevel: string | null;
  preview: string;
  /** 门面路径下的 system prompt 字符数；直连端口路径拿不到时为 null. */
  promptChars: number | null;
  /** system prompt 是否带了滚动摘要（门面路径）. */
  promptHasSummary: boolean;
}

/** 最小的中性来访规格：只给渲染层足够上下文，不模拟完整内核决策。 */
function buildSmokeSpec(maxCompletionTokens: number, counselorText: string, history: readonly RenderContextTurn[] = []): RenderSpec {
  const emotion = { label: 'neutral' as const, valence: -0.1, arousal: 0.3 };
  const resistance = { verbal: 0.35, depth: 0.35, style: 0.3 };
  const transference = { positive: 0, negative: 0, dependency: 0 };
  return {
    taskKind: 'chat',
    intention: {
      strategy: 'simple_response',
      emotion,
      resistance,
      transference,
      forbiddenBehaviors: [],
    },
    emotion,
    resistance,
    transference,
    trust: 0.45,
    coreBeliefs: [],
    forbiddenBehaviors: [],
    recall: [],
    recentTurns: [...history, { role: 'counselor', text: counselorText }],
    tokenBudget: { maxCompletionTokens, contextTokens: 4000 },
  };
}

interface RunTurnOptions {
  port: StreamingRenderPort;
  counselorText: string;
  history: readonly RenderContextTurn[];
  turn: number;
  turns: number;
  maxTokens: number;
  provider: string;
  expectFallback: boolean;
  expectDegraded: boolean;
}

interface OutcomeView {
  readonly text: string;
  readonly degraded: boolean;
  readonly fallbackUsed: boolean;
  readonly providerHint: string | null;
}

/** 统一校验一轮渲染的生产边界；直连端口与门面路径共用同一套断言。 */
function assertSmokeOutcome(
  view: OutcomeView,
  turnLabel: string,
  provider: string,
  expectFallback: boolean,
  expectDegraded: boolean,
): void {
  if (view.text.trim().length === 0) {
    fail(`${turnLabel}渲染输出为空（degraded=${String(view.degraded)} provider=${view.providerHint ?? '-'}）`, 2);
  }
  if (view.degraded && !expectDegraded) {
    fail(`${turnLabel}走了降级路径：provider=${view.providerHint ?? '-'}`, 2);
  }
  if (expectDegraded) {
    if (!view.degraded || view.providerHint !== 'degraded') {
      fail(
        `${turnLabel}期望显式降级（provider=degraded），实际 providerHint=${view.providerHint ?? '-'} degraded=${String(view.degraded)}`,
        2,
      );
    }
  } else if (expectFallback) {
    if (view.providerHint !== 'minimax') {
      fail(`${turnLabel}期望回退到 MiniMax，实际 providerHint=${view.providerHint ?? '-'}`, 2);
    }
    if (!view.fallbackUsed) {
      fail(`${turnLabel}期望 fallbackUsed=true，实际 false（主候选失败未被识别为回退）`, 2);
    }
  } else {
    if (view.providerHint !== provider) {
      fail(`${turnLabel}实际候选不是 ${provider}：providerHint=${view.providerHint ?? '-'}`, 2);
    }
    if (view.fallbackUsed) {
      fail(`${turnLabel}使用了备候选回退：provider=${view.providerHint ?? '-'}`, 2);
    }
  }
}

/** 跑一轮真实渲染并校验边界；任一条不满足直接非 0 退出。 */
async function runTurn(options: RunTurnOptions): Promise<{ summary: TurnSummary; text: string }> {
  const { port, counselorText, history, turn, turns, maxTokens, provider, expectFallback, expectDegraded } = options;
  if (port.streamRender === undefined) fail('渲染端口没有 streamRender，无法做端到端 smoke');
  const startedAt = Date.now();
  let firstDeltaAt: number | undefined;
  let deltas = 0;
  const outcome = await port.streamRender(buildSmokeSpec(maxTokens, counselorText, history), {
    onDelta: () => {
      deltas += 1;
      firstDeltaAt ??= Date.now();
    },
  });
  const elapsedMs = Date.now() - startedAt;
  const turnLabel = `第 ${String(turn)}/${String(turns)} 轮`;

  assertSmokeOutcome(
    {
      text: outcome.text,
      degraded: outcome.degraded,
      fallbackUsed: outcome.fallbackUsed,
      providerHint: outcome.providerHint ?? null,
    },
    turnLabel,
    provider,
    expectFallback,
    expectDegraded,
  );

  const summary: TurnSummary = {
    turn,
    counselor: truncate(counselorText, 40),
    providerHint: outcome.providerHint ?? null,
    model: outcome.model ?? null,
    elapsedMs,
    ttftMs: firstDeltaAt === undefined ? null : firstDeltaAt - startedAt,
    deltas,
    chars: outcome.text.length,
    usage: outcome.usage ?? null,
    finishReason: outcome.finishReason ?? null,
    fallbackUsed: outcome.fallbackUsed,
    degraded: outcome.degraded,
    guardLevel: outcome.guardVerdict?.level ?? null,
    preview: truncate(outcome.text, 80),
    promptChars: null,
    promptHasSummary: false,
  };
  return { summary, text: outcome.text };
}

/** 门面 smoke 用的固定滚动摘要：只验证“摘要进 prompt”，不调 LLM. */
const SMOKE_SUMMARY_TEXT = '核心议题：睡眠困扰；关键事件：夜里反复醒来；情绪转折：从疲惫到愿意尝试记录。';

/** 假内核固定返回的中性快照；只满足渲染规格组装所需字段. */
const SMOKE_SNAPSHOT = {
  trust: 0.45,
  safety: { level: 'pass', categories: [], source: 'rule' },
  bond: 0.5,
  emotion: { label: 'neutral', valence: -0.1, arousal: 0.3 },
  resistance: { verbal: 0.35, depth: 0.35, style: 0.3 },
  transference: { positive: 0, negative: 0, dependency: 0 },
  coreBeliefs: [],
} as unknown as BdiSnapshot;

/** 假内核会话：只推进 turnIndex，不跑 BDI 决策. */
function buildFakeSession(): EngineSessionPort {
  let turnIndex = 0;
  return {
    openSession: (input: OpenEngineSessionInput) => ({ handleId: `af268-${input.sessionId}`, sessionId: input.sessionId }),
    turn: async (): Promise<EngineTurnOutput> => {
      turnIndex += 1;
      return { reply: '', snapshot: SMOKE_SNAPSHOT, turnIndex };
    },
    closeSession: (): void => undefined,
  };
}

/** 只在第 N 轮起返回固定摘要的桩；验证门面读取→prompt 接线. */
function buildSummaryStub(afterTurns: number): RollingSummaryPort {
  let recordedTurns = 0;
  return {
    latestSummary: (): string | undefined => (afterTurns > 0 && recordedTurns + 1 >= afterTurns ? SMOKE_SUMMARY_TEXT : undefined),
    recordRound: (): void => {
      recordedTurns += 1;
    },
  };
}

/** 组装生产门面：真实渲染端口 + 假内核 + 可选摘要桩. */
function buildOrchestrator(
  session: EngineSessionPort,
  port: StreamingRenderPort,
  summaryAfter: number,
  maxTokens: number,
  contextTokens: number,
): TurnRenderOrchestrator {
  return new TurnRenderOrchestrator({
    session,
    renderer: port,
    memories: { remember: async (): Promise<void> => undefined } as unknown as MemoryStore,
    resolveSession: () => ({ tenantId: 'af268-smoke', sessionId: 'af268-session', visitorId: 'af268-visitor' }),
    ...(summaryAfter > 0 ? { rollingSummary: buildSummaryStub(summaryAfter) } : {}),
    tokenBudget: { maxCompletionTokens: maxTokens, contextTokens },
  });
}

interface OrchestratedBatchOptions {
  readonly port: StreamingRenderPort;
  readonly turns: number;
  readonly maxTokens: number;
  readonly provider: string;
  readonly promptOverride: string | null;
  readonly summaryAfter: number;
  readonly contextTokens: number;
}

/** 跑一轮生产门面渲染（历史裁剪、规格组装、摘要读取全部走门面）. */
async function runOrchestratedTurn(
  orchestrator: TurnRenderOrchestrator,
  handleId: string,
  counselorText: string,
  turn: number,
  turns: number,
  provider: string,
): Promise<{ summary: TurnSummary; text: string }> {
  let firstDeltaAt: number | undefined;
  let deltas = 0;
  const startedAt = Date.now();
  const result = await orchestrator.turnStream(
    handleId,
    { userText: counselorText },
    {
      onDelta: () => {
        deltas += 1;
        firstDeltaAt ??= Date.now();
      },
    },
    { includePromptFull: true },
  );
  const elapsedMs = Date.now() - startedAt;
  const turnLabel = `第 ${String(turn)}/${String(turns)} 轮（门面）`;
  const providerHint = result.render.providerHint ?? null;
  // 门面把“系统兜底句”标成 providerHint=degraded；没有单独 degraded 字段.
  const degraded = providerHint === 'degraded';
  assertSmokeOutcome(
    { text: result.reply, degraded, fallbackUsed: result.render.fallbackUsed, providerHint },
    turnLabel,
    provider,
    false,
    false,
  );

  const promptFull = result.render.promptFull ?? '';
  const usage = result.render.usage;
  const summary: TurnSummary = {
    turn,
    counselor: truncate(counselorText, 40),
    providerHint,
    model: result.render.model ?? null,
    elapsedMs,
    ttftMs: firstDeltaAt === undefined ? null : firstDeltaAt - startedAt,
    deltas,
    chars: result.reply.length,
    usage:
      usage === undefined
        ? null
        : {
            completionTokens: usage.completionTokens,
            totalTokens: usage.totalTokens,
            ...(usage.promptTokens === undefined ? {} : { promptTokens: usage.promptTokens }),
            ...(usage.reasoningTokens === undefined ? {} : { reasoningTokens: usage.reasoningTokens }),
          },
    finishReason: result.render.finishReason ?? null,
    fallbackUsed: result.render.fallbackUsed,
    degraded,
    guardLevel: null,
    preview: truncate(result.reply, 80),
    promptChars: promptFull.length,
    promptHasSummary: promptFull.includes('此前我们聊过'),
  };
  return { summary, text: result.reply };
}

/** 门面多轮：history / trim / summary 全由 TurnRenderOrchestrator 负责. */
async function executeOrchestratedSessions(options: OrchestratedBatchOptions): Promise<SessionBatch> {
  const { port, turns, maxTokens, provider, promptOverride, summaryAfter, contextTokens } = options;
  const session = buildFakeSession();
  const orchestrator = buildOrchestrator(session, port, summaryAfter, maxTokens, contextTokens);
  const handle = session.openSession({ sessionId: 'af268-session', tenantId: 'af268-smoke', visitorId: 'af268-visitor' });
  const turnResults: TurnSummary[] = [];
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  const startedAt = Date.now();
  try {
    for (let index = 0; index < turns; index += 1) {
      const fallbackPrompt = MULTI_TURN_COUNSELOR_PROMPTS[index % MULTI_TURN_COUNSELOR_PROMPTS.length];
      const counselorText = index === 0 && promptOverride !== null ? promptOverride : fallbackPrompt;
      const { summary } = await runOrchestratedTurn(orchestrator, handle.handleId, counselorText, index + 1, turns, provider);
      promptTokens += summary.usage?.promptTokens ?? 0;
      completionTokens += summary.usage?.completionTokens ?? 0;
      totalTokens += summary.usage?.totalTokens ?? 0;
      turnResults.push(summary);
    }
  } finally {
    session.closeSession(handle.handleId);
  }
  return { turnResults, promptTokens, completionTokens, totalTokens, wallElapsedMs: Date.now() - startedAt };
}

type FaultMode = 'auth' | 'network' | 'rate-limit' | 'server-error' | 'timeout';

interface FaultFlags {
  readonly failPrimary: boolean;
  readonly mode: FaultMode;
  readonly expectFallback: boolean;
  readonly expectDegraded: boolean;
}

const FALLBACK_FAULT_MODES = new Set<FaultMode>(['network', 'rate-limit', 'server-error', 'timeout']);

/** 解析并校验故障注入开关；语义互斥的组合同步拒绝，避免 smoke 自相矛盾。 */
function resolveFaultFlags(callerPath: string, provider: string): FaultFlags {
  const failPrimary = hasFlag('--fail-primary');
  const expectFallback = hasFlag('--expect-fallback');
  const expectDegraded = hasFlag('--expect-degraded');
  const rawMode = (arg('--fail-primary-mode', 'auth') ?? 'auth').toLowerCase();
  if (!['auth', 'network', 'rate-limit', 'server-error', 'timeout'].includes(rawMode)) {
    fail('--fail-primary-mode 只允许 auth / network / rate-limit / server-error / timeout');
  }
  const mode = rawMode as FaultMode;

  if ((expectFallback || expectDegraded) && (callerPath !== 'router' || provider !== 'doubao')) {
    fail('--expect-fallback / --expect-degraded 只适用于 --caller router --provider doubao');
  }
  if (failPrimary && provider !== 'doubao') {
    fail('--fail-primary 只适用于 --provider doubao：故障注入目标是豆包主候选');
  }
  if (expectFallback && expectDegraded) fail('--expect-fallback 与 --expect-degraded 不能同时使用');
  if (failPrimary && !expectFallback && !expectDegraded) {
    fail('--fail-primary 必须配合 --expect-fallback 或 --expect-degraded');
  }
  if (mode === 'auth' && expectFallback) {
    fail('鉴权失败按生产策略直接降级、不切候选；验证真实回退请用 --fail-primary-mode network / rate-limit / server-error / timeout');
  }
  if (FALLBACK_FAULT_MODES.has(mode) && expectDegraded) {
    fail('可重试故障应触发候选回退；验证鉴权降级请用 --fail-primary-mode auth');
  }
  return { failPrimary, mode, expectFallback, expectDegraded };
}

function envText(key: string): string | undefined {
  return process.env[key];
}

interface FaultServer {
  readonly baseUrl: string;
  close(): Promise<void>;
}

/**
 * 起本机临时上游，按模式返回 429 / 500 / 挂起不响应。
 * 只用于 smoke：把豆包候选 baseUrl 指过来，就能触发真实 HTTP 状态码与真实超时，
 * 不消耗真实豆包额度，也不改 `.env`。
 */
async function startFaultServer(mode: FaultMode): Promise<FaultServer> {
  const server: Server = createServer((_request, response) => {
    if (mode === 'rate-limit') {
      response.writeHead(429, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'af269 simulated rate limit', type: 'rate_limit_error' } }));
      return;
    }
    if (mode === 'server-error') {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'af269 simulated server error', type: 'server_error' } }));
    }
    // timeout：故意不写响应，让客户端触发 requestTimeoutMs；请求对象保留到进程收尾。
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: async (): Promise<void> => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** 构造生产路由链：豆包主候选 + MiniMax 备候选，两者都真实注册。 */
function buildRouterChain(
  config: ConfigService,
  faultMode: FaultMode,
  failPrimary: boolean,
  faultBaseUrl?: string,
  primaryProvider: 'doubao' | 'minimax' = 'doubao',
): { router: LlmRouterService; caller: ChatCaller } {
  process.env['LLM_DEFAULT_CHAT_PROVIDER'] = primaryProvider;
  const configuredModel = envText('LLM_DOUBAO_MODEL')?.trim();
  const doubaoModel = configuredModel === undefined || configuredModel.length === 0 ? 'doubao-seed-2-1-pro-260915' : configuredModel;
  const providerClient = new DoubaoChatProvider({
    defaultChatModel: doubaoModel,
    ...(failPrimary && (faultMode === 'network' || faultBaseUrl !== undefined)
      ? {
          baseUrl: faultBaseUrl ?? 'http://127.0.0.1:9/v1',
          maxRetries: 0,
          requestTimeoutMs: faultMode === 'timeout' ? 2000 : 5000,
        }
      : {}),
  });
  const registry = new ProviderRegistryService();
  registry.registerChat(providerClient, {
    id: AIProviderId.DOUBAO,
    displayName: '豆包 smoke',
    baseUrl: providerClient.baseUrl,
    // router 的 apiKey 由 defaultEnvApiKeyResolver 从 env 读取，这里的占位值不参与请求。
    apiKey: '',
    capabilities: [LLMCapability.CHAT],
    defaultModels: { [LLMCapability.CHAT]: doubaoModel },
    defaultChatModel: doubaoModel,
    enabled: true,
  });
  // 备候选必须真实注册，否则 router 会按"未注册 → 回落默认"把 minimax 请求转回豆包，
  // 回退 smoke 就只能看到一次假回退。
  const minimaxModel = process.env.MINIMAX_LLM_MODEL?.trim() ?? 'MiniMax-M3';
  const minimaxClient = new MinimaxChatProvider({
    baseUrl: process.env.MINIMAX_BASE_URL,
    defaultChatModel: minimaxModel,
  });
  registry.registerChat(minimaxClient, {
    id: AIProviderId.MINIMAX,
    displayName: 'MiniMax smoke',
    baseUrl: minimaxClient.baseUrl,
    apiKey: '',
    capabilities: [LLMCapability.CHAT],
    defaultModels: { [LLMCapability.CHAT]: minimaxModel },
    defaultChatModel: minimaxModel,
    enabled: true,
  });
  const router = new LlmRouterService(registry, config);
  return { router, caller: new RouterChatCaller(router) };
}

/** 真实探一次主候选，拿到故障摘要；随后的渲染轮次复用同一故障注入。 */
async function probePrimaryFailure(
  router: LlmRouterService,
  probeModel: string,
): Promise<{ ok: false; model: string; error: string; elapsedMs: number }> {
  const probeRequest: ChatCompletionRequest = {
    model: probeModel,
    messages: [{ role: 'user', content: 'ping' }],
    maxCompletionTokens: 8,
  };
  const startedAt = Date.now();
  try {
    await router.chat(probeRequest, { providerId: AIProviderId.DOUBAO });
    fail('预期主候选失败，但请求成功了：故障注入未生效', 3);
  } catch (error: unknown) {
    return {
      ok: false,
      model: probeRequest.model,
      error: truncate(error instanceof Error ? error.message : String(error), 200),
      elapsedMs: Date.now() - startedAt,
    };
  }
}

interface SmokeReport {
  readonly callerPath: string;
  readonly requestedProvider: string;
  readonly orchestrated: boolean;
  readonly summaryAfter: number;
  readonly historyLimitTurns: number;
  readonly expectFallbackWithinMs: number | null;
  readonly faults: FaultFlags;
  readonly primaryProbe: { ok: false; model: string; error: string; elapsedMs: number } | null;
  readonly turns: number;
  readonly concurrency: number;
  readonly wallElapsedMs: number;
  readonly candidates: readonly { id: string; chatModel: string | null }[];
  readonly turnResults: readonly TurnSummary[];
  readonly usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}

/** 统一输出机读摘要：逐路明细 + 汇总，供人工与后续脚本消费。 */
function printReport(report: SmokeReport): void {
  const first = report.turnResults[0];
  console.log(
    JSON.stringify(
      {
        ok: true,
        callerPath: report.callerPath,
        requestedProvider: report.requestedProvider,
        orchestrated: report.orchestrated,
        summaryAfter: report.summaryAfter,
        historyLimitTurns: report.historyLimitTurns,
        expectFallbackWithinMs: report.expectFallbackWithinMs,
        failPrimary: report.faults.failPrimary,
        failPrimaryMode: report.faults.failPrimary ? report.faults.mode : null,
        expectFallback: report.faults.expectFallback,
        expectDegraded: report.faults.expectDegraded,
        primaryProbe: report.primaryProbe,
        turns: report.turns,
        concurrency: report.concurrency,
        wallElapsedMs: report.wallElapsedMs,
        configuredCandidates: report.candidates,
        providerHint: first?.providerHint ?? null,
        model: first?.model ?? null,
        elapsedMs: first?.elapsedMs ?? null,
        ttftMs: first?.ttftMs ?? null,
        deltas: first?.deltas ?? null,
        chars: first?.chars ?? null,
        usage: first?.usage ?? null,
        totalUsage: report.usage,
        finishReason: first?.finishReason ?? null,
        fallbackUsed: report.turnResults.some((item) => item.fallbackUsed),
        degraded: report.turnResults.some((item) => item.degraded),
        guardLevel: first?.guardLevel ?? null,
        preview: first?.preview ?? null,
        promptCharsSeries: report.turnResults.map((item) => item.promptChars),
        promptTokensSeries: report.turnResults.map((item) => item.usage?.promptTokens ?? 0),
        promptSummaryTurns: report.turnResults.filter((item) => item.promptHasSummary).map((item) => item.turn),
        turnDetails: report.turnResults,
      },
      null,
      2,
    ),
  );
}

interface SessionBatch {
  readonly turnResults: readonly TurnSummary[];
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly wallElapsedMs: number;
}

interface BatchOptions {
  port: StreamingRenderPort;
  concurrency: number;
  turns: number;
  maxTokens: number;
  provider: string;
  promptOverride: string | null;
  faults: FaultFlags;
}

/** 跑一批会话：串行多轮或 N 路并发单轮，统一汇总 usage 与墙钟。 */
async function executeSessions(options: BatchOptions): Promise<SessionBatch> {
  const { port, concurrency, turns, maxTokens, provider, promptOverride, faults } = options;
  const turnResults: TurnSummary[] = [];
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  const startedAt = Date.now();
  const record = (summary: TurnSummary): void => {
    promptTokens += summary.usage?.promptTokens ?? 0;
    completionTokens += summary.usage?.completionTokens ?? 0;
    totalTokens += summary.usage?.totalTokens ?? 0;
    turnResults.push(summary);
  };

  if (concurrency > 1) {
    const parallel = await Promise.all(
      Array.from({ length: concurrency }, async (_, index) =>
        runTurn({
          port,
          counselorText: CONCURRENCY_COUNSELOR_PROMPTS[index % CONCURRENCY_COUNSELOR_PROMPTS.length],
          history: [],
          turn: index + 1,
          turns: concurrency,
          maxTokens,
          provider,
          expectFallback: false,
          expectDegraded: false,
        }),
      ),
    );
    for (const result of parallel) record(result.summary);
  } else {
    const history: RenderContextTurn[] = [];
    for (let index = 0; index < turns; index += 1) {
      const fallbackPrompt = MULTI_TURN_COUNSELOR_PROMPTS[index % MULTI_TURN_COUNSELOR_PROMPTS.length];
      const counselorText = index === 0 && promptOverride !== null ? promptOverride : fallbackPrompt;
      const result = await runTurn({
        port,
        counselorText,
        history,
        turn: index + 1,
        turns,
        maxTokens,
        provider,
        expectFallback: faults.expectFallback,
        expectDegraded: faults.expectDegraded,
      });
      record(result.summary);
      // 下一轮把本轮来访回复带入历史，形成 counselor/visitor 交替上下文。
      history.push({ role: 'counselor', text: counselorText }, { role: 'visitor', text: result.text });
    }
  }

  return { turnResults, promptTokens, completionTokens, totalTokens, wallElapsedMs: Date.now() - startedAt };
}

interface RunOptions {
  readonly provider: 'doubao' | 'minimax';
  readonly callerPath: string;
  readonly maxTokens: number;
  readonly timeoutMs: number;
  readonly turns: number;
  readonly concurrency: number;
  readonly orchestrated: boolean;
  readonly summaryAfter: number;
  readonly contextTokens: number;
  readonly promptOverride: string | null;
  readonly expectFallbackWithinMs: number | null;
  readonly faults: FaultFlags;
}

/** 解析并校验本次 smoke 的参数组合，主流程只消费结果. */
function resolveRunOptions(): RunOptions {
  const provider = (arg('--provider', 'doubao') ?? 'doubao').toLowerCase();
  if (provider !== 'doubao' && provider !== 'minimax') fail('--provider 只允许 doubao / minimax');
  const callerPath = (arg('--caller', 'router') ?? 'router').toLowerCase();
  if (callerPath !== 'router' && callerPath !== 'llm-service') fail('--caller 只允许 router / llm-service');
  const timeoutMs = numberArg('--timeout-ms', DEFAULT_TIMEOUT_MS);
  const turns = Math.floor(numberArg('--turns', DEFAULT_TURNS));
  const concurrency = Math.floor(numberArg('--concurrency', 1));
  const orchestrated = hasFlag('--orchestrated');
  const summaryAfter = Math.floor(numberArg('--summary-after', 0));
  const contextTokens = Math.floor(numberArg('--context-tokens', 512));
  const promptOverride = arg('--prompt');
  const rawWithin = arg('--expect-fallback-within-ms');
  const expectFallbackWithinMs = rawWithin === null ? null : Math.floor(numberArg('--expect-fallback-within-ms', 0));
  const faults = resolveFaultFlags(callerPath, provider);
  // MiniMax M3 的 reasoning token 计入 completion 上限；回退/回滚 smoke 用 300 会在思考和
  // 正文之间被截断，出现「有 finish_reason=length、无完整句」的假降级。这些场景默认放宽。
  const maxTokens = numberArg('--max-tokens', faults.expectFallback || provider === 'minimax' ? 800 : DEFAULT_MAX_TOKENS);
  if (expectFallbackWithinMs !== null && !faults.expectFallback) {
    fail('--expect-fallback-within-ms 必须配合 --expect-fallback 使用');
  }
  if (expectFallbackWithinMs !== null && expectFallbackWithinMs <= 0) {
    fail('--expect-fallback-within-ms 必须是正整数');
  }

  if (concurrency > 1 && turns !== 1) fail('--concurrency 与 --turns 互斥：并发模式固定单轮');
  if (concurrency > 1 && (faults.failPrimary || faults.expectFallback || faults.expectDegraded)) {
    fail('--concurrency 不与故障注入开关同时使用');
  }
  if (concurrency > 1 && promptOverride !== null) fail('--concurrency 模式不接受 --prompt 固定开场');
  if (orchestrated && concurrency > 1) fail('--orchestrated 与 --concurrency 互斥');
  if (orchestrated && (faults.failPrimary || faults.expectFallback || faults.expectDegraded)) {
    fail('--orchestrated 暂不与故障注入开关同时使用');
  }
  return {
    provider,
    callerPath,
    maxTokens,
    timeoutMs,
    turns,
    concurrency,
    orchestrated,
    summaryAfter,
    contextTokens,
    promptOverride,
    expectFallbackWithinMs,
    faults,
  };
}

async function main(): Promise<void> {
  loadEnvOnce();
  const {
    provider,
    callerPath,
    maxTokens,
    timeoutMs,
    turns,
    concurrency,
    orchestrated,
    summaryAfter,
    contextTokens,
    promptOverride,
    expectFallbackWithinMs,
    faults,
  } = resolveRunOptions();

  // smoke 显式模拟生产开关；不写回 .env，也不改全局 ENGINE_RENDER_PRIMARY_PROVIDER。
  process.env['VISITOR_LLM_PROVIDER'] = provider;
  if (provider === 'minimax') process.env['ENGINE_RENDER_PRIMARY_PROVIDER'] = 'minimax';
  process.env['ENGINE_RENDER_MAX_TOKENS'] = String(maxTokens);
  process.env['ENGINE_RENDER_TIMEOUT_MS'] = String(timeoutMs);

  // LlmService 构造器仍要求 MINIMAX_* 存在（生产本来配着）；smoke 如实校验前置条件。
  envRequired('MINIMAX_API_KEY');
  envRequired('MINIMAX_BASE_URL');
  envRequired('MINIMAX_LLM_MODEL');
  if (provider === 'doubao') envRequired('LLM_DOUBAO_API_KEY');
  // 只在本进程注入故障，不写 .env、不打印原 key：auth 用无效 key，network 用不可达基址。
  if (faults.failPrimary && faults.mode === 'auth') process.env['LLM_DOUBAO_API_KEY'] = 'af264-invalid-key-for-smoke';

  const config = {
    get: <T>(key: string): T | undefined => process.env[key] as T | undefined,
  } as unknown as ConfigService;

  let router: LlmRouterService;
  let caller: ChatCaller;
  let doubaoModelForProbe: string | null = null;

  // 429 / 500 / 超时：起本机故障上游，把豆包候选 baseUrl 指过来。
  const needsFaultServer =
    faults.failPrimary && (faults.mode === 'rate-limit' || faults.mode === 'server-error' || faults.mode === 'timeout');
  const faultServer = needsFaultServer ? await startFaultServer(faults.mode) : null;

  if (callerPath === 'router') {
    ({ router, caller } = buildRouterChain(config, faults.mode, faults.failPrimary, faultServer?.baseUrl, provider));
    doubaoModelForProbe = envText('LLM_DOUBAO_MODEL')?.trim() ?? null;
  } else {
    const llm = new LlmService(config);
    router = {
      getDefaultModelForTier: (): string => process.env.MINIMAX_LLM_MODEL?.trim() ?? 'MiniMax-M3.1',
    } as unknown as LlmRouterService;
    caller = createLlmServiceChatCaller(llm, {
      provider,
      tenantId: 'af259-smoke',
      userId: 'af259-smoke',
      traceId: 'af259',
      timeoutMs,
    });
  }

  const renderConfig = new RenderConfigFactory(config, router).build();

  if (renderConfig.candidates[0]?.id !== provider) {
    fail(`候选装配异常：期望主候选=${provider}，实际=${renderConfig.candidates[0]?.id ?? '(空)'}`);
  }
  if (faults.expectFallback && renderConfig.candidates[1]?.id !== 'minimax') {
    fail(`回退 smoke 需要备候选 minimax，实际=${renderConfig.candidates[1]?.id ?? '(空)'}`);
  }

  const primaryProbe = faults.failPrimary
    ? await probePrimaryFailure(
        router,
        renderConfig.candidates[0]?.overrides?.chat?.model ?? doubaoModelForProbe ?? 'doubao-seed-character-260628',
      )
    : null;

  const port = buildEngineRenderPort(caller, renderConfig);
  if (typeof port.streamRender !== 'function') fail('渲染端口没有 streamRender，无法做端到端 smoke');

  const batch = orchestrated
    ? await executeOrchestratedSessions({
        port,
        turns,
        maxTokens,
        provider,
        promptOverride,
        summaryAfter,
        contextTokens,
      })
    : await executeSessions({
        port,
        concurrency,
        turns,
        maxTokens,
        provider,
        promptOverride,
        faults,
      });

  printReport({
    callerPath,
    requestedProvider: provider,
    orchestrated,
    summaryAfter,
    historyLimitTurns: MAX_HISTORY_TURNS,
    expectFallbackWithinMs,
    faults,
    primaryProbe,
    turns,
    concurrency,
    wallElapsedMs: batch.wallElapsedMs,
    candidates: renderConfig.candidates.map((candidate) => ({
      id: candidate.id,
      chatModel: candidate.overrides?.chat?.model ?? null,
    })),
    turnResults: batch.turnResults,
    usage: {
      promptTokens: batch.promptTokens,
      completionTokens: batch.completionTokens,
      totalTokens: batch.totalTokens,
    },
  });
  if (expectFallbackWithinMs !== null && batch.wallElapsedMs > expectFallbackWithinMs) {
    fail(`回退耗时 ${String(batch.wallElapsedMs)}ms 超过上限 ${String(expectFallbackWithinMs)}ms`, 2);
  }
  await faultServer?.close();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[FAIL] 未捕获异常: ${message}`);
  process.exit(3);
});
