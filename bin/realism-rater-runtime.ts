// V2026-11-21 建立 (AF-227 · 真人度评分运行时):
//   职责: 把 provider/model/温度/thinking 组合成评分端点，并执行单次评分员调用。
//   边界: 只做离线评分；不启动服务、不写库；日志不输出台词原文。

import {
  buildRealismRaterCompactPrompt,
  buildRealismRaterPrompt,
  parseRealismRating,
  type RealismBlindPacket,
  type RealismRating,
} from '../src/auto-practice/metrics/visitor-realism-rating.js';
import { AIProviderId } from '../src/llm/common/enums/llm.enums.js';
import type { ChatCompletionResponse, ChatProvider, ChatReasoningEffort } from '../src/llm/common/interfaces/chat-provider.interface.js';
import { resolveProviderApiKeyEnvKey } from '../src/llm/config/provider-env.js';
import { DoubaoChatProvider } from '../src/llm/providers/doubao.provider.js';
import { MinimaxChatProvider } from '../src/llm/providers/minimax.provider.js';

export type RaterProviderName = 'minimax' | 'doubao';
export type RaterThinkingMode = 'auto' | 'disabled' | 'enabled';

export interface RaterSpec {
  readonly provider: RaterProviderName;
  /** 显式模型；缺省取该 provider 的 env/内置默认。 */
  readonly model?: string;
  readonly temperature: number;
  /** 仅豆包支持；缺省 auto（方舟默认思考档）。 */
  readonly thinking?: RaterThinkingMode;
  /** MiniMax 缺省 low；豆包关闭思考时不传，避免与 thinking 冲突。 */
  readonly reasoningEffort?: ChatReasoningEffort;
}

export interface RaterResolvedConfig {
  readonly provider: RaterProviderName;
  readonly providerId: AIProviderId;
  readonly apiKeyEnvKey: string;
  readonly apiKey: string;
  readonly model: string;
  readonly temperature: number;
  readonly baseUrl?: string;
  readonly thinking: RaterThinkingMode;
  readonly reasoningEffort?: ChatReasoningEffort;
  readonly modelKwargs?: Readonly<Record<string, unknown>>;
}

export interface RaterEndpoint extends RaterResolvedConfig {
  readonly providerInstance: ChatProvider;
}

export interface RaterCallResult {
  readonly content: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly reasoningTokens: number;
  readonly finishReason: string;
}

export interface RaterAttemptResult {
  readonly rating: RealismRating;
  readonly calls: readonly RaterCallResult[];
  readonly parseRetries: number;
}

function providerIdFor(name: RaterProviderName): AIProviderId {
  return name === 'minimax' ? AIProviderId.MINIMAX : AIProviderId.DOUBAO;
}

function providerLabel(name: RaterProviderName): string {
  return name === 'minimax' ? 'MiniMax' : 'Doubao';
}

/**
 * 解析评分端点配置（纯函数，供单测直接注入 env 表）。
 */
export function resolveRaterConfig(spec: RaterSpec, env: Readonly<Record<string, string | undefined>>): RaterResolvedConfig {
  const providerId = providerIdFor(spec.provider);
  const apiKeyEnvKey = resolveProviderApiKeyEnvKey(providerId);
  const apiKey = env[apiKeyEnvKey]?.trim() ?? '';
  if (apiKey.length === 0) throw new Error(`缺少 ${apiKeyEnvKey}（不会打印密钥）`);

  const thinking = spec.thinking ?? 'auto';
  if (spec.provider !== 'doubao' && thinking !== 'auto') {
    throw new Error(`thinking=${thinking} 仅支持 doubao，${spec.provider} 不支持`);
  }

  let model: string;
  let baseUrl: string | undefined;
  let modelKwargs: Readonly<Record<string, unknown>> | undefined;

  if (spec.provider === 'minimax') {
    const provider = new MinimaxChatProvider({
      baseUrl: env['MINIMAX_BASE_URL'],
      defaultChatModel: spec.model ?? env['MINIMAX_LLM_MODEL'],
    });
    model = provider.defaultChatModel;
    baseUrl = provider.baseUrl;
  } else {
    const provider = new DoubaoChatProvider({
      defaultChatModel: spec.model ?? env['LLM_DOUBAO_MODEL'],
      ...(thinking === 'auto' ? {} : { modelKwargs: { thinking: { type: thinking } } }),
    });
    model = provider.defaultChatModel;
    baseUrl = provider.baseUrl;
    if (thinking !== 'auto') modelKwargs = { thinking: { type: thinking } };
  }

  return {
    provider: spec.provider,
    providerId,
    apiKeyEnvKey,
    apiKey,
    model,
    temperature: spec.temperature,
    baseUrl,
    thinking,
    // 豆包关闭思考时不再下发 reasoning_effort；MiniMax 保持既有 low 以压首字延迟。
    ...(thinking === 'disabled' ? {} : { reasoningEffort: spec.reasoningEffort ?? 'low' }),
    ...(modelKwargs === undefined ? {} : { modelKwargs }),
  };
}

export function createRaterEndpoint(
  spec: RaterSpec,
  options: { readonly timeoutMs: number; readonly env?: Readonly<Record<string, string | undefined>> },
): RaterEndpoint {
  const env = options.env ?? process.env;
  const resolved = resolveRaterConfig(spec, env);
  const providerInstance =
    resolved.provider === 'minimax'
      ? new MinimaxChatProvider({
          baseUrl: resolved.baseUrl,
          defaultChatModel: resolved.model,
          requestTimeoutMs: options.timeoutMs,
          maxRetries: 1,
        })
      : new DoubaoChatProvider({
          baseUrl: resolved.baseUrl,
          defaultChatModel: resolved.model,
          requestTimeoutMs: options.timeoutMs,
          maxRetries: 1,
          ...(resolved.modelKwargs === undefined ? {} : { modelKwargs: resolved.modelKwargs }),
        });
  return { ...resolved, providerInstance };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callOnce(input: {
  readonly endpoint: RaterEndpoint;
  readonly system: string;
  readonly user: string;
  readonly temperature: number;
  readonly timeoutMs: number;
  readonly maxOutputTokens: number;
}): Promise<RaterCallResult> {
  const response: ChatCompletionResponse = await input.endpoint.providerInstance.chat(
    {
      model: input.endpoint.model,
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ],
      temperature: input.temperature,
      maxCompletionTokens: input.maxOutputTokens,
      ...(input.endpoint.reasoningEffort === undefined ? {} : { reasoningEffort: input.endpoint.reasoningEffort }),
    },
    input.endpoint.apiKey,
    AbortSignal.timeout(input.timeoutMs),
  );
  const content = response.content;
  const tags = [...content.matchAll(/<([a-zA-Z\u4E00-\u9FA5][a-zA-Z0-9_:.\u4E00-\u9FA5-]{0,20})>/g)].map((match) => match[1]).slice(0, 6);
  console.log(
    `[CALL] provider=${providerLabel(input.endpoint.provider)} model=${input.endpoint.model} finish=${response.finishReason} chars=${content.length} promptTokens=${response.usage.promptTokens} completionTokens=${response.usage.completionTokens} reasoningTokens=${response.usage.reasoningTokens ?? 0} tags=${JSON.stringify(tags)}`,
  );
  return {
    content,
    promptTokens: response.usage.promptTokens,
    completionTokens: response.usage.completionTokens,
    reasoningTokens: response.usage.reasoningTokens ?? 0,
    finishReason: response.finishReason,
  };
}

async function callWithRetry(input: Parameters<typeof callOnce>[0], attempts = 2): Promise<RaterCallResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await callOnce(input);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(4000);
    }
  }
  throw lastError;
}

/**
 * 单评分员评一个 packet：主协议失败后切 compact 行协议重试。
 *
 * 与 R6-B 的截断恢复口径一致；这里的 provider/model 可独立替换。
 */
export async function ratePacketWithRater(input: {
  readonly endpoint: RaterEndpoint;
  readonly packet: RealismBlindPacket;
  readonly raterId: 'R1' | 'R2';
  readonly timeoutMs: number;
  readonly maxParseRetries: number;
  readonly maxOutputTokens: number;
}): Promise<RaterAttemptResult> {
  const prompt = buildRealismRaterPrompt(input.packet, input.raterId);
  const calls: RaterCallResult[] = [];
  let lastError = '';
  for (let attempt = 0; attempt <= input.maxParseRetries; attempt += 1) {
    const activePrompt = attempt === 0 ? prompt : buildRealismRaterCompactPrompt(input.packet, input.raterId, lastError);
    if (attempt > 0) {
      console.warn(`[PROTOCOL] ${input.packet.packetId} ${input.raterId} 第 ${attempt + 1} 次切 compact 行协议，原因=${lastError}`);
    }
    const retrySuffix =
      attempt === 0
        ? ''
        : '\n\n上一次输出不可用。现在直接从 naturalness= 开始按行输出，五维齐全，不要思考、不要解释、不要 JSON、不要 markdown。';
    const result = await callWithRetry({
      endpoint: input.endpoint,
      system: activePrompt.system,
      user: `${activePrompt.user}${retrySuffix}`,
      temperature: attempt === 0 ? input.endpoint.temperature : 0.2,
      timeoutMs: input.timeoutMs,
      maxOutputTokens: input.maxOutputTokens,
    });
    calls.push(result);
    const parsed = parseRealismRating(result.content, input.packet);
    if (!parsed.ok && attempt === 0) {
      const trimmed = result.content.trim();
      console.warn(
        `[SHAPE] ${input.packet.packetId} len=${trimmed.length} start=${JSON.stringify(trimmed.slice(0, 1))} end=${JSON.stringify(trimmed.slice(-1))} think=${trimmed.includes('<think>')} dimLines=${(trimmed.match(/^(naturalness|emotional_continuity|turn_shape|scene_congruence|relational_presence)\s*=/gm) ?? []).length}`,
      );
    }
    if (parsed.ok) return { rating: parsed.rating, calls, parseRetries: attempt };
    lastError = result.finishReason === 'length' ? `truncated:${parsed.error}` : parsed.error;
    console.warn(`[WARN] ${input.packet.packetId} ${input.raterId} 解析失败：${lastError}（第 ${attempt + 1} 次）`);
  }
  throw new Error(`${input.raterId}_parse_failed:${lastError}`);
}
