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

import type { Embedder, EngineSessionPort, MemoryStore, RenderPort } from '../../engine-core';
import { InMemoryBdiStateRepository } from '../../engine-core/in-memory/in-memory-bdi-state.repository';
import { InMemoryEngineSession } from '../../engine-core/in-memory/in-memory-engine-session';
import { InMemoryMemoryStore } from '../../engine-core/in-memory/in-memory-memory.store';
import type { QdrantMemoryClient } from '../persistence/qdrant-memory.store';
import { QdrantMemoryStore } from '../persistence/qdrant-memory.store';
import type { TurnSessionContext } from '../rendering/turn-render-orchestrator';
import { TurnRenderOrchestrator } from '../rendering/turn-render-orchestrator';

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
 * @returns 内核会话端口
 */
export function createEngineSessionPort(memories: MemoryStore): EngineSessionPort {
  return new InMemoryEngineSession({ bdiStates: new InMemoryBdiStateRepository(), memories });
}

/**
 * 装配门面入参.
 */
export interface EngineOrchestratorDeps {
  /** 内核会话端口. */
  readonly session: EngineSessionPort;
  /** 渲染端口. */
  readonly renderer: RenderPort;
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
