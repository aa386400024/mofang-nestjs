// V2026-09-04 治本 (V6.0 §3.5 + audit P0-1):
//   LLM 启动配置加载器.
//   原因: 多厂商可插拔, 启动期从 env 读默认 provider + apiKey, 注入
//         ProviderRegistry. 后续 admin 后台修改走 DB 配置 + 热更新.
//   修复: 单一函数 registerDefaultProviders(getIt, config) — NestJS
//         模块 onModuleInit 调用, 注册 Doubao / Qwen 两个国产代表
//         + MiniMax + 从 env 读 apiKey + 默认 chat/embedding provider.
//   如何验证:
//     1. .env 里 LLM_QWEN_API_KEY=sk-xxx + LLM_DEFAULT_CHAT_PROVIDER=qwen
//        启动后 GET /llm/providers 返回 [{ id: 'qwen', enabled: true, ... }].
//     2. 缺 apiKey 时 provider 仍注册 (isConfigured 走 router 校验),
//        但实际 chat 调用抛 'API key not found'.

import { ConfigService } from '@nestjs/config';

import { normalizeOpenAiCompatibleBaseUrl } from './provider-env.js';
import type { OpenAICompatibleChatOptions } from '../common/base/openai-compatible-chat.provider.js';
import { AIProviderId, LLMCapability } from '../common/enums/llm.enums.js';
import type { LLMProviderConfig } from '../common/interfaces/chat-provider.interface.js';
import { createCustomEmbeddingProvider } from '../providers/custom.provider.js';
import { DoubaoChatProvider, DoubaoEmbeddingProvider } from '../providers/doubao.provider.js';
import { MinimaxChatProvider } from '../providers/minimax.provider.js';
import { QwenChatProvider, QwenEmbeddingProvider } from '../providers/qwen.provider.js';
import { ProviderRegistryService } from '../registry/provider-registry.service.js';

/**
 * 启动期注册所有预设 provider + 从 env 读取 apiKey.
 *
 * 反双胞胎: 不复用 NestJS dynamic module providers, 因为 provider 配置
 * (apiKey / baseUrl / model) 是 runtime 数据, 注册逻辑统一在 config
 * loader 里, 模块只声明 dependency.
 */
export function registerDefaultProviders(registry: ProviderRegistryService, config: ConfigService): void {
  // V2026-11-09 治本 (Phase2.5 WP-H · 改动 3): 客户端超时与显式重试次数是
  //   **部署事实**, 四家厂商共用同一套 env 口径 —— 各家 provider 各写一遍就是两份真相.
  const runtime = readRuntimeOptions(config);

  // ─── 豆包 (火山方舟) ───
  if (config.get<string>('LLM_DOUBAO_API_KEY')) {
    const doubao = new DoubaoChatProvider({
      ...runtime,
      // AF-227: 模型随方舟版本迭代（旧别名会 404），由 LLM_DOUBAO_MODEL 单一来源解析；
      //   provider 的兜底模型与启动注册的 defaultChatModel 必须同源。
      defaultChatModel: config.get<string>('LLM_DOUBAO_MODEL'),
    });
    registry.registerChat(doubao, buildEnvConfig(config, AIProviderId.DOUBAO, '豆包 (火山方舟)', doubao.baseUrl, doubao.defaultChatModel));
    registry.registerEmbedding(new DoubaoEmbeddingProvider());
  }

  // ─── 通义千问 (DashScope) ───
  if (config.get<string>('LLM_QWEN_API_KEY')) {
    registry.registerChat(
      new QwenChatProvider(runtime),
      buildEnvConfig(config, AIProviderId.QWEN, '通义千问 (DashScope)', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen-plus'),
    );
    registry.registerEmbedding(new QwenEmbeddingProvider());
  }

  // ─── MiniMax ───
  // V2026-10-28 治本 (MiniMax chat provider 接入):
  //   与其它三家"有 key 才注册"同一口径, 但**取键与建模走自己的路径**:
  //   1. apiKey 读 `MINIMAX_API_KEY` —— 这是该订阅的历史命名 (被 voice TTS/ASR、
  //      旧 agent 流式、counselor 分析共用), 与 `LLM_<ID>_API_KEY` 规律不同;
  //      刻意不改名 (改名会断掉已跑通的语音链路, 且同一把 key 两处维护迟早漏).
  //      运行时解析 (LlmRouterService.authorize) 走同一张映射表, 见 provider-env.ts.
  //   2. baseUrl / 默认模型从 env 来 (订阅买的是哪个模型就调哪个), 归一口径见
  //      provider-env.ts; provider 实例本身就是唯一真相, 注册配置直接取它的值.
  //   3. 只注册 CHAT —— MiniMax 的向量模型与维度口径未核, 不占位注册.
  const minimaxApiKey = config.get<string>('MINIMAX_API_KEY');
  if (minimaxApiKey) {
    const minimax = new MinimaxChatProvider({
      baseUrl: config.get<string>('MINIMAX_BASE_URL'),
      defaultChatModel: config.get<string>('MINIMAX_LLM_MODEL'),
      ...runtime,
    });
    registry.registerChat(minimax, {
      id: AIProviderId.MINIMAX,
      displayName: 'MiniMax',
      baseUrl: minimax.baseUrl,
      apiKey: minimaxApiKey,
      capabilities: [LLMCapability.CHAT],
      defaultModels: {
        [LLMCapability.CHAT]: minimax.defaultChatModel,
      },
      defaultChatModel: minimax.defaultChatModel,
      enabled: true,
    });
  }

  // ─── Custom OpenAI 兼容 embedding (TEI / 私有网关) ───
  //   为什么放在这里: 自托管 bge/TEI 和私有 embedding 网关都是 OpenAI 兼容协议,
  //   但它们没有固定厂商 id；用 custom 一个口子接, 不每接一个服务就加一个 provider.
  //   只有 baseUrl + 模型都配置才注册 —— 缺一项就不占位, 避免
  //   "provider 列表里有 custom, 一 embed 就报模型为空".
  const customBaseUrl = config.get<string>('LLM_CUSTOM_BASE_URL')?.trim();
  const customEmbeddingModel = config.get<string>('LLM_CUSTOM_DEFAULT_MODEL_EMBED')?.trim();
  const customEnabled = (config.get<string>('LLM_CUSTOM_ENABLED') ?? 'true').trim().toLowerCase() !== 'false';
  if (customEnabled && customBaseUrl && customEmbeddingModel) {
    const dimensionRaw = Number(config.get<string>('LLM_CUSTOM_DIMENSION'));
    const defaultDimension = Number.isFinite(dimensionRaw) && dimensionRaw > 0 ? Math.floor(dimensionRaw) : 1024;
    registry.registerEmbedding(
      createCustomEmbeddingProvider({
        id: AIProviderId.CUSTOM,
        baseUrl: normalizeOpenAiCompatibleBaseUrl(customBaseUrl),
        defaultEmbeddingModel: customEmbeddingModel,
        defaultDimension,
        name: 'Custom (OpenAI Compatible Embedding)',
      }),
    );
  }
}

/**
 * 读 OpenAI 兼容 chat provider 的运行时选项 (客户端超时 / 显式重试次数).
 *
 * 为什么放在**启动配置层**而不是各 provider 里: 这两个值是部署事实 (env),
 * 不是厂商事实; 四家共用同一套口径, 少一家就少一份真相.
 *
 * 非法值 → 回落缺省 (不抛错): 填错一个 env 不该让服务起不来.
 *
 * @param config 配置服务
 * @returns 运行时选项 (未配置的项不出现, 由基类取缺省)
 */
function readRuntimeOptions(config: ConfigService): OpenAICompatibleChatOptions {
  const timeoutRaw = config.get<string>('LLM_REQUEST_TIMEOUT_MS');
  const timeoutMs = Number(timeoutRaw);
  const retriesRaw = config.get<string>('LLM_MAX_RETRIES');
  const retries = Number(retriesRaw);
  return {
    ...(timeoutRaw && Number.isFinite(timeoutMs) && timeoutMs > 0 ? { requestTimeoutMs: Math.floor(timeoutMs) } : {}),
    ...(retriesRaw && Number.isFinite(retries) && retries >= 0 ? { maxRetries: Math.floor(retries) } : {}),
  };
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
