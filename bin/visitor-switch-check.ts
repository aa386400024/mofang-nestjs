#!/usr/bin/env node
// V2026-11-22 建立 (AF-263 · 来访者豆包切流开关自检):
//   职责: 只读真实 `.env`，解析旧 VisitorService 与引擎渲染两条链路的实际 provider 开关。
//   边界: 不发网络、不调模型、不打印密钥；只回答"现在的 env 会让谁当主候选"。
//
//   为什么不复用 smoke: smoke 在进程内覆写 env，证明的是"代码能切"；
//   本脚本不覆写，证明的是"当前 .env 真的切了"。

import 'reflect-metadata';

import type { ConfigService } from '@nestjs/config';
import { config as loadEnvFile } from 'dotenv';
import { existsSync } from 'node:fs';

import { resolveVisitorRuntime } from '../src/agent/visitor/visitor.runtime.js';
import { RenderConfigFactory } from '../src/engine-adapters/wiring/render-config.factory.js';
import { AIProviderId, LLMTier } from '../src/llm/common/enums/llm.enums.js';
import type { LlmRouterService } from '../src/llm/registry/llm-router.service.js';

function fail(message: string, exitCode = 1): never {
  console.error(`[FAIL] ${message}`);
  process.exit(exitCode);
}

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv.at(index + 1);
  if (value === undefined || value.startsWith('--')) fail(`${name} 缺少取值`, 2);
  return value;
}

function loadEnvOnce(): void {
  if (!existsSync('.env')) fail('缺少 .env，无法判断真实开关');
  const result = loadEnvFile({ path: '.env' });
  if (result.error) fail(`加载 .env 失败: ${result.error.message}`);
}

function main(): void {
  const expectedPrimary = (arg('--expect-primary') ?? 'doubao').toLowerCase();
  if (expectedPrimary !== 'doubao' && expectedPrimary !== 'minimax') {
    fail('--expect-primary 只允许 doubao / minimax', 2);
  }
  // 演练专用：只在本进程注入 env，不写 .env；dotenv 默认不覆盖已有进程变量。
  const simulated = arg('--simulate-visitor-provider');
  if (simulated !== null) {
    const value = simulated.toLowerCase();
    if (value !== 'doubao' && value !== 'minimax') {
      fail('--simulate-visitor-provider 只允许 doubao / minimax', 2);
    }
    process.env['VISITOR_LLM_PROVIDER'] = value;
  }

  loadEnvOnce();

  const config = {
    get: <T>(key: string): T | undefined => process.env[key] as T | undefined,
  } as unknown as ConfigService;

  const visitorRuntime = resolveVisitorRuntime({
    provider: process.env['VISITOR_LLM_PROVIDER'],
    promptVariant: process.env['VISITOR_PROMPT_VARIANT'],
    doubaoApiKey: process.env['LLM_DOUBAO_API_KEY'],
    doubaoModel: process.env['VISITOR_DOUBAO_MODEL'],
  });

  const minimaxModel = process.env.MINIMAX_LLM_MODEL?.trim() ?? 'MiniMax-M3';
  const fakeRouter = {
    getDefaultModelForTier: (_tier: LLMTier, provider: AIProviderId): string =>
      provider === AIProviderId.DOUBAO ? 'doubao-seed-character-260628' : minimaxModel,
  } as unknown as LlmRouterService;

  const renderConfig = new RenderConfigFactory(config, fakeRouter).build();
  const primary = renderConfig.candidates[0]?.id ?? null;
  const candidates = renderConfig.candidates.map((candidate) => ({
    id: candidate.id,
    chatModel: candidate.overrides?.chat?.model ?? null,
  }));

  const doubaoKeyPresent = (process.env['LLM_DOUBAO_API_KEY']?.trim() ?? '').length > 0;

  console.log(
    JSON.stringify(
      {
        ok: primary === expectedPrimary,
        expectedPrimary,
        visitorRuntime,
        engineRender: {
          primary,
          candidates,
          fallbackProviders: candidates.slice(1).map((candidate) => candidate.id),
        },
        env: {
          visitorLlmProvider: process.env['VISITOR_LLM_PROVIDER'] ?? null,
          visitorDoubaoModel: process.env['VISITOR_DOUBAO_MODEL'] ?? null,
          engineRenderPrimaryProvider: process.env['ENGINE_RENDER_PRIMARY_PROVIDER'] ?? null,
          doubaoApiKeyPresent: doubaoKeyPresent,
        },
      },
      null,
      2,
    ),
  );

  if (visitorRuntime.llmProvider !== expectedPrimary) {
    fail(`访客运行时主 provider=${visitorRuntime.llmProvider}，不是 ${expectedPrimary}`, 2);
  }
  if (primary !== expectedPrimary) {
    fail(`引擎渲染主候选=${primary ?? '(空)'}，不是 ${expectedPrimary}`, 2);
  }
  if (expectedPrimary === AIProviderId.DOUBAO && !candidates.some((candidate) => candidate.id === AIProviderId.MINIMAX)) {
    fail('引擎渲染没有 minimax 备候选，切流后缺回退', 2);
  }
  if (expectedPrimary === AIProviderId.MINIMAX && !candidates.some((candidate) => candidate.id === AIProviderId.DOUBAO)) {
    fail('回滚态没有 doubao 备候选，MiniMax 熔断后会直接落到兜底句', 2);
  }
}

try {
  main();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  fail(`未捕获异常: ${message}`, 3);
}
