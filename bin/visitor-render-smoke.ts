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
import { DoubaoChatProvider } from '../src/llm/providers/doubao.provider.js';
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
}

/** 跑一轮真实渲染并校验边界；任一条不满足直接非 0 退出。 */
async function runTurn(options: RunTurnOptions): Promise<{ summary: TurnSummary; text: string }> {
  const { port, counselorText, history, turn, turns, maxTokens, provider } = options;
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
  if (outcome.degraded) {
    fail(`${turnLabel}走了降级路径：provider=${outcome.providerHint ?? '-'} finishReason=${outcome.finishReason ?? '-'}`, 2);
  }
  if (provider === 'doubao' && outcome.providerHint !== 'doubao') {
    fail(`${turnLabel}实际候选不是豆包：providerHint=${outcome.providerHint ?? '-'}`, 2);
  }
  if (outcome.fallbackUsed) {
    fail(`${turnLabel}使用了备候选回退：provider=${outcome.providerHint ?? '-'}`, 2);
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
  const promptOverride = arg('--prompt');

  // smoke 显式模拟生产开关；不写回 .env，也不改全局 ENGINE_RENDER_PRIMARY_PROVIDER。
  process.env['VISITOR_LLM_PROVIDER'] = provider;
  process.env['ENGINE_RENDER_MAX_TOKENS'] = String(maxTokens);
  process.env['ENGINE_RENDER_TIMEOUT_MS'] = String(timeoutMs);

  // LlmService 构造器仍要求 MINIMAX_* 存在（生产本来配着）；smoke 如实校验前置条件。
  envRequired('MINIMAX_API_KEY');
  envRequired('MINIMAX_BASE_URL');
  envRequired('MINIMAX_LLM_MODEL');
  if (provider === 'doubao') envRequired('LLM_DOUBAO_API_KEY');

  const config = {
    get: <T>(key: string): T | undefined => process.env[key] as T | undefined,
  } as unknown as ConfigService;

  let router: LlmRouterService;
  let caller: ChatCaller;

  if (callerPath === 'router') {
    // 生产路由链：ProviderRegistry → LlmRouterService → RouterChatCaller。
    process.env['LLM_DEFAULT_CHAT_PROVIDER'] = 'doubao';
    const configuredModel = process.env['LLM_DOUBAO_MODEL']?.trim();
    const doubaoModel = configuredModel === undefined || configuredModel.length === 0 ? 'doubao-seed-2-1-pro-260915' : configuredModel;
    const providerClient = new DoubaoChatProvider({ defaultChatModel: doubaoModel });
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
    router = new LlmRouterService(registry, config);
    caller = new RouterChatCaller(router);
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

  const port = buildEngineRenderPort(caller, renderConfig);
  if (typeof port.streamRender !== 'function') fail('渲染端口没有 streamRender，无法做端到端 smoke');

  const history: RenderContextTurn[] = [];
  const turnResults: TurnSummary[] = [];
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokens = 0;

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
    });
    const summary = result.summary;
    totalPromptTokens += summary.usage?.promptTokens ?? 0;
    totalCompletionTokens += summary.usage?.completionTokens ?? 0;
    totalTokens += summary.usage?.totalTokens ?? 0;
    turnResults.push(summary);
    // 下一轮把本轮来访回复带入历史，形成 counselor/visitor 交替上下文。
    history.push({ role: 'counselor', text: counselorText }, { role: 'visitor', text: result.text });
  }

  const first = turnResults[0];
  console.log(
    JSON.stringify(
      {
        ok: true,
        callerPath,
        requestedProvider: provider,
        turns,
        configuredCandidates: renderConfig.candidates.map((candidate) => ({
          id: candidate.id,
          chatModel: candidate.overrides?.chat?.model ?? null,
        })),
        providerHint: first?.providerHint ?? null,
        model: first?.model ?? null,
        elapsedMs: first?.elapsedMs ?? null,
        ttftMs: first?.ttftMs ?? null,
        deltas: first?.deltas ?? null,
        chars: first?.chars ?? null,
        usage: first?.usage ?? null,
        totalUsage: {
          promptTokens: totalPromptTokens,
          completionTokens: totalCompletionTokens,
          totalTokens,
        },
        finishReason: first?.finishReason ?? null,
        fallbackUsed: turnResults.some((item) => item.fallbackUsed),
        degraded: turnResults.some((item) => item.degraded),
        guardLevel: first?.guardLevel ?? null,
        preview: first?.preview ?? null,
        turnDetails: turnResults,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[FAIL] 未捕获异常: ${message}`);
  process.exit(3);
});
