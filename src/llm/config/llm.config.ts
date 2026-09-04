// V2026-09-04 治本 (V6.0 §3.5 + audit P0-1):
//   LLM 启动配置加载器.
//   原因: 多厂商可插拔, 启动期从 env 读默认 provider + apiKey, 注入
//         ProviderRegistry. 后续 admin 后台修改走 DB 配置 + 热更新.
//   修复: 单一函数 registerDefaultProviders(getIt, config) — NestJS
//         模块 onModuleInit 调用, 注册 DeepSeek / Doubao / Qwen 三个
//         国产代表 + 从 env 读 apiKey + 默认 chat/embedding provider.
//   如何验证:
//     1. .env 里 LLM_DEEPSEEK_API_KEY=sk-xxx + LLM_DEFAULT_CHAT_PROVIDER=deepseek
//        启动后 GET /llm/providers 返回 [{ id: 'deepseek', enabled: true, ... }].
//     2. 缺 apiKey 时 provider 仍注册 (isConfigured 走 router 校验),
//        但实际 chat 调用抛 'API key not found'.

import { ConfigService } from '@nestjs/config';

import { AIProviderId, LLMCapability } from '../common/enums/llm.enums';
import type { LLMProviderConfig } from '../common/interfaces/chat-provider.interface';
import { DeepSeekChatProvider, DeepSeekEmbeddingProvider } from '../providers/deepseek.provider';
import { DoubaoChatProvider, DoubaoEmbeddingProvider } from '../providers/doubao.provider';
import { QwenChatProvider, QwenEmbeddingProvider } from '../providers/qwen.provider';
import { ProviderRegistryService } from '../registry/provider-registry.service';

/**
 * 启动期注册所有预设 provider + 从 env 读取 apiKey.
 *
 * 反双胞胎: 不复用 NestJS dynamic module providers, 因为 provider 配置
 * (apiKey / baseUrl / model) 是 runtime 数据, 注册逻辑统一在 config
 * loader 里, 模块只声明 dependency.
 */
export function registerDefaultProviders(registry: ProviderRegistryService, config: ConfigService): void {
  // ─── DeepSeek ───
  if (config.get<string>('LLM_DEEPSEEK_API_KEY')) {
    registry.registerChat(
      new DeepSeekChatProvider(),
      buildEnvConfig(config, AIProviderId.DEEPSEEK, 'DeepSeek', 'https://api.deepseek.com/v1', 'deepseek-chat'),
    );
    registry.registerEmbedding(new DeepSeekEmbeddingProvider());
  }

  // ─── 豆包 (火山方舟) ───
  if (config.get<string>('LLM_DOUBAO_API_KEY')) {
    registry.registerChat(
      new DoubaoChatProvider(),
      buildEnvConfig(config, AIProviderId.DOUBAO, '豆包 (火山方舟)', 'https://ark.cn-beijing.volces.com/api/v3', 'doubao-pro-32k'),
    );
    registry.registerEmbedding(new DoubaoEmbeddingProvider());
  }

  // ─── 通义千问 (DashScope) ───
  if (config.get<string>('LLM_QWEN_API_KEY')) {
    registry.registerChat(
      new QwenChatProvider(),
      buildEnvConfig(config, AIProviderId.QWEN, '通义千问 (DashScope)', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen-plus'),
    );
    registry.registerEmbedding(new QwenEmbeddingProvider());
  }
}

/**
 * 从 env 构造 LLMProviderConfig — 启动期用.
 */
function buildEnvConfig(
  config: ConfigService,
  id: AIProviderId,
  displayName: string,
  baseUrl: string,
  defaultChatModel: string,
): LLMProviderConfig {
  const apiKey = config.get<string>(`LLM_${id.toUpperCase()}_API_KEY`) ?? '';
  return {
    id,
    displayName,
    baseUrl,
    apiKey,
    capabilities: [LLMCapability.CHAT, LLMCapability.EMBEDDING],
    defaultModels: {
      [LLMCapability.CHAT]: defaultChatModel,
    },
    defaultChatModel,
    enabled: !!apiKey,
  };
}
