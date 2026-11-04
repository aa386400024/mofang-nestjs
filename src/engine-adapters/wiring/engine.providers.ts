// V2026-10-28 治本 (WP8-A · B 层 · 装配工厂):
//   职责: 把「依赖 → 成品对象」的装配逻辑收敛成**纯工厂函数** —— 记忆仓储 /
//         内核会话 / 装配门面的构造.
//   边界: 纯函数, 零 @nestjs / 零 IO / 零 env 读取; 全部输入都是显式参数.
//
//   为什么工厂要与 @Module 注册分离 (本单最关键的一条治本):
//     `@Module` 里的 useFactory 是**声明式接线**, 可读性确实最好, 但它**测不到** ——
//     要单测它, 就得把整个 Nest 容器拉起来 (AIEngineModule 带着 TypeORM entities、
//     UserModule、LangChain RagService), 于是"装配链对不对"这件事只能等启动时炸,
//     而启动时炸的错误往往已经绕了三层, 极难定位.
//     把构造抽成纯函数后: 模块只负责声明「token ↔ 工厂」的映射, 工厂只负责造对象,
//     两段都能被单测直接覆盖 —— 这是本期"接线正确性"唯一可靠的护栏.
//
//   为什么记忆仓储的**选择**不写死在工厂里:
//     "用向量库还是纯内存"是**部署形态**的决定 (配没配 QDRANT_URL), 不是构造逻辑.
//     所以工厂收一个显式的 qdrantUrl: 有 → 造 QdrantMemoryStore (内置内存回落仓);
//     没有 → 造 InMemoryMemoryStore. 判断与构造都在同一处, 不留第二份真相.
//
//   反双胞胎:
//     - 不在工厂里读 env: env 由调用方 (RenderConfigFactory / useFactory) 读好后传入,
//       工厂保持纯 —— 否则单测必须改 process.env, 且"哪层该读 env"会漂移.
//     - 不在工厂里吞异常: 装配非法 (例如配了向量库却没给客户端) 必须炸到启动期,
//       静默回落成纯内存 = 线上以为在持久化, 实际一条都没存.
//     - 不在工厂里造 BDI 落库仓储: 落库仓储是后续轮的活, 本期固定内存实现,
//       换实现时只改这一处.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp8-wiring.spec.ts 覆盖仓储分流 / 会话构造 / 门面归属缝

import { EngineStreamBackend } from './engine-stream-backend.adapter.js';
import type { EngineTurnService } from './engine-turn.service.js';
import { TurnIdempotencyService } from './turn-idempotency.service.js';
import type { TraceRecorder } from '../../admin-debug/trace-recorder.service.js';
import { InMemoryBdiStateRepository } from '../../engine-core/in-memory/in-memory-bdi-state.repository.js';
import { InMemoryEngineSession } from '../../engine-core/in-memory/in-memory-engine-session.js';
import { InMemoryMemoryStore } from '../../engine-core/in-memory/in-memory-memory.store.js';
import type {
  AllianceConfig,
  DeltaCapConfig,
  DeltaCapObserver,
  Embedder,
  EngineSessionPort,
  MemoryStore,
  PersonalityModulatorConfig,
  RiskProbePort,
  SessionDecayConfig,
  WorkingWindowOverflowEvent,
} from '../../engine-core/index.js';
import type { StudentRiskAuditRegistry } from '../../voice/student-risk-audit-slot.js';
import type { VoiceFrameRegistry } from '../../voice/voice-frame-registry.js';
import type { VoiceSessionBridgeRegistry } from '../../voice/voice-session-bridge.js';
import type { SessionCostPricing } from '../observability/session-cost.js';
import type { MemoryConfig } from '../persistence/memory-config.js';
import type { QdrantMemoryClient } from '../persistence/qdrant-memory.store.js';
import { QdrantMemoryStore } from '../persistence/qdrant-memory.store.js';
import type { RollingSummaryPort } from '../persistence/rolling-session-summary.service.js';
import type { SessionSummaryGenerator, SessionTranscriptSink } from '../persistence/session-closeout.service.js';
import { SessionCloseoutService } from '../persistence/session-closeout.service.js';
import type { StreamingRenderPort } from '../rendering/streaming-render.port.js';
import type { StudentRiskGate } from '../rendering/student-risk-disposal.js';
import type { TurnSessionContext } from '../rendering/turn-render-orchestrator.js';
import { TurnRenderOrchestrator } from '../rendering/turn-render-orchestrator.js';
import type { CharacterProfileResolver } from './character/character-profile.resolver.js';
import { HttpPsyGuardProbe } from './risk/http-psyguard.probe.js';
import { LocalCrisisProbe } from './risk/local-crisis.probe.js';
import { StudentRiskGateService } from './risk/student-risk-gate.js';
import type { TrajectoryScriptResolver } from './trajectory/script-resolver.js';

/**
 * 记忆仓储装配入参.
 */
export interface EngineMemoryStoreDeps {
  /** 向量库地址 (缺省 / 空白 = 纯内存仓储). */
  readonly qdrantUrl?: string;
  /** 向量库窄面客户端 (仅在配了向量库时必需). */
  readonly qdrant?: QdrantMemoryClient;
  /** 向量化端口 (仅在配了向量库时必需). */
  readonly embedder?: Embedder;
  /**
   * 衰减/召回配置 (WP12; 缺省 = 内核同值种子 30 天 / 0.1).
   *
   * 只对 Qdrant 版有意义 —— 纯内存版的召回判定在内核里, 走的是内核那一份常量.
   */
  readonly config?: MemoryConfig;
}

/**
 * 装配记忆仓储.
 *
 * 分流依据只有一个: **配没配向量库**. 配了就用 Qdrant 版 (其内置内存回落仓兜住
 * "向量库不可达"), 没配就用纯内存版 (WORKING / SHORT_TERM 本就不该向量化的内容,
 * 纯内存足够, 且省掉一次网络往返).
 *
 * @param deps 装配入参
 * @returns 记忆仓储 (内核端口实现)
 * @throws 配了向量库却缺客户端 / 向量化端口时抛错 (装配非法必须炸在启动期)
 */
export function createEngineMemoryStore(deps: EngineMemoryStoreDeps): MemoryStore {
  const fallback = new InMemoryMemoryStore();
  if (!deps.qdrantUrl) return fallback;
  if (!deps.qdrant || !deps.embedder) {
    throw new Error('引擎记忆仓储装配非法: 已配置向量库地址, 但缺少向量库客户端或向量化端口');
  }
  return new QdrantMemoryStore({
    qdrant: deps.qdrant,
    embedder: deps.embedder,
    fallback,
    ...(deps.config ? { config: deps.config } : {}),
  });
}

/**
 * 内核会话的调参依赖 (WP26 · P2-14 · WP34 · WP42 · WP36).
 *
 * 单回合 delta cap 的配置与观察者、人格调节系数、同盟三维系数与门槛、跨会话间隔衰减
 * 半衰期都是**注入**进来的 —— 内核不读 env、不持有全局槽.
 * 缺省 = 内核种子值 + 不观测 (行为与 WP15 之前逐字一致).
 */
export interface EngineSessionTuningDeps {
  /** 单回合 delta cap 配置 (缺省 = 内核种子值). */
  readonly capConfig?: DeltaCapConfig;
  /** cap 报告观察者 (缺省 = 不观测). */
  readonly capObserver?: DeltaCapObserver;
  /**
   * 人格调节配置 (WP34; 缺省 = 内核种子值).
   *
   * 与 cap 同款范式: 系数是**部署形态**的决定 (内测期按真实对练校准), 不是会话参数.
   */
  readonly personalityModulatorConfig?: PersonalityModulatorConfig;
  /**
   * 同盟三维配置 (WP42; 缺省 = 内核种子值).
   *
   * 与 cap 同款范式: 同盟三维的系数与门槛是**部署形态**的决定, 不是会话参数.
   */
  readonly allianceConfig?: AllianceConfig;
  /**
   * 跨会话间隔衰减配置 (WP36; 缺省 = 内核种子值).
   *
   * 与 cap 同款范式: 半衰期是**部署形态**的决定 (内测期按真实对练校准), 不是会话参数.
   */
  readonly sessionDecayConfig?: SessionDecayConfig;
  /**
   * 工作窗口溢出回调 (WP37; 缺省 = 不做滚动摘要).
   *
   * 与 cap 同款范式: 这是**内核 → 适配层**的通知口, 缺省 = 内核只裁窗口不通知.
   */
  readonly onWorkingWindowOverflow?: (event: WorkingWindowOverflowEvent) => void;
}

/**
 * 装配内核会话端口.
 *
 * BDI 状态本期用内存仓储 (落库仓储属后续轮); 记忆仓储与门面包的是**同一实例** ——
 * 内核写的咨询师半边与门面补的来访半边必须落在同一个仓里, 否则召回只召回得到一半.
 *
 * @param memories 记忆仓储 (与门面共用)
 * @param riskProbe 可选风险探测端口 (WP4 扩展点; 缺省 = 纯规则判定)
 * @param tuning 可选调参依赖 (WP26 · P2-14 cap 配置与观察者; WP34 人格调节系数)
 * @returns 内核会话端口
 */
export function createEngineSessionPort(
  memories: MemoryStore,
  riskProbe?: RiskProbePort,
  tuning?: EngineSessionTuningDeps,
): EngineSessionPort {
  return new InMemoryEngineSession({
    bdiStates: new InMemoryBdiStateRepository(),
    memories,
    ...(riskProbe ? { riskProbe } : {}),
    ...(tuning?.capConfig ? { capConfig: tuning.capConfig } : {}),
    ...(tuning?.capObserver ? { capObserver: tuning.capObserver } : {}),
    ...(tuning?.personalityModulatorConfig ? { personalityModulatorConfig: tuning.personalityModulatorConfig } : {}),
    ...(tuning?.allianceConfig ? { allianceConfig: tuning.allianceConfig } : {}),
    ...(tuning?.sessionDecayConfig ? { sessionDecayConfig: tuning.sessionDecayConfig } : {}),
    ...(tuning?.onWorkingWindowOverflow ? { onWorkingWindowOverflow: tuning.onWorkingWindowOverflow } : {}),
  });
}

/**
 * 装配门面入参.
 */
export interface EngineOrchestratorDeps {
  /** 内核会话端口. */
  readonly session: EngineSessionPort;
  /** 渲染端口 (支持流式扩展; 未实现流式时门面走聚合兜底). */
  readonly renderer: StreamingRenderPort;
  /** 记忆仓储 (与内核同一实例). */
  readonly memories: MemoryStore;
  /** 归属解析源 (装配层维护的登记表). */
  readonly registry: { resolve(handleId: string): TurnSessionContext | undefined };
  /**
   * 学员侧处置闸门 (WP14; 缺省 = 不做学员侧处置).
   *
   * 缺省语义与上面几个一致: 闸门是**增强** —— 装配缺席时本场照常,
   * 只是"没有危机处置" (与本单之前逐字一致), 不影响会话开合.
   */
  readonly studentRisk?: StudentRiskGate;
  /**
   * 滚动摘要读取口 (WP37; 缺省 = 本场不注入摘要).
   *
   * 缺省语义: **纯增强** —— 装配缺席时只是"长对话超过 8 轮后模型不记得前面聊过什么",
   * 不影响会话开合, 也不影响既有轮次的渲染.
   */
  readonly rollingSummary?: RollingSummaryPort;
}

/**
 * 装配决策→说话门面 (WP7).
 *
 * 归属用**解析函数**而不是固定归属: 本期是多会话 (调试端点能同时开多场),
 * 固定归属等于把"这场会话是谁"写死在一处, 多场会话立刻串场.
 * 解析函数优先于固定归属 (WP7 既有口径), 所以这里只传解析函数, 不传 sessionContext.
 *
 * @param deps 装配入参
 * @returns 装配门面
 */
export function createEngineOrchestrator(deps: EngineOrchestratorDeps): TurnRenderOrchestrator {
  return new TurnRenderOrchestrator({
    session: deps.session,
    renderer: deps.renderer,
    memories: deps.memories,
    resolveSession: (handleId: string) => deps.registry.resolve(handleId),
    ...(deps.studentRisk ? { studentRisk: deps.studentRisk } : {}),
    ...(deps.rollingSummary ? { rollingSummary: deps.rollingSummary } : {}),
  });
}

/**
 * 学员侧处置闸门装配入参 (WP14).
 */
export interface StudentRiskGateDeps {
  /** PsyGUARD 服务地址 (空 / 缺省 = 不强制远端探测, 只靠内核判定). */
  readonly baseUrl?: string;
  /** HTTP 探测超时 (ms; 缺省 = 内核 DEFAULT_PROBE_TIMEOUT_MS). */
  readonly timeoutMs?: number;
}

/**
 * 装配学员侧处置闸门 (WP14 §1.6).
 *
 * 闸门里的远端探测器是**独立实例**且**不带本地词典兜底**:
 *   · 独立实例 = 不跟内核那次判定共用同一个探测器对象 (免得状态互相污染);
 *   · 不带兜底 = "强制走 PsyGUARD"问的必须是**远端**; 本地词典兜底已经在主链路上
 *     (D12 治本), 再挂一遍就是同一段文本判两遍.
 *
 * 没配 `PSYGUARD_BASE_URL` → 闸门**不带探测器** → 强制探测直接返回 undefined,
 * 行为退化成"只靠内核判定" (不报错, 不阻断).
 *
 * @param deps 装配入参
 * @returns 闸门实例
 */
export function createStudentRiskGate(deps: StudentRiskGateDeps): StudentRiskGateService {
  const baseUrl = (deps.baseUrl ?? '').trim();
  if (!baseUrl) return new StudentRiskGateService();
  return new StudentRiskGateService(
    new HttpPsyGuardProbe({
      baseUrl,
      ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }),
    }),
  );
}

/**
 * 装配引擎版对话后端入参.
 */
export interface EngineStreamBackendDeps {
  /** 引擎门面 (open / turn / close). */
  readonly engine: EngineTurnService;
  /** 角色解析端口 (缺省 = 无角色 = 中性基线). */
  readonly resolver?: CharacterProfileResolver;
  /** WS 帧出口注册表 (缺省 = 推不了督导提示帧, 不影响对话). */
  readonly frames?: VoiceFrameRegistry;
  /**
   * 轨迹剧本解析端口 (WP10; 缺省 = 无剧本 = BDI 自由运行).
   *
   * 与角色解析端口**同款语义**: 可选增强, 装配缺席 ≠ 会话开不起来.
   */
  readonly scriptResolver?: TrajectoryScriptResolver;
  /**
   * 会话收尾服务 (WP12; 缺省 = 不做逐字稿定稿 + 不晋升长时记忆).
   *
   * 与上面两个端口**同款语义**: 收尾是增强, 装配缺席 ≠ 会话开不起来.
   */
  readonly closeout?: SessionCloseoutService;
  /**
   * 成本单价 (WP24; 缺省 = 用 `DEFAULT_SESSION_COST_PRICING`).
   *
   * 缺省语义与上面几个一致: 单价配错/没配 → 只是成本数字用默认值,
   * **不能**让"没配单价"变成"开不了会话".
   */
  readonly pricing?: SessionCostPricing;
  /**
   * 调试快照记录器 (WP19-R; 缺省 = 不留痕).
   *
   * 缺省语义与上面几个一致: 没装配记录器 → 只是没有调试快照落库,
   * **不能**让"没有调试器"变成"开不了会话".
   *
   * V2026-10-30 治本 (WP19-R): 本参数**曾经恒为 undefined** —— 工厂第 6 位
   * 一直占着 undefined, 而 `recordTrace()` 首行守卫直接 return, 于是
   * "每轮 BDI 快照落库"一次都没发生过 (turn_debug_trace 恒空).
   * 现在由 `EngineWiringModule` 显式注入 `AdminDebugModule` 导出的实例.
   */
  readonly traceRecorder?: TraceRecorder;
  /**
   * 学员侧处置闸门 (WP14; 缺省 = 不做学员侧处置).
   *
   * 缺省语义与上面几个一致: 闸门是**增强** —— 装配缺席时本场照常,
   * 只是"没有危机处置" (与本单之前逐字一致), 不影响会话开合.
   */
  readonly studentRiskGate?: StudentRiskGate;
  /**
   * 学员风险审计插槽 (WP14; 缺省 = 风险事件不留痕).
   *
   * 缺省语义同上: 审计是**留痕能力**, 不是会话能力 ——
   * 业务侧没注册实现时, 弹窗照弹, 只是"这次没留痕".
   */
  readonly riskAudit?: StudentRiskAuditRegistry;
  /**
   * 风险探测器 (WP14 优化项 · 前置 safety gate; 缺省 = 不做前置判定).
   *
   * 缺省语义同上: 前置判定是**增强** —— 装配缺席时本场照常,
   * 只是"阻断轮会先转一下 loading 圈" (与优化项之前逐字一致).
   *
   * 必须是**内核注入的那一个实例** (RISK_PROBE): 口径一致 + D12 本地词典兜底生效.
   */
  readonly riskProbe?: RiskProbePort;
  /**
   * 轮次幂等表 (WP16; 缺省 = 后端自建一个).
   *
   * 缺省语义与上面几个一致: 幂等是**增强** —— 缺席时对练照常,
   * 只是"重发同一轮不再幂等" (老客户端不带 round_id 时本来就用不上它).
   */
  readonly idempotency?: TurnIdempotencyService;
}

/**
 * 会话收尾装配入参 (WP12).
 */
export interface SessionCloseoutDeps {
  /** 记忆仓储 (内核端口; 摘要晋升写这里). */
  readonly memories: MemoryStore;
  /** 摘要生成器 (缺省 = 不做摘要晋升). */
  readonly generator?: SessionSummaryGenerator;
  /** 逐字稿落库口 (缺省 = 不做逐字稿定稿). */
  readonly sink?: SessionTranscriptSink;
  /**
   * 最终摘要的重要度 (WP37 · 缺省 = 代码里的种子值 0.9).
   *
   * 只做**透传**: 摘要怎么写、怎么晋升是收尾服务的职责, 装配层只负责把配置递过去.
   */
  readonly summaryImportance?: number;
}

/**
 * 装配会话收尾服务 (WP12).
 *
 * 收尾是**增强**: 装配缺席时, 会话照常结束, 只是"逐字稿没定稿" + "没有长时记忆".
 * 摘要生成/晋升失败**不阻断**收尾 (任务单 §1.2) —— 失败语义在收尾服务内部.
 *
 * @param deps 装配入参
 * @returns 会话收尾服务
 */
export function createSessionCloseout(deps: SessionCloseoutDeps): SessionCloseoutService {
  return new SessionCloseoutService(deps);
}

/**
 * 装配逐字稿落库口 (WP12).
 *
 * 走**业务侧的落库桥插槽** (`VoiceSessionBridgeRegistry`) —— 与仓库既有的
 * "voice → business" 依赖倒置同款: 引擎层只声明"我要把逐字稿存下去",
 * 真正写 `training_sessions.transcript` 的是 counselor 侧的桥实现.
 * 这样 engine-adapters 不认识 ORM, 也不认识 counselor 的任何类型.
 *
 * @param registry voice 侧落库桥注册表 (@Global)
 * @returns 逐字稿落库口
 */
export function createBridgeTranscriptSink(registry: VoiceSessionBridgeRegistry): SessionTranscriptSink {
  return {
    saveTranscript: async (input) => {
      const written = await registry.replaceTranscript({
        dbSessionId: input.dbSessionId,
        ...(input.userId ? { userId: input.userId } : {}),
        turns: input.turns,
      });
      if (!written) {
        // 没有桥实现覆盖写 (老实现 / 未注册业务侧) → 明确报错.
        // 任务单 §1.4: "不落库就报错" —— 静默跳过 = 落库边界留模糊.
        throw new Error(`逐字稿定稿失败: 没有可用的落库桥 db_session=${input.dbSessionId}`);
      }
    },
  };
}

/**
 * 风险探测装配入参.
 */
export interface RiskProbeDeps {
  /** PsyGUARD 服务地址 (空 / 缺省 = 不用 HTTP 探测, 走本地规则). */
  readonly baseUrl?: string;
  /** HTTP 探测超时 (ms; 缺省 = 内核 DEFAULT_PROBE_TIMEOUT_MS). */
  readonly timeoutMs?: number;
  /** 本地规则探测器 (回落用; 缺省 = 新建一个 LocalCrisisProbe). */
  readonly fallback?: RiskProbePort;
}

/**
 * 是否启用了 PsyGUARD 服务 (分流依据的**唯一**真相).
 *
 * 为什么单独抽出来: 分流这条规则现在被**两个**装配点用到 ——
 * 咨询师输入侧 (`RISK_PROBE`) 与来访输出侧 (`createVisitorOutputProbe`).
 * 两处各写一遍 `(baseUrl ?? '').trim()` 判空, 迟早有一处先改、另一处后改,
 * 于是"配没配服务"在两侧口径不一致 —— 这种不一致只在运行时才炸.
 *
 * @param baseUrl env 里的服务地址 (可能 undefined / 空白)
 * @returns 配了地址则 true
 */
export function isPsyGuardConfigured(baseUrl: string | undefined): boolean {
  return (baseUrl ?? '').trim().length > 0;
}

/**
 * 装配风险探测端口 (WP11).
 *
 * **分流依据只有一个: 配没配服务地址**:
 *   配了 → `HttpPsyGuardProbe` (打独立仓库的 PsyGUARD Python 服务);
 *   没配 → `LocalCrisisProbe` (本地规则, 行为与 WP9-C 逐字一致).
 *
 * **两者不叠加**: 一个 session 只用一个探测端口. 叠加意味着同一条文本判两遍,
 * 等级取高 —— 那会让"服务偶发误报"直接变成"永远按高危走", 且双倍延迟.
 *
 * V2026-11-02 (WP14 §1.4 · D12 治本): 配了地址时, 本地词典**不再被丢弃** ——
 * 它被**委托**给 HTTP 探测器当兜底 (远端失败才换它判), 而不是跟远端**叠加**判.
 * "不叠加"的口径不变: 同一时刻只有一个探测器在判.
 *
 * 为什么做成**纯函数**而不是写在 `@Module` 的 useFactory 里:
 *   同本文件其它工厂的理由 —— useFactory 里的代码单测覆盖不到, "装哪个探测器"
 *   这件事就只能等启动时炸. 纯函数能直接断言分流口径.
 *
 * @param deps 装配入参
 * @returns 风险探测端口实现
 */
export function createRiskProbe(deps: RiskProbeDeps): RiskProbePort {
  const fallback = deps.fallback ?? new LocalCrisisProbe();
  const baseUrl = (deps.baseUrl ?? '').trim();
  if (!baseUrl) return fallback;
  // V2026-11-02 治本 (WP14 §1.4 · D12 治本): **不再丢弃 fallback** ——
  //   配了服务地址就把本地词典扔掉, 等于"服务一挂 = 学员危机检测归零"
  //   (内核 catch 后回落的是 `counselor_input` 侧的规则层, 那 7 条全是专业越界词,
  //    一条危机词都没有). 现在把本地词典**委托**给 HTTP 探测器做兜底:
  //   服务正常 → 远端判定; 服务异常 → 本地词典判定 (源记 `local_dict`).
  //
  //   注意"委托"与"叠加"的区别 (WP11 的既有取舍仍然成立):
  //     · 委托 = **同一时刻只有一个探测器在判** (远端失败才换本地), 不双判、不双倍延迟;
  //     · 叠加 = 同一段文本判两遍取最高 —— 那会让"远端偶发误报"变成"永远按高危走".
  //   本单要的是前者.
  return new HttpPsyGuardProbe({
    baseUrl,
    fallback,
    ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }),
  });
}

/**
 * 装配**来访输出侧**的探测端口 (WP11 审核后决策 #3).
 *
 * 为什么要单列一个工厂, 而不是直接复用 `RISK_PROBE` 那个端口:
 *   两侧的**误报代价不对称**.
 *   - 咨询师输入侧 (`counselor_input`): 文本是**咨询师(user)说的话** ——
 *     危机词在这里是真信号, 本地词典 (`LocalCrisisProbe`) 是对味的.
 *   - 来访输出侧 (`visitor_output`): 文本是**AI 扮演的来访者/学员角色的台词** ——
 *     在这个产品里, 角色**本来就要**说痛苦的话 (那就是训练素材).
 *     而 `LocalCrisisProbe` 的补充词表 (`我想死` / `死了算了` / `我要结束自己` …)
 *     是按**咨询师输入面**收的, 类别映射到 high → **block**;
 *     内核来访侧词典恰恰**没收**这些词 (只有 `我要自杀` / `我要去死` 那几条).
 *     所以把它接到输出侧 = AI 角色说一句"我想死"就被判 block →
 *     聚合路径重生成 → 仍 block → **降级成通用兜底句** → **训练场景被换掉**.
 *   而 PsyGUARD 正是**在来访者话语上训练**的 (论文语料: 微博/知乎/壹心理的用户表达),
 *   它判的是"这句话本身有没有风险", 与"这是不是角色台词"无关 —— 这才是该侧该用的探测器.
 *
 * 所以口径是:
 *   配了 `PSYGUARD_BASE_URL` → 输出侧接 **PsyGUARD 探测器**;
 *   没配                     → 输出侧**不接探测** (维持现状: 只有内核规则层).
 *
 * 没配时维持现状还有一个好处: WP11 承诺过"没配 env → 行为逐字一致",
 * 这条承诺在输出侧也保住了 (否则本工厂会把"本地词典"偷偷扩散到输出侧).
 *
 * 超时: **两条路径, 都要是 150** (WP28 回改时发现旧注释这里写错了):
 *   装配层 `engine.module.ts` 是**显式传** `resolvePsyGuardTimeoutMs(env)` 的 ——
 *   env (`PSYGUARD_TIMEOUT_MS`) 没设时才回落内核 `DEFAULT_PROBE_TIMEOUT_MS`.
 *   也就是说输出侧**不是**"只有一个回改点": 改内核常量**不会**覆盖掉 env 上
 *   显式配的值 (WP25 审查 D34 的实锤). 两边都是 150 时口径才自洽 ——
 *   否则会出现"内核等 150ms、HTTP 还在等 500ms"这种自相矛盾.
 *
 * @param deps 装配入参
 * @returns 探测器; 没配服务地址 → undefined (该侧不接探测)
 */
export function createVisitorOutputProbe(deps: RiskProbeDeps): RiskProbePort | undefined {
  if (!isPsyGuardConfigured(deps.baseUrl)) return undefined;
  const baseUrl = (deps.baseUrl ?? '').trim();
  return new HttpPsyGuardProbe({
    baseUrl,
    ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }),
  });
}

/**
 * 装配引擎版对话后端 (voice 侧窄接口实现).
 *
 * **为什么必须走工厂, 不能把它当类 provider 直接注册** (WP8-B 遗留的启动炸弹):
 *   `engine-stream-backend.adapter.ts` 里 `EngineTurnService` 是 **type-only 导入**
 *   (`import type { EngineTurnService }`). TypeScript 的 `emitDecoratorMetadata`
 *   遇到 type-only 导入的类类型时**产不出值引用**, 只能降级成 `Function` ——
 *   于是编译产物是 `design:paramtypes = [Function, Object]`.
 *   而 Nest 正是靠 `design:paramtypes` 决定构造参数要注入什么: 它会去容器里找一个
 *   token 叫 `Function` 的 provider —— **不存在** → 启动直接抛
 *   `UnknownDependenciesException: Nest can't resolve dependencies of the
 *   EngineStreamBackend ... the argument Function at index [0]`.
 *   也就是说: 只要把 EngineStreamBackend 当**类 provider** 注册, 应用就起不来.
 *   (WP8-B 起就是这个写法, 一直没被抓到 —— WP8-A/8-B 的闸门只跑 tsc/eslint/jest,
 *   **从没真起过服务**.)
 *   走工厂后 Nest 完全不读它的 `design:paramtypes` (工厂的 inject 是显式给的),
 *   这颗雷被拆掉, 而且**不用改 adapter 一行** (注入点保持零改动).
 *
 * @param deps 装配入参
 * @returns 引擎版对话后端
 */
export function createEngineStreamBackend(deps: EngineStreamBackendDeps): EngineStreamBackend {
  // 位置参数顺序与 adapter 的构造参数一一对应:
  //   engine / resolver / frames / scriptResolver / closeout / traceRecorder / costPricing
  //   / studentRiskGate / riskAudit / riskProbe
  //
  // V2026-10-30 治本 (WP19-R): 第 6 位**不再是恒 undefined 的占位** ——
  //   traceRecorder 由 EngineWiringModule 注入 (AdminDebugModule 导出),
  //   装配后每轮 turn 结束真正落库 (见 `EngineStreamBackend.recordTrace`).
  //
  // V2026-11-02 治本 (WP14): 第 8/9 位是学员侧处置闸门 + 风险审计插槽.
  // V2026-11-02 治本 (WP14 优化项): 第 10 位是风险探测器 —— 前置 safety gate
  //   委托它判一次 (与内核注入的是**同一个**实例, 口径与本地词典兜底都一致).
  // V2026-11-02 治本 (WP16): 第 11 位是轮次幂等表 —— 同一会话同一 round_id
  //   重发不重跑 BDI (断流重发则回 turn_incomplete).
  return new EngineStreamBackend(
    deps.engine,
    deps.resolver,
    deps.frames,
    deps.scriptResolver,
    deps.closeout,
    deps.traceRecorder,
    deps.pricing,
    deps.studentRiskGate,
    deps.riskAudit,
    deps.riskProbe,
    deps.idempotency ?? new TurnIdempotencyService(),
  );
}
