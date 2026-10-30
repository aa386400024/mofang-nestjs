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
import { resolveProviderApiKeyEnvKey, resolveProviderChatModelFromEnv } from '../config/provider-env';

/**
 * API key 解析回调 — 默认从 ConfigService (env) 读取,
 * 可注入自定义实现从 DB / Vault 读取用户级 key.
 */
export type ResolveApiKeyFn = (providerId: AIProviderId, uid?: string) => Promise<string | null>;

/**
 * 默认 env-based apiKey 解析 — 读该 provider 的 apiKey env 键.
 *
 * V2026-10-28 治本 (MiniMax 接入): 键名**不是**一律 `LLM_<ID>_API_KEY` ——
 *   MiniMax 的订阅 key 是历史命名 `MINIMAX_API_KEY` (与 voice TTS/ASR、旧 agent
 *   流式共用). 键名映射集中在 `config/provider-env.ts`, 与启动注册读同一张表 ——
 *   否则会出现"provider 注册成功了, 一调用就报 API key not found"这种
 *   半注册状态 (排查成本远高于"provider 没注册").
 *
 * @param config 配置服务
 * @returns 解析函数
 */
export function defaultEnvApiKeyResolver(config: ConfigService): ResolveApiKeyFn {
  return async (providerId, _uid) => {
    const envKey = resolveProviderApiKeyEnvKey(providerId);
    return config.get<string>(envKey) ?? null;
  };
}

@Injectable()
export class LlmRouterService {
  private readonly logger = new Logger(LlmRouterService.name);

  private readonly defaultChatProviderId: AIProviderId;
  private readonly defaultEmbeddingProviderId: AIProviderId;
  private readonly apiKeyResolver: ResolveApiKeyFn;
  private readonly config: ConfigService;

  constructor(
    private readonly registry: ProviderRegistryService,
    config: ConfigService,
    @Optional() @Inject('LLM_API_KEY_RESOLVER') customResolver?: ResolveApiKeyFn,
  ) {
    this.config = config;
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
    return TIER_MODELS[tier][id] ?? this.providerModelFallback(id);
  }

  /**
   * 某 provider 的默认模型 (tier 映射缺项时用).
   *
   * V2026-10-28 治本 (MiniMax 接入时暴露的两处回落语义错位):
   *
   * 1. **问的是哪个 provider, 就该回哪个 provider 的模型**. 原实现回落取的是
   *    "默认 chat provider"的模型 —— 问 minimax 拿回 deepseek 的模型名,
   *    上游必然 400, 整轮对练降级成兜底句.
   *
   * 2. **模型名是部署事实, 不是注册状态**. 回落的第一顺位取 env (如
   *    `MINIMAX_LLM_MODEL`), 而不是查注册表 —— 因为 WP8 的渲染配置在 **DI 实例化期**
   *    就被冻结, 而 provider 注册发生在 `onModuleInit`: 那一刻注册表还是空的,
   *    查表只会拿到"默认 provider 的模型"这种更错的值.
   *    换句话说: 冻结配置里的每一项输入, 都必须是**启动期已知的静态事实** (env / 静态表),
   *    不能依赖可变运行时状态. env 优先同时保证了"订阅买了哪个模型就调哪个".
   *
   * 行为变化 (对已注册的厂商是修复, 不是破坏):
   * - 被请求的 provider **有 env 模型名** → 用 env 值 (与是否已注册无关).
   * - 否则 **已注册** → 用它自己的 defaultChatModel.
   * - 否则 → 仍回落到默认 chat provider 的模型, 再兜底常量 (与原行为一致).
   */
  private providerModelFallback(providerId: AIProviderId): string {
    const fromEnv = resolveProviderChatModelFromEnv(providerId, (envKey) => this.config.get<string>(envKey));
    if (fromEnv) return fromEnv;
    const requested = this.registry.resolveChat(providerId);
    if (requested) return requested.provider.defaultChatModel;
    const fallback = this.registry.resolveChat(this.defaultChatProviderId);
    return fallback?.provider.defaultChatModel ?? 'gpt-4o-mini';
  }
}
