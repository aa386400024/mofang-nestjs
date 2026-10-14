// V2026-10-12 (Phase 8.1 — KB 模块 / SPEC §8.1 / §12.1):
//   knowledge-base 模块装配, 跟 src/ai-engine/ai-engine.module.ts 同 pattern
//   (4 层架构 controllers / dto / entities / providers).
//
//   V0.x 装配:
//     - 4 entity: KnowledgeItem / KnowledgeVersion / WorkflowEvent / User (for join)
//     - 5 service: KnowledgeService / WorkflowService / SearchService /
//                  ScheduledPublishService / ScheduledPublishProcessor
//     - 1 controller: KnowledgeController (12 endpoint)
//     - 1 cron: ScheduledPublishCron (5min 兜底, 跟客户端 7.7 决策 B+A 对齐)
//
//   治本:
//     - 不用 NestJS @Global() (跟 src/ai-engine 同 pattern, 不全局污染)
//     - User entity 复用 (user 模块已注册, 这里只 import 走 TypeOrm.forFeature)
//     - 后续 V1.x 拆出独立 module 时 (RAG 索引 + Qdrant), 走 entity / service 移
//       动 + TypeOrmModule.forFeature 重新配置

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AIEngineModule } from '../ai-engine/ai-engine.module';
import { AnalyticsModule } from '../analytics/analytics.module';
// V2026-10-14 治本 (VS-3c — LlmModule 路径修正, 2 个 module 都 import, alias 解决同名冲突):
//   原因: V0.x import `../agent/llm/llm.module` (链路 2: agent 直连 MiniMax m3, V3 §3.5),
//     但 SearchService.inject 的是 `../../llm/registry/llm-router.service` (链路 1:
//     LlmRouterService 走 OpenAI 兼容 4 provider + Qdrant). 2 个 llm.module 是不同 module,
//     agent/llm/llm.module 不 export LlmRouterService, 启动报 UnknownDependenciesException.
//   修法: 2 个 module 都 import, 用 import alias `LlmModule` (链路 1) + `AgentLlmModule` (链路 2).
//     2 个 module 并存, 跟 V3 §3.5 "2 套独立 LLM 链路" 一致, PreviewService 走链路 2 (MiniMax m3),
//     SearchService 走链路 1 (OpenAI 兼容 4 provider + Qdrant).
//   反双胞胎: 不用 export 同一个 class name 2 次 (NestJS 不支持, 必须 alias).
import { LlmModule } from '../llm/llm.module';
import { LlmModule as AgentLlmModule } from '../agent/llm/llm.module';
import { KnowledgeController } from './controllers/knowledge.controller';
import { PreviewController } from './controllers/preview.controller';
// V2026-10-12 (Phase 8.8 — workflow panel 补建):
//   7.6 spec 提的 3 个 list endpoint (my-drafts / pending-review / published) 8.1
//   vertical slice 漏建, 16:50 大炮反馈 /admin/workflow/* 404. 治本: 补建
//   WorkflowController, 跟 knowledge.controller / preview.controller 同 pattern.
import { WorkflowController } from './controllers/workflow.controller';
import { KnowledgeChunk } from './entities/knowledge-chunk.entity';
import { KnowledgeItem } from './entities/knowledge-item.entity';
import { KnowledgeVersion } from './entities/knowledge-version.entity';
import { WorkflowEvent } from './entities/workflow-event.entity';
import { KnowledgeService } from './providers/knowledge.service';
import { PreviewService } from './providers/preview.service';
import { ScheduledPublishCron } from './providers/scheduled-publish.cron';
import { ScheduledPublishProcessor } from './providers/scheduled-publish.processor';
import { ScheduledPublishService } from './providers/scheduled-publish.service';
import { SearchService } from './providers/search.service';
import { WorkflowService } from './providers/workflow.service';
import { User } from '../user/entities/user.entity';

@Module({
  imports: [
    // V2026-10-14 治本 (VS-3c — 注册 KnowledgeChunk entity, search.service.ts 用):
    TypeOrmModule.forFeature([KnowledgeItem, KnowledgeVersion, KnowledgeChunk, WorkflowEvent, User]),
    // V2026-10-12 (Phase 8.3 — Analytics 跨模块 wire):
    //   KnowledgeService inject AnalyticsEventTrackerService, 5 workflow action
    //   + 2 schedule action 调 record() 写 analytics_events. AnalyticsModule
    //   走单向下游依赖 (AnalyticsModule 不 import KnowledgeBaseModule, 防循环).
    AnalyticsModule,
    // V2026-10-12 (Phase 8.4 — Preview): LlmModule 注入, PreviewService.streamChat
    //   调 LlmService 走 MiniMax m3 (V0.x dev fallback 返 mock 响应).
    // V2026-10-14 治本 (VS-3c — alias 后的 LlmModule 改 import 别名 LlmModule + 链路 2 alias AgentLlmModule):
    //   原因: 上面 import 别名后, 这里 NestJS @Module.imports 用同名会冲突, 必须跟
    //     import 段别名一致 (链路 1 `LlmModule` = `../llm/llm.module`, 链路 2 `AgentLlmModule`).
    LlmModule,
    AgentLlmModule,
    // V2026-10-14 治本 (VS-3c — AIEngineModule 提供 QdrantService + LlmModule 提供 LlmRouterService):
    //   原因: VS-3c SearchService inject QdrantService (走 RAG 向量召回) + LlmRouterService
    //     (走 OpenAI 兼容 4 provider embedding). 2 个 module 都需 import 知识库模块.
    //   修法: imports 加 AIEngineModule (AIEngineModule 已 export QdrantService + RagService,
    //     跟知识库模块单向下游依赖, 防循环).
    AIEngineModule,
  ],
  controllers: [KnowledgeController, PreviewController, WorkflowController],
  providers: [
    KnowledgeService,
    WorkflowService,
    SearchService,
    ScheduledPublishService,
    ScheduledPublishProcessor,
    ScheduledPublishCron,
    PreviewService,
  ],
  exports: [KnowledgeService, WorkflowService, SearchService],
})
export class KnowledgeBaseModule {}
