// V2026-09-04 治本 (V6.0 §3.5):
//   Custom Provider — 用户自定义 baseUrl + apiKey, 接入任何 OpenAI 兼容厂商.
//   原因: 用户场景千变万化, 预设的几个国产厂商不可能覆盖所有 (企业内部
//         LLM 网关 / 私有部署 / 任何 OpenAI 兼容协议厂商).
//   修复: 用户在 admin 后台填 (providerId='custom', displayName, baseUrl,
//         apiKey, defaultModel), LLMConfigLoader 动态构造 CustomChatProvider
//         / CustomEmbeddingProvider 实例注入 ProviderRegistry.
//   如何验证:
//     1. admin 后台 POST /llm/providers { id: 'custom', baseUrl: 'http://10.0.0.1:8080/v1',
//        apiKey: 'sk-xxx', defaultChatModel: 'qwen2.5-72b' } 注册成功.
//     2. POST /v1/chat/completions { provider: 'custom' } 流式响应正常.
//     3. 删除时 ProviderRegistry.unregister('custom') 后路由降级到默认 provider.

import { OpenAICompatibleChatProvider, type OpenAICompatibleConfig } from '../common/base/openai-compatible-chat.provider';
import {
  OpenAICompatibleEmbeddingProvider,
  type OpenAICompatibleEmbeddingConfig,
} from '../common/base/openai-compatible-embedding.provider';
import { AIProviderId } from '../common/enums/llm.enums';

/**
 * Custom Chat Provider — 工厂函数, 每次构造传入用户配置.
 *
 * 不导出 class, 导出工厂函数, 避免每加一个厂商都新建文件.
 * 命名仍叫 "provider" 因为它继承 OpenAICompatibleChatProvider 实现
 * ChatProvider 接口.
 */
export function createCustomChatProvider(cfg: OpenAICompatibleConfig & { name?: string }): OpenAICompatibleChatProvider {
  return new (class extends OpenAICompatibleChatProvider {
    constructor() {
      super({
        ...cfg,
        id: AIProviderId.CUSTOM,
        name: cfg.name ?? 'Custom (User Configured)',
      });
    }
  })();
}

/**
 * Custom Embedding Provider — 同上, 工厂函数.
 */
export function createCustomEmbeddingProvider(cfg: OpenAICompatibleEmbeddingConfig & { name?: string }): OpenAICompatibleEmbeddingProvider {
  return new (class extends OpenAICompatibleEmbeddingProvider {
    constructor() {
      super({
        ...cfg,
        id: AIProviderId.CUSTOM,
        name: cfg.name ?? 'Custom (User Configured)',
      });
    }
  })();
}
