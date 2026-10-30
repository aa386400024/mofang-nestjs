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

import { TtsService } from './tts/tts.service';
import type { TtsEvent, TtsOptions, TtsSessionHandle } from './tts/tts.types';
import { VoiceSessionBridgeRegistry, type VoiceSessionCloseResult } from './voice-session-bridge';
import { VOICE_TURN_BACKEND, type VoiceTurnBackend, type VoiceTurnBackendTurnOptions } from './voice-turn-backend.port';
import type {
  VoiceClientMessage,
  VoiceServerMessage,
  VoiceSessionMeta,
  VoiceSessionPersona,
  VoiceSessionReportStatus,
  VoiceSessionState,
} from './voice.types';
import type { LlmStream, LlmStreamChunk } from '../agent/llm/llm.types';
import { SupervisorProcessor } from '../agent/supervisor/supervisor.processor';
import type { RunReportInput } from '../agent/supervisor/supervisor.types';
import { VisitorService } from '../agent/visitor/visitor.service';
import type { VisitorPersonaSnapshot } from '../agent/visitor/visitor.types';

type SendFn = (msg: VoiceServerMessage) => void;

/**
 * 等待业务桥收尾结果的最长时间 (ms).
 *
 * V2026-10-27 (spec 任务 B): `session_ended` 帧要带报告状态, 而报告状态由业务桥
 * 收尾时算出 (要落库) —— 但落库是 I/O, DB 抖动时不能把前端卡在"等结束帧"上.
 * 800ms 足够覆盖一次本地 DB UPDATE + 一次 Redis 入队; 超时就按"结论未知"发帧.
 */
const BRIDGE_CLOSE_TIMEOUT_MS = 800;

/**
 * 一轮 LLM 的结束方式.
 *
 * 决定 TTS 怎么收尾:
 * - `done`: 收到 done chunk (已调 finish)
 * - `error`: 收到 error chunk (已调 cancel)
 * - `eof`: 流自然结束但没有 done chunk (需补 finish, 否则尾句卡在上游)
 */
type LlmTurnOutcome = 'done' | 'error' | 'eof';

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

  private readonly sessions = new Map<string, VoiceSessionState>();

  /**
   * @param visitor 来访者编排 (persona + prompt + 历史) —— 旧链路, 灰度兜底底座
   * @param supervisorProcessor 督导报告 (异步)
   * @param tts TTS 门面
   * @param config 全局配置
   * @param engineBackend 新引擎版对话后端 (WP8-B 灰度; 未装配时为 undefined → 走旧链路)
   */
  constructor(
    private readonly visitor: VisitorService,
    private readonly supervisorProcessor: SupervisorProcessor,
    private readonly tts: TtsService,
    private readonly bridges: VoiceSessionBridgeRegistry,
    config: ConfigService,
    @Optional() @Inject(VOICE_TURN_BACKEND) private readonly engineBackend?: VoiceTurnBackend,
  ) {
    this.ttsVoiceId = config.get<string>('minimax.ttsVoiceId') ?? '';
    this.ttsModel = config.get<string>('minimax.ttsModel') ?? 'speech-2.8-turbo';
    this.engineEnabled = readBooleanFlag(config.get<string>('ENGINE_VOICE_ENABLED'));
    this.grayscaleSessions = parseSessionWhitelist(config.get<string>('ENGINE_STREAM_GRAYSCALE_SESSIONS'));
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

    switch (msg.type) {
      case 'user_text':
        await this.onUserText(state, msg.text, send);
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
    }
  }

  /**
   * 启动一个 voice session — resolve persona + 创建 visitor memory + 缓存 state.
   * 异步 (resolve persona 走仓储). gateway 在 verifyAndStart 时 await.
   * @throws 当 visitor.openSession 失败 (无 persona) 时 throw, gateway 关闭 socket
   */
  async startSession(meta: VoiceSessionMeta): Promise<void> {
    if (this.sessions.has(meta.sessionId)) {
      this.logger.warn(`[startSession] session=${meta.sessionId} already exists, replacing`);
      const old = this.sessions.get(meta.sessionId)!;
      old.ttsHandle?.dispose();
      old.llmAbort?.abort();
    }
    const personaSnapshot: VoiceSessionPersona = await this.openBackendSession(meta);
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
    };
    this.sessions.set(meta.sessionId, state);
    this.logger.log(
      `[startSession] session=${meta.sessionId} tenant=${meta.tenantId} user=${meta.userId} ` +
        `persona=${personaSnapshot.id} mode=${meta.mode} template_preset=${JSON.stringify(meta.preset)}`,
    );
  }

  /** 关闭 voice session. gateway 在 handleDisconnect 时调. */
  endSession(sessionId: string, reason: 'user_finish' | 'timeout' | 'error' = 'user_finish', send?: SendFn): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
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
    this.engineBackend?.closeSession(sessionId);
    if (backend !== this.visitor) {
      this.visitor.closeSession(sessionId);
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
    reason: 'user_finish' | 'timeout' | 'error',
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

  // ── private ────────────────────────────────────────────────────

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
   */
  private async onUserText(state: VoiceSessionState, text: string, send: SendFn): Promise<void> {
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
    const { outcome, llmAbort } = await this.runLlmTurn(state, text, myGeneration, send, ttsHandle, visitorChunks);

    // 3. 收尾 TTS (正常 done 已 finish; eof 补 finish; 异常已 cancel)
    await this.closeTtsTurn(state, ttsHandle, ttsPump, outcome, myGeneration);

    this.finishTurn(state, myGeneration, ttsHandle, llmAbort);

    // 4. 逐字稿落库 + 触发该轮分析 (V2026-10-26, spec 任务 1 / 任务 2 / 任务 3 / 任务 4)
    this.persistTurnIfComplete(state, text, visitorChunks, outcome, myGeneration);

    this.logger.log(`[user_text] done gen=${myGeneration} outcome=${outcome} persona=${state.persona?.id ?? 'unknown'}`);
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
   * @param myGeneration 本轮代号
   * @param send 帧发送回调
   * @param ttsHandle 本轮 TTS 句柄 (LLM chunk 要喂给它)
   * @param visitorChunks 本轮来访者文本累加器 (供逐字稿落库)
   * @returns 本轮结束方式 + 本轮的 AbortController (供 finishTurn 清理)
   */
  private async runLlmTurn(
    state: VoiceSessionState,
    text: string,
    myGeneration: number,
    send: SendFn,
    ttsHandle: TtsSessionHandle | null,
    visitorChunks: string[],
  ): Promise<{ outcome: LlmTurnOutcome; llmAbort: AbortController }> {
    const llmAbort = new AbortController();
    state.llmAbort = llmAbort;
    try {
      const llmStream = await this.resolveTurnStream(state, text, llmAbort.signal);
      send({ type: 'llm_start' });
      const outcome = await this.consumeLlmStream(llmStream, myGeneration, state, send, ttsHandle, visitorChunks);
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
  private async resolveTurnStream(state: VoiceSessionState, text: string, signal: AbortSignal): Promise<LlmStream> {
    const options = this.buildTurnOptions(state, text, signal);
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
    options: VoiceTurnBackendTurnOptions,
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
   */
  private buildTurnOptions(state: VoiceSessionState, text: string, signal: AbortSignal): VoiceTurnBackendTurnOptions {
    return {
      sessionId: state.meta.sessionId,
      tenantId: state.meta.tenantId,
      userId: state.meta.userId,
      personaId: state.meta.personaId ?? state.persona?.id ?? 'default',
      userText: text,
      traceId: state.meta.traceId,
      signal,
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
    if (outcome === 'error' || state.currentGeneration !== myGeneration) {
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
   * @param myGeneration 本轮代号
   * @param state 会话状态
   * @param send 帧发送回调
   * @param ttsHandle 本轮 TTS 句柄
   * @param collected 本轮来访者文本累加器 (V2026-10-26: 供逐字稿落库)
   * @returns 本轮结束方式 (done / error / eof)
   */
  private async consumeLlmStream(
    llmStream: LlmStream,
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
          return 'error';
        case 'done':
          // V2026-10-29 治本 (WP9-C): 带 usage —— 端上/E2E 验收要看思考 token 与
          //   输出长度 (老客户端不认识这个可选字段, 直接忽略).
          send({
            type: 'llm_done',
            usage: {
              promptTokens: chunk.usage.promptTokens,
              completionTokens: chunk.usage.completionTokens,
              totalTokens: chunk.usage.totalTokens,
              ...(chunk.usage.reasoningTokens === undefined ? {} : { reasoningTokens: chunk.usage.reasoningTokens }),
            },
          });
          ttsHandle?.finish();
          return 'done';
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
