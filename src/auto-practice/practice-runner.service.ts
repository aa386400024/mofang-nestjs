// V2026-11-08 治本 (Phase2.5 WP-D · 自动对练循环):
//   职责: 核心循环 —— 开一场引擎会话 → (LLM 咨询师说一句 → 引擎来访回一句) × N → 关会话.
//
//   这个循环**不新写对话处理**: 每一轮"来访回一句"完全走 TurnEnginePort (= DebugSessionService),
//     BDI 决策 / 记忆 / 渲染 / 危机探测 / delta 审计全是现有引擎在跑.
//     本类只做两件事:
//       ① 把咨询师那半边的"人输入"换成 CounselorAgentService 的 LLM 生成;
//       ② 判断什么时候该停 (maxTurns / crisis / 来访复读).
//
//   结束条件 (按优先级):
//     ① crisisDetected —— 来访者说了自伤/自杀相关 → 立刻停, 标记 crisis_ended;
//     ② 咨询师判断可自然收尾 (输出 [[END]] 标记, 且已过最小轮数) → status=completed, exitReason=natural_close;
//     ③ 来访复读 —— 连续 3 轮来访回复几乎一样 → 停 (对话僵住了, 再跑没意义);
//     ④ maxTurns —— 跑满轮数 (此时它退化成"上限保护", 不是正常的结束方式);
//     ⑤ 抛异常 —— 标记 failed, 写 error_message.
//
//   反双胞胎:
//     - **不改 DebugSessionService**: 它服务手动调试, 自动对练只是新消费者.
//     - **不在循环里打心理内容日志**: 日志只出 practiceSessionId / turn / 耗时 / 退出原因.
//     - **engine-core 零改动**: 所有变化在适配层 (本类 + counselor agent).
//     - **crisis 也走现有探测**: 不自己写危机关键词表, trace.crisis.detected 是引擎算的.
//
//   V2026-11-09 治本 (Phase2.5 WP-F · Step 0 — 结算时把 token / 成本落库):
//     成本看板要合并"正式训练 + 自动对练"两个数据源, 但自动对练**没有留痕 JSON 列**
//     (正式训练从 `turn_debug_trace[].llmUsage` 现算) —— 不落库, 看板这边永远是 0.
//     于是这里在结算时把 token / 成本 / 成本口径写进 `ap_practice_sessions`:
//       · 成本用**同一张定价表** (`LLM_PRICE_*`) + 同一个 `estimateSessionCost()`,
//         单位是**人民币元** —— 不搞美元字段、不搞汇率 (WP-F 任务单 §6 硬约束).
//       · failed / running 的场次**也落库** —— 钱花了就是花了.
//       · 只取**数字**, 不碰 prompt 全文 / 来访者原话 (隐私红线 AGENTS.md §5.4).
//
//   验证: test/auto-practice/practice-runner.spec.ts + practice-runner-cost.spec.ts

import { Inject, Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { nanoid } from 'nanoid';
import { Repository } from 'typeorm';

import { AUTO_PRACTICE_EVENTS, type AutoPracticeSessionEndPayload, type AutoPracticeSessionStartPayload } from './auto-practice.events.js';
import { AutoPracticeGateway } from './auto-practice.gateway.js';
import { CounselorAgentService, type CounselorHistoryTurn } from './counselor-agent.service.js';
import { CounselorMode } from './entities/counselor-mode.entity.js';
import { PracticeSession, type PracticeSessionStatus } from './entities/practice-session.entity.js';
import { InferenceFingerprintService, type InferenceFingerprint, type ScenarioType } from './inference-fingerprint.service.js';
import { TURN_ENGINE_PORT, type TurnEnginePort } from './ports/turn-engine.port.js';
import { resolveCostPricingFromEnv } from '../admin-debug/cost-pricing.js';
import type { DebugTurnTrace } from '../admin-debug/debug-session.service.js';
import {
  estimateSessionCost,
  type SessionCostBasis,
  type SessionCostPricing,
  type SessionUsageTotals,
} from '../engine-adapters/observability/session-cost.js';

/**
 * 本场累计 LLM 用量 (WP-F Step 0 · 结算时落库到 ap_practice_sessions).
 *
 * ⚠️ 这里只存**数字** —— 不存 prompt 全文 / 来访者原话 (隐私红线 AGENTS.md §5.4).
 */
interface PracticeUsage {
  /** 有用量记录的轮数 (跟 token 累加同步). */
  turnCount: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
}

/** 默认最大轮数 (一场对练聊多少轮). */
export const DEFAULT_MAX_TURNS = 15;

// ─────────────────────────────────────────────────────────────────────────────
// V2026-11-10 治本 (Phase2.5 WP-J · 改动 A): 停滞判定的**判据对象**换了.
//
// 原来: 用 `isNearDuplicate` 的"相邻两轮像不像"同时充当两个判定 ——
//   ① 复读检测 (该抓的是"同一句话反复说");
//   ② 对话停滞 (该抓的是"聊了半天没有新信息").
// 这两个是**不同的东西**, 阈值怎么调都会错:
//   金丝雀 24 场里 5 场被判 stagnant, 逐对回放后 5 场**全部**是咨询师侧触发,
//   而触发它们的那 5 对文本, 字符 3-gram Jaccard 只有 0.00~0.04 (阈值 0.6, 差两个数量级),
//   ——真正命中的是第 ④ 层"语义簇判定"(阈值 0.5), 即"连续两轮都在谈工作/领导/担心".
//   那正是反映式复述的**正常形态**: 真人咨询师比 AI 更容易踩这个动作.
//   于是"判定对象错位"被当成了"阈值太严", 越调越偏.
//
// 现在: 三条各自独立, 各管一件事 ——
//   ① 字面复读 (来访者侧): 去空白全等 / 长文前 15 字同 / 3-gram ≥ 0.6, 连 2 次 → 停;
//   ② 无推进   (来访者侧): 与**历史全部来访文本**的最大相似度都 ≥ 0.8, 连 3 轮 → 停;
//   ③ 语义相邻 (咨询师侧): **只记指标** `counselor_semantic_echo`, 永不终止.
//
// 为什么 ② 要跟"历史全部"比而不是"上一轮":
//   跟上一轮比只能抓"原地复读", 抓不到"换个说法还是原地打转"(这正是来访者卡住的样子);
//   跟全部历史比, 只要这一轮带来了任何新信息, 最大相似度就会掉下来 —— 判据自然放过推进.
// ─────────────────────────────────────────────────────────────────────────────

/** 字面复读阈值: 连续 N 次判重即停 (N=2 → 第 3 轮说同样的话时终止). */
export const STAGNANT_LITERAL_STREAK_LIMIT = 2;

/** 无推进阈值: 来访者连续 N 轮没有带来新信息即判停滞. */
export const STAGNANT_NO_PROGRESS_LIMIT = 3;

/** 无推进判定的相似度阈值: 与历史全部来访文本的最大相似度 ≥ 该值 = 没带新信息. */
export const NO_PROGRESS_SIMILARITY_THRESHOLD = 0.8;

/**
 * 危机后置练习窗轮数 (WP-J 改动 B).
 *
 * 危机披露后**不终止**, 继续练这么多轮危机应对. 取 4:
 *   - 少 1 轮走不完"安全确认 → 稳定化 → 下一步"三步;
 *   - 多 1 轮就会滑进"反复追问细节", 反而稀释训练目标.
 * 这是产品决策 (用户已拍板), 不是临床标定.
 */
export const CRISIS_PRACTICE_TURNS = 4;

/** 允许"自然收尾"的最少轮数: 太早收尾等于没聊, 至少建立议题后再结束. */
const MIN_TURNS_BEFORE_CLOSE = 5;

/**
 * 跑一场对练的入参.
 */
export interface RunPracticeInput {
  /** 来访者角色 slug. */
  readonly characterSlug: string;
  /** 咨询师模式. */
  readonly counselorMode: CounselorMode;
  /** 最大轮数 (缺省 DEFAULT_MAX_TURNS). */
  readonly maxTurns?: number;
  /** 批量批次 id (单场实时跑为 null). */
  readonly batchId?: string | null;
  /** 预生成的场次 id (controller 立即返回给前端用; 不传则 runner 自己生成). */
  readonly practiceSessionId?: string;
  /** 场景类型 (WP-B: 考核场景硬隔离 rule_only; 缺省 full_simulation). */
  readonly scenarioType?: ScenarioType;
}

/**
 * 一场对练的可观测指标 (WP-J).
 *
 * ⚠️ 全部是数字 / 枚举 / 轮次 —— **不含任何对话文本**(隐私红线),
 *   可以安全进日志、进库、进看板.
 */
export interface PracticeRunMetrics {
  /** 咨询师语义回响轮数 (反映式复述的计数, 不参与终止). */
  readonly counselorSemanticEchoTurns: number;
  /** 是否经历过后置危机练习窗. */
  readonly crisisPracticed: boolean;
  /** 危机首次披露的轮次 (未披露为 null). */
  readonly crisisFirstTurn: number | null;
  /** 危机窗内实际完成的练习轮数. */
  readonly crisisPostTurns: number;
  /** 危机表达强度档位 0~3 (未披露为 0). 见 CRISIS_LEVEL_BY_CATEGORY. */
  readonly crisisPeakLevel: number;
  /** 危机类别 (内核 VisitorRiskCategory 枚举值, 非自由文本; 未披露为 null). */
  readonly crisisCategory: string | null;
  /** 是否发生"强度上升"型二次升级. */
  readonly crisisEscalated: boolean;
}

/**
 * 危机后置练习窗状态 (WP-J 改动 B).
 *
 * 为什么需要独立状态: "危机披露" 与 "会话终止" 原来是同一件事,
 * 于是"练了危机应对"和"在危机里掉线"在数据上无法区分.
 */
interface CrisisWindowState {
  /** 是否已进入后置练习窗. */
  active: boolean;
  /** 首次披露的轮次. */
  firstTurn: number;
  /** 披露之后已进行的轮数. */
  postTurns: number;
  /** 观测到的最高强度档位. */
  peakLevel: number;
  /** 最高强度对应的类别. */
  category: string | null;
  /** 是否发生强度上升型二次升级. */
  escalated: boolean;
}

/**
 * 一场对练的结果摘要.
 */
export interface RunPracticeResult {
  readonly practiceSessionId: string;
  readonly debugSessionId: string;
  readonly status: PracticeSessionStatus;
  readonly exitReason: string;
  readonly turnCount: number;
  readonly crisisEnded: boolean;
  /** WP-J: 可观测指标 (无对话文本). */
  readonly metrics: PracticeRunMetrics;
}

@Injectable()
export class PracticeRunnerService implements OnModuleInit {
  private readonly logger = new Logger('PracticeRunnerService');

  constructor(
    @Inject(TURN_ENGINE_PORT) private readonly engine: TurnEnginePort,
    private readonly counselorAgent: CounselorAgentService,
    private readonly fingerprintService: InferenceFingerprintService,
    @InjectRepository(PracticeSession) private readonly sessionRepo: Repository<PracticeSession>,
    // gateway 在单测里没有 (optional), 生产环境存在就推事件.
    // 注意: 参数类型写成 `AutoPracticeGateway | undefined` 时, TS 会把 design:paramtypes
    // 退化成 `Object`, Nest 按 `Object` 找不到 provider 就静默注入 undefined —— 于是
    // 所有 `publishToSession` 变成空调用 (WS 能连上但永远收不到事件). 必须显式 @Inject 令牌.
    @Optional() @Inject(AutoPracticeGateway) private readonly gateway?: AutoPracticeGateway,
    // WP-F Step 0: 结算时算成本要用单价 (LLM_PRICE_*).
    // 为什么是 @Optional(): 单测直接 new runner (不注入配置) —— 缺配置时按**默认单价**算,
    // 不能让"没注入配置"变成"跑不起来". 生产环境 ConfigModule 是全局的, 一定注得到.
    @Optional() private readonly config?: ConfigService,
  ) {}

  /**
   * 启动时清理"孤儿 running 场次".
   *
   * 循环跑在本进程里, 进程重启/崩溃会带走它, 但 DB 里 status 仍是 running ——
   * 前端会一直显示一个永远不动、也永远不会结束的幽灵场次, 看起来像"又卡了".
   * 单实例部署下, 启动瞬间还留在 running 的必然是上次进程留下的.
   */
  async onModuleInit(): Promise<void> {
    // ⚠️ 缺配置 → 成本按默认单价算 (数字还是对的, 但不是运营配的价) —— 说出来, 别静默.
    if (!this.config) {
      this.logger.warn('[auto_practice] 未注入 ConfigService — 成本按默认单价估算 (LLM_PRICE_*)');
    }
    try {
      const stale = await this.sessionRepo.find({ where: { status: 'running' }, select: { id: true } });
      if (stale.length === 0) return;
      await this.sessionRepo.update(
        { status: 'running' },
        { status: 'failed', exitReason: 'interrupted', errorMessage: '进程重启中断', finishedAt: new Date() },
      );
      this.logger.warn(`[auto_practice] 启动清理 ${stale.length} 个孤儿 running 场次 (标记 failed/interrupted)`);
    } catch (error) {
      this.logger.warn(`[auto_practice] 清理孤儿场次失败: ${errorName(error)}`);
    }
  }

  /**
   * 跑一场完整对练 (同步阻塞, 直到结束).
   *
   * 批量场景由 BullMQ worker 调它; 单场实时场景由 controller 直接 await 它.
   *
   * @param input 入参
   * @returns 结果摘要
   */
  async run(input: RunPracticeInput): Promise<RunPracticeResult> {
    const maxTurns = input.maxTurns ?? DEFAULT_MAX_TURNS;
    const practiceSessionId = input.practiceSessionId ?? nanoid();
    const scenarioType = input.scenarioType ?? 'full_simulation';
    let debugSessionId = '';
    let status: PracticeSessionStatus = 'running';
    let exitReason = 'max_turns';
    let crisisEnded = 0;
    let turnCount = 0;
    let degradedTurns = 0;
    let errorMessage: string | null = null;
    // WP-F Step 0: 本场累计用量 (循环里原地累加; 抛异常也不丢 —— 已经花的钱要算进去).
    const usage: PracticeUsage = { turnCount: 0, promptTokens: 0, completionTokens: 0, reasoningTokens: 0 };

    // ① 开引擎会话 (失败就建 failed 行, 然后 return —— 不 throw).
    const openResult = await this.openSessionOrFail(input, practiceSessionId, scenarioType, maxTurns);
    if (openResult.failed) {
      return openResult.result;
    }
    debugSessionId = openResult.debugSessionId;

    // ② 生成推理环境指纹 (WP-B) + 落库 running 行.
    const fingerprint = await this.buildFingerprintAndPersist(input, practiceSessionId, debugSessionId, scenarioType, maxTurns);

    // ③ 推 session_start (带指纹).
    const startPayload: AutoPracticeSessionStartPayload = {
      practiceSessionId,
      debugSessionId,
      characterSlug: input.characterSlug,
      counselorModeId: input.counselorMode.id,
      maxTurns,
      fingerprint,
    };
    this.gateway?.publishToSession(practiceSessionId, AUTO_PRACTICE_EVENTS.sessionStart, startPayload);

    const history: CounselorHistoryTurn[] = [];

    let loopResult: {
      status: PracticeSessionStatus;
      exitReason: string;
      crisisEnded: number;
      turnCount: number;
      degradedTurns: number;
      metrics: PracticeRunMetrics;
    };
    try {
      loopResult = await this.runConversationLoop(input, practiceSessionId, debugSessionId, maxTurns, history, usage);
    } catch (error) {
      loopResult = {
        status: 'failed',
        exitReason: 'error',
        crisisEnded: 0,
        turnCount: 0,
        degradedTurns: 0,
        metrics: emptyMetrics(),
      };
      errorMessage = errorName(error);
      this.logger.error(`[auto_practice] 对练循环异常 session=${practiceSessionId}: ${errorMessage}`);
    } finally {
      try {
        this.engine.close(debugSessionId);
      } catch (error) {
        this.logger.warn(`[auto_practice] 关引擎会话失败 session=${practiceSessionId}: ${errorName(error)}`);
      }
    }

    status = loopResult.status;
    exitReason = loopResult.exitReason;
    crisisEnded = loopResult.crisisEnded;
    turnCount = loopResult.turnCount;
    degradedTurns = loopResult.degradedTurns;
    const metrics = loopResult.metrics;

    // ⑥ 结算 token / 成本 (WP-F Step 0).
    //   口径跟正式训练**完全同一套**: 同一个 `estimateSessionCost()` + 同一张定价表,
    //   单位是**人民币元** —— 不搞美元字段、不搞汇率 (WP-F 任务单 §6 硬约束).
    //   ⚠️ failed 的场次也算钱: 跑了几轮就烧了几轮的钱, 不能因为异常就不记.
    const usageTotals: SessionUsageTotals = {
      turnCount: usage.turnCount,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.promptTokens + usage.completionTokens,
      reasoningTokens: usage.reasoningTokens,
      // 整场 promptTokens 都是 0 = 上游没报输入侧 → 成本口径如实落成 output_only (下界),
      // 不拿 0 冒充"输入侧免费" (与 `aggregateSessionCost` 同款纪律).
      promptTokensAvailable: usage.promptTokens > 0,
    };
    const cost = estimateSessionCost(usageTotals, this.resolveCostPricing());

    // ⑦ 更新终态 (含 token / 成本 / 成本口径).
    await this.updateSessionResult(practiceSessionId, {
      status,
      exitReason,
      turnCount,
      crisisEnded,
      errorMessage,
      degradedTurns,
      promptTokens: usageTotals.promptTokens,
      completionTokens: usageTotals.completionTokens,
      reasoningTokens: usageTotals.reasoningTokens,
      totalTokens: usageTotals.totalTokens,
      totalCostCny: cost.estimatedCostCny,
      costBasis: cost.costBasis,
    });

    // ⑧ 推 session_end.
    const endPayload: AutoPracticeSessionEndPayload = {
      practiceSessionId,
      status,
      exitReason,
      turnCount,
      crisisEnded: crisisEnded === 1,
      // WP-J: 危机练习窗与语义回响指标 (纯数字/枚举).
      crisisPracticed: metrics.crisisPracticed,
      crisisPostTurns: metrics.crisisPostTurns,
    };
    this.gateway?.publishToSession(practiceSessionId, AUTO_PRACTICE_EVENTS.sessionEnd, endPayload);

    this.logger.log(
      `[auto_practice] 对练结束 session=${practiceSessionId} status=${status} turns=${turnCount} reason=${exitReason}` +
        ` semantic_echo=${metrics.counselorSemanticEchoTurns} crisis=${metrics.crisisPracticed ? 1 : 0}` +
        `${metrics.crisisPracticed ? `/post=${metrics.crisisPostTurns}/peak=${metrics.crisisPeakLevel}` : ''}`,
    );
    return {
      practiceSessionId,
      debugSessionId,
      status,
      exitReason,
      turnCount,
      crisisEnded: crisisEnded === 1,
      metrics,
    };
  }

  /**
   * 跑对话主循环 (抽出来降低 run() 圈复杂度).
   *
   * 单轮"要不要停、停成什么"的判断全部在纯函数 {@link decideTurn} 里, 这里只负责
   * 执行副作用 (生成台词 / 跑引擎 / 推事件 / 记状态) —— 判定与执行分离,
   * 判定可被标定脚本原样复用 (scripts/ops/calibration/stagnation-calibration.ts).
   *
   * @returns 终态: status / exitReason / crisisEnded / turnCount / degradedTurns / metrics
   */
  private async runConversationLoop(
    input: RunPracticeInput,
    practiceSessionId: string,
    debugSessionId: string,
    maxTurns: number,
    history: CounselorHistoryTurn[],
    usage: PracticeUsage,
  ): Promise<{
    status: PracticeSessionStatus;
    exitReason: string;
    crisisEnded: number;
    turnCount: number;
    degradedTurns: number;
    metrics: PracticeRunMetrics;
  }> {
    let status: PracticeSessionStatus = 'running';
    let exitReason = 'max_turns';
    let crisisEnded = 0;
    let turnCount = 0;
    /** 来访者已经说过的话 —— 判"无推进"要跟**全部历史**比, 不是只跟上一轮比. */
    const visitorHistory: string[] = [];
    /** 停滞计数 (只统计来访者侧, 咨询师侧只记指标). */
    const stagnation: StagnationState = { literalRepeatStreak: 0, noProgressStreak: 0, semanticEchoTurns: 0 };
    let lastCounselorText = '';
    /** 危机后置练习窗状态 (WP-J 改动 B). */
    const crisisWindow: CrisisWindowState = {
      active: false,
      firstTurn: 0,
      postTurns: 0,
      peakLevel: 0,
      category: null,
      escalated: false,
    };
    let degradedTurns = 0;

    for (let i = 1; i <= maxTurns; i += 1) {
      // AI 咨询师生成台词.
      //   WP-J 改动 B: 危机后置练习窗内传 crisisMode —— 咨询师切到"稳定化"任务
      //   (安全确认 / 稳定化 / 下一步), 不再推进新议题.
      const counselorReply = await this.counselorAgent.generate(input.counselorMode, history, {
        crisisMode: crisisWindow.active,
      });
      if (counselorReply.degraded) degradedTurns += 1;
      history.push({ role: 'counselor', text: counselorReply.text });

      // 引擎跑一轮.
      const result = await this.engine.turn(debugSessionId, counselorReply.text);
      turnCount = result.turnIndex;
      // WP-F Step 0: 累加本轮 LLM 用量 (只取数字, 不碰任何心理内容).
      this.accumulateUsage(usage, result.trace);
      if (result.trace.degraded) degradedTurns += 1;
      history.push({ role: 'visitor', text: result.reply });

      // 推 turn 事件.
      this.gateway?.publishToSession(practiceSessionId, AUTO_PRACTICE_EVENTS.turn, {
        practiceSessionId,
        turnIndex: result.turnIndex,
        counselorText: counselorReply.text,
        visitorText: result.reply,
        crisisDetected: result.crisisDetected,
        trace: result.trace,
      });

      // 实时更新轮次.
      await this.sessionRepo.update(practiceSessionId, { turnCount }).catch((error: unknown) => {
        this.logger.warn(`[auto_practice] 更新轮次失败 session=${practiceSessionId}: ${errorName(error)}`);
      });

      const crisisEntered = result.crisisDetected && !crisisWindow.active;
      const decision = decideTurn(
        {
          turnIndex: result.turnIndex,
          closeRequested: counselorReply.closeRequested === true,
          crisisDetected: result.crisisDetected,
          crisisCategory: result.crisisCategory ?? null,
          visitorText: result.reply,
          visitorHistory,
          counselorText: counselorReply.text,
          lastCounselorText,
        },
        crisisWindow,
        stagnation,
      );

      if (crisisEntered) {
        // 只记轮次与档位数字 (隐私红线: 不记任何对话文本).
        this.logger.warn(
          `[auto_practice] 危机披露 → 进入后置练习窗 turn=${result.turnIndex} level=${crisisWindow.peakLevel} (不终止, 续 ${CRISIS_PRACTICE_TURNS} 轮)`,
        );
      }

      if (decision.kind === 'stop') {
        ({ status, exitReason } = resolveStopOutcome(decision));
        if (decision.reason === 'stagnant') {
          this.logger.warn(
            `[auto_practice] 判停滞 turn=${result.turnIndex} literal=${decision.literalStreak} no_progress=${decision.noProgressStreak} max_sim=${decision.maxSimilarity.toFixed(2)}`,
          );
        }
        if (decision.reason === 'crisis_escalated') crisisEnded = 1;
        break;
      }
      if (decision.closeBlocked) {
        // 危机披露当轮就想收尾 = 把来访者一个人留在危机里. 挡一次, 强制走完稳定化.
        this.logger.warn(`[auto_practice] 危机轮咨询师请求收尾 → 强制继续 session=${practiceSessionId}`);
      }

      lastCounselorText = counselorReply.text;
      visitorHistory.push(result.reply);
    }

    // 跑满 maxTurns.
    if (status === 'running') {
      status = 'completed';
      exitReason = 'max_turns';
    }

    // 降级比 ≥ 50% 加重度降级后缀.
    if (degradedTurns > 0 && turnCount > 0 && degradedTurns / turnCount >= 0.5) {
      exitReason = `${exitReason}_heavy_degraded`;
    }

    const metrics: PracticeRunMetrics = {
      counselorSemanticEchoTurns: stagnation.semanticEchoTurns,
      crisisPracticed: crisisWindow.active,
      crisisFirstTurn: crisisWindow.active ? crisisWindow.firstTurn : null,
      crisisPostTurns: crisisWindow.postTurns,
      crisisPeakLevel: crisisWindow.peakLevel,
      crisisCategory: crisisWindow.category,
      crisisEscalated: crisisWindow.escalated,
    };

    return { status, exitReason, crisisEnded, turnCount, degradedTurns, metrics };
  }

  /**
   * 开引擎会话, 失败时落库 failed 行并返回结果.
   *
   * 抽出来是为了降低 run() 的圈复杂度 (eslint complexity ≤ 20).
   */
  private async openSessionOrFail(
    input: RunPracticeInput,
    practiceSessionId: string,
    scenarioType: ScenarioType,
    maxTurns: number,
  ): Promise<{ failed: false; debugSessionId: string } | { failed: true; result: RunPracticeResult }> {
    try {
      const opened = await this.engine.open(input.characterSlug, scenarioType);
      return { failed: false, debugSessionId: opened.debugSessionId };
    } catch (error) {
      const errorMessage = errorName(error);
      this.logger.error(`[auto_practice] 开引擎会话失败 session=${practiceSessionId}: ${errorMessage}`);
      await this.persistSession(practiceSessionId, {
        debugSessionId: '',
        characterSlug: input.characterSlug,
        counselorModeId: input.counselorMode.id,
        status: 'failed',
        maxTurns,
        turnCount: 0,
        crisisEnded: 0,
        exitReason: 'error',
        batchId: input.batchId ?? null,
        errorMessage,
      });
      return {
        failed: true,
        result: {
          practiceSessionId,
          debugSessionId: '',
          status: 'failed',
          exitReason: 'error',
          turnCount: 0,
          crisisEnded: false,
          metrics: emptyMetrics(),
        },
      };
    }
  }

  /**
   * 生成推理环境指纹 (WP-B) 并落库 running 行.
   *
   * 抽出来是为了降低 run() 的圈复杂度 (eslint complexity ≤ 20).
   */
  private async buildFingerprintAndPersist(
    input: RunPracticeInput,
    practiceSessionId: string,
    debugSessionId: string,
    scenarioType: ScenarioType,
    maxTurns: number,
  ): Promise<InferenceFingerprint> {
    const fingerprint = await this.fingerprintService.build(
      input.characterSlug,
      input.counselorMode.id,
      scenarioType,
      input.batchId ?? null,
      practiceSessionId,
    );
    await this.persistSession(practiceSessionId, {
      debugSessionId,
      characterSlug: input.characterSlug,
      counselorModeId: input.counselorMode.id,
      status: 'running',
      maxTurns,
      turnCount: 0,
      crisisEnded: 0,
      exitReason: 'max_turns',
      batchId: input.batchId ?? null,
      errorMessage: null,
      modelVersion: fingerprint.model,
      seedValue: fingerprint.sessionSeed,
      characterVersion: fingerprint.characterVersion,
      deliberationMode: fingerprint.deliberationMode,
      engineVersion: fingerprint.engineVersion,
    });
    return fingerprint;
  }

  /** 建/更新一行场次记录. */
  private async persistSession(id: string, fields: Partial<PracticeSession>): Promise<void> {
    const row = this.sessionRepo.create({
      id,
      startedAt: new Date(),
      finishedAt: null,
      ...fields,
    } as Partial<PracticeSession>);
    await this.sessionRepo.save(row).catch((error: unknown) => {
      this.logger.warn(`[auto_practice] 落库场次记录失败 session=${id}: ${errorName(error)}`);
    });
  }

  /**
   * 更新终态 (status / turnCount / finishedAt + WP-F 的 token / 成本 / 成本口径).
   */
  private async updateSessionResult(
    id: string,
    fields: {
      status: PracticeSessionStatus;
      exitReason: string;
      turnCount: number;
      crisisEnded: number;
      errorMessage: string | null;
      degradedTurns: number;
      /** WP-F Step 0: 结算落库的用量与成本. */
      promptTokens: number;
      completionTokens: number;
      reasoningTokens: number;
      totalTokens: number;
      totalCostCny: number;
      costBasis: SessionCostBasis;
    },
  ): Promise<void> {
    await this.sessionRepo
      .update(id, {
        ...fields,
        finishedAt: new Date(),
      })
      .catch((error: unknown) => {
        this.logger.warn(`[auto_practice] 更新场次终态失败 session=${id}: ${errorName(error)}`);
      });
  }

  /**
   * 累加一轮的 LLM 用量 (WP-F Step 0).
   *
   * ⚠️ 只取**数字** (token 数) —— 不碰 prompt 全文 / 来访者原话 (隐私红线 AGENTS.md §5.4).
   * ⚠️ `llmUsage` 在类型上是必填, 但老数据 / 没留痕的轮次运行时可能真的没有 —— 按可空处理,
   *   缺就是缺 (不补 0 冒充"这轮免费").
   *
   * @param usage 累计量 (原地累加)
   * @param trace 本轮留痕
   */
  private accumulateUsage(usage: PracticeUsage, trace: DebugTurnTrace): void {
    const llm: Partial<DebugTurnTrace['llmUsage']> | undefined = trace.llmUsage;
    if (!llm) return;
    usage.turnCount += 1;
    usage.promptTokens += llm.promptTokens ?? 0;
    usage.completionTokens += llm.completionTokens ?? 0;
    usage.reasoningTokens += llm.reasoningTokens ?? 0;
  }

  /**
   * 成本单价 (元 / 千 token).
   *
   * 走 **WP24 已有的两个 env** (`LLM_PRICE_INPUT_PER_1K` / `LLM_PRICE_OUTPUT_PER_1K`) ——
   *   与正式训练看板、单场成本日志是**同一张定价表** (env 键 → 单价的映射只有一份:
   *   `admin-debug/cost-pricing.ts`). 少一个 env = 两张会漂的定价表.
   *
   * @returns 单价
   */
  private resolveCostPricing(): SessionCostPricing {
    return resolveCostPricingFromEnv((key) => this.config?.get<string>(key));
  }
}

/**
 * 停滞检测的词表层 —— V2026-11-09 起 (Phase2.5 WP-G · 改动 4), WP-J 后**仅服务指标**.
 *
 * 字符层 (①②③, 见 `isLiteralRepeat`) 用来抓"同一句话反复说";
 * 语义层 (表达状态簇 + 话题簇, 见 `isSemanticEcho`) 用来抓"连续两轮在同一状态/议题上打转".
 *
 * ⚠️ 语义层的结论**只能记指标**(`counselor_semantic_echo`), 不得作为终止依据 ——
 *   它对反映式复述(咨询师的正常技术动作)天然误伤, 金丝雀 5 场误判全在这里.
 *
 * 为什么语义层不用 embedding:
 *   本仓 embedding provider (通义 / 豆包 / DeepSeek) 都要各自 env key 才注册,
 *   MiniMax 只提供 CHAT —— 走向量会让判定依赖未配置的上游, 本机根本验不了.
 *   本地词表计算零网络开销、确定性可测.
 *
 * ⚠️ 词表是**工程种子值, 非临床标定** —— 只覆盖常见口语表达, 待真实对练校准.
 */

/** 字符级 3-gram 相似度阈值 (超过即判"字面复读"). */
const CHAR_NGRAM_THRESHOLD = 0.6;

/** 语义簇相似度阈值 (表达状态簇的 Jaccard). */
const SEMANTIC_CLUSTER_THRESHOLD = 0.5;

/** 参与语义判定的最短文本长度 (太短的应答不参与, 避免"嗯"/"哦"互判). */
const SEMANTIC_MIN_LENGTH = 4;

/** 关键词簇 (表达状态 / 话题). */
interface KeywordCluster {
  /** 簇名 (只在内部用, 不进 prompt / 不进日志). */
  readonly id: string;
  /** 命中即算属于本簇的标记词. */
  readonly keywords: readonly string[];
}

/**
 * 表达状态簇: 一句话在**说什么状态**的标记词.
 *
 * 为什么要分簇而不是"命中任一关键词就算重复":
 *   "不想说工作的事"与"不想说我爸妈的事"都命中"不想说" —— 但它们**话题不同**,
 *   不是同一句话. 所以"表达状态"只用来判**候选**, 真正的结论要看话题冲突检查.
 */
const SEMANTIC_STATE_CLUSTERS: readonly KeywordCluster[] = [
  {
    id: '表达困难',
    keywords: ['不太想', '不想说', '不愿说', '讲不清', '说不清', '说不出口', '难说', '难开口', '难讲', '不好说', '说不上来'],
  },
  { id: '迟疑', keywords: ['让我想想', '我想想', '该怎么说', '怎么说呢', '等我想想'] },
  { id: '放慢', keywords: ['慢慢来', '慢慢说', '慢慢聊', '缓一下', '缓一缓', '不急'] },
  { id: '转移话题', keywords: ['聊点别的', '说点别的', '换个话题', '别的话题', '别的吧'] },
  { id: '迷茫', keywords: ['不知道', '想不明白', '没想清楚'] },
  { id: '疲惫', keywords: ['好累', '很累', '太累', '疲惫', '没力气'] },
  { id: '痛苦', keywords: ['难受', '很难受', '痛苦', '撑不住'] },
  { id: '恐惧', keywords: ['害怕', '我怕', '担心', '恐惧'] },
  { id: '愤怒', keywords: ['生气', '愤怒', '气死', '恼火'] },
  { id: '积极', keywords: ['开心', '高兴', '轻松', '还不错'] },
  { id: '道歉', keywords: ['对不起', '抱歉', '不好意思'] },
  { id: '感谢', keywords: ['谢谢', '感谢'] },
];

/**
 * 话题簇: 一句话在**谈什么**的标记词.
 *
 * 冲突规则: 两句都有话题标记、但话题**不完全相同** → 不是同一句话的换皮 → 不判重.
 * (A={工作} B={工作,睡眠} 也算不同 —— "工作压力大"与"工作压力让我睡不着"
 *  说的不是一回事.)
 */
const TOPIC_CLUSTERS: readonly KeywordCluster[] = [
  { id: '工作', keywords: ['工作', '上班', '老板', '同事', '公司', '加班'] },
  { id: '父母', keywords: ['父母', '爸妈', '原生家庭', '家里人'] },
  { id: '婚姻', keywords: ['婚姻', '老公', '老婆', '伴侣', '丈夫', '妻子', '感情'] },
  { id: '学业', keywords: ['学习', '考试', '学校', '考研', '上课', '成绩'] },
  { id: '同伴', keywords: ['朋友', '同学', '室友'] },
  { id: '睡眠', keywords: ['睡眠', '失眠', '睡不着', '睡觉', '做梦'] },
  { id: '经济', keywords: ['钱', '经济', '房租', '工资', '存款'] },
  { id: '健康', keywords: ['健康', '身体', '生病', '医院', '体检'] },
];

/**
 * 字面复读判定 (WP-J 改动 A-①) —— 只负责抓"同一句话反复说".
 *
 * 三层, 从严到宽, **不含语义层**:
 *   ① 去掉空白后完全相同 ("嗯""好的"这种短答重复也要抓);
 *   ② 都 >= 15 字, 长度差 < 10% 且前 15 字相同 (长文几乎不会撞, 原有口径保留);
 *   ③ 字符级 3-gram Jaccard >= 0.6.
 *
 * 为什么**不能**把语义层并进来:
 *   `"我不太想现在讲清楚"` 与 `"最近确实有点难说出口"` 在临床上确实是同一句话的两种说法,
 *   字符相似度为 0 —— 但这条判定用在**咨询师的反映式复述**上时, 会把"连续两轮都在谈同一议题"
 *   判成复读 (实测 5 场误判的字符相似度只有 0.00~0.04, 全是语义层命中).
 *   语义相邻现在只做**指标**(`isSemanticEcho`), 不再作为终止依据.
 *
 * @param current 这一轮说的话
 * @param previous 上一轮说的话 (空串 = 首轮, 永远不判重)
 * @returns 是否字面复读
 */
export function isLiteralRepeat(current: string, previous: string): boolean {
  if (previous.length === 0) return false;
  const a = current.trim();
  const b = previous.trim();
  if (a === b) return true;
  // ② 长文复读 (原有口径): 都够长 + 长度接近 + 前 15 字一样.
  if (a.length >= 15 && b.length >= 15) {
    const lenDiff = Math.abs(a.length - b.length) / Math.max(a.length, b.length);
    if (lenDiff < 0.1 && a.slice(0, 15) === b.slice(0, 15)) return true;
  }
  // ③ 字符级 3-gram.
  return charNgramSimilarity(a, b) >= CHAR_NGRAM_THRESHOLD;
}

/**
 * 与历史文本集合的**最大**字符 3-gram 相似度 (无历史 = 0).
 *
 * 这是"无推进"判定 (A-②) 的核心: 跟**全部历史**比而不是跟上一轮比,
 * 才能抓到"换个说法仍然原地打转"这种真正的停滞形态.
 *
 * @param text 本轮文本
 * @param history 历史文本 (不含本轮)
 * @returns 最大相似度 0~1
 */
export function maxCharNgramSimilarity(text: string, history: readonly string[]): number {
  const current = text.trim();
  let max = 0;
  for (const item of history) {
    if (item.length === 0) continue;
    const similarity = charNgramSimilarity(current, item.trim());
    if (similarity > max) max = similarity;
  }
  return max;
}

/** 单轮停滞探测的入参. */
export interface StagnationProbeInput {
  /** 本轮来访者说的话. */
  readonly visitorText: string;
  /** 本轮之前的**全部**来访文本 (不含本轮). */
  readonly visitorHistory: readonly string[];
  /** 本轮咨询师说的话. */
  readonly counselorText: string;
  /** 上一轮咨询师说的话 (空串 = 首轮). */
  readonly lastCounselorText: string;
}

/**
 * 单轮停滞探测结果.
 *
 * 三条口径各自独立, 各自管一件事 —— 调用方按各自的连续计数决定是否终止.
 */
export interface StagnationObservation {
  /** 来访者本轮是否只是把上一轮的话换个说法 (A-①, 参与终止). */
  readonly literalRepeat: boolean;
  /** 来访者本轮与历史全部来访文本的最大相似度 (A-②, 参与终止). */
  readonly maxSimilarity: number;
  /** 来访者本轮是否"没有带来新信息" (A-②, 参与终止). */
  readonly noProgress: boolean;
  /** 咨询师相邻两轮是否语义相邻 (A-③, **只记指标, 永不终止**). */
  readonly counselorSemanticEcho: boolean;
}

/**
 * 探测一轮是否构成停滞信号 (纯函数, 无副作用, 便于标定与回归).
 *
 * @param input 本轮文本与历史
 * @returns 各口径的观测结果
 */
export function probeStagnation(input: StagnationProbeInput): StagnationObservation {
  const literalRepeat = isLiteralRepeat(input.visitorText, input.visitorHistory.at(-1) ?? '');
  const maxSimilarity = maxCharNgramSimilarity(input.visitorText, input.visitorHistory);
  const noProgress = input.visitorHistory.length > 0 && maxSimilarity >= NO_PROGRESS_SIMILARITY_THRESHOLD;
  const counselorSemanticEcho = input.lastCounselorText.length > 0 && isSemanticEcho(input.counselorText, input.lastCounselorText);
  return { literalRepeat, maxSimilarity, noProgress, counselorSemanticEcho };
}

/**
 * 危机表达强度档位 (0~3).
 *
 * ⚠️ 由内核 `VisitorRiskCategory` 枚举**映射**, 不做文本推断 ——
 *   分类器已经给出了细粒度标签, 上层再自己读一遍文本就是第二套口径.
 *
 * | 档位 | 含义 | 对应类别 |
 * |---|---|---|
 * | 0 | 隐念 / 探索 | `suicide_exploration` |
 * | 1 | 被动意念 | `passive_ideation` |
 * | 2 | 明确意念 / 自伤意图 | `active_ideation`、`self_harm_ideation` |
 * | 3 | 计划 / 准备 / 行为 / 攻击 | `suicide_plan`、`suicide_preparation`、`suicide_attempt`、`self_harm_behavior`、`aggression_*` |
 *
 * 未知类别按 1 处理: 既承认"危机已判出", 又不冒充最严重档位.
 */
const CRISIS_LEVEL_BY_CATEGORY: Readonly<Record<string, number>> = {
  suicide_exploration: 0,
  passive_ideation: 1,
  active_ideation: 2,
  self_harm_ideation: 2,
  suicide_plan: 3,
  suicide_preparation: 3,
  suicide_attempt: 3,
  self_harm_behavior: 3,
  aggression_others: 3,
  aggression_self: 3,
};

/**
 * 把内核危机类别映射成强度档位 (0~3).
 *
 * @param category 内核 VisitorRiskCategory (可能为 null)
 * @returns 强度档位
 */
export function crisisLevelOf(category: string | null): number {
  if (!category) return 0;
  return CRISIS_LEVEL_BY_CATEGORY[category] ?? 1;
}

/** 停滞计数状态 (跨轮累积; 只统计来访者侧, 咨询师侧只记指标). */
interface StagnationState {
  /** 字面复读连续轮数. */
  literalRepeatStreak: number;
  /** 无推进连续轮数. */
  noProgressStreak: number;
  /** 咨询师语义回响累计轮数 (指标). */
  semanticEchoTurns: number;
}

/** 单轮结束判定的输入 (全部是"事实", 不含任何副作用). */
interface TurnJudgementInput {
  /** 本轮序号. */
  readonly turnIndex: number;
  /** 咨询师本轮是否请求收尾. */
  readonly closeRequested: boolean;
  /** 本轮是否判出危机. */
  readonly crisisDetected: boolean;
  /** 危机类别 (未判出为 null). */
  readonly crisisCategory: string | null;
  /** 来访者本轮台词. */
  readonly visitorText: string;
  /** 来访者历史台词 (不含本轮). */
  readonly visitorHistory: readonly string[];
  /** 咨询师本轮台词. */
  readonly counselorText: string;
  /** 咨询师上一轮台词. */
  readonly lastCounselorText: string;
}

/** 单轮结束判定的结论. */
type TurnDecision =
  | { readonly kind: 'continue'; readonly closeBlocked: boolean }
  | { readonly kind: 'stop'; readonly reason: 'crisis_escalated' | 'crisis_practice_max' | 'crisis_practice_close' | 'natural_close' }
  | {
      readonly kind: 'stop';
      readonly reason: 'stagnant';
      readonly literalStreak: number;
      readonly noProgressStreak: number;
      readonly maxSimilarity: number;
    };

/**
 * 单轮结束判定 (纯函数, WP-J 改动 A+B 的全部判据都收敛在这里).
 *
 * 优先级与旧实现一致, 但**每一条的理由都改了**:
 *   ① 危机: 首次披露**不终止**(开窗); 只有强度上升才终止.
 *   ② 危机窗计时: 披露之后满 CRISIS_PRACTICE_TURNS 轮 → 正常收尾.
 *   ③ 自然收尾: 危机窗内"披露当轮就收尾"挡一次 (不能把来访者留在危机里),
 *      之后咨询师再请求才认.
 *   ④ 停滞: **只认来访者侧**(字面复读连 2 / 无推进连 3); 咨询师语义回响只计数.
 *
 * 之所以抽成纯函数: 判定逻辑要能被标定脚本按同一份代码回放
 * (scripts/ops/calibration/stagnation-calibration.ts), 不能在两条路径上各写一遍.
 *
 * @param input 本轮事实
 * @param crisisWindow 危机窗状态 (会被就地更新)
 * @param stagnation 停滞计数 (会被就地更新)
 * @returns 判定结论
 */
export function decideTurn(input: TurnJudgementInput, crisisWindow: CrisisWindowState, stagnation: StagnationState): TurnDecision {
  const crisisStartedThisTurn = input.crisisDetected && !crisisWindow.active;

  if (input.crisisDetected) {
    const level = crisisLevelOf(input.crisisCategory);
    if (crisisStartedThisTurn) {
      crisisWindow.active = true;
      crisisWindow.firstTurn = input.turnIndex;
      crisisWindow.peakLevel = level;
      crisisWindow.category = input.crisisCategory;
    } else if (level > crisisWindow.peakLevel) {
      // 只有**强度真的上升**才算二次升级. 同等或更低强度的"又说了一次"
      // 正是需要练的稳定化过程, 不是失败.
      crisisWindow.peakLevel = level;
      crisisWindow.category = input.crisisCategory ?? crisisWindow.category;
      // 升级这一轮本身也是练过的一轮, 计入练习轮数, 否则指标会少算 1.
      crisisWindow.postTurns += 1;
      crisisWindow.escalated = true;
      return { kind: 'stop', reason: 'crisis_escalated' };
    }
  }

  // 危机窗计时: 只统计"披露之后"的轮次, 披露那一轮本身不算练习轮.
  if (crisisWindow.active && !crisisStartedThisTurn) {
    crisisWindow.postTurns += 1;
    if (crisisWindow.postTurns >= CRISIS_PRACTICE_TURNS) {
      return { kind: 'stop', reason: 'crisis_practice_max' };
    }
  }

  const closeAllowed = input.closeRequested && input.turnIndex >= MIN_TURNS_BEFORE_CLOSE;
  const closeBlocked = closeAllowed && crisisWindow.active && crisisWindow.postTurns === 0;
  if (closeAllowed && !closeBlocked) {
    return { kind: 'stop', reason: crisisWindow.active ? 'crisis_practice_close' : 'natural_close' };
  }

  const probe = probeStagnation({
    visitorText: input.visitorText,
    visitorHistory: input.visitorHistory,
    counselorText: input.counselorText,
    lastCounselorText: input.lastCounselorText,
  });
  // 咨询师语义相邻 → 只计数, 永不终止. 反映式复述天然语义相邻, 那是技术动作.
  if (probe.counselorSemanticEcho) stagnation.semanticEchoTurns += 1;
  stagnation.literalRepeatStreak = probe.literalRepeat ? stagnation.literalRepeatStreak + 1 : 0;
  stagnation.noProgressStreak = probe.noProgress ? stagnation.noProgressStreak + 1 : 0;
  if (stagnation.literalRepeatStreak >= STAGNANT_LITERAL_STREAK_LIMIT || stagnation.noProgressStreak >= STAGNANT_NO_PROGRESS_LIMIT) {
    return {
      kind: 'stop',
      reason: 'stagnant',
      literalStreak: stagnation.literalRepeatStreak,
      noProgressStreak: stagnation.noProgressStreak,
      maxSimilarity: probe.maxSimilarity,
    };
  }
  return { kind: 'continue', closeBlocked };
}

/** 把终止结论映射成落库用的 status / exit_reason. */
function resolveStopOutcome(decision: Extract<TurnDecision, { kind: 'stop' }>): {
  status: PracticeSessionStatus;
  exitReason: string;
} {
  if (decision.reason === 'stagnant') return { status: 'stagnant', exitReason: 'stagnant' };
  if (decision.reason === 'crisis_escalated') return { status: 'crisis_ended', exitReason: 'crisis_escalated' };
  return { status: 'completed', exitReason: decision.reason };
}

/** 空指标 (开引擎失败 / 循环异常时用, 保证结构不缺失). */
function emptyMetrics(): PracticeRunMetrics {
  return {
    counselorSemanticEchoTurns: 0,
    crisisPracticed: false,
    crisisFirstTurn: null,
    crisisPostTurns: 0,
    crisisPeakLevel: 0,
    crisisCategory: null,
    crisisEscalated: false,
  };
}

/** 字符级 n-gram Jaccard 相似度. */
function charNgramSimilarity(a: string, b: string): number {
  const setA = ngramSet(a, 3);
  const setB = ngramSet(b, 3);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const gram of setA) {
    if (setB.has(gram)) intersection += 1;
  }
  return intersection / (setA.size + setB.size - intersection);
}

/** 取字符 n-gram 集合 (去空白; 短于 n 时整串当一个词). */
function ngramSet(text: string, n: number): Set<string> {
  const compact = text.replaceAll(/\s+/g, '');
  const grams = new Set<string>();
  if (compact.length === 0) return grams;
  if (compact.length < n) {
    grams.add(compact);
    return grams;
  }
  for (let i = 0; i + n <= compact.length; i += 1) {
    grams.add(compact.slice(i, i + n));
  }
  return grams;
}

/**
 * 语义回响判定 (WP-J 改动 A-③) —— **指标, 不是判据**.
 *
 * 三道闸:
 *   ① 两句都要够长 (太短的应答不参与);
 *   ② 表达状态簇要有交集 (交集为空 = 说的不是同一种状态);
 *   ③ 话题不能冲突 (话题不同 = 不是同一句话的换皮).
 *
 * ⚠️ 它抓的是"连续两轮都在谈同一议题" —— 对咨询师的反映式复述来说这是**正常技术动作**,
 *   所以只能记成 `counselor_semantic_echo` 供质量分析, 绝不能拿来终止对话.
 *
 * @param a 本轮文本
 * @param b 上一轮文本
 * @returns 是否语义相邻
 */
export function isSemanticEcho(a: string, b: string): boolean {
  if (a.length < SEMANTIC_MIN_LENGTH || b.length < SEMANTIC_MIN_LENGTH) return false;
  const statesA = matchClusters(a, SEMANTIC_STATE_CLUSTERS);
  const statesB = matchClusters(b, SEMANTIC_STATE_CLUSTERS);
  if (statesA.size === 0 || statesB.size === 0) return false;
  let shared = 0;
  for (const state of statesA) {
    if (statesB.has(state)) shared += 1;
  }
  if (shared === 0) return false;
  const union = statesA.size + statesB.size - shared;
  if (shared / union < SEMANTIC_CLUSTER_THRESHOLD) return false;
  const topicsA = matchClusters(a, TOPIC_CLUSTERS);
  const topicsB = matchClusters(b, TOPIC_CLUSTERS);
  if (topicsA.size > 0 && topicsB.size > 0 && !isSameSet(topicsA, topicsB)) return false;
  return true;
}

/** 命中关键词的簇集合. */
function matchClusters(text: string, clusters: readonly KeywordCluster[]): Set<string> {
  const hits = new Set<string>();
  for (const cluster of clusters) {
    for (const keyword of cluster.keywords) {
      if (text.includes(keyword)) {
        hits.add(cluster.id);
        break;
      }
    }
  }
  return hits;
}

/** 两个簇集合是否完全相同. */
function isSameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

/** 错误类型名 (不取 message —— 隐私红线). */
function errorName(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown_error';
}
