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

import { CharacterPoolModule } from './character/character-pool.module.js';
import { CHARACTER_PROFILE_RESOLVER, type CharacterProfileResolver } from './character/index.js';
import { resolveDeltaCapConfig } from './delta-cap.config.js';
import { DeltaCapLogger } from './delta-cap.logger.js';
import { EngineStreamBackend } from './engine-stream-backend.adapter.js';
import { EngineSessionRegistry, EngineTurnService } from './engine-turn.service.js';
import { EngineWiringController } from './engine-wiring.controller.js';
import {
  createEngineMemoryStore,
  createEngineOrchestrator,
  createEngineSessionPort,
  createEngineStreamBackend,
  createBridgeTranscriptSink,
  createRiskProbe,
  createSessionCloseout,
  createStudentRiskGate,
  createVisitorOutputProbe,
} from './engine.providers.js';
import { ENGINE_MEMORY_STORE, ENGINE_RENDER_PORT, ENGINE_SESSION_PORT } from './engine.tokens.js';
import { RenderConfigFactory, buildEngineRenderPort } from './render-config.factory.js';
import { resolveSessionCostPricing } from '../observability/session-cost.js';
import { resolvePsyGuardTimeoutMs } from './risk/http-psyguard.probe.js';
import { LocalCrisisProbe } from './risk/local-crisis.probe.js';
import { PsyGuardHealthChecker } from './risk/psyguard-health.checker.js';
import { RISK_PROBE } from './risk/risk-probe.token.js';
import { STUDENT_RISK_GATE, StudentRiskGateService } from './risk/student-risk-gate.js';
import { RouterChatCaller } from './router-chat-caller.js';
import { StaticTrajectoryScriptResolver, TRAJECTORY_SCRIPT_RESOLVER, type TrajectoryScriptResolver } from './trajectory/index.js';
import { TurnIdempotencyService } from './turn-idempotency.service.js';
import { AdminDebugModule } from '../../admin-debug/admin-debug.module.js';
import { TraceRecorder } from '../../admin-debug/trace-recorder.service.js';
import { AIEngineModule } from '../../ai-engine/ai-engine.module.js';
import { QdrantService } from '../../ai-engine/providers/qdrant.service.js';
import type { EngineSessionPort, MemoryStore, RiskProbePort } from '../../engine-core/index.js';
import { LlmModule } from '../../llm/llm.module.js';
import { LlmRouterService } from '../../llm/registry/llm-router.service.js';
import { StudentRiskAuditRegistry } from '../../voice/student-risk-audit-slot.js';
import { VoiceFrameRegistry } from '../../voice/voice-frame-registry.js';
import { VoiceSessionBridgeRegistry } from '../../voice/voice-session-bridge.js';
import { VOICE_TURN_BACKEND } from '../../voice/voice-turn-backend.port.js';
import { OpenAICompatEmbedder } from '../embedder/openai-compat.embedder.js';
import { resolveMemoryConfig } from '../persistence/memory-config.js';
import { SessionCloseoutService } from '../persistence/session-closeout.service.js';
import { LlmSessionSummaryGenerator, resolveSummaryModel } from '../persistence/session-summary.generator.js';
import type { StreamingRenderPort } from '../rendering/streaming-render.port.js';
import { TurnRenderOrchestrator } from '../rendering/turn-render-orchestrator.js';

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
    // V2026-10-30 (WP12 · §1.3): 衰减半衰期 / 访客范围召回阈值走 env —
    //   `MEMORY_DECAY_HALF_LIFE_DAYS` (默认 30 天) 与 `MEMORY_RECALL_THRESHOLD` (默认 0.1).
    //   非法值一律回退默认值 (不抛错): 填错一个 env 不该让服务起不来.
    //   ⚠️ 这两个值只对 **Qdrant 版**生效 (纯内存版的判定在内核里, 走内核那份常量);
    //   内核地板仍在, 阈值只能收紧 —— 详见 persistence/memory-config.ts 顶部说明.
    {
      provide: ENGINE_MEMORY_STORE,
      useFactory: (config: ConfigService, qdrant: QdrantService, embedder: OpenAICompatEmbedder): MemoryStore =>
        createEngineMemoryStore({
          qdrantUrl: config.get<string>('QDRANT_URL'),
          qdrant,
          embedder,
          config: resolveMemoryConfig({
            decayHalfLifeDays: config.get<string>('MEMORY_DECAY_HALF_LIFE_DAYS'),
            recallThreshold: config.get<string>('MEMORY_RECALL_THRESHOLD'),
          }),
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
      useFactory: (memories: MemoryStore, probe: RiskProbePort, config: ConfigService, capLogger: DeltaCapLogger): EngineSessionPort =>
        createEngineSessionPort(memories, probe, {
          // WP26 · P2-14: env 由**适配层**读, 内核只认 DeltaCapConfig 端口 ——
          //   内核零 process.env, 同 seed + 同 capConfig 同序列逐字同输出.
          capConfig: resolveDeltaCapConfig(config),
          // WP26 · P2-11/P2-12: 观察者随会话实例注入 (不再有模块级单槽),
          //   报告带 sessionId/handleId, 口径是本轮**总** delta.
          capObserver: capLogger.observer,
        }),
      inject: [ENGINE_MEMORY_STORE, RISK_PROBE, ConfigService, DeltaCapLogger],
    },
    // 装配门面 (WP7): 接上归属解析缝 (多会话, 不传固定 sessionContext).
    // V2026-11-02 (WP14): 注入学员侧处置闸门 —— 门面在**渲染前**问它
    //   "这一轮要不要处置 / 要不要阻断", 判成 block 就**不调 RenderPort.render**.
    {
      provide: TurnRenderOrchestrator,
      useFactory: (
        session: EngineSessionPort,
        renderer: StreamingRenderPort,
        memories: MemoryStore,
        registry: EngineSessionRegistry,
        studentRisk: StudentRiskGateService,
      ): TurnRenderOrchestrator => createEngineOrchestrator({ session, renderer, memories, registry, studentRisk }),
      inject: [ENGINE_SESSION_PORT, ENGINE_RENDER_PORT, ENGINE_MEMORY_STORE, EngineSessionRegistry, STUDENT_RISK_GATE],
    },
    // V2026-11-02 治本 (WP14 §1.6 — 重点监测场次的强制远端探测):
    //   闸门是**模块内单例** —— 编排门面 (判定) 与对话后端适配器 (置位) 必须拿到同一个实例.
    //   闸门里的远端探测器是**独立实例**且不带本地词典兜底 (兜底已在主链路上).
    {
      provide: STUDENT_RISK_GATE,
      useFactory: (config: ConfigService): StudentRiskGateService =>
        createStudentRiskGate({
          baseUrl: config.get<string>('PSYGUARD_BASE_URL') ?? '',
          timeoutMs: resolvePsyGuardTimeoutMs(config.get<string>('PSYGUARD_TIMEOUT_MS')),
        }),
      inject: [ConfigService],
    },
    // 对外门面服务.
    EngineTurnService,
    // V2026-11-03 治本 (WP15): 单回合 delta cap 观测日志 ——
    //   内核只上报"这一回合 BDI 被砍了多少", 打不打日志由本层决定 (内核零 logger 依赖).
    //   装配缺席 = 不打日志, 但内核照常砍幅 (观测是增强, 不是会话能力).
    //   WP26 · P2-11/P2-14: 它的 `observer` 被注入内核会话 (不再有模块级单槽),
    //   报告自带 sessionId/handleId.
    DeltaCapLogger,
    // V2026-11-02 治本 (WP16): 轮次幂等表 —— 同一会话同一 round_id 重发不重跑 BDI.
    //   模块内单例 (与对话后端同生命周期): 装配层唯一的"这一轮跑过没有"的事实来源.
    TurnIdempotencyService,
    // V2026-10-30 治本 (WP12): 会话收尾服务 —— 逐字稿全量定稿 + 摘要晋升长时记忆.
    //   走 useFactory 显式 new (与仓库既有做法一致): 收尾服务有 4 个构造参数,
    //   其中两个可选, useClass 会让 Nest 按 design:paramtypes 找依赖而报错.
    //   三块依赖:
    //     · memories  → 与内核同一实例的记忆仓储 (摘要晋升写这里, 内核召回才读得到);
    //     · generator → LLM 摘要器 (模型名 env 优先, 否则问 router 的 RAG 分层);
    //     · sink      → 业务侧落库桥 (逐字稿写 training_sessions.transcript).
    //   逐字稿落库口依赖 voice 侧的 @Global 落库桥注册表; 缺席 = 不装配 sink
    //   (收尾照常跑, 只是不写逐字稿) —— 引擎装配层因此不认识 ORM / counselor 任何类型.
    {
      provide: SessionCloseoutService,
      useFactory: (
        memories: MemoryStore,
        router: LlmRouterService,
        config: ConfigService,
        bridges: VoiceSessionBridgeRegistry | undefined,
      ): SessionCloseoutService =>
        createSessionCloseout({
          memories,
          generator: new LlmSessionSummaryGenerator({
            router,
            model: resolveSummaryModel(config.get<string>('MEMORY_SUMMARY_MODEL'), router),
          }),
          ...(bridges ? { sink: createBridgeTranscriptSink(bridges) } : {}),
        }),
      inject: [ENGINE_MEMORY_STORE, LlmRouterService, ConfigService, { token: VoiceSessionBridgeRegistry, optional: true }],
    },
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
        closeout: SessionCloseoutService,
        traceRecorder: TraceRecorder,
        config: ConfigService,
        studentRisk: StudentRiskGateService,
        riskAudit: StudentRiskAuditRegistry,
        riskProbe: RiskProbePort,
        idempotency: TurnIdempotencyService,
      ): EngineStreamBackend =>
        createEngineStreamBackend({
          engine,
          resolver,
          frames,
          scriptResolver,
          closeout,
          // WP19-R: 调试快照记录器 —— 由 AdminDebugModule 提供 (本模块已 import 它).
          //   此前这里是"恒 undefined 的占位", 于是 recordTrace() 首行守卫直接 return,
          //   "每轮 BDI 快照落库"一次都没发生过 (turn_debug_trace 恒空).
          //   缺装配 = 不留痕 (会话照常), 不阻断对练主链路.
          traceRecorder,
          // WP24: 成本单价走 env (定价表换版只改配置, 不发版).
          //   解析口径在 `resolveSessionCostPricing` —— 非法值回退默认, 不抛.
          pricing: resolveSessionCostPricing({
            inputPer1k: config.get<string>('LLM_PRICE_INPUT_PER_1K'),
            outputPer1k: config.get<string>('LLM_PRICE_OUTPUT_PER_1K'),
          }),
          // WP14: 学员侧处置闸门 (置位重点监测) + 风险审计插槽 (写 student_risk_events).
          studentRiskGate: studentRisk,
          riskAudit,
          // WP14 优化项: 前置 safety gate 用的探测器 —— **与内核注入的是同一个实例**
          //   (RISK_PROBE): 口径一致, 且 D12 的本地词典兜底挂在这个实例上
          //   (远端挂了前置 gate 也能拦住 block).
          riskProbe,
          // WP16: 轮次幂等表 —— 同一会话同一 round_id 重发不重跑 BDI;
          //   断流 (回复没发完) 的那一轮重发时回 turn_incomplete, 让前端走新一轮.
          idempotency,
        }),
      // 帧出口注册表由 voice 侧的 @Global 模块提供; optional = 缺了只影响督导提示帧.
      // 剧本解析端口同理: optional = 缺了只影响伦理盲盒剧本, 不影响会话开合.
      // 收尾服务同理: optional = 缺了只影响逐字稿定稿 + 长时记忆, 不影响会话开合.
      // 风险审计插槽同理: optional = 缺了只影响风险事件留痕, 不影响弹窗与阻断.
      inject: [
        EngineTurnService,
        CHARACTER_PROFILE_RESOLVER,
        { token: VoiceFrameRegistry, optional: true },
        { token: TRAJECTORY_SCRIPT_RESOLVER, optional: true },
        { token: SessionCloseoutService, optional: true },
        TraceRecorder,
        ConfigService,
        STUDENT_RISK_GATE,
        { token: StudentRiskAuditRegistry, optional: true },
        RISK_PROBE,
        TurnIdempotencyService,
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
