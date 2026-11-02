// V2026-09-04 治本 (V6.0 §3.5 + audit P0-1):
//   Provider Registry 接口 — 能力路由数据源.
//   原因: 多厂商可插拔, runtime 按 (capability, providerId, model)
//         路由到具体实现. 注册表模式跟 moyin-ai-core 一致:
//         Map<ProviderId, ChatProvider> / Map<ProviderId, EmbeddingProvider>.
//   修复: ProviderRegistry 单例服务, 启动期 build, admin 后台修改后
//         invalidate 重建 (热更新).
//   如何验证: LLMRouter.resolveChat(providerId, model) 返回具体 provider,
//             不存在 → 抛 ProviderNotFoundException (BizCode).

import type { ChatProvider, LLMProviderConfig } from './chat-provider.interface';
import type { EmbeddingProvider } from './embedding-provider.interface';
import type { AIProviderId, LLMCapability } from '../enums/llm.enums';

/**
 * Provider Registry — 单例服务接口.
 */
export interface ProviderRegistry {
  /** 注册 chat provider. */
  registerChat(provider: ChatProvider, config: LLMProviderConfig): void;

  /** 注册 embedding provider. */
  registerEmbedding(provider: EmbeddingProvider): void;

  /**
   * 取 chat provider — 按 (id, 可选 model).
   * model 不传则返回该 provider 默认 chat 模型 (后续 router 用).
   */
  resolveChat(id: AIProviderId, model?: string): { provider: ChatProvider; config: LLMProviderConfig } | null;

  /** 取 embedding provider. */
  resolveEmbedding(id: AIProviderId, model?: string): { provider: EmbeddingProvider } | null;

  /** 列出所有已注册的 provider id (按 capability 过滤). */
  listIds(capability?: LLMCapability): AIProviderId[];

  /** 列出所有 provider config (admin 后台用). */
  listConfigs(): LLMProviderConfig[];

  /** 删除 provider — admin 关闭某个厂商. */
  unregister(id: AIProviderId): void;

  /** 热更新 — admin 修改 apiKey / baseUrl 后调用. */
  invalidate(id: AIProviderId): void;
}
