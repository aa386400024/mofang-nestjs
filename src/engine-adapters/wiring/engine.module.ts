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
//     - V2026-10-29 (WP9-A) 起新增角色解析端口绑定: 角色是**可选增强**,
//       解析器缺席 = 无角色 = 中性基线, 不影响会话开合.
//     - V2026-10-29 (WP9-B) 起绑定切到 db 数据源 (MySQL 角色池), 并注册
//       `character_profiles` 实体 + 角色资产池管理端点 (内部 admin 鉴权).
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. 启动后 curl POST /engine/debug/open → /turn → /close 能跑通一轮
//     3. test/engine-adapters/wp8-wiring.spec.ts 覆盖装配链与配置面

import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CHARACTER_PROFILE_RESOLVER, type CharacterProfileResolver } from './character';
import { CharacterPoolModule } from './character/character-pool.module';
import { EngineStreamBackend } from './engine-stream-backend.adapter';
import { EngineSessionRegistry, EngineTurnService } from './engine-turn.service';
import { EngineWiringController } from './engine-wiring.controller';
import {
  createEngineMemoryStore,
  createEngineOrchestrator,
  createEngineSessionPort,
  createEngineStreamBackend,
  createRiskProbe,
  createVisitorOutputProbe,
} from './engine.providers';
import { ENGINE_MEMORY_STORE, ENGINE_RENDER_PORT, ENGINE_SESSION_PORT } from './engine.tokens';
import { RenderConfigFactory, buildEngineRenderPort } from './render-config.factory';
import { resolvePsyGuardTimeoutMs } from './risk/http-psyguard.probe';
import { LocalCrisisProbe } from './risk/local-crisis.probe';
import { PsyGuardHealthChecker } from './risk/psyguard-health.checker';
import { RISK_PROBE } from './risk/risk-probe.token';
import { RouterChatCaller } from './router-chat-caller';
import { StaticTrajectoryScriptResolver, TRAJECTORY_SCRIPT_RESOLVER, type TrajectoryScriptResolver } from './trajectory';
import { AdminDebugModule } from '../../admin-debug/admin-debug.module';
import { AIEngineModule } from '../../ai-engine/ai-engine.module';
import { QdrantService } from '../../ai-engine/providers/qdrant.service';
import type { EngineSessionPort, MemoryStore, RiskProbePort } from '../../engine-core';
import { LlmModule } from '../../llm/llm.module';
import { LlmRouterService } from '../../llm/registry/llm-router.service';
import { VoiceFrameRegistry } from '../../voice/voice-frame-registry';
import { VOICE_TURN_BACKEND } from '../../voice/voice-turn-backend.port';
import { OpenAICompatEmbedder } from '../embedder/openai-compat.embedder';
import type { StreamingRenderPort } from '../rendering/streaming-render.port';
import { TurnRenderOrchestrator } from '../rendering/turn-render-orchestrator';

/**
 * 引擎装配模块 (NestJS).
 */
@Module({
  imports: [
    LlmModule,
    AIEngineModule,
    // V2026-10-29 (WP9-B): 角色资产池自成一个模块 (表实体 + 解析端口绑定 + 管理端点).
    //   为什么要它独立: 引擎装配层有一条硬约束 —— **不得直接依赖 ORM / 向量库 / 厂商
    //   SDK** (WP8-A §8-9 单测按包名判定). 角色池必须连库, 若把它的 provider 直接写
    //   在这里, 本文件就得 import '@nestjs/typeorm' —— 护栏会红.
    //   拆成模块后: 本文件只 import 模块 (相对路径), 零 SDK 包名; 换数据源只改
    //   CharacterPoolModule 里那一处绑定 (任务单 §5).
    CharacterPoolModule,
    // WP19: 调试快照记录器 (每轮 BDI trace 落库).
    AdminDebugModule,
  ],
  controllers: [EngineWiringController],
  providers: [
    // 调用出口: router → 窄面.
    RouterChatCaller,
    // 配置: env → 渲染配置 (含各候选的厂商模型名).
    RenderConfigFactory,
    // 归属登记表 (handleId → tenant/visitor/session).
    EngineSessionRegistry,
    // 本地危机探测器 (内核 WP4 的 RiskProbePort 扩展点; 将来换 PsyGUARD 服务换这一处).
    LocalCrisisProbe,
    // V2026-10-30 (WP11): 风险探测端口 —— **按 env 分流, 两者不叠加**:
    //   配了 PSYGUARD_BASE_URL → HttpPsyGuardProbe (打独立仓库的 PsyGUARD Python 服务);
    //   没配                  → LocalCrisisProbe (现状不变, 行为逐字一致).
    //   为什么要抽成 token: 探测器是**可替换能力**, 装配层决定装哪个, 内核只认端口.
    //   ⚠️ 这两个 env 读取必须走 ConfigService (它读的是 process.env 的同一份),
    //   且数值要自己解析 —— ConfigService.get<number>() 拿到的是字符串 (WP9-B 踩过).
    {
      provide: RISK_PROBE,
      useFactory: (config: ConfigService, local: LocalCrisisProbe): RiskProbePort =>
        createRiskProbe({
          baseUrl: config.get<string>('PSYGUARD_BASE_URL') ?? '',
          timeoutMs: resolvePsyGuardTimeoutMs(config.get<string>('PSYGUARD_TIMEOUT_MS')),
          fallback: local,
        }),
      inject: [ConfigService, LocalCrisisProbe],
    },
    // V2026-10-30 (WP11): PsyGUARD 服务启动自检 —— 启动时探一次 /health,
    //   失败/不可达/模型未加载都**只记 warn, 不阻断启动** (探测器是可选增强).
    {
      provide: PsyGuardHealthChecker,
      useFactory: (config: ConfigService): PsyGuardHealthChecker =>
        new PsyGuardHealthChecker({ baseUrl: (config.get<string>('PSYGUARD_BASE_URL') ?? '').trim() }),
      inject: [ConfigService],
    },
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
    // V2026-10-30 (WP11 审核后决策 #3): 输出侧 guard 接入 **PsyGUARD 探测器** ——
    //   PsyGUARD 正是在"来访者话语"上训练的 (论文语料 = 微博/知乎/壹心理的用户表达),
    //   而渲染出来的文本就是 AI 扮演的来访者/学员角色的台词 —— 这是模型最该用的地方.
    //   ⚠️ 输出侧只接 **HTTP 探测器**, 不接 `LocalCrisisProbe`:
    //   后者的补充词表 (`我想死` / `死了算了` …) 是按咨询师输入面收的, 类别映射到
    //   high → block, 而 AI 角色**本来就要**说痛苦的话 (那就是训练素材) ——
    //   接上去等于角色说一句"我想死"就被拦下重生成并降级, 把训练场景换掉.
    //   没配 `PSYGUARD_BASE_URL` 时输出侧**不接探测**, 维持现状 (只有内核规则层).
    {
      provide: ENGINE_RENDER_PORT,
      useFactory: (caller: RouterChatCaller, configFactory: RenderConfigFactory, config: ConfigService): StreamingRenderPort =>
        buildEngineRenderPort(
          caller,
          configFactory.build(),
          createVisitorOutputProbe({
            baseUrl: config.get<string>('PSYGUARD_BASE_URL') ?? '',
            timeoutMs: resolvePsyGuardTimeoutMs(config.get<string>('PSYGUARD_TIMEOUT_MS')),
          }),
        ),
      inject: [RouterChatCaller, RenderConfigFactory, ConfigService],
    },
    // 内核会话: BDI 状态用内存仓储 (落库仓储属后续轮), 记忆用上面的同一实例.
    // V2026-10-29 治本 (WP9-C): 注入本地危机探测器 (内核 WP4 的 RiskProbePort 扩展点) ——
    //   没有它, 咨询师输入面的危机语言在内核眼里是干净的, 危机轮次路由与督导提示都无从触发.
    // V2026-10-30 (WP11): 注入点从具体实现 (LocalCrisisProbe) 换成**端口 token**
    //   (RISK_PROBE) —— 装 HttpPsyGuardProbe 还是 LocalCrisisProbe 由 env 决定,
    //   注入点零改动 (换探测器 = 改那一处 useFactory).
    {
      provide: ENGINE_SESSION_PORT,
      useFactory: (memories: MemoryStore, probe: RiskProbePort) => createEngineSessionPort(memories, probe),
      inject: [ENGINE_MEMORY_STORE, RISK_PROBE],
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
    // V2026-10-29 (WP9-B) 改为**工厂装配** (不是类 provider):
    //   adapter 里 EngineTurnService 是 type-only 导入 → 编译产物的
    //   design:paramtypes[0] 退化成 `Function` → Nest 按 token `Function` 去容器里
    //   找 provider 找不到 → 启动抛 UnknownDependenciesException.
    //   (这是 WP8-B 起的既有启动炸弹, 不是本轮引入; WP8-A/8-B 只跑 tsc/eslint/jest,
    //    从没真起过服务, 所以一直没暴露.)
    //   走工厂后 Nest 不再读它的 design:paramtypes, 注入点是**显式**给的:
    //   引擎门面 + 角色解析端口 (后者来自 CharacterPoolModule) + WS 帧出口注册表.
    //   V2026-10-29 (WP9-C): 危机轮次要同步给督导推 supervision_hint 帧 ——
    //   帧出口注册表由 voice 侧 @Global 模块提供, 装配缺失时只影响提示帧.
    // WP10: 轨迹剧本解析端口 (内置静态伦理盲盒剧本) —— 剧本是**可选增强**,
    //   解析器缺席 = 无剧本 = BDI 自由运行, 不影响会话开合.
    //   走 useFactory 显式 new (与仓库既有做法一致): 静态实现零构造参数,
    //   但 useClass 会让 Nest 按 design:paramtypes 找依赖, 不如工厂直给.
    {
      provide: TRAJECTORY_SCRIPT_RESOLVER,
      useFactory: (): StaticTrajectoryScriptResolver => new StaticTrajectoryScriptResolver(),
    },
    {
      provide: EngineStreamBackend,
      useFactory: (
        engine: EngineTurnService,
        resolver: CharacterProfileResolver,
        frames: VoiceFrameRegistry,
        scriptResolver: TrajectoryScriptResolver,
      ): EngineStreamBackend => createEngineStreamBackend({ engine, resolver, frames, scriptResolver }),
      // 帧出口注册表由 voice 侧的 @Global 模块提供; optional = 缺了只影响督导提示帧.
      // 剧本解析端口同理: optional = 缺了只影响伦理盲盒剧本, 不影响会话开合.
      inject: [
        EngineTurnService,
        CHARACTER_PROFILE_RESOLVER,
        { token: VoiceFrameRegistry, optional: true },
        { token: TRAJECTORY_SCRIPT_RESOLVER, optional: true },
      ],
    },
    {
      provide: VOICE_TURN_BACKEND,
      useExisting: EngineStreamBackend,
    },
    // WP9-A: 角色解析端口 (可替换数据源) —— V2026-10-29 (WP9-B) 起绑定移进
    //   CharacterPoolModule (数据源切换 = 改那一处 useFactory; 注入点零改动).
    //   本模块只 import 该模块, 不再直接持有角色池 provider —— 引擎装配层因此
    //   零 ORM / 零 SDK 包名 (WP8-A §8-9 护栏).
  ],
  exports: [
    EngineTurnService,
    ENGINE_SESSION_PORT,
    ENGINE_RENDER_PORT,
    VOICE_TURN_BACKEND,
    // V2026-10-29 (WP9-B): 角色解析端口的 provider 声明在 CharacterPoolModule 里,
    //   本模块**不能**再把那个 symbol 单独导出一遍 —— Nest 的
    //   `Module.validateExportedProvider` 只接受两种导出:
    //     ① 本模块自己 providers 里声明的 provider;
    //     ② 一个**整个 imported module 类** (即 `imports.includes(token)`).
    //   导出 imported module 里的**单个 provider** 会直接抛
    //   `UnknownExportException: Nest cannot export a provider/module that is not
    //   a part of the currently processed module` —— 应用起不来.
    //   所以这里转出**整个 CharacterPoolModule**: 外部模块照样能从本模块拿到
    //   CHARACTER_PROFILE_RESOLVER (它由 CharacterPoolModule 的 exports 提供),
    //   对外取用口子与 WP9-A 保持一致, 而引擎装配层依旧零 ORM / 零 SDK 包名.
    CharacterPoolModule,
  ],
})
export class EngineWiringModule {}
