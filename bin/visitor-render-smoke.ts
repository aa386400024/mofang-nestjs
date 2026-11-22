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

import { LlmService } from '../src/agent/llm/llm.service.js';
import type { ChatCaller } from '../src/engine-adapters/rendering/llm-render.adapter.js';
import type { StreamingRenderPort } from '../src/engine-adapters/rendering/streaming-render.port.js';
import { createLlmServiceChatCaller } from '../src/engine-adapters/wiring/llm-service-chat-caller.js';
import { buildEngineRenderPort, RenderConfigFactory } from '../src/engine-adapters/wiring/render-config.factory.js';
import { RouterChatCaller } from '../src/engine-adapters/wiring/router-chat-caller.js';
import type { RenderContextTurn, RenderResult, RenderSpec } from '../src/engine-core/index.js';
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

  if (outcome.text.trim().length === 0) {
    fail(`${turnLabel}渲染输出为空（degraded=${String(outcome.degraded)} provider=${outcome.providerHint ?? '-'}）`, 2);
  }
  if (outcome.degraded && !expectDegraded) {
    fail(`${turnLabel}走了降级路径：provider=${outcome.providerHint ?? '-'} finishReason=${outcome.finishReason ?? '-'}`, 2);
  }
  if (expectDegraded) {
    if (!outcome.degraded || outcome.providerHint !== 'degraded') {
      fail(
        `${turnLabel}期望显式降级（provider=degraded），实际 providerHint=${outcome.providerHint ?? '-'} degraded=${String(outcome.degraded)}`,
        2,
      );
    }
  } else if (expectFallback) {
    if (outcome.providerHint !== 'minimax') {
      fail(`${turnLabel}期望回退到 MiniMax，实际 providerHint=${outcome.providerHint ?? '-'}`, 2);
    }
    if (!outcome.fallbackUsed) {
      fail(`${turnLabel}期望 fallbackUsed=true，实际 false（主候选失败未被识别为回退）`, 2);
    }
  } else {
    if (provider === 'doubao' && outcome.providerHint !== 'doubao') {
      fail(`${turnLabel}实际候选不是豆包：providerHint=${outcome.providerHint ?? '-'}`, 2);
    }
    if (outcome.fallbackUsed) {
      fail(`${turnLabel}使用了备候选回退：provider=${outcome.providerHint ?? '-'}`, 2);
    }
  }

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
  };
  return { summary, text: outcome.text };
}

interface FaultFlags {
  readonly failPrimary: boolean;
  readonly mode: 'auth' | 'network';
  readonly expectFallback: boolean;
  readonly expectDegraded: boolean;
}

/** 解析并校验故障注入开关；语义互斥的组合同步拒绝，避免 smoke 自相矛盾。 */
function resolveFaultFlags(callerPath: string, provider: string): FaultFlags {
  const failPrimary = hasFlag('--fail-primary');
  const expectFallback = hasFlag('--expect-fallback');
  const expectDegraded = hasFlag('--expect-degraded');
  const rawMode = (arg('--fail-primary-mode', 'auth') ?? 'auth').toLowerCase();
  if (rawMode !== 'auth' && rawMode !== 'network') fail('--fail-primary-mode 只允许 auth / network');
  const mode = rawMode;

  if ((expectFallback || expectDegraded) && (callerPath !== 'router' || provider !== 'doubao')) {
    fail('--expect-fallback / --expect-degraded 只适用于 --caller router --provider doubao');
  }
  if (expectFallback && expectDegraded) fail('--expect-fallback 与 --expect-degraded 不能同时使用');
  if (failPrimary && !expectFallback && !expectDegraded) {
    fail('--fail-primary 必须配合 --expect-fallback 或 --expect-degraded');
  }
  if (mode === 'auth' && expectFallback) {
    fail('鉴权失败按生产策略直接降级、不切候选；验证真实回退请用 --fail-primary-mode network');
  }
  if (mode === 'network' && expectDegraded) {
    fail('传输失败应触发候选回退；验证鉴权降级请用 --fail-primary-mode auth');
  }
  return { failPrimary, mode, expectFallback, expectDegraded };
}

function envText(key: string): string | undefined {
  return process.env[key];
}

/** 构造生产路由链：豆包主候选 + MiniMax 备候选，两者都真实注册。 */
function buildRouterChain(
  config: ConfigService,
  faultMode: 'auth' | 'network',
  failPrimary: boolean,
): { router: LlmRouterService; caller: ChatCaller } {
  process.env['LLM_DEFAULT_CHAT_PROVIDER'] = 'doubao';
  const configuredModel = envText('LLM_DOUBAO_MODEL')?.trim();
  const doubaoModel = configuredModel === undefined || configuredModel.length === 0 ? 'doubao-seed-2-1-pro-260915' : configuredModel;
  const providerClient = new DoubaoChatProvider({
    defaultChatModel: doubaoModel,
    ...(failPrimary && faultMode === 'network' ? { baseUrl: 'http://127.0.0.1:9/v1', maxRetries: 0, requestTimeoutMs: 5000 } : {}),
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
async function probePrimaryFailure(router: LlmRouterService, probeModel: string): Promise<{ ok: false; model: string; error: string }> {
  const probeRequest: ChatCompletionRequest = {
    model: probeModel,
    messages: [{ role: 'user', content: 'ping' }],
    maxCompletionTokens: 8,
  };
  try {
    await router.chat(probeRequest, { providerId: AIProviderId.DOUBAO });
    fail('预期主候选失败，但请求成功了：故障注入未生效', 3);
  } catch (error: unknown) {
    return {
      ok: false,
      model: probeRequest.model,
      error: truncate(error instanceof Error ? error.message : String(error), 200),
    };
  }
}

interface SmokeReport {
  readonly callerPath: string;
  readonly requestedProvider: string;
  readonly faults: FaultFlags;
  readonly primaryProbe: { ok: false; model: string; error: string } | null;
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

async function main(): Promise<void> {
  loadEnvOnce();

  const provider = (arg('--provider', 'doubao') ?? 'doubao').toLowerCase();
  if (provider !== 'doubao' && provider !== 'minimax') fail('--provider 只允许 doubao / minimax');
  const callerPath = (arg('--caller', 'router') ?? 'router').toLowerCase();
  if (callerPath !== 'router' && callerPath !== 'llm-service') fail('--caller 只允许 router / llm-service');
  if (callerPath === 'router' && provider !== 'doubao') fail('--caller router 目前只支持 --provider doubao');
  const maxTokens = numberArg('--max-tokens', DEFAULT_MAX_TOKENS);
  const timeoutMs = numberArg('--timeout-ms', DEFAULT_TIMEOUT_MS);
  const turns = Math.floor(numberArg('--turns', DEFAULT_TURNS));
  const concurrency = Math.floor(numberArg('--concurrency', 1));
  const promptOverride = arg('--prompt');
  const faults = resolveFaultFlags(callerPath, provider);

  if (concurrency > 1 && turns !== 1) fail('--concurrency 与 --turns 互斥：并发模式固定单轮');
  if (concurrency > 1 && (faults.failPrimary || faults.expectFallback || faults.expectDegraded)) {
    fail('--concurrency 不与故障注入开关同时使用');
  }
  if (concurrency > 1 && promptOverride !== null) fail('--concurrency 模式不接受 --prompt 固定开场');

  // smoke 显式模拟生产开关；不写回 .env，也不改全局 ENGINE_RENDER_PRIMARY_PROVIDER。
  process.env['VISITOR_LLM_PROVIDER'] = provider;
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

  if (callerPath === 'router') {
    ({ router, caller } = buildRouterChain(config, faults.mode, faults.failPrimary));
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

  if (provider === 'doubao' && renderConfig.candidates[0]?.id !== 'doubao') {
    fail(`候选装配异常：VISITOR_LLM_PROVIDER=doubao，但主候选=${renderConfig.candidates[0]?.id ?? '(空)'}`);
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

  const batch = await executeSessions({
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
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[FAIL] 未捕获异常: ${message}`);
  process.exit(3);
});
