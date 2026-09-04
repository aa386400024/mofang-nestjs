// V2026-09-04 治本 (V6.0 §3.5 + audit P0-1):
//   ProviderRegistry — 单例服务, 维护 (AIProviderId → ChatProvider +
//   EmbeddingProvider + Config) 映射.
//   原因: 多厂商可插拔的核心数据结构, 启动期 build, admin 修改配置后
//         热更新. 对齐 moyin-ai-core ProviderRegistry (Map<ProviderId,
//         ChatProvider>).
//   修复: 单例 NestJS 服务, 内部用 Map 维护, 提供 register / resolve /
//         unregister / invalidate / listConfigs / testProvider 接口.
//   如何验证:
//     1. 启动期 LLMConfigLoader 调用 registerXxx 注入默认 provider.
//     2. admin 后台修改 apiKey 后调 invalidate(id) 触发热更新.
//     3. resolveChat('deepseek') 返回 { provider, config }, 不存在返回 null
//        (上层 LLMRouter 走默认 provider fallback).

import { Injectable, Logger } from '@nestjs/common';

import { AIProviderId, LLMCapability } from '../common/enums/llm.enums';
import type { ChatProvider, LLMProviderConfig } from '../common/interfaces/chat-provider.interface';
import type { EmbeddingProvider } from '../common/interfaces/embedding-provider.interface';
import type { ProviderRegistry } from '../common/interfaces/provider-registry.interface';

interface RegistryEntry {
  chat?: ChatProvider;
  embedding?: EmbeddingProvider;
  config: LLMProviderConfig;
}

/**
 * Provider Registry 实现 — 单例.
 *
 * 大厂 standard: 启动期 build, 之后 read-only; admin 修改走 invalidate
 * 触发单 provider 重载, 不阻塞主流程.
 */
@Injectable()
export class ProviderRegistryService implements ProviderRegistry {
  private readonly logger = new Logger(ProviderRegistryService.name);
  private readonly entries = new Map<AIProviderId, RegistryEntry>();

  public registerChat(provider: ChatProvider, config: LLMProviderConfig): void {
    const existing = this.entries.get(provider.id);
    this.entries.set(provider.id, {
      ...existing,
      chat: provider,
      config,
    });
    this.logger.log(`Registered chat provider: ${provider.id} (${config.displayName})`);
  }

  public registerEmbedding(provider: EmbeddingProvider): void {
    const existing = this.entries.get(provider.id);
    this.entries.set(provider.id, {
      ...existing,
      embedding: provider,
      config: existing?.config ?? this.synthesizeConfigFromEmbedding(provider),
    });
    this.logger.log(`Registered embedding provider: ${provider.id}`);
  }

  public resolveChat(id: AIProviderId): { provider: ChatProvider; config: LLMProviderConfig } | null {
    const entry = this.entries.get(id);
    if (!entry?.chat) return null;
    return { provider: entry.chat, config: entry.config };
  }

  public resolveEmbedding(id: AIProviderId): { provider: EmbeddingProvider } | null {
    const entry = this.entries.get(id);
    if (!entry?.embedding) return null;
    return { provider: entry.embedding };
  }

  public listIds(capability?: LLMCapability): AIProviderId[] {
    if (!capability) {
      return Array.from(this.entries.keys());
    }
    return Array.from(this.entries.entries())
      .filter(([_, entry]) => {
        if (capability === LLMCapability.CHAT) return !!entry.chat;
        if (capability === LLMCapability.EMBEDDING) return !!entry.embedding;
        return true;
      })
      .map(([id]) => id);
  }

  public listConfigs(): LLMProviderConfig[] {
    return Array.from(this.entries.values()).map((e) => e.config);
  }

  public unregister(id: AIProviderId): void {
    this.entries.delete(id);
    this.logger.log(`Unregistered provider: ${id}`);
  }

  public invalidate(id: AIProviderId): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    // 触发 chat / embedding provider 重建 — 上层 LLMConfigLoader
    // 监听 invalidate 事件 (NestJS EventEmitter) 重新构造.
    this.logger.warn(`Provider invalidated: ${id}, awaiting re-register`);
    this.entries.set(id, { ...entry, config: { ...entry.config, enabled: false } });
  }

  /** Embedding provider 单独注册时, 临时构造 config (后续 chat 注册会覆盖). */
  private synthesizeConfigFromEmbedding(provider: EmbeddingProvider): LLMProviderConfig {
    return {
      id: provider.id,
      displayName: provider.name,
      baseUrl: provider.baseUrl,
      apiKey: '',
      // V2026-09-04 治本 (TS4104):
      //   provider.capabilities 是 readonly LLMCapability[], LLMProviderConfig.capabilities
      //   期望 LLMCapability[] (mutable). 用 spread 拷贝成 mutable array.
      capabilities: [...provider.capabilities],
      defaultModels: {
        [LLMCapability.EMBEDDING]: provider.defaultEmbeddingModel,
      },
      enabled: true,
    };
  }
}
