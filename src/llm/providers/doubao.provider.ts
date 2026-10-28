// V2026-09-04 治本 (V6.0 §3.5 + audit P0-1):
//   豆包 Provider — 字节跳动火山引擎方舟, OpenAI 兼容协议 (部分).
//   原因: 心塑产品方为字节, 豆包是首选 (合规 + 性能 + 中文优化).
//         火山方舟 https://ark.cn-beijing.volces.com/api/v3 走 OpenAI
//         兼容协议, 但需要 endpoint id 而非模型名 (类似 OpenAI fine-tune).
//   修复: 继承 OpenAICompatibleChatProvider 基类, 通过 modelAlias 把
//         心塑模型名 ('doubao-pro-32k') 映射到方舟 endpoint id
//         (来自环境变量 ARK_ENDPOINT_ID, admin 后台配置).
//   如何验证:
//     1. POST /llm/providers/doubao/config 配置 endpoint id 后,
//        流式 chat 正常.
//     2. 豆包 embedding 走方舟 embedding endpoint, 维度 1024/2048 可选.

import { OpenAICompatibleChatProvider, type OpenAICompatibleConfig } from '../common/base/openai-compatible-chat.provider';
import {
  OpenAICompatibleEmbeddingProvider,
  type OpenAICompatibleEmbeddingConfig,
} from '../common/base/openai-compatible-embedding.provider';
import { AIProviderId } from '../common/enums/llm.enums';

/**
 * 豆包 Chat Provider — 火山方舟 OpenAI 兼容协议.
 *
 * 模型名 → endpoint id 映射:
 *   心塑业务用 'doubao-pro-32k' / 'doubao-pro-128k' / 'doubao-lite' 等
 *   业务别名, 实际请求方舟用 endpoint id (类似 'ep-20240101-xxxxxx').
 *   映射通过 LLMRouter 注入 modelAliasMap 实现 (不是基类职责).
 */
export class DoubaoChatProvider extends OpenAICompatibleChatProvider {
  constructor() {
    const cfg: OpenAICompatibleConfig = {
      id: AIProviderId.DOUBAO,
      name: '豆包 (火山方舟)',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      defaultChatModel: 'doubao-pro-32k',
      customHeaders: {
        // 方舟可选标识, 方便运营追踪调用来源.
        'X-Client-Platform': 'xin-su-app',
        'X-Client-Version': '6.0',
      },
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
