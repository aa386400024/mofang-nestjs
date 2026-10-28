// V2026-10-23 治本 (TTS bidi 单连接封装 — 按官方 T2A V2 协议重写, spec §3):
//   协议: MiniMax **T2A V2 双向流式** (wss://<base>/ws/v1/t2a_v2_bidi)
//     - 帧格式: **纯 JSON 文本帧**, 帧类型字段是 `event` (不是自拟的 `type`), **无二进制头**
//     - 音频: `task_continued.data.audio` = **hex 编码的 mp3 分片**, 一句由多片组成
//     - 鉴权: 握手头 `Authorization: Bearer <key>` (复用全局 key, 不新增 TTS 独立 key)
//   旧实现 (V2026-10-08) 的 5 处协议错误, 本次全部纠正:
//     ① 端点 `/v1/t2a/bidi` (自拟) → `/ws/v1/t2a_v2_bidi` (官方)
//     ② 二进制帧 0x01/0x02 自定义头 → 纯 JSON 文本帧
//     ③ 裸 PCM Buffer 直传 → hex mp3 解码 + **服务端按句攒齐**成整句 mp3
//     ④ 模型 `speech-2.8` (不存在) → `speech-2.8-turbo` (env 可配, 枚举受校验)
//     ⑤ 音色 `mandarin_female_001` (未核实占位) → env `MINIMAX_TTS_VOICE_ID` (未配置即报错, 不猜)
//   职责: 协议翻译层. 收到上游帧 → 翻译成业务事件 (句级 mp3) 交付上层; 上层只管喂文本.
//   生命周期: connect() (等 connected_success → 发 task_start → 等 task_started) →
//     sendText()/finish()/cancel() → task_finished/task_failed/close → 事件流结束.
//
//   反双胞胎:
//     - 不用 Node 原生 WebSocket: 项目已有 ws 包, 类型完备
//     - 不用 EventEmitter: 事件源单生产者, 用 AsyncEventQueue 顺序交付即可
//     - 不在 client 里做重连: 重连策略属于"本轮还要不要继续"的业务决策, 交给上层
//     - 不把 hex 分片透传给上层: 拼 mp3 必须发生在服务端
//
//   验证 (由大炮在 Windows 环境手动执行):
//     1. tsc 0 错
//     2. TtsService.startSession → 1 条 pool 连接
//     3. client.sendText('你好呀。') → 收到 sentence_start / sentence_audio / sentence_end
//     4. client.finish() → 收到 done (含 usage.characters)
//     5. client.cancel() → 收到 task_canceled, 连接释放
//
//   时间戳: 2026-10-23

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// V2026-10-09 lint fix (@typescript-eslint/naming-convention strictCamelCase): WebSocket (PascalCase) → wsWebSocket
//   跟 src/voice/voice.gateway.ts 项目约定一致 (那里用 `import type { WebSocket as WsWebSocket } from 'ws'`).
// V2026-10-09 lint fix v2: strictCamelCase 要求首字母小写, WsWebSocket (PascalCase 起头) 触线, 改 wsWebSocket.
// V2026-10-23: 不再自拟二进制帧, 这里只当"官方 JSON 文本帧"的传输通道使用.
import wsWebSocket from 'ws';

import { AsyncEventQueue } from './async-event-queue';
import { mapTtsUpstreamError } from './tts-error.mapper';
import {
  buildTtsBidiUrl,
  isSupportedTtsModel,
  TTS_DEFAULT_MODEL,
  TTS_STATUS,
  TTS_SUPPORTED_BITRATES,
  TTS_SUPPORTED_SAMPLE_RATES,
} from './tts-protocol.config';
import type { TtsBidiClientEvent, TtsBidiServerEvent } from './tts-protocol.types';
import { splitSentences } from './tts-sentence-splitter';
import type { TtsEvent, TtsOptions } from './tts.types';

/** 客户端状态机. */
type TtsClientState = 'idle' | 'connecting' | 'streaming' | 'closing' | 'closed';

/** 简易 deferred (连接握手阶段等上游事件用). */
interface Deferred {
  readonly promise: Promise<void>;
  resolve: () => void;
  reject: (reason: Error) => void;
}

/**
 * 创建一个 deferred.
 *
 * @returns deferred
 */
function createDeferred(): Deferred {
  let resolveFn: () => void = () => {};
  let rejectFn: (reason: Error) => void = () => {};
  const promise = new Promise<void>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  return { promise, resolve: resolveFn, reject: rejectFn };
}

/** 打断后等待上游 task_canceled 的宽限期 (超时则强制断开). */
const CANCEL_GRACE_MS = 2000;

export class TtsBidiClient implements AsyncIterable<TtsEvent> {
  private readonly logger: Logger;
  /** 本次会话选项 (日志与上游 session_id 用). */
  private readonly opts: TtsOptions;

  // ── 连接参数 (来自 env) ──
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly voiceId: string;
  private readonly model: string;
  private readonly languageBoost: string;
  private readonly speed: number;
  private readonly volume: number;
  private readonly pitch: number;
  private readonly sampleRate: number;
  private readonly bitrate: number;
  private readonly connectTimeoutMs: number;
  private readonly keepaliveMs: number;
  private readonly maxSentenceChars: number;

  // ── 连接状态 ──
  private socket: wsWebSocket | null = null;
  private state: TtsClientState = 'idle';
  private connected: Deferred | null = null;
  private started: Deferred | null = null;
  private cancelTimer: NodeJS.Timeout | null = null;
  private keepaliveTimer: NodeJS.Timeout | null = null;

  // ── 业务状态 ──
  private readonly events = new AsyncEventQueue<TtsEvent>();
  /** 已下发但尚未被上游消费的句子文本 (按序, 用于给音频配字幕). */
  private readonly pendingSentences: string[] = [];
  /** 未成句的文本尾巴. */
  private residualText = '';
  /** 当前句的音频分片. */
  private audioChunks: Buffer[] = [];
  /** 当前句的文本 (上游给了字幕就用上游的, 否则用我们切出来的). */
  private currentText = '';
  private currentSeq = 0;
  private charCount = 0;
  private usageCharacters = 0;
  /** 最近一次下发的句子 (2205 队列溢出时重发它). */
  private lastSentSentence: string | null = null;
  private queueOverflowRetries = 0;

  private readonly onClosed: (() => void) | undefined;

  /**
   * @param config 全局配置 (env 注入)
   * @param opts 本次 TTS 会话选项
   * @param onClosed 连接关闭回调 (连接池据此释放租约)
   */
  constructor(config: ConfigService, opts: TtsOptions, onClosed?: () => void) {
    this.logger = new Logger(`${TtsBidiClient.name}:${opts.sessionId}`);
    this.opts = opts;
    this.onClosed = onClosed;

    this.baseUrl = config.getOrThrow<string>('minimax.baseUrl');
    this.apiKey = config.getOrThrow<string>('minimax.apiKey');
    // V2026-10-26 治本 (spec §任务 3 — 音色优先级放开为"可选覆盖, 缺省仍是 env"):
    //   会话级覆盖 (opts.voice, 来自握手 voiceId) > env `MINIMAX_TTS_VOICE_ID`.
    //   老实现**只读 env**, 把 `opts.voice` 这个字段晾在类型里当摆设 —— 业务层传什么都不生效.
    //   现在按优先级链取值, 且两者都空时仍然 fail-fast (见 connect()).
    //
    //   这里**不用 `||`**: 空串在 `||` 下会回退, 在 `??` 下不会 —— 而我们要的正是
    //   "空串 = 没配 = 回退到 env". 所以先把两边的空串归一成空串, 再用三元挑优先级
    //   (@typescript-eslint/prefer-nullish-coalescing 会把 `||` 判成不安全, 但那正是
    //   本行需要的语义, 不能直接换成 `??`).
    const sessionVoice = opts.voice?.trim() ?? '';
    const envVoice = config.get<string>('minimax.ttsVoiceId')?.trim() ?? '';
    this.voiceId = sessionVoice.length > 0 ? sessionVoice : envVoice;
    this.model = this.resolveModel(opts.model ?? config.get<string>('minimax.ttsModel'));
    this.languageBoost = config.get<string>('minimax.ttsLanguageBoost') ?? 'Chinese';
    this.speed = config.get<number>('minimax.ttsSpeed') ?? 1;
    this.volume = config.get<number>('minimax.ttsVolume') ?? 1;
    this.pitch = config.get<number>('minimax.ttsPitch') ?? 0;
    this.sampleRate = this.resolveSampleRate(config.get<number>('minimax.ttsSampleRate') ?? 32_000);
    this.bitrate = this.resolveBitrate(config.get<number>('minimax.ttsBitrate') ?? 128_000);
    this.connectTimeoutMs = config.get<number>('minimax.ttsTimeoutMs') ?? 30_000;
    this.keepaliveMs = config.get<number>('minimax.ttsKeepaliveMs') ?? 30_000;
    this.maxSentenceChars = config.get<number>('minimax.ttsMaxSentenceChars') ?? 100;
  }

  /**
   * 建立连接并完成 `task_start` 握手.
   *
   * @throws 上游握手失败 / 超时
   */
  async connect(): Promise<void> {
    if (this.state !== 'idle') {
      throw new Error(`TtsBidiClient: 状态非法 (${this.state}), 不能重复连接`);
    }
    if (this.voiceId.length === 0) {
      // 治本: 音色没配就是**配置错误**, 绝不能拿占位音色 (mandarin_female_001) 顶替 ——
      // 那会合成出"能播但不像人"的音频, 排查成本远高于现在就失败.
      throw new Error('TtsBidiClient: 未配置 TTS 音色 (env MINIMAX_TTS_VOICE_ID 为空且本次会话未指定音色)');
    }
    this.state = 'connecting';

    const url = buildTtsBidiUrl(this.baseUrl);
    // V2026-10-09 lint fix (new-cap): wsWebSocket 是 ws 包 default export (WebSocket class),
    //   naming-convention 要求首字母小写 (strictCamelCase) ↔ new-cap 要求首字母大写 (constructor),
    //   两规则对 default import 类的引用天然冲突. 选 lowercase import (跟 strictCamelCase 一致),
    //   这处 new 操作 inline disable new-cap. V1.x 收口: 改 import 为 `import webSocket from 'ws'`
    //   (更自然 camelCase) 或配 newIsCapExceptionPattern 全局放行.
    // eslint-disable-next-line new-cap
    const socket = new wsWebSocket(url, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    this.socket = socket;

    this.connected = createDeferred();
    this.started = createDeferred();

    socket.on('message', (data: wsWebSocket.RawData) => {
      this.handleIncoming(data);
    });
    socket.on('error', (error: Error) => {
      this.handleSocketError(error);
    });
    socket.on('close', (code: number, reason: Buffer) => {
      this.handleSocketClose(code, reason.toString('utf8'));
    });

    await this.awaitWithTimeout(this.connected.promise, 'connected_success');
    this.sendTaskStart();
    await this.awaitWithTimeout(this.started.promise, 'task_started');

    this.state = 'streaming';
    this.startKeepalive();
    this.logger.log(`[connected] url=${url} model=${this.model} voice=${this.voiceId} tenant=${this.opts.tenantId}`);
  }

  /**
   * 流式推送文本 (LLM 增量 token).
   *
   * 内部按标点切句, 一句一条 `task_continue` 下发 (与上游的切句天然对齐, 字幕不错位).
   *
   * @param text 增量文本
   */
  sendText(text: string): void {
    if (!text) return;
    this.charCount += text.length;
    if (this.state !== 'streaming') {
      this.logger.warn(`[send_text_ignored] state=${this.state}`);
      return;
    }
    this.residualText += text;
    const { sentences, rest } = splitSentences(this.residualText, this.maxSentenceChars);
    this.residualText = rest;
    for (const sentence of sentences) {
      this.sendSentence(sentence);
    }
  }

  /**
   * 正常结束 — 冲刷残句后发 `task_finish`.
   *
   * 尾句 (无标点) 会被先作为一条 `task_continue` 发出去, 再 `task_finish`,
   * 保证"最后半句"不丢 (spec §3.4).
   */
  finish(): void {
    if (this.state !== 'streaming') return;
    // 纯空白残留官方会**静默丢弃**, 这里直接不发, 省一次无谓往返
    if (this.residualText.trim().length > 0) {
      const residual = this.residualText;
      this.residualText = '';
      this.sendSentence(residual);
    }
    this.logger.log(`[finish] chars=${this.charCount}`);
    this.sendJson({ event: 'task_finish' });
  }

  /**
   * 催出残留文本 (多轮复用同一连接时用) — `task_flush`.
   *
   * 与 `finish()` 的区别: flush **不关连接**, 可以在同一轮里多次催.
   */
  flush(): void {
    if (this.state !== 'streaming') return;
    if (this.residualText.trim().length > 0) {
      const residual = this.residualText;
      this.residualText = '';
      this.sendSentence(residual);
    }
    // 注意: flush 后**不关连接** —— 它的用途就是"同一轮里催出没标点的尾句, 接着还能继续喂文本"
    this.sendJson({ event: 'task_flush' });
  }

  /**
   * 打断 — 协议级 `task_cancel`, 不等 in-flight 音频.
   *
   * 官方语义: 已下发给前端的音频**不撤回**, 由前端本地停播丢弃; 后端只保证不再下发新帧.
   */
  cancel(): void {
    if (this.state !== 'streaming') {
      this.terminate();
      return;
    }
    this.logger.log('[cancel]');
    this.sendJson({ event: 'task_cancel' });
    // 上游不响应 task_canceled 时也要断开, 否则连接会一直挂在池里
    this.scheduleCloseAfter(CANCEL_GRACE_MS);
  }

  /**
   * 强制关闭 (池释放时调) — 不发 task_finish.
   */
  close(): void {
    this.terminate();
  }

  /**
   * 事件流 (句级 mp3).
   */
  [Symbol.asyncIterator](): AsyncIterator<TtsEvent> {
    return this.events[Symbol.asyncIterator]();
  }

  // ── private ────────────────────────────────────────────────────

  /**
   * 下发一句文本.
   *
   * @param sentence 完整句
   */
  private sendSentence(sentence: string): void {
    if (sentence.length === 0) return;
    this.pendingSentences.push(sentence);
    this.lastSentSentence = sentence;
    this.sendJson({ event: 'task_continue', text: sentence });
  }

  /**
   * 发送 `task_start`.
   */
  private sendTaskStart(): void {
    this.sendJson({
      event: 'task_start',
      model: this.model,
      language_boost: this.languageBoost,
      voice_setting: {
        voice_id: this.voiceId,
        speed: this.speed,
        vol: this.volume,
        pitch: this.pitch,
      },
      audio_setting: {
        sample_rate: this.sampleRate,
        bitrate: this.bitrate,
        format: 'mp3',
        channel: 1,
      },
      session_id: this.opts.sessionId,
    });
  }

  /**
   * 发送一帧 JSON.
   *
   * @param event 客户端事件
   */
  private sendJson(event: TtsBidiClientEvent): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== wsWebSocket.OPEN) {
      this.logger.warn(`[send_dropped] event=${event.event} readyState=${socket?.readyState ?? 'none'}`);
      return;
    }
    socket.send(JSON.stringify(event));
  }

  /**
   * 接收上游帧 (官方只发 JSON 文本帧; 这里仍兼容二进制载荷, 直接当 UTF-8 解析).
   *
   * @param data 原始帧
   */
  private handleIncoming(data: wsWebSocket.RawData): void {
    const text = typeof data === 'string' ? data : data.toString('utf8');
    let parsed: TtsBidiServerEvent;
    try {
      parsed = JSON.parse(text) as TtsBidiServerEvent;
    } catch {
      this.logger.warn(`[parse_error] ${text.slice(0, 120)}`);
      return;
    }
    this.handleServerEvent(parsed);
  }

  /**
   * 处理上游事件.
   *
   * 拆成"生命周期 / 流式数据"两个子方法: 官方有 10 种事件, 单个 switch 的
   * complexity 直接顶到 22 (> eslint 上限 20) —— 拆开后每个方法都在 10 以内,
   * 且**按语义分组**比"为了压复杂度而乱拆"好读.
   *
   * @param event 上游事件
   */
  private handleServerEvent(event: TtsBidiServerEvent): void {
    if (this.handleLifecycleEvent(event)) {
      return;
    }
    this.handleStreamEvent(event);
  }

  /**
   * 生命周期类事件 (握手 / 催句 / 打断确认 / 失败).
   *
   * @param event 上游事件
   * @returns true = 已处理
   */
  private handleLifecycleEvent(event: TtsBidiServerEvent): boolean {
    switch (event.event) {
      case 'connected_success':
        this.connected?.resolve();
        return true;
      case 'task_started':
        this.started?.resolve();
        return true;
      case 'task_flushed':
        this.logger.log('[task_flushed]');
        return true;
      case 'task_canceled':
        this.logger.log('[task_canceled]');
        this.terminate();
        return true;
      // 官方把"任务失败"与"通用错误"分成两个事件, 但对本项目是同一件事: 归一后抛 error.
      // 合并成一个 case (而不是写两段一模一样的分支) —— sonarjs/no-duplicated-branches.
      case 'task_failed':
      case 'error':
        this.handleTaskFailed(event.base_resp?.status_code ?? TTS_STATUS.UNKNOWN, event.base_resp?.status_msg);
        return true;
      default:
        return false;
    }
  }

  /**
   * 流式数据事件 (句子边界 / 音频分片 / 收尾).
   *
   * @param event 上游事件
   */
  private handleStreamEvent(event: TtsBidiServerEvent): void {
    switch (event.event) {
      case 'sentence_start':
        this.handleSentenceStart();
        return;
      case 'task_continued':
        this.handleTaskContinued(event.data?.audio, event.extra_info?.usage_characters);
        return;
      case 'sentence_end':
        this.handleSentenceEnd();
        return;
      case 'task_finished':
        this.handleTaskFinished(event.extra_info?.usage_characters);
        return;
      default:
        this.logger.warn(`[unknown_event] ${JSON.stringify(event).slice(0, 120)}`);
    }
  }

  /**
   * 一句开始 — 绑定该句的文本.
   *
   * 官方 `sentence_start` **没有 data 段** (只有 session_id/connect_id/event/trace_id/base_resp),
   * 所以句文本只能由本端自己的切句队列按序提供 —— 这也正是"本端自己切句"的意义:
   * 第 N 个 sentence_start 严格对应第 N 个我们切出来的句子, 字幕不会错位.
   */
  private handleSentenceStart(): void {
    this.currentSeq += 1;
    this.currentText = this.pendingSentences.shift() ?? '';
    this.audioChunks = [];
    this.events.push({ type: 'sentence_start', seq: this.currentSeq, text: this.currentText });
  }

  /**
   * 收到音频分片 (hex mp3) — 入当前句缓冲.
   *
   * @param audio hex 字符串
   * @param usageCharacters 上游累计字符数
   */
  private handleTaskContinued(audio: string | undefined, usageCharacters: number | undefined): void {
    if (usageCharacters !== undefined && usageCharacters > this.usageCharacters) {
      this.usageCharacters = usageCharacters;
    }
    if (!audio) return;
    const chunk = Buffer.from(audio, 'hex');
    if (chunk.length === 0) {
      this.logger.warn('[audio_empty_hex]');
      return;
    }
    this.audioChunks.push(chunk);
  }

  /**
   * 一句结束 — 攒齐的音频拼成**整句 mp3** 交付.
   *
   * 三层结束语义不要混用 (官方明确): `is_final` = 本次请求的音频结束,
   * `sentence_end` = 当前句结束, `task_finished` = 整个会话结束.
   */
  private handleSentenceEnd(): void {
    const seq = this.currentSeq;
    const text = this.currentText;
    const audio = this.audioChunks.length > 0 ? Buffer.concat(this.audioChunks) : Buffer.alloc(0);
    this.audioChunks = [];
    this.currentText = '';

    if (audio.length === 0) {
      // 上游只给了句边界没给音频: 不伪造空音频帧, 只放行句子边界
      this.logger.warn(`[sentence_without_audio] seq=${seq}`);
      this.events.push({ type: 'sentence_end', seq });
      return;
    }
    // 顺序是契约: sentence_audio 必须**先于** sentence_end (前端按 seq 排队播, 收到 end 才知道这句收完)
    this.events.push({ type: 'sentence_audio', seq, text, mime: 'audio/mp3', data: audio }, { type: 'sentence_end', seq });
  }

  /**
   * 本轮合成结束.
   *
   * @param usageCharacters 上游字符用量
   */
  private handleTaskFinished(usageCharacters: number | undefined): void {
    if (usageCharacters !== undefined && usageCharacters > this.usageCharacters) {
      this.usageCharacters = usageCharacters;
    }
    this.events.push({ type: 'done', usage: { characters: this.usageCharacters || this.charCount } });
    this.events.close();
    this.terminate();
  }

  /**
   * 上游失败 — 归一后交付错误事件.
   *
   * @param statusCode 上游状态码
   * @param statusMessage 上游描述
   */
  private handleTaskFailed(statusCode: number, statusMessage: string | undefined): void {
    // 2205: 排队文本过多 —— 不重连、不重发 task_start, 退避后重发最后一条即可
    if (statusCode === TTS_STATUS.QUEUE_OVERFLOW && this.retryQueueOverflow()) {
      return;
    }
    const error = mapTtsUpstreamError(statusCode, statusMessage);
    this.logger.warn(`[task_failed] code=${error.code} upstream=${statusCode} msg=${error.message}`);
    this.events.push({ type: 'error', error });
    this.events.close();
    this.terminate();
  }

  /**
   * 2205 队列溢出重试.
   *
   * @returns true = 已安排重发 (调用方不要再报错)
   */
  private retryQueueOverflow(): boolean {
    const sentence = this.lastSentSentence;
    if (!sentence || this.queueOverflowRetries >= 2 || this.state !== 'streaming') {
      return false;
    }
    this.queueOverflowRetries += 1;
    const delayMs = 500 * this.queueOverflowRetries;
    this.logger.warn(`[queue_overflow_retry] attempt=${this.queueOverflowRetries} delay_ms=${delayMs}`);
    setTimeout(() => {
      if (this.state !== 'streaming') return;
      this.sendSentence(sentence);
    }, delayMs);
    return true;
  }

  /**
   * socket 错误.
   *
   * @param error 错误
   */
  private handleSocketError(error: Error): void {
    this.logger.warn(`[ws_error] ${error.message}`);
    this.connected?.reject(error);
    this.started?.reject(error);
    if (this.state === 'streaming') {
      this.events.push({
        type: 'error',
        error: { code: 'tts_ws_error', message: error.message.slice(0, 300), retryable: true },
      });
      this.events.close();
    }
    this.terminate();
  }

  /**
   * socket 关闭.
   *
   * @param code 关闭码
   * @param reason 关闭原因
   */
  private handleSocketClose(code: number, reason: string): void {
    this.logger.log(`[closed] code=${code} reason=${reason.slice(0, 120)}`);
    this.connected?.reject(new Error(`TTS 连接被关闭 (code=${code})`));
    this.started?.reject(new Error(`TTS 连接被关闭 (code=${code})`));
    if (this.state === 'streaming') {
      // 还没收到 done 就被关闭: 本轮音频不完整 —— 如实上报, 不伪造成功
      this.events.push({
        type: 'error',
        error: {
          code: code === 1006 ? 'tts_connection_lost' : 'tts_connection_closed',
          message: `TTS 连接提前关闭 (code=${code}) ${reason}`.slice(0, 300),
          retryable: true,
        },
      });
    }
    this.events.close();
    this.state = 'closed';
    this.onClosed?.();
  }

  /**
   * 断开 socket 并清理定时器.
   */
  private terminate(): void {
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    this.state = 'closed';
    if (socket && socket.readyState !== wsWebSocket.CLOSED) {
      socket.close();
    }
    this.events.close();
    this.onClosed?.();
  }

  /**
   * 定时强制关闭 (打断/冲刷宽限期到点).
   *
   * @param delayMs 延迟毫秒
   */
  private scheduleCloseAfter(delayMs: number): void {
    if (this.cancelTimer) return;
    this.cancelTimer = setTimeout(() => {
      this.cancelTimer = null;
      this.terminate();
    }, delayMs);
    this.cancelTimer.unref?.();
  }

  /**
   * 启动保活 ping.
   *
   * 官方**不主动** ping, 上游按 120s 空闲断开 (2201). 本端发 ping 只是为了在长静默期
   * 尽量不被动断开; 断开了按可重连处理.
   */
  private startKeepalive(): void {
    if (this.keepaliveMs <= 0) return;
    this.keepaliveTimer = setInterval(() => {
      const socket = this.socket;
      if (socket && socket.readyState === wsWebSocket.OPEN) {
        socket.ping();
      }
    }, this.keepaliveMs);
    this.keepaliveTimer.unref?.();
  }

  /**
   * 清理定时器.
   */
  private clearTimers(): void {
    if (this.cancelTimer) {
      clearTimeout(this.cancelTimer);
      this.cancelTimer = null;
    }
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  /**
   * 给 promise 加超时.
   *
   * @param promise 原始 promise
   * @param label 超时标签 (日志用)
   */
  private async awaitWithTimeout(promise: Promise<void>, label: string): Promise<void> {
    let timer: NodeJS.Timeout | null = null;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`TtsBidiClient: 等待 ${label} 超时 (${this.connectTimeoutMs}ms)`));
      }, this.connectTimeoutMs);
      timer.unref?.();
    });
    try {
      await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * 校验模型名 — 官方枚举外的模型名必然换来 2013, 不如启动即失败.
   *
   * @param raw 候选模型名
   * @returns 合法模型名
   */
  private resolveModel(raw: string | undefined): string {
    const candidate = raw && raw.length > 0 ? raw : TTS_DEFAULT_MODEL;
    if (!isSupportedTtsModel(candidate)) {
      throw new Error(`TtsBidiClient: 不支持的 TTS 模型 ${candidate} (官方枚举: speech-2.8-turbo 等)`);
    }
    return candidate;
  }

  /**
   * 校验采样率 — 官方枚举外的采样率必然换来 2013.
   *
   * @param raw 候选采样率
   * @returns 合法采样率
   */
  private resolveSampleRate(raw: number): number {
    if ((TTS_SUPPORTED_SAMPLE_RATES as readonly number[]).includes(raw)) {
      return raw;
    }
    this.logger.warn(`[sample_rate_invalid] ${raw} → 32000`);
    return 32_000;
  }

  /**
   * 校验码率 — 官方枚举 (32000/64000/128000/256000) 外的值必然换来 2013.
   *
   * @param raw 候选码率
   * @returns 合法码率
   */
  private resolveBitrate(raw: number): number {
    if ((TTS_SUPPORTED_BITRATES as readonly number[]).includes(raw)) {
      return raw;
    }
    this.logger.warn(`[bitrate_invalid] ${raw} → 128000`);
    return 128_000;
  }
}
