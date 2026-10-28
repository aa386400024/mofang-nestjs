// V2026-10-28 治本 (WP2 · B 层 · OpenAI 兼容 embedding 适配器):
//   职责: 把内核的 Embedder 端口桥接到本仓库现有多厂商 embedding 链
//         (ProviderRegistryService → LlmRouterService.embed → 各厂商 provider).
//   边界: **B 层** (src/engine-adapters/), 触框架/触网络 —— 与内核包并列,
//         不在 src/engine-core/ 内 (内核整树零框架依赖, 见 test/engine-core/boundary.spec.ts).
//
//   复用 (M6):
//     走 `LlmRouterService.embed(...)` —— 与既有 RagService 同一路径.
//     不新造 HTTP 客户端, 不自己解析 provider 选型, 不重复做 apiKey 解析.
//     厂商选型 / 主备 / 额度管控全部沿用 LLM 层既有能力.
//
//   为什么用 router.embed() 而不是 provider.embedQuery():
//     `embedQuery` 只存在于 OpenAICompatibleEmbeddingProvider **基类**上,
//     不在 `EmbeddingProvider` **接口**上. 走接口意味着本适配器不绑定具体基类 ——
//     将来换非 OpenAI 兼容的 embedding provider 不用动本文件.
//     两者产出的向量等价 (同 provider / 同模型 / 同文本).
//
//   失败语义 (关键):
//     embed 失败**不抛**, 返回空数组. 理由: 记忆写不进去是"降级", 不是"会话失败" ——
//     让异常炸穿 turn 会把一次可降级的向量服务抖动升级成整场咨询失败.
//     空向量由调用方 (QdrantMemoryStore) 识别为"无法向量化" → 该条退化为结构化落仓.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/ 用 stub router 验证: 正常桥接 / 异常被吞为降级

import { Logger } from '@nestjs/common';

import type { Embedder } from '../../engine-core';
import { LlmRouterService } from '../../llm/registry/llm-router.service';

/** 适配器构造选项. */
export interface OpenAICompatEmbedderOptions {
  /** 厂商审计用的用户 id (可选; 透传给 LlmRouterService.embed). */
  readonly uid?: string;
}

/**
 * OpenAI 兼容 embedding 适配器 (实现内核 Embedder 端口).
 */
export class OpenAICompatEmbedder implements Embedder {
  private readonly logger = new Logger(OpenAICompatEmbedder.name);

  constructor(
    private readonly router: LlmRouterService,
    private readonly options: OpenAICompatEmbedderOptions = {},
  ) {}

  /**
   * 文本 → 向量. 失败返回空数组 (降级, 不抛).
   *
   * @param text 待向量化文本
   * @returns 向量; 失败时为空数组
   */
  async embed(text: string): Promise<readonly number[]> {
    try {
      // model 传空串: 各 provider 内部用各自的 defaultEmbeddingModel,
      // request.model 只是回显字段 (与既有 RagService 调用方式一致).
      const response = await this.router.embed({ model: '', inputs: [text] }, { uid: this.options.uid });
      return response.results[0]?.vector ?? [];
    } catch (e) {
      this.logger.warn(`[embed] 失败, 降级为空向量 (该条记忆不向量化): ${(e as Error).message}`);
      return [];
    }
  }
}
