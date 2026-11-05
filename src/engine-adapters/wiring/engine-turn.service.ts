// V2026-10-28 治本 (WP8-A · B 层 · 会话归属登记表 + 引擎门面服务):
//   职责: ① `EngineSessionRegistry`: 维护 handleId → 会话归属 的进程内登记表;
//         ② `EngineTurnService`: 对外封装 open → turn → close 生命周期.
//   边界: 只做编排与登记; 不做决策、不拼 prompt、不组装 RenderSpec.
//
//   为什么归属要单独一张表 (而不是从内核反查):
//     内核会话端口只有 openSession / turn / closeSession 三个方法 —— **没有**
//     "由句柄反查 tenant/visitor"的能力, 这是刻意的: 句柄是**运行时**维度
//     (进程内实例标识), 归属是**业务**维度 (谁是来访者、属于哪个租户), 内核
//     只在 openSession 时拿到一次. 所以归属必须由**装配层**在 open 时登记,
//     再通过 WP7 预留的 `resolveSession` 缝喂回门面.
//
//   为什么登记表单独一个类 (而不是塞进 EngineTurnService):
//     依赖方向: 门面服务依赖编排器, 编排器依赖"归属查询函数", 而那个函数要查的
//     就是这张表. 若表在门面服务里, 就是 门面 → 编排器 → 门面 的**循环依赖**.
//     独立出来后: 编排器与门面都只依赖登记表, 无环.
//
//   反双胞胎:
//     - 不用 handleId 当 sessionId: 两者是不同概念 (运行时 vs 业务), 混用会让
//       "同一业务会话在两个进程实例里各开一场" 这种串场问题无从发现.
//     - 不用全局单例表: 登记表是**模块内单例**, 跟引擎会话实例同生命周期.
//     - 不在 close 里吞异常: 清理放 finally, 保证内核 close 抛错时归属表
//       也不会残留 (残留 = 内存泄漏 + 下次同 handleId 复用到错的归属).
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp8-wiring.spec.ts 覆盖登记/解析/清理与错误冒泡

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { ENGINE_SESSION_PORT, ROLLING_SUMMARY_CLEANUP } from './engine.tokens.js';
import type { EngineSessionPort, EngineTurnInput, OpenEngineSessionInput } from '../../engine-core/index.js';
import type { RollingSummaryCleanupPort } from '../persistence/rolling-session-summary.service.js';
import type { StreamRenderHandlers } from '../rendering/streaming-render.port.js';
import type { TurnRenderResult, TurnSessionContext } from '../rendering/turn-render-orchestrator.js';
import { TurnRenderOrchestrator } from '../rendering/turn-render-orchestrator.js';

/**
 * 会话归属登记表 (handleId → tenant/visitor/session).
 *
 * 进程内瞬时: 进程重启即失效 (与内核会话句柄同生命周期 —— 句柄没了, 归属也没意义).
 */
@Injectable()
export class EngineSessionRegistry {
  private readonly contexts = new Map<string, TurnSessionContext>();

  /**
   * 登记一场会话的归属.
   *
   * @param handleId 内核会话句柄
   * @param context 会话归属
   */
  register(handleId: string, context: TurnSessionContext): void {
    this.contexts.set(handleId, context);
  }

  /**
   * 解析归属 (查不到 → undefined, 调用方按"跳过一次写入"处理, 不抛错).
   *
   * @param handleId 内核会话句柄
   * @returns 会话归属
   */
  resolve(handleId: string): TurnSessionContext | undefined {
    return this.contexts.get(handleId);
  }

  /**
   * 移除归属 (会话关闭时调用).
   *
   * @param handleId 内核会话句柄
   */
  remove(handleId: string): void {
    this.contexts.delete(handleId);
  }

  /** 当前登记数 (观测用). */
  size(): number {
    return this.contexts.size;
  }
}

/**
 * 引擎门面服务: open → turn → close 生命周期.
 */
@Injectable()
export class EngineTurnService {
  private readonly logger = new Logger(EngineTurnService.name);

  constructor(
    @Inject(ENGINE_SESSION_PORT) private readonly session: EngineSessionPort,
    private readonly orchestrator: TurnRenderOrchestrator,
    private readonly registry: EngineSessionRegistry,
    /**
     * 滚动摘要服务 (WP55 · 修 WP37 遗留的会话状态泄漏).
     *
     * 门面的 `histories` 与滚动摘要服务的 `states` 都是**按会话**的长生命周期状态:
     * 会话关掉了, 两者都得释放 —— 否则每场会话的待压队列与摘要都留在内存里.
     *
     * 为什么用**显式 token** (`ROLLING_SUMMARY_CLEANUP`) 而不是直接靠类型注入:
     *   `RollingSummaryCleanupPort` 是 interface, 编译后没有运行时值 ——
     *   不给显式 token, Nest 只会去找一个叫 `Object` 的 provider, 找不到就静默
     *   注入 undefined (会话关掉了但状态不释放 = 泄漏还在). 详见 engine.tokens.ts.
     *
     * 用 `@Optional()`: 摘要服务是**增强**, 装配缺席时只是"没有滚动摘要",
     * 不能让整个引擎门面开不起来 (与仓库里 LlmRouterService 的做法同理).
     */
    @Optional() @Inject(ROLLING_SUMMARY_CLEANUP) private readonly rollingSummary?: RollingSummaryCleanupPort,
  ) {}

  /**
   * 开会话: 内核 openSession + 登记归属.
   *
   * 重复 `sessionId` 已开 → 内核抛 `SESSION_ALREADY_OPEN` **原样冒泡**,
   * 本层不静默复用旧句柄 (静默复用会让调用方以为开了一场新会话, 实际接的是旧状态).
   *
   * @param input 开场参数
   * @param options 装配层附加信息 (角色代号; 仅供 dev 调试日志核对 prompt 拼装 /
   *   表达风格三字段 (WP41): 角色"天生怎么说话" —— 登记进归属, 渲染层每轮从这里读)
   * @returns 会话句柄 id + 业务会话 id
   */
  open(
    input: OpenEngineSessionInput,
    options?: {
      readonly characterLabel?: string;
      readonly speechVolumeBaseline?: number;
      readonly narrativeStyle?: TurnSessionContext['narrativeStyle'];
      readonly expressionTone?: TurnSessionContext['expressionTone'];
      /**
       * 学员账号 id (V2026-11-05 WP64).
       *
       * 用途: LLM 审议的计费 / 审计归属 —— 归属登记后, 旁路审议才知道该把这次调用记在谁头上.
       */
      readonly userId?: string;
      /**
       * 角色种子简述 (依恋风格 + 大五人格) (V2026-11-05 WP64).
       *
       * 用途: 审议 prompt 的「角色背景」块.
       */
      readonly characterBrief?: string;
    },
  ): { readonly handleId: string; readonly sessionId: string } {
    const handle = this.session.openSession(input);
    this.registry.register(handle.handleId, {
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      visitorId: input.visitorId,
      ...(options?.characterLabel ? { characterLabel: options.characterLabel } : {}),
      // WP41: 表达风格三字段 —— 条件展开: 装配层没给就不登记, 渲染层分得清
      //   "这个角色没表态"与"这个角色话量基线是空" (零回归: 没登记 = prompt 逐字不变).
      ...(options?.speechVolumeBaseline === undefined ? {} : { speechVolumeBaseline: options.speechVolumeBaseline }),
      ...(options?.narrativeStyle === undefined ? {} : { narrativeStyle: options.narrativeStyle }),
      ...(options?.expressionTone === undefined ? {} : { expressionTone: options.expressionTone }),
      // WP64: 学员账号 + 角色简述 —— 条件展开 (缺省 = 旁路审议跳过这一轮, 不影响会话).
      ...(options?.userId ? { userId: options.userId } : {}),
      ...(options?.characterBrief ? { characterBrief: options.characterBrief } : {}),
    });
    this.logger.log(`引擎会话已开启 handle=${handle.handleId} session=${input.sessionId}`);
    return { handleId: handle.handleId, sessionId: handle.sessionId };
  }

  /**
   * 一轮: 委托编排器 (内核决策 → 组装 → 渲染 → 回填 reply → 成对记忆).
   *
   * 内核错误 (ABORTED / INVALID_INPUT / SESSION_NOT_FOUND / STATE_CONFLICT)
   * **原样冒泡**, 本层只兜渲染层 (渲染异常/空文本由编排器降级为兜底句).
   *
   * @param handleId 内核会话句柄
   * @param input 本轮入参
   * @returns 本轮来访口语 + 内核出参 + 渲染元信息
   */
  async turn(handleId: string, input: EngineTurnInput): Promise<TurnRenderResult> {
    return this.orchestrator.turn(handleId, input);
  }

  /**
   * 一轮 (**流式**): 委托编排器的流式出口.
   *
   * 与聚合 `turn()` 共用同一套闭环 (内核决策 / 规格组装 / 落账), 只换"取文方式".
   * 消费方 (voice) 拿到的是与聚合同构的 `TurnRenderResult`, 多一个 delta 回调面.
   *
   * @param handleId 内核会话句柄
   * @param input 本轮入参
   * @param handlers 增量回调面 (onDelta / signal)
   * @returns 本轮来访口语 + 内核出参 + 渲染元信息
   */
  async turnStream(handleId: string, input: EngineTurnInput, handlers: StreamRenderHandlers): Promise<TurnRenderResult> {
    return this.orchestrator.turnStream(handleId, input, handlers);
  }

  /**
   * 关会话: 清门面历史 → 关内核句柄 (幂等) → 清归属.
   *
   * 清理放 `finally`: 内核 close 抛错时归属表也不能残留.
   *
   * WP55: 归属要在清理**之前**取 (清完就查不到了), 用来释放滚动摘要的会话状态.
   *
   * @param handleId 内核会话句柄
   */
  close(handleId: string): void {
    // 先取归属: 归属表在 finally 里被清掉, 之后就查不到了.
    const context = this.registry.resolve(handleId);
    try {
      this.orchestrator.forgetSession(handleId);
      this.session.closeSession(handleId);
      this.logger.log(`引擎会话已关闭 handle=${handleId}`);
    } finally {
      this.forgetRollingSummary(handleId, context);
      this.registry.remove(handleId);
    }
  }

  /**
   * 释放滚动摘要的会话状态 (WP55 · 修 WP37 遗留的泄漏).
   *
   * 为什么要单独一个方法: 清理必须**放在 finally** —— 内核 close 抛错时,
   * 滚动摘要的队列与摘要对象同样不能留在内存里 (那也是泄漏).
   *
   * 未压的队列直接丢弃, **不做最后一次 flush**: 会话结束时 WP12 的收尾服务
   * 会从逐字稿全量压最终摘要并晋升长时记忆, 那份摘要覆盖了全部内容 ——
   * 这里再压一次就是重复消耗额度, 而且可能与最终摘要说法不一致.
   *
   * @param handleId 内核会话句柄
   * @param context 会话归属 (取不到就跳过 —— 归属表里没有 = 这场会话没登记过)
   */
  private forgetRollingSummary(handleId: string, context: TurnSessionContext | undefined): void {
    if (!context || !this.rollingSummary) return;
    try {
      this.rollingSummary.forgetSession(context.tenantId, context.sessionId);
    } catch (error) {
      // 清理失败不该让 close 抛错 (会话已经关了, 残留只是内存占用).
      this.logger.warn(`引擎会话关闭时释放滚动摘要状态失败 handle=${handleId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 解析会话归属 (供编排器的 `resolveSession` 缝使用).
   *
   * @param handleId 内核会话句柄
   * @returns 会话归属
   */
  resolveContext(handleId: string): TurnSessionContext | undefined {
    return this.registry.resolve(handleId);
  }
}
