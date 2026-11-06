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
//
//   V2026-11-06 治本 (WP38 · 事件分类只读出口):
//   职责: turn() 的出参挂上本轮事件分类 (events), 让调试面板能显示"这一轮咨询师
//         说了什么 techniques" (共情 / 开放提问 / 评判…).
//   边界: **纯加观测字段** —— 决策路径与数值**逐字不变**:
//     · 事件是分类器**已经算出来**的 (第 3 步的局部变量), 这里只是把 kind 抄进出参;
//     · 不参与状态迁移 / delta 聚合 / 意图规划 (那三处仍吃同一个 events 数组);
//     · 不带命中词明细 (内核内部产物, 不对外).
//   为什么由内核填 (而不是适配层预判):
//     事件分类是内核的**唯一真相**; 适配层另算一套就会与内核漂移, 而调试面板的
//     职责恰恰是"看内核到底怎么判" —— 预判出来的标签会骗人.
//   零回归: 事件为空时**不挂**该字段 (同 openingContext / trajectoryTrace 的口径).

import { nanoid } from 'nanoid';
import { randomInt } from 'node:crypto';

import type { AllianceConfig } from '../cognition/alliance-config.js';
import { planIntention } from '../cognition/intention-planner.js';
import {
  modulateDeltaByPersonality,
  type PersonalityModulationInput,
  type PersonalityModulatorConfig,
} from '../cognition/personality-modulator.js';
import { RuleBasedClassifier } from '../cognition/rule-based-classifier.js';
import { assessSafety } from '../cognition/safety/assess-safety.js';
import { applySessionDecay, type SessionDecayConfig } from '../cognition/session-decay.js';
import {
  addDeltaVectors,
  aggregateTurnDelta,
  applyDeltaVector,
  buildDeltaCapReport,
  capTurnDelta,
  notifyDeltaCap,
  transitionState,
  applyBeliefEvolution,
  type DeltaCapConfig,
  type DeltaCapObserver,
  type DeltaVector,
} from '../cognition/state-transition.js';
import { planAct } from '../cognition/trajectory/act-cursor.js';
import { applyTrajectory } from '../cognition/trajectory/trajectory-applier.js';
import { evaluateTrigger, type MatchContext } from '../cognition/trajectory/trigger-evaluate.js';
import { cloneBdiSnapshot, type BdiSnapshot } from '../domain/bdi-snapshot.js';
import { buildInitialSnapshot } from '../domain/bootstrap.js';
import type { CharacterProfile } from '../domain/character-profile.js';
import { EngineCoreError, EngineErrorCode } from '../domain/engine-errors.js';
import type {
  EngineSessionHandle,
  EngineTurnInput,
  EngineTurnOutput,
  OpenEngineSessionInput,
  WorkingWindowOverflowEvent,
} from '../domain/engine-session.types.js';
import type { EventClassifier, SessionEvent } from '../domain/events/session-event.js';
import type { Intention } from '../domain/intention.js';
import type { BdiStateRecord, BdiStateRepository } from '../domain/ports/bdi-state.repository.js';
import { MemorySource, MemoryTier, type MemoryHit, type MemoryStore } from '../domain/ports/memory.store.js';
import type { RiskProbePort } from '../domain/ports/risk-probe.js';
import type { SafetyEvent, SafetyLevel, SafetyReport, SafetyVerdict } from '../domain/safety/safety-types.js';
import {
  orderedTrajectoryNodes,
  validateTrajectoryScript,
  type TrajectoryScript,
  type TrajectoryTrace,
} from '../domain/trajectory/script.js';
import { overflowedWorkingWindowLines, trimWorkingWindow, WORKING_MEMORY_WINDOW_TURNS } from '../memory/working-window.js';
import type { EngineSessionPort } from '../runtime/engine-session.port.js';

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

/**
 * 安全事件里保存的命中片段最大长度 (WP4).
 *
 * 片段是给督导"回看当时说了什么"用的, 不是识别依据 —— 完整原文已落在
 * 工作记忆里, 报告里再抄一份全文等于把敏感对话复制进第二个存储面.
 */
const SAFETY_SNIPPET_MAX_LENGTH = 120;

/**
 * 轨迹运行时 (WP3): 剧本 + 游标 + 已激活幕 + 终态.
 *
 * 全部**进程内瞬时**, 不落库:
 *   - 剧本由 adapter 注入, 内核不持久化 (任务单 M8);
 *   - 游标与终态是"这场对话走到哪"的进度, 属会话运行态;
 *   - 跨进程持久化 (暂停/恢复/归档) 留装配轮, 本期不做.
 *
 * 挂在**句柄**上而不是全局: 剧本与游标随句柄实例持有, 不跨句柄共享, 不串场.
 */
interface TrajectoryRuntime {
  readonly script: TrajectoryScript;
  /** 游标: 下一个待进入幕的有效 order, 只增不减、不跳幕、不回退. */
  cursor: number;
  /** 已进入过 (激活过) 的幕 order 集合, 用于去重. */
  readonly activatedOrders: Set<number>;
  /** 已进入过的幕 id 清单 (按进入顺序), 供督导看推进轨迹. */
  readonly visitedNodeIds: string[];
  /** 终态: null = 未终结. 终态后不再推进、不再叠加 delta. */
  outcome: 'completed' | 'aborted' | null;
}

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
  /** 轨迹运行时 (WP3); null = 本场无剧本约束. */
  trajectory: TrajectoryRuntime | null;
  /**
   * 本场安全事件 (WP4): **只累计 warn / block**, 进程内存, 不落库.
   *
   * 为什么 pass 不累计: 干净对话的每一轮都记一条 pass, 报告就被噪声淹没了 ——
   * 报告要看的是"哪里出过问题", 不是"哪里没问题".
   */
  readonly safetyEvents: SafetyEvent[];
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
  /**
   * 可选风险探测端口 (WP4; 未来 PsyGUARD 适配).
   *
   * 缺省 = 纯规则判定. 注入 = 规则未达 block 时才问探测, 超时/抛错自动回落规则.
   * 走构造注入而不是开场入参: 探测是**行为依赖**, 开场对象是可序列化的会话参数.
   */
  readonly riskProbe?: RiskProbePort;
  /**
   * 单回合 delta cap 配置 (WP26 · P2-14: 内核不再读 env, 由 adapter 读好注入).
   *
   * 缺省 = 内核种子值 (`DEFAULT_DELTA_CAP_CONFIG`). 为什么是**构造注入**而不是
   * 每次 turn 传: cap 是**部署形态**的决定 (内测期要按真实对话调参), 不是会话参数;
   * 放构造上 = 一场会话内口径恒定, 换配置 = 换实例, 不会出现"同一场里前后两轮
   * cap 不一样"这种无法复现的漂移.
   */
  readonly capConfig?: DeltaCapConfig;
  /**
   * cap 报告观察者 (WP26 · P2-11/P2-12/P2-14).
   *
   * 缺省 = 不观测 (内核照常砍幅, 只是没人打日志). 观察者拿到的是**本轮总 delta**
   * 的砍幅 (事件 + 剧本合并后), 且报告自带 sessionId / handleId —— 多人内测时
   * 运维能直接定位到是哪场会话被砍.
   */
  readonly capObserver?: DeltaCapObserver;
  /**
   * 人格调节配置 (WP34 · 与 cap 同款注入范式).
   *
   * 缺省 = 内核种子值 (`DEFAULT_PERSONALITY_MODULATOR_CONFIG`).
   * 为什么是**构造注入**而不是每次 turn 传: 与 cap 同理 —— 人格系数是**部署形态**的
   * 决定 (内测期要按真实对练校准), 不是会话参数; 放构造上 = 一场会话内口径恒定.
   *
   * ⚠️ 角色侧数据 (依恋类型 / 人格特质) 走**开场参数** `characterProfile`,
   * 不走这里: 系数是部署级的, 角色是会话级的.
   */
  readonly personalityModulatorConfig?: PersonalityModulatorConfig;
  /**
   * 同盟三维配置 (WP42 · 与 cap / 人格同款注入范式).
   *
   * 缺省 = 内核种子值 (DELTA_TABLE 的基础系数 + 种子门槛).
   * 为什么是**构造注入**而不是每次 turn 传: 与 cap 同理 —— 同盟三维的系数与门槛
   * 是**部署形态**的决定 (内测期按真实对练校准), 不是会话参数; 放构造上 =
   * 一场会话内口径恒定, 不会出现"同一场里前后两轮门槛不一样"的漂移.
   */
  readonly allianceConfig?: AllianceConfig;
  /**
   * 跨会话间隔衰减配置 (WP36 · 与 cap / 人格 / 同盟同款注入范式).
   *
   * 缺省 = 内核种子值 (`DEFAULT_SESSION_DECAY_CONFIG`: 情绪 7 天 / 阻抗 14 天 / 同盟 30 天).
   * 为什么是**构造注入**而不是每次 turn 传: 半衰期是**部署形态**的决定
   * (内测期要按真实对练校准), 不是会话参数; 放构造上 = 一场会话内口径恒定.
   *
   * ⚠️ 系数是**工程种子值, 非临床标定** —— 待真实对练校准.
   */
  readonly sessionDecayConfig?: SessionDecayConfig;
  /**
   * 工作窗口溢出回调 (WP37 · 与 cap / 人格 / 同盟 / 衰减同款注入范式).
   *
   * 缺省 = 不回调 (工作窗口照旧裁剪, 行为与 WP2 **逐字一致**).
   * 触发时机: 本轮内容把工作记忆窗口 (最近 8 轮) 挤掉最旧的轮次时, **同步**回调一次,
   * 把被挤出的轮次交给适配层.
   *
   * 为什么内核只交出文本、不自己做摘要:
   *   摘要要调 LLM —— 内核零网络 / 零 prompt (boundary.spec.ts 断言①②④守着).
   *   内核负责"**什么时候**该压缩" (窗口裁剪是内核的策略), 适配层负责"**怎么**压缩".
   *
   * 为什么回调带归属三件套 (tenantId / sessionId / visitorId):
   *   适配层要把摘要写成记忆条目 —— MemoryEntry 契约强制要求 tenantId + sessionId;
   *   且滚动摘要的状态必须按会话隔离 (两个租户撞同一个 sessionId 时不能串).
   *   只交"被挤出的文本"是写不出合法记忆条目的.
   */
  readonly onWorkingWindowOverflow?: (event: WorkingWindowOverflowEvent) => void;
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
  /** 风险探测端口 (WP4; 可选, 缺省纯规则). */
  private readonly riskProbe: RiskProbePort | undefined;
  /** 单回合 delta cap 配置 (WP26 · P2-14). */
  private readonly capConfig: DeltaCapConfig | undefined;
  /** cap 报告观察者 (WP26 · P2-11/P2-12/P2-14). */
  private readonly capObserver: DeltaCapObserver | undefined;
  /** 人格调节配置 (WP34 · 缺省 = 内核种子值). */
  private readonly personalityModulatorConfig: PersonalityModulatorConfig | undefined;
  /** 同盟三维配置 (WP42 · 缺省 = 内核种子值). */
  private readonly allianceConfig: AllianceConfig | undefined;
  /** 跨会话间隔衰减配置 (WP36 · 缺省 = 内核种子值). */
  private readonly sessionDecayConfig: SessionDecayConfig | undefined;
  /** 工作窗口溢出回调 (WP37 · 缺省 = 不回调). */
  private readonly onWorkingWindowOverflow: ((event: WorkingWindowOverflowEvent) => void) | undefined;

  constructor(options: InMemoryEngineSessionOptions) {
    this.bdiStates = options.bdiStates;
    this.memories = options.memories;
    this.idFactory = options.idFactory ?? nanoid;
    this.now = options.now ?? Date.now;
    this.classifier = options.classifier ?? new RuleBasedClassifier();
    this.riskProbe = options.riskProbe;
    this.capConfig = options.capConfig;
    this.capObserver = options.capObserver;
    this.personalityModulatorConfig = options.personalityModulatorConfig;
    this.allianceConfig = options.allianceConfig;
    this.sessionDecayConfig = options.sessionDecayConfig;
    this.onWorkingWindowOverflow = options.onWorkingWindowOverflow;
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
      trajectory: this.createTrajectoryRuntime(input.trajectory),
      safetyEvents: [],
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
    // 2. 只读安全步 (WP4): 在 BDI 之前判定, 但**只读不改** ——
    //    快照 / Intention / 轨迹游标一概不动, 内核只给 adapter 一个信号;
    //    是否拦下这一轮提交由表现层决定 (内核只判定不拦截, 任务单 M1/M2).
    //    探测端口未注入时是纯规则判定, 与 WP1–WP3 逐字一致.
    const safetyVerdict = await assessSafety({ text: userText, side: 'counselor_input', probe: this.riskProbe });
    this.recordSafetyEvent(runtime, safetyVerdict, userText);
    // 3. WP1 认知管线: 事件分类 → 状态迁移 → 本轮意图 (规则轨, 确定性, 无随机).
    const events = this.classifier.classify(userText, {
      sensitiveTopics: runtime.characterProfile?.sensitiveTopics,
    });
    //    人格调节输入 (WP34): 角色的依恋类型 / 人格特质 + 调节端口 + 本轮事件.
    //    **两处**消费它 (临时快照 / 落库路径) —— 两处口径必须一致, 否则 provisional
    //    (供意图规划与轨迹触发判定) 与落库快照会漂.
    const personality = this.personalityInput(runtime, events);
    //    事件 delta 的**原始**值留一份 —— WP26 P2-12: 本轮总 delta = 事件 + 剧本,
    //    要合并后统一过一次 cap, 所以分子必须是原始量, 不能是"已砍过的量".
    //    WP34: 聚合之后先过**人格调节**, 再进 cap (同一管道, 调节不得绕过 cap).
    //    WP42: 同盟三维的 safety / bond 走**同一个端口** (构造注入), 口径与
    //    临时快照 / 落库路径必须一致 —— 否则两处会漂.
    const eventDelta = modulateDeltaByPersonality(aggregateTurnDelta(events, this.allianceConfig), personality);
    //    临时快照: 只按事件 delta 推进 (供意图规划与轨迹触发判定) ——
    //    它是**中间量**, 不是本轮落库的状态 (落库口径见第 5 步).
    const provisional = transitionState(base.snapshot, events, {
      capConfig: this.capConfig,
      personality,
      alliance: this.allianceConfig,
      // WP57: 信念激活的匹配源 (咨询师原文).
      //   临时快照与落库快照**两处口径必须一致** —— 两处都从 base.snapshot 出发,
      //   所以不会重复演化 (各演一次, 结果相同).
      counselorText: userText,
    });
    const intention = planIntention(provisional, runtime.characterProfile ?? undefined, this.allianceConfig);
    // 4. 轨迹步 (WP3): BDI 自由规划**之后**、落库**之前**.
    //    BDI 永远先发生, 轨迹只做后处理 —— 于是"同一段行为在开/关轨迹两种配置下"
    //    可以直接对比, 轨迹出问题时也能回退到纯 BDI (任务单 M1).
    //    WP26 P2-12: 本步**只取意图合成与本轮原始轨迹偏移**, 不落快照 ——
    //    快照由第 5 步按"总 delta 过一次 cap"统一落, 避免旧路径那种
    //    "事件 delta 已 cap + 剧本 delta 未 cap" 的 2 倍 cap 跳变.
    const trajectory = this.applyTrajectoryStep(runtime, events, userText, intention, provisional);
    // 5. WP26 P2-12: 本轮**总** delta = 事件 delta + 剧本 delta.
    //    cap 管的是"一回合最多能动多少", 与 delta 的来源无关 —— 剧本作者写死的
    //    偏移同样是"这一轮来访内心状态被改动了一次", 必须与事件 delta 一起受同一把尺子.
    const totalDelta = trajectory.delta ? addDeltaVectors(eventDelta, trajectory.delta) : eventDelta;
    const cappedTotal = capTurnDelta(totalDelta, this.capConfig);
    //    WP57: 信念演化 (核心信念激活 + 短期信念置信度衰减) 落在**本轮落库快照**上.
    //    为什么落库路径要单独接一次 (而不是只靠 transitionState):
    //      落库口径是"事件 delta + 剧本 delta 合并后统一过一次 cap" (WP26 P2-12),
    //      走的是 `applyDeltaVector` 而不是 `transitionState` —— 只在 transitionState
    //      里接信念算子, 落库快照就**永远不会**带上信念演化 (机制空转).
    //    两处口径必须一致: 临时快照 (transitionState) 与落库快照都从 base.snapshot 出发,
    //    各自演一次, 结果相同.
    const nextSnapshot = applyBeliefEvolution(applyDeltaVector(base.snapshot, cappedTotal), userText);
    //    报告口径 = 总 delta (不是事件 delta): 运维看到的就是"这一轮实际被砍了多少".
    notifyDeltaCap(
      this.capObserver,
      buildDeltaCapReport(totalDelta, cappedTotal, events, {
        sessionId: runtime.sessionId,
        handleId: runtime.handleId,
      }),
    );
    const record: BdiStateRecord = {
      tenantId: runtime.tenantId,
      sessionId: runtime.sessionId,
      revision: base.revision + 1,
      updatedAt: this.now(),
      snapshot: nextSnapshot,
    };
    // 6. 落库 (乐观锁: 冲突会冒泡为 STATE_CONFLICT).
    const saved = await this.bdiStates.save(record);
    // 7. 写工作记忆 + 维护运行时工作窗口 (WP2).
    await this.rememberTurn(runtime, userText);
    //    WP37: 被挤出窗口的轮次交给适配层做**滚动摘要** (内核零 LLM / 零网络 / 零 prompt).
    //    溢出判定走纯函数 overflowedWorkingWindowLines (窗口保尾弃头 → 被挤出的是队首).
    const overflowed = overflowedWorkingWindowLines(runtime.workingWindow, userText, WORKING_MEMORY_WINDOW_TURNS);
    runtime.workingWindow = trimWorkingWindow([...runtime.workingWindow, userText], WORKING_MEMORY_WINDOW_TURNS);
    if (overflowed.length > 0) {
      this.notifyWindowOverflow(runtime, overflowed);
    }
    // 8. 推进轮次.
    runtime.turnIndex += 1;
    // 9. 跨会话开场上下文 (WP2): 仅 resume 会话的首论携带.
    //    刻意放在最后 —— 它只挂出参, 不参与上面的 BDI 决策, 也不改快照数值.
    const openingContext = await this.collectOpeningContext(runtime, userText);

    return {
      reply: '',
      snapshot: cloneBdiSnapshot(saved.snapshot),
      turnIndex: runtime.turnIndex,
      intention: trajectory.intention,
      ...(openingContext.length > 0 ? { openingContext } : {}),
      ...(trajectory.trace ? { trajectoryTrace: trajectory.trace } : {}),
      // 安全判定只在非 pass 时挂出 (pass 的空块会污染出参, 破坏零回归).
      ...(safetyVerdict.level === 'pass' ? {} : { safety: safetyVerdict }),
      // WP38: 事件分类 (只读观测) —— 内核自己填, 适配层只透传; 空则不挂 (零回归).
      ...(events.length > 0 ? { events: events.map((event) => event.kind) } : {}),
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

  /**
   * 本场伦理风险报告 (WP4 · 观测 / 测试用, 不属于端口契约).
   *
   * 口径:
   *   - 只累计 warn / block (pass 不落事件);
   *   - maxLevel 取已累计事件的最高等级, 无事件 → pass;
   *   - events 返回**数组副本**: 调用方随便改都不会回写内部状态.
   *
   * 句柄不存在 → 返回空报告 (不抛: 观测接口不该把调用搞崩, 同 WP3 口径).
   *
   * ⚠️ `closeSession` 只删句柄登记, 事件随之释放 —— 需要报告的调用方必须
   * **在 closeSession 之前**取走. 报告落库/入档案属装配轮 (本期不落库).
   *
   * @param handleId 会话句柄
   * @returns 会话内累计的伦理风险报告
   */
  getSafetyReport(handleId: string): SafetyReport {
    const runtime = this.sessions.get(handleId);
    const events = runtime?.safetyEvents ?? [];
    let maxLevel: SafetyLevel = 'pass';
    let blockCount = 0;
    let warnCount = 0;
    for (const event of events) {
      if (event.verdict.level === 'block') {
        blockCount += 1;
        maxLevel = 'block';
        continue;
      }
      if (event.verdict.level === 'warn') {
        warnCount += 1;
        if (maxLevel !== 'block') maxLevel = 'warn';
      }
    }
    return {
      sessionId: runtime?.sessionId ?? '',
      maxLevel,
      blockCount,
      warnCount,
      events: [...events],
    };
  }

  // ── private ────────────────────────────────────────────────────

  /**
   * 载入本场起始状态.
   *
   * 优先级: 本场已有状态 > 跨会话接续来源 > 全空快照.
   * 接续时**只搬快照, 不搬版本号** —— 新会话的版本链从 0 起算, 否则会把上一场
   * 的版本号带过来, 让乐观锁的语义变得不可解释 (新会话与旧会话共享一条版本链).
   *
   * V2026-11-03 (WP36): 接续时**按间隔做自然衰减** —— 不再把上一场的快照原样搬过来.
   *   隔了一周再来, 情绪该平复、阻抗该回落, 但关系不该清零 (衰减恒 > 0, 渐近不归零).
   *   间隔取 `resumed.updatedAt` (上一场最后一次落库时刻) 与当前时刻之差.
   *
   *   为什么衰减**只发生一次** (而不是每轮都衰减):
   *     本方法每轮都调, 但"本场已有状态"分支会先命中 —— 只有本场**第一轮**才会走到
   *     接续分支. 第一轮算出的衰减值随本轮 delta 一起落库, 之后各轮读的是本场自己的
   *     状态 (不再衰减). 于是"衰减"是**跨场边界的一次性事件**, 不是持续时间流逝的副作用.
   */
  private async loadState(runtime: EngineSessionRuntime): Promise<BdiStateRecord> {
    const current = await this.bdiStates.load(runtime.tenantId, runtime.sessionId);
    if (current) return current;

    if (runtime.resumeFromSessionId) {
      const resumed = await this.bdiStates.load(runtime.tenantId, runtime.resumeFromSessionId);
      if (resumed) {
        const ageMs = this.now() - resumed.updatedAt;
        return {
          tenantId: runtime.tenantId,
          sessionId: runtime.sessionId,
          revision: 0,
          updatedAt: this.now(),
          snapshot: applySessionDecay(resumed.snapshot, ageMs, this.sessionDecayConfig),
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
   * 通知适配层: 工作窗口挤出了这些轮次 (WP37).
   *
   * 失败处理: **吞掉异常** —— 与 collectOpeningContext 同款理由:
   *   摘要是**增强** (锦上添花), 摘要服务挂了不该让整轮对练失败;
   *   内核零 logger 依赖, 适配层自己的日志才是错因现场.
   *
   * @param runtime 运行时会话
   * @param overflowed 被挤出窗口的轮次 (按时间正序)
   */
  private notifyWindowOverflow(runtime: EngineSessionRuntime, overflowed: readonly string[]): void {
    if (!this.onWorkingWindowOverflow) return;
    try {
      this.onWorkingWindowOverflow({
        tenantId: runtime.tenantId,
        sessionId: runtime.sessionId,
        visitorId: runtime.visitorId,
        pushedOut: [...overflowed],
      });
    } catch {
      // 故意不记日志: 内核不持有 logger (零框架依赖), 适配层自己知道自己的失败.
    }
  }

  /**
   * 累计一条安全事件 (WP4).
   *
   * 只记 warn / block: pass 不记 —— 报告要看的是"哪里出过问题".
   * 片段截断保存 (全文已在工作记忆里), 报告不必再抄一份敏感原文.
   *
   * @param runtime 运行时会话
   * @param verdict 本轮判定
   * @param text 咨询师本轮文本
   */
  private recordSafetyEvent(runtime: EngineSessionRuntime, verdict: SafetyVerdict, text: string): void {
    if (verdict.level === 'pass') return;
    runtime.safetyEvents.push({
      turnIndex: runtime.turnIndex + 1,
      at: this.now(),
      verdict,
      snippet: text.slice(0, SAFETY_SNIPPET_MAX_LENGTH),
    });
  }

  /**
   * 构造轨迹运行时 (WP3).
   *
   * 剧本形状在**开场**就校验: 一条非法剧本不该拖到第 5 轮才炸 —— 开场失败意味着
   * "这场根本不该开始", 比中途炸更干净. 校验集中在 validateTrajectoryScript.
   *
   * @param script 注入的剧本; 省略 = 本场无轨迹约束
   * @returns 轨迹运行时; 无剧本时 null
   */
  private createTrajectoryRuntime(script: TrajectoryScript | undefined): TrajectoryRuntime | null {
    if (!script) return null;
    validateTrajectoryScript(script);
    return {
      script,
      cursor: 0,
      activatedOrders: new Set<number>(),
      visitedNodeIds: [],
      outcome: null,
    };
  }

  /**
   * 轨迹步 (WP3 §5.8): 推进游标 → 合成 → 记账 → 判终态.
   *
   * 无剧本时**原样返回** (与 WP1/WP2 逐字一致, 零回归硬要求);
   * 终态后 BDI 自由运行, 游标冻结, 不再推进/叠加, 本轮不再写 outcome ——
   * outcome 描述的是"本轮发生的终态事件", 不是会话的持久状态.
   *
   * V2026-11-03 治本 (WP26 · P2-12): 本步**不再返回快照** ——
   *   快照由调用方按"事件 delta + 剧本 delta = 本轮总 delta, 统一过一次 cap"落.
   *   本步只负责交出两样东西: 合成后的意图 + 本轮叠加的**原始**剧本偏移.
   *
   * @param runtime 运行时会话
   * @param events 本轮分类出的标准事件
   * @param userText 咨询师本轮文本
   * @param intention BDI 自由规划出的意图
   * @param snapshot 本轮状态迁移后的临时快照 (供幕触发判定用)
   * @returns 最终意图 / 本轮原始轨迹偏移 / 本轮轨迹观测
   */
  private applyTrajectoryStep(
    runtime: EngineSessionRuntime,
    events: readonly SessionEvent[],
    userText: string,
    intention: Intention,
    snapshot: BdiSnapshot,
  ): { readonly intention: Intention; readonly delta?: DeltaVector; readonly trace?: TrajectoryTrace } {
    const trajectory = runtime.trajectory;
    if (!trajectory) return { intention };

    const script = trajectory.script;
    if (trajectory.outcome !== null) {
      return {
        intention,
        trace: {
          scriptId: script.scriptId,
          mode: script.mode,
          activated: false,
          advanced: false,
          cursor: trajectory.cursor,
          visitedNodeIds: [...trajectory.visitedNodeIds],
        },
      };
    }

    // turnIndex 取**本轮轮次号 (从 1 起)**, 与出参 turnIndex 同口径.
    const ctx: MatchContext = { events, userText, turnIndex: runtime.turnIndex + 1, snapshot };
    const plan = planAct(script, trajectory.cursor, ctx, trajectory.activatedOrders);
    const applied = applyTrajectory(script.mode, intention, snapshot, plan);

    // 记账: 游标推进 + 已进入的幕 (等待轮不算"进入", 不记 visited).
    const advanced = plan.nextCursor !== trajectory.cursor;
    if (plan.node && plan.enterNewAct) {
      const entered = orderedTrajectoryNodes(script).find((item) => item.node === plan.node);
      if (entered) {
        trajectory.activatedOrders.add(entered.order);
        trajectory.visitedNodeIds.push(plan.node.nodeId);
      }
    }
    trajectory.cursor = plan.nextCursor;

    // 终态判定: abort 优先于 completion (任务单 M9).
    let outcome: 'completed' | 'aborted' | undefined;
    if (plan.aborted) {
      trajectory.outcome = 'aborted';
      outcome = 'aborted';
    } else if (evaluateTrigger(script.completion.when, ctx)) {
      trajectory.outcome = 'completed';
      outcome = 'completed';
    }

    return {
      intention: applied.intention,
      // WP26 P2-12: 把本轮叠加的**原始**剧本偏移交出去 —— 调用方拿它与事件 delta
      // 合并后统一过一次 cap (本文件不落快照, 免得绕开 cap).
      ...(applied.delta ? { delta: applied.delta } : {}),
      trace: {
        scriptId: script.scriptId,
        mode: script.mode,
        activated: applied.activated,
        ...(plan.node ? { activeNodeId: plan.node.nodeId } : {}),
        advanced,
        cursor: trajectory.cursor,
        visitedNodeIds: [...trajectory.visitedNodeIds],
        ...(outcome ? { outcome } : {}),
      },
    };
  }

  /**
   * 组装本轮的人格调节输入 (WP34).
   *
   * 数据来源分层:
   *   · 角色侧 (依恋类型 / 人格特质) → 开场参数 `characterProfile` (会话级);
   *   · 系数 (调节端口) → 构造注入 `personalityModulatorConfig` (部署级);
   *   · 本轮事件 → 用于判定"共情回应" (宜人性规则).
   *
   * 缺省处理: 角色没带依恋类型 → 系数全 1.0 (逐字不变); 没带人格特质 → 不做特质调节.
   *
   * @param runtime 运行时会话
   * @param events 本轮分类出的标准事件
   * @returns 人格调节输入
   */
  private personalityInput(runtime: EngineSessionRuntime, events: readonly SessionEvent[]): PersonalityModulationInput {
    const profile = runtime.characterProfile;
    return {
      events,
      ...(profile?.attachmentStyle ? { attachmentStyle: profile.attachmentStyle } : {}),
      ...(profile?.personalityTraits ? { traits: profile.personalityTraits } : {}),
      ...(this.personalityModulatorConfig ? { config: this.personalityModulatorConfig } : {}),
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
