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
import { createLlmServiceChatCaller } from '../src/engine-adapters/wiring/llm-service-chat-caller.js';
import { buildEngineRenderPort, RenderConfigFactory } from '../src/engine-adapters/wiring/render-config.factory.js';
import type { RenderSpec } from '../src/engine-core/index.js';
import type { LlmRouterService } from '../src/llm/registry/llm-router.service.js';

const DEFAULT_MAX_TOKENS = 160;
const DEFAULT_TIMEOUT_MS = 45_000;

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

/** 最小的中性来访规格：只给渲染层足够上下文，不模拟完整内核决策。 */
function buildSmokeSpec(maxCompletionTokens: number, counselorText: string): RenderSpec {
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
    recentTurns: [{ role: 'counselor', text: counselorText }],
    tokenBudget: { maxCompletionTokens, contextTokens: 4000 },
  };
}

async function main(): Promise<void> {
  loadEnvOnce();

  const provider = (arg('--provider', 'doubao') ?? 'doubao').toLowerCase();
  if (provider !== 'doubao' && provider !== 'minimax') fail('--provider 只允许 doubao / minimax');
  const maxTokens = numberArg('--max-tokens', DEFAULT_MAX_TOKENS);
  const timeoutMs = numberArg('--timeout-ms', DEFAULT_TIMEOUT_MS);
  const counselorText = arg('--prompt', '最近这一周，你睡得怎么样？') ?? '';

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
  const llm = new LlmService(config);
  const fakeRouter = {
    getDefaultModelForTier: (): string => process.env.MINIMAX_LLM_MODEL?.trim() ?? 'MiniMax-M3.1',
  } as unknown as LlmRouterService;
  const renderConfig = new RenderConfigFactory(config, fakeRouter).build();

  if (provider === 'doubao' && renderConfig.candidates[0]?.id !== 'doubao') {
    fail(`候选装配异常：VISITOR_LLM_PROVIDER=doubao，但主候选=${renderConfig.candidates[0]?.id ?? '(空)'}`);
  }

  const caller = createLlmServiceChatCaller(llm, {
    provider,
    tenantId: 'af255-smoke',
    userId: 'af255-smoke',
    traceId: 'af255',
    timeoutMs,
  });
  const port = buildEngineRenderPort(caller, renderConfig);
  if (typeof port.streamRender !== 'function') fail('渲染端口没有 streamRender，无法做端到端 smoke');

  const startedAt = Date.now();
  let firstDeltaAt: number | undefined;
  let deltas = 0;
  const outcome = await port.streamRender(buildSmokeSpec(maxTokens, counselorText), {
    onDelta: () => {
      deltas += 1;
      firstDeltaAt ??= Date.now();
    },
  });
  const elapsedMs = Date.now() - startedAt;

  if (outcome.text.trim().length === 0) {
    fail(`渲染输出为空（degraded=${outcome.degraded} provider=${outcome.providerHint ?? '-'}）`, 2);
  }
  if (outcome.degraded) {
    fail(`渲染走了降级路径：provider=${outcome.providerHint ?? '-'} finishReason=${outcome.finishReason ?? '-'}`, 2);
  }
  if (provider === 'doubao' && outcome.providerHint !== 'doubao') {
    fail(`实际候选不是豆包：providerHint=${outcome.providerHint ?? '-'}`, 2);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        requestedProvider: provider,
        configuredCandidates: renderConfig.candidates.map((candidate) => ({
          id: candidate.id,
          chatModel: candidate.overrides?.chat?.model ?? null,
        })),
        providerHint: outcome.providerHint ?? null,
        model: outcome.model ?? null,
        elapsedMs,
        ttftMs: firstDeltaAt === undefined ? null : firstDeltaAt - startedAt,
        deltas,
        chars: outcome.text.length,
        usage: outcome.usage,
        finishReason: outcome.finishReason ?? null,
        fallbackUsed: outcome.fallbackUsed,
        degraded: outcome.degraded,
        guardLevel: outcome.guardVerdict?.level ?? null,
        preview: truncate(outcome.text, 80),
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
