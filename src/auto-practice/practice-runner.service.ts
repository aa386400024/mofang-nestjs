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
//     ① crisisDetected —— 来访者说了自伤/自杀相关 → 进入后置危机窗 (标记 crisis_ended);
//        强度上升 (crisis_escalated) 在 standard/long 档先补 1 轮风险收束再结束 (AF-137);
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
//
//   V2026-11-18 治本 (AF-091 · 长会话档案):
//     结束条件里的四组阈值 (轮数上限 / 最早自然收尾 / 停滞判据 / 危机后置窗)
//     改成由**会话档案** (session-profile.ts) 决定, 缺省 legacy = 与本文件改动前逐字一致.
//     硬闸门: 自然收尾必须轮次 ≥ 档案的 minTurnsBeforeClose (legacy 5 / long 35).

import { Inject, Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { nanoid } from 'nanoid';
import type { Repository } from 'typeorm';

import { AUTO_PRACTICE_EVENTS, type AutoPracticeSessionEndPayload, type AutoPracticeSessionStartPayload } from './auto-practice.events.js';
import { AutoPracticeGateway } from './auto-practice.gateway.js';
import {
  CounselorAgentService,
  type CounselorGenerateContext,
  type CounselorHistoryTurn,
  type CounselorReply,
} from './counselor-agent.service.js';
import { CounselorMode } from './entities/counselor-mode.entity.js';
import { PracticeSession, type PracticeSessionStatus } from './entities/practice-session.entity.js';
import { InferenceFingerprintService, type InferenceFingerprint, type ScenarioType } from './inference-fingerprint.service.js';
import {
  completeOpeningText,
  completeRiskClosingText,
  completeRoutineClosingText,
  evaluateRiskClosingText,
  evaluateRoutineClosingText,
  RISK_CLOSING_ELEMENT_KEYS,
  type ClosingElementKey,
  type RiskClosingElementKey,
} from './metrics/session-structure-audit.js';
import { TURN_ENGINE_PORT, type EngineTurnResult, type TurnEnginePort } from './ports/turn-engine.port.js';
import { SemanticTurnPersister } from './semantic/semantic-turn.persister.js';
import {
  LEGACY_SESSION_PROFILE,
  LEGACY_SESSION_THRESHOLDS,
  resolveSessionProfile,
  sessionThresholdsOf,
  type SessionProfile,
  type SessionProfileName,
  type SessionThresholds,
} from './session-profile.js';
import { resolveCostPricingFromEnv } from '../admin-debug/cost-pricing.js';
import type { DebugTurnTrace } from '../admin-debug/debug-session.service.js';
import {
  estimateSessionCost,
  type SessionCostBasis,
  type SessionCostPricing,
  type SessionUsageTotals,
} from '../engine-adapters/observability/session-cost.js';
import { RenderConfigFactory } from '../engine-adapters/wiring/render-config.factory.js';
import { toEncounterColumns, type EncounterInput } from '../shared/encounter/encounter-scene.js';
import { inspectGeneratedOutput, safeOutputFallback } from '../shared/text/output-integrity.js';

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

/**
 * 默认最大轮数 (一场对练聊多少轮).
 *
 * ⚠️ AF-091: 真正的真相源是**会话档案** (`session-profile.ts` 的 legacy 档);
 *   这个常量只是对外暴露的老名字, 值仍然是 15 (逐字不变).
 */
export const DEFAULT_MAX_TURNS = LEGACY_SESSION_PROFILE.maxTurns;

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
export const STAGNANT_LITERAL_STREAK_LIMIT = LEGACY_SESSION_PROFILE.stagnantLiteralStreakLimit;

/** 无推进阈值: 来访者连续 N 轮没有带来新信息即判停滞. */
export const STAGNANT_NO_PROGRESS_LIMIT = LEGACY_SESSION_PROFILE.stagnantNoProgressLimit;

/** 无推进判定的相似度阈值: 与历史全部来访文本的最大相似度 ≥ 该值 = 没带新信息. */
export const NO_PROGRESS_SIMILARITY_THRESHOLD = 0.8;

/**
 * 危机后置练习窗轮数 (WP-J 改动 B).
 *
 * 危机披露后**不终止**, 继续练这么多轮危机应对. 取 4:
 *   - 少 1 轮走不完"安全确认 → 稳定化 → 下一步"三步;
 *   - 多 1 轮就会滑进"反复追问细节", 反而稀释训练目标.
 * 这是产品决策 (用户已拍板), 不是临床标定.
 *
 * ⚠️ AF-091: 这是 **legacy 档** 的取值 (长会话档是 6 轮);
 *   实际生效的值由会话档案决定, 见 {@link decideTurn} 的 thresholds 入参.
 */
export const CRISIS_PRACTICE_TURNS = LEGACY_SESSION_PROFILE.crisisPracticeTurns;

/**
 * 跑一场对练的入参.
 */
export interface RunPracticeInput {
  /** 来访者角色 slug. */
  readonly characterSlug: string;
  /** 咨询师模式. */
  readonly counselorMode: CounselorMode;
  /** 最大轮数 (缺省 = 档案的 maxTurns; legacy 档 = 15). */
  readonly maxTurns?: number;
  /**
   * 会话档案 (AF-091; 缺省 = legacy, 行为与 2026-11-18 之前逐字一致).
   *
   * 决定四组阈值: 轮数上限 / 最早自然收尾轮次 / 停滞阈值 / 危机后置窗.
   */
  readonly sessionProfile?: SessionProfileName;
  /** 批量批次 id (单场实时跑为 null). */
  readonly batchId?: string | null;
  /** 预生成的场次 id (controller 立即返回给前端用; 不传则 runner 自己生成). */
  readonly practiceSessionId?: string;
  /** 场景类型 (WP-B: 考核场景硬隔离 rule_only; 缺省 full_simulation). */
  readonly scenarioType?: ScenarioType;
  /**
   * 接触方式 (AF-187): 面对面 / 线上（video/voice/text）.
   *
   * 缺省 = 面对面由 controller 显式解析后注入；runner 内部不猜场景。
   */
  readonly encounter?: EncounterInput;
}

/**
 * 一场对练的可观测指标 (WP-J).
 *
 * ⚠️ 全部是数字 / 枚举 / 轮次 —— **不含任何对话文本**(隐私红线),
 *   可以安全进日志、进库、进看板.
 */
/**
 * AF-187 · 危机收尾结论（与旧 `crisisEnded` 分开的可读枚举）.
 *
 * - `none`：本场没有进入危机窗；
 * - `safety_plan_completed`：危机窗内五组安全动作全部落地后正常收尾；
 * - `escalated`：强度二次升级, 按升级通道终止；
 * - `incomplete`：走了危机路径但五组未齐 / 修复失败。
 */
export type PracticeCrisisOutcome = 'none' | 'safety_plan_completed' | 'escalated' | 'incomplete';

export interface PracticeRunMetrics {
  /** 咨询师语义回响轮数 (反映式复述的计数, 不参与终止). */
  readonly counselorSemanticEchoTurns: number; /** 是否经历过后置危机练习窗. */
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
export interface CrisisWindowState {
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
  /**
   * AF-137: 首次发生强度上升的轮次.
   * 非升级路径为 null; standard / long 档用它把"升级后必须先做的风险收束轮"钉住,
   * 避免 crisis_escalated 在披露当轮直接终止 (AF-136 packet-09 的 P0).
   */
  escalationTurn?: number | null;
  /**
   * AF-138: 升级后的计划轮是否仍缺安全要素.
   * true 时 runner 追加 1 个修复轮; 修复轮后仍缺则以 crisis_safety_incomplete 结束.
   */
  safetyRepairPending?: boolean;
  /** AF-138: 上一次内容门判出的缺失要素, 供修复轮 prompt 逐项补齐. */
  missingSafetyElements?: readonly RiskClosingElementKey[];
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
  /** AF-187: 危机收尾可读结论. */
  readonly crisisOutcome: PracticeCrisisOutcome;
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
    // WP-J P1e Phase2: 来访者语义落库服务 (optional).
    //   为什么 optional: 既有单测直接 new runner (不注入这个服务) —— 缺它时跳过语义落库,
    //   不能让"没注入"变成"跑不起来". 生产环境 AutoPracticeModule 一定注册了它.
    @Optional() private readonly semanticPersister?: SemanticTurnPersister,
    // AF-314: 来访者渲染主候选的真实 provider/model（只读出口，供会话级落库）.
    //   为什么 optional: 既有单测直接 new runner，不注入装配层；缺它时模型列写 NULL,
    //   但绝不能因为"可观测字段取不到"就让对练本身开不起来.
    @Optional() private readonly renderConfigFactory?: RenderConfigFactory,
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
    // AF-091: 会话档案决定本场所有阈值 (缺省 = legacy, 逐字不变).
    const profile = resolveSessionProfile(input.sessionProfile);
    // 未知档名回落 legacy (不抛异常, 不让整场对练崩掉) —— 但要说出来, 别让人以为长会话生效了.
    const requestedProfile = (input.sessionProfile ?? '').trim();
    if (requestedProfile.length > 0 && requestedProfile !== profile.name) {
      this.logger.warn(`[auto_practice] 未知会话档案 "${requestedProfile}", 回落 ${profile.name}`);
    }
    // ⚠️ 显式 maxTurns 只压**上限**, 不改档案阈值.
    //   组合出"上限 < 最早收尾轮次"时自然收尾不可达 (会跑满上限) —— 入口层已经拦掉这种组合.
    const maxTurns = input.maxTurns ?? profile.maxTurns;
    const practiceSessionId = input.practiceSessionId ?? nanoid();
    const scenarioType = input.scenarioType ?? 'full_simulation';
    let debugSessionId = '';
    let status: PracticeSessionStatus = 'running';
    let exitReason = 'max_turns';
    let crisisEnded = 0;
    let crisisOutcome: PracticeCrisisOutcome = 'none';
    let turnCount = 0;
    let degradedTurns = 0;
    let counselorDegradedTurns = 0;
    let visitorDegradedTurns = 0;
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
      crisisOutcome: PracticeCrisisOutcome;
      turnCount: number;
      degradedTurns: number;
      counselorDegradedTurns: number;
      visitorDegradedTurns: number;
      renderFallbackTurns: number;
      llmCallTurns: number;
      metrics: PracticeRunMetrics;
    };
    try {
      loopResult = await this.runConversationLoop(input, practiceSessionId, debugSessionId, maxTurns, history, usage, profile);
    } catch (error) {
      loopResult = {
        status: 'failed',
        exitReason: 'error',
        crisisEnded: 0,
        crisisOutcome: 'none',
        turnCount: 0,
        degradedTurns: 0,
        counselorDegradedTurns: 0,
        visitorDegradedTurns: 0,
        // WP-J P1d: 循环抛异常 → 计数按 0 落库 (与既有 degraded_turns 同口径:
        //   异常路径拿不到循环内的局部计数, 不拿"部分值"冒充整场口径).
        renderFallbackTurns: 0,
        llmCallTurns: 0,
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
    crisisOutcome = loopResult.crisisOutcome;
    turnCount = loopResult.turnCount;
    degradedTurns = loopResult.degradedTurns;
    counselorDegradedTurns = loopResult.counselorDegradedTurns;
    visitorDegradedTurns = loopResult.visitorDegradedTurns;
    // WP-J P1d: 批次有效性门禁的两列 (访客侧口径).
    const renderFallbackTurns = loopResult.renderFallbackTurns;
    const llmCallTurns = loopResult.llmCallTurns;
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
      crisisOutcome,
      errorMessage,
      degradedTurns,
      promptTokens: usageTotals.promptTokens,
      completionTokens: usageTotals.completionTokens,
      reasoningTokens: usageTotals.reasoningTokens,
      totalTokens: usageTotals.totalTokens,
      totalCostCny: cost.estimatedCostCny,
      costBasis: cost.costBasis,
      // WP-J P1b: 危机练习窗指标落库 (布尔量转 0/1, 跟 crisis_ended 同口径).
      //   ⚠️ 失败路径走的是 emptyMetrics() —— 这里写进去的是 0 / null / 0 / 0 / null / 0,
      //      语义是"这场没测到危机指标", **不是** undefined.
      crisisPracticed: metrics.crisisPracticed ? 1 : 0,
      crisisFirstTurn: metrics.crisisFirstTurn,
      crisisPostTurns: metrics.crisisPostTurns,
      crisisPeakLevel: metrics.crisisPeakLevel,
      crisisCategory: metrics.crisisCategory,
      crisisEscalated: metrics.crisisEscalated ? 1 : 0,
      // WP-J P1d: 渲染兜底 / 真实调用两列落库 (批次有效性门禁靠它们判合格).
      //   ⚠️ 这两列此前**建了但没人写** → 批次健康服务永远算出 llmCallRatio=0,
      //     于是任何批次都被判 `LLM_CALL_RATIO_LOW` + `FALLBACK_RATIO_UNKNOWN` 不合格.
      renderFallbackTurns,
      llmCallTurns,
      // WP-J P1d: 两侧降级拆分列落库 (WP-H 改动 5 建了, 此前同样没人写).
      //   `degraded_turns` 仍是两侧合计 (口径不变), 这两列给出"哪一侧降的".
      counselorDegradedTurns,
      visitorDegradedTurns,
    });

    // ⑧ 推 session_end.
    const endPayload: AutoPracticeSessionEndPayload = {
      practiceSessionId,
      status,
      exitReason,
      turnCount,
      crisisEnded: crisisEnded === 1,
      crisisOutcome,
      // WP-J: 危机练习窗与语义回响指标 (纯数字/枚举).
      //   ⚠️ WS 契约里这两个是 **boolean** (跟库里那两列的 0/1 不是一回事):
      //   WS 面向前端实时渲染, 库里面向查询与统计 —— 两套载体, 两套表示.
      crisisPracticed: metrics.crisisPracticed,
      crisisPostTurns: metrics.crisisPostTurns,
      // WP-J P1b: 补齐剩下的 4 个危机字段 (与库列同源, 不另算一套).
      crisisFirstTurn: metrics.crisisFirstTurn,
      crisisPeakLevel: metrics.crisisPeakLevel,
      crisisCategory: metrics.crisisCategory,
      crisisEscalated: metrics.crisisEscalated,
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
      crisisOutcome,
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
    profile: SessionProfile,
  ): Promise<{
    status: PracticeSessionStatus;
    exitReason: string;
    crisisEnded: number;
    crisisOutcome: PracticeCrisisOutcome;
    turnCount: number;
    degradedTurns: number;
    /** WP-J P1d: 咨询师侧降级轮数 (两侧拆分, WP-H 改动 5 的列此前无人写). */
    counselorDegradedTurns: number;
    /** WP-J P1d: 来访者侧降级轮数 (同上). */
    visitorDegradedTurns: number;
    /** WP-J P1d: 访客侧渲染兜底轮数. */
    renderFallbackTurns: number;
    /** WP-J P1d: 访客侧真实 LLM 调用轮数. */
    llmCallTurns: number;
    metrics: PracticeRunMetrics;
  }> {
    let status: PracticeSessionStatus = 'running';
    let exitReason = 'max_turns';
    let crisisEnded = 0;
    let crisisOutcome: PracticeCrisisOutcome = 'none';
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
      escalationTurn: null,
      safetyRepairPending: false,
      missingSafetyElements: [],
    };
    /** AF-138: 强制收束窗内咨询师正文（用于常规收束三项内容门）。 */
    const closingTexts: string[] = [];
    /** AF-138: 升级后安全序列内咨询师正文（用于风险收束五组内容门）。 */
    const crisisSafetyTexts: string[] = [];
    let degradedTurns = 0;
    // WP-J P1d: 两侧降级**分开**计数 —— `degraded_turns` 仍是两侧合计 (口径不变),
    //   但 `counselor_degraded_turns` / `visitor_degraded_turns` 这两列 WP-H 就建好了,
    //   此前**全库无人写** → 批次看板与 audit 拿到的永远是 0.
    let counselorDegradedTurns = 0;
    let visitorDegradedTurns = 0;
    // WP-J P1d: 访客侧两个口径 (批次有效性门禁的两列, 见 §2).
    //   renderFallbackTurns —— 访客侧渲染兜底 (providerHint==='degraded') 的轮数;
    //   llmCallTurns        —— 访客侧**真调了 LLM** 的轮数 (兜底轮与阻断轮都不算).
    let renderFallbackTurns = 0;
    let llmCallTurns = 0;
    // AF-091: 本场生效的判定阈值 (来自会话档案; legacy = 老常量, 逐字不变).
    const thresholds = sessionThresholdsOf(profile);

    // AF-137: 升级若恰好撞上 maxTurns 最后一轮, 允许额外 1 轮做风险收束;
    //   只放行 maxTurns + 1 这一轮, 不会无限延长.
    for (let i = 1; shouldRunNextTurn(crisisWindow, i, maxTurns, profile.name !== 'legacy'); i += 1) {
      // AF-133: 本轮的动态开关 (强制收束 cue / 风险收束轮).
      //   抽成独立纯函数是为了把 runConversationLoop 的认知复杂度压回阈值内.
      const cue = decideTurnCue({
        turnIndex: i,
        maxTurns,
        crisisActive: crisisWindow.active,
        crisisPostTurns: crisisWindow.postTurns,
        crisisPracticeTurns: thresholds.crisisPracticeTurns,
        crisisEscalated: crisisWindow.escalated,
        crisisEscalationTurn: crisisWindow.escalationTurn ?? null,
        crisisRepairPending: crisisWindow.safetyRepairPending === true,
        crisisMissing: crisisWindow.missingSafetyElements,
        closingText: closingTexts.join('\n'),
      });
      // AI 咨询师生成台词.
      //   WP-J 改动 B: 危机后置练习窗内传 crisisMode —— 咨询师切到"稳定化"任务
      //   (安全确认 / 稳定化 / 下一步), 不再推进新议题.
      //   AF-091: 同时传 sessionProfile (决定要不要加长会话收尾纪律) 与当前轮次
      //   (长会话纪律块要写"当前是第 N 轮").
      //   AF-144: maxTurns 起必走最终收束，且走独立单轮通道（只喂最近 6 条消息摘要），
      //   不再把最后 10 轮历史当连续对话续写。生成后仍缺三件套时做确定性补全。
      const finalClosingTurn = shouldForceFinalClosing(profile, i, maxTurns, crisisWindow.active);
      const rawCounselorReply = await this.counselorAgent.generate(
        input.counselorMode,
        history,
        buildCounselorOptions(profile, i, cue, crisisWindow.active, finalClosingTurn, input.encounter),
      );
      // AF-176: 结构收口统一抽成纯函数，避免主循环复杂度越界。
      const structuredCounselorReply = applyDeterministicStructure(rawCounselorReply, {
        profile,
        turnIndex: i,
        crisisWindow,
        cue,
        finalClosingTurn,
        history,
      });
      // AF-187: 咨询师台词落历史前过完整性闸门 —— 推理泄漏/复述 prompt/外语混入
      //   一律不进 transcript, 用安全短句兜底并计降级轮.
      const counselorReply = applyCounselorOutputGate(structuredCounselorReply, input.encounter);
      degradedTurns += boolToInt(counselorReply.degraded);
      counselorDegradedTurns += boolToInt(counselorReply.degraded);
      history.push({ role: 'counselor', text: counselorReply.text });
      recordClosingTexts(cue, crisisWindow, counselorReply.text, closingTexts, crisisSafetyTexts, counselorReply.closeRequested === true);

      // 引擎跑一轮.
      const rawResult = await this.engine.turn(debugSessionId, counselorReply.text);
      // AF-187: 来访者台词落历史前过完整性闸门 —— 复述 prompt/推理/外语一律替换.
      const result = applyVisitorOutputGate(rawResult, input.encounter);
      turnCount = result.turnIndex;
      // WP-F Step 0: 累加本轮 LLM 用量 (只取数字, 不碰任何心理内容).
      this.accumulateUsage(usage, result.trace);
      // WP-J P1d: 访客侧口径分账 ——
      //   ① 兜底轮 (trace.degraded): 渲染层吐的是系统兜底句, **没调成 LLM**;
      //   ② 阻断轮 (disposal=block): 来访者一个字都没说 (reply 为空), 也没调 LLM;
      //   ③ 其余轮: 真调了 LLM, 计入 llm_call_turns.
      //   ⚠️ "回复非空"是判据 (不是 token 数): token 可能是 0 而调用是真的,
      //     反过来兜底轮回复非空但根本没调用 —— 只有"有内容且没降级"才等于真调用.
      if (result.trace.degraded) {
        degradedTurns += 1;
        visitorDegradedTurns += 1;
        renderFallbackTurns += 1;
      } else if (result.reply.trim().length > 0) {
        llmCallTurns += 1;
      }
      history.push({ role: 'visitor', text: result.reply });

      // WP-J P1e Phase2: 来访者这半边拆三份落库 (displayText / ttsText / semanticJson).
      //   咨询师那半边本批不落语义列 —— counselorReply.text 一行没动.
      //   落库条件 / 失败语义 / 隐私口径见 {@link persistVisitorSemantic}.
      await this.persistVisitorSemantic(practiceSessionId, result);

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
          forcedClose: cue.forcedClose,
          closingText: closingTexts.join('\n'),
          crisisSafetyText: crisisSafetyTexts.join('\n'),
          enforceRoutineClosing: profile.name !== 'legacy',
        },
        crisisWindow,
        stagnation,
        thresholds,
      );

      this.logCrisisEntered(crisisEntered, result.turnIndex, crisisWindow.peakLevel, thresholds.crisisPracticeTurns);

      if (decision.kind === 'stop') {
        ({ status, exitReason } = resolveStopOutcome(decision));
        crisisOutcome = resolveCrisisOutcome(decision.reason, crisisWindow.active, history, crisisWindow.firstTurn);
        if (decision.reason === 'stagnant') {
          this.logger.warn(
            `[auto_practice] 判停滞 turn=${result.turnIndex} literal=${decision.literalStreak} no_progress=${decision.noProgressStreak} max_sim=${decision.maxSimilarity.toFixed(2)}`,
          );
        }
        if (isCrisisExitReason(decision.reason)) crisisEnded = 1;
        break;
      }
      if (decision.closeBlocked) {
        // 危机披露当轮就想收尾 = 把来访者一个人留在危机里. 挡一次, 强制走完稳定化.
        this.logger.warn(`[auto_practice] 危机轮咨询师请求收尾 → 强制继续 session=${practiceSessionId}`);
      }

      lastCounselorText = counselorReply.text;
      visitorHistory.push(result.reply);

      // AF-140: 常规收束一旦在强制收束窗内齐全, 立即收尾.
      // 之前只靠模型输出 END, 模型常在收束后又开新议题; 在 50 轮长会话里
      // 这会制造“收束被埋在中段、最后几轮又在工作”的结构假象, 评分员按
      // “最后 10 轮无收束”上限压到 3. 收束齐全即停, 让收束真正落在末轮.
      if (shouldStopAfterRoutineClosing(cue, crisisWindow, closingTexts)) {
        status = 'completed';
        exitReason = 'natural_close';
        break;
      }
    }

    // 跑满 maxTurns.
    if (status === 'running') {
      status = 'completed';
      exitReason = 'max_turns';
    }
    // AF-187: 危机收尾结论统一收口 —— 跑满 / 自然收尾也要给出可读完成态.
    if (crisisOutcome === 'none' && crisisWindow.active) {
      crisisOutcome = resolveCrisisOutcome(exitReason, true, history, crisisWindow.firstTurn);
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

    return {
      status,
      exitReason,
      crisisEnded,
      crisisOutcome,
      turnCount,
      degradedTurns,
      counselorDegradedTurns,
      visitorDegradedTurns,
      renderFallbackTurns,
      llmCallTurns,
      metrics,
    };
  }

  /**
   * WP-J P1e Phase2: 把**来访者这半边**的回复拆三份落库 (displayText / ttsText / semanticJson).
   *
   * 落库条件 (三个同时满足):
   *   ① `result.trace.degraded === false` —— 渲染层兜底句不是"来访者真说的话"
   *      (它没过 LLM, 也没标记), 落进去只会污染语义统计;
   *   ② `result.reply` 非空 —— 阻断轮 (disposal=block) 来访者一个字都没说;
   *   ③ 危机窗口**不特判** —— 危机轮照样 parse (那正是最需要留证的地方).
   *
   * ⚠️ 失败只 warn 不抛: 语义落库是"锦上添花", 绝不能因为它炸掉整批对练.
   * ⚠️ 日志只打 sessionId / turnIndex / 错误类型 —— 心理原文禁止进日志.
   *
   * 抽成独立方法是为了把 runConversationLoop 的圈复杂度压回阈值内
   * (eslint complexity ≤ 20 / sonarjs cognitive-complexity ≤ 25).
   */
  /**
   * 记录危机窗口首次进入（只记轮次/档位数字，不记对话文本）。
   */
  private logCrisisEntered(entered: boolean, turnIndex: number, peakLevel: number, practiceTurns: number): void {
    if (!entered) return;
    this.logger.warn(`[auto_practice] 危机披露 → 进入后置练习窗 turn=${turnIndex} level=${peakLevel} (不终止, 续 ${practiceTurns} 轮)`);
  }

  private async persistVisitorSemantic(practiceSessionId: string, result: EngineTurnResult): Promise<void> {
    if (result.trace.degraded || result.reply.trim().length === 0) {
      return;
    }
    try {
      await this.semanticPersister?.persistVisitorTurn({
        practiceSessionId,
        turnIndex: result.turnIndex,
        rawVisitorText: result.reply,
      });
    } catch (error) {
      this.logger.warn(`[auto_practice] 语义落库失败 session=${practiceSessionId} turn=${result.turnIndex}: ${errorName(error)}`);
    }
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
      const opened = await this.engine.open(input.characterSlug, scenarioType, input.encounter);
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
        ...toEncounterColumns(input.encounter),
        turnCount: 0,
        crisisEnded: 0,
        exitReason: 'error',
        batchId: input.batchId ?? null,
        errorMessage,
        // V2026-11-11 (G-2): 失败场次也记 prompt 模板版本.
        //   ⚠️ **只补这一个字段** —— 模型 / 种子 / 角色版本 / 审议模式 / 引擎版本
        //   在引擎没开起来时**无定义** (引擎没开 = 没有"跑的模型"与"实际模式"),
        //   硬填一个反而是撒谎. prompt 模板版本不同: 它是静态文件的指纹,
        //   与引擎能否开启无关 —— 所以失败行也写得出来, 也**应该**写.
        promptVersion: this.fingerprintService.resolvePromptVersionOnly(),
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
          crisisOutcome: 'none',
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
      // ⚠️ **引擎侧 session id** (V2026-11-11 G-1): 审议模式的判定必须与运行时
      //   钩子用**同一个 id** (白名单匹配的是引擎侧口径) —— 否则落库与运行时
      //   会出现"记录说谎" (库写 llm_active, 实际名单外没跑).
      debugSessionId,
    );
    await this.persistSession(practiceSessionId, {
      debugSessionId,
      characterSlug: input.characterSlug,
      counselorModeId: input.counselorMode.id,
      status: 'running',
      maxTurns,
      ...toEncounterColumns(input.encounter),
      turnCount: 0,
      crisisEnded: 0,
      exitReason: 'max_turns',
      batchId: input.batchId ?? null,
      errorMessage: null,
      modelVersion: fingerprint.model,
      // AF-314: 模型可观测分列 —— 来访者主候选与咨询师模型不能共用全局指纹.
      ...this.resolveAppliedModelColumns(),
      seedValue: fingerprint.sessionSeed,
      characterVersion: fingerprint.characterVersion,
      deliberationMode: fingerprint.deliberationMode,
      engineVersion: fingerprint.engineVersion,
      // WP-B: prompt 模板版本 —— 批次对比时靠它判断"prompt 文案是不是同一版".
      promptVersion: fingerprint.promptVersion,
    });
    return fingerprint;
  }

  /**
   * 解析本场「来访者主候选 + 咨询师模型」并映射成实体列.
   *
   * AF-314: 可观测字段必须来自**会话启动时的真实装配**，不能读当前 env 现算 ——
   *   配置在会话跑完后被改掉时，历史场次仍应回答「当时用的什么模型」。
   *   visitor 取渲染候选链第 0 位（实际主候选），counselor 取 CounselorAgentService
   *   构造期解析出的唯一模型。
   *
   * 取不到时写 NULL 而不是猜：上游没记录 = 不可得，不能拿全局 `modelVersion` 冒充.
   */
  private resolveAppliedModelColumns(): Pick<PracticeSession, 'visitorModelProvider' | 'visitorModel' | 'counselorModel'> {
    let visitorProvider: string | null = null;
    let visitorModel: string | null = null;
    try {
      const route = this.renderConfigFactory?.primaryVisitorRoute() ?? null;
      visitorProvider = route?.provider.trim() ?? null;
      visitorModel = route?.model.trim() ?? null;
    } catch (error) {
      // 模型不可观测不能阻断对练：只告警，列写 NULL.
      this.logger.warn(`[auto_practice] 解析来访者模型失败，模型列将写 NULL: ${errorName(error)}`);
    }
    const rawCounselorModel = this.counselorAgent.modelId;
    const counselorModel = typeof rawCounselorModel === 'string' ? rawCounselorModel.trim() : '';
    return {
      visitorModelProvider: visitorProvider,
      visitorModel,
      counselorModel: counselorModel.length > 0 ? counselorModel : null,
    };
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
   * 更新终态 (status / turnCount / finishedAt + WP-F 的 token / 成本 / 成本口径
   * + WP-J P1b 的 6 个危机练习窗指标).
   */
  private async updateSessionResult(
    id: string,
    fields: {
      status: PracticeSessionStatus;
      exitReason: string;
      turnCount: number;
      crisisEnded: number;
      /** AF-187: 危机收尾可读结论（none / safety_plan_completed / escalated / incomplete）. */
      crisisOutcome: PracticeCrisisOutcome;
      errorMessage: string | null;
      degradedTurns: number;
      /** WP-F Step 0: 结算落库的用量与成本. */
      promptTokens: number;
      completionTokens: number;
      reasoningTokens: number;
      totalTokens: number;
      totalCostCny: number;
      costBasis: SessionCostBasis;
      /**
       * WP-J P1b: 危机后置练习窗指标 (纯数字 / 枚举, **不含任何台词**).
       *
       * ⚠️ 两个布尔量在**库里**是 0/1 (tinyint), 不是 true/false ——
       *   mysql 驱动读回来就是数字, 跟既有的 crisis_ended / enabled 同口径.
       */
      crisisPracticed: number;
      crisisFirstTurn: number | null;
      crisisPostTurns: number;
      crisisPeakLevel: number;
      crisisCategory: string | null;
      crisisEscalated: number;
      /**
       * WP-J P1d: 访客侧渲染兜底轮数 (providerHint==='degraded').
       *
       * 与既有 `degradedTurns` 的差别: `degradedTurns` 是**两侧**合计
       *   (咨询师侧降级 + 访客侧降级), 这里是**访客侧**那一半 ——
       *   批次健康服务的 `render_fallback_ratio` 问的是"渲染层兜底了多少轮".
       */
      renderFallbackTurns: number;
      /**
       * WP-J P1d: 访客侧**真实 LLM 调用**轮数 (兜底轮 / 阻断轮都不算).
       *
       * ⚠️ 不是 maxTurns: 批次健康服务的 `llm_call_ratio` 要判的是
       *   "这场到底有没有真调上 LLM", 拿 maxTurns 冒充会让整场兜底的批次也被判合格.
       */
      llmCallTurns: number;
      /**
       * WP-J P1d: 咨询师侧降级轮数 (WP-H 改动 5 的列, 此前无人写).
       *
       * 与 `degradedTurns` 的差别: `degradedTurns` 是**两侧**合计,
       *   这里是咨询师那一半 —— 批次看板要分得清"谁降的".
       */
      counselorDegradedTurns: number;
      /**
       * WP-J P1d: 来访者侧降级轮数 (同上).
       */
      visitorDegradedTurns: number;
    },
  ): Promise<void> {
    await this.sessionRepo
      .update(id, {
        ...fields,
        // WP-J P1d: 渲染兜底率 = `render_fallback_turns / turn_count` (实体注释里的口径).
        //   ⚠️ 这列此前**建了但没人写** → 批次健康服务的 fallback_ratio 永远是 null
        //      → 每个批次都被标 `FALLBACK_RATIO_UNKNOWN` → valid 永远 false.
        //   分子分母都取**访客侧**口径 (turn_count = 来访者轮数), 与 render_fallback_turns 同源.
        //   turn_count = 0 (没跑起来) → 落 null: "没测过" ≠ 0, 不替历史数据编结论.
        renderFallbackRatio: fields.turnCount > 0 ? fields.renderFallbackTurns / fields.turnCount : null,
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
 *   本仓 embedding provider (通义 / 豆包 / Qwen) 都要各自 env key 才注册,
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
export interface StagnationState {
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
  /** AF-138: 本场是否已进入强制收束窗 (最后 3 轮). */
  readonly forcedClose?: boolean;
  /** AF-138: 强制收束窗内咨询师正文 (多轮换行拼接). */
  readonly closingText?: string;
  /** AF-138: 升级后安全序列内咨询师正文 (评估轮 + 计划轮/修复轮). */
  readonly crisisSafetyText?: string;
  /**
   * AF-176: 是否启用“常规收束内容门”的全程版本.
   *
   * legacy 档必须逐字不变, 所以由 runner 按档案显式打开; 缺省 false.
   */
  readonly enforceRoutineClosing?: boolean;
}

/** 单轮结束判定的结论. */
type TurnDecision =
  | { readonly kind: 'continue'; readonly closeBlocked: boolean }
  | {
      readonly kind: 'stop';
      readonly reason: 'crisis_escalated' | 'crisis_safety_incomplete' | 'crisis_practice_max' | 'crisis_practice_close' | 'natural_close';
    }
  | {
      readonly kind: 'stop';
      readonly reason: 'stagnant';
      readonly literalStreak: number;
      readonly noProgressStreak: number;
      readonly maxSimilarity: number;
    };

function recordClosingTexts(
  cue: { readonly forcedClose: boolean; readonly crisisClosing: boolean },
  crisisWindow: CrisisWindowState,
  text: string,
  closingTexts: string[],
  crisisSafetyTexts: string[],
  closeRequested = false,
): void {
  // AF-176: 模型在常规轮主动请求 END 时也要把正文纳入内容门, 否则 early close
  //   永远看不到自己的 summary/takeaway/nextStep, 内容门只能误判为空。
  if (cue.forcedClose || closeRequested) closingTexts.push(text);
  if (cue.crisisClosing && crisisWindow.escalated) crisisSafetyTexts.push(text);
}

/**
 * AF-133 · 组装咨询师生成上下文.
 *
 * 抽成独立函数有两个理由:
 *   ① **复杂度**: 三个开关 (强制收束 cue / 剩余轮数 / 风险收束轮) 的三元表达式
 *      放在 runConversationLoop 里会把它顶过 eslint 阈值 (≤20 / ≤25).
 *   ② **口径单一**: "什么时候给什么信号"只有这一处定义, prompt 侧不会收到
 *      互相矛盾的组合 (例如有 closingCue 却说"还剩 5 轮").
 *
 * @param profile 会话档案
 * @param turnIndex 当前轮次
 * @param cue 本轮的动态开关 (见 {@link decideTurnCue})
 * @param crisisActive 危机后置练习窗是否激活
 * @returns 传给咨询师生成接口的上下文
 */
/**
 * AF-144: 是否触发“本场最后一次收束”。
 * 到 `maxTurns` 当轮就触发，不再等待 +1/+2；最终通道生成后由确定性补全兜底，
 * 避免模型在额外补齐轮继续开新议题。
 */
export function shouldForceFinalClosing(profile: SessionProfile, turnIndex: number, maxTurns: number, crisisActive: boolean): boolean {
  if (profile.name === 'legacy' || crisisActive) return false;
  // 到点必触发：不再依赖“把收束窗拼成一段”的 complete 判定。
  // 那个判定会把不同轮次的“总结”和“我听到”拼成同一轮，误判为已收束，
  // 于是 maxTurns+1/+2 的最终通道根本没有跑（AF-143 根因）。
  return turnIndex >= maxTurns;
}

/**
 * AF-140: 强制收束窗内常规三件套齐全后是否立即收尾。
 * 抽成纯函数是为了压住 `runConversationLoop` 的圈/认知复杂度。
 */
function shouldStopAfterRoutineClosing(
  cue: { readonly forcedClose: boolean },
  crisisWindow: CrisisWindowState,
  closingTexts: readonly string[],
): boolean {
  return cue.forcedClose && !crisisWindow.active && evaluateRoutineClosingText(closingTexts.join('\n')).complete;
}

/**
 * AF-143 · 最终收束的确定性兜底。
 *
 * 模型即使走独立通道仍可能只写两段或漏掉 summary；这里按缺失项补齐，
 * 并把本轮标成“请求 END”，保证最终收束真正落在末轮。
 * 只补结构句式，不编造来访者没说过的具体事实。
 */
function completeFinalClosingReply(reply: CounselorReply, history: readonly CounselorHistoryTurn[]): CounselorReply {
  const lastVisitorText = [...history].reverse().find((turn) => turn.role === 'visitor')?.text ?? '';
  const completed = completeRoutineClosingText(reply.text, lastVisitorText);
  return {
    ...reply,
    text: completed,
    closeRequested: true,
  };
}

/**
 * AF-176 · 咨询师回复的结构收口（从主循环抽出，压住认知复杂度）。
 *
 * 只做三件事，且都不改评分/不改阈值：
 *   ① standard/long 首轮补开场五要素；legacy 不补；
 *   ② 最终收束轮补常规三件套（AF-144 既有逻辑）；
 *   ③ 危机升级后的计划/修复轮补风险五组（评估轮不补）。
 *
 * @param reply 咨询师原始回复
 * @param input 本轮结构上下文
 * @returns 补结构后的回复
 */
function applyDeterministicStructure(
  reply: CounselorReply,
  input: {
    readonly profile: SessionProfile;
    readonly turnIndex: number;
    readonly crisisWindow: CrisisWindowState;
    readonly cue: ReturnType<typeof decideTurnCue>;
    readonly finalClosingTurn: boolean;
    readonly history: readonly CounselorHistoryTurn[];
  },
): CounselorReply {
  let result =
    input.turnIndex === 1 && input.profile.name !== 'legacy' && !input.crisisWindow.active
      ? { ...reply, text: completeOpeningText(reply.text) }
      : reply;
  if (input.finalClosingTurn) result = completeFinalClosingReply(result, input.history);
  // AF-176: 风险收束五组不绑定“强度升级”. 只披露一次、未升级的危机同样可能在
  //   crisisClosing 轮结束; 旧条件要求 escalated 才补齐, 导致 risk-incomplete 漏项.
  // AF-187: 按**会话级覆盖账本**补齐 —— 历史轮次已落地的组不再重复追加,
  //   连续风险收束轮最多只补真正缺的那几组.
  // AF-392: 所有档位都必须真正走到这一轮；legacy 档出口改为“多留 1 轮”，
  //   由 decideCrisisWindowStop 保证 crisisClosing cue 发出后再结束。
  if (input.crisisWindow.active && input.cue.crisisClosing) {
    const coveredBefore = riskGroupsCoveredByHistory(input.history, input.crisisWindow.firstTurn);
    result = { ...result, text: completeRiskClosingText(result.text, coveredBefore) };
  }
  return result;
}

/**
 * AF-187 · 把退出原因 + 历史覆盖折算成可读的危机收尾结论.
 *
 * @param reason 终止原因（或跑满时的 exitReason）
 * @param crisisActive 本场是否进过危机窗
 * @param history 会话历史
 * @returns 危机收尾结论
 */
function resolveCrisisOutcome(
  reason: string,
  crisisActive: boolean,
  history: readonly CounselorHistoryTurn[],
  crisisFirstTurn = 1,
): PracticeCrisisOutcome {
  if (!crisisActive) return 'none';
  if (reason.startsWith('crisis_escalated')) return 'escalated';
  if (reason.startsWith('crisis_safety_incomplete')) return 'incomplete';
  const covered = riskGroupsCoveredByHistory(history, crisisFirstTurn);
  return covered.length >= RISK_CLOSING_ELEMENT_KEYS.length ? 'safety_plan_completed' : 'incomplete';
}

/**
 * AF-187 · 从会话历史算出**已经落地**的风险收束组.
 *
 * 只扫咨询师台词，且只扫危机披露之后的部分：来访者提"热线"不等于咨询师做过风险收束，
 * 披露前聊到别人的安全计划也不能充数。
 *
 * @param history 会话历史（咨询师/来访者交替，从第 1 轮开始）
 * @param crisisFirstTurn 危机首次披露轮次（1-based）
 * @returns 已覆盖的风险组
 */
function riskGroupsCoveredByHistory(history: readonly CounselorHistoryTurn[], crisisFirstTurn = 1): readonly RiskClosingElementKey[] {
  // 历史按「咨询师 → 来访者」成对推进。危机是在来访者第 N 轮披露的，因此披露轮的
  // 咨询师台词（同一轮的前半段）必须排除，从下一轮咨询师开始算：
  //   (firstTurn - 1) * 2 = 披露轮咨询师；再 + 2 = 披露后的第一句咨询师。
  const fromIndex = Math.max(0, (crisisFirstTurn - 1) * 2 + 2);
  const counselorText = history
    .slice(fromIndex)
    .filter((turn) => turn.role === 'counselor')
    .map((turn) => turn.text)
    .join('\n');
  if (counselorText.length === 0) return [];
  const evaluation = evaluateRiskClosingText(counselorText);
  return RISK_CLOSING_ELEMENT_KEYS.filter((key) => evaluation.elements[key].covered);
}

/**
 * AF-187 · 布尔值转 0/1（用于在不增加主循环分支的前提下累加降级计数）.
 *
 * @param value 可能缺省的布尔标记
 * @returns true → 1；其余 → 0
 */
function boolToInt(value: boolean | undefined): number {
  return value === true ? 1 : 0;
}

/**
 * AF-187 · 咨询师台词输出完整性闸门.
 *
 * 命中提示词复述 / 无标签推理 / 异常外语 / 场景漂移 → 换成安全短句并标降级；
 * 未命中则原样返回（不润色、不改写）。
 */
function applyCounselorOutputGate(reply: CounselorReply, encounter?: EncounterInput): CounselorReply {
  const verdict = inspectGeneratedOutput(reply.text, 'counselor', encounter);
  if (!verdict.invalid) {
    // 合法但含**已闭合**的推理块：落历史前用剥离后的干净文本，不让推理过程进逐字稿。
    return verdict.clean === reply.text ? reply : { ...reply, text: verdict.clean };
  }
  return {
    ...reply,
    text: safeOutputFallback('counselor'),
    degraded: true,
    closeRequested: false,
  };
}

/**
 * AF-187 · 来访者台词输出完整性闸门.
 *
 * 命中复述 prompt / 推理 / 外语 / 场景漂移 → 替换为安全短句并把 trace 标降级，
 * 坏文本绝不进入 history 或逐字稿。
 */
function applyVisitorOutputGate(result: EngineTurnResult, encounter?: EncounterInput): EngineTurnResult {
  // 空回复 = 上游阻断/没生成（不是坏台词），保持原样，否则会把"没出声"改写成"出声了"，
  // 让阻断轮统计和来访者行为同时失真。
  if (result.reply.trim().length === 0) return result;
  const verdict = inspectGeneratedOutput(result.reply, 'visitor', encounter);
  if (!verdict.invalid) {
    // 合法但含已闭合推理块 → 用剥离后的文本落库，推理过程不得进逐字稿/后续上下文。
    return verdict.clean === result.reply ? result : { ...result, reply: verdict.clean };
  }
  return {
    ...result,
    reply: safeOutputFallback('visitor'),
    trace: { ...result.trace, degraded: true },
  };
}

function buildCounselorOptions(
  profile: SessionProfile,
  turnIndex: number,
  cue: {
    readonly forcedClose: boolean;
    readonly remainingTurns: number;
    readonly crisisClosing: boolean;
    readonly crisisClosingRound?: number;
    readonly crisisMissing?: readonly string[];
    readonly closingMissing?: readonly string[];
  },
  crisisActive: boolean,
  finalClosing = false,
  encounter?: EncounterInput,
): CounselorGenerateContext {
  return {
    crisisMode: crisisActive,
    sessionProfile: profile.name,
    turnIndex,
    encounter,
    closingCue: cue.forcedClose ? 'forced' : undefined,
    remainingTurns: cue.forcedClose ? cue.remainingTurns : undefined,
    crisisClosing: cue.crisisClosing,
    crisisClosingRound: cue.crisisClosingRound,
    crisisMissing: cue.crisisMissing,
    closingMissing: cue.closingMissing,
    finalClosing,
  };
}

const RISK_ELEMENT_LABELS: Record<RiskClosingElementKey, string> = {
  means: '移除危险物 / 开放安全空间',
  channel: '求助渠道（热线 / 120 / 急诊 / 110）',
  contact: '可联系的人',
  noAlone: '不要独处',
  commitment: '安全承诺 / 安全计划',
};

/** 常规收束三件套的中文标签（修复轮逐项补齐用）。 */
const ROUTINE_ELEMENT_LABELS: Record<ClosingElementKey, string> = {
  summary: '总结 / 回顾',
  takeaway: '带走 / 记住',
  nextStep: '下次 / 回去可以试',
};

function resolveCrisisClosingRound(input: {
  readonly crisisEscalated?: boolean;
  readonly crisisEscalationTurn?: number | null;
  readonly crisisRepairPending?: boolean;
  readonly turnIndex: number;
}): number | undefined {
  if (input.crisisRepairPending === true) return 3;
  if (input.crisisEscalated !== true || input.crisisEscalationTurn == null) return undefined;
  return Math.max(1, input.turnIndex - input.crisisEscalationTurn);
}

/**
 * AF-133 · 本轮的动态开关 (强制收束 cue / 风险收束轮).
 *
 * ── forcedClose ───────────────────────────────────────────────────────────
 *   `remaining = maxTurns - turnIndex` (本轮之后还剩几轮), `remaining <= 2` 就注入
 *   强制收束 cue —— 也就是**最后 3 轮**都会收到"本场即将结束"的信号 (最后 2 轮
 *   必然在内). 背景见 AF-131 §2.2: 8/16 场次被 max_turns 硬切, 而模型**无从知道**
 *   自己会被切, 于是永远不请求 END, 收束三件套没有机会说出来.
 *   ⚠️ 提前 1 轮注入是刻意的: 多给模型一轮把三件套做完的机会.
 *
 * ── crisisClosing ─────────────────────────────────────────────────────────
 *   ① 危机窗用满 (postTurns ≥ crisisPracticeTurns) 之后的**那一轮** = 风险收束轮;
 *   ② 危机窗里撞上限的最后 2 轮 (否则会带着没收收束的风险被 max_turns 切掉).
 *   这一轮 prompt 会要求模型把风险收束五项逐项落地, 而不是只做 grounding.
 *
 * @param input 本轮事实
 * @returns 本轮的动态开关
 */
export function decideTurnCue(input: {
  readonly turnIndex: number;
  readonly maxTurns: number;
  readonly crisisActive: boolean;
  readonly crisisPostTurns: number;
  readonly crisisPracticeTurns: number;
  /** AF-137: 危机强度是否已经上升 —— 上升后的下一轮必须先做风险收束. */
  readonly crisisEscalated?: boolean;
  /** AF-137: 升级轮次, 用来算当前是升级后第几个收束轮. */
  readonly crisisEscalationTurn?: number | null;
  /** AF-138: 升级后的计划轮是否仍缺安全要素 (缺则追加修复轮). */
  readonly crisisRepairPending?: boolean;
  /** AF-138: 内容门判出的缺失要素. */
  readonly crisisMissing?: readonly RiskClosingElementKey[];
  /** AF-140: 强制收束窗内已累积的咨询师正文（判断常规三件套是否齐）. */
  readonly closingText?: string;
}): {
  readonly forcedClose: boolean;
  readonly remainingTurns: number;
  readonly crisisClosing: boolean;
  /** AF-137: 升级后第几个收束轮 (1 = 评估轮, 2 = 计划轮, 3 = 修复轮); 非升级路径不传. */
  readonly crisisClosingRound?: number;
  /** AF-138: 修复轮要逐项补齐的缺失要素. */
  readonly crisisMissing?: readonly string[];
  /** AF-140: 常规收束三件套仍缺的要素（中文标签）. */
  readonly closingMissing?: readonly string[];
} {
  const remaining = input.maxTurns - input.turnIndex;
  const forcedClose = remaining <= 2;
  const repairPending = input.crisisRepairPending === true;
  const crisisClosing =
    input.crisisActive &&
    (input.crisisEscalated === true || repairPending || input.crisisPostTurns >= input.crisisPracticeTurns || forcedClose);
  const crisisClosingRound = resolveCrisisClosingRound(input);
  // AF-140: 常规收束窗内，三件套不齐时把缺失项带给 prompt（下一轮逐项补齐）。
  const routineClosing = forcedClose && !input.crisisActive ? evaluateRoutineClosingText(input.closingText ?? '') : null;
  const closingMissing =
    routineClosing !== null && !routineClosing.complete ? routineClosing.missing.map((key) => ROUTINE_ELEMENT_LABELS[key]) : undefined;
  return {
    forcedClose,
    remainingTurns: remaining + 1,
    crisisClosing,
    crisisClosingRound,
    crisisMissing: repairPending ? (input.crisisMissing ?? []).map((key) => RISK_ELEMENT_LABELS[key]) : undefined,
    closingMissing,
  };
}

/**
 * AF-137 · 危机强度上升的判定与出口.
 *
 * 只有**强度真的上升**才算二次升级; 同等或更低强度的"又说了一次"正是稳定化过程.
 * standard / long 档不在升级当轮终止, 记下 escalationTurn 让下一轮做风险收束;
 * legacy 档保持档案契约的"升级即终止".
 *
 * @returns 需要立即返回的判定; null 表示强度未上升, 继续常规流程
 */
function applyCrisisEscalation(
  input: TurnJudgementInput,
  crisisWindow: CrisisWindowState,
  thresholds: SessionThresholds,
): TurnDecision | null {
  const level = crisisLevelOf(input.crisisCategory);
  if (level <= crisisWindow.peakLevel) return null;
  crisisWindow.peakLevel = level;
  crisisWindow.category = input.crisisCategory ?? crisisWindow.category;
  // 升级这一轮本身也是练过的一轮, 计入练习轮数, 否则指标会少算 1.
  crisisWindow.postTurns += 1;
  crisisWindow.escalated = true;
  if (!thresholds.crisisRiskClosingRound) {
    return { kind: 'stop', reason: 'crisis_escalated' };
  }
  crisisWindow.escalationTurn = input.turnIndex;
  return { kind: 'continue', closeBlocked: false };
}

/**
 * AF-137 · 是否还要跑下一轮.
 * 升级撞上 maxTurns 最后一轮时只额外放行 1 轮, 不会无限延长.
 * AF-140: standard / long 档允许额外 2 轮补齐常规收束三件套（legacy 逐字不变）.
 */
function shouldRunNextTurn(crisisWindow: CrisisWindowState, turnIndex: number, maxTurns: number, allowClosingExtension: boolean): boolean {
  const routineExtension = allowClosingExtension ? 2 : 0;
  return turnIndex <= maxTurns + routineExtension || (crisisWindow.escalated && turnIndex <= maxTurns + 3);
}

/**
 * AF-137 · 升级后的风险收束轮是否已经跑完.
 * 只在 standard / long 档生效; 升级当轮在 decideTurn 里提前 return, 走不到这里.
 */
function shouldStopAfterEscalation(input: TurnJudgementInput, crisisWindow: CrisisWindowState, thresholds: SessionThresholds): boolean {
  return (
    thresholds.crisisRiskClosingRound &&
    crisisWindow.escalated &&
    crisisWindow.escalationTurn != null &&
    input.turnIndex >= crisisWindow.escalationTurn + 2
  );
}

/**
 * AF-137 · 是否还处在升级后的两轮安全序列里 (评估轮 / 计划轮).
 * 这两轮里模型的 END 请求也要被忽略, 先把评估与计划做完.
 */
function isEscalationSafetyWindow(input: TurnJudgementInput, crisisWindow: CrisisWindowState, thresholds: SessionThresholds): boolean {
  const extraRounds = crisisWindow.safetyRepairPending === true ? 3 : 2;
  return (
    thresholds.crisisRiskClosingRound &&
    crisisWindow.escalated &&
    crisisWindow.escalationTurn != null &&
    input.turnIndex < crisisWindow.escalationTurn + extraRounds
  );
}

function isRoutineClosingBlocked(input: TurnJudgementInput, crisisWindow: CrisisWindowState, closeAllowed: boolean): boolean {
  // AF-176: 收束内容门不再只对“强制收束窗”生效.
  //   模型在常规轮次主动 END 时经常只写 takeaway/nextStep、漏 summary；
  //   旧实现只在 forcedClose=true 时挡回，early close 会绕过内容门，审计直接记 none。
  //   只在“确实开始收尾”（forcedClose 或正文含收尾信号）时挡，避免把普通工作轮的
  //   END 也无限拖到 maxTurns；legacy 档由 runner 显式关闭该门。
  const closing = evaluateRoutineClosingText(input.closingText ?? '');
  const closingAttempt = input.forcedClose === true || /(总结|带走|下次|下一步|我听到)/.test(input.closingText ?? '');
  return closeAllowed && !crisisWindow.active && input.enforceRoutineClosing === true && closingAttempt && !closing.complete;
}

function isCrisisExitReason(reason: string): boolean {
  return reason === 'crisis_escalated' || reason === 'crisis_safety_incomplete';
}

/**
 * 单轮结束判定 (纯函数, WP-J 改动 A+B 的全部判据都收敛在这里).
 *
 * 优先级与旧实现一致, 但**每一条的理由都改了**:
 *   ① 危机: 首次披露**不终止**(开窗); 只有强度上升才终止.
 *   ② 危机窗计时: 披露之后满 crisisPracticeTurns 轮 → 正常收尾.
 *   ③ 自然收尾: 危机窗内"披露当轮就收尾"挡一次 (不能把来访者留在危机里),
 *      之后咨询师再请求才认; 且轮次必须 ≥ minTurnsBeforeClose.
 *   ④ 停滞: **只认来访者侧**(字面复读连 N / 无推进连 M); 咨询师语义回响只计数.
 *
 * ── AF-133 · 收束可达性 (改的是 ② 和 ③ 的**顺序**, 不是阈值) ──────────────
 *   AF-131 复核 (§2.2) 判定: 16 场 long packet 里 14 场**结构上走不到收尾** ——
 *   6 场被危机窗计数器硬切, 8 场被 max_turns 硬切; 唯二走到收尾路径的 2 场都产出了
 *   takeaway. 也就是说 AF-129 的收束纪律在**可达路径上 2/2 有效**, 病根在 runner 出口.
 *   本单改两处:
 *   ① **危机窗用满不再硬切**: 计数到 crisisPracticeTurns 时**先继续**, 多留 1 轮做
 *      风险收束 (五项), 收束轮之后才结束 —— 那一轮由 runner 传 crisisClosing cue,
 *      prompt 才会让模型把 means/channel/contact/noAlone/commitment 逐项落地.
 *      ⚠️ 只对 standard / long 生效 (thresholds.crisisRiskClosingRound): legacy 档
 *        的档案契约把危机窗钉在 4 轮, 且 15 轮短对练不存在这个问题.
 *   ② **模型的收尾请求优先于计数器**: 危机窗已过披露轮 (postTurns ≥ 1) 且咨询师
 *      请求 END 时, 走 crisis_practice_close, **不再被 crisis_practice_max 覆盖**
 *      (AF-131 §2.2 的 packet-12: 第 45 轮本该收尾, 被计数器抢走).
 *      同时在危机窗里**动态放开 minTurnsBeforeClose** —— 危机窗本身是有界的短协议,
 *      收束是安全动作, 不能被会话级门槛 (long = 35 轮) 卡住, 否则风险收束又不可达.
 *
 * 之所以抽成纯函数: 判定逻辑要能被标定脚本按同一份代码回放
 * (scripts/ops/calibration/stagnation-calibration.ts), 不能在两条路径上各写一遍.
 *
 * ⚠️ AF-091: 阈值**由调用方显式传入** (thresholds 入参), 函数体里不再读模块常量 ——
 *   否则"这一场用的是哪一档阈值"就只能靠猜. 缺省 = legacy (与 2026-11-18 之前一致).
 *
 * @param input 本轮事实
 * @param crisisWindow 危机窗状态 (会被就地更新)
 * @param stagnation 停滞计数 (会被就地更新)
 * @param thresholds 本场生效的阈值 (缺省 = legacy 档)
 * @returns 判定结论
 */
export function decideTurn(
  input: TurnJudgementInput,
  crisisWindow: CrisisWindowState,
  stagnation: StagnationState,
  thresholds: SessionThresholds = LEGACY_SESSION_THRESHOLDS,
): TurnDecision {
  const crisisStartedThisTurn = input.crisisDetected && !crisisWindow.active;

  if (input.crisisDetected) {
    const level = crisisLevelOf(input.crisisCategory);
    if (crisisStartedThisTurn) {
      crisisWindow.active = true;
      crisisWindow.firstTurn = input.turnIndex;
      crisisWindow.peakLevel = level;
      crisisWindow.category = input.crisisCategory;
    } else {
      const escalationDecision = applyCrisisEscalation(input, crisisWindow, thresholds);
      if (escalationDecision) return escalationDecision;
    }
  }

  // 危机窗计时: 只统计"披露之后"的轮次, 披露那一轮本身不算练习轮.
  //   ⚠️ 这里只**计数**, 不再决定结束 —— 结束判定挪到下面 (AF-133: 计数先于关闭判定
  //     会让模型的收尾请求被计数器抢走).
  if (crisisWindow.active && !crisisStartedThisTurn) {
    crisisWindow.postTurns += 1;
  }

  // AF-133 ①: 危机窗已过披露轮 + 咨询师请求收尾 → 优先走危机收束路径,
  //   不被 crisis_practice_max 覆盖 (危机窗里动态放开 minTurnsBeforeClose).
  // AF-133 ②: 危机窗用满 (postTurns ≥ crisisPracticeTurns) 时的出口 ——
  //   legacy 档硬切; standard / long 档多留 1 轮风险收束, 收束轮之后才结束.
  //   (两条判据都抽到 decideCrisisWindowStop 里 —— 单独一个函数好过复杂度阈值.)
  const crisisStop = decideCrisisWindowStop(input, crisisWindow, thresholds, crisisStartedThisTurn);
  if (crisisStop) {
    return crisisStop;
  }

  const closeAllowed = input.closeRequested && input.turnIndex >= thresholds.minTurnsBeforeClose;
  const crisisCloseBlocked = closeAllowed && crisisWindow.active && crisisWindow.postTurns === 0;
  // AF-138: 常规收束内容门 —— 强制收束窗内模型请求 END，但三件套不齐时挡回继续，
  //   让模型用满最后几轮把 summary / takeaway / nextStep 补出来（不改变审计口径）。
  const routineCloseBlocked = isRoutineClosingBlocked(input, crisisWindow, closeAllowed);
  const closeBlocked = crisisCloseBlocked || routineCloseBlocked;
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
  const stagnationStop = decideStagnationStop(stagnation, thresholds, probe.maxSimilarity);
  if (stagnationStop) {
    return stagnationStop;
  }
  return { kind: 'continue', closeBlocked };
}

/**
 * 危机窗出口判定 (从 decideTurn 里拆出来, 单独一个函数好过复杂度阈值).
 *
 * ⚠️ 顺序很重要 (AF-131 §2.2 指出老实现的顺序问题):
 *   ① **模型的收尾请求优先于计数器** —— 危机窗已过披露轮且咨询师请求 END 时,
 *      走 crisis_practice_close, 不被 crisis_practice_max 覆盖 (packet-12:
 *      第 45 轮本该收尾, 被计数器抢走); 危机窗里同时**动态放开** minTurnsBeforeClose,
 *      因为危机窗本身是有界的短协议, 收束是安全动作, 不能被会话级门槛卡住.
 *   ② **危机窗用满时的出口**:
 *      · 所有档位: 计数到上限的那一轮**继续** (下一轮 = 风险收束轮),
 *        收束轮之后 (postTurns 超过上限) 才结束 —— 收束在结构上必须可达.
 *      · AF-392: legacy 档原先在这里硬切, 导致风险收束轮永远发不出来;
 *        现在与 standard / long 一样保留 1 轮, 避免 crisis_practice_max + incomplete.
 *
 * @param input 本轮事实
 * @param crisisWindow 危机窗状态 (已被就地更新)
 * @param thresholds 本场生效的阈值
 * @param crisisStartedThisTurn 本轮是不是危机披露当轮
 * @returns 终止结论, 或 null (继续)
 */
function decideCrisisWindowStop(
  input: TurnJudgementInput,
  crisisWindow: CrisisWindowState,
  thresholds: SessionThresholds,
  crisisStartedThisTurn: boolean,
): Extract<TurnDecision, { kind: 'stop' }> | null {
  if (shouldStopAfterEscalation(input, crisisWindow, thresholds)) {
    // AF-137: 升级后的风险收束轮已经完成 (五项由 crisisClosing prompt 强制);
    //   AF-138: 但"轮次到了"不等于"内容齐了" —— 计划轮仍缺安全要素时追加 1 个修复轮,
    //   修复轮后仍缺才以 crisis_safety_incomplete 结束 (status 仍是 crisis_ended).
    const safety = evaluateRiskClosingText(input.crisisSafetyText ?? '');
    if (!safety.complete) {
      if (crisisWindow.safetyRepairPending !== true) {
        crisisWindow.safetyRepairPending = true;
        crisisWindow.missingSafetyElements = safety.missing;
        return null;
      }
      return { kind: 'stop', reason: 'crisis_safety_incomplete' };
    }
    return { kind: 'stop', reason: 'crisis_escalated' };
  }
  if (
    thresholds.crisisRiskClosingRound &&
    input.closeRequested &&
    crisisWindow.active &&
    crisisWindow.postTurns >= 1 &&
    !isEscalationSafetyWindow(input, crisisWindow, thresholds)
  ) {
    return { kind: 'stop', reason: 'crisis_practice_close' };
  }
  if (!crisisWindow.active || crisisStartedThisTurn) return null;
  if (crisisWindow.postTurns < thresholds.crisisPracticeTurns) return null;
  if (crisisWindow.postTurns > thresholds.crisisPracticeTurns) {
    return { kind: 'stop', reason: 'crisis_practice_max' };
  }
  // AF-392: legacy 档到达上限时不再一律硬切。
  //   若本轮已在强制收束窗 (forcedClose)，crisisClosing cue 已生效、五组已补齐，可正常结束；
  //   否则先继续，下一轮用 crisisClosing 补齐五组后再结束，避免 crisis_practice_max + incomplete。
  if (!thresholds.crisisRiskClosingRound && input.forcedClose) {
    return { kind: 'stop', reason: 'crisis_practice_max' };
  }
  return null;
}

/**
 * 停滞终止判定 (从 decideTurn 里拆出来, 单独一个函数好过复杂度阈值).
 *
 * @param stagnation 累积的停滞计数
 * @param thresholds 本场生效的阈值
 * @param maxSimilarity 本轮与历史的最大相似度 (写进结论, 供日志排查)
 * @returns 停滞终止结论, 或 null (继续)
 */
function decideStagnationStop(
  stagnation: StagnationState,
  thresholds: SessionThresholds,
  maxSimilarity: number,
): Extract<TurnDecision, { kind: 'stop'; reason: 'stagnant' }> | null {
  const hit =
    stagnation.literalRepeatStreak >= thresholds.stagnantLiteralStreakLimit ||
    stagnation.noProgressStreak >= thresholds.stagnantNoProgressLimit;
  if (!hit) return null;
  return {
    kind: 'stop',
    reason: 'stagnant',
    literalStreak: stagnation.literalRepeatStreak,
    noProgressStreak: stagnation.noProgressStreak,
    maxSimilarity,
  };
}

/** 把终止结论映射成落库用的 status / exit_reason. */
function resolveStopOutcome(decision: Extract<TurnDecision, { kind: 'stop' }>): {
  status: PracticeSessionStatus;
  exitReason: string;
} {
  if (decision.reason === 'stagnant') return { status: 'stagnant', exitReason: 'stagnant' };
  if (decision.reason === 'crisis_escalated' || decision.reason === 'crisis_safety_incomplete') {
    return { status: 'crisis_ended', exitReason: decision.reason };
  }
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
