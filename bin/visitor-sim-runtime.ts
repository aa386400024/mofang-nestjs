// V2026-11-22 建立 (AF-232 · 来访者模拟器影子运行时):
//   职责: 流式调用 MiniMax / 豆包，生成固定脚本下的来访者会话，并记录首 token 延迟.
//   边界: 只读 persona 模板 + 只写指定输出目录；不启动服务、不写库、不输出台词原文.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SimDifficulty, SimProvider, SimSessionRecord, SimTurnRecord, SimPromptVariant } from './visitor-sim-analysis.js';
import { projectVisitorSpeech } from './visitor-sim-analysis.js';
import { buildVisitorPrompt } from './visitor-sim-prompts.js';
import type { PersonaDifficulty } from '../src/agent/persona/domain/entities/persona.entity.js';
import type { VisitorPoolTemplateSeed } from '../src/counselor/config/visitor-pool-seed.js';

export interface ShadowArm {
  readonly key: string;
  readonly label: string;
  readonly provider: SimProvider;
  readonly model: string;
  readonly promptVariant: SimPromptVariant;
}

/** 四臂：A baseline；B 只换模型；C 换模型+专用 prompt；D 只换 prompt. */
export const SHADOW_ARMS: readonly ShadowArm[] = [
  { key: 'A', label: 'MiniMax-M3/shared', provider: 'minimax', model: 'MiniMax-M3', promptVariant: 'shared' },
  { key: 'B', label: 'Seed-Character/shared', provider: 'doubao', model: 'doubao-seed-character-260628', promptVariant: 'shared' },
  { key: 'C', label: 'Seed-Character/seed-v1', provider: 'doubao', model: 'doubao-seed-character-260628', promptVariant: 'seed-v1' },
  { key: 'D', label: 'MiniMax-M3/seed-v1', provider: 'minimax', model: 'MiniMax-M3', promptVariant: 'seed-v1' },
  { key: 'E', label: 'Seed-Character/seed-v2', provider: 'doubao', model: 'doubao-seed-character-260628', promptVariant: 'seed-v2' },
  { key: 'F', label: 'Seed-Character/seed-v3', provider: 'doubao', model: 'doubao-seed-character-260628', promptVariant: 'seed-v3' },
  { key: 'G', label: 'Seed-Character/seed-v4', provider: 'doubao', model: 'doubao-seed-character-260628', promptVariant: 'seed-v4' },
];

export interface StreamChatInput {
  readonly provider: SimProvider;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly messages: readonly { readonly role: 'system' | 'user' | 'assistant'; readonly content: string }[];
  readonly temperature: number;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
  readonly thinking?: 'auto' | 'disabled' | 'enabled';
}

export interface StreamChatResult {
  readonly content: string;
  readonly firstTokenMs: number;
  readonly totalMs: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly reasoningTokens: number;
  readonly finishReason: string;
}

function chatEndpoint(input: Pick<StreamChatInput, 'provider' | 'baseUrl'>): string {
  let trimmed = input.baseUrl;
  while (trimmed.endsWith('/')) trimmed = trimmed.slice(0, -1);
  return input.provider === 'doubao' ? `${trimmed}/chat/completions` : `${trimmed}/v1/chat/completions`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ParsedChoice {
  readonly delta?: { readonly content?: string };
  readonly finish_reason?: string | null;
}

interface ParsedChunk {
  readonly choices?: readonly ParsedChoice[];
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
    readonly completion_tokens_details?: { readonly reasoning_tokens?: number };
  } | null;
}

function parseSseLine(
  line: string,
  result: {
    content: string;
    firstTokenMs: number;
    promptTokens: number;
    completionTokens: number;
    reasoningTokens: number;
    finishReason: string;
  },
  startedAt: number,
): void {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return;
  const payload = trimmed.slice(5).trim();
  if (payload === '[DONE]' || payload.length === 0) return;
  let chunk: ParsedChunk;
  try {
    chunk = JSON.parse(payload) as ParsedChunk;
  } catch {
    return;
  }
  const choice = chunk.choices?.[0];
  const delta = choice?.delta?.content;
  if (typeof delta === 'string' && delta.length > 0) {
    if (result.firstTokenMs === 0) result.firstTokenMs = Math.round(performance.now() - startedAt);
    result.content += delta;
  }
  if (typeof choice?.finish_reason === 'string') result.finishReason = choice.finish_reason;
  if (chunk.usage !== undefined && chunk.usage !== null) {
    result.promptTokens = chunk.usage.prompt_tokens ?? result.promptTokens;
    result.completionTokens = chunk.usage.completion_tokens ?? result.completionTokens;
    result.reasoningTokens = chunk.usage.completion_tokens_details?.reasoning_tokens ?? result.reasoningTokens;
  }
}

/** 流式 chat，记录首 token 延迟与 usage；MiniMax 遇到 429 时按分钟级退避. */
// eslint-disable-next-line sonarjs/cognitive-complexity -- 流式读取、usage 解析、重试与首 token 计时必须共享同一请求上下文，拆分会把重试状态打散
export async function streamChat(input: StreamChatInput, attempts = input.provider === 'minimax' ? 4 : 2): Promise<StreamChatResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const startedAt = performance.now();
    try {
      const body: Record<string, unknown> = {
        model: input.model,
        messages: input.messages,
        temperature: input.temperature,
        max_tokens: input.maxOutputTokens,
        stream: true,
      };
      if (input.provider === 'doubao' && input.thinking !== undefined && input.thinking !== 'auto') {
        body['thinking'] = { type: input.thinking };
      }
      if (input.provider === 'doubao' || input.provider === 'minimax') {
        body['stream_options'] = { include_usage: true };
      }
      const response = await fetch(chatEndpoint(input), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(input.timeoutMs),
      });
      if (!response.ok) {
        const errorText = await response.text().catch(() => '<no body>');
        throw new Error(`http_${response.status}:${errorText.slice(0, 300)}`);
      }
      if (response.body === null) throw new Error('no_body');

      const result = {
        content: '',
        firstTokenMs: 0,
        promptTokens: 0,
        completionTokens: 0,
        reasoningTokens: 0,
        finishReason: '',
      };
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) parseSseLine(line, result, startedAt);
      }
      if (buffer.length > 0) parseSseLine(buffer, result, startedAt);
      if (result.content.trim().length === 0) throw new Error('empty_content');
      return {
        ...result,
        totalMs: Math.round(performance.now() - startedAt),
        firstTokenMs: result.firstTokenMs === 0 ? Math.round(performance.now() - startedAt) : result.firstTokenMs,
      };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        const message = error instanceof Error ? error.message : String(error);
        const waitMs = message.includes('http_429') ? 60_000 : 2500;
        console.warn(
          `[RETRY] ${input.provider}/${input.model} 第 ${attempt}/${attempts} 次失败，${waitMs}ms 后重试：${message.slice(0, 160)}`,
        );
        await sleep(waitMs);
      }
    }
  }
  throw lastError;
}

function sceneForDifficulty(difficulty: SimDifficulty): SimSessionRecord['scene'] {
  if (difficulty === 'L1') return 'in_person';
  if (difficulty === 'L2') return 'online_voice';
  return 'online_text';
}

function asPersonaDifficulty(difficulty: SimDifficulty): PersonaDifficulty {
  return difficulty;
}

export interface GeneratedSession extends SimSessionRecord {
  readonly ageRange: string;
  readonly messages: readonly { readonly role: 'counselor' | 'visitor'; readonly text: string; readonly turnIndex: number }[];
}

/** 生成一场固定脚本会话；每轮只把当前咨询师话术追加到历史后调用来访者模型. */
export async function generateSession(input: {
  readonly arm: ShadowArm;
  readonly seed: VisitorPoolTemplateSeed;
  readonly difficulty: SimDifficulty;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly temperature: number;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
  readonly thinking?: 'auto' | 'disabled' | 'enabled';
  readonly script: readonly string[];
}): Promise<GeneratedSession> {
  const system = buildVisitorPrompt(input.seed, asPersonaDifficulty(input.difficulty), input.arm.promptVariant);
  const history: { role: 'system' | 'user' | 'assistant'; content: string }[] = [{ role: 'system', content: system }];
  const turns: SimTurnRecord[] = [];
  const messages: GeneratedSession['messages'][number][] = [];
  for (let index = 0; index < input.script.length; index += 1) {
    const counselor = input.script[index] ?? '';
    messages.push({ role: 'counselor', text: counselor, turnIndex: index + 1 });
    history.push({ role: 'user', content: counselor });
    // MiniMax Token Plan 按分钟限流；串行生成时用 3.5s 间隔压到 20 RPM 以下。
    if (input.arm.provider === 'minimax' && index > 0) await sleep(3500);
    const result = await streamChat({
      provider: input.arm.provider,
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      model: input.arm.model,
      messages: history,
      temperature: input.temperature,
      maxOutputTokens: input.maxOutputTokens,
      timeoutMs: input.timeoutMs,
      ...(input.thinking === undefined ? {} : { thinking: input.thinking }),
    });
    const visitorRaw = result.content.replaceAll(/<think>[\s\S]*?<\/think>/giu, '').trim();
    if (visitorRaw.length === 0) throw new Error(`empty_visitor_turn:${input.arm.key}:${input.seed.id}:${input.difficulty}:${index + 1}`);
    const visitor = projectVisitorSpeech(visitorRaw);
    messages.push({ role: 'visitor', text: visitor, turnIndex: index + 1 });
    history.push({ role: 'assistant', content: visitor });
    turns.push({
      turnIndex: index + 1,
      counselor,
      visitor,
      visitorRaw,
      firstTokenMs: result.firstTokenMs,
      totalMs: result.totalMs,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      reasoningTokens: result.reasoningTokens,
      finishReason: result.finishReason,
    });
    console.log(
      `[TURN] arm=${input.arm.key} persona=${input.seed.id} difficulty=${input.difficulty} turn=${index + 1}/${input.script.length} chars=${visitor.length} rawChars=${visitorRaw.length} first=${result.firstTokenMs}ms total=${result.totalMs}ms finish=${result.finishReason}`,
    );
  }
  const sessionId = `af232_${input.arm.key}_${input.seed.id}_${input.difficulty}`;
  return {
    sessionId,
    arm: input.arm.key,
    provider: input.arm.provider,
    model: input.arm.model,
    promptVariant: input.arm.promptVariant,
    personaId: input.seed.id,
    personaLabel: input.seed.codename,
    difficulty: input.difficulty,
    scene: sceneForDifficulty(input.difficulty),
    ageRange: input.seed.ageRange,
    turns,
    messages,
  };
}

/** 写 debug-session 兼容 JSON（保留 meta 供分析，盲评包会剥离身份）. */
export function writeGeneratedSession(outDir: string, session: GeneratedSession): string {
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `${session.sessionId}.json`);
  const payload = {
    id: session.sessionId,
    characterSlug: session.personaId,
    characterLabel: session.personaLabel,
    scenarioType: session.scene,
    scene: session.scene,
    messages: session.messages,
    turns: session.turns,
    meta: {
      arm: session.arm,
      provider: session.provider,
      model: session.model,
      promptVariant: session.promptVariant,
      difficulty: session.difficulty,
      ageRange: session.ageRange,
    },
  };
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return file;
}
