// V2026-10-28 治本 (WP0 · 引擎内核 · 会话内存实现):
//   职责: EngineSessionPort 的可运行实现, 把"端口形状"变成"能跑通的链路":
//         句柄登记 → 状态载入 → 状态落库 → 记忆写入 → 出参.
//         WP0 不含任何 BDI 推理 (那是 WP1), 但**链路本身是真的** —— 端口的
//         生命周期、状态仓储的乐观锁、记忆仓储的写入都真的跑起来了, 不是空壳.
//
//   边界: 纯 TS, 零 @nestjs/* / typeorm. 不含 NestJS 装饰器 —— 内核不在容器里.
//
//   为什么不自建 ID 工厂而用 nanoid:
//     nanoid 已在 package.json 依赖里 (纯 TS, 无原生依赖), 且本仓库 config/logger.config.ts
//     已在用. 内核要能整包搬走, 就不能引入只在某个运行时可用的依赖.
//
//   反双胞胎:
//     - 不在 openSession 里预载状态 —— 端口签名是同步的, 预载就必须改签名.
//       状态统一在 turn 里按需载入 (见 runtime/engine-session.port.ts 的说明).
//     - 不用进程级单例 (export const session = new InMemoryEngineSession()) ——
//       全局单例会让"多实例部署"这条路线当场封死; 调用方持有实例引用.
//     - 不把句柄表做成"module 级 Map" —— 同上, 状态归属实例, 不归属模块.
//     - 不在 turn 里 catch 仓储异常 —— 状态冲突 (STATE_CONFLICT) 必须冒泡给 adapter,
//       让 adapter 决定"重试 / 降级 / 报错"; 内核替它吞掉 = 并发丢状态无声化.
//     - 不写"本轮渲染文本"进记忆 —— WP0 的 reply 恒为空串; 等 WP5 有真实渲染后
//       再把"一问一答"成对写入 (见 rememberTurn 记忆写入处的 WP5 待办).
//
//   如何验证:
//     1. pnpm build 0 错
//     2. test/engine-core/engine-core.spec.ts: 直接 new 本类跑通 open → turn → close, 不启动 NestJS 容器

import { nanoid } from 'nanoid';
import { randomInt } from 'node:crypto';

import { planIntention } from '../cognition/intention-planner';
import { RuleBasedClassifier } from '../cognition/rule-based-classifier';
import { transitionState } from '../cognition/state-transition';
import { cloneBdiSnapshot } from '../domain/bdi-snapshot';
import { buildInitialSnapshot } from '../domain/bootstrap';
import type { CharacterProfile } from '../domain/character-profile';
import { EngineCoreError, EngineErrorCode } from '../domain/engine-errors';
import type { EngineSessionHandle, EngineTurnInput, EngineTurnOutput, OpenEngineSessionInput } from '../domain/engine-session.types';
import type { EventClassifier } from '../domain/events/session-event';
import type { BdiStateRecord, BdiStateRepository } from '../domain/ports/bdi-state.repository';
import { MemorySource, MemoryTier, type MemoryHit, type MemoryStore } from '../domain/ports/memory.store';
import { trimWorkingWindow, WORKING_MEMORY_WINDOW_TURNS } from '../memory/working-window';
import type { EngineSessionPort } from '../runtime/engine-session.port';

/** 工作记忆条目的默认重要度. WP0 无重要度算法 (属 WP2 遗忘机制), 取中性值. */
const WORKING_MEMORY_DEFAULT_IMPORTANCE = 0.5;

/**
 * 跨会话开场上下文的召回参数 (WP2 §5.4).
 *
 * 只取**高权重**长时记忆 —— 开场承接宁可少而准: 塞十条低权重旧话题进上下文,
 * 会把来访者的注意力带偏, 反而干扰本场推进.
 */
const OPENING_CONTEXT_MIN_IMPORTANCE = 0.5;
const OPENING_CONTEXT_LIMIT = 5;

/** 内部运行时会话 (句柄维度). */
interface EngineSessionRuntime {
  readonly handleId: string;
  readonly sessionId: string;
  readonly tenantId: string;
  readonly visitorId: string;
  /** 可复现性种子. 省略时由内核生成一次并固定在本句柄上. */
  readonly seed: number;
  /** 跨会话接续来源 (WP2); null = 全新会话. */
  readonly resumeFromSessionId: string | null;
  /** 角色内核基线 (WP1); 仅用于全新会话开场装配, 接续不覆盖. */
  readonly characterProfile: CharacterProfile | null;
  readonly openedAt: number;
  /** 已完成轮次. */
  turnIndex: number;
  /**
   * 工作记忆窗口 (WP2): 最近 N 轮文本, **仅运行时**, 不落库.
   *
   * 为什么不从记忆仓储里取工作记忆:
   *   工作记忆是咨询师原话 —— 会话内瞬时数据. 落进长时存储既有隐私面
   *   (原话变跨会话可检索), 也没必要 (窗口本身就是内存里的 N 条).
   */
  workingWindow: readonly string[];
}

/** 会话内存实现构造选项. */
export interface InMemoryEngineSessionOptions {
  /** BDI 状态仓储 (必传). */
  readonly bdiStates: BdiStateRepository;
  /** 记忆仓储 (必传). */
  readonly memories: MemoryStore;
  /** 句柄 id 工厂 (测试可注入确定性 id; 默认 nanoid). */
  readonly idFactory?: () => string;
  /** 时钟 (测试可注入; 默认 Date.now). */
  readonly now?: () => number;
  /** 事件分类器 (可注入替换规则轨; 默认 RuleBasedClassifier). */
  readonly classifier?: EventClassifier;
}

/** 会话内核的内存实现. */
export class InMemoryEngineSession implements EngineSessionPort {
  /** handleId → 运行时会话. */
  private readonly sessions = new Map<string, EngineSessionRuntime>();
  /** sessionId → handleId. 用于 O(1) 判重 (同一 sessionId 只能 open 一次). */
  private readonly handleIdBySessionId = new Map<string, string>();
  /** BDI 状态仓储. */
  private readonly bdiStates: BdiStateRepository;
  /** 记忆仓储. */
  private readonly memories: MemoryStore;
  /** 句柄 id 工厂. */
  private readonly idFactory: () => string;
  /** 时钟. */
  private readonly now: () => number;
  /** 事件分类器 (规则轨默认, 可注入替换). */
  private readonly classifier: EventClassifier;

  constructor(options: InMemoryEngineSessionOptions) {
    this.bdiStates = options.bdiStates;
    this.memories = options.memories;
    this.idFactory = options.idFactory ?? nanoid;
    this.now = options.now ?? Date.now;
    this.classifier = options.classifier ?? new RuleBasedClassifier();
  }

  openSession(input: OpenEngineSessionInput): EngineSessionHandle {
    this.assertOpenInput(input);

    if (this.handleIdBySessionId.has(input.sessionId)) {
      throw new EngineCoreError(
        EngineErrorCode.SESSION_ALREADY_OPEN,
        `InMemoryEngineSession.openSession: sessionId=${input.sessionId} 已存在活跃句柄`,
        {
          sessionId: input.sessionId,
        },
      );
    }

    const handleId = this.idFactory();
    const runtime: EngineSessionRuntime = {
      handleId,
      sessionId: input.sessionId,
      tenantId: input.tenantId,
      visitorId: input.visitorId,
      seed: input.seed ?? this.generateSeed(),
      resumeFromSessionId: input.resumeFromSessionId ?? null,
      characterProfile: input.characterProfile ?? null,
      openedAt: this.now(),
      turnIndex: 0,
      workingWindow: [],
    };

    this.sessions.set(handleId, runtime);
    this.handleIdBySessionId.set(runtime.sessionId, handleId);
    return { handleId, sessionId: runtime.sessionId };
  }

  async turn(handleId: string, input: EngineTurnInput): Promise<EngineTurnOutput> {
    const runtime = this.sessions.get(handleId);
    if (!runtime) {
      throw new EngineCoreError(EngineErrorCode.SESSION_NOT_FOUND, `InMemoryEngineSession.turn: handleId=${handleId} 未开启或已关闭`, {
        handleId,
      });
    }

    if (input.signal?.aborted) {
      throw new EngineCoreError(EngineErrorCode.ABORTED, `InMemoryEngineSession.turn: handleId=${handleId} 已被取消`, { handleId });
    }

    const userText = input.userText.trim();
    if (!userText) {
      throw new EngineCoreError(EngineErrorCode.INVALID_INPUT, `InMemoryEngineSession.turn: userText 不能为空白`, { handleId });
    }

    // 1. 载入本场状态 (含跨会话接续).
    const base = await this.loadState(runtime);
    // 2. WP1 认知管线: 事件分类 → 状态迁移 → 本轮意图 (规则轨, 确定性, 无随机).
    const events = this.classifier.classify(userText, {
      sensitiveTopics: runtime.characterProfile?.sensitiveTopics,
    });
    const nextSnapshot = transitionState(base.snapshot, events);
    const intention = planIntention(nextSnapshot, runtime.characterProfile ?? undefined);
    const record: BdiStateRecord = {
      tenantId: runtime.tenantId,
      sessionId: runtime.sessionId,
      revision: base.revision + 1,
      updatedAt: this.now(),
      snapshot: nextSnapshot,
    };
    // 3. 落库 (乐观锁: 冲突会冒泡为 STATE_CONFLICT).
    const saved = await this.bdiStates.save(record);
    // 4. 写工作记忆 + 维护运行时工作窗口 (WP2).
    await this.rememberTurn(runtime, userText);
    runtime.workingWindow = trimWorkingWindow([...runtime.workingWindow, userText], WORKING_MEMORY_WINDOW_TURNS);
    // 5. 推进轮次.
    runtime.turnIndex += 1;
    // 6. 跨会话开场上下文 (WP2): 仅 resume 会话的首论携带.
    //    刻意放在最后 —— 它只挂出参, 不参与上面的 BDI 决策, 也不改快照数值.
    const openingContext = await this.collectOpeningContext(runtime, userText);

    return {
      reply: '',
      snapshot: cloneBdiSnapshot(saved.snapshot),
      turnIndex: runtime.turnIndex,
      intention,
      ...(openingContext.length > 0 ? { openingContext } : {}),
    };
  }

  closeSession(handleId: string): void {
    const runtime = this.sessions.get(handleId);
    if (!runtime) return; // 幂等: 关闭路径不抛错 (见端口契约说明).
    this.sessions.delete(handleId);
    // 只有当映射仍指向本句柄时才删 —— 防止"旧的 close"误删"新 open 的同 sessionId".
    if (this.handleIdBySessionId.get(runtime.sessionId) === handleId) {
      this.handleIdBySessionId.delete(runtime.sessionId);
    }
  }

  /** 当前活跃句柄数 (观测 / 测试用; 不属于端口契约). */
  activeSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * 本场工作记忆窗口 (最近 N 轮文本) (观测 / 测试用; 不属于端口契约).
   *
   * 窗口是**运行时**状态, 不落库 —— 供 WP5 渲染时取"最近上下文", 也供单测
   * 验证窗口裁剪. 句柄不存在时返回空数组 (不抛错: 观测接口不该把调用搞崩).
   */
  workingContext(handleId: string): readonly string[] {
    return this.sessions.get(handleId)?.workingWindow ?? [];
  }

  // ── private ────────────────────────────────────────────────────

  /**
   * 载入本场起始状态.
   *
   * 优先级: 本场已有状态 > 跨会话接续来源 > 全空快照.
   * 接续时**只搬快照, 不搬版本号** —— 新会话的版本链从 0 起算, 否则会把上一场
   * 的版本号带过来, 让乐观锁的语义变得不可解释 (新会话与旧会话共享一条版本链).
   */
  private async loadState(runtime: EngineSessionRuntime): Promise<BdiStateRecord> {
    const current = await this.bdiStates.load(runtime.tenantId, runtime.sessionId);
    if (current) return current;

    if (runtime.resumeFromSessionId) {
      const resumed = await this.bdiStates.load(runtime.tenantId, runtime.resumeFromSessionId);
      if (resumed) {
        return {
          tenantId: runtime.tenantId,
          sessionId: runtime.sessionId,
          revision: 0,
          updatedAt: this.now(),
          snapshot: cloneBdiSnapshot(resumed.snapshot),
        };
      }
    }

    return {
      tenantId: runtime.tenantId,
      sessionId: runtime.sessionId,
      revision: 0,
      updatedAt: this.now(),
      // 全新会话: 按角色 profile 装配初始基线; 无 profile 回落中性默认.
      // resume 接续分支在上方, 直接搬上一场快照, 不用 profile 覆盖.
      snapshot: buildInitialSnapshot(runtime.characterProfile ?? undefined),
    };
  }

  /**
   * 写入本轮工作记忆.
   *
   * WP0 只记咨询师这一侧文本 (来访侧 reply 恒为空串, 无内容可记).
   * WP5 落地渲染后, 在此处把"问 + 答"成对写入, 否则工作记忆只有半边对话.
   *
   * 带 visitorId: 让每条记忆都能追到稳定来访者 (跨会话归属 / 按来访者删除的依据).
   */
  private async rememberTurn(runtime: EngineSessionRuntime, userText: string): Promise<void> {
    await this.memories.remember({
      id: this.idFactory(),
      tenantId: runtime.tenantId,
      visitorId: runtime.visitorId,
      sessionId: runtime.sessionId,
      tier: MemoryTier.WORKING,
      source: MemorySource.TURN,
      content: userText,
      importance: WORKING_MEMORY_DEFAULT_IMPORTANCE,
      occurredAt: this.now(),
    });
  }

  /**
   * 采集跨会话开场上下文 (WP2 §5.4).
   *
   * 触发条件: **resume 会话的首论** (turnIndex === 1). 其余轮次不重复召回 ——
   * 开场上下文只在开场用一次, 每轮都塞一遍既浪费查询又会稀释当前议题.
   *
   * 召回口径: scope=visitor + tiers=[LONG_TERM] + minImportance=0.5 + limit=5.
   *
   * 失败处理: 吞掉异常返回空数组 —— 开场上下文是**锦上添花**, 取不到不该让整轮
   * 失败. 真正的存储故障由 B 层适配器自己记 warn (它有 logger), 内核不重复告警.
   */
  private async collectOpeningContext(runtime: EngineSessionRuntime, query: string): Promise<readonly MemoryHit[]> {
    if (!runtime.resumeFromSessionId) return [];
    if (runtime.turnIndex !== 1) return [];
    try {
      return await this.memories.recall({
        tenantId: runtime.tenantId,
        sessionId: runtime.sessionId,
        visitorId: runtime.visitorId,
        scope: 'visitor',
        query,
        tiers: [MemoryTier.LONG_TERM],
        minImportance: OPENING_CONTEXT_MIN_IMPORTANCE,
        limit: OPENING_CONTEXT_LIMIT,
      });
    } catch {
      return [];
    }
  }

  private assertOpenInput(input: OpenEngineSessionInput): void {
    if (!input.sessionId?.trim()) {
      throw new EngineCoreError(EngineErrorCode.INVALID_INPUT, 'InMemoryEngineSession.openSession: sessionId 不能为空');
    }
    if (!input.tenantId?.trim()) {
      throw new EngineCoreError(EngineErrorCode.INVALID_INPUT, 'InMemoryEngineSession.openSession: tenantId 不能为空');
    }
    if (!input.visitorId?.trim()) {
      throw new EngineCoreError(EngineErrorCode.INVALID_INPUT, 'InMemoryEngineSession.openSession: visitorId 不能为空');
    }
    if (input.resumeFromSessionId !== undefined && input.resumeFromSessionId.trim() === '') {
      throw new EngineCoreError(
        EngineErrorCode.INVALID_INPUT,
        'InMemoryEngineSession.openSession: resumeFromSessionId 不能是空串 (省略即表示不接续)',
      );
    }
  }

  /**
   * 生成可复现性种子.
   *
   * 用 node:crypto 的 randomInt 而非 Math.random: 后者是非密码学伪随机源
   * (sonarjs/pseudo-random); 种子会进入状态复现链, 应取安全随机. node:crypto
   * 是 Node 标准库, 不引入第三方框架依赖, 内核将来独立成 Node 微服务依然可用.
   */
  private generateSeed(): number {
    return randomInt(0, 2 ** 31);
  }
}
