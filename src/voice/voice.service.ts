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

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { TtsService } from './tts/tts.service';
import type { TtsEvent, TtsOptions, TtsSessionHandle } from './tts/tts.types';
import type { VoiceClientMessage, VoiceServerMessage, VoiceSessionMeta, VoiceSessionPersona, VoiceSessionState } from './voice.types';
import type { LlmStream } from '../agent/llm/llm.types';
import { SupervisorProcessor } from '../agent/supervisor/supervisor.processor';
import type { RunReportInput } from '../agent/supervisor/supervisor.types';
import { VisitorService } from '../agent/visitor/visitor.service';

type SendFn = (msg: VoiceServerMessage) => void;

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

  private readonly sessions = new Map<string, VoiceSessionState>();

  /**
   * @param visitor 来访者编排 (persona + prompt + 历史)
   * @param supervisorProcessor 督导报告 (异步)
   * @param tts TTS 门面
   * @param config 全局配置
   */
  constructor(
    private readonly visitor: VisitorService,
    private readonly supervisorProcessor: SupervisorProcessor,
    private readonly tts: TtsService,
    config: ConfigService,
  ) {
    this.ttsVoiceId = config.get<string>('minimax.ttsVoiceId') ?? '';
    this.ttsModel = config.get<string>('minimax.ttsModel') ?? 'speech-2.8-turbo';
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
    const personaSnapshot: VoiceSessionPersona = await this.visitor.openSession({
      sessionId: meta.sessionId,
      tenantId: meta.tenantId,
      personaId: meta.personaId,
    });
    const state: VoiceSessionState = {
      meta,
      persona: personaSnapshot,
      status: 'idle',
      currentGeneration: 0,
      ttsHandle: null,
      llmAbort: null,
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
    const transcript = this.visitor.transcript(sessionId);
    const visitorClose = this.visitor.closeSession(sessionId);
    this.sessions.delete(sessionId);
    this.logger.log(
      `[endSession] session=${sessionId} reason=${reason} ` +
        `visitor_turns=${visitorClose.finalTurnCount} transcript_msgs=${transcript.length}`,
    );
    // V2026-10-09 治本 (Phase 5): 异步督导, session 结束触发 supervisor queue (fire-and-forget)
    //   - 不阻塞 session_ended 消息
    //   - enqueue 失败 → processSync 兜底 (LLM 推理 2-5s, 但 session_ended 已经发出)
    //   - 空 transcript 跳过 (user 没说话就结束, 没督导意义)
    if (transcript.length > 0 && state.persona) {
      const input: RunReportInput = {
        sessionId,
        tenantId: state.meta.tenantId,
        userId: state.meta.userId,
        persona: state.persona,
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
    send?.({ type: 'session_ended', reason });
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
    if (text.trim().length === 0) {
      this.logger.debug(`[user_text] empty, ignore`);
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
    const ttsHandle = state.meta.mode === 'voice' ? await this.startTtsSession(state, send) : null;
    if (state.meta.mode === 'voice' && !ttsHandle) {
      state.status = 'idle';
      return;
    }
    if (ttsHandle) {
      state.ttsHandle = ttsHandle;
    }

    // 2. 启动 TTS 事件泵 (与 LLM 流并发) —— "边生成边出声"的关键
    const ttsPump = ttsHandle ? this.pumpTtsEvents(ttsHandle, myGeneration, state, send) : null;

    // 3. 启动 LLM 流 (通过 Visitor — persona + history 编排, signal 透传)
    const llmAbort = new AbortController();
    state.llmAbort = llmAbort;
    let outcome: LlmTurnOutcome = 'eof';
    try {
      const { stream: llmStream } = await this.visitor.streamTurn({
        sessionId: state.meta.sessionId,
        tenantId: state.meta.tenantId,
        userId: state.meta.userId,
        personaId: state.meta.personaId ?? state.persona?.id ?? 'default',
        userText: text,
        traceId: state.meta.traceId,
        signal: llmAbort.signal,
      });
      send({ type: 'llm_start' });
      outcome = await this.consumeLlmStream(llmStream, myGeneration, state, send, ttsHandle);
    } catch (err) {
      this.logger.error(`[user_text] LLM stream error: ${err instanceof Error ? err.message : String(err)}`);
      send({
        type: 'error',
        error: { code: 'llm_stream_error', message: 'LLM 流错误', retryable: true },
      });
      ttsHandle?.cancel();
      // 标成 error: 避免下面的收尾分支再发一次 task_finish (cancel 之后不该再收尾)
      outcome = 'error';
    }

    // 4. 收尾 TTS: 正常 done 已 finish; eof 补 finish (尾句不丢); 异常已 cancel
    if (ttsHandle) {
      if (outcome === 'eof' && state.currentGeneration === myGeneration) {
        ttsHandle.finish();
      }
      await ttsPump;
      ttsHandle.dispose();
    }

    this.finishTurn(state, myGeneration, ttsHandle, llmAbort);
    this.logger.log(`[user_text] done gen=${myGeneration} outcome=${outcome} persona=${state.persona?.id ?? 'unknown'}`);
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
   * @returns 本轮结束方式 (done / error / eof)
   */
  private async consumeLlmStream(
    llmStream: LlmStream,
    myGeneration: number,
    state: VoiceSessionState,
    send: SendFn,
    ttsHandle: TtsSessionHandle | null,
  ): Promise<LlmTurnOutcome> {
    for await (const chunk of llmStream) {
      if (state.currentGeneration !== myGeneration) {
        // 已被新 user_text 打断
        this.logger.log(`[user_text] gen mismatch, abort gen=${myGeneration}`);
        return 'eof';
      }
      switch (chunk.type) {
        case 'content':
          send({ type: 'llm_text', text: chunk.content });
          ttsHandle?.sendText(chunk.content);
          break;
        case 'error':
          this.logger.warn(`[user_text] LLM error: ${chunk.error.code}`);
          send({ type: 'error', error: { code: chunk.error.code, message: chunk.error.message, retryable: chunk.error.retryable } });
          ttsHandle?.cancel();
          return 'error';
        case 'done':
          send({ type: 'llm_done' });
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
}
