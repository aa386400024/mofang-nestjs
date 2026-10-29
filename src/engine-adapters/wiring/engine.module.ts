// V2026-10-28 治本 (WP8-A · B 层 · 引擎装配模块):
//   职责: 把 WP0–WP7 的纯单元**装进 NestJS 依赖注入** —— 记忆仓储 → 内核会话
//         → 渲染端口 → 装配门面 → 门面服务 → 调试控制器, 形成一条可启动的生产链.
//   边界: 本模块只做「读配置 → 造纯对象 → 注入」; 不写决策、不拼 prompt、
//         不组装 RenderSpec (那些分别在内核 / WP7).
//
//   装配链 (为什么是这个顺序):
//     ConfigService ──▶ RenderConfigFactory ──▶ RenderAdapterConfig
//                          │
//     LlmRouterService ─▶ RouterChatCaller ────┐
//                                             ▼
//                                   LlmRenderAdapter (WP6) ──▶ RenderPort
//     MemoryStore(Qdrant/内存) ─┐
//                               ├──▶ InMemoryEngineSession (内核) ──▶ EngineSessionPort
//                               └──▶ TurnRenderOrchestrator (WP7)
//                                      ▲
//                              归属登记表 (resolveSession 缝)
//                                      │
//                              EngineTurnService ──▶ EngineWiringController
//
//   反双胞胎:
//     - 不用 `useClass` 装配带默认参数的类: `OpenAICompatEmbedder` 的第二个构造
//       参数有默认值, Nest 会把 `Object` 当成要注入的依赖而报错 —— 所以走
//       useFactory 显式 new (与仓库里 LlmRouterService 用 @Optional() 的做法同理).
//     - 不把内核接口当 provider token: interface 编译后没有运行时值, 必须用
//       engine.tokens.ts 里的 symbol.
//     - 不在这里放全局单例: 引擎会话 / 归属表都是**模块内单例**, 与引擎实例同生命周期.
//     - V2026-10-29 (WP8-B) 起支持流式: 渲染端口产出改为 `StreamingRenderPort`
//       (聚合 + 流式同一个适配器实例), 并对外提供引擎版对话后端 (VOICE_TURN_BACKEND),
//       供 voice 侧灰度接入 —— 灰度开关关时 voice 侧根本不会注入它 (旧链路 100% 原样).
//     - **不在本文件里写构造逻辑**: 构造全在 engine.providers.ts 的纯工厂里,
//       本文件只声明「token ↔ 工厂」的映射. 理由见 engine.providers.ts 文件头:
//       写在 useFactory 里的代码单测覆盖不到, 等于"装配正确性"没有护栏.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. 启动后 curl POST /engine/debug/open → /turn → /close 能跑通一轮
//     3. test/engine-adapters/wp8-wiring.spec.ts 覆盖装配链与配置面

import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EngineStreamBackend } from './engine-stream-backend.adapter';
import { EngineSessionRegistry, EngineTurnService } from './engine-turn.service';
import { EngineWiringController } from './engine-wiring.controller';
import { createEngineMemoryStore, createEngineOrchestrator, createEngineSessionPort } from './engine.providers';
import { ENGINE_MEMORY_STORE, ENGINE_RENDER_PORT, ENGINE_SESSION_PORT } from './engine.tokens';
import { RenderConfigFactory, buildEngineRenderPort } from './render-config.factory';
import { RouterChatCaller } from './router-chat-caller';
import { AIEngineModule } from '../../ai-engine/ai-engine.module';
import { QdrantService } from '../../ai-engine/providers/qdrant.service';
import type { EngineSessionPort, MemoryStore } from '../../engine-core';
import { LlmModule } from '../../llm/llm.module';
import { LlmRouterService } from '../../llm/registry/llm-router.service';
import { VOICE_TURN_BACKEND } from '../../voice/voice-turn-backend.port';
import { OpenAICompatEmbedder } from '../embedder/openai-compat.embedder';
import type { StreamingRenderPort } from '../rendering/streaming-render.port';
import { TurnRenderOrchestrator } from '../rendering/turn-render-orchestrator';

/**
 * 引擎装配模块 (NestJS).
 */
@Module({
  imports: [LlmModule, AIEngineModule],
  controllers: [EngineWiringController],
  providers: [
    // 调用出口: router → 窄面.
    RouterChatCaller,
    // 配置: env → 渲染配置 (含各候选的厂商模型名).
    RenderConfigFactory,
    // 归属登记表 (handleId → tenant/visitor/session).
    EngineSessionRegistry,
    // 向量化适配器 (Qdrant 长时记忆写入需要). 走 useFactory: 它的第 2 个构造参数
    // 带默认值, Nest 直接 new 会把 Object 当成待注入依赖而报错.
    {
      provide: OpenAICompatEmbedder,
      useFactory: (router: LlmRouterService): OpenAICompatEmbedder => new OpenAICompatEmbedder(router),
      inject: [LlmRouterService],
    },
    // 记忆仓储: 配了向量库就用向量版 (内置内存回落仓), 否则纯内存.
    {
      provide: ENGINE_MEMORY_STORE,
      useFactory: (config: ConfigService, qdrant: QdrantService, embedder: OpenAICompatEmbedder): MemoryStore =>
        createEngineMemoryStore({
          qdrantUrl: config.get<string>('QDRANT_URL'),
          qdrant,
          embedder,
        }),
      inject: [ConfigService, QdrantService, OpenAICompatEmbedder],
    },
    // 渲染端口 (WP6 适配器 + WP7 prompt 缝 + WP6 输出 guard + WP8-B 前置预检).
    {
      provide: ENGINE_RENDER_PORT,
      useFactory: (caller: RouterChatCaller, configFactory: RenderConfigFactory): StreamingRenderPort =>
        buildEngineRenderPort(caller, configFactory.build()),
      inject: [RouterChatCaller, RenderConfigFactory],
    },
    // 内核会话: BDI 状态用内存仓储 (落库仓储属后续轮), 记忆用上面的同一实例.
    {
      provide: ENGINE_SESSION_PORT,
      useFactory: (memories: MemoryStore) => createEngineSessionPort(memories),
      inject: [ENGINE_MEMORY_STORE],
    },
    // 装配门面 (WP7): 接上归属解析缝 (多会话, 不传固定 sessionContext).
    {
      provide: TurnRenderOrchestrator,
      useFactory: (
        session: EngineSessionPort,
        renderer: StreamingRenderPort,
        memories: MemoryStore,
        registry: EngineSessionRegistry,
      ): TurnRenderOrchestrator => createEngineOrchestrator({ session, renderer, memories, registry }),
      inject: [ENGINE_SESSION_PORT, ENGINE_RENDER_PORT, ENGINE_MEMORY_STORE, EngineSessionRegistry],
    },
    // 对外门面服务.
    EngineTurnService,
    // WP8-B: 引擎版对话后端 (实现 voice 侧窄接口) —— 灰度开关打开时, 语音链路
    // 用它取代旧 visitor 直出; 开关关闭时 voice 侧根本不注入它 (旧链路 100% 原样).
    EngineStreamBackend,
    {
      provide: VOICE_TURN_BACKEND,
      useExisting: EngineStreamBackend,
    },
  ],
  exports: [EngineTurnService, ENGINE_SESSION_PORT, ENGINE_RENDER_PORT, VOICE_TURN_BACKEND],
})
export class EngineWiringModule {}
