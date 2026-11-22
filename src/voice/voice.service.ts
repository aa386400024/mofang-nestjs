// V2026-10-09 治本 (Voice Session 业务编排 — SPEC §9.3 / §10.2 + §11.1):
//   职责升级 (Phase 4): 维护 per-session 状态 (VoiceSessionState), 编排 LLM → TTS 流水线,
//     处理打断 (user_speaking). Phase 4 起 LLM 调用通过 VisitorService (persona + history 编排),
//     VoiceService 只负责: 启动 visitor session / 取 TTS 音色 / 转发 LLM chunk 到 TTS + client / 打断.
//
//   V2026-10-23 治本 (v2.0 语音对语音 — 逐句出声, spec §2.3/§2.4/§2.6):
//     ① **双模式**: mode=text 纯文字 (跳过 TTS, 不发任何音频帧); mode=voice 逐句出声.
//     ② **并发事件泵**: TTS 事件流与 LLM 流**同时**消费 —— 旧实现是"先吃完 LLM 流, 再等 TTS",
//        结果音频要等整段文本生成完才下发, "边生成边出声"根本不成立. 治本: 起一个独立的
//        消费协程 pumpTtsEvents, 与 LLM 消费并行, 音频一到就转发.
//     ③ **连接必释放**: 旧实现每轮只 cancel 不 release, 连接池条目只增不减 (spec §3.6).
//        治本: 每一轮结束 (正常 / 异常 / 打断 / 会话结束) 都走 handle.dispose() (幂等, 按租约 id 释放).
//     ④ **打断语义**: 打断回 `cancelled` (通用), 且**不再**下发本轮剩余 llm_text / tts_audio.
//
//   V2026-10-26 治本 (音色代理 / 握手扩展, spec §任务 1 / §任务 3):
//     ① 握手新增 `voiceId` (业务指定音色) / `skillCode` (专项训练技巧码), 经 VoiceSessionMeta
//        透传到本层.
//     ② TTS 音色优先级从"全局统一 env"放开为 "**可选覆盖, 缺省仍是 env**":
//        握手 voiceId > 模板绑定音色 (若有) > env `MINIMAX_TTS_VOICE_ID`.
//        不传 voiceId 时行为与改前**完全一致** (存量客户端零影响).
//
//   V2026-10-29 治本 (WP8-B · 灰度防腐层 — 新引擎接入 voice WS):
//     ① 本层只**持有窄接口** `VoiceTurnBackend` (旧 VisitorService 与新引擎适配同构),
//        按灰度开关 (ENGINE_VOICE_ENABLED + ENGINE_STREAM_GRAYSCALE_SESSIONS) 选实现.
//     ② **消费器零改动**: consumeLlmStream / bargeIn / generation 防旧流 / TTS 句切 /
//        persistTurnIfComplete 全部保持原样 —— 两条链路的帧协议与产出物完全一致.
//     ③ **失败自动回落**: 新引擎开场失败 / 建流失败 / 首个增量前中断 → 本场回旧链路,
//        帧序列与旧链路逐帧一致, 不 500、不关 WS. 已出声之后不再回落 (不可撤回).
//
//   关键设计:
//     - 每 session 一个 VoiceSessionState (Map<sessionId, state>)
//     - 每条 user_text 自增 currentGeneration, 老 pipeline 检查 generation 不匹配
//       自己退出, 避免老请求的 TTS 音频继续流到 client
//     - LLM 取消: AbortController 注入 fetch, signal 透传到 LlmService, abort() 立即断网 + 关 reader
//     - TTS 取消: TtsService.cancel() 协议级 task_cancel (MiniMax 原生)
//
//   错误处理:
//     - visitor.openSession 失败 (无 persona) → startSession throw → gateway 关连接
//     - LLM 流错误 → yield error 消息给 client, 标记 session 'idle' 等下一轮
//     - TTS 流错误 → 同上
//     - 顶层异常 → 捕获 + 标记 session 'error' + yield session_ended
//
//   反双胞胎:
//     - 不在 service 内自己 emit WS — emit 通过 VoiceGateway 注入的 callback
//     - 不用 RxJS Subject — 异步生成器 + Map<sessionId, generator> 简单够用
//     - 不在 service 内自己 build prompt — 那是 VisitorService 的事 (§11.1)
//     - 不再直接 inject LlmService — Phase 4 全走 VisitorService (单职责)
//
//   如何验证 (由大炮在 Windows 环境手动执行):
//     1. tsc 0 错
//     2. 集成测试: mock VisitorService, 跑通"user_text → visitor.streamTurn → tts 句事件 → done"
//     3. 打断测试: user_text → 处理中 → user_speaking → TTS cancel + LLM abort (signal 透传)
//     4. 连接池测试: 一轮结束后池内条目数归零
//     5. persona 切换: ?personaId=l1_zhang vs l3_wang, prompt 行为应不同

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { StudentRiskAuditChoice } from './student-risk-audit-slot.js';
import { TtsService } from './tts/tts.service.js';
import type { TtsEvent, TtsOptions, TtsSessionHandle } from './tts/tts.types.js';
import { VoiceSessionBridgeRegistry, type VoiceSessionCloseResult } from './voice-session-bridge.js';
import { VoiceSessionLimitError } from './voice-session-limit.error.js';
import { VoiceSessionLimitsService } from './voice-session-limits.service.js';
import {
  TURN_INCOMPLETE_CODE,
  VOICE_TURN_BACKEND,
  type VoiceSafetyPreCheckResult,
  type VoiceTurnBackend,
  type VoiceTurnBackendTurnOptions,
} from './voice-turn-backend.port.js';
import type {
  VoiceCatchUpSessionState,
  VoiceCatchUpTurn,
  VoiceClientMessage,
  VoiceServerMessage,
  VoiceSessionEndReason,
  VoiceSessionMeta,
  VoiceSessionPersona,
  VoiceSessionReportStatus,
  VoiceSessionState,
} from './voice.types.js';
import type { LlmStream, LlmStreamChunk } from '../agent/llm/llm.types.js';
import { SupervisorProcessor } from '../agent/supervisor/supervisor.processor.js';
import type { RunReportInput } from '../agent/supervisor/supervisor.types.js';
import { VisitorService } from '../agent/visitor/visitor.service.js';
import type { VisitorPersonaSnapshot } from '../agent/visitor/visitor.types.js';

type SendFn = (msg: VoiceServerMessage) => void;

/**
 * 读一个**正数**配置 (V2026-11-03, WP23).
 *
 * 为什么同时接受字符串与数字: 配置值有两条来路 ——
 *   · 正常路径: `config/envs/default.ts` 已经解析成**数字**;
 *   · 覆写 / 单测: 有人直接塞字符串进来 (`ConfigService.get` 的返回类型是 `any`).
 * 只认数字会让"env 配了但没生效"变成一个查不出来的问题.
 *
 * 非法值 (非数字 / 0 / 负数 / NaN) 一律回退缺省 —— 见 `default.ts` 的同名助手,
 * 两处口径相同 (一处管 env 解析, 一处管配置读取).
 *
 * @param raw 配置原始值
 * @param fallback 缺省值
 * @returns 合法正数; 否则返回缺省值
 */
function readPositiveConfig(raw: unknown, fallback: number): number {
  const parsed = toNumber(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

/**
 * 配置原始值 → 数字 (认字符串与数字, 其余一律 NaN).
 *
 * @param raw 配置原始值
 * @returns 数字; 认不出来 → NaN
 */
function toNumber(raw: unknown): number {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') return Number(raw.trim());
  return Number.NaN;
}

/**
 * 等待业务桥收尾结果的最长时间 (ms).
 *
 * V2026-10-27 (spec 任务 B): `session_ended` 帧要带报告状态, 而报告状态由业务桥
 * 收尾时算出 (要落库) —— 但落库是 I/O, DB 抖动时不能把前端卡在"等结束帧"上.
 * 800ms 足够覆盖一次本地 DB UPDATE + 一次 Redis 入队; 超时就按"结论未知"发帧.
 */
const BRIDGE_CLOSE_TIMEOUT_MS = 800;

/**
 * 超长 idle 兜底的缺省时长 (分钟) — V2026-11-03 (WP23 §1.7).
 *
 * env 缺失 / 非法 → 回退 120 分钟.
 *
 * ⚠️ 这个兜底**不是**"断连宽限期": 它按"最后一次收到客户端消息"算, 与断连无关.
 *   断连不挂任何定时器 (任务单 §1.1 明确禁止 30s grace timer 那种游戏式妥协);
 *   这个计时器只是内存卫生 —— 一场没人理的对练, 不该在内存里挂两小时.
 */
const DEFAULT_IDLE_TIMEOUT_MINUTES = 120;

/**
 * 补漏轮次上限的缺省值 — V2026-11-03 (WP23 §1.7).
 *
 * 漏的轮次超过它就不补 (推 `session_stale`), 让客户端自己从头开始 ——
 * 一次塞两百条历史既塞不进 UI, 也让"补漏"变成"灌数据".
 */
const DEFAULT_CATCHUP_MAX_TURNS = 20;

/**
 * 补漏帧里的"本场状态"缺省值 — V2026-11-03 (WP23).
 *
 * 用在"后端给不出状态"的地方 (旧链路 / 引擎侧没装配): 一场**普通**的会话 ——
 * 没有重点监测、不是 elevated、角色代号未知 (空串 = 客户端按"未知"处理).
 *
 * 刻意**不编**: 客户端会照着这个状态渲染 UI, 编出来的状态比缺省更糟.
 */
const DEFAULT_CATCHUP_SESSION_STATE: Omit<VoiceCatchUpSessionState, 'phase'> = {
  riskLevel: 'normal',
  monitored: false,
  characterCode: '',
};

/**
 * 重连入参 (V2026-11-03, WP23).
 */
export interface VoiceReconnectParams {
  /** 本场会话 meta (含 sessionId / userId / tenantId 等). */
  readonly meta: VoiceSessionMeta;
  /** 客户端上次确认收到的最后一轮 (从 0 起 = 一轮都没收到). */
  readonly lastSeenTurnIndex: number;
  /**
   * 客户端记得的落库 id (进程重启后重建的必需键).
   *
   * 缺省 = 客户端没记住 → 服务端无从查起 → 会话不可续 (推 `session_stale`).
   */
  readonly dbSessionId?: string;
}

/**
 * 重连结果 (V2026-11-03, WP23).
 */
export interface VoiceReconnectOutcome {
  /** true = 会话已就绪 (路径 1 绑回 / 路径 2 重建), 调用方不必再走开场流程. */
  readonly ready: boolean;
  /** 复用的落库 id (路径 1 / 路径 2); fresh 时为 undefined. */
  readonly dbSessionId?: string;
  /** 补漏帧 (session_catchup / session_reattached / session_stale); 没有则 null. */
  readonly frame: VoiceServerMessage | null;
  /**
   * 走的是哪条路径 (日志用).
   *
   * `reattached` = 内存命中, 绑回原会话; `resumed` = 进程重启过, 走 WP12 重建;
   * `stale` = 会话不可续 (调用方走 fresh 开场流程).
   */
  readonly path: 'reattached' | 'resumed' | 'stale';
  /** 漏掉的轮次数 (日志用: "catchup turns=N"). */
  readonly missedTurnCount: number;
}

/**
 * 一轮 LLM 的结束方式.
 *
 * 决定 TTS 怎么收尾:
 * - `done`: 收到 done chunk (已调 finish)
 * - `error`: 收到 error chunk (已调 cancel)
 * - `eof`: 流自然结束但没有 done chunk (需补 finish, 否则尾句卡在上游)
 * - `turn_incomplete`: WP16 —— 本轮回复没发完 (断流); 已调 cancel, **不回落旧链路**
 * - `replayed`: WP16 —— 本轮是幂等重放 (不是新的一轮); 已调 finish, **不重复落逐字稿**
 */
type LlmTurnOutcome = 'done' | 'error' | 'eof' | 'turn_incomplete' | 'replayed';

@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);
  /** TTS 音色 (env MINIMAX_TTS_VOICE_ID). 空 = 未配置, 起会话时 fail-fast, 不用占位音色顶替. */
  private readonly ttsVoiceId: string;
  /** TTS 模型 (env MINIMAX_TTS_MODEL). */
  private readonly ttsModel: string;
  /**
   * V2026-10-29 治本 (WP8-B · 灰度): 新引擎是否接管语音链路 (env ENGINE_VOICE_ENABLED).
   *
   * 缺省 false —— 灰度开关默认关, 旧链路 100% 原样, 可一键回退.
   */
  private readonly engineEnabled: boolean;
  /** 灰度会话白名单 (env ENGINE_STREAM_GRAYSCALE_SESSIONS); 空 = 总开关打开即全量. */
  private readonly grayscaleSessions: ReadonlySet<string>;
  /**
   * 会话 id → 本场实际使用的对话后端 (灰度选择结果; 新引擎失败时回落旧链路).
   *
   * 放在这里而不是 `VoiceSessionState`: 状态文件是**帧协议**侧的东西, 不该知道
   * "引擎还是旧链路"; 而本表是**装配决策**的产物, 归装配层管.
   */
  private readonly backends = new Map<string, VoiceTurnBackend>();
  /** 已开过旧链路会话的 sessionId (新引擎场里回落前需要补开). */
  private readonly legacyOpened = new Set<string>();

  /**
   * 超长 idle 兜底时长 (毫秒) — V2026-11-03 (WP23 §1.7).
   *
   * 语义: "从最后一次收到客户端消息算起, 超过这么久没收到任何上行 → 主动 endSession".
   * 与断连**无关** (断连不挂定时器, 见 §1.1) —— 这是内存卫生兜底.
   */
  private readonly idleTimeoutMs: number;

  /**
   * 补漏轮次上限 — V2026-11-03 (WP23 §1.4).
   *
   * 漏的轮次超过它 → 推 `session_stale` (reason=too_far_behind), 不塞历史.
   */
  private readonly catchUpMaxTurns: number;

  /**
   * 会话 id → 该场的 idle 兜底计时器 (V2026-11-03, WP23 §1.1).
   *
   * 为什么是**每场一个**而不是一个全局扫描器:
   *   · 语义精确: "最后一次收到客户端消息"是**每场**自己的时间线, 全局扫描器要
   *     给每场额外记一个时间戳, 记法一多就容易和真实的消息时间线对不上;
   *   · 收尾即销: 会话结束 (主动 / idle 兜底) 时立刻 clearTimeout, 不留悬挂句柄.
   *
   * 计时器一律 `unref()` —— 它不该让进程活下来 (进程要退出时不该等一场没人的对练).
   */
  private readonly idleTimers = new Map<string, NodeJS.Timeout>();

  private readonly sessions = new Map<string, VoiceSessionState>();

  /**
   * @param visitor 来访者编排 (persona + prompt + 历史) —— 旧链路, 灰度兜底底座
   * @param supervisorProcessor 督导报告 (异步)
   * @param tts TTS 门面
   * @param config 全局配置
   * @param engineBackend 新引擎版对话后端 (WP8-B 灰度; 未装配时为 undefined → 走旧链路)
   * @param limits 会话限流闸门 (WP22; 未装配时为 undefined → **不限流**)
   */
  constructor(
    private readonly visitor: VisitorService,
    private readonly supervisorProcessor: SupervisorProcessor,
    private readonly tts: TtsService,
    private readonly bridges: VoiceSessionBridgeRegistry,
    config: ConfigService,
    @Optional() @Inject(VOICE_TURN_BACKEND) private readonly engineBackend?: VoiceTurnBackend,
    /**
     * WP22: 会话限流闸门 (单用户并发上限 + 当日全局 token 预算).
     *
     * 为什么 @Optional: 与本类其余可选增强同款语义 —— 装配缺席时**会话照常开**,
     * 只是"没有并发上限 / 没有日预算". 不能让"没装闸门"变成"开不了会话".
     *
     * ⚠️ 但这两道闸门是**防烧额度**的, 装配缺席等于护栏失效 ——
     *   所以缺席时打一条 warn (启动日志里能看见), 而不是静默放过.
     */
    @Optional() private readonly limits?: VoiceSessionLimitsService,
  ) {
    this.ttsVoiceId = config.get<string>('minimax.ttsVoiceId') ?? '';
    this.ttsModel = config.get<string>('minimax.ttsModel') ?? 'speech-2.8-turbo';
    this.engineEnabled = readBooleanFlag(config.get<string>('ENGINE_VOICE_ENABLED'));
    this.grayscaleSessions = parseSessionWhitelist(config.get<string>('ENGINE_STREAM_GRAYSCALE_SESSIONS'));
    // V2026-11-03 (WP23): 两个兜底参数 —— env 缺失 / 非法 / 非正数 → 回退缺省值.
    //   非法值必须回退而不是"照用": 0 或负数会让 idle 兜底**立刻**触发 (会话秒死),
    //   NaN 会让比较永远为假 (兜底形同虚设) —— 两种都比"没有这个兜底"更糟.
    this.idleTimeoutMs = readPositiveConfig(config.get('voice.sessionIdleTimeoutMinutes'), DEFAULT_IDLE_TIMEOUT_MINUTES) * 60_000;
    this.catchUpMaxTurns = Math.floor(readPositiveConfig(config.get('voice.catchUpMaxTurns'), DEFAULT_CATCHUP_MAX_TURNS));
    if (!this.limits) {
      this.logger.warn('[voice_limits] 未装配会话限流闸门: 并发上限与当日 token 预算**均不生效** (WP22)');
    }
  }

  /** 处理一条客户端消息. gateway 在 socket.onMessage 时调. */
  async handleMessage(meta: VoiceSessionMeta, msg: VoiceClientMessage, send: SendFn): Promise<void> {
    const state = this.sessions.get(meta.sessionId);
    if (!state) {
      // 防御: 正常路径下 startSession 先于 message
      this.logger.warn(`[handleMessage] session=${meta.sessionId} not found`);
      send({ type: 'session_ended', reason: 'error' });
      return;
    }
    // V2026-11-03 (WP23 §1.1): idle 兜底的计时基准是"最后一次收到客户端消息" ——
    //   任何一条上行都重置它 (哪怕这一轮最后被忽略: 用户确实还在).
    this.refreshIdleTimer(meta.sessionId);

    switch (msg.type) {
      case 'user_text':
        // WP16: 轮次号原样透传给后端 (幂等键的另一半) —— 后端凭它认出"同一轮的重发".
        await this.onUserText(state, msg.text, send, msg.roundId);
        return;
      case 'user_speaking':
        this.onUserSpeaking(state, send);
        return;
      case 'session_finish':
        this.endSession(meta.sessionId, 'user_finish', send);
        return;
      // V2026-10-26 治本 (spec 任务 5 — 暂停 / 恢复):
      //   挂起而非中断 —— 会话不断、逐字稿不清, 只是把"这一轮"停下来.
      case 'session_pause':
        this.pauseSession(state, send);
        return;
      case 'session_resume':
        this.resumeSession(state, send);
        return;
      // V2026-11-02 治本 (WP14 §1.3 — 危机弹窗后的选择回写):
      //   学员在 `crisis_modal` 上点了哪个按钮 → 回写审计表的 `user_choice`.
      //   **只**回写这一个字段: 不重置 monitored、不改会话状态、不打断当前轮.
      case 'crisis_resume':
        await this.onCrisisResume(state, msg.choice);
    }
  }

  /**
   * 学员在危机弹窗后的选择 → 回写审计表.
   *
   * 为什么走"后端窄接口"而不是直接写库: voice 层不认识任何业务实体 (与落库桥同款纪律).
   * 后端没实现这个可选方法 (旧链路) → 直接忽略: 旧链路没有危机弹窗, 没有可回写的对象.
   *
   * @param state 会话状态
   * @param choice 学员的选择
   */
  private async onCrisisResume(state: VoiceSessionState, choice: StudentRiskAuditChoice): Promise<void> {
    const backend = this.backendOf(state);
    if (!backend.markUserChoice) {
      this.logger.debug(`[crisis_resume] 后端不支持回写选择 (session=${state.meta.sessionId})`);
      return;
    }
    try {
      await backend.markUserChoice(state.meta.sessionId, choice);
    } catch (error) {
      // 回写失败**不许**影响对练 —— 它只是一条审计字段.
      this.logger.warn(
        `[crisis_resume] 选择回写失败 session=${state.meta.sessionId} err=${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 这场会话是不是已经属于**别人**? (true = 属于别人 → 调用方必须拒绝)
   *
   * 口径: **只在内存里已经存在这场会话**时才判 —— 不存在就是新会话, 谁开都合法.
   *
   * @param userId 本次连接的用户 id (JWT 的 sub)
   * @param sessionId 本次连接的会话 id
   * @returns true = 该 sessionId 已属于另一个用户
   */
  isSessionOwnedByOtherUser(userId: string, sessionId: string): boolean {
    const existing = this.sessions.get(sessionId);
    return existing !== undefined && existing.meta.userId !== userId;
  }

  /**
   * 会话归属校验 (V2026-11-03 WP25 · 封版审查): 这个 sessionId 是不是**已经属于别人**?
   *
   * 为什么必须有这条:
   *   `sessionId` 由客户端在握手 query 里自选 (`?sessionId=<uuid>`), 服务端此前**从不核对**
   *   它属于谁 —— 于是任何登录用户带着别人的 sessionId 连上来就能:
   *     ① 顶掉那场会话 (TTS dispose + LLM abort) —— 对方的对练当场崩;
   *     ② 走重连分支拿到 `session_catchup` 帧 —— 里面是**对方整场咨询对话原文**.
   *   内存里的会话状态本来就带 `meta.userId`, 核对只是把已有的事实用起来.
   *
   * @param userId 本次连接的用户 id (JWT 的 sub)
   * @param sessionId 本次连接的会话 id
   * @throws {VoiceSessionLimitError} 该 sessionId 已属于另一个用户
   */
  assertSessionOwnership(userId: string, sessionId: string): void {
    if (!this.isSessionOwnedByOtherUser(userId, sessionId)) return;
    this.logger.warn(`[ownership] session=${sessionId} 已属于他人, 拒绝访问 (user=${userId})`);
    throw new VoiceSessionLimitError('session_owned_by_other_user', '该会话标识已被他人占用，请换一个', false);
  }

  /**
   * 启动一个 voice session — resolve persona + 创建 visitor memory + 缓存 state.
   * 异步 (resolve persona 走仓储). gateway 在 verifyAndStart 时 await.
   * @throws 当 visitor.openSession 失败 (无 persona) 时 throw, gateway 关闭 socket
   * @throws {VoiceSessionLimitError} WP22: 被并发上限 / 当日预算闸门拦下 (网关映射成 error 帧)
   * @throws {VoiceSessionLimitError} WP25: 该 sessionId 已属于另一个用户 (顶替 = 跨用户接管)
   */
  async startSession(meta: VoiceSessionMeta): Promise<void> {
    // V2026-11-03 (WP25): 先判归属 —— **别人的会话不许顶替**.
    //   原来这里是"同名就替换" (dispose 旧的 TTS + abort 旧的 LLM), 等于任何登录用户
    //   都能把别人的对练当场打断, 再借重连把人家的逐字稿拉走.
    this.assertSessionOwnership(meta.userId, meta.sessionId);
    if (this.sessions.has(meta.sessionId)) {
      this.logger.warn(`[startSession] session=${meta.sessionId} already exists, replacing`);
      const old = this.sessions.get(meta.sessionId)!;
      old.ttsHandle?.dispose();
      old.llmAbort?.abort();
    }
    // WP22: 两道闸门 (单用户并发上限 + 当日全局 token 预算) ——
    //   拦在**任何**后端会话开起来之前 (新旧链路都拦: 两条链路都烧额度).
    //   闸门不过 → 抛 VoiceSessionLimitError; 网关据此发专属 error 帧,
    //   **不**静默回落旧链路 (回落 = 闸门形同虚设).
    await this.limits?.acquire(meta.userId, meta.sessionId);
    let personaSnapshot: VoiceSessionPersona;
    try {
      personaSnapshot = await this.openBackendSession(meta);
    } catch (error) {
      // 开场失败 → 释放并发占位: 否则用户这场没开成, 却占着一个名额,
      // 下一场自己都开不了 (占位泄漏 = 用户被自己的并发闸门锁死).
      this.limits?.release(meta.userId, meta.sessionId);
      throw error;
    }
    const state: VoiceSessionState = {
      meta,
      persona: personaSnapshot,
      status: 'idle',
      currentGeneration: 0,
      ttsHandle: null,
      llmAbort: null,
      // V2026-10-26 治本 (spec 任务 1 — 结束回写时长 / 轮次):
      //   墙钟起点在**建连成功**这一刻, 不是第一轮发言 —— 前端准备好到开口之间的那段
      //   也是会谈的一部分 (用户在看卡片、在想要不要换人物).
      startedAt: Date.now(),
      turnCount: 0,
      // V2026-11-03 (WP23): socket 在线 (断连时 gateway 会调 detachSocket 改回 false).
      attached: true,
    };
    this.sessions.set(meta.sessionId, state);
    // V2026-11-03 (WP23 §1.1): 超长 idle 兜底计时器 —— 从**开场**这一刻起算.
    this.refreshIdleTimer(meta.sessionId);
    this.logger.log(
      `[startSession] session=${meta.sessionId} tenant=${meta.tenantId} user=${meta.userId} ` +
        `persona=${personaSnapshot.id} mode=${meta.mode} template_preset=${JSON.stringify(meta.preset)}`,
    );
  }

  /** 关闭 voice session. gateway 在 handleDisconnect 时调. */
  endSession(sessionId: string, reason: VoiceSessionEndReason = 'user_finish', send?: SendFn): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    // V2026-11-03 (WP23 §1.1): 销掉 idle 兜底计时器 —— 会话没了, 计时器也没意义
    //   (留着就是一句"到点把一个不存在的会话收一收").
    this.clearIdleTimer(sessionId);
    // 治本 (spec §3.6): 释放 TTS 连接 —— 旧实现只 cancel 不 release, 池里条目只增不减
    state.ttsHandle?.dispose();
    state.ttsHandle = null;
    state.llmAbort?.abort();
    state.llmAbort = null;
    // V2026-10-09 治本 (Phase 5): 拿 transcript 副本 (closeSession 之前 — closeSession 会清 memory)
    const backend = this.backendOf(state);
    const transcript = backend.transcript(sessionId);
    const visitorClose = backend.closeSession(sessionId);
    // V2026-10-29 治本 (WP8-B · 回落后的双份资源):
    //   本场可能同时存在**两个**会话 (引擎句柄 + 回落时补开的旧链路会话).
    //   只关"当前那个"会让另一个永远挂着 —— 引擎句柄会留在归属登记表里 (句柄泄漏),
    //   旧链路会话则留着逐字稿内存. 所以两个都关 (没开过的那方是幂等空操作).
    //
    // WP22: 引擎后端的收尾结果也要拿 ——
    //   回落到旧链路时, "当前后端"是 visitor, 但**引擎那一侧仍持有本场用量**,
    //   而"这场花了多少"以引擎侧为准 (旧链路没有用量累加器).
    //   (引擎链路下这两个是同一个对象 → closeSession 会被调两次, 适配器按句柄
    //    判定只认第一次, 所以不会重复计费 —— 见 engine-stream-backend.adapter.ts.)
    const engineClose = this.engineBackend?.closeSession(sessionId);
    if (backend !== this.visitor) {
      this.visitor.closeSession(sessionId);
    }
    // WP22: 释放并发占位 + 把本场花费累加到当日预算.
    //   释放必须在**所有**收尾动作之后 —— 提前释放会让"还在收尾的这一场"
    //   不再占名额, 用户就能立刻开第二场, 两场的 TTS / 句柄会短暂并存.
    this.limits?.release(state.meta.userId, sessionId);
    const completionTokens = visitorClose.totalCompletionTokens ?? engineClose?.totalCompletionTokens ?? 0;
    if (completionTokens > 0) {
      // fire-and-forget: 记账是 I/O, 不能反过来阻塞 `session_ended` 帧.
      void this.limits?.recordUsage(completionTokens).catch((error: unknown) => {
        this.logger.warn(`[endSession] 用量累计失败 session=${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
    this.backends.delete(sessionId);
    this.legacyOpened.delete(sessionId);
    this.sessions.delete(sessionId);
    const durationMs = Date.now() - state.startedAt;
    this.logger.log(
      `[endSession] session=${sessionId} reason=${reason} ` +
        `visitor_turns=${visitorClose.finalTurnCount} transcript_msgs=${transcript.length} ` +
        `duration_ms=${durationMs} db_session=${state.meta.dbSessionId ?? '<none>'}`,
    );
    // V2026-10-26 治本 (spec 任务 1 — 会话落库收尾):
    //   回写结束状态 / 时长 / 轮次. fire-and-forget: 落库是收尾动作, 不能反过来阻塞
    //   `session_ended` 帧 (前端在等这个帧收页面).
    //
    // V2026-10-27 治本 (spec 任务 B — 收尾回包带报告状态):
    //   业务侧 (counselor 桥) 在收尾时就知道"这场会不会有报告" (空局 → `no_content`),
    //   前端据此**不进轮询页** (直接展示"这场没有足够的对话内容").
    //   为了把这个结论带进 `session_ended` 帧, 这里需要**等**桥收尾完成 —— 但落库是
    //   I/O, DB 抖动时会把前端卡住. 因此加一层**有界等待** (`BRIDGE_CLOSE_TIMEOUT_MS`):
    //   超时按"结论未知"发帧 (前端退回旧行为: 进轮询页), 绝不因落库问题吞掉结束帧.
    const closePromise = this.bridges.close({
      sessionId,
      dbSessionId: state.meta.dbSessionId ?? null,
      userId: state.meta.userId,
      tenantId: state.meta.tenantId,
      reason,
      turnCount: state.turnCount,
      durationMs,
    });
    void this.sendSessionEnded(send, reason, closePromise);
    // V2026-10-09 治本 (Phase 5): 异步督导, session 结束触发 supervisor queue (fire-and-forget)
    //   - 不阻塞 session_ended 消息
    //   - enqueue 失败 → processSync 兜底 (LLM 推理 2-5s, 但 session_ended 已经发出)
    //   - 空 transcript 跳过 (user 没说话就结束, 没督导意义)
    if (transcript.length > 0 && state.persona) {
      const input: RunReportInput = {
        // V2026-10-26 治本 (spec 任务 6 — 报告要挂在**稳定落库 id** 上):
        //   报告查询出口是 GET /counselor/supervision/report/:sessionId, 用落库 id 查;
        //   未落库 (纯内存降级) 时才退回内存 sessionId.
        sessionId: state.meta.dbSessionId ?? sessionId,
        tenantId: state.meta.tenantId,
        userId: state.meta.userId,
        persona: this.resolveReportPersona(state),
        transcript,
        emotionTimeline: [], // V0.x 留空, V1.x 接 ASR 情绪模型
        // V2026-10-26 治本 (spec §任务 1 — skillCode 用于事后专项反馈):
        //   专项训练场把技巧码透传给督导, 报告优先聚焦对应维度; 全流程 / 个案为 undefined.
        skillCode: state.meta.skillCode,
        traceId: state.meta.traceId,
      };
      void this.triggerSupervisor(input);
    } else {
      this.logger.log(
        `[endSession] skip supervisor: empty_transcript=${transcript.length === 0} persona=${state.persona ? 'set' : 'null'}`,
      );
    }
  }

  /**
   * 发 `session_ended` 帧 (带报告状态).
   *
   * V2026-10-27 (spec 任务 B): 桥收尾有界等待 —— 超时按"结论未知"发帧,
   * 落库再慢也不会把前端卡在"等待结束帧"上.
   *
   * @param send 帧发送函数
   * @param reason 结束原因
   * @param closePromise 桥收尾 promise
   */
  private async sendSessionEnded(
    send: SendFn | undefined,
    reason: VoiceSessionEndReason,
    closePromise: Promise<VoiceSessionCloseResult | null>,
  ): Promise<void> {
    const reportStatus = await this.awaitCloseResult(closePromise);
    send?.({
      type: 'session_ended',
      reason,
      ...(reportStatus ? { reportStatus } : {}),
    });
  }

  /**
   * 有界等待桥收尾结果.
   *
   * 超时 / 失败 → null (前端按"结论未知"处理: 进轮询页, 旧行为).
   *
   * @param closePromise 桥收尾 promise
   * @returns 报告状态 (null = 未知)
   */
  private async awaitCloseResult(closePromise: Promise<VoiceSessionCloseResult | null>): Promise<VoiceSessionReportStatus | null> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), BRIDGE_CLOSE_TIMEOUT_MS);
    });
    try {
      const result = await Promise.race([closePromise, timeout]);
      return result?.reportStatus ?? null;
    } catch (err) {
      this.logger.warn(`[await_close_result_failed] err=${err instanceof Error ? err.message : String(err)}`);
      return null;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  /**
   * 解析主报告用的来访者人格快照.
   *
   * vpt 场的 AI 扮演的是**公共人物** (晚晴 / 小林...), 剧本由 counselor 侧的上下文贡献者
   * 注入 (replacesPersona=true); 而 `state.persona` 是 agent 的**内置 persona** (另一个虚构
   * 人物). 直接用它写报告, 报告里会出现"来访者：小林"—— 而用户屏幕上写的是"晚晴",
   * 学员看报告根本认不出自己在跟谁做督导, 亮点与建议也跟着对不上号.
   *
   * 所以: 有速查卡 → 用速查卡构造快照; 无 (普通 voice session) → 沿用内置 persona.
   *
   * @param state 会话状态
   * @returns 人格快照
   */
  private resolveReportPersona(state: VoiceSessionState): VisitorPersonaSnapshot {
    const visitor = state.meta.visitor;
    if (!visitor) {
      return state.persona ?? { id: 'unknown', name: '来访者', voiceId: '', difficulty: 'L1' };
    }
    return {
      id: visitor.templateId || 'vpt_visitor',
      name: visitor.codename,
      voiceId: state.meta.voiceId ?? '',
      difficulty: state.meta.preset.difficulty,
    };
  }

  /**
   * V2026-10-09 治本 (Phase 5): 触发 supervisor 督导报告 (fire-and-forget).
   * enqueue 失败 → processSync 同步兜底. 不抛异常, 不阻塞 voice 主流程.
   * 注: triggerSupervisor 单独拆出避免 endSession cognitive-complexity 涨 (sonarjs 25 阈值).
   */
  private async triggerSupervisor(input: RunReportInput): Promise<void> {
    const enqueued = await this.supervisorProcessor.enqueue(input);
    if (!enqueued) {
      this.logger.warn(`[triggerSupervisor] enqueue failed, fallback to processSync session=${input.sessionId}`);
      await this.supervisorProcessor.processSync(input);
    }
  }

  /** 进程退出时全量清理. */
  async onApplicationShutdown(): Promise<void> {
    for (const [sessionId] of this.sessions) {
      this.endSession(sessionId, 'error');
    }
  }

  // ── WP23 · 断线重连追平 ────────────────────────────────────────
  //
  //   设计要点 (任务单 §1.1 / §1.3):
  //     · 断线**不杀会话** —— 会话留在内存里, in-flight 的轮次让它自然跑完;
  //     · 重连有**两条路径**: 内存命中 (绑回) / 进程重启过 (WP12 重建);
  //     · 补漏数据只给**最终文本**, 不回放流式 chunk / TTS 音频;
  //     · 会话重建与补漏组装都在这一层 (gateway 只做 transport, 任务单 §2 红线).
  //
  //   为什么"绑回"要重新登记帧出口: 帧出口按**落库 id** 登记, 断连时注销了 ——
  //     不重登记, 督导侧的实时提示 / 移情标记就再也推不进这场会话.

  /**
   * 这场会话在本进程里还活着吗 (重连路径 1 的判据).
   *
   * @param sessionId 会话 id
   * @returns true = 内存命中 (可以绑回)
   */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * 已存在会话的 meta (含落库 id) —— 重连时**复用**落库 id, 不新建行.
   *
   * 为什么必须复用: 落库 id 是督导报告 / 4 流派反馈 / 实时帧出口的**唯一挂载点**;
   * 重连一次就新建一行 = 同一场会谈在库里裂成两场, 报告挂到空的那场.
   *
   * @param sessionId 会话 id
   * @returns 会话 meta; undefined = 内存里没有这场会话
   */
  findSession(sessionId: string): VoiceSessionMeta | undefined {
    return this.sessions.get(sessionId)?.meta;
  }

  /**
   * socket 断开 (WP23 §1.1): 会话**继续活**, 只把"帧出口还在不在"记成 false.
   *
   * 做什么 / 不做什么:
   *   · 不 endSession (任务单 §1.1 明确禁止);
   *   · 不删内存会话;
   *   · **不挂任何判死定时器** (那是游戏式妥协, 本单明确放弃);
   *   · 停掉在跑的 TTS 合成 —— 没人听的音频就是白烧钱 (§1.5).
   *
   * @param sessionId 会话 id
   */
  detachSocket(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    state.attached = false;
    // 断连后不再合成音频: 协议级 cancel 让上游停止合成 (钱停在这里).
    //   本轮的收尾 (closeTtsTurn) 仍会 dispose 这条连接 —— 池里的条目不漏.
    state.ttsHandle?.cancel();
    state.ttsHandle = null;
    this.logger.log(`[onDisconnect] session=${sessionId} socket dropped, session kept in memory`);
  }

  /**
   * socket 重新连上 (WP23 §1.3 路径 1): 绑回已存在的会话.
   *
   * @param sessionId 会话 id
   * @returns true = 绑回成功; false = 内存里没有这场会话 (该走路径 2)
   */
  attachSocket(sessionId: string): boolean {
    const state = this.sessions.get(sessionId);
    if (!state) return false;
    state.attached = true;
    // 重连算一次"有动静": idle 兜底从这一刻重新起算.
    this.refreshIdleTimer(sessionId);
    return true;
  }

  /**
   * 重连处理 (WP23 §1.3): 两条路径的统一入口.
   *
   * 路径 1 (内存命中): 绑回原会话 → 从**引擎侧补漏台账**取漏掉的轮次.
   *   不重新 openSession / 不重新初始化角色基线 / 不重跑 BDI —— 会话对象还活着,
   *   BDI 状态就在内存里.
   *
   * 路径 2 (进程重启过): 走 WP12 `resumeFromSessionId` 重建 → 从**持久化**取漏掉的轮次.
   *   重建不了 (落库会话不存在 / 不属于该学员) → `session_stale`, 客户端走 fresh 开场.
   *
   * @param params 重连入参
   * @returns 重连结果 (就绪与否 + 补漏帧)
   */
  async reconnectSession(params: VoiceReconnectParams): Promise<VoiceReconnectOutcome> {
    const state = this.sessions.get(params.meta.sessionId);
    if (state) {
      // V2026-11-03 (WP25): 归属不符 → **不给补漏**.
      //   补漏帧 (`session_catchup`) 里装的是那场会话的逐字稿原文 (userText / replyText),
      //   拿别人的 sessionId 来重连 = 直接把人家的咨询记录读走.
      //   回法统一按"接不上" (`session_stale`): 不告诉他这场会话存在, 免得变成存在性探测.
      if (state.meta.userId !== params.meta.userId) {
        this.logger.warn(`[reconnect] session=${params.meta.sessionId} 属于他人, 拒绝补漏`);
        return {
          ready: false,
          frame: { type: 'session_stale', reason: 'unknown_session' },
          path: 'stale',
          missedTurnCount: 0,
        };
      }
      return this.reattachExisting(state, params);
    }
    return this.resumeAfterRestart(params);
  }

  // ── private ────────────────────────────────────────────────────

  /**
   * 重连 · 路径 1: 内存命中 —— 绑回原会话 + 从引擎侧补漏台账取漏掉的轮次.
   *
   * 为什么补漏数据问**后端**而不是 voice 层自己攒:
   *   一轮到底算不算"已提交", 只有后端知道 (BDI 有没有落、回复有没有发完);
   *   voice 层只看到"流结束了" —— 分不清"说完了"与"说到一半被 barge-in 掐了".
   *
   * @param state 已存在的会话状态
   * @param params 重连入参
   * @returns 重连结果
   */
  private reattachExisting(state: VoiceSessionState, params: VoiceReconnectParams): VoiceReconnectOutcome {
    state.attached = true;
    this.refreshIdleTimer(state.meta.sessionId);
    const backend = this.backendOf(state);
    const result = backend.catchUp?.(state.meta.sessionId, params.lastSeenTurnIndex);
    const missedTurns = result?.missedTurns ?? [];
    const serverLatestTurnIndex = result?.serverLatestTurnIndex ?? state.turnCount;
    const frame = this.buildCatchUpFrame(
      missedTurns,
      serverLatestTurnIndex,
      result?.sessionState ?? DEFAULT_CATCHUP_SESSION_STATE,
      this.phaseOf(state),
    );
    return {
      ready: true,
      dbSessionId: state.meta.dbSessionId,
      frame,
      path: 'reattached',
      missedTurnCount: missedTurns.length,
    };
  }

  /**
   * 重连 · 路径 2: 进程重启过 —— 走 WP12 `resumeFromSessionId` 重建 + 从持久化补漏.
   *
   * 重建的**边界** (必须诚实):
   *   · 内核的 BDI 状态仓储目前是**内存态** (`InMemoryBdiStateRepository`), 进程重启后
   *     取不到上一场的快照 —— 所以 WP12 的 resume 在这条路径上**恢复不了 BDI 快照**,
   *     只能恢复"长时记忆召回 + 角色基线"这一层 (记忆仓储是持久的, 跨进程有效);
   *   · 逐轮的 BDI 快照改由 **WP19-R 留痕**还原 (trace 逐轮落库), 但留痕受
   *     `ENGINE_DEBUG_TRACE_ENABLED` 开关约束 (prod 缺省关) —— 关着就没有快照可还原.
   *   两件事都写进交付记录, 不在这里假装"重建成功 = BDI 全回来了".
   *
   * @param params 重连入参
   * @returns 重连结果
   */
  private async resumeAfterRestart(params: VoiceReconnectParams): Promise<VoiceReconnectOutcome> {
    const sessionId = params.meta.sessionId;
    const dbSessionId = params.dbSessionId?.trim() ?? '';
    if (!dbSessionId) {
      // 客户端没记住落库 id → 无从查起 (库里没有"内存 sessionId"这一列) → 不可续.
      this.logger.warn(`[reconnect] session=${sessionId} 无落库 id, 无法重建, sending session_stale`);
      return {
        ready: false,
        frame: { type: 'session_stale', reason: 'unknown_session' },
        path: 'stale',
        missedTurnCount: 0,
      };
    }
    const persistent = await this.bridges.readCommittedTurns({
      dbSessionId,
      userId: params.meta.userId,
      tenantId: params.meta.tenantId,
    });
    if (!persistent) {
      this.logger.warn(`[reconnect] session=${sessionId} 落库会话不存在或不属于该学员, sending session_stale`);
      return {
        ready: false,
        frame: { type: 'session_stale', reason: 'unknown_session' },
        path: 'stale',
        missedTurnCount: 0,
      };
    }
    // WP12 接续: 用**这场会话原来的 sessionId** 作为 resume 来源 ——
    //   引擎侧查得到就搬快照, 查不到就 warn + 按新会话开 (不抛错、不断连).
    const meta: VoiceSessionMeta = {
      ...params.meta,
      dbSessionId,
      resumeFromSessionId: params.meta.resumeFromSessionId ?? sessionId,
    };
    await this.startSession(meta);
    const state = this.sessions.get(sessionId);
    // 角色代号 / 监测态由**引擎侧**给 (它知道本场注入的是哪个角色、监测有没有置位);
    //   逐轮内容由**持久化**给 (引擎台账在重启后已经空了).
    const engineState = state ? this.backendOf(state).catchUp?.(sessionId, params.lastSeenTurnIndex)?.sessionState : undefined;
    const missedTurns = persistent.turns.filter((turn) => turn.turnIndex > params.lastSeenTurnIndex);
    const serverLatestTurnIndex = persistent.turns.reduce((max, turn) => Math.max(max, turn.turnIndex), 0);
    const frame = this.buildCatchUpFrame(
      missedTurns,
      serverLatestTurnIndex,
      engineState ?? DEFAULT_CATCHUP_SESSION_STATE,
      state ? this.phaseOf(state) : 'listening',
    );
    return {
      ready: true,
      dbSessionId,
      frame,
      path: 'resumed',
      missedTurnCount: missedTurns.length,
    };
  }

  /**
   * 组装补漏帧 (WP23 §1.4).
   *
   * 三种结局 (互斥, 按这个顺序判):
   *   ① 漏得太多 (> `VOICE_CATCHUP_MAX_TURNS`) → `session_stale` (too_far_behind):
   *      不塞历史, 让客户端自己决定从头开始;
   *   ② 一条没漏 → `session_reattached` (轻帧, 不带任何逐轮内容);
   *   ③ 有漏的 → `session_catchup` (一次性把漏的轮次全给).
   *
   * ⚠️ **只补最终文本**: 不带流式 chunk、不带音频帧 (任务单 §2 红线) ——
   *   TTS 已播出不可撤回, 重新合成是客户端自己的事 (服务端不再烧一次 TTS 配额).
   *
   * @param missedTurns 漏掉的轮次
   * @param serverLatestTurnIndex 服务端已提交的最大轮次号
   * @param sessionState 本场状态 (缺相位)
   * @param phase 本场相位
   * @returns 补漏帧
   */
  private buildCatchUpFrame(
    missedTurns: readonly VoiceCatchUpTurn[],
    serverLatestTurnIndex: number,
    sessionState: Omit<VoiceCatchUpSessionState, 'phase'>,
    phase: VoiceCatchUpSessionState['phase'],
  ): VoiceServerMessage {
    if (missedTurns.length > this.catchUpMaxTurns) {
      // 日志由 gateway 打 (它是连接层, 任务单 §1.8 把这几条日志归在 `[onConnect]` 下) ——
      //   这里只负责**决定**不补 (漏太多塞进一帧既塞不进 UI, 也让补漏变成灌数据).
      return { type: 'session_stale', reason: 'too_far_behind', serverLatestTurnIndex };
    }
    if (missedTurns.length === 0) {
      return { type: 'session_reattached', serverLatestTurnIndex };
    }
    return {
      type: 'session_catchup',
      serverLatestTurnIndex,
      missedTurns,
      currentSessionState: { ...sessionState, phase },
    };
  }

  /**
   * 本场相位 (补漏帧用).
   *
   * @param state 会话状态
   * @returns 相位
   */
  private phaseOf(state: VoiceSessionState): VoiceCatchUpSessionState['phase'] {
    if (state.status === 'paused') return 'paused';
    // processing = 这一轮还在跑 (来访者正在说 / 正在生成).
    if (state.status === 'processing') return 'speaking';
    return 'listening';
  }

  /**
   * 重置 idle 兜底计时器 (WP23 §1.1).
   *
   * 计时基准: "最后一次收到客户端消息" —— 任何一条上行都重置它.
   * 断连**不**重置也不新建: 断连不是"有动静", 挂着就好 (等它自己超时兜底).
   *
   * @param sessionId 会话 id
   */
  private refreshIdleTimer(sessionId: string): void {
    this.clearIdleTimer(sessionId);
    const timer = setTimeout(() => {
      this.handleIdleTimeout(sessionId);
    }, this.idleTimeoutMs);
    // unref: 这个计时器不该让进程活下来 (进程要退出时不该等一场没人的对练).
    if (typeof timer.unref === 'function') timer.unref();
    this.idleTimers.set(sessionId, timer);
  }

  /**
   * 销掉 idle 兜底计时器.
   *
   * @param sessionId 会话 id
   */
  private clearIdleTimer(sessionId: string): void {
    const timer = this.idleTimers.get(sessionId);
    if (!timer) return;
    clearTimeout(timer);
    this.idleTimers.delete(sessionId);
  }

  /**
   * 超长 idle 兜底 (WP23 §1.1): 服务端主动 endSession.
   *
   * 语义: **内存卫生**, 不是用户感知的 cliff ——
   *   用户主动结束走 `session_finish` (另一条路径), 断线也不走这里.
   *
   * @param sessionId 会话 id
   */
  private handleIdleTimeout(sessionId: string): void {
    this.idleTimers.delete(sessionId);
    if (!this.sessions.has(sessionId)) return;
    this.logger.warn(`[idleTimeout] session=${sessionId} idle >${Math.round(this.idleTimeoutMs / 60_000)}min, ending as idle_timeout`);
    this.endSession(sessionId, 'idle_timeout');
  }

  /**
   * 处理 user_text — 编排 LLM → TTS 流水线.
   *
   * 两条模式:
   * - `text`: 只跑 LLM, 逐块转发 `llm_text`, 收尾 `llm_done`
   * - `voice`: LLM 与 TTS **并行**: LLM chunk 一边转发给前端一边喂给 TTS;
   *   TTS 事件泵独立消费, 句级 mp3 一到就转发 (`tts_audio`)
   *
   * @param state 会话状态
   * @param text 用户输入 (已由前端 ASR 定稿)
   * @param send 帧发送回调
   * @param roundId 轮次号 (WP16; 缺省 = 不走幂等)
   */
  private async onUserText(state: VoiceSessionState, text: string, send: SendFn, roundId?: number): Promise<void> {
    if (this.shouldIgnoreTurn(state, text)) {
      return;
    }
    // 打断上一轮 (如果还在跑)
    if (state.status === 'processing') {
      this.logger.log(`[user_text] barge-in previous pipeline (gen=${state.currentGeneration})`);
      this.bargeIn(state, send);
    }
    state.currentGeneration += 1;
    const myGeneration = state.currentGeneration;
    state.status = 'processing';

    // V2026-11-03 治本 (WP23): 本轮轮次号 —— **算一次, 全程带着走**.
    //   为什么不在用的时候现算 `state.turnCount + 1`: barge-in 时两轮会短暂并存
    //   (新一轮已经开始, 上一轮还没收尾), 现算会让两轮拿到**同一个号** ——
    //   补漏台账里就会出现两条同号的轮次, 客户端按号对不上.
    //   `turnCount` 只在整轮跑完时递增, 所以"本场第几轮"在开跑那一刻就已经定了.
    const turnIndex = state.turnCount + 1;

    // 0. 前置 safety gate (V2026-11-02, WP14 优化项): block 级危机**不发 llm_start**.
    //    必须排在 TTS 之前 —— TTS 一起来, 本轮就会走完收尾并发出 tts 帧,
    //    "先转 loading 圈再弹 modal" 的瑕疵就还在.
    if (await this.runPreCheckSafety(state, text, turnIndex, myGeneration, send)) {
      return;
    }

    // 1. 启动 TTS (仅 voice 模式; text 模式完全不碰 TTS —— 不建连接、不占配额)
    const tts = await this.beginTtsTurn(state, send, myGeneration);
    if (!tts) {
      state.status = 'idle';
      return;
    }
    const { ttsHandle, ttsPump } = tts;

    // 2. 跑 LLM 流 (通过 Visitor — persona + history 编排, signal 透传)
    //    本轮来访者说的话要收集起来, 落库后才有逐字稿可读 (每轮分析 / 技术统计 / 标记
    //    / 复盘报告全部以它为输入).
    const visitorChunks: string[] = [];
    const { outcome, llmAbort } = await this.runLlmTurn(state, text, turnIndex, myGeneration, send, ttsHandle, visitorChunks, roundId);

    // 3. 收尾 TTS (正常 done 已 finish; eof 补 finish; 异常已 cancel)
    await this.closeTtsTurn(state, ttsHandle, ttsPump, outcome, myGeneration);

    this.finishTurn(state, myGeneration, ttsHandle, llmAbort);

    // 4. 逐字稿落库 + 触发该轮分析 (V2026-10-26, spec 任务 1 / 任务 2 / 任务 3 / 任务 4)
    this.persistTurnIfComplete(state, text, visitorChunks, outcome, myGeneration);

    this.logger.log(`[user_text] done gen=${myGeneration} outcome=${outcome} persona=${state.persona?.id ?? 'unknown'}`);
  }

  /**
   * 前置 safety gate (V2026-11-02, WP14 优化项 · block 不发 llm_start).
   *
   * 为什么要在**发 llm_start 之前**判:
   *   内核的 safety 判定发生在 `session.turn()` **内部** —— 等它判完, voice 层
   *   已经把 `llm_start` 发出去 (前端 loading 圈转起来了), 而 block 之后前端
   *   既收不到 `llm_done` (后端根本没渲染), 又被全屏 modal 抢屏 ——
   *   体感是"开始了但永远不会结束". 前置判一次 = modal 干干净净弹出来, 不先转圈.
   *
   * 只拦 **block**: warn 仍由内核侧按原时序发 `crisis_toast` (不打断正常流式回复);
   * pass 一律放行. 前置 gate 只认 block —— 那是"AI 这一轮不该出声"的唯一档位.
   *
   * 失败语义: **静默降级** —— 判定抛错就按放行处理, 走既有流程;
   * 内核侧那一层判定仍然会再判一次 (双层防御), 不能因为前置 gate 挂了就把对练搞挂.
   *
   * 旧链路 (`VisitorService`) 没有 `preCheckSafety` → 直接放行, 行为逐字不变.
   *
   * @param state 会话状态
   * @param text 用户输入
   * @param turnIndex 本场轮次 (从 1 起; 由调用方算一次带下来, 与逐字稿锚点同源)
   * @param myGeneration 本轮代号
   * @param send 帧发送回调
   * @returns true = 本轮被阻断 (调用方直接收尾: 不起 TTS / 不跑 LLM / 不发 llm 帧)
   */
  private async runPreCheckSafety(
    state: VoiceSessionState,
    text: string,
    turnIndex: number,
    myGeneration: number,
    send: SendFn,
  ): Promise<boolean> {
    const backend = this.backendOf(state);
    if (!backend.preCheckSafety) return false;

    let result: VoiceSafetyPreCheckResult;
    try {
      result = await backend.preCheckSafety({
        sessionId: state.meta.sessionId,
        userText: text,
        // 本场轮次 (从 1 起) —— 与逐字稿锚点同源 (报告按 `(turnIndex-1)*2` 定位那条"问").
        turnIndex,
        publishFrame: send,
      });
    } catch (err) {
      this.logger.warn(
        `[user_text] 前置 safety 判定异常, 按放行处理 session=${state.meta.sessionId}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
    if (result.level !== 'block') return false;

    // 阻断轮: 只弹窗 + 留痕 —— 不发 llm_start / llm_done / tts_done, 不调内核 turn.
    //   逐字稿仍然记这一轮 ("问" 有、"答" 空): 轮次编号必须与审计表的 turnIndex 对齐,
    //   否则报告里的危机标注会锚到别的轮次上.
    this.finishTurn(state, myGeneration, null, null);
    this.persistTurnIfComplete(state, text, [], 'done', myGeneration);
    this.logger.warn(
      `[user_text] 前置 safety 判定 block, 本轮阻断 (无 llm_start) session=${state.meta.sessionId} ` + `category=${result.category ?? '-'}`,
    );
    return true;
  }

  /**
   * 本轮该不该**忽略** (空输入 / 会话已暂停).
   *
   * 单独拆出来是为了让 `onUserText` 的复杂度回到阈值内 (ESLint complexity 上限 20) ——
   * 拆分的边界按**职责**切 (守卫 / 起 TTS / 跑 LLM / 收 TTS / 落库), 不是按"凑行数"切.
   *
   * @param state 会话状态
   * @param text 用户输入
   * @returns true = 忽略本轮
   */
  private shouldIgnoreTurn(state: VoiceSessionState, text: string): boolean {
    if (text.trim().length === 0) {
      this.logger.debug(`[user_text] empty, ignore`);
      return true;
    }
    // V2026-10-26 治本 (spec 任务 5 — 暂停期间不跑 LLM):
    //   暂停时收到业务帧**直接忽略**, 不并发跑 LLM —— 并发跑会出现两条 LLM 流
    //   抢同一个 TTS 连接, 音频会串.
    if (state.status === 'paused') {
      this.logger.debug(`[user_text] session paused, ignore`);
      return true;
    }
    return false;
  }

  /**
   * 起 TTS 连接 + 事件泵 (仅 voice 模式).
   *
   * @param state 会话状态
   * @param send 帧发送回调
   * @param myGeneration 本轮代号
   * @returns TTS 句柄 + 事件泵; null = TTS 起不来 (本轮不出声, 调用方直接收尾)
   */
  private async beginTtsTurn(
    state: VoiceSessionState,
    send: SendFn,
    myGeneration: number,
  ): Promise<{ ttsHandle: TtsSessionHandle | null; ttsPump: Promise<void> | null } | null> {
    // V2026-11-03 治本 (WP23 §1.5): 断连中 → **压根不调 TTS provider**.
    //   没人听的音频就是白烧 MiniMax 的 TTS 配额. 但这一轮**照跑** LLM ——
    //   跑完的文本进补漏台账, 客户端重连时由 `session_catchup` 补回来.
    //   ⚠️ 这里返回的是"没有 TTS 句柄"而不是 null: null 的语义是
    //     "TTS 起不来 → 本轮不出声 → 直接收尾", 那会把这一轮整个丢掉.
    if (!state.attached) {
      this.logger.log(`[user_text] socket 已断开, 本轮跳过 TTS 合成 session=${state.meta.sessionId}`);
      return { ttsHandle: null, ttsPump: null };
    }
    const ttsHandle = state.meta.mode === 'voice' ? await this.startTtsSession(state, send) : null;
    if (state.meta.mode === 'voice' && !ttsHandle) {
      // TTS 起不来 (音色没配 / 上游握手失败) → 本轮不出声, 直接收尾.
      return null;
    }
    if (ttsHandle) {
      state.ttsHandle = ttsHandle;
    }
    // 事件泵与 LLM 流**并发** —— "边生成边出声"的关键
    const ttsPump = ttsHandle ? this.pumpTtsEvents(ttsHandle, myGeneration, state, send) : null;
    return { ttsHandle, ttsPump };
  }

  /**
   * 跑一轮 LLM 流 (访客生成).
   *
   * @param state 会话状态
   * @param text 用户输入
   * @param turnIndex 本场轮次 (从 1 起; 传给后端做补漏台账的键)
   * @param myGeneration 本轮代号
   * @param send 帧发送回调
   * @param ttsHandle 本轮 TTS 句柄 (LLM chunk 要喂给它)
   * @param visitorChunks 本轮来访者文本累加器 (供逐字稿落库)
   * @param roundId 轮次号 (WP16; 原样透传给后端做幂等键)
   * @returns 本轮结束方式 + 本轮的 AbortController (供 finishTurn 清理)
   */
  private async runLlmTurn(
    state: VoiceSessionState,
    text: string,
    turnIndex: number,
    myGeneration: number,
    send: SendFn,
    ttsHandle: TtsSessionHandle | null,
    visitorChunks: string[],
    roundId?: number,
  ): Promise<{ outcome: LlmTurnOutcome; llmAbort: AbortController }> {
    const llmAbort = new AbortController();
    state.llmAbort = llmAbort;
    try {
      const llmStream = await this.resolveTurnStream(state, text, turnIndex, llmAbort.signal, send, roundId);
      send({ type: 'llm_start' });
      const outcome = await this.consumeLlmStream(llmStream, turnIndex, myGeneration, state, send, ttsHandle, visitorChunks);
      if (outcome === 'error') {
        // 新引擎这一轮中断 → 本场后续轮次回旧链路 (WS 不中断, 帧语义与旧链路一致).
        await this.fallbackToLegacy(state, '新引擎流中断');
      }
      return { outcome, llmAbort };
    } catch (err) {
      this.logger.error(`[user_text] LLM stream error: ${err instanceof Error ? err.message : String(err)}`);
      send({
        type: 'error',
        error: { code: 'llm_stream_error', message: 'LLM 流错误', retryable: true },
      });
      ttsHandle?.cancel();
      // 标成 error: 避免收尾分支再发一次 task_finish (cancel 之后不该再收尾)
      return { outcome: 'error', llmAbort };
    }
  }

  /**
   * 解析本轮要用的 LLM 流 (灰度选择 + 失败自动回落).
   *
   * 三条路径, 帧语义完全一致:
   *   - 旧链路 → 直接用 visitor 的流;
   *   - 新引擎 → 用引擎的流, 但套一层"首个增量前失败就透明切回旧链路"的守卫;
   *   - 新引擎建流就失败 → 当场切回旧链路.
   *
   * 为什么"首个增量前"才能透明回落: 一旦有 `llm_text` 发出, 用户已经看到了新引擎
   * 的内容, 这时再换成旧链路等于"来访者说了半句突然改口" —— 与流式不切备同一条
   * 纪律: 已出声不可撤回.
   */
  private async resolveTurnStream(
    state: VoiceSessionState,
    text: string,
    turnIndex: number,
    signal: AbortSignal,
    send: SendFn,
    roundId?: number,
  ): Promise<LlmStream> {
    const options = this.buildTurnOptions(state, text, turnIndex, signal, send, roundId);
    const backend = this.backendOf(state);
    if (backend !== this.engineBackend) {
      const { stream } = await this.visitor.streamTurn(options);
      return stream;
    }
    try {
      const { stream } = await backend.streamTurn(options);
      return this.guardEngineStream(stream, state, options);
    } catch (err) {
      this.logger.error(`[user_text] 新引擎建流失败, 本场回落旧链路: ${err instanceof Error ? err.message : String(err)}`);
      const switched = await this.fallbackToLegacy(state, '新引擎建流失败');
      if (!switched) throw err;
      const { stream } = await this.visitor.streamTurn(options);
      return stream;
    }
  }

  /**
   * 新引擎流的前置失败守卫: 首个增量之前出错 → 透明切回旧链路.
   *
   * 消费器 (`consumeLlmStream`) **零改动** —— 守卫在流的层面完成切换, 于是
   * 消费器看到的仍是一条"普通的三态流", 帧序列与旧链路逐帧一致.
   */
  private async *guardEngineStream(
    primary: LlmStream,
    state: VoiceSessionState,
    // 同 buildTurnOptions: 这份 options 一定带 userId (旧链路回落时要转交给它).
    options: VoiceTurnBackendTurnOptions & { readonly userId: string },
  ): AsyncIterable<LlmStreamChunk> {
    let contentSeen = false;
    try {
      for await (const chunk of primary) {
        if (chunk.type === 'content') {
          contentSeen = true;
          yield chunk;
          continue;
        }
        if (chunk.type === 'error' && !contentSeen) {
          // WP16: 「本轮不完整」不是引擎故障 —— 放过它, 让前端换轮次号重发.
          //   回落旧链路在这里是**错的**: 旧链路没有轮次语义, 同一句话会在
          //   两条链路上各跑一遍 (引擎侧状态被提交, 旧链路侧又跑一次).
          if (chunk.error.code === TURN_INCOMPLETE_CODE) {
            yield chunk;
            return;
          }
          const switched = await this.fallbackToLegacy(state, '新引擎首个增量前失败');
          if (!switched) {
            yield chunk;
            return;
          }
          const { stream } = await this.visitor.streamTurn(options);
          yield* stream;
          return;
        }
        yield chunk;
      }
    } catch (err) {
      if (!contentSeen) {
        const switched = await this.fallbackToLegacy(state, '新引擎首个增量前异常');
        if (switched) {
          const { stream } = await this.visitor.streamTurn(options);
          yield* stream;
          return;
        }
      }
      throw err;
    }
  }

  /**
   * 一轮对话的入参 (新旧链路同构).
   *
   * `publishFrame` (WP14): 把"推一帧给**本场**客户端"的能力交给后端 ——
   *   危机弹窗必须能推出去, 而它不能依赖帧出口注册表 (那里按落库 id 索引,
   *   本场没落库时就没有那个 id). 传回调比传 id 安全: 后端不需要知道任何 id 口径.
   *
   * `roundId` (WP16): 轮次号原样透传 —— 后端凭它做幂等判定 (同一轮重发不重跑 BDI).
   * 缺省 = 客户端没给号 → 后端不走幂等, 行为与 WP16 之前逐字一致.
   *
   * `turnIndex` (WP23): 本场第几轮 —— **voice 层是轮次号的唯一真相**.
   *   它同时流向三处, 三处必须同源:
   *     · 后端补漏台账的键 (断线重连时按它捞"我漏了哪几轮");
   *     · `llm_done` 帧里的 `turnIndex` (客户端靠它知道自己听到第几轮);
   *     · 客户端重连时上报的 `lastSeenTurnIndex`.
   *   后端另有一套自己的累计轮次 (内核的), 但那套在 barge-in / 降级时会与客户端
   *   看到的对不上 —— 所以补漏一律用 voice 层这个号.
   */
  private buildTurnOptions(
    state: VoiceSessionState,
    text: string,
    turnIndex: number,
    signal: AbortSignal,
    send: SendFn,
    roundId?: number,
  ): VoiceTurnBackendTurnOptions & { readonly userId: string } {
    // ⚠️ 返回类型把 userId **收窄回必填**: 端口那一层的 userId 是可选的
    //   (后端实现可以不读它 —— 身份以会话 context 为准), 但 voice 层构造的这份
    //   **一定带**学员身份 (会话 meta 里就有). 旧链路的 VisitorTurnOptions.userId
    //   必填, 收窄让这条不变量在类型层显式成立 —— 而不是用 `?? ''` 造一个假身份.
    return {
      sessionId: state.meta.sessionId,
      tenantId: state.meta.tenantId,
      userId: state.meta.userId,
      personaId: state.meta.personaId ?? state.persona?.id ?? 'default',
      userText: text,
      traceId: state.meta.traceId,
      signal,
      publishFrame: send,
      turnIndex,
      ...(roundId === undefined ? {} : { roundId }),
    };
  }

  /**
   * 本场实际使用的对话后端 (灰度选择结果; 未登记 = 旧链路).
   */
  private backendOf(state: VoiceSessionState): VoiceTurnBackend {
    return this.backends.get(state.meta.sessionId) ?? this.visitor;
  }

  /**
   * 灰度判定: 引擎未装配 / 总开关关 / 会话不在名单内 → 走旧链路.
   */
  private engineSelected(sessionId: string): boolean {
    if (!this.engineBackend) return false;
    if (!this.engineEnabled) return false;
    if (this.grayscaleSessions.size === 0) return true;
    return this.grayscaleSessions.has(sessionId);
  }

  /**
   * 开场: 按灰度选择后端; 新引擎失败 → 当场回落旧链路 (不 500、不关 WS).
   */
  private async openBackendSession(meta: VoiceSessionMeta): Promise<VoiceSessionPersona> {
    if (this.engineSelected(meta.sessionId)) {
      try {
        const persona = await this.engineBackend!.openSession({
          sessionId: meta.sessionId,
          tenantId: meta.tenantId,
          // V2026-10-30 治本 (WP12): 学员 id —— 后端用它把长时记忆归属到
          //   "(学员, 角色)" 维度. 角色 key 对所有学员都相同, 只用它会让学员之间
          //   互相读到对方的咨询内容.
          userId: meta.userId,
          personaId: meta.personaId,
          // V2026-10-29 治本 (WP9-A · 角色参数透传):
          //   只把**握手已经解析好**的东西原样带过去, 不在 voice 层做任何角色语义判断 ——
          //   voice 层不该知道"回避依恋"意味着多高阻抗, 那是角色解析器的职责.
          //   templateId 缺省 (普通 voice session 没有公共人物模板) → 后端走中性基线.
          templateId: meta.visitor?.templateId,
          skillCode: meta.skillCode,
          preset: {
            difficulty: meta.preset.difficulty,
            style: meta.preset.style,
            emotionBaseline: meta.preset.emotionBaseline,
            defenseLevel: meta.preset.defenseLevel,
          },
          // V2026-10-29 治本 (WP9-C): 稳定落库 id —— 危机轮次要同步给督导推
          //   `supervision_hint` 帧, 而帧出口注册表是按落库 id 登记的.
          dbSessionId: meta.dbSessionId,
          // V2026-10-30 治本 (WP10): 轨迹剧本 id —— 原样透传, voice 层不判断剧本存在性.
          //   缺省 = 本场无剧本约束, 后端走 BDI 自由运行 (与现状逐字一致).
          trajectoryScriptId: meta.trajectoryScriptId,
          // V2026-10-30 治本 (WP12): 跨会话接续来源 id —— 原样透传, voice 层不判断
          //   上一场在不在 (那是引擎侧的事: 查不到 → warn + 按新会话开, 不抛错不断连).
          //   缺省 = 新会话, 与现状逐字一致.
          resumeFromSessionId: meta.resumeFromSessionId,
        });
        this.backends.set(meta.sessionId, this.engineBackend!);
        return persona;
      } catch (err) {
        this.logger.error(
          `[startSession] 新引擎开场失败, 本场回落旧链路 session=${meta.sessionId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    const persona = await this.visitor.openSession({
      sessionId: meta.sessionId,
      tenantId: meta.tenantId,
      personaId: meta.personaId,
    });
    this.backends.set(meta.sessionId, this.visitor);
    this.legacyOpened.add(meta.sessionId);
    return persona;
  }

  /**
   * 回落旧链路: 补开旧会话 (新引擎场里旧会话没开过) → 把本场后端切回旧链路.
   *
   * @returns true = 已成功回落; false = 回落不了 (旧会话开不起来), 调用方按原错误处理.
   */
  private async fallbackToLegacy(state: VoiceSessionState, reason: string): Promise<boolean> {
    if (this.backendOf(state) === this.visitor) return true;
    try {
      await this.ensureLegacySession(state);
      this.backends.set(state.meta.sessionId, this.visitor);
      this.logger.warn(`[user_text] ${reason}, 本场回落旧链路 session=${state.meta.sessionId}`);
      return true;
    } catch (err) {
      this.logger.error(`[user_text] ${reason}, 且旧链路补开失败, 维持新链路: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  /**
   * 补开旧链路会话.
   *
   * 为什么必须补开: 新引擎场里 `visitor.openSession` 根本没被调用过, 直接
   * `visitor.streamTurn` 会因"会话未开启"抛错 —— 那等于回落失败, 反而把
   * "可回落"变成"不可回落".
   */
  private async ensureLegacySession(state: VoiceSessionState): Promise<void> {
    if (this.legacyOpened.has(state.meta.sessionId)) return;
    await this.visitor.openSession({
      sessionId: state.meta.sessionId,
      tenantId: state.meta.tenantId,
      personaId: state.meta.personaId,
    });
    this.legacyOpened.add(state.meta.sessionId);
  }

  /**
   * 收尾 TTS (finish / 等事件泵 / 释放连接).
   *
   * @param state 会话状态
   * @param ttsHandle 本轮 TTS 句柄
   * @param ttsPump 本轮事件泵
   * @param outcome 本轮结束方式
   * @param myGeneration 本轮代号
   */
  private async closeTtsTurn(
    state: VoiceSessionState,
    ttsHandle: TtsSessionHandle | null,
    ttsPump: Promise<void> | null,
    outcome: LlmTurnOutcome,
    myGeneration: number,
  ): Promise<void> {
    if (!ttsHandle) {
      return;
    }
    // 正常 done 已 finish; eof 补 finish (尾句不丢); 异常已 cancel
    if (outcome === 'eof' && state.currentGeneration === myGeneration) {
      ttsHandle.finish();
    }
    await ttsPump;
    ttsHandle.dispose();
  }

  /**
   * 逐字稿落库 + 触发该轮分析 (V2026-10-26, spec 任务 1 / 任务 2 / 任务 3 / 任务 4).
   *
   * 只记**完整跑完**的轮次: 被抢白 (barge-in) 或出错的轮次, 来访者的话是截断的 ——
   * 把截断的回应当成完整一轮落库, 每轮分析会在半句话上做判定, 报告也跟着失真.
   *
   * WP16 追加两种**同样不落**的情况:
   *   · `turn_incomplete` —— 本轮回复没发完 (断流), 落库同样是半句话;
   *   · `replayed`       —— 本轮是幂等重放, 第一次那一轮已经落过了, 再落就是重复.
   *
   * @param state 会话状态
   * @param counselorText 咨询师这一轮说的话
   * @param visitorChunks 来访者这一轮的话 (累加器)
   * @param outcome 本轮结束方式
   * @param myGeneration 本轮代号
   */
  private persistTurnIfComplete(
    state: VoiceSessionState,
    counselorText: string,
    visitorChunks: string[],
    outcome: LlmTurnOutcome,
    myGeneration: number,
  ): void {
    if (outcome === 'error' || outcome === 'turn_incomplete' || outcome === 'replayed') {
      return;
    }
    if (state.currentGeneration !== myGeneration) {
      return;
    }
    state.turnCount += 1;
    void this.bridges.appendTurn({
      sessionId: state.meta.sessionId,
      dbSessionId: state.meta.dbSessionId ?? null,
      userId: state.meta.userId,
      tenantId: state.meta.tenantId,
      turnIndex: state.turnCount - 1,
      counselorText,
      visitorText: visitorChunks.join(''),
    });
  }

  /**
   * 收尾一轮 — 清理本轮持有的资源 (只清理**本轮自己的**那份, 不误伤新一轮).
   *
   * @param state 会话状态
   * @param myGeneration 本轮代号
   * @param ttsHandle 本轮的 TTS 句柄
   * @param llmAbort 本轮的 AbortController
   */
  private finishTurn(
    state: VoiceSessionState,
    myGeneration: number,
    ttsHandle: TtsSessionHandle | null,
    llmAbort: AbortController | null,
  ): void {
    if (state.currentGeneration !== myGeneration) {
      // 本轮已被新一轮取代: 只释放本轮资源, 不改 session 状态
      return;
    }
    if (ttsHandle && state.ttsHandle === ttsHandle) {
      state.ttsHandle = null;
    }
    if (llmAbort && state.llmAbort === llmAbort) {
      state.llmAbort = null;
    }
    state.status = 'idle';
  }

  /**
   * 启动 TTS session — voice 模式才走.
   * @returns 成功返 handle, 失败返 null (已发 error 给 client, 调用方负责把 state 标回 idle)
   */
  private async startTtsSession(state: VoiceSessionState, send: SendFn): Promise<TtsSessionHandle | null> {
    // 治本: 音色没配就是**配置错误** —— 绝不能拿未核实的占位音色 (mandarin_female_001) 顶替,
    // 那会合成出"能播但不像人"的音频, 排查成本远高于现在就失败.
    const voiceId = this.resolveSessionVoice(state.meta);
    if (voiceId.length === 0) {
      this.logger.error('[tts] TTS 音色未配置, 本轮不出声');
      send({
        type: 'error',
        error: { code: 'tts_config_invalid', message: 'TTS 音色未配置 (MINIMAX_TTS_VOICE_ID)', retryable: false },
      });
      return null;
    }
    const ttsOptions: TtsOptions = {
      tenantId: state.meta.tenantId,
      userId: state.meta.userId,
      sessionId: state.meta.sessionId,
      // V2026-10-26 治本 (spec §任务 3 — 音色优先级放开为"可选覆盖, 缺省仍是 env"):
      //   握手 voiceId > 模板绑定音色 (若有) > env `MINIMAX_TTS_VOICE_ID`.
      //   不传 voiceId 时行为与改前**完全一致** (还是那条 env 音色).
      voice: voiceId,
      model: this.ttsModel,
    };
    try {
      return await this.tts.startSession(ttsOptions);
    } catch (err) {
      this.logger.error(`[user_text] TTS startSession failed: ${err instanceof Error ? err.message : String(err)}`);
      send({
        type: 'error',
        error: { code: 'tts_start_failed', message: 'TTS 启动失败', retryable: true },
      });
      return null;
    }
  }

  /**
   * 解析本场生效的 TTS 音色 (V2026-10-26, spec §任务 3).
   *
   * 优先级链: **握手 voiceId** > 模板绑定音色 (若有) > env `MINIMAX_TTS_VOICE_ID`.
   *
   * - 握手 voiceId: 由网关校验过 (不在账号可用系统音色内时已被丢弃并回退 env).
   * - 模板绑定音色: **本期公共人物模板还没绑定音色** (`visitor_pool_templates` 无 voice_id 列),
   *   所以这一级恒为空 —— 但通道在此预留, 将来模板表加音色列时只需在这里补一行,
   *   不动 TTS 客户端与连接池.
   * - env: 老行为, 保持不变 (不传 voiceId 的存量客户端零影响).
   *
   * @param meta 会话元数据
   * @returns 本场音色; 空串 = 未配置 (调用方 fail-fast 报错, 不用占位音色顶替)
   */
  private resolveSessionVoice(meta: VoiceSessionMeta): string {
    const requested = meta.voiceId?.trim();
    if (requested) {
      return requested;
    }
    // 模板绑定音色: 本期无 (模板表未绑定 voice_id) —— 预留位, 见 JSDoc.
    return this.ttsVoiceId;
  }

  /**
   * 消费 TTS 事件流 (独立协程, 与 LLM 流并行) — 句级 mp3 一到就转发.
   *
   * 单独拎出来是因为旧实现"先吃完 LLM 流再等 TTS", 音频要等整段文本生成完才下发,
   * 逐句出声根本不成立 (spec §2.4 的时序要求音频与字幕并行).
   *
   * @param handle TTS 句柄
   * @param myGeneration 本轮代号
   * @param state 会话状态
   * @param send 帧发送回调
   */
  private async pumpTtsEvents(handle: TtsSessionHandle, myGeneration: number, state: VoiceSessionState, send: SendFn): Promise<void> {
    try {
      for await (const event of handle.events) {
        if (state.currentGeneration !== myGeneration) {
          // 本轮已被新一轮取代 —— 不再下发本轮剩余音频
          this.logger.log(`[tts_pump] gen mismatch, stop gen=${myGeneration}`);
          return;
        }
        this.forwardTtsEvent(event, send);
      }
    } catch (err) {
      this.logger.error(`[tts_pump] stream error: ${err instanceof Error ? err.message : String(err)}`);
      send({
        type: 'error',
        error: { code: 'tts_stream_error', message: 'TTS 流错误', retryable: true },
      });
    }
  }

  /**
   * TTS 事件 → 前端帧.
   *
   * @param event TTS 事件
   * @param send 帧发送回调
   */
  private forwardTtsEvent(event: TtsEvent, send: SendFn): void {
    switch (event.type) {
      case 'sentence_start':
        send({ type: 'sentence_start', seq: event.seq, text: event.text });
        return;
      case 'sentence_audio':
        send({
          type: 'tts_audio',
          seq: event.seq,
          text: event.text,
          mime: event.mime,
          audio_base64: event.data.toString('base64'),
        });
        return;
      case 'sentence_end':
        send({ type: 'sentence_end', seq: event.seq });
        return;
      case 'done':
        send({ type: 'tts_done', usage: { characters: event.usage.characters } });
        return;
      case 'error':
        send({ type: 'error', error: event.error });
    }
  }

  /**
   * 消费 LLM 流.
   *   chunk.type 三态:
   *     - content: 转发 client + 推 TTS
   *     - error:   log + 发 error + cancel TTS
   *     - done:    发 llm_done + 通知 TTS 收尾 (finish)
   *   generation mismatch (新 user_text 打断) → 停止本轮.
   *
   * @param llmStream LLM 流
   * @param turnIndex 本场轮次 (从 1 起; 带进 `llm_done` 帧, 客户端靠它报 `lastSeenTurnIndex`)
   * @param myGeneration 本轮代号
   * @param state 会话状态
   * @param send 帧发送回调
   * @param ttsHandle 本轮 TTS 句柄
   * @param collected 本轮来访者文本累加器 (V2026-10-26: 供逐字稿落库)
   * @returns 本轮结束方式 (done / error / eof)
   */
  private async consumeLlmStream(
    llmStream: LlmStream,
    turnIndex: number,
    myGeneration: number,
    state: VoiceSessionState,
    send: SendFn,
    ttsHandle: TtsSessionHandle | null,
    collected: string[],
  ): Promise<LlmTurnOutcome> {
    for await (const chunk of llmStream) {
      if (state.currentGeneration !== myGeneration) {
        // 已被新 user_text 打断
        this.logger.log(`[user_text] gen mismatch, abort gen=${myGeneration}`);
        return 'eof';
      }
      switch (chunk.type) {
        case 'content':
          collected.push(chunk.content);
          send({ type: 'llm_text', text: chunk.content });
          ttsHandle?.sendText(chunk.content);
          break;
        case 'error':
          this.logger.warn(`[user_text] LLM error: ${chunk.error.code}`);
          send({ type: 'error', error: { code: chunk.error.code, message: chunk.error.message, retryable: chunk.error.retryable } });
          ttsHandle?.cancel();
          // WP16: 「本轮不完整」**不是**引擎故障 —— 不能回落旧链路.
          //   旧链路没有轮次语义, 回落等于让同一句话在两条链路上各跑一遍 (状态双写).
          //   它是协议信号: 客户端拿到后应当换一个轮次号走新一轮.
          return chunk.error.code === TURN_INCOMPLETE_CODE ? 'turn_incomplete' : 'error';
        case 'done':
          // V2026-10-29 治本 (WP9-C): 带 usage —— 端上/E2E 验收要看思考 token 与
          //   输出长度 (老客户端不认识这个可选字段, 直接忽略).
          // V2026-11-03 治本 (WP23): 带 `turnIndex` —— 客户端断线重连时要报
          //   "我上次听到第几轮", 靠的就是这个号. 缺省 = 后端没给轮次号 (旧链路),
          //   客户端按"不知道听到哪"处理 (握手不带 lastSeenTurnIndex).
          // V2026-11-03 治本 (WP26 · P2-34): 带 `finishReason` —— 上游把正文按长度
          //   截断时 (`length`), 客户端要能分"说完了"与"被截断了"; 缺省 = 上游没给.
          send({
            type: 'llm_done',
            usage: {
              promptTokens: chunk.usage.promptTokens,
              completionTokens: chunk.usage.completionTokens,
              totalTokens: chunk.usage.totalTokens,
              ...(chunk.usage.reasoningTokens === undefined ? {} : { reasoningTokens: chunk.usage.reasoningTokens }),
            },
            turnIndex,
            ...(chunk.finishReason === undefined ? {} : { finishReason: chunk.finishReason }),
          });
          ttsHandle?.finish();
          // WP16: 重放 (幂等复用) **不是新的一轮** —— 逐字稿不能再落第二条.
          return chunk.replayed ? 'replayed' : 'done';
      }
    }
    return 'eof';
  }

  /**
   * 打断 — 取消 LLM + TTS, 通知 client.
   */
  private onUserSpeaking(state: VoiceSessionState, send: SendFn): void {
    if (state.status !== 'processing') {
      this.logger.debug(`[user_speaking] no active pipeline, ignore`);
      return;
    }
    this.bargeIn(state, send);
  }

  /**
   * 打断执行体.
   *
   * 语义 (spec §2.6): LLM abort + TTS task_cancel + generation 递增防旧流回灌 →
   * 回 `cancelled`. **已下发给前端的音频不撤回** (官方语义), 由前端本地停播丢弃.
   *
   * ⚠️ **V2026-11-05 治本 (WP45 · P3-4 · `state.status = 'cancelled'` 为什么"只写不读")**:
   *   `state.status` 的四个读点 (phaseOf / shouldIgnoreTurn / onUserSpeaking / resumeSession)
   *   分支的是 `'paused'` 与 `'processing'`, **没有一处读 `'cancelled'`**.
   *   这**不是 bug, 是刻意的** (WP25 审查 §1.5 已定论: "abort → cancelled 帧 —— 不是 bug, 划掉"):
   *     · 打断是**正常交互**, 不是错误 —— 客户端收到 `cancelled` 帧才是对的语义;
   *     · `'cancelled'` 在读侧与 `'idle'` **同义** (都表示"这一轮不在跑"), 读侧靠
   *       `!== 'processing'` 判定"没有正在跑的流水线", 不需要再分一档.
   *   ⚠️ **为什么不能删掉这个赋值** (别把它当冗余写清理掉):
   *     删掉后 `state.status` 会**停在 `'processing'`** —— 而 `onUserSpeaking` 的
   *     守卫是 `if (state.status !== 'processing') return;` -> 下一次 user_speaking
   *     会对一条**已经死掉的**流水线再打断一次 (重复 abort / 重复 dispose).
   *     所以这行赋值是**状态机的一环**, 不是"写了没人看"的死代码.
   *   本单只补注释, 说明白它为什么长这样 —— 免得下一个读代码的人把它当 bug 删掉.
   */
  private bargeIn(state: VoiceSessionState, send: SendFn): void {
    state.currentGeneration += 1;
    // V2026-10-09 治本: signal 真正中断 fetch (不再仅靠 generation 检查兜底)
    state.llmAbort?.abort();
    state.llmAbort = null;
    state.ttsHandle?.cancel();
    // 治本 (spec §3.6): 打断后必须释放连接, 否则池里会留下一条已取消的连接占坑
    state.ttsHandle?.dispose();
    state.ttsHandle = null;
    state.status = 'cancelled';
    send({ type: 'cancelled' });
    this.logger.log(`[bargeIn] session=${state.meta.sessionId} new gen=${state.currentGeneration}`);
  }

  /**
   * 暂停会话 (V2026-10-26, spec 任务 5).
   *
   * 语义是"**挂起**"不是"中断": 会话不断 (WS 不关)、逐字稿不清、访客记忆不清,
   * 只是把**当前这一轮**停下来 (停掉 TTS 播放 + 停掉正在生成的 LLM 流).
   *
   * 复用 bargeIn 的资源释放 (TTS cancel + LLM abort + generation 递增), 区别在
   * **不**发 `cancelled` 帧: `cancelled` 的语义是"这一轮被打断", 暂停不是打断,
   * 混用会让前端把暂停误渲染成"对方突然不说了".
   *
   * @param state 会话状态
   * @param send 帧发送回调
   */
  private pauseSession(state: VoiceSessionState, send: SendFn): void {
    if (state.status === 'paused') {
      // 重复暂停 → 幂等回确认帧 (不报错, 不重复释放资源)
      send({ type: 'paused' });
      return;
    }
    if (state.status === 'processing') {
      this.logger.log(`[pause] session=${state.meta.sessionId} gen=${state.currentGeneration} 挂起当前轮`);
      this.bargeIn(state, () => {
        // bargeIn 会发 `cancelled` 帧 —— 暂停场景下**不能**发 (语义不同), 用空回调顶掉.
      });
    }
    state.status = 'paused';
    this.logger.log(`[pause] session=${state.meta.sessionId} status=paused`);
    send({ type: 'paused' });
  }

  /**
   * 恢复会话 (V2026-10-26, spec 任务 5).
   *
   * 状态回待命 (idle); 访客记忆与逐字稿原样保留 → 下一轮从挂起点继续.
   *
   * @param state 会话状态
   * @param send 帧发送回调
   */
  private resumeSession(state: VoiceSessionState, send: SendFn): void {
    if (state.status !== 'paused') {
      // 未暂停时收到 resume → 幂等回确认帧 (不报错)
      send({ type: 'resumed' });
      return;
    }
    state.status = 'idle';
    this.logger.log(`[resume] session=${state.meta.sessionId} status=idle`);
    send({ type: 'resumed' });
  }
}

/**
 * 读布尔开关 (env 文本 → 布尔).
 *
 * 口径: 只有明确为真 (1 / true / yes / on) 才算真; 其余 (含空 / 0 / false) 都算假.
 * 为什么不用 `Boolean(raw)`: 字符串 'false' 在 JS 里是 **truthy** —— 那是把"关了"
 * 读成"开了"的经典事故.
 */
function readBooleanFlag(raw: string | undefined): boolean {
  if (typeof raw !== 'string') return false;
  const value = raw.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

/**
 * 解析灰度会话白名单 (逗号分隔).
 *
 * 空串 / 缺省 → 空集合 (= 总开关打开即全量灰度).
 */
function parseSessionWhitelist(raw: string | undefined): ReadonlySet<string> {
  if (typeof raw !== 'string') return new Set<string>();
  const ids = raw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  return new Set(ids);
}
