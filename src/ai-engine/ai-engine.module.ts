// V2026-09-04 治本 (V6.0 §3 + §11.2 + §12 RAG):
//   AI 引擎模块 — 5 service + crisis detector + 3 cron + RAG + Qdrant + 6 controller.
//   反双胞胎:
//     - 不导入 LlmModule 重导出 — UserModule 已经导出 LlmModule? 检查;
//       实际上 LlmModule 应该全局可用, 这里显式导入确保 DI.
//     - 不重复 NestJS 公共 guard — 复用 UserModule 的 JwtAuthGuard.

import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LlmModule } from '../llm/llm.module';
import { UserModule } from '../user/user.module';

import { AIEffectController } from './controllers/ai-effect.controller';
import { AIProfileController } from './controllers/ai-profile.controller';
import { AIRecommendController } from './controllers/ai-recommend.controller';
import { AIUnlockController } from './controllers/ai-unlock.controller';
import { LlmChatController } from './controllers/llm-chat.controller';
import { RagController } from './controllers/rag.controller';
import { AIEffectRecordEntity } from './entities/ai-effect-record.entity';
import { AIProfileCache } from './entities/ai-profile-cache.entity';
import { AIUnlockStateEntity } from './entities/ai-unlock-state.entity';
import { CrisisEventEntity } from './entities/crisis-event.entity';
import { LLMConversationEntity } from './entities/llm-conversation.entity';
import { AIEffectService } from './providers/ai-effect.service';
import { AIProfileService } from './providers/ai-profile.service';
import { AIRecommendService } from './providers/ai-recommend.service';
import { AIUnlockService } from './providers/ai-unlock.service';
import { CrisisCleanupCron } from './providers/crisis-cleanup.cron';
import { CrisisDetectorService } from './providers/crisis-detector.service';
import { EffectAggregateCron } from './providers/effect-aggregate.cron';
import { LlmOrchestratorService } from './providers/llm-orchestrator.service';
import { QdrantService } from './providers/qdrant.service';
import { RagService } from './providers/rag.service';
// V2026-10-14 治本 (VS-3b plan B 调整 — 删 BgeEmbeddingService, 复用 OpenAI 兼容 4 provider):
//   原因: 大炮 14:57 拍板 "B 方案 — 删 bge 自托管 TEI 容器, 改走 OpenAI 兼容 embedding (deepseek/doubao/qwen/custom
//     4 provider 之一)". daocloud 502 Bad Gateway 拉 TEI 镜像失败, V0.5 阶段自托管 bge 不治本 (多
//     1 个故障点 + 110MB 镜像 + 50MB 模型, 跟 V0.2 KISS 治本 culture 不一致).
//   修法: 删 bge-embedding.service.ts + 删 L36 import + 删 providers/export 2 处, RagService
//     改用 LlmModule.ProviderRegistryService 拿 OpenAI 兼容 embedding (跟 chat 同 provider pool).
//   反双胞胎: 跟 VS-3a LangChain OpenAI 兼容 base class 1:1 复用, 不在 RagService 写 bge 协议.
//   验证 (大炮装包后跑):
//     1. pnpm add @qdrant/js-client-rest (装包, 跟 VS-3a LangChain 同 pattern)
//     2. npx tsc -p tsconfig.build.json --noEmit 0 错
//     3. 启动后 RagService.ingest() → ProviderRegistryService.embed() → deepseek/doubao/qwen/custom
//        之一 (跟 env LLM_DEFAULT_EMBEDDING_PROVIDER 配置), 写 Qdrant collection.
//   时间戳: 2026-10-14 14:57.
import { UnlockEvaluateCron } from './providers/unlock-evaluate.cron';

/**
 * AI 引擎模块 — V6.0 §3 + §11.2 + §12 RAG.
 *
 * 包含:
 *   - §3.1 用户画像 (7 维度)
 *   - §3.2 推荐 (§3.2 卡片流)
 *   - §3.3 动态解锁 (6 高阶功能 + cron)
 *   - §3.4 干预效果 (短/中/长 3 维 + cron)
 *   - §3.5 LLM 编排 (流式 + crisis 联动)
 *   - §11.2 危机检测 + cleanup cron
 *   - §12 RAG (Qdrant 向量库 + LangChain)
 *
 * V2.0 范围:
 *   - 推荐用规则版 (AIRecommendService)
 *   - 解锁用静态 baseline + 客户端触发
 *   - 效果短效上报 + 周/月 cron 聚合
 *   - LLM 编排走 router + crisis 联动
 *   - RAG 软降级 (Qdrant 不可达时不影响 chat)
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AIProfileCache, AIUnlockStateEntity, AIEffectRecordEntity, CrisisEventEntity, LLMConversationEntity]),
    LlmModule,
    UserModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [AIProfileController, AIRecommendController, AIUnlockController, AIEffectController, LlmChatController, RagController],
  providers: [
    AIProfileService,
    AIRecommendService,
    AIUnlockService,
    AIEffectService,
    CrisisDetectorService,
    LlmOrchestratorService,
    QdrantService,
    // VS-3b 治本 (plan B 调整 — 删 BgeEmbeddingService 改复用 OpenAI 兼容 4 provider):
    //   RagService 走 LlmModule.ProviderRegistryService 拿 embedding (跟 chat 同 4 provider).
    //   bge 自托管 TEI 方案治本失败 (daocloud 502), 改 KISS: 复用现有 OpenAI 兼容 base class.
    RagService,
    // cron 任务
    UnlockEvaluateCron,
    EffectAggregateCron,
    CrisisCleanupCron,
  ],
  exports: [
    AIProfileService,
    AIRecommendService,
    AIUnlockService,
    AIEffectService,
    CrisisDetectorService,
    LlmOrchestratorService,
    QdrantService,
    // VS-3b 治本: RagService 走 LlmModule.ProviderRegistryService (不需要 export 单独的 BgeEmbeddingService).
    RagService,
  ],
})
export class AIEngineModule {}
