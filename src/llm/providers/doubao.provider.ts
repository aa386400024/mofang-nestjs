// V2026-09-04 治本 (V6.0 §3.5 + audit P0-1):
//   豆包 Provider — 字节跳动火山引擎方舟, OpenAI 兼容协议 (部分).
//   原因: 心塑产品方为字节, 豆包是首选 (合规 + 性能 + 中文优化).
//         火山方舟 https://ark.cn-beijing.volces.com/api/v3 走 OpenAI
//         兼容协议; AF-227 实测已支持模型 ID 直连.
//   修复: 继承 OpenAICompatibleChatProvider 基类; 模型 ID 由 `LLM_DOUBAO_MODEL`
//         单一来源提供, 缺省回落到当前可用的 `doubao-seed-2-1-pro-260915`.
//         旧注释里的 endpoint id 映射方式已不是当前方舟的默认接入形态.
//   如何验证:
//     1. POST /llm/providers/doubao/config 配置 endpoint id 后,
//        流式 chat 正常.
//     2. 豆包 embedding 走方舟 embedding endpoint, 维度 1024/2048 可选.

import {
  OpenAICompatibleChatProvider,
  type OpenAICompatibleChatOptions,
  type OpenAICompatibleConfig,
} from '../common/base/openai-compatible-chat.provider.js';
import {
  OpenAICompatibleEmbeddingProvider,
  type OpenAICompatibleEmbeddingConfig,
} from '../common/base/openai-compatible-embedding.provider.js';
import { AIProviderId } from '../common/enums/llm.enums.js';
import { resolveDoubaoBaseUrl, resolveDoubaoChatModel } from '../config/provider-env.js';

/**
 * 豆包 Chat Provider 构造选项.
 */
export interface DoubaoChatProviderOptions extends OpenAICompatibleChatOptions {
  /** 方舟基址 (缺省 / 空白 = 官方 `/api/v3`). */
  readonly baseUrl?: string;
  /** 默认 chat 模型 (缺省 / 空白 = doubao-seed-2-1-pro-260915). */
  readonly defaultChatModel?: string;
}

/**
 * 豆包 Chat Provider — 火山方舟 OpenAI 兼容协议.
 *
 * 模型名映射:
 *   业务侧可直接使用方舟模型 ID（如 `doubao-seed-2-1-pro-260915`）。
 *   若某些部署仍使用业务别名，可通过 LLMRouter 的 modelAliasMap 映射到目标 ID；
 *   映射不是本类的职责。
 */
export class DoubaoChatProvider extends OpenAICompatibleChatProvider {
  constructor(options: DoubaoChatProviderOptions = {}) {
    const cfg: OpenAICompatibleConfig = {
      id: AIProviderId.DOUBAO,
      name: '豆包 (火山方舟)',
      baseUrl: resolveDoubaoBaseUrl(options.baseUrl),
      // AF-210: 旧默认 doubao-pro-32k 已被方舟下线 (实测 404); AF-227 起模型
      //   走 LLM_DOUBAO_MODEL 单一来源, provider 只保留当前可用模型兜底.
      defaultChatModel: resolveDoubaoChatModel(options.defaultChatModel),
      customHeaders: {
        // 方舟可选标识, 方便运营追踪调用来源.
        'X-Client-Platform': 'xin-su-app',
        'X-Client-Version': '6.0',
      },
      ...(options.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: options.requestTimeoutMs }),
      ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
      ...(options.modelKwargs === undefined ? {} : { modelKwargs: options.modelKwargs }),
    };
    super(cfg);
  }
}

/**
 * 豆包 Embedding Provider.
 *
 * 方舟 embedding 端点: /api/v3/embeddings, 协议 OpenAI 兼容.
 * 模型选项: 'doubao-embedding-text-240715' (1024 维) /
 *           'doubao-embedding-large' (2048 维).
 */
export class DoubaoEmbeddingProvider extends OpenAICompatibleEmbeddingProvider {
  constructor() {
    const cfg: OpenAICompatibleEmbeddingConfig = {
      id: AIProviderId.DOUBAO,
      name: '豆包 (火山方舟)',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      defaultEmbeddingModel: 'doubao-embedding-text-240715',
      defaultDimension: 1024,
      // 方舟 embedding 单次限流较严, 调小 batchSize.
      batchSize: 16,
      customHeaders: {
        'X-Client-Platform': 'xin-su-app',
      },
    };
    super(cfg);
  }
}
