/**
 * 豆包 Seed TTS 2.0 双向流式客户端 — TtsSessionHandle 的豆包适配器.
 *
 * 职责边界:
 * - 只做 WS 生命周期、二进制帧、句级 mp3 聚合、事件转换;
 * - 不做会员/档位决策 (TtsProfileResolver 已完成);
 * - 不做连接池 (Max 场次低频, 先一场一条连接, 后续需要再池化).
 *
 * 事件映射:
 *   TTSSentenceStart -> 记下 seq/文本
 *   TTSResponse      -> 累积 mp3 分片
 *   TTSSentenceEnd   -> sentence_start + sentence_audio + sentence_end
 *   SessionFinished  -> done
 *   SessionFailed / ConnectionFailed / Error 帧 -> error
 */

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import wsWebSocket from 'ws';

import { AsyncEventQueue } from './async-event-queue.js';
import {
  buildDoubaoFrame,
  DOUBAO_EVENT,
  DOUBAO_MSG_TYPE_AUDIO_ONLY,
  DOUBAO_MSG_TYPE_FULL_CLIENT,
  DOUBAO_MSG_TYPE_FULL_SERVER,
  DOUBAO_SERIALIZATION_JSON,
  parseDoubaoFrame,
  type DoubaoParsedFrame,
} from './doubao-tts-protocol.js';
import type { ResolvedTtsProfile } from './runtime/tts-profile.types.js';
import { mapTtsUpstreamError } from './tts-error.mapper.js';
import { splitSentences } from './tts-sentence-splitter.js';
import type { TtsEvent, TtsOptions, TtsSessionHandle, TtsUsage } from './tts.types.js';

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: Error) => void;
}

/** 本地上限: StartSession 等待 SessionStarted 的独立超时. */
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_SENTENCE_CHARS = 200;

function createDeferred<T>(): Deferred<T> {
  let resolveFn: (value: T) => void = () => {};
  let rejectFn: (error: Error) => void = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  return { promise, resolve: resolveFn, reject: rejectFn };
}

/** 取第一个非空字符串; 空串/undefined 跳过. */
function pickNonEmpty(...values: (string | undefined)[]): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed !== undefined && trimmed.length > 0) return trimmed;
  }
  return '';
}

/** 把 ws RawData 归一成 Buffer (ws 可能给 Buffer / ArrayBuffer / Buffer[]). */
function toBuffer(data: wsWebSocket.RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

/** 从 JSON payload 中安全取字符串字段. */
function readString(value: unknown, keys: readonly string[]): string {
  if (typeof value !== 'object' || value === null) return '';
  for (const key of keys) {
    const field = (value as Record<string, unknown>)[key];
    if (typeof field === 'string') return field;
  }
  return '';
}

/** 从 JSON payload 中安全取数字字段. */
function readNumber(value: unknown, keys: readonly string[]): number | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  for (const key of keys) {
    const field = (value as Record<string, unknown>)[key];
    if (typeof field === 'number' && Number.isFinite(field)) return field;
  }
  return undefined;
}

/** 把速率 0.5~2.0 映射到豆包 speech_rate (-50~100). */
function toSpeechRate(speed: number | undefined): number | undefined {
  if (speed === undefined || !Number.isFinite(speed)) return undefined;
  return Math.max(-50, Math.min(100, Math.round((speed - 1) * 100)));
}

/** 把音量 0.5~2.0 映射到豆包 loudness_rate (-50~100). */
function toLoudnessRate(volume: number | undefined): number | undefined {
  if (volume === undefined || !Number.isFinite(volume)) return undefined;
  return Math.max(-50, Math.min(100, Math.round((volume - 1) * 100)));
}

export class DoubaoTtsClient implements TtsSessionHandle, AsyncIterable<TtsEvent> {
  readonly sessionId: string;
  readonly events: AsyncIterable<TtsEvent>;

  private readonly logger: Logger;
  private readonly profile: ResolvedTtsProfile;
  private readonly config: ConfigService;
  private readonly queue = new AsyncEventQueue<TtsEvent>();
  private readonly wsUrl: string;
  private readonly apiKey: string;
  private readonly resourceId: string;
  private readonly voiceId: string;
  private readonly timeoutMs: number;
  private readonly maxTextChars: number;
  private readonly speed?: number;
  private readonly volume?: number;

  private socket: wsWebSocket | null = null;
  private state: 'idle' | 'connecting' | 'streaming' | 'finished' | 'failed' | 'closed' = 'idle';
  private sessionStarted: Deferred<void> | null = null;
  private sessionFinished: Deferred<void> | null = null;
  private sessionCanceled: Deferred<void> | null = null;
  private residualText = '';
  private seq = 0;
  private sentenceStarted = false;
  private currentText = '';
  private currentSeq = 0;
  private audioChunks: Buffer[] = [];
  private usageChars = 0;
  private closed = false;
  private disposeRequested = false;

  constructor(config: ConfigService, opts: TtsOptions, profile: ResolvedTtsProfile) {
    this.config = config;
    this.profile = profile;
    this.sessionId = opts.sessionId;
    this.events = this.queue;
    this.logger = new Logger(`${DoubaoTtsClient.name}:${opts.sessionId}`);

    this.wsUrl = profile.baseUrl;
    this.apiKey = this.resolveApiKey();
    this.resourceId = pickNonEmpty(config.get<string>('doubao.ttsResourceId'), 'seed-tts-2.0');
    this.voiceId = profile.voiceId;
    this.timeoutMs = config.get<number>('doubao.ttsTimeoutMs') ?? DEFAULT_TIMEOUT_MS;
    this.maxTextChars = Math.max(40, config.get<number>('doubao.ttsMaxTextChars') ?? MAX_SENTENCE_CHARS);
    this.speed = opts.delivery?.speed;
    this.volume = opts.delivery?.volume;
  }

  /**
   * 建立连接并完成 StartConnection + StartSession 握手.
   *
   * @throws 配置缺失 / 上游握手失败 / 超时
   */
  async start(): Promise<void> {
    if (this.state !== 'idle') throw new Error(`DoubaoTtsClient: 状态非法 (${this.state})`);
    if (this.voiceId.length === 0) throw new Error('DoubaoTtsClient: 未配置音色 (profile.voiceId 为空)');
    if (this.apiKey.length === 0) throw new Error('DoubaoTtsClient: 未配置 DOUBAO_TTS_API_KEY / ARK_AGENT_PLAN_API_KEY');

    this.state = 'connecting';
    this.sessionStarted = createDeferred<void>();

    // eslint-disable-next-line new-cap
    const socket = new wsWebSocket(this.wsUrl, {
      headers: {
        'X-Api-Key': this.apiKey,
        'X-Api-Resource-Id': this.resourceId,
        'X-Api-Connect-Id': randomUUID(),
        'X-Control-Require-Usage-Tokens-Return': '*',
      },
    });
    this.socket = socket;

    socket.on('message', (data: wsWebSocket.RawData) => this.handleMessage(data));
    socket.on('open', () => {
      try {
        socket.send(
          buildDoubaoFrame({
            messageType: DOUBAO_MSG_TYPE_FULL_CLIENT,
            event: DOUBAO_EVENT.StartConnection,
            serialization: DOUBAO_SERIALIZATION_JSON,
            payload: '{}',
          }),
        );
      } catch (err) {
        this.fail(`豆包 StartConnection 发送失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
    socket.on('error', (error: Error) => this.fail(error.message));
    socket.on('close', (code: number, reason: Buffer) => this.handleClose(code, reason.toString('utf8')));

    await this.awaitWithTimeout(this.waitConnectionStarted(), 'connection_started');
    this.sendJson(DOUBAO_EVENT.StartSession, {
      event: DOUBAO_EVENT.StartSession,
      req_params: {
        speaker: this.voiceId,
        audio_params: {
          format: this.profile.audio.format,
          sample_rate: this.profile.audio.sampleRate,
          ...(toSpeechRate(this.speed) === undefined ? {} : { speech_rate: toSpeechRate(this.speed) }),
          ...(toLoudnessRate(this.volume) === undefined ? {} : { loudness_rate: toLoudnessRate(this.volume) }),
        },
      },
    });
    await this.awaitWithTimeout(this.sessionStarted.promise, 'session_started');
    this.state = 'streaming';
    this.logger.log(`[connected] url=${this.wsUrl} voice=${this.voiceId} tier=${this.profile.accessTier}`);
  }

  /** 流式喂文本; 内部按句切分, 降低单次 TaskRequest 文本过长风险. */
  sendText(text: string): void {
    if (!text || this.state !== 'streaming') return;
    this.residualText += text;
    const { sentences, rest } = splitSentences(this.residualText, this.maxTextChars);
    this.residualText = rest;
    for (const sentence of sentences) this.sendSentence(sentence);
  }

  /** 正常结束: 冲刷残句 -> FinishSession -> 等 SessionFinished. */
  finish(): void {
    if (this.state !== 'streaming') return;
    const residual = this.residualText;
    this.residualText = '';
    if (residual.trim().length > 0) this.sendSentence(residual);
    this.sessionFinished = createDeferred<void>();
    this.sendJson(DOUBAO_EVENT.FinishSession, { event: DOUBAO_EVENT.FinishSession });
    this.logger.log(`[finish] chars=${this.usageChars}`);
  }

  /** 打断: 发 CancelSession, 不阻塞调用方. */
  cancel(): void {
    if (this.state !== 'streaming') return;
    this.sessionCanceled = createDeferred<void>();
    this.sendJson(DOUBAO_EVENT.CancelSession, { event: DOUBAO_EVENT.CancelSession });
    // 取消后上游可能不回包; 2s 后主动断开, 保证本轮一定收口.
    setTimeout(() => {
      if (this.state === 'streaming') this.close();
    }, 2000).unref();
  }

  /** 幂等释放连接; 不产生 error 事件. */
  dispose(): void {
    this.disposeRequested = true;
    this.close();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<TtsEvent> {
    for await (const event of this.queue) yield event;
  }

  // ── 内部 ──────────────────────────────────────────────────────

  private resolveApiKey(): string {
    // 语音 plan 端点不认 chat key; 只读专用 ttsApiKey, 缺了就让档位决策层提前回退.
    return this.config.get<string>('doubao.ttsApiKey')?.trim() ?? '';
  }

  private sendSentence(sentence: string): void {
    const text = sentence.trim();
    if (text.length === 0) return;
    this.sendJson(DOUBAO_EVENT.TaskRequest, {
      event: DOUBAO_EVENT.TaskRequest,
      req_params: { text },
    });
  }

  private sendJson(event: number, body: unknown): void {
    if (!this.socket || this.socket.readyState !== wsWebSocket.OPEN) {
      throw new Error('DoubaoTtsClient: socket 未连接');
    }
    this.socket.send(
      buildDoubaoFrame({
        messageType: DOUBAO_MSG_TYPE_FULL_CLIENT,
        event,
        serialization: DOUBAO_SERIALIZATION_JSON,
        sessionId: event === DOUBAO_EVENT.StartConnection || event === DOUBAO_EVENT.FinishConnection ? undefined : this.sessionId,
        payload: JSON.stringify(body),
      }),
    );
  }

  private waitConnectionStarted(): Promise<void> {
    // ConnectionStarted 事件没有独立 deferred; 这里用一次性 Promise + 超时.
    if (this.connectionStarted) return this.connectionStarted.promise;
    this.connectionStarted = createDeferred<void>();
    return this.connectionStarted.promise;
  }

  private connectionStarted: Deferred<void> | null = null;

  private handleMessage(data: wsWebSocket.RawData): void {
    let frame: DoubaoParsedFrame;
    try {
      frame = parseDoubaoFrame(toBuffer(data));
    } catch (err) {
      this.fail(`豆包 TTS 帧解析失败: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    this.handleFrame(frame);
  }

  private handleFrame(frame: DoubaoParsedFrame): void {
    if (frame.kind === 'error') {
      const message = pickNonEmpty(readString(frame.json, ['message', 'error', 'msg']), `豆包错误帧 ${frame.errorCode ?? 'unknown'}`);
      this.fail(message, frame.errorCode ?? 0);
      return;
    }
    if (this.handleLifecycleEvent(frame)) return;
    if (this.handleSentenceEvent(frame)) return;
    if (frame.messageType === DOUBAO_MSG_TYPE_FULL_SERVER || frame.messageType === DOUBAO_MSG_TYPE_AUDIO_ONLY) {
      this.logger.warn(`[doubao_unhandled_event] event=${frame.event} kind=${frame.kind}`);
    }
  }

  /** 连接/会话生命周期事件; 返回 true 表示已处理. */
  private handleLifecycleEvent(frame: DoubaoParsedFrame): boolean {
    switch (frame.event) {
      case DOUBAO_EVENT.ConnectionStarted:
        this.connectionStarted?.resolve();
        return true;
      case DOUBAO_EVENT.ConnectionFailed:
        this.fail(pickNonEmpty(readString(frame.json, ['message', 'error']), '豆包连接失败'), readNumber(frame.json, ['code']) ?? 0);
        return true;
      case DOUBAO_EVENT.SessionStarted:
        this.sessionStarted?.resolve();
        return true;
      case DOUBAO_EVENT.SessionFailed:
        this.handleSessionFailed(frame);
        return true;
      case DOUBAO_EVENT.SessionFinished:
        this.handleSessionFinished(frame);
        return true;
      case DOUBAO_EVENT.SessionCanceled:
        this.sessionCanceled?.resolve();
        this.state = 'finished';
        this.close();
        return true;
      default:
        return false;
    }
  }

  /** 句级事件; 返回 true 表示已处理. */
  private handleSentenceEvent(frame: DoubaoParsedFrame): boolean {
    switch (frame.event) {
      case DOUBAO_EVENT.TTSSentenceStart:
        this.beginSentence(readString(frame.json, ['text', 'sentence']));
        return true;
      case DOUBAO_EVENT.TTSResponse:
        if (frame.payload.length > 0) this.audioChunks.push(Buffer.from(frame.payload));
        return true;
      case DOUBAO_EVENT.TTSSentenceEnd:
        this.endSentence(readString(frame.json, ['text', 'sentence']));
        return true;
      default:
        return false;
    }
  }

  private handleSessionFailed(frame: DoubaoParsedFrame): void {
    const payload = frame.json as { error?: { code?: number; message?: string }; message?: string } | undefined;
    this.fail(pickNonEmpty(payload?.error?.message, payload?.message, '豆包会话失败'), payload?.error?.code ?? 0);
  }

  private handleSessionFinished(frame: DoubaoParsedFrame): void {
    const usage = (frame.json as { usage?: { text_words?: number } } | undefined)?.usage;
    this.usageChars = usage?.text_words ?? this.usageChars;
    this.sessionFinished?.resolve();
    this.pushDone(this.usageChars);
    this.state = 'finished';
    this.close();
  }

  private beginSentence(text: string): void {
    this.seq += 1;
    this.currentSeq = this.seq;
    this.currentText = text.trim();
    this.sentenceStarted = false;
    this.audioChunks = [];
    if (this.currentText.length > 0) {
      this.queue.push({ type: 'sentence_start', seq: this.currentSeq, text: this.currentText });
      this.sentenceStarted = true;
    }
  }

  private endSentence(text: string): void {
    const display = (text.trim() || this.currentText).trim();
    if (!this.sentenceStarted) {
      this.queue.push({ type: 'sentence_start', seq: this.currentSeq, text: display });
      this.sentenceStarted = true;
    }
    const audio = Buffer.concat(this.audioChunks);
    this.audioChunks = [];
    if (audio.length > 0) {
      this.queue.push({
        type: 'sentence_audio',
        seq: this.currentSeq,
        text: display,
        mime: this.profile.audio.mime,
        data: audio,
      });
    }
    this.queue.push({ type: 'sentence_end', seq: this.currentSeq });
    this.usageChars += display.length;
  }

  private pushDone(characters: number): void {
    const usage: TtsUsage = { characters };
    this.queue.push({ type: 'done', usage });
  }

  private fail(message: string, upstreamStatus = 0): void {
    if (this.state === 'failed' || this.state === 'finished' || this.state === 'closed') return;
    this.state = 'failed';
    const error =
      upstreamStatus > 0
        ? mapTtsUpstreamError(upstreamStatus, message)
        : { code: 'tts_upstream_error', message: message.slice(0, 300), retryable: true };
    this.queue.push({ type: 'error', error });
    this.sessionStarted?.reject(new Error(message));
    this.sessionFinished?.reject(new Error(message));
    this.connectionStarted?.reject(new Error(message));
    this.queue.close();
    this.close();
  }

  private handleClose(code: number, reason: string): void {
    if (this.state === 'closed') return;
    const message = `豆包 TTS 连接关闭 code=${code} reason=${reason || 'unknown'}`;
    if (this.state !== 'finished' && !this.disposeRequested) {
      this.fail(message);
    } else {
      this.state = 'closed';
      this.queue.close();
    }
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    this.state = 'closed';
    if (this.socket) {
      this.socket.removeAllListeners();
      try {
        this.socket.close();
      } catch {
        // 已关闭的 socket 忽略.
      }
      this.socket = null;
    }
    this.queue.close();
  }

  private async awaitWithTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
    const timeout = new Promise<never>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`DoubaoTtsClient: ${label} 超时 ${this.timeoutMs}ms`)), this.timeoutMs);
      timer.unref();
      void resolve;
    });
    return Promise.race([promise, timeout]);
  }
}
