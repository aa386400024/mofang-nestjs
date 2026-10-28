// V2026-09-04 治本 (V6.0 §3.5 + audit P0-1):
//   LLM Module — NestJS 模块, 注册 LLM 抽象层.
//   原因: 心塑 AI 引擎 (§3.1 画像 / §3.2 推荐 / §3.3 解锁 / §3.4 效果 /
//         §3.5 对话) + 知识库 RAG 都依赖 LLM 抽象. 单一模块提供 chat /
//         embedding / routing / crisis 检测 / RAG 服务.
//   修复: 全局模块, exports 全部 service 供其它业务模块 (ai-engine /
//         emergency) 注入使用. 启动期 onModuleInit 调用
//         registerDefaultProviders 注入 env 配置的默认 provider.
//   如何验证:
//     1. AppModule.imports 加 LlmModule 后启动, log 应见 'Registered chat
//        provider: deepseek' 等.
//     2. AI Engine Controller (后续 batch) 注入 LlmRouterService 调 chat.
//     3. /v1/chat/completions Controller 暴露给前端, 流式响应正常.

import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { registerDefaultProviders } from './config/llm.config';
import { LlmRouterService } from './registry/llm-router.service';
import { ProviderRegistryService } from './registry/provider-registry.service';

/**
 * V2026-09-04 模块注册清单 (本回合):
 *   - ProviderRegistryService: 单例, 维护 provider map
 *   - LlmRouterService: 能力路由
 *   - 启动期 LLMConfigLoader.registerDefaultProviders
 *
 * 后续批次接入 (待补):
 *   - ChatCompletionService (流式 + 单轮)
 *   - CrisisDetectorService (端侧关键词 + LLM 二级)
 *   - RAGService (LangChain retrieval chain + Qdrant)
 *   - VectorStoreService (Qdrant wrapper)
 *   - LLMConversationService (审计 + token 累计)
 *   - CrisisEventService (审计 + 危机事件归档)
 */
@Module({
  imports: [ConfigModule],
  providers: [ProviderRegistryService, LlmRouterService],
  exports: [ProviderRegistryService, LlmRouterService],
})
export class LlmModule implements OnModuleInit {
  private readonly logger = new Logger(LlmModule.name);

  constructor(
    private readonly registry: ProviderRegistryService,
    private readonly config: ConfigService,
  ) {}

  public onModuleInit(): void {
    registerDefaultProviders(this.registry, this.config);
    const ids = this.registry.listIds();
    this.logger.log(`LLM providers initialized: ${ids.join(', ') || '(none)'}`);
    if (ids.length === 0) {
      this.logger.warn('No LLM providers registered. Set LLM_<PROVIDER>_API_KEY in .env to enable.');
    }
  }
}
