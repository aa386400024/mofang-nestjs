// V2026-10-29 治本 (WP8-B · B 层 · 引擎 → voice 对话后端适配):
//   职责: 实现 voice 侧的窄接口 `VoiceTurnBackend` —— 把新引擎的"决策 → 流式渲染"
//         翻译成语音链路熟悉的三态 chunk (content / done / error), 并维护
//         逐字稿副本 (供督导报告).
//   边界: 装配层 (src/engine-adapters/wiring/); 只做**翻译与记账**, 不写决策、
//         不拼 prompt、不碰 TTS/ASR/帧协议.
//
//   为什么这个适配器住在 wiring 而不是 rendering:
//     它依赖 `EngineTurnService` (wiring 层的东西), 而 wiring 又依赖 rendering ——
//     若把适配器放在 rendering, 就成了 rendering → wiring → rendering 的**目录环**.
//     它的职责本来就是"装配": 把一个子系统 (引擎) 的形状翻译成另一个子系统
//     (语音) 的形状, 这正是 wiring 层的定义.
//
//   为什么"翻译点只有一处":
//     语音消费器 (`VoiceService.consumeLlmStream`) 只认三态 chunk, 且**零改动**
//     (成熟资产). 于是所有"引擎语义 → 语音语义"的转换必须收敛在本文件:
//       增量文本 → content chunk;
//       本轮结束 → done chunk (带 usage);
//       引擎侧失败 → error chunk (带 code / message / retryable).
//     若在 voice 层里写"如果是新引擎就怎样", 语音层就得知道引擎的内部语义 ——
//     那是把两个子系统的知识搅在一起, 灰度一关就全是死代码.
//
//   为什么"降级兜底句"也要出声 (而不是静默 done):
//     任务单 §2.4 要求全挂时"仍正常返回收尾结果, 让上层能发 done, TTS 不悬挂".
//     若降级时一个字都不吐, 前端会看到"开始了 → 结束了, 但没有任何话", 用户
//     以为程序卡了. 兜底句本身就是为这一刻准备的 (中性、不越界).
//
//   反双胞胎:
//     - 不在 voice 层判断"这是不是新引擎": 本文件已经把一切翻译成三态 chunk,
//       voice 层拿到的两条链路**形状完全一样**, 于是"选哪条"只剩灰度开关一个决定.
//     - 不自己写逐字稿格式: 直接复用 `TranscriptTurn` (agent/supervisor 的既有类型),
//       督导报告那条链路的解析口径不用改.
//     - 不在失败时把半句写进逐字稿: 与旧链路对齐 —— 旧链路在早退时回滚 user 消息,
//       净效果是"这一轮不落逐字稿". 这里只在整轮成功时落, 语义一致.
//     - 不吞引擎侧的内核错误: 内核错误 (SESSION_NOT_FOUND / ABORTED) 转成 error chunk
//       交给既有消费器处理, 与旧链路"LLM 流错误 → error 帧"同形.
//     - V2026-10-29 (WP9-A): 角色解析**失败不抛**, 只 warn + 回退中性基线.
//       角色是**可选增强**, 不是会话的前置条件 —— 抛错会把"没有角色"升级成
//       "会话开不起来", 那是一个可选能力不该有的失败半径.
//
//   V2026-10-29 治本 (WP9-A · B 层 · 角色解析注入):
//   职责: 开场时把"角色定义"解析成内核 `CharacterProfile` 并注入内核, 让人格基线
//         (信念 / 阻抗 / 情绪 / 信任) 在**第一轮之前**就位; 解析不到就走中性基线.
//   边界: 只做"解析 → 注入 → 快照命名"; 角色语义 (种子/映射口径) 全在
//         `wiring/character/`, 本文件**不认识**任何具体角色.
//
//   为什么解析点收敛在这一个文件:
//     翻译点只有一处是 WP8-B 立下的纪律 —— 引擎语义 → 语音语义必须收敛.
//     角色解析同属"引擎语义": 窄接口只透传"角色 key + 临场参数"这**原始事实**,
//     "这个 key 意味着什么样的阻抗与信念"是引擎侧的事. voice 层若自己去解析角色,
//     voice 层就得知道角色语义, 灰度一关就全是死代码.
//
//   反双胞胎 (WP9-A):
//     - 不用 @nestjs 的 useClass 装配 resolver: 它的构造参数带默认值, Nest 会把
//       Object 当成待注入依赖而报错 —— 走 useFactory 显式 new (与仓库既有做法一致).
//     - 不把"查不到角色"当错误: DB 角色池未接时这是**常态**, warn 即可.
//     - 不手改内核快照: 初始快照由内核 `buildInitialSnapshot` 装配 (含 label 重算),
//       适配层只交出纯对象, 不在外部拼快照.
//
//   V2026-10-30 治本 (WP10 · B 层 · 轨迹剧本注入):
//   职责: 开场时把"剧本 id"解析成内核 `TrajectoryScript` 并注入内核的 `trajectory`
//         字段, 让伦理盲盒剧本在**第一轮之前**就位; 解析不到就走 BDI 自由运行.
//   边界: 只做"解析 → 注入"; 剧本内容 (10 个伦理盲盒) 全在 `wiring/trajectory/`,
//         本文件**不认识**任何具体剧本, 也不判断"这次会谈该不该有剧本".
//
//   为什么解析点与角色解析收敛在同一个文件:
//     翻译点只有一处是 WP8-B 立下的纪律 —— 引擎语义 → 语音语义必须收敛.
//     剧本解析同属"引擎语义": 窄接口只透传"剧本 key"这个**原始事实**,
//     "这个 key 意味着什么样的伦理事件"是引擎侧的事. voice 层若自己去解析剧本,
//     voice 层就得知道剧本语义, 灰度一关就全是死代码.
//
//   反双胞胎 (WP10):
//     - 不在 voice 层判断"有没有剧本": 它只透传 scriptId 字符串.
//     - 不在本文件写剧本内容: 只调 resolver, 拿到什么注入什么.
//     - 不因为"查不到剧本"抛错: 剧本是可选增强 (与角色解析同款语义),
//       查不到 = warn + 回退自由运行, 会话照常开.
//     - 不给旧 VisitorService 加剧本支持: 它不接新引擎剧本, 天然 undefined.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/voice/wp8b-grayscale.spec.ts 覆盖 delta → content / 结束 → done / 失败 → error
//     3. test/engine-adapters/wp9a-open-profile.spec.ts 覆盖角色注入 / 中性回退 / 快照一致性
//     4. test/engine-adapters/wp10-trajectory-injection.spec.ts 覆盖剧本注入 / 未命中回退 / 零回归
//
//   时间戳: 2026-10-30 GMT+8

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { CHARACTER_PROFILE_RESOLVER, type CharacterProfileResolver, type ResolvedCharacter } from './character/index.js';
import type { EngineTurnService } from './engine-turn.service.js';
import { TRAJECTORY_SCRIPT_RESOLVER, type TrajectoryScriptResolver } from './trajectory/index.js';
import type { TraceRecorder, TurnTrace } from '../../admin-debug/trace-recorder.service.js';
import type { LlmStream, LlmStreamChunk } from '../../agent/llm/llm.types.js';
import type { TranscriptTurn } from '../../agent/supervisor/supervisor.types.js';
import type { OpenEngineSessionInput, RiskProbePort, TrajectoryScript } from '../../engine-core/index.js';
import type { StudentRiskAuditChoice, StudentRiskAuditRegistry } from '../../voice/student-risk-audit-slot.js';
import { VoiceFrameRegistry } from '../../voice/voice-frame-registry.js';
import type {
  VoiceSafetyPreCheckInput,
  VoiceSafetyPreCheckResult,
  VoiceTurnBackend,
  VoiceTurnBackendCloseResult,
  VoiceTurnBackendOpenOptions,
  VoiceTurnBackendTurnOptions,
} from '../../voice/voice-turn-backend.port.js';
import type { VoiceServerMessage, VoiceSessionPersona } from '../../voice/voice.types.js';
import {
  accumulateSessionUsage,
  buildSessionCostSummary,
  DEFAULT_SESSION_COST_PRICING,
  emptySessionUsageTotals,
  type SessionCostPricing,
  type SessionUsageTotals,
} from '../observability/session-cost.js';
import type { SessionCloseoutService } from '../persistence/session-closeout.service.js';
import { runWithProbeSource } from '../rendering/probe-source.js';
import { isCrisisCategory } from '../rendering/render-risk.js';
import {
  buildCrisisModalFrame,
  buildCrisisToastFrame,
  buildStudentRiskDecisionFromProbe,
  truncateRiskSnippet,
  type StudentRiskDecision,
  type StudentRiskGate,
} from '../rendering/student-risk-disposal.js';
import type { TurnRenderResult } from '../rendering/turn-render-orchestrator.js';

/**
 * 中性基线来访者身份 (无角色时的回落形态).
 *
 * 为什么是中性基线而不是"读 persona 实体":
 *   角色资产 (5Ps / 难度 / 情绪基线) 的解析由 `CharacterProfileResolver` 负责
 *   (WP9-A: 内置种子; WP9-B: DB 角色池). 解析不到时给一个**不越界**的中性身份:
 *   它不承诺任何角色特征, 也不伪造一个看起来很像角色的假身份 (那会让报告里的
 *   人名与真实设定对不上). 中性基线 = WP8-B 的现状行为, 逐字不变.
 */
const NEUTRAL_PERSONA: VoiceSessionPersona = {
  id: 'voice_visitor',
  name: '来访者',
  voiceId: '',
  difficulty: 'L1',
};

/**
 * 引擎版对话后端 (实现 voice 侧窄接口).
 */
@Injectable()
export class EngineStreamBackend implements VoiceTurnBackend {
  private readonly logger = new Logger(EngineStreamBackend.name);
  /** 语音会话 id → 内核句柄 id. */
  private readonly handles = new Map<string, string>();
  /** 语音会话 id → 逐字稿 (一问一答两条). */
  private readonly transcripts = new Map<string, TranscriptTurn[]>();
  /**
   * 语音会话 id → 稳定落库 id (training_sessions.id).
   *
   * V2026-10-29 治本 (WP9-C): 督导轻提示帧按**稳定落库 id** 路由 (voice 侧的
   * `VoiceFrameRegistry` 就是按它登记出口的), 而窄接口给的是 WS 会话 id ——
   * 两者不是一回事, 所以这里显式存一份.
   */
  private readonly dbSessionIds = new Map<string, string>();
  /**
   * 语音会话 id → 长时记忆的归属上下文 (WP12).
   *
   * 为什么单独存: 收尾时要拿**同一个**作用域去写长时记忆, 而内核召回也是按这个
   * 作用域查的 —— 写与读必须是同一把键, 否则摘要写进去了却永远召不回.
   */
  private readonly sessionContexts = new Map<string, SessionContext>();
  /**
   * 语音会话 id → 本场累计用量 (WP24 · 单场成本日志).
   *
   * 为什么单独存而不是逐轮落库: 本单要的是**整场汇总**, 逐轮散点已经有了
   * (WP19 的 trace, 那是另一个坑). 内存里累加, closeSession 时一次算清 —
   * 不给数据库再加一张表, 也不给每轮加一次写.
   *
   * 生命周期: `openSession` 重置 (重连不能把上一场的用量算进来) →
   * 每轮累加 → `closeSession` 读完即删 (不留痕).
   */
  private readonly sessionUsage = new Map<string, SessionUsageTotals>();
  /**
   * 语音会话 id → 本场角色 key (WP19-R · 留痕).
   *
   * 为什么要单独存: 留痕快照要记 `characterSlug` (§1.1 契约), 而**角色 key 只在
   * 开场那一刻确定** —— 轮次结算时拿不到 open 的入参. 开场存一份, 轮次直接读.
   *
   * 口径与长时记忆作用域**同款** (`resolveCharacterKey`): 公共模板 id 优先,
   * 否则 personaId —— 跟引擎实际注入的角色是同一份口径, 不会"调试器看到的角色"
   * 与"引擎注入的角色"对不上.
   */
  private readonly characterSlugs = new Map<string, string>();

  constructor(
    private readonly engine: EngineTurnService,
    /**
     * 角色解析器 (WP9-A).
     *
     * 为什么 @Optional: 角色是**可选增强**. 装配缺失 (旧装配 / 独立单测) 时必须
     * 仍然能开会话 —— 等同"无角色 → 中性基线", 而不是 500.
     */
    @Optional() @Inject(CHARACTER_PROFILE_RESOLVER) private readonly resolver?: CharacterProfileResolver,
    /**
     * WS 帧出口注册表 (WP9-C).
     *
     * 为什么 @Optional: 它由 voice 侧的 `VoiceSessionModule` (@Global) 提供.
     * 装配缺失时**只影响危机提示帧**, 不影响会话本身 —— 不能让"没有出口"变成
     * "开不了会话".
     */
    @Optional() private readonly frames?: VoiceFrameRegistry,
    /**
     * 轨迹剧本解析器 (WP10).
     *
     * 为什么 @Optional: 剧本是**可选增强**, 与角色解析同款语义 —— 装配缺失 (旧装配 /
     * 独立单测) 时必须仍然能开会话, 等同"本场无剧本 → BDI 自由运行", 而不是 500.
     *
     * 位置说明: 本参数排在 `traceRecorder` 之前 —— `traceRecorder` 至今没有装配入口
     * (后端走工厂构造, Nest 不读它的 design:paramtypes), 把它挪到最后一位是为了
     * 让工厂能用**位置参数**把剧本解析器装进来, 不必在中间插一个 undefined 占位.
     */
    @Optional() @Inject(TRAJECTORY_SCRIPT_RESOLVER) private readonly scriptResolver?: TrajectoryScriptResolver,
    /**
     * 会话收尾服务 (WP12): 逐字稿全量落库 + 会话摘要晋升长时记忆.
     *
     * 为什么 @Optional: 收尾是**增强** —— 装配缺席时本场会谈照常结束, 只是
     * "逐字稿没全量落库" + "没有长时记忆". 不能让"没有收尾服务"变成"开不了会话".
     */
    @Optional() private readonly closeout?: SessionCloseoutService,
    /**
     * 调试快照记录器 (WP19).
     *
     * 为什么 @Optional: 它由 AdminDebugModule 提供. 装配缺失时
     * 会话照常进行, 只是没有调试 trace 落库 —— 不能让"没有调试器"变成
     * "开不了会话".
     */
    @Optional() private readonly traceRecorder?: TraceRecorder,
    /**
     * 成本单价 (WP24 · 单场成本日志).
     *
     * 为什么 @Optional: 成本日志是**观测增强** —— 装配缺席时只是没这条汇总日志,
     * 会话照常开、照常结束. 不能让"没配单价"变成"开不了会话".
     *
     * 位置说明: 本参数排在 `traceRecorder` **之后**. `traceRecorder` 至今没有
     * 装配入口 (后端走工厂构造, Nest 不读它的 design:paramtypes), 所以工厂那边
     * 必须给第 6 位**显式占一个 undefined** —— 这与 WP12 之前"不占位"的做法相反,
     * 原因是本单真的需要第 7 位, 而位置参数不能跳着传.
     */
    @Optional() private readonly costPricing?: SessionCostPricing,
    /**
     * 学员侧处置闸门 (WP14).
     *
     * 为什么 @Optional: 闸门是**可选增强** —— 装配缺席时本场照常,
     * 只是"没有学员侧危机处置" (与本单之前逐字一致).
     *
     * 它是**模块内单例**: 编排门面 (判定) 与本适配器 (置位 / 推帧 / 留痕) 必须拿到
     * 同一个实例, 否则"这里置位的监测状态"那边看不见.
     */
    @Optional() private readonly studentRiskGate?: StudentRiskGate,
    /**
     * 学员风险审计插槽 (WP14).
     *
     * 为什么 @Optional: 审计是**留痕能力**, 不是会话能力 ——
     * 业务侧没注册实现时, 弹窗照弹, 只是"这次没留痕".
     */
    @Optional() private readonly riskAudit?: StudentRiskAuditRegistry,
    /**
     * 风险探测器 (WP14 优化项 · 前置 safety gate).
     *
     * 为什么 @Optional: 探测器是**可选增强** —— 装配缺席时前置 gate 直接放行
     * (内核侧那一层判定照旧在), 不能让"没配探测器"变成"开不了会话".
     *
     * 为什么是**同一个**实例 (与内核注入的 RISK_PROBE 同源): 前置 gate 与内核
     * 判定必须问同一个探测器 —— 口径不一样就会出现"前置说 pass / 内核说 block"
     * 这种没法解释的分裂; 而且 D12 的本地词典兜底是挂在这个实例上的, 复用它
     * 才意味着"远端挂了前置 gate 也能拦".
     */
    @Optional() private readonly riskProbe?: RiskProbePort,
  ) {}

  /**
   * 开场: 内核开会话 (有角色 → 注入角色基线; 无角色 → 中性基线).
   *
   * 重复开会话 → 先关掉旧句柄再开新的 (与旧 visitor "覆盖 memory" 的行为对齐;
   * 不对齐的话, 第二条 `user_text` 之前的一次 startSession 重连就会撞上
   * `SESSION_ALREADY_OPEN`, 而那本该是无感的重连).
   */
  async openSession(opts: VoiceTurnBackendOpenOptions): Promise<VoiceSessionPersona> {
    const previous = this.handles.get(opts.sessionId);
    if (previous) {
      this.handles.delete(opts.sessionId);
      this.engine.close(previous);
    }

    const characterId = resolveCharacterId(opts);
    const character = await this.resolveCharacter(opts);
    const script = this.resolveTrajectoryScript(opts);
    // V2026-10-30 治本 (WP12): 长时记忆的归属作用域 = **(学员, 角色)**.
    //   见 buildMemoryScope 的说明 —— 这一步不做, 学员之间会互相读到对方的咨询内容.
    const memoryScope = buildMemoryScope(opts.userId, resolveCharacterKey(opts, characterId));
    // V2026-10-30 治本 (WP12): 跨会话接续来源.
    const resumeFromSessionId = opts.resumeFromSessionId?.trim() ?? '';
    const handle = this.openKernelSession(opts, character, script, memoryScope, resumeFromSessionId);

    this.handles.set(opts.sessionId, handle.handleId);
    this.transcripts.set(opts.sessionId, []);
    // WP24: 重置本场用量累计 —— 重连 (第二条 user_text 之前的一次 startSession)
    //   走的是同一条 openSession, 若不重置, 上一场的花费会被算进这一场.
    this.sessionUsage.set(opts.sessionId, emptySessionUsageTotals());
    this.sessionContexts.set(opts.sessionId, {
      tenantId: opts.tenantId,
      visitorId: memoryScope,
      userId: opts.userId?.trim() ?? '',
      // 有没有学员身份: 没有的话长时记忆**不写** (见 buildMemoryScope 的说明).
      studentScoped: (opts.userId?.trim() ?? '').length > 0,
    });
    const dbSessionId = opts.dbSessionId?.trim() ?? '';
    if (dbSessionId.length > 0) {
      this.dbSessionIds.set(opts.sessionId, dbSessionId);
    }
    // WP19-R: 记下本场角色 key (留痕快照的 characterSlug 用它).
    this.characterSlugs.set(opts.sessionId, resolveCharacterKey(opts, characterId));
    this.logger.log(
      `[openSession] session=${opts.sessionId} handle=${handle.handleId} visitor=${memoryScope} ` +
        `character=${character?.displayName ?? 'neutral'} script=${script?.scriptId ?? 'none'} ` +
        `resume=${resumeFromSessionId || 'none'}`,
    );
    // 对外仍然回 personaId (身份键不因角色而变 —— WP9-A 既有口径).
    return character ? { ...NEUTRAL_PERSONA, id: characterId, name: character.displayName } : { ...NEUTRAL_PERSONA, id: characterId };
  }

  /**
   * 调内核开会话 (带接续兜底).
   *
   * 接续失败**不阻断** (任务单 §1.5.5): 上一场不存在 / 已过期 / 状态读失败 →
   *   记 warn, 按**新会话**开. 不抛错、不断连.
   *
   * 抽成独立方法有两个原因:
   *   ① `openSession` 的圈复杂度已到上限, 再塞分支就超 (仓库 eslint 卡 20);
   *   ② "接续失败怎么兜"是一条**独立决策**, 单独成方法后可以被一眼读完.
   *
   * @param opts 开场参数
   * @param character 本场角色 (无 = 中性基线)
   * @param script 本场剧本 (无 = BDI 自由运行)
   * @param memoryScope 长时记忆归属作用域
   * @param resumeFromSessionId 接续来源 (空 = 新会话)
   * @returns 内核句柄
   */
  private openKernelSession(
    opts: VoiceTurnBackendOpenOptions,
    character: ResolvedCharacter | null,
    script: TrajectoryScript | undefined,
    memoryScope: string,
    resumeFromSessionId: string,
  ): { readonly handleId: string; readonly sessionId: string } {
    const openOptions = { characterLabel: character?.displayName ?? '' };
    try {
      return this.engine.open(this.buildOpenInput(opts, character, script, memoryScope, resumeFromSessionId, true), openOptions);
    } catch (error) {
      if (!resumeFromSessionId) throw error;
      this.logger.warn(
        `[openSession] 接续上一场失败, 按新会话开 session=${opts.sessionId} ` + `resumeFrom=${resumeFromSessionId}: ${messageOf(error)}`,
      );
      return this.engine.open(this.buildOpenInput(opts, character, script, memoryScope, resumeFromSessionId, false), openOptions);
    }
  }

  /**
   * 构造内核开场入参.
   *
   * 三个"有才带"的字段 (characterProfile+seed / trajectory / resumeFromSessionId):
   *   **不传时键不存在**, 不是"值为 undefined" —— 与现状逐字一致 (WP10 的零回归断言
   *   断言的就是键集合, 键存在即算形状变了).
   *
   * @param opts 开场参数
   * @param character 本场角色
   * @param script 本场剧本
   * @param memoryScope 长时记忆归属作用域
   * @param resumeFromSessionId 接续来源
   * @param withResume 本次是否带接续 (兜底重开时传 false)
   * @returns 内核开场入参
   */
  private buildOpenInput(
    opts: VoiceTurnBackendOpenOptions,
    character: ResolvedCharacter | null,
    script: TrajectoryScript | undefined,
    memoryScope: string,
    resumeFromSessionId: string,
    withResume: boolean,
  ): OpenEngineSessionInput {
    return {
      sessionId: opts.sessionId,
      tenantId: opts.tenantId,
      visitorId: memoryScope,
      // 有角色才带 profile/seed; 无角色时**不传这两个字段** (缺省 = 中性默认基线),
      // 与 WP8-B 的调用形态逐字一致.
      ...(character
        ? {
            characterProfile: character.characterProfile,
            ...(character.seed === undefined ? {} : { seed: character.seed }),
          }
        : {}),
      // V2026-10-30 治本 (WP10): 有剧本才带 trajectory; 没解析到 / 没传 scriptId
      //   时**不传这个字段** (缺省 = 本场无轨迹约束), 与现状逐字一致.
      ...(script ? { trajectory: script } : {}),
      // V2026-10-30 治本 (WP12): 有 resume 才带; 没传时**不传这个字段**
      //   (缺省 = 全新会话), 与现状逐字一致.
      ...(withResume && resumeFromSessionId ? { resumeFromSessionId } : {}),
    };
  }

  /**
   * 解析本场角色 (WP9-A).
   *
   * 三种"没有角色"的口径统一收敛到 null (走中性基线), 且**都不抛错**:
   *   1. resolver 未装配 (@Optional 缺省);
   *   2. 本场没有任何角色参数 (普通 voice session);
   *   3. 角色 key 查不到 (DB 角色池未接时的常态) / 解析过程抛错.
   *
   * @param opts 开场参数
   * @returns 解析结果; 无角色 → null
   */
  private async resolveCharacter(opts: VoiceTurnBackendOpenOptions): Promise<ResolvedCharacter | null> {
    if (!this.resolver) return null;
    try {
      const resolved = await this.resolver.resolve({
        templateId: opts.templateId,
        skillCode: opts.skillCode,
        preset: opts.preset,
      });
      if (!resolved) {
        // 查不到是常态 (角色池未接), 但带了 templateId 仍值得记一笔:
        // 线上排查"为什么这场没上角色"时, 这是唯一的线索.
        if (opts.templateId?.trim()) {
          this.logger.warn(`[openSession] 未解析到角色 templateId=${opts.templateId}, 回退中性基线`);
        }
        return null;
      }
      return resolved;
    } catch (error) {
      this.logger.warn(`[openSession] 角色解析异常, 回退中性基线: ${messageOf(error)}`);
      return null;
    }
  }

  /**
   * 解析本场轨迹剧本 (WP10).
   *
   * 三种"没有剧本"的口径统一收敛到 undefined (走 BDI 自由运行), 且**都不抛错**:
   *   1. 本场没带 scriptId (普通 voice session) —— 连 warn 都不打 (常态);
   *   2. 剧本解析器未装配 (@Optional 缺省);
   *   3. scriptId 查不到 (资产不存在 / Phase2 数据源未接) / 解析过程抛错.
   *
   * 为什么"查不到"必须是 warn 而不是抛错: 剧本是**可选增强**, 抛错会把
   * "客户端传了个不认识的剧本 id"升级成"会话开不起来" —— 那是一个可选能力
   * 不该有的失败半径 (与 WP9-A 角色解析同款语义).
   *
   * @param opts 开场参数
   * @returns 剧本; 无剧本 → undefined
   */
  private resolveTrajectoryScript(opts: VoiceTurnBackendOpenOptions): TrajectoryScript | undefined {
    const scriptId = opts.trajectoryScriptId?.trim() ?? '';
    if (scriptId.length === 0) return undefined;
    if (!this.scriptResolver) {
      this.logger.warn(`[openSession] 剧本解析器未装配, scriptId=${scriptId}, 回退自由运行`);
      return undefined;
    }
    try {
      const script = this.scriptResolver.resolve(scriptId);
      if (!script) {
        this.logger.warn(`[openSession] 未解析到剧本 scriptId=${scriptId}, 回退自由运行`);
        return undefined;
      }
      return script;
    } catch (error) {
      this.logger.warn(`[openSession] 剧本解析异常, 回退自由运行: ${messageOf(error)}`);
      return undefined;
    }
  }

  /**
   * 前置 safety 判定 (V2026-11-02, WP14 优化项 · block 不发 llm_start).
   *
   * 为什么在这里 (而不是内核侧): 内核的 safety 判定发生在 `session.turn()` **内部** ——
   *   等它判完, voice 层已经把 `llm_start` 发出去 (前端 loading 圈转起来了),
   *   而 block 之后前端既收不到 `llm_done` (后端根本没渲染), 又被全屏 modal 抢屏.
   *   前置判一次 = modal 干干净净地弹出来, 不先转圈.
   *
   * 委托给**已有**的探测器实例 (与内核注入的是同一个), 不新建探测器:
   *   · 口径必须与内核判定一致 (同一个服务 / 同一份词典兜底);
   *   · D12 的本地词典兜底挂在这个实例上 —— 复用它, "远端挂了也能拦"才成立;
   *   · 新建实例 = 多一份配置 / 多一条连接, 迟早与主链路漂移.
   *
   * 只拦 **block**: warn 仍由内核侧按原时序发 `crisis_toast` (不打断正常流式回复).
   * 类别边界 (只有危机类别才处置) 由 `buildStudentRiskDecisionFromProbe` 兜住 ——
   * 专业越界 (承诺治愈 / 双重关系 …) 是督导的事后复盘项, 不该在对话中途弹窗.
   *
   * 失败语义: **静默放行** —— 探测器抛错就按"没事"处理, 走既有流程;
   * 内核侧那一层判定仍然会再判一次 (双层防御), 不能因为前置 gate 挂了就把对练搞挂.
   *
   * @param input 判定入参 (会话 / 文本 / 轮次 / 帧出口)
   * @returns 判定结果 (block 时危机帧已推、审计已写、重点监测已置位)
   */
  async preCheckSafety(input: VoiceSafetyPreCheckInput): Promise<VoiceSafetyPreCheckResult> {
    const probe = this.riskProbe;
    if (!probe) return { level: 'pass' };
    const text = input.userText.trim();
    if (text.length === 0) return { level: 'pass' };

    let decision: StudentRiskDecision;
    try {
      // 探测来源通道: 远端答的记 `psyguard`, 委托本地词典兜底答的记 `local_dict`
      //   —— 审计表要能分辨"远端识别能力"与"本地兜底占比", 不能一律记成 psyguard.
      const { value: result, source } = await runWithProbeSource(() => probe.probe(text, 'counselor_input'));
      decision = buildStudentRiskDecisionFromProbe(result, source ?? 'local_dict');
    } catch (error) {
      this.logger.warn(`[preCheckSafety] 前置探测异常, 放行 session=${input.sessionId}: ${messageOf(error)}`);
      return { level: 'pass' };
    }

    if (decision.action !== 'block') {
      // warn / none → 一律放行 (warn 由内核侧按原时序处置, 这里不重复发 toast).
      if (decision.action === 'toast' && decision.category) return { level: 'warn', category: decision.category };
      return { level: 'pass' };
    }

    // block: 推全屏弹窗 + 写审计 + 置位重点监测 (与内核判定同一套动作, 同一份口径).
    this.publishStudentRiskFrame(input.sessionId, decision, input.publishFrame);
    this.recordStudentRiskEvent(input.sessionId, input.userText, input.turnIndex, decision);
    const handleId = this.handles.get(input.sessionId);
    if (handleId) this.studentRiskGate?.markMonitored(handleId);
    this.logger.warn(
      `[preCheckSafety] block 级危机前置拦截 session=${input.sessionId} turn=${input.turnIndex} ` +
        `category=${decision.category ?? '-'} source=${decision.source}`,
    );
    return decision.category ? { level: 'block', category: decision.category } : { level: 'block' };
  }

  /**
   * 一轮: 把引擎的流式渲染翻译成三态 chunk.
   */
  async streamTurn(opts: VoiceTurnBackendTurnOptions): Promise<{ readonly stream: LlmStream }> {
    const handleId = this.handles.get(opts.sessionId);
    if (!handleId) {
      // 会话没开 → 直接抛 (调用方负责回落旧链路); 静默返回一个空流会让上层
      // 以为"这一轮正常结束但没话说", 那是最难排查的一种坏.
      throw new Error(`EngineStreamBackend.streamTurn: sessionId=${opts.sessionId} 未开启`);
    }
    return { stream: this.buildStream(handleId, opts) };
  }

  /**
   * 收尾: 关内核句柄 + 清逐字稿, 返回本场统计.
   */
  closeSession(sessionId: string): VoiceTurnBackendCloseResult {
    const turns = this.transcripts.get(sessionId) ?? [];
    const result: VoiceTurnBackendCloseResult = {
      finalTurnCount: turns.filter((turn) => turn.role === 'assistant').length,
      finalMessageCount: turns.length,
    };
    /**
     * WP22: 本场累计的 completion tokens (交给 voice 层累加到当日全局预算).
     *
     * 为什么放在收尾结果里: "这场花了多少"只有这里知道 (用量累加器是适配器的
     * 私有状态), 而"当日预算是多少"是 voice 层的事 —— 通过窄接口把**事实**传出去,
     * 两侧各管各的, 不让 voice 层去碰引擎的内部计数器.
     *
     * 只在**第一次**收尾时有值 (下面按句柄判定的分支里取) —— 同一场被 close
     * 两次时, 第二次拿不到累加器 → 缺省, 调用方据此不会重复计费.
     */
    let totalCompletionTokens: number | undefined;

    // V2026-10-29 治本 (WP19 · flush 调试快照):
    //   会话关闭时把内存缓冲的 trace 写回 DB. fire-and-forget, 不阻塞 close.
    const dbSid = this.dbSessionIds.get(sessionId);
    if (dbSid && this.traceRecorder) {
      // WP19-R: 每轮已即刻落库, 这里的 flush 只是收尾 (补最后一轮 + 清缓冲).
      // 失败只打 error 日志 —— 不阻断 closeSession.
      void this.traceRecorder.flush(dbSid).catch((error: unknown) => {
        this.logger.error(`[closeSession] 调试快照收尾失败 session=${sessionId}: ${messageOf(error)}`);
      });
    }

    const context = this.sessionContexts.get(sessionId);
    const handleId = this.handles.get(sessionId);

    this.transcripts.delete(sessionId);
    this.dbSessionIds.delete(sessionId);
    this.sessionContexts.delete(sessionId);
    this.characterSlugs.delete(sessionId);
    if (handleId) {
      // V2026-11-02 (WP14): 清重点监测.
      //   必须清: 句柄是**进程内**标识, 进程不重启就一直复用 —— 不清的话,
      //   上一场的高危会把**下一场**也拖进重点监测 (串场).
      this.clearRiskMonitor(handleId);
      this.handles.delete(sessionId);
      this.engine.close(handleId);
    }

    // V2026-10-30 治本 (WP24 · 单场成本日志):
    //   把本场累计的用量折算成一条结构化日志 —— "这一场花了多少钱".
    //
    //   ⚠️ **按句柄判定, 只打一次** (与下面 WP12 收尾同款理由):
    //     voice 侧的关闭路径会把"当前后端"与"引擎后端"**各关一次** —— 引擎链路下
    //     这两个是同一个对象, 于是 closeSession 会被调两次. 第二次调用时句柄已被
    //     清掉, 累加器也已删除 → 不打第二条 (否则同一场会在日志里出现两条汇总,
    //     一条有数据一条是空的, 看着像算了两场).
    //
    //   为什么"累加器不存在"就不打: voice 侧会把**旧链路**的会话也走一遍引擎
    //   后端的关闭流程, 那时这场根本没走过引擎 (没有一轮渲染) —— 那不是"花了 0 元",
    //   是"这场不归引擎管", 两者不能混成一条日志.
    if (handleId) {
      const totals = this.sessionUsage.get(sessionId);
      this.sessionUsage.delete(sessionId);
      if (totals) {
        // WP22: 把本场用量交给 voice 层 (当日全局预算要用).
        totalCompletionTokens = totals.completionTokens;
        const summary = buildSessionCostSummary({
          sessionId,
          totals,
          pricing: this.costPricing ?? DEFAULT_SESSION_COST_PRICING,
          // 本单只在**新引擎路径**打这条日志, 所以恒为 'bdi'.
          // (WP17 已降级并入 WP13: enginePath 作为**留痕字段**是 WP13 的活,
          //  这里只是日志里标一个常量值, 不新增字段到 trace / 报告.)
          enginePath: 'bdi',
        });
        this.logger.log(`[session_cost_summary] ${JSON.stringify(summary)}`);
      }
    }

    // V2026-10-30 治本 (WP12 · 会话收尾):
    //   逐字稿全量落库 + 本场摘要晋升长时记忆. fire-and-forget (与上面的 trace flush 同款):
    //   收尾是 I/O, 不能反过来阻塞 `session_ended` 帧 (前端在等这个帧收页面).
    //
    //   ⚠️ **只在会话真的开着时触发** (按句柄判定):
    //     voice 侧的关闭路径会把"当前后端"与"引擎后端"**各关一次** —— 引擎链路下
    //     这两个是同一个对象, 于是 closeSession 会被调两次. 第二次调用时句柄已经被
    //     清掉了, 若不按句柄判定, 第二次就会拿**空逐字稿**去覆盖写库 ——
    //     把刚落库的逐字稿抹掉 (而且不留任何痕迹).
    if (handleId && this.closeout) {
      void this.closeout
        .finalize({
          tenantId: context?.tenantId ?? '',
          sessionId,
          // 没有学员身份 → **不晋升**长时记忆 (见 buildMemoryScope 的说明).
          ...(context?.studentScoped ? { visitorId: context.visitorId } : {}),
          ...(context?.userId ? { userId: context.userId } : {}),
          ...(dbSid ? { dbSessionId: dbSid } : {}),
          transcript: turns,
        })
        .catch((error: unknown) => {
          this.logger.warn(`[closeSession] 会话收尾异常 session=${sessionId}: ${messageOf(error)}`);
        });
    }

    this.logger.log(
      `[closeSession] session=${sessionId} turns=${result.finalTurnCount} msgs=${result.finalMessageCount} ` +
        `closeout=${handleId && this.closeout ? 'yes' : 'no'}`,
    );
    // WP22: 带上有值时才有 totalCompletionTokens (缺省 = 不可得, 不是 0).
    return totalCompletionTokens === undefined ? result : { ...result, totalCompletionTokens };
  }

  /**
   * 清重点监测 (会话关闭时).
   *
   * 抽成独立方法有两个原因:
   *   ① `closeSession` 的圈复杂度已到 20 的上限 (仓库 eslint 卡 20);
   *   ② "关会话时到底要清什么"是一条**独立决策**, 单独成方法后可以被一眼读完.
   *
   * @param handleId 内核会话句柄
   */
  private clearRiskMonitor(handleId: string): void {
    this.studentRiskGate?.clearMonitored(handleId);
  }

  /**
   * 逐字稿副本 (督导报告用).
   */
  transcript(sessionId: string): readonly TranscriptTurn[] {
    return this.transcripts.get(sessionId) ?? [];
  }

  /**
   * 引擎流 → 三态 chunk 的翻译体.
   */
  private async *buildStream(handleId: string, opts: VoiceTurnBackendTurnOptions): AsyncIterable<LlmStreamChunk> {
    const queue = new DeltaQueue();
    const pending = this.engine
      .turnStream(
        handleId,
        { userText: opts.userText, traceId: opts.traceId, ...(opts.signal ? { signal: opts.signal } : {}) },
        { onDelta: (delta) => queue.push(delta), ...(opts.signal ? { signal: opts.signal } : {}) },
      )
      .then((result) => {
        queue.close();
        return { ok: true as const, result };
      })
      .catch((error: unknown) => {
        queue.close();
        return { ok: false as const, error };
      });

    const spoken: string[] = [];
    for await (const delta of queue) {
      spoken.push(delta);
      yield { type: 'content', content: delta };
    }

    const settled = await pending;
    if (!settled.ok) {
      this.logger.warn(`[streamTurn] session=${opts.sessionId} 引擎流失败: ${messageOf(settled.error)}`);
      yield {
        type: 'error',
        error: { code: 'engine_stream_error', message: messageOf(settled.error), retryable: true },
      };
      return;
    }

    const reply = settled.result.reply;
    if (spoken.length === 0 && reply.length > 0) {
      // 一个增量都没吐但有正文 → 降级兜底句 (引擎全挂时走这条路).
      // 把它当 content 吐出去, 否则前端会看到"开始了 → 结束了, 却没有任何话".
      spoken.push(reply);
      yield { type: 'content', content: reply };
    }

    const degraded = settled.result.render.providerHint === 'degraded';
    const blocked = settled.result.disposal?.action === 'block';
    // V2026-11-02 (WP14): 阻断轮次**不写逐字稿** —— 本轮来访者一个字都没说,
    //   写一条空的 assistant 记录会让督导看到"AI 回了但没内容", 反而更费解.
    //   学员说了什么, 由审计表的 snippet 留痕 (那才是该看的地方).
    if (!degraded && !blocked) {
      this.appendTurn(opts.sessionId, opts.userText, spoken.join(''));
    }

    // V2026-11-02 治本 (WP14 · 学员侧处置):
    //   危机轮次**当场**推危机帧 + 写审计 + (high 时) 置位重点监测.
    //   为什么必须同步推 (不等异步 worker): 弹窗是**这一轮**的现场处置 ——
    //   学员的话已经说出口了, 提示晚一轮就晚一轮. 与 WP9-C 的督导提示同款纪律.
    this.handleStudentRisk(opts.sessionId, opts.userText, settled.result, opts.publishFrame);

    // V2026-10-29 治本 (WP9-C · 同步危机提示):
    //   危机轮次**不等异步 worker** —— 督导提示如果靠队列 worker, 就会错过"这一轮"
    //   的窗口 (人已经说完下一句了, 提示才到). 所以在**本轮结算的当场**推帧.
    this.publishCrisisHint(opts.sessionId, settled.result);

    const usage = settled.result.render.usage;

    // WP19: 调试快照留痕 (抽成私有方法降复杂度).
    this.recordTrace(opts.sessionId, settled.result, usage);

    // WP24: 本场用量累加 (单场成本日志的数据源).
    //   累加的是**渲染结果里真实带回来的**用量, 不另调模型、不重算 ——
    //   成本必须等于"这一场真的花了多少", 而不是"我们以为花了多少".
    this.accumulateUsage(opts.sessionId, usage, settled.result.render.model);

    yield {
      type: 'done',
      usage: {
        // WP24: 输入侧 token 此前恒为 0 (硬编码), 而聚合路径的上游其实报了
        //   promptTokens —— 这里接上, 流式路径仍是 0 (上游没给拆分, 不编造).
        promptTokens: usage?.promptTokens ?? 0,
        completionTokens: usage?.completionTokens ?? 0,
        totalTokens: usage?.totalTokens ?? 0,
        ...(usage?.reasoningTokens === undefined ? {} : { reasoningTokens: usage.reasoningTokens }),
      },
    };
  }

  /**
   * 累加一轮用量到本场累计 (WP24).
   *
   * @param sessionId 语音会话 id
   * @param usage 本轮用量 (可能缺省 = 渲染降级, 那轮没调模型)
   * @param model 本轮实际用的模型名 (缺省 = 上游没报)
   */
  private accumulateUsage(sessionId: string, usage: TurnRenderResult['render']['usage'], model: string | undefined): void {
    const current = this.sessionUsage.get(sessionId) ?? emptySessionUsageTotals();
    this.sessionUsage.set(
      sessionId,
      accumulateSessionUsage(current, {
        ...(usage?.promptTokens === undefined ? {} : { promptTokens: usage.promptTokens }),
        ...(usage?.completionTokens === undefined ? {} : { completionTokens: usage.completionTokens }),
        ...(usage?.totalTokens === undefined ? {} : { totalTokens: usage.totalTokens }),
        ...(usage?.reasoningTokens === undefined ? {} : { reasoningTokens: usage.reasoningTokens }),
        ...(model === undefined ? {} : { model }),
      }),
    );
  }

  /**
   * WP19: 每轮完成时写调试快照到内存缓冲 (每轮即刻落库).
   *
   * 抽成独立方法: ①降 buildStream 圈复杂度; ②调试逻辑不污染主链路阅读.
   *
   * V2026-10-30 治本 (WP19-R · 留痕链接通):
   *   · 快照形状改成 WP19 原单 §1.1 的**逐字**契约 (bdiSnapshot / renderSpec /
   *     llmUsage / crisis / ts / turnIndex / characterSlug);
   *   · 记录失败只打 error 日志 —— 调试器不能反过来把对练搞挂.
   */
  private recordTrace(sessionId: string, result: TurnRenderResult, usage: TurnRenderResult['render']['usage']): void {
    const recorder = this.traceRecorder;
    if (!recorder) return;
    const dbSid = this.dbSessionIds.get(sessionId);
    if (!dbSid) return;
    try {
      // 不 await: 主链路不等 IO. record() 内部已吞掉写库异常, 这里再兜一层 —
      // 留痕是观测能力, 任何失败都不许冒泡到对练链路.
      void recorder.record(dbSid, this.buildTurnTrace(sessionId, result, usage)).catch((error: unknown) => {
        this.logger.error(`[recordTrace] 调试快照记录失败 session=${sessionId}: ${messageOf(error)}`);
      });
    } catch (error) {
      this.logger.error(`[recordTrace] 调试快照构造失败 session=${sessionId}: ${messageOf(error)}`);
    }
  }

  /**
   * 构造本轮调试快照 (WP19 原单 §1.1 契约, 逐字沿用).
   *
   * 抽成独立方法: 让 `recordTrace` 只管"记不记 / 记到哪", 形状转换集中在一处,
   * 将来契约加字段只改这里.
   *
   * @param sessionId 语音会话 id
   * @param result 本轮结算结果
   * @param usage 本轮用量
   * @returns 调试快照
   */
  private buildTurnTrace(sessionId: string, result: TurnRenderResult, usage: TurnRenderResult['render']['usage']): TurnTrace {
    return {
      turnIndex: result.turnIndex,
      characterSlug: this.characterSlugs.get(sessionId) ?? '',
      bdiSnapshot: buildBdiSnapshot(result.snapshot),
      renderSpec: buildRenderSpecSummary(result.render),
      llmUsage: buildLlmUsage(result.render, usage),
      crisis: buildCrisisSummary(result.safety),
      ts: new Date().toISOString(),
    };
  }

  /**
   * 危机轮次 → 同步推 `supervision_hint` 帧.
   *
   * 判定口径与渲染路由**同一份** (isCrisisCategory): 内核判出来的 warn 里,
   * 只有"危机类别"才推提示 —— 咨询师的专业性提示 (过早给建议 / 价值审判) 属于
   * 事后复盘项, 不该在对话中途打断督导的注意力.
   *
   * 正文只给**方向**, 不含可照念的话术 (仓库硬约束 1): 提示是给督导看的,
   * 不是给学员念的.
   *
   * @param sessionId 语音会话 id
   * @param result 本轮结算结果
   */
  private publishCrisisHint(sessionId: string, result: TurnRenderResult): void {
    const safety = result.safety;
    if (!safety || safety.level === 'pass') return;
    const categories = safety.categories.filter((category) => isCrisisCategory(category));
    if (categories.length === 0) return;

    const dbSessionId = this.dbSessionIds.get(sessionId);
    if (!dbSessionId || !this.frames) {
      this.logger.warn(`[streamTurn] 危机轮次未推督导提示 (session=${sessionId} 无落库 id 或无帧出口)`);
      return;
    }

    const published = this.frames.publish(dbSessionId, {
      type: 'supervision_hint',
      turnIndex: result.turnIndex,
      category: categories.join(','),
      hintText: '检测到明确的危机信号，建议督导在本轮后介入评估安全风险。',
      tier: 'light',
    });
    this.logger.warn(
      `[streamTurn] 危机轮次已推督导提示 session=${sessionId} turn=${result.turnIndex} ` +
        `level=${safety.level} categories=${categories.join(',')} published=${published}`,
    );
  }

  /**
   * 学员侧危机处置 (V2026-11-02 WP14): 推危机帧 + 写审计 + (high 时) 置位重点监测.
   *
   * 三件事的顺序**刻意**如此:
   *   ① 先推帧 —— 学员的现场处置最紧急 (弹窗要立刻出现在屏幕上);
   *   ② 再写审计 —— 留痕是义务, 但不能挡在学员前面;
   *   ③ 最后置位监测 —— high 之后本场进入重点监测, 后续每轮强制走远端探测.
   *
   * @param sessionId 语音会话 id
   * @param userText 学员本轮输入 (审计 snippet 的来源)
   * @param result 本轮结算结果
   * @param publishFrame 危机帧直推回调 (缺省 = 退回帧出口注册表)
   */
  private handleStudentRisk(
    sessionId: string,
    userText: string,
    result: TurnRenderResult,
    publishFrame?: (frame: VoiceServerMessage) => void,
  ): void {
    const disposal = result.disposal;
    if (!disposal || disposal.action === 'none') return;

    this.publishStudentRiskFrame(sessionId, disposal, publishFrame);
    this.recordStudentRiskEvent(sessionId, userText, result.turnIndex, disposal);

    if (disposal.action === 'block') {
      const handleId = this.handles.get(sessionId);
      if (handleId) this.studentRiskGate?.markMonitored(handleId);
    }
  }

  /**
   * 推危机帧 (toast / modal).
   *
   * 出口优先级: **先用入参里的 `publishFrame` 直推**, 没有才退回帧出口注册表.
   * 为什么优先直推:
   *   · 直推是"推给**本场**" —— 天然不会串场;
   *   · 注册表按**落库 id** 索引, 本场没落库 (纯内存降级) 时那个 id **不存在** ——
   *     而**危机弹窗不能因为数据库降级就推不出去**.
   *
   * @param sessionId 语音会话 id
   * @param disposal 处置决定
   * @param publishFrame 直推回调 (缺省 = 退回注册表)
   */
  private publishStudentRiskFrame(
    sessionId: string,
    disposal: StudentRiskDecision,
    publishFrame?: (frame: VoiceServerMessage) => void,
  ): void {
    const frame = disposal.action === 'block' ? buildCrisisModalFrame(disposal) : buildCrisisToastFrame(disposal);
    if (publishFrame) {
      try {
        publishFrame(frame);
      } catch (error) {
        this.logger.warn(`[streamTurn] 危机帧直推失败 session=${sessionId}: ${messageOf(error)}`);
      }
      this.logger.warn(
        `[streamTurn] 危机帧已直推 session=${sessionId} action=${disposal.action} ` +
          `level=${disposal.level ?? '-'} category=${disposal.category ?? '-'}`,
      );
      return;
    }

    // 兜底: 没有直推回调 (独立调用后端 / 旧装配) → 走帧出口注册表 (按落库 id).
    const frames = this.frames;
    if (!frames) {
      this.logger.warn(`[streamTurn] 危机帧未推 (session=${sessionId} 无帧出口)`);
      return;
    }
    const dbSessionId = this.dbSessionIds.get(sessionId);
    const published = dbSessionId ? frames.publish(dbSessionId, frame) : false;
    this.logger.warn(
      `[streamTurn] 危机帧已推 session=${sessionId} action=${disposal.action} ` +
        `level=${disposal.level ?? '-'} category=${disposal.category ?? '-'} published=${published}`,
    );
  }

  /**
   * 写一条学员风险事件 (append-only).
   *
   * fire-and-forget: 写不进去**只打 error 日志**, 不炸对练 (与 `recordTrace` 同款纪律).
   *
   * @param sessionId 语音会话 id
   * @param userText 学员本轮输入
   * @param turnIndex 触发轮次 (从 1 起)
   * @param disposal 处置决定
   */
  private recordStudentRiskEvent(sessionId: string, userText: string, turnIndex: number, disposal: StudentRiskDecision): void {
    const sink = this.riskAudit?.get();
    if (!sink) {
      this.logger.warn(`[streamTurn] 风险事件未留痕 (session=${sessionId} 无审计实现)`);
      return;
    }
    const dbSessionId = this.dbSessionIds.get(sessionId);
    const userId = this.sessionContexts.get(sessionId)?.userId ?? '';
    if (!dbSessionId || !userId) {
      this.logger.warn(`[streamTurn] 风险事件未留痕 (session=${sessionId} 无落库 id 或无学员身份)`);
      return;
    }
    const blocked = disposal.action === 'block';
    try {
      void sink
        .record({
          sessionId: dbSessionId,
          userId,
          turnIndex,
          level: blocked ? 'high' : 'medium',
          category: disposal.category ?? 'passive_ideation',
          snippet: truncateRiskSnippet(userText),
          source: disposal.source,
          actionTaken: blocked ? 'modal' : 'toast',
          monitoredAfter: blocked,
        })
        .catch((error: unknown) => {
          this.logger.error(`[streamTurn] 风险事件留痕失败 session=${sessionId}: ${messageOf(error)}`);
        });
    } catch (error) {
      this.logger.error(`[streamTurn] 风险事件构造失败 session=${sessionId}: ${messageOf(error)}`);
    }
  }

  /**
   * 回写学员在危机弹窗后的选择 (WP14 §1.3).
   *
   * 由 voice 层在收到 `crisis_resume` 帧时调. 这是审计表**唯一**允许 update 的列.
   *
   * @param sessionId 语音会话 id
   * @param choice 学员的选择
   */
  async markUserChoice(sessionId: string, choice: StudentRiskAuditChoice): Promise<void> {
    const sink = this.riskAudit?.get();
    if (!sink) return;
    const dbSessionId = this.dbSessionIds.get(sessionId);
    if (!dbSessionId) {
      this.logger.warn(`[crisis_resume] 未回写选择 (session=${sessionId} 无落库 id)`);
      return;
    }
    await sink.markUserChoice(dbSessionId, choice);
  }

  /**
   * 追加一问一答到逐字稿 (只记**完整跑完**的轮次, 与旧链路同口径).
   */
  private appendTurn(sessionId: string, counselorText: string, visitorText: string): void {
    const turns = this.transcripts.get(sessionId) ?? [];
    const at = Date.now();
    turns.push({ role: 'user', content: counselorText, at }, { role: 'assistant', content: visitorText, at });
    this.transcripts.set(sessionId, turns);
  }
}

/**
 * 会话归属上下文 (WP12): 收尾时要用的那把"记忆作用域键".
 */
interface SessionContext {
  /** 租户隔离键. */
  readonly tenantId: string;
  /** 长时记忆的归属作用域 (= 内核入参的 visitorId). */
  readonly visitorId: string;
  /** 归属学员 id (逐字稿写库的归属校验用). */
  readonly userId: string;
  /** 是否带学员身份 (没带 → 不写长时记忆). */
  readonly studentScoped: boolean;
}

/**
 * 内核快照 → 留痕的 `bdiSnapshot` (WP19 原单 §1.1).
 *
 * 口径:
 *   · trust / valence / arousal: 快照原值;
 *   · resistance: 取**话量阻抗** (`resistance.verbal`) —— 与"这轮说了多少"
 *     直接相关, 也是调试器最先想看的那个数;
 *   · anxiousSecure: 情绪标签 (内核按 valence × arousal 象限重算的离散标签).
 *
 * @param snapshot 内核本轮快照
 * @returns 留痕快照
 */
function buildBdiSnapshot(snapshot: TurnRenderResult['snapshot']): TurnTrace['bdiSnapshot'] {
  return {
    trust: snapshot.trust,
    valence: snapshot.emotion.valence,
    arousal: snapshot.emotion.arousal,
    resistance: snapshot.resistance.verbal,
    anxiousSecure: snapshot.emotion.label,
  };
}

/**
 * 渲染元信息 → 留痕的 `renderSpec` (WP19 原单 §1.1).
 *
 * 缺省口径: 渲染端口没给就记 'unknown' / 0 —— **不编**一个看起来像真的值.
 *
 * @param render 本轮渲染元信息
 * @returns 留痕渲染规格
 */
function buildRenderSpecSummary(render: TurnRenderResult['render']): TurnTrace['renderSpec'] {
  const spec = render.spec;
  return {
    taskKind: spec?.taskKind ?? 'unknown',
    promptPreview: spec?.promptPreview ?? '',
    maxCompletionTokens: spec?.maxCompletionTokens ?? 0,
    reasoningEffort: spec?.reasoningEffort ?? 'unknown',
  };
}

/**
 * 渲染元信息 + 用量 → 留痕的 `llmUsage` (WP19 原单 §1.1).
 *
 * ⚠️ `promptTokens` 的口径: **流式路径上游只给累计 tokenCount**, 输入侧拆不出来
 * (WP24 已立同款纪律: "不可得" ≠ 0). 契约字段是数字, 这里落 0 = 本轮输入侧
 * 用量不可得 (流式路径恒如此), 不拿它冒充"输入侧没花钱".
 *
 * @param render 本轮渲染元信息
 * @param usage 本轮用量
 * @returns 留痕用量
 */
function buildLlmUsage(render: TurnRenderResult['render'], usage: TurnRenderResult['render']['usage']): TurnTrace['llmUsage'] {
  return {
    promptTokens: usage?.promptTokens ?? 0,
    completionTokens: usage?.completionTokens ?? 0,
    reasoningTokens: usage?.reasoningTokens ?? 0,
    ttftMs: render.ttftMs ?? 0,
    finishReason: render.finishReason ?? 'unknown',
  };
}

/**
 * 本轮安全判定 → 留痕的 `crisis` (WP19 原单 §1.1).
 *
 * @param safety 本轮安全判定 (缺省 = 内核判定为 pass)
 * @returns 留痕危机判定
 */
function buildCrisisSummary(safety: TurnRenderResult['safety']): TurnTrace['crisis'] {
  return {
    detected: safety !== undefined,
    category: safety?.categories?.[0] ?? null,
  };
}

/**
 * 本场的角色 id (对外身份键): personaId 优先, 缺省 = 中性基线 id.
 *
 * @param opts 开场参数
 * @returns 角色 id
 */
function resolveCharacterId(opts: VoiceTurnBackendOpenOptions): string {
  const trimmed = opts.personaId?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : NEUTRAL_PERSONA.id;
}

/**
 * 本场的**角色 key** (记忆归属作用域用): 公共人物模板 id 优先, 否则 personaId.
 *
 * 为什么模板 id 优先: 同一份"角色资产"在 vpt 场里 personaId 常常是空的, 只有
 * 模板 id 能区分"晚晴"和"小满" —— 用 personaId 当 key 会把所有无 persona 的角色
 * 归成同一份记忆.
 *
 * @param opts 开场参数
 * @param characterId 角色 id (模板 id 缺省时的回落)
 * @returns 角色 key
 */
function resolveCharacterKey(opts: VoiceTurnBackendOpenOptions, characterId: string): string {
  const templateId = opts.templateId?.trim() ?? '';
  return templateId.length > 0 ? templateId : characterId;
}

/**
 * 构造长时记忆的归属作用域 (WP12).
 *
 * 口径: **`学员 id : 角色 key`**.
 *
 * 为什么不能只用角色 key (这是本单最容易踩的坑):
 *   内核的 `visitorId` 是长时记忆**跨会话归属键** —— 写入用一把键, 召回也用同一把键.
 *   而这个产品的"来访者"是 **AI 扮演的角色** (晚晴/小满…), 角色 key 对所有学员都相同.
 *   若直接拿角色 key 当归属键, 学员 A 的咨询摘要会被学员 B 召回去 ——
 *   那不是"体验更好", 是**把甲学员的私密内容念给乙学员听**.
 *   归属键必须包含**学员身份**, 才等于"我的这个角色的上次".
 *
 * 为什么不用"学员 id"单独做键: 同一学员练不同角色时不该互相污染 (角色基线不同),
 *   所以键里必须带角色.
 *
 * 学员 id 缺失时 (理论上不该发生 —— 语音链路有 JWT 鉴权): 退化为纯角色 key,
 *   并由调用方据此**不写**长时记忆 (没有归属就没有隔离).
 *
 * @param userId 学员 id (可空)
 * @param characterKey 角色 key (公共人物模板 id 优先, 否则 personaId)
 * @returns 归属作用域
 */
function buildMemoryScope(userId: string | undefined, characterKey: string): string {
  const user = (userId ?? '').trim();
  return user.length > 0 ? `${user}:${characterKey}` : characterKey;
}

/**
 * 极简异步队列 —— 把「push 型 onDelta 回调」翻译成「pull 型 AsyncIterable」.
 *
 * 为什么需要它: 引擎的流式接口是**回调**形态 (`onDelta`), 而 voice 的消费接口是
 * **拉取**形态 (AsyncIterable). 两边形态不同, 中间必须有一座转换. 放在这里而不是
 * 引擎侧, 是因为"推 → 拉"的转换是**消费侧**的责任 (谁在消费, 谁决定怎么拉).
 *
 * 反双胞胎: 不引第三方队列库 (为一个几十行的需求加依赖不划算), 也不复用 TTS 的
 * 事件队列 (那是 bidi 协议专用, 语义与生命周期都不同).
 */
class DeltaQueue {
  private readonly buffer: string[] = [];
  private notify: (() => void) | null = null;
  private closed = false;

  /** 推入一段增量. */
  push(delta: string): void {
    if (this.closed || delta.length === 0) return;
    this.buffer.push(delta);
    this.notify?.();
  }

  /** 关闭队列 (生产者结束). */
  close(): void {
    this.closed = true;
    this.notify?.();
  }

  /** 拉取增量 (直到队列关闭). */
  async *[Symbol.asyncIterator](): AsyncGenerator<string> {
    for (;;) {
      while (this.buffer.length > 0) {
        yield this.buffer.shift()!;
      }
      if (this.closed) return;
      await new Promise<void>((resolve) => {
        this.notify = resolve;
      });
      this.notify = null;
    }
  }
}

/**
 * 错误转可读文案.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
