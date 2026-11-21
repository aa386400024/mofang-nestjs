#!/usr/bin/env node
// V2026-11-22 建立 (AF-249 · visitor 豆包 Seed Character 生产链路 smoke):
//   职责: 用生产 LlmService 的 per-call provider='doubao' 真实调用一次
//         doubao-seed-character-260628，验证 AF-248 的端点 / key / 模型接线。
//   边界: 只读 .env，单次短请求，不写库、不启动服务、不打印密钥与长文。
//
//   为什么单独做 CLI 而不进 CI:
//     真实 API 需要有效 key、会计费、可能因额度或网络抖动失败；CI 必须离线可复现。
//     本脚本只在灰度前 / 发版前人工执行一次，作为“生产链路真的通”的证据。

import 'reflect-metadata';

import type { ConfigService } from '@nestjs/config';
import { config as loadEnvFile } from 'dotenv';
import { existsSync } from 'node:fs';

import { LlmService } from '../src/agent/llm/llm.service.js';
import type { LlmMessage } from '../src/agent/llm/llm.types.js';
import { DEFAULT_VISITOR_DOUBAO_MODEL } from '../src/agent/visitor/visitor.runtime.js';

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

async function main(): Promise<void> {
  loadEnvOnce();

  const model = arg('--model') ?? process.env['VISITOR_DOUBAO_MODEL']?.trim() ?? DEFAULT_VISITOR_DOUBAO_MODEL;
  const maxTokens = numberArg('--max-tokens', DEFAULT_MAX_TOKENS);
  const timeoutMs = numberArg('--timeout-ms', DEFAULT_TIMEOUT_MS);

  // 显式检查，避免把真实调用失败伪装成“代码 bug”。
  envRequired('LLM_DOUBAO_API_KEY');

  // LlmService 构造器仍要求 MINIMAX_* 存在（生产本来就配着）；smoke 也如实校验，
  // 不为了跑通而绕过生产前置条件。
  envRequired('MINIMAX_API_KEY');
  envRequired('MINIMAX_BASE_URL');
  envRequired('MINIMAX_LLM_MODEL');

  const config = {
    get: <T>(key: string): T | undefined => process.env[key] as T | undefined,
  } as unknown as ConfigService;
  const llm = new LlmService(config);

  const messages: readonly LlmMessage[] = [
    {
      role: 'system',
      content:
        '你是一名正在做心理咨询的来访者。只输出 1-2 句口语化回应，不要解释、不要旁白、不要列表。' +
        '可以带一个 [emotion:...] 标签，但只在有真实情绪时才带。',
    },
    { role: 'user', content: '咨询师：最近这一周，你睡得怎么样？' },
  ];

  const startedAt = Date.now();
  let text = '';
  let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let finishReason: string | undefined;
  let errorCode: string | undefined;
  let errorMessage: string | undefined;

  for await (const chunk of llm.streamChat(messages, {
    provider: 'doubao',
    model,
    temperature: 0.6,
    maxTokens,
    timeoutMs,
    tenantId: 'af249-smoke',
    userId: 'af249-smoke',
    traceId: `af249-${Date.now()}`,
  })) {
    if (chunk.type === 'content') text += chunk.content;
    if (chunk.type === 'done') {
      usage = chunk.usage;
      finishReason = chunk.finishReason;
    }
    if (chunk.type === 'error') {
      errorCode = chunk.error.code;
      errorMessage = chunk.error.message;
    }
  }

  const elapsedMs = Date.now() - startedAt;

  if (errorCode !== undefined) {
    fail(
      `豆包返回 error chunk code=${errorCode} http=${String(errorMessage ?? '').slice(0, 160)}；` +
        '检查 key / 模型开通 / 端点 / 网络，不要重试刷额度',
      2,
    );
  }
  if (text.trim().length === 0) {
    fail(`豆包返回空正文（finishReason=${finishReason ?? 'unknown'}，usage=${usage.totalTokens}）`, 2);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        provider: 'doubao',
        model,
        elapsedMs,
        chars: text.length,
        finishReason: finishReason ?? null,
        usage,
        preview: truncate(text, 80),
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
