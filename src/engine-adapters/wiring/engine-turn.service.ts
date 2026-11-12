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

import type { SessionAllianceThresholdResolver } from './alliance-threshold-resolver.js';
import { ALLIANCE_THRESHOLD_RESOLVER, ENGINE_SESSION_PORT, ROLLING_SUMMARY_CLEANUP } from './engine.tokens.js';
import { TURN_DELTA_AUDIT, type TurnDeltaAuditPort } from './turn-delta-audit/turn-delta-audit.port.js';
import type {
  AllianceThresholds,
  EngineSessionPort,
  EngineTurnInput,
  OpenEngineSessionInput,
  RenderContextTurn,
} from '../../engine-core/index.js';
import type { DeliberationScenarioType } from '../deliberation/deliberation-mode.config.js';
import type { DeliberationScenarioResolver } from '../deliberation/llm-deliberation-hook.js';
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
export class EngineSessionRegistry implements DeliberationScenarioResolver {
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

  /**
   * 按**会话 id** 反查归属 (不是按句柄) —— 审议钩子只拿得到会话 id.
   *
   * ⚠️ **为什么按会话 id 扫而不是维护第二张表**:
   *     归属登记表已经是"句柄 → 归属"的唯一真相源; 再开一张"会话 id → 归属"
   *     就是第二份真相 (两份迟早不同步 —— 尤其 close 时机不一致时, 会出现
   *     "句柄已清、残留一条" 的幽灵条目).
   *     归属表是**进程内瞬时**的 (句柄数量级, 几十上百), 线性扫完全够用.
   *
   * @param sessionId 会话 id
   * @returns 会话归属; 查不到 → undefined
   */
  resolveBySessionId(sessionId: string): TurnSessionContext | undefined {
    for (const context of this.contexts.values()) {
      if (context.sessionId === sessionId) return context;
    }
    return undefined;
  }

  /**
   * 反查某场会话的场景类型 (审议钩子用).
   *
   * ⚠️ **查不到 → `undefined`** (由调用方按缺省处理) —— 不在这里兜底成某个场景,
   *   兜底口径归调用方 (钩子侧回落 full_simulation), 免得两处各兜一次兜出不同值.
   *
   * @param sessionId 会话 id
   * @returns 场景类型; 查不到 → undefined
   */
  resolveScenario(sessionId: string): DeliberationScenarioType | undefined {
    return this.resolveBySessionId(sessionId)?.scenarioType;
  }
}

/**
 * 开会话时装配层附加的**可选信息** (登记进会话归属).
 *
 * ⚠️ **为什么提成具名接口**: `open()` 的参数类型原本是内联对象字面量 ——
 *   提取之后, `open()` 里那条"十来条条件展开"的圈复杂度也跟着降下来
 *   (eslint complexity ≤ 20), 而且别处 (归属组装) 也能复用同一份类型, 不会漂.
 *
 * ⚠️ **全部字段都是"缺省 = 不登记"**:
 *   渲染层靠"字段在不在"区分"这个角色没表态"与"这个角色话量基线是空" ——
 *   无条件展开成 undefined 会把两者混成一样, 于是 prompt 逐字变了 (零回归被破坏).
 */
export interface EngineTurnOpenOptions {
  /** 角色代号 (仅供 dev 调试日志核对 prompt 拼装). */
  readonly characterLabel?: string;
  /** 话量基线 (WP41). */
  readonly speechVolumeBaseline?: number;
  /** 叙事风格 (WP41). */
  readonly narrativeStyle?: TurnSessionContext['narrativeStyle'];
  /** 表达语调 (WP41). */
  readonly expressionTone?: TurnSessionContext['expressionTone'];
  /**
   * 依恋风格 (WP-J P1d): 渲染层的依恋行为指引开关 (anxious 通道).
   *
   * ⚠️ 缺省 = 不登记 = 渲染层不消费 = prompt 逐字不变 (零回归).
   */
  readonly attachmentStyle?: TurnSessionContext['attachmentStyle'];
  /**
   * 台词指纹 (WP-J P2): 渲染层 prompt 的「你说话的味道」块.
   *
   * 为什么它必须走**同一条登记路径** (与 attachmentStyle 并排):
   *   调试面板与自动对练开场都调本方法, 不走 voice 后端那条 open ——
   *   只在 `engine-stream-backend.adapter` 里登记, 这条路径就静默拿不到,
   *   渲染层的 `if (spec.verbalVoice)` 直接跳过 (台词指纹白落库).
   *
   * ⚠️ 缺省 = 不登记 = 渲染层不消费 = prompt 逐字不变 (零回归).
   */
  readonly verbalVoice?: TurnSessionContext['verbalVoice'];
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
  /**
   * 稳定落库会话 id (`training_sessions.id`) (V2026-11-09 闸门 trace 查询接口).
   *
   * 用途: 登记进归属 → 闸门决策落库时带上**落库口径**的会话 id,
   *   让 admin 后台能按 dbSessionId 筛 (sessionId 双口径的另一半).
   *
   * ⚠️ 缺省 = 没有落库会话 (自动对练) → 闸门记录里写 NULL.
   */
  readonly dbSessionId?: string;
  /**
   * 本场会话的**场景类型** (V2026-11-11 G-1).
   *
   * ⚠️ 缺省 = 不登记 = 审议侧按"查不到场景"处理 (回落 full_simulation,
   *   即无场景限制) —— 与接入前逐字一致 (零回归).
   */
  readonly scenarioType?: DeliberationScenarioType;
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
    /**
     * 事件 + delta 审计观测端口 (WP58).
     *
     * 用 `@Optional()`: 观测是**增强**, 装配缺席时只是"不记审计", 不能让整个引擎
     * 门面开不起来 (与仓库里 LlmRouterService 的做法同理).
     */
    @Optional() @Inject(TURN_DELTA_AUDIT) private readonly audit?: TurnDeltaAuditPort,
    /**
     * 会话级同盟门槛覆盖解析端口 (I-12).
     *
     * ⚠️ 用 `@Optional()`: 覆盖是**增强** —— 端口缺席 = 本场无覆盖,
     *   门槛逐字回落到模块 env 单例, 不能让整个引擎门面开不起来.
     *   缺省 provider 已装配为 `NO_SESSION_ALLIANCE_THRESHOLD_OVERRIDE` (永远无覆盖).
     */
    @Optional() @Inject(ALLIANCE_THRESHOLD_RESOLVER) private readonly allianceThresholds?: SessionAllianceThresholdResolver,
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
  open(input: OpenEngineSessionInput, options?: EngineTurnOpenOptions): { readonly handleId: string; readonly sessionId: string } {
    // I-12: 解析本场的同盟门槛覆盖 (无覆盖 → undefined → 内核逐字回落模块 env 单例).
    //   ⚠️ 来源坏掉不该炸会话开场 —— 捕获后按"无覆盖"处理 (与仓库"失败不炸主流程"纪律同款).
    const thresholdOverride = this.resolveThresholdOverride(input, options);
    //   ⚠️ 无覆盖时**原样传 input** (同一引用) —— 内核侧零变化, 逐字零回归.
    const handle = this.session.openSession(thresholdOverride ? { ...input, allianceThresholds: thresholdOverride } : input);
    this.registry.register(handle.handleId, this.buildSessionContext(input, options));
    this.logger.log(`引擎会话已开启 handle=${handle.handleId} session=${input.sessionId}`);
    return { handleId: handle.handleId, sessionId: handle.sessionId };
  }

  /**
   * 组装会话归属 (handleId → 归属).
   *
   * ⚠️ **为什么抽出来**: `open()` 里堆了十来条"条件展开", 圈复杂度直接顶到 eslint 上限
   *   (complexity ≤ 20) —— 再加一个字段就得再抽一次. 抽成独立方法后,
   *   `open()` 只剩"开句柄 + 登记归属"两件事, 新增字段只改这一处.
   *
   * ⚠️ **为什么全部是条件展开** (缺省 = 不登记):
   *   渲染层靠"字段在不在"区分"这个角色没表态"与"这个角色话量基线是空" ——
   *   无条件展开成 undefined 会把两者混成一样, 于是 prompt 逐字变了 (零回归被破坏).
   *
   * @param input 开场参数
   * @param options 装配层附加信息
   * @returns 会话归属
   */
  private buildSessionContext(
    input: OpenEngineSessionInput,
    options?: {
      readonly characterLabel?: string;
      readonly speechVolumeBaseline?: number;
      readonly narrativeStyle?: TurnSessionContext['narrativeStyle'];
      readonly expressionTone?: TurnSessionContext['expressionTone'];
      readonly attachmentStyle?: TurnSessionContext['attachmentStyle'];
      readonly verbalVoice?: TurnSessionContext['verbalVoice'];
      readonly userId?: string;
      readonly characterBrief?: string;
      readonly dbSessionId?: string;
      readonly scenarioType?: DeliberationScenarioType;
    },
  ): TurnSessionContext {
    return {
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      visitorId: input.visitorId,
      ...this.buildRenderAttribution(options),
      ...this.buildDeliberationAttribution(options),
    };
  }

  /**
   * 组装**渲染侧**归属 (角色代号 / 表达风格三字段 / 依恋风格 / 台词指纹).
   *
   * ⚠️ **为什么拆成两个方法**: 归属字段有十来个, 全塞一个方法里圈复杂度顶到
   *   eslint 上限 (complexity ≤ 20) —— 再加一个字段就得再抽一次. 按"渲染侧"
   *   与"审议侧"切开, 两边各管各的字段, 新增字段只改对应那一个方法.
   *
   * ⚠️ **为什么全是条件展开** (缺省 = 不登记):
   *   渲染层靠"字段在不在"区分"这个角色没表态"与"这个角色话量基线是空" ——
   *   无条件展开成 undefined 会把两者混成一样, 于是 prompt 逐字变了 (零回归被破坏).
   *
   * @param options 装配层附加信息
   * @returns 渲染侧归属片段
   */
  private buildRenderAttribution(options?: EngineTurnOpenOptions): Partial<TurnSessionContext> {
    return {
      ...(options?.characterLabel ? { characterLabel: options.characterLabel } : {}),
      // WP41: 表达风格三字段 —— 条件展开: 装配层没给就不登记, 渲染层分得清
      //   "这个角色没表态"与"这个角色话量基线是空" (零回归: 没登记 = prompt 逐字不变).
      ...(options?.speechVolumeBaseline === undefined ? {} : { speechVolumeBaseline: options.speechVolumeBaseline }),
      ...(options?.narrativeStyle === undefined ? {} : { narrativeStyle: options.narrativeStyle }),
      ...(options?.expressionTone === undefined ? {} : { expressionTone: options.expressionTone }),
      // WP-J P1d: 依恋风格登记 —— 条件展开, 缺省不登记 (零回归: prompt 逐字不变).
      ...(options?.attachmentStyle === undefined ? {} : { attachmentStyle: options.attachmentStyle }),
      // WP-J P2: 台词指纹登记 —— 条件展开, 缺省不登记 (零回归: prompt 逐字不变).
      ...(options?.verbalVoice === undefined ? {} : { verbalVoice: options.verbalVoice }),
    };
  }

  /**
   * 组装**审议侧**归属 (学员账号 / 角色简述 / 落库会话 id / 场景类型).
   *
   * ⚠️ **为什么与渲染侧分开**: 审议侧的四个字段各有各的"缺省语义" ——
   *   学员账号缺省 = 旁路审议跳过这一轮; 场景类型缺省 = 不施加场景红线.
   *   混进渲染侧那一堆里, 后面加字段的人很容易顺手抄错缺省语义.
   *
   * @param options 装配层附加信息
   * @returns 审议侧归属片段
   */
  private buildDeliberationAttribution(options?: EngineTurnOpenOptions): Partial<TurnSessionContext> {
    return {
      // WP64: 学员账号 + 角色简述 —— 条件展开 (缺省 = 旁路审议跳过这一轮, 不影响会话).
      ...(options?.userId ? { userId: options.userId } : {}),
      ...(options?.characterBrief ? { characterBrief: options.characterBrief } : {}),
      // V2026-11-09: 落库会话 id (闸门决策落 MySQL 真相源用) —— 条件展开 (缺省 = 不带).
      ...(options?.dbSessionId ? { dbSessionId: options.dbSessionId } : {}),
      // 场景类型 (V2026-11-11 G-1) —— 条件展开 (缺省 = 不带 = 审议侧不施加场景红线).
      ...(options?.scenarioType ? { scenarioType: options.scenarioType } : {}),
    };
  }

  /**
   * 解析本场的同盟门槛覆盖 (I-12).
   *
   * ⚠️ **失败 = 无覆盖**: 覆盖来源抛错 / 返回非法形状 → 一律按"无覆盖"处理,
   *   门槛逐字回落到模块 env 单例 —— 覆盖是**增强**, 不该让会话开场失败.
   *
   * ⚠️ 本方法**不读 env、不算门槛数值** —— 它只把"来源解析出来的覆盖"原样带给内核,
   *   合并与回落由内核 resolveSessionAllianceConfig 一处裁决.
   *
   * @param input 开场入参
   * @param options 装配层附加信息 (角色档案)
   * @returns 覆盖项; undefined = 无覆盖
   */
  private resolveThresholdOverride(
    input: OpenEngineSessionInput,
    options?: { readonly characterLabel?: string; readonly attachmentStyle?: TurnSessionContext['attachmentStyle'] },
  ): Partial<AllianceThresholds> | undefined {
    const resolver = this.allianceThresholds;
    if (!resolver) return undefined;
    try {
      const override = resolver.resolve({
        sessionId: input.sessionId,
        tenantId: input.tenantId,
        visitorId: input.visitorId,
        ...(options?.characterLabel ? { characterLabel: options.characterLabel } : {}),
        ...(options?.attachmentStyle ? { attachmentStyle: options.attachmentStyle } : {}),
      });
      if (!override) return undefined;
      // 只接受**对象**形状 —— 来源返回别的 (字符串 / 数字 / null) 一律按无覆盖处理.
      if (typeof override !== 'object') return undefined;
      return override;
    } catch (error) {
      this.logger.warn(
        `会话级同盟门槛覆盖解析失败 (按无覆盖处理): session=${input.sessionId} ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
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
    const result = await this.orchestrator.turn(handleId, input);
    this.auditTurn(handleId, result);
    return result;
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
   * @param options 附加选项 (V2026-11-05 WP58: 要 prompt 全文时开 `includePromptFull`)
   * @returns 本轮来访口语 + 内核出参 + 渲染元信息
   */
  async turnStream(
    handleId: string,
    input: EngineTurnInput,
    handlers: StreamRenderHandlers,
    options?: { readonly includePromptFull?: boolean },
  ): Promise<TurnRenderResult> {
    const result = await this.orchestrator.turnStream(handleId, input, handlers, options);
    this.auditTurn(handleId, result);
    return result;
  }

  /**
   * 预置句柄的渲染上下文 (恢复调试会话用).
   *
   * V2026-11-06 (WP38 补做 · 调试会话恢复): 进程重启后, 内核句柄要重新开,
   *   而"上一轮说过什么"在内存里 —— 不预置的话, 恢复出来的会话第一轮就是空上下文.
   *
   * @param handleId 内核会话句柄
   * @param turns 要预置的最近对话序列 (旧 → 新)
   */
  restoreRenderContext(handleId: string, turns: readonly RenderContextTurn[]): void {
    this.orchestrator.restoreHistory(handleId, turns);
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
   * 记录本轮的事件 + delta 审计 (WP58 · fire-and-forget).
   *
   * 为什么挂在门面而不是编排器:
   *     门面是所有调用必经之处, 归属登记表 (EngineSessionRegistry) 就在它旁边 ——
   *     归属 (tenantId / sessionId) 与轮次号不必跨模块拿.
   *
   * 为什么失败不抛:
   *     观测是增强, 不是主链路依赖 —— 审计写库失败不该让整轮 turn 失败
   *     (与 notifyDeltaCap 同一纪律). 这里再兜一层 try/catch: 观测端口的实现
   *     承诺不抛, 但门面不该把"观测出问题"变成"对话出问题".
   *
   * @param handleId 内核会话句柄
   * @param result 本轮出参
   */
  private auditTurn(handleId: string, result: TurnRenderResult): void {
    if (!this.audit) return;
    const context = this.registry.resolve(handleId);
    if (!context) return;
    try {
      this.audit.record({
        tenantId: context.tenantId,
        sessionId: context.sessionId,
        turnIndex: result.turnIndex,
        // C3 (D-1 第二段): 审计**只吃内核事件** —— 不再传咨询师原话 (审计层不再自行分类).
        kernelEventKinds: result.events ?? [],
      });
    } catch (error) {
      this.logger.debug(
        '引擎会话事件审计记录失败 handle=' +
          handleId +
          ' turn=' +
          result.turnIndex +
          ': ' +
          (error instanceof Error ? error.message : String(error)),
      );
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
