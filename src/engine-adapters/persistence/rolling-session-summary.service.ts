// V2026-11-03 WP37 (B 层 · 会话级滚动摘要服务):
//   职责: 收"工作窗口溢出"信号 → 等门面上报的轮次记录配对齐 → 攒批 → 异步调 LLM
//         压成滚动摘要 → 写成 SHORT_TERM 记忆条目 → 缓存本场当前摘要 (供渲染层进 prompt).
//   边界: B 层 (src/engine-adapters/persistence/); 不认识具体存储实现
//         (记忆走内核 MemoryStore 端口), 不认识 LLM 厂商 (摘要走窄面端口).
//
//   WP55 改造 (两侧纪要):
//     原来只有咨询师一侧 —— 内核的溢出回调只交出咨询师原话, 摘要看不见来访者说了什么.
//     现在两侧都有: 门面每轮落账时上报**完整轮次** (咨询师话 + 来访者话),
//     内核的溢出回调退化成"**淘汰信号**" (哪一轮离开了工作窗口).
//
//   为什么配对在"轮次"层面做, 而不是"两条平行的文本队列":
//     咨询师文本 (内核给) 与来访者文本 (门面给) 是**两条独立到达**的流, 到达时刻不同
//     (内核在 session.turn 内, 门面在渲染落账后), 且**长度会错位** —— 某一轮被阻断
//     或渲染降级时, 来访者根本没发言, 下标就整体偏移一格.
//     按下标配对会产出"问 A 轮 / 答 B 轮"的假对话 —— 摘要里凭空多出一段因果.
//     轮次记录把两侧绑成一个不可拆的单位, 配对正确性由结构保证, 不靠下标.
//
//   为什么"摘要"住在 B 层而不是内核:
//     摘要要调 LLM —— 内核零网络 / 零 prompt (boundary.spec.ts 断言①②④守着).
//     内核负责"**什么时候**该压缩" (窗口裁剪是内核策略), B 层负责"**怎么**压缩".
//
//   为什么是"攒批"而不是每轮调一次 LLM:
//     摘要是**高频**调用 (对话 30 轮 = 溢出 22 轮 = 每 3 轮一次 ≈ 7 次 LLM 调用).
//     逐轮调 = 22 次调用, 而且每次只压 1 轮, 摘要质量还很差 (一段话压成一句).
//     攒到 N 轮再压 = 调用次数降到 1/N, 且每批有足够上下文可压.
//
//   失败语义 (三层, 都不阻断对话):
//     - LLM 调用失败 → 记 warn, 本批轮次**放回待压队列**, 下一批连着一起压
//       (内容不丢); 队列有上限, 超了丢最旧的 (否则一次长对话能把内存吃光).
//     - 记忆写入失败 → 记 warn, 摘要**仍然缓存** (本场对话还能用它保持话题连续),
//       只是这一版没落库 (下下场接手时看不到).
//     - 未装配生成器 → 只攒不压 (装配缺席 = 本场没有摘要, 不是会话失败).
//
//   反双胞胎:
//     - 不自己判断"该不该晋升长时" —— 那是 WP12 收尾 (session-closeout.service.ts) 的活;
//       本服务只写 SHORT_TERM, 不碰 LONG_TERM (会话结束时的最终摘要是**另一条路径**).
//     - 不自己写 LLM 调用 —— 走窄面 RollingSummaryGenerator, 单测用 stub.
//     - 不用全局单例表 —— 状态挂在实例上, 与装配模块同生命周期.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp37-rolling-session-summary.spec.ts:
//        攒批阈值 / 滚动并入 / SHORT_TERM 写入 / 失败降级 / 会话隔离 / prompt 接线
//     3. test/engine-adapters/wp55-rolling-summary-both-sides.spec.ts:
//        两侧轮次记录 / 配对不错位 / 阻断轮次 / 会话关闭清理

import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { RollingSummaryGenerator, RollingSummaryRound } from './rolling-summary.generator.js';
import { MemorySource, MemoryTier, type MemoryEntry, type MemoryStore, type WorkingWindowOverflowEvent } from '../../engine-core/index.js';

/**
 * 滚动摘要重要度种子值 (工程种子值, **未标定**).
 *
 * 为什么是 0.5: 滚动摘要是**会话中段**的上下文, 不是跨会话的核心事实 ——
 * 它比"来访者说过什么关键事实"(长期记忆 0.9)轻, 但也不是可有可无 (比工作记忆原话高:
 * 原话逐字留在记忆仓储里, 摘要的价值在于"被压过之后仍然找得回来").
 * ⚠️ 这是工程种子, 不是临床结论 —— 后期靠真实数据校准.
 */
export const DEFAULT_ROLLING_SUMMARY_IMPORTANCE = 0.5;

/**
 * 攒批阈值种子值: 攒够 3 轮被淘汰的对话才压一次摘要.
 *
 * 为什么是 3: 工作窗口 8 轮 → 攒 3 轮意味着"对话已经比窗口长了 3 轮"才压一次,
 * 压的频率 ≈ 每 3 轮 1 次 (30 轮的对话 ≈ 7 次 LLM 调用). 再密就是烧额度,
 * 再疏则"第 9 轮到第 20 轮之间聊的"要等太久才被压进去.
 *
 * WP55: 单位从"3 条咨询师发言"改成"3 轮问答对" —— 口径更清晰 (一轮 = 问 + 答).
 * ⚠️ 工程种子, 待真实对练校准.
 */
export const DEFAULT_ROLLING_SUMMARY_BATCH_SIZE = 3;

/**
 * 待压队列上限倍数 (相对攒批阈值).
 *
 * 为什么要有上限: LLM 连续失败时, 待压队列会一直涨 —— 一场 200 轮的长对话能把
 * 几千行发言全攒在内存里. 超限时丢**最旧**的 (丢最新的更糟: 最新的内容离当下最近,
 * 丢了它摘要就跟当前话题脱节).
 */
export const DEFAULT_ROLLING_SUMMARY_PENDING_MULTIPLIER = 3;

/**
 * 滚动摘要端口 (窄面).
 *
 * 渲染层 (门面) 只问"这场会话当前有没有滚动摘要", 并在每轮落账时上报轮次记录.
 */
export interface RollingSummaryPort {
  /**
   * 取本场当前的滚动摘要.
   *
   * @param tenantId 租户隔离键
   * @param sessionId 业务会话 id
   * @returns 摘要正文; 还没有摘要时返回 undefined
   */
  latestSummary(tenantId: string, sessionId: string): string | undefined;

  /**
   * 上报一轮完整对话 (WP55 · 两侧纪要).
   *
   * 与内核的 `onWorkingWindowOverflow` (淘汰信号) 配对:
   *   · 本方法 = **内容** (这一轮咨询师说了什么 + 来访者回了什么);
   *   · 溢出回调 = **时机** (哪一轮已经离开工作窗口, 该被压进摘要了).
   *
   * 为什么由门面报而不是服务自己找:
   *   内核不渲染, 拿不到来访者的话 —— 只有门面 (渲染落账方) 手里有两侧.
   *   而"这一轮"两侧在**同一个对象**里, 配对不会错位.
   *
   * @param tenantId 租户隔离键
   * @param sessionId 业务会话 id
   * @param visitorId 来访者 id (状态已存在时以第一次的为准)
   * @param counselor 本轮咨询师说的话
   * @param visitor 本轮来访者的回复; `null` = 这一轮来访者没发言 (阻断 / 渲染降级)
   */
  recordRound(tenantId: string, sessionId: string, visitorId: string, counselor: string, visitor: string | null): void;
}

/**
 * 滚动摘要服务构造入参.
 */
export interface RollingSessionSummaryDeps {
  /** 记忆仓储 (内核端口). */
  readonly memories: MemoryStore;
  /** 摘要生成器 (缺省 = 只攒不压, 不产生摘要). */
  readonly generator?: RollingSummaryGenerator;
  /** 攒批阈值 (缺省 = 种子值 3). */
  readonly batchSize?: number;
  /** 摘要重要度 (缺省 = 种子值 0.5). */
  readonly importance?: number;
  /** 待压队列上限倍数 (缺省 = 种子值 3). */
  readonly pendingMultiplier?: number;
  /** 时钟 (测试可注入; 默认 Date.now). */
  readonly now?: () => number;
  /** id 工厂 (测试可注入; 默认 randomUUID). */
  readonly makeId?: () => string;
}

/**
 * 滚动摘要清理端口 (窄面).
 *
 * 为什么单独一个窄面 (而不是让会话门面依赖整个服务类):
 *   会话关闭时只需要"释放这场会话的状态"这一件事. 窄面让依赖方 (engine-turn.service)
 *   只依赖这一个动作, 单测能用桩替换, 也不会因为服务类重构而被迫改签名.
 */
export interface RollingSummaryCleanupPort {
  /**
   * 释放一场会话的滚动摘要状态 (会话关闭时调用; 幂等).
   *
   * @param tenantId 租户隔离键
   * @param sessionId 业务会话 id
   */
  forgetSession(tenantId: string, sessionId: string): void;
}

/**
 * 单场会话的滚动摘要状态.
 */
interface SessionRollingState {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly visitorId: string;
  /**
   * 门面上报的轮次记录 (已落账, **还没**被内核工作窗口淘汰) —— 按轮次顺序.
   *
   * 为什么门面上报的轮次要**等淘汰**才压摘要:
   *   还在工作窗口里的轮次, 模型这一轮还看得见 (prompt 里就有逐字原文).
   *   把它们也压进摘要 = 同一段内容在 prompt 里出现两遍 (逐字 + 摘要),
   *   既浪费 token, 又让模型觉得"这件事已经聊过了" —— 那会压低话题展开的意愿.
   */
  pendingRounds: RollingSummaryRound[];
  /** 已被内核工作窗口淘汰的轮次 (等待攒批压摘要) —— 按轮次顺序. */
  evictedRounds: RollingSummaryRound[];
  /** 当前滚动摘要 (还没有 → undefined). */
  summary?: string;
  /** 是否正在压摘要 (防重入: 同一时刻只跑一次 LLM 调用). */
  flushing: boolean;
  /** 压摘要期间又来了新内容 → 压完这一轮要再压一次 (否则最后一批会被漏掉). */
  flushRequested: boolean;
}

/**
 * 会话级滚动摘要服务.
 */
export class RollingSessionSummaryService implements RollingSummaryPort, RollingSummaryCleanupPort {
  private readonly logger = new Logger(RollingSessionSummaryService.name);
  private readonly memories: MemoryStore;
  private readonly generator: RollingSummaryGenerator | undefined;
  private readonly batchSize: number;
  private readonly importance: number;
  private readonly pendingMultiplier: number;
  private readonly pendingLimit: number;
  private readonly now: () => number;
  private readonly makeId: () => string;
  /** 会话键 → 滚动状态. */
  private readonly states = new Map<string, SessionRollingState>();

  constructor(deps: RollingSessionSummaryDeps) {
    this.memories = deps.memories;
    this.generator = deps.generator;
    this.batchSize = Math.max(1, Math.floor(deps.batchSize ?? DEFAULT_ROLLING_SUMMARY_BATCH_SIZE));
    this.importance = deps.importance ?? DEFAULT_ROLLING_SUMMARY_IMPORTANCE;
    this.pendingMultiplier = deps.pendingMultiplier ?? DEFAULT_ROLLING_SUMMARY_PENDING_MULTIPLIER;
    this.pendingLimit = this.batchSize * this.pendingMultiplier;
    this.now = deps.now ?? Date.now;
    this.makeId = deps.makeId ?? (() => randomUUID());
  }

  /**
   * 记录一次工作窗口溢出 (内核回调) —— **淘汰信号**.
   *
   * **同步且永不抛错** —— 它跑在对话主链路上, 摘要出问题不该让这一轮失败.
   * 真正压摘要的动作是**异步**的 (fire-and-forget): LLM 调用有几百毫秒到几秒,
   * 放在主链路上会让每轮对练都多等一次模型.
   *
   * 这里**不直接攒内容** —— 内容由门面通过 `recordRound` 上报 (两侧完整轮次).
   * 本方法只负责回答"哪一轮离开了工作窗口", 把对应的轮次记录挪进待压队列.
   *
   * @param event 溢出事件 (归属三件套 + 被挤出的咨询师发言)
   */
  recordOverflow(event: WorkingWindowOverflowEvent): void {
    try {
      const state = this.stateOf(event.tenantId, event.sessionId, event.visitorId);
      for (const counselorText of event.pushedOut) {
        const round = this.takeRound(state, counselorText);
        if (!round) {
          // 找不到对应轮次 = 门面上报缺失 (例如那一轮的落账被异常打断).
          // **跳过而不是猜** —— 猜出来的配对会写进摘要, 那是凭空捏造.
          this.logger.warn(`[rolling-summary] 淘汰的发言没有对应轮次记录 (跳过) session=${event.sessionId}`);
          continue;
        }
        state.evictedRounds.push(round);
      }
      // 队列上限: 连续失败时别把内存吃光 (丢最旧的).
      if (state.evictedRounds.length > this.pendingLimit) {
        const dropped = state.evictedRounds.length - this.pendingLimit;
        state.evictedRounds.splice(0, dropped);
        this.logger.warn(`[rolling-summary] 待压队列超限, 丢弃最旧的 ${dropped} 轮 session=${event.sessionId} limit=${this.pendingLimit}`);
      }
      this.maybeFlush(state);
    } catch (error) {
      this.logger.warn(`[rolling-summary] 记录溢出失败 (已忽略): ${messageOf(error)}`);
    }
  }

  /**
   * 上报一轮完整对话 (门面落账时调用, WP55).
   *
   * **同步且永不抛错** —— 同 `recordOverflow`: 摘要是增强, 不是会话成败.
   *
   * @param tenantId 租户隔离键
   * @param sessionId 业务会话 id
   * @param visitorId 来访者 id
   * @param counselor 本轮咨询师说的话
   * @param visitor 本轮来访者的回复; `null` = 这一轮来访者没发言
   */
  recordRound(tenantId: string, sessionId: string, visitorId: string, counselor: string, visitor: string | null): void {
    try {
      const state = this.stateOf(tenantId, sessionId, visitorId);
      state.pendingRounds.push({ counselor, visitor });
      // 上限: 没装配生成器 / 长期不压缩时别把内存吃光 (丢最旧的).
      if (state.pendingRounds.length > this.pendingLimit) {
        const dropped = state.pendingRounds.length - this.pendingLimit;
        state.pendingRounds.splice(0, dropped);
        this.logger.warn(`[rolling-summary] 待淘汰队列超限, 丢弃最旧的 ${dropped} 轮 session=${sessionId} limit=${this.pendingLimit}`);
      }
    } catch (error) {
      this.logger.warn(`[rolling-summary] 记录轮次失败 (已忽略): ${messageOf(error)}`);
    }
  }

  /**
   * 取本场当前的滚动摘要.
   *
   * @param tenantId 租户隔离键
   * @param sessionId 业务会话 id
   * @returns 摘要正文; 还没有摘要时返回 undefined
   */
  latestSummary(tenantId: string, sessionId: string): string | undefined {
    return this.states.get(sessionKey(tenantId, sessionId))?.summary;
  }

  /**
   * 清掉一场会话的滚动状态 (会话关闭时调用; 缺省 = 幂等).
   *
   * 不清 = 内存里留着这场会话的发言与摘要, 而会话已经结束了 —— 那就是内存泄漏.
   *
   * @param tenantId 租户隔离键
   * @param sessionId 业务会话 id
   */
  forgetSession(tenantId: string, sessionId: string): void {
    this.states.delete(sessionKey(tenantId, sessionId));
  }

  /** 当前跟踪的会话数 (观测用). */
  trackedSessionCount(): number {
    return this.states.size;
  }

  // ── private ────────────────────────────────────────────────────

  /**
   * 取 (或建) 本场会话的滚动状态.
   *
   * 归属三件套里, `visitorId` 以**第一次**建状态的那个为准 —— 状态建好后改 visitorId
   * 只会让记忆条目指向错的人, 而归属本来就是会话级常量.
   */
  private stateOf(tenantId: string, sessionId: string, visitorId: string): SessionRollingState {
    const key = sessionKey(tenantId, sessionId);
    const existing = this.states.get(key);
    if (existing) return existing;
    const created: SessionRollingState = {
      tenantId,
      sessionId,
      visitorId,
      pendingRounds: [],
      evictedRounds: [],
      flushing: false,
      flushRequested: false,
    };
    this.states.set(key, created);
    return created;
  }

  /**
   * 按咨询师文本取出对应的轮次记录 (WP55 · 淘汰匹配).
   *
   * 为什么先按**队首**取, 再全表找:
   *   正常路径下队首就是它 (内核与门面的轮次顺序严格一致) —— O(1).
   *   兜底才全表找: 某一轮的落账被异常打断时, 门面上报会缺一条, 队列就会错开一格.
   *   宁可多找一次, 也不要**错配** (把 A 轮的来访者话挂到 B 轮上).
   *
   * 找不到 → 返回 undefined (调用方跳过这一轮, 不猜).
   */
  private takeRound(state: SessionRollingState, counselorText: string): RollingSummaryRound | undefined {
    const head = state.pendingRounds[0];
    if (head && head.counselor === counselorText) return state.pendingRounds.shift();
    const index = state.pendingRounds.findIndex((round) => round.counselor === counselorText);
    if (index !== -1) return state.pendingRounds.splice(index, 1)[0];
    return undefined;
  }

  /**
   * 触发一次压缩 (非重入).
   *
   * 已经在压 → 记一个"再来一次"标记, 压完再压 —— **不能直接跳过**:
   *   跳过的话, "上一次压摘要的工夫里到达的那几轮"永远等不到下一次触发
   *   (下一次触发要等再淘汰一轮才行), 于是对话快结束时最后一批内容没被压进去.
   */
  private maybeFlush(state: SessionRollingState): void {
    if (state.flushing) {
      state.flushRequested = true;
      return;
    }
    // 攒批阈值按**轮次**算 (一轮 = 一次咨询师发言 + 一次来访者回复).
    if (state.evictedRounds.length < this.batchSize) return;
    state.flushing = true;
    void this.flush(state).finally(() => {
      state.flushing = false;
      if (state.flushRequested) {
        state.flushRequested = false;
        this.maybeFlush(state);
      }
    });
  }

  /**
   * 压一次摘要: 取待压轮次 → 调 LLM → 写 SHORT_TERM 记忆 → 更新缓存.
   *
   * 永不抛错: 失败只记 warn (摘要是增强, 不是会话成败).
   */
  private async flush(state: SessionRollingState): Promise<void> {
    if (!this.generator) {
      // 没装配生成器 → 不压 (但也别让队列一直涨: 清掉, 否则白白攒一堆).
      state.evictedRounds = [];
      return;
    }
    const batch = state.evictedRounds.splice(0);
    if (batch.length === 0) return;

    let summary: string;
    try {
      summary = await this.generator.generate({
        ...(state.summary ? { previousSummary: state.summary } : {}),
        rounds: batch,
      });
    } catch (error) {
      // 放回队列: 内容不丢, 下一批连着一起压 (失败期间攒的也一起).
      state.evictedRounds.unshift(...batch);
      this.logger.warn(`[rolling-summary] 摘要生成失败, 本批 ${batch.length} 轮留待下次 session=${state.sessionId}: ${messageOf(error)}`);
      return;
    }

    const content = summary.trim();
    if (content.length === 0) {
      state.evictedRounds.unshift(...batch);
      this.logger.warn(`[rolling-summary] 摘要为空, 本批留待下次 session=${state.sessionId}`);
      return;
    }

    // 写记忆失败不阻断: 摘要本身仍然有用 (本场对话靠它保持话题连续).
    try {
      const entry: MemoryEntry = {
        tenantId: state.tenantId,
        id: `rs-${this.makeId()}`,
        sessionId: state.sessionId,
        tier: MemoryTier.SHORT_TERM,
        source: MemorySource.SUMMARY,
        content,
        importance: this.importance,
        occurredAt: this.now(),
        ttlMs: null,
        visitorId: state.visitorId,
      };
      await this.memories.remember(entry);
    } catch (error) {
      this.logger.warn(`[rolling-summary] 摘要写入记忆仓储失败 session=${state.sessionId}: ${messageOf(error)}`);
    }

    state.summary = content;
    this.logger.log(`[rolling-summary] 摘要已更新 session=${state.sessionId} batch=${batch.length}轮 chars=${content.length}`);
  }
}

/**
 * 会话键 (租户 + 会话).
 *
 * 为什么带租户: sessionId 只是"业务会话主键", 两个租户撞同一个 id 不是不可能 ——
 * 不带租户就是**跨租户串摘要** (把 A 租户来访者的内容说给 B 租户听).
 */
function sessionKey(tenantId: string, sessionId: string): string {
  return `${tenantId.length}:${tenantId}::${sessionId.length}:${sessionId}`;
}

/**
 * 错误转可读文案.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
