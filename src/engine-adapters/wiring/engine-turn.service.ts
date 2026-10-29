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

import { Inject, Injectable, Logger } from '@nestjs/common';

import { ENGINE_SESSION_PORT } from './engine.tokens';
import type { EngineSessionPort, EngineTurnInput, OpenEngineSessionInput } from '../../engine-core';
import type { TurnRenderResult, TurnSessionContext } from '../rendering/turn-render-orchestrator';
import { TurnRenderOrchestrator } from '../rendering/turn-render-orchestrator';

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
  ) {}

  /**
   * 开会话: 内核 openSession + 登记归属.
   *
   * 重复 `sessionId` 已开 → 内核抛 `SESSION_ALREADY_OPEN` **原样冒泡**,
   * 本层不静默复用旧句柄 (静默复用会让调用方以为开了一场新会话, 实际接的是旧状态).
   *
   * @param input 开场参数
   * @returns 会话句柄 id + 业务会话 id
   */
  open(input: OpenEngineSessionInput): { readonly handleId: string; readonly sessionId: string } {
    const handle = this.session.openSession(input);
    this.registry.register(handle.handleId, {
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      visitorId: input.visitorId,
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
   * 关会话: 清门面历史 → 关内核句柄 (幂等) → 清归属.
   *
   * 清理放 `finally`: 内核 close 抛错时归属表也不能残留.
   *
   * @param handleId 内核会话句柄
   */
  close(handleId: string): void {
    try {
      this.orchestrator.forgetSession(handleId);
      this.session.closeSession(handleId);
      this.logger.log(`引擎会话已关闭 handle=${handleId}`);
    } finally {
      this.registry.remove(handleId);
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
