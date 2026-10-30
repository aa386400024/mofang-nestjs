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

import type { Embedder, EngineSessionPort, MemoryStore, RiskProbePort } from '../../engine-core';
import { InMemoryBdiStateRepository } from '../../engine-core/in-memory/in-memory-bdi-state.repository';
import { InMemoryEngineSession } from '../../engine-core/in-memory/in-memory-engine-session';
import { InMemoryMemoryStore } from '../../engine-core/in-memory/in-memory-memory.store';
import type { QdrantMemoryClient } from '../persistence/qdrant-memory.store';
import { QdrantMemoryStore } from '../persistence/qdrant-memory.store';
import type { StreamingRenderPort } from '../rendering/streaming-render.port';
import type { TurnSessionContext } from '../rendering/turn-render-orchestrator';
import { TurnRenderOrchestrator } from '../rendering/turn-render-orchestrator';
import type { CharacterProfileResolver } from './character/character-profile.resolver';
import { EngineStreamBackend } from './engine-stream-backend.adapter';
import type { EngineTurnService } from './engine-turn.service';
import { HttpPsyGuardProbe } from './risk/http-psyguard.probe';
import { LocalCrisisProbe } from './risk/local-crisis.probe';
import type { TrajectoryScriptResolver } from './trajectory/script-resolver';
import type { VoiceFrameRegistry } from '../../voice/voice-frame-registry';

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
  return new QdrantMemoryStore({ qdrant: deps.qdrant, embedder: deps.embedder, fallback });
}

/**
 * 装配内核会话端口.
 *
 * BDI 状态本期用内存仓储 (落库仓储属后续轮); 记忆仓储与门面包的是**同一实例** ——
 * 内核写的咨询师半边与门面补的来访半边必须落在同一个仓里, 否则召回只召回得到一半.
 *
 * @param memories 记忆仓储 (与门面共用)
 * @param riskProbe 可选风险探测端口 (WP4 扩展点; 缺省 = 纯规则判定)
 * @returns 内核会话端口
 */
export function createEngineSessionPort(memories: MemoryStore, riskProbe?: RiskProbePort): EngineSessionPort {
  return new InMemoryEngineSession({
    bdiStates: new InMemoryBdiStateRepository(),
    memories,
    ...(riskProbe ? { riskProbe } : {}),
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
  });
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
  return new HttpPsyGuardProbe({
    baseUrl,
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
 * 超时: **不显式传** —— 让它继承内核 `DEFAULT_PROBE_TIMEOUT_MS`.
 * 这样 M3 内测把那个常量改回 150 时, 输出侧**自动跟着回**, 只有一个回改点.
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
  return new EngineStreamBackend(deps.engine, deps.resolver, deps.frames, deps.scriptResolver);
}
