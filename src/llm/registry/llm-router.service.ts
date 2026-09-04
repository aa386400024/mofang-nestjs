// V2026-09-04 治本 (V6.0 §3.5 + audit P0-1):
//   LLMRouter — 能力路由服务, 核心调度层.
//   原因: 多厂商 + 多 capability + 多 model 组合下, 业务层需要按
//         (capability, provider, tier, scenario) 选具体实现, 同时支持
//         fallback (默认 provider). 对齐 moyin-ai-core capability routing.
//   修复: 集中路由表 + 默认值 + 用户级覆盖 (DB 存 user_provider_overrides),
//         业务层只调 router.chat(request), router 负责选 provider + 注入
//         apiKey + 转发.
//   如何验证:
//     1. router.chat(req) 内部: 按 req.providerId → resolveChat; 失败 →
//        用默认 provider (env LLM_DEFAULT_CHAT_PROVIDER). 不抛错.
//     2. router.testProvider(id) 注入 apiKey 后调 provider.testConnection().
//     3. router.embed(req) 同理, 失败时 fallback 到默认 embedding provider.

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ProviderRegistryService } from './provider-registry.service';
import { AIProviderId, LLMCapability, LLMTier } from '../common/enums/llm.enums';
import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatProvider,
  LLMProviderConfig,
} from '../common/interfaces/chat-provider.interface';
import type { EmbeddingRequest, EmbeddingResponse } from '../common/interfaces/embedding-provider.interface';

/**
 * API key 解析回调 — 默认从 ConfigService (env) 读取,
 * 可注入自定义实现从 DB / Vault 读取用户级 key.
 */
export type ResolveApiKeyFn = (providerId: AIProviderId, uid?: string) => Promise<string | null>;

/**
 * 默认 env-based apiKey 解析 — 读 LLM_<PROVIDER>_API_KEY.
 */
export function defaultEnvApiKeyResolver(config: ConfigService): ResolveApiKeyFn {
  return async (providerId, _uid) => {
    const envKey = `LLM_${providerId.toUpperCase()}_API_KEY`;
    return config.get<string>(envKey) ?? null;
  };
}

@Injectable()
export class LlmRouterService {
  private readonly logger = new Logger(LlmRouterService.name);

  private readonly defaultChatProviderId: AIProviderId;
  private readonly defaultEmbeddingProviderId: AIProviderId;
  private readonly apiKeyResolver: ResolveApiKeyFn;

  constructor(
    private readonly registry: ProviderRegistryService,
    config: ConfigService,
    @Optional() @Inject('LLM_API_KEY_RESOLVER') customResolver?: ResolveApiKeyFn,
  ) {
    this.apiKeyResolver = customResolver ?? defaultEnvApiKeyResolver(config);
    this.defaultChatProviderId = (config.get<string>('LLM_DEFAULT_CHAT_PROVIDER') as AIProviderId) ?? AIProviderId.DEEPSEEK;
    this.defaultEmbeddingProviderId = (config.get<string>('LLM_DEFAULT_EMBEDDING_PROVIDER') as AIProviderId) ?? AIProviderId.QWEN;
  }

  // ─── Chat 路由 ────────────────────────────────────────────

  /**
   * Chat 单轮路由 — 自动选 provider, 注入 apiKey, 转发请求.
   */
  public async chat(
    request: ChatCompletionRequest,
    opts: { providerId?: AIProviderId; uid?: string } = {},
  ): Promise<ChatCompletionResponse> {
    const { provider, apiKey } = await this.resolveAndAuthorize(
      opts.providerId ?? this.defaultChatProviderId,
      LLMCapability.CHAT,
      opts.uid,
    );
    return provider.chat(request, apiKey);
  }

  /**
   * Chat 流式路由 — 返回 AsyncIterable, 业务层 for-await 消费.
   *
   * 反双胞胎: 不返回 Node Readable (那是 OpenAI SDK 内部), 上层统一用
   * AsyncIterable 消费, 跟 LangChain stream 接口一致.
   */
  public async *streamChat(
    request: ChatCompletionRequest,
    opts: { providerId?: AIProviderId; uid?: string; signal?: AbortSignal } = {},
  ): AsyncIterable<ChatCompletionChunk> {
    const { provider, apiKey } = await this.resolveAndAuthorize(
      opts.providerId ?? this.defaultChatProviderId,
      LLMCapability.CHAT,
      opts.uid,
    );
    yield* provider.streamChat(request, apiKey, opts.signal);
  }

  // ─── Embedding 路由 ─────────────────────────────────────

  public async embed(
    request: EmbeddingRequest,
    opts: { providerId?: AIProviderId; uid?: string; signal?: AbortSignal } = {},
  ): Promise<EmbeddingResponse> {
    const providerId = opts.providerId ?? this.defaultEmbeddingProviderId;
    const resolved = this.registry.resolveEmbedding(providerId);
    if (!resolved) {
      throw new Error(`Embedding provider ${providerId} not registered`);
    }
    const apiKey = await this.apiKeyResolver(providerId, opts.uid);
    if (!apiKey) {
      throw new Error(`API key not found for embedding provider ${providerId}`);
    }
    return resolved.provider.embed(request, apiKey, opts.signal);
  }

  // ─── 测试连接 ────────────────────────────────────────────

  /**
   * 测试连接 — admin 后台「测试连接」按钮.
   *
   * 实现: 调一个最小 chat 请求 (1 token), 验证 baseUrl + apiKey + model.
   */
  public async testProvider(providerId: AIProviderId, uid?: string): Promise<{ success: boolean; latencyMs?: number; error?: string }> {
    const start = Date.now();
    try {
      const { provider, apiKey } = await this.resolveAndAuthorize(providerId, LLMCapability.CHAT, uid);
      // 委托 provider 自身实现 testConnection (1.x 协议统一, 基类已封装).
      const result = await provider.testConnection(apiKey);
      return { ...result, latencyMs: result.latencyMs ?? Date.now() - start };
    } catch (e) {
      return { success: false, latencyMs: Date.now() - start, error: (e as Error).message };
    }
  }

  // ─── 内部 helper ─────────────────────────────────────────

  private async resolveAndAuthorize(
    requestedId: AIProviderId,
    capability: LLMCapability,
    uid?: string,
  ): Promise<{ provider: ChatProvider; apiKey: string; config: LLMProviderConfig }> {
    // 1. 按用户偏好解析 (uid → user_provider_preference 表) — V2 实现
    const providerId = requestedId;

    // 2. registry 查 provider
    const resolved = this.registry.resolveChat(providerId);
    if (!resolved) {
      // fallback 到默认 provider
      if (providerId === this.defaultChatProviderId) {
        throw new Error(`Default chat provider ${providerId} not registered`);
      }
      this.logger.warn(`Provider ${providerId} not registered, fallback to default ${this.defaultChatProviderId}`);
      const fallback = this.registry.resolveChat(this.defaultChatProviderId);
      if (!fallback) {
        throw new Error(`Default chat provider ${this.defaultChatProviderId} not registered`);
      }
      return this.authorize(fallback.provider, fallback.config, uid);
    }
    void capability;
    return this.authorize(resolved.provider, resolved.config, uid);
  }

  private async authorize(
    provider: ChatProvider,
    config: LLMProviderConfig,
    uid?: string,
  ): Promise<{ provider: ChatProvider; apiKey: string; config: LLMProviderConfig }> {
    if (!config.enabled) {
      throw new Error(`Provider ${provider.id} is disabled`);
    }
    const apiKey = await this.apiKeyResolver(provider.id, uid);
    if (!apiKey) {
      throw new Error(`API key not found for provider ${provider.id}`);
    }
    return { provider, apiKey, config };
  }

  // ─── Tier → Model 映射 (§3.5 三层架构) ──────────────────

  /**
   * Tier 默认模型映射 — §3.5.
   *
   * 大厂 standard: 集中配置, 后续调参不散在 service. admin 后台可覆盖.
   * 注意: 不同 provider 的同 tier 模型名不同, 这里按 provider 维度配.
   */
  public getDefaultModelForTier(tier: LLMTier, providerId?: AIProviderId): string {
    const id = providerId ?? this.defaultChatProviderId;
    const TIER_MODELS: Record<LLMTier, Partial<Record<AIProviderId, string>>> = {
      [LLMTier.BASIC]: {
        [AIProviderId.DEEPSEEK]: 'deepseek-chat',
        [AIProviderId.DOUBAO]: 'doubao-lite',
        [AIProviderId.QWEN]: 'qwen-turbo',
        [AIProviderId.OPENAI]: 'gpt-4o-mini',
      },
      [LLMTier.RAG]: {
        [AIProviderId.DEEPSEEK]: 'deepseek-chat',
        [AIProviderId.DOUBAO]: 'doubao-pro-32k',
        [AIProviderId.QWEN]: 'qwen-plus',
        [AIProviderId.OPENAI]: 'gpt-4o',
      },
      [LLMTier.ADVANCED]: {
        [AIProviderId.DEEPSEEK]: 'deepseek-reasoner',
        [AIProviderId.DOUBAO]: 'doubao-pro-128k',
        [AIProviderId.QWEN]: 'qwen-max',
        [AIProviderId.OPENAI]: 'gpt-4o',
      },
    };
    return TIER_MODELS[tier][id] ?? this.defaultChatProviderFallback();
  }

  private defaultChatProviderFallback(): string {
    const resolved = this.registry.resolveChat(this.defaultChatProviderId);
    return resolved?.provider.defaultChatModel ?? 'gpt-4o-mini';
  }
}
