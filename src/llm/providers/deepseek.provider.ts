// V2026-09-04 治本 (V6.0 §3.5 + audit P0-1):
//   DeepSeek Provider — 国产代表, OpenAI 兼容协议.
//   原因: DeepSeek 提供 https://api.deepseek.com/v1 端点, 协议跟 OpenAI
//         完全兼容, 仅 baseUrl + 模型名不同. 心塑默认 chat provider
//         之一 (性价比高, 中文友好).
//   修复: 继承 OpenAICompatibleChatProvider 基类, 仅声明 (id, baseUrl,
//         defaultChatModel = 'deepseek-chat'). embedding 维度 1536
//         (DeepSeek embedding 走 bailian 代理, 这里先占位).
//   如何验证:
//     1. 配置 DEEPSEEK_API_KEY 后, GET /llm/providers/deepseek/test
//        返回 success=true + latency < 1000ms.
//     2. POST /v1/chat/completions 用 model=deepseek-chat 流式响应
//        chunks 正常, token 累计.
//     3. POST /v1/embeddings 用 model=deepseek-embedding 向量维度
//        匹配 Qdrant collection (1536).

import { OpenAICompatibleChatProvider, type OpenAICompatibleConfig } from '../common/base/openai-compatible-chat.provider';
import {
  OpenAICompatibleEmbeddingProvider,
  type OpenAICompatibleEmbeddingConfig,
} from '../common/base/openai-compatible-embedding.provider';
import { AIProviderId } from '../common/enums/llm.enums';

/**
 * DeepSeek Chat Provider.
 *
 * 默认模型: deepseek-chat (V3).
 * 备选: deepseek-reasoner (R1, 推理增强, 慢一些).
 */
export class DeepSeekChatProvider extends OpenAICompatibleChatProvider {
  constructor() {
    const cfg: OpenAICompatibleConfig = {
      id: AIProviderId.DEEPSEEK,
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      defaultChatModel: 'deepseek-chat',
    };
    super(cfg);
  }

  /**
   * DeepSeek 模型名 alias:
   *   - 'deepseek-chat' → 'deepseek-chat' (V3, 默认)
   *   - 'deepseek-reasoner' → 'deepseek-reasoner' (R1, 推理)
   *   - 'deepseek-coder' → 'deepseek-coder' (代码)
   *
   * 前端传过来可能是 'deepseek-chat' / 'reasoner' / 'coder',
   * 这里做宽容 alias.
   */
  protected override modelAlias(model: string): string {
    if (model === 'reasoner' || model === 'deepseek-reasoner-r1') {
      return 'deepseek-reasoner';
    }
    if (model === 'coder' || model === 'deepseek-coder-v2') {
      return 'deepseek-coder';
    }
    return model;
  }
}

/**
 * DeepSeek Embedding Provider.
 *
 * DeepSeek 官方目前未提供独立的 embedding 模型 (推荐用 bailian 代理).
 * 这里用 text-embedding-3-small 协议 (1536 维) 作为占位, 实际生产
 * 建议切到 QwenProvider (1024 维) 或 OpenAIProvider (1536 维).
 */
export class DeepSeekEmbeddingProvider extends OpenAICompatibleEmbeddingProvider {
  constructor() {
    const cfg: OpenAICompatibleEmbeddingConfig = {
      id: AIProviderId.DEEPSEEK,
      name: 'DeepSeek (Embedding via compat)',
      baseUrl: 'https://api.deepseek.com/v1',
      // DeepSeek 暂未提供独立 embedding API, 此处用兼容的 text-embedding-3-small 协议占位.
      defaultEmbeddingModel: 'text-embedding-3-small',
      defaultDimension: 1536,
    };
    super(cfg);
  }
}
