// V2026-09-04 治本 (V6.0 §3.5 + audit P0-1):
//   通义千问 Provider — 阿里云 DashScope, OpenAI 兼容模式.
//   原因: 阿里云百炼平台 https://dashscope.aliyuncs.com/compatible-mode/v1
//         提供 OpenAI 兼容端点, 心塑 RAG embedding 默认走 Qwen (1024 维,
//         中文场景性价比最优).
//   修复: 继承 OpenAI 兼容基类, defaultEmbeddingModel = 'text-embedding-v3',
//         维度 1024 (支持 2048 通过 dimensions 参数).
//   如何验证:
//     1. 配置 DASHSCOPE_API_KEY 后, embedding 测试通过.
//     2. 切换到 QwenProvider 后, 既有 Qdrant collection 重建为 1024 维.

import { OpenAICompatibleChatProvider, type OpenAICompatibleConfig } from '../common/base/openai-compatible-chat.provider';
import {
  OpenAICompatibleEmbeddingProvider,
  type OpenAICompatibleEmbeddingConfig,
} from '../common/base/openai-compatible-embedding.provider';
import { AIProviderId } from '../common/enums/llm.enums';

/**
 * 通义千问 Chat Provider.
 */
export class QwenChatProvider extends OpenAICompatibleChatProvider {
  constructor() {
    const cfg: OpenAICompatibleConfig = {
      id: AIProviderId.QWEN,
      name: '通义千问 (DashScope)',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      defaultChatModel: 'qwen-plus',
      customHeaders: {
        'X-DashScope-Client': 'xin-su-app/6.0',
      },
    };
    super(cfg);
  }
}

/**
 * 通义千问 Embedding Provider — 心塑 RAG 知识库默认.
 *
 * text-embedding-v3 支持 1024 维 (默认) / 2048 维 (高维).
 */
export class QwenEmbeddingProvider extends OpenAICompatibleEmbeddingProvider {
  constructor() {
    const cfg: OpenAICompatibleEmbeddingConfig = {
      id: AIProviderId.QWEN,
      name: '通义千问 (DashScope)',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      defaultEmbeddingModel: 'text-embedding-v3',
      defaultDimension: 1024,
      customHeaders: {
        'X-DashScope-Client': 'xin-su-app/6.0',
      },
    };
    super(cfg);
  }
}
