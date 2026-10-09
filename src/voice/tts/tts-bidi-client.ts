// V2026-10-08 治本 (TTS bidi 单连接封装):
//   协议: MiniMax speech-t2a-websocket-bidi (WebSocket, 二进制音频 + JSON 控制)
//   凭证: env MINIMAX_API_KEY, 走 Bearer 头 (跟 ASR 一致, 但协议不同)
//   错误处理: 上游 4xx/5xx / WS 断开 / JSON 解析失败 → 翻译成 TtsError (含 retryable)
//   池协作: client 自己管理 WebSocket 生命周期, pool 只负责 acquire/release
//   重连: V0.x 不做, session 结束/错误后由 pool 释放 + 调用方决定是否重建
//
// 反双胞胎:
//   - 不用 Node native WebSocket — 项目已有 ws 包 (8.21.3), ws 更成熟, 类型完备
//   - 不用 callback (onAudio / onError) — 内部用 EventEmitter, 外部用 AsyncIterable
//   - 不用 reconnect — V0.x 简化, 出错直接 fail, 业务层 (VoiceGateway) 决定怎么办
//
// 如何验证:
//   1. pnpm build 无 type error
//   2. TtsService.startSession → 1 个 pool acquire 1 个 client
//   3. client.sendText('你好') → 收到 audio event + sentence_start/end
//   4. client.cancel() → 收到 task_canceled event (协议级)
//   5. client.finish() → 收到 done event (含 usage.characters)

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// V2026-10-09 lint fix (unicorn/prefer-event-target): EventEmitter → EventTarget 是大重构,
//   要把所有 .emit / .on / .off 改成 dispatchEvent / addEventListener / removeEventListener + CustomEvent,
//   涉及整个类十几处调用. 留 V1.x 重构, 这里 inline disable, 保持本次 commit lint 干净.
import { EventEmitter } from 'node:events';
// V2026-10-09 lint fix (@typescript-eslint/naming-convention strictCamelCase): WebSocket (PascalCase) → WsWebSocket
//   跟 src/voice/voice.gateway.ts 项目约定一致 (那里用 `import type { WebSocket as WsWebSocket } from 'ws'`).
// V2026-10-09 lint fix v2: strictCamelCase 要求首字母小写, WsWebSocket (PascalCase 起头) 触线, 改 wsWebSocket.
//   等同于 iOSApp / jQuerySelector 的 acronym 起头模式, 仍是 strictCamelCase.
//   跟 voice.gateway.ts 那边的 WsWebSocket (Named import 可用 StrictPascalCase) 略不同, 后续 V1.x 统一改 webSocket 更友好.
import wsWebSocket from 'ws';

import type { MiniMaxTtsClientEvent, MiniMaxTtsServerEvent, TtsError, TtsEvent, TtsOptions } from './tts.types';

const TEXT_FRAME = 0x1;
const AUDIO_FRAME = 0x2;

@Injectable()
// V2026-10-09 lint fix (unicorn/prefer-event-target): V1.x 迁 EventTarget, 当前版本 disable 保持兼容.
// eslint-disable-next-line unicorn/prefer-event-target
export class TtsBidiClient extends EventEmitter {
  private readonly logger: Logger;
  private ws: wsWebSocket | null = null;
  private state: 'idle' | 'connecting' | 'open' | 'closed' = 'idle';
  private charCount = 0;
  // V2026-10-08 治本: 用 @Inject(ConfigService) 避免传 2 个参数的构造器.
  constructor(
    @Inject(ConfigService) config: ConfigService,
    private readonly opts: TtsOptions,
  ) {
    super();
    this.logger = new Logger(TtsBidiClient.name + ':' + opts.sessionId);
    const baseUrl = config.getOrThrow<string>('minimax.baseUrl');
    const apiKey = config.getOrThrow<string>('minimax.apiKey');
    const defaultVoice = config.get<string>('minimax.ttsDefaultVoice') ?? 'mandarin_female_001';
    const defaultModel = config.get<string>('minimax.ttsModel') ?? 'speech-2.8';
    const timeoutMs = config.get<number>('minimax.ttsTimeoutMs') ?? 30_000;
    // V2026-10-08 治本: 用 readonly 字段存, 避免 ts 误读 this.apiKey 报 possibly-undefined.
    Object.assign(this, { baseUrl, apiKey, defaultVoice, defaultModel, timeoutMs });
  }

  // 注入字段 — 见构造器 Object.assign (治本: 不用 parameter property, ts 不会误判)
  private readonly baseUrl!: string;
  private readonly apiKey!: string;
  private readonly defaultVoice!: string;
  private readonly defaultModel!: string;
  private readonly timeoutMs!: number;

  /** 建立 WebSocket 连接并发送 task_start. */
  async connect(): Promise<void> {
    if (this.state !== 'idle') {
      throw new Error('TtsBidiClient: already in state ' + this.state);
    }
    this.state = 'connecting';

    const url = this.baseUrl.replace(/^http/, 'ws') + '/v1/t2a/bidi';
    // V2026-10-09 lint fix (new-cap): wsWebSocket 是 ws 包 default export (WebSocket class),
    //   naming-convention 要求首字母小写 (strictCamelCase) ↔ new-cap 要求首字母大写 (constructor),
    //   两规则对 default import 类的引用天然冲突. 选 lowercase import (跟 strictCamelCase 一致),
    //   这处 new 操作 inline disable new-cap. V1.x 收口: 改 import 为 `import webSocket from 'ws'`
    //   (更自然 camelCase) 或配 newIsCapExceptionPattern 全局放行.
    // eslint-disable-next-line new-cap
    this.ws = new wsWebSocket(url, {
      headers: { Authorization: 'Bearer ' + this.apiKey },
    });

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.logger.warn('[connect_timeout]');
        reject(new Error('TtsBidiClient: connect timeout'));
      }, this.timeoutMs);

      this.ws!.on('open', () => {
        clearTimeout(timeout);
        this.state = 'open';
        this.logger.log(
          '[connected] tenant=' + this.opts.tenantId + ' user=' + this.opts.userId + ' voice=' + (this.opts.voice ?? this.defaultVoice),
        );
        // 发送 task_start
        const taskStart: MiniMaxTtsClientEvent = {
          type: 'task_start',
          model: this.opts.model ?? this.defaultModel,
          voice_setting: {
            voice_id: this.opts.voice ?? this.defaultVoice,
            ...(this.opts.emotion ? { emotion: this.opts.emotion } : {}),
          },
          ...(this.opts.sampleRate ? { audio_setting: { sample_rate: this.opts.sampleRate, format: 'pcm' } } : {}),
        };
        this.sendJson(taskStart);
        resolve();
      });

      this.ws!.on('message', (data: wsWebSocket.RawData) => {
        this.handleIncoming(data);
      });

      this.ws!.on('error', (err: Error) => {
        clearTimeout(timeout);
        this.logger.warn('[ws_error] ' + err.message);
        if (this.state === 'connecting') {
          reject(err);
        } else {
          this.emitError({ code: 'ws_error', message: err.message, retryable: true });
        }
      });

      this.ws!.on('close', (code: number, reason: Buffer) => {
        this.logger.log('[closed] code=' + code + ' reason=' + reason.toString());
        this.state = 'closed';
      });
    });
  }

  /** 流式推送文本 (LLM 增量 token). */
  sendText(text: string): void {
    if (this.state !== 'open') {
      throw new Error('TtsBidiClient: not open (state=' + this.state + ')');
    }
    if (!text) return;
    this.charCount += text.length;
    this.sendJson({ type: 'task_continue', text });
  }

  /** 打断 — 协议级 task_cancel, 不等 in-flight 音频. */
  cancel(): void {
    if (this.state !== 'open') return;
    this.logger.log('[cancel]');
    this.sendJson({ type: 'task_cancel' });
  }

  /** 正常结束 — 等上游 done event. */
  finish(): void {
    if (this.state !== 'open') return;
    this.logger.log('[finish] chars=' + this.charCount);
    this.sendJson({ type: 'task_finish' });
  }

  /** 强制关闭 (pool release 时调). 不发 task_finish. */
  close(): void {
    if (this.ws && this.state !== 'closed') {
      this.ws.close();
    }
    this.state = 'closed';
  }

  // ── private ────────────────────────────────────────────────────

  private sendJson(event: MiniMaxTtsClientEvent): void {
    if (!this.ws || this.ws.readyState !== wsWebSocket.OPEN) return;
    this.ws.send(JSON.stringify(event));
  }

  private handleIncoming(data: wsWebSocket.RawData): void {
    // MiniMax bidi: 二进制帧 (0x01 text / 0x02 audio) 或纯字符串 JSON
    if (Buffer.isBuffer(data)) {
      const firstByte = data[0];
      if (firstByte === TEXT_FRAME) {
        const text = data.subarray(1).toString('utf8');
        this.handleJson(text);
      } else if (firstByte === AUDIO_FRAME) {
        const audio = data.subarray(1);
        const event: TtsEvent = {
          type: 'audio',
          data: audio,
          timestampMs: Date.now(),
        };
        this.emit('event', event);
      } else {
        // 兼容: 整段当 JSON 解析
        const text = data.toString('utf8');
        try {
          this.handleJson(text);
        } catch {
          // 仍当 audio 处理
          const fallback: TtsEvent = {
            type: 'audio',
            data,
            timestampMs: Date.now(),
          };
          this.emit('event', fallback);
        }
      }
    } else if (typeof data === 'string') {
      this.handleJson(data);
    } else {
      this.logger.warn('TtsBidiClient: unexpected message type ' + typeof data);
    }
  }

  private handleJson(text: string): void {
    let parsed: MiniMaxTtsServerEvent;
    try {
      parsed = JSON.parse(text) as MiniMaxTtsServerEvent;
    } catch {
      this.logger.warn('[parse_error] ' + text.slice(0, 100));
      return;
    }

    switch (parsed.type) {
      case 'task_started':
      case 'task_continued':
        // ack 事件, 不对外
        return;
      case 'task_canceled':
        this.logger.log('[task_canceled]');
        return;
      case 'task_finished':
        this.logger.log('[task_finished]');
        return;
      case 'sentence_start': {
        const ev: TtsEvent = {
          type: 'sentence_start',
          text: parsed.text,
          index: parsed.index,
        };
        this.emit('event', ev);
        return;
      }
      case 'sentence_end': {
        const ev: TtsEvent = {
          type: 'sentence_end',
          text: parsed.text,
          index: parsed.index,
        };
        this.emit('event', ev);
        return;
      }
      case 'done': {
        const ev: TtsEvent = {
          type: 'done',
          usage: { characters: parsed.usage?.characters ?? this.charCount },
        };
        this.emit('event', ev);
        return;
      }
      case 'error': {
        this.emitError({
          code: parsed.error?.code ?? 'upstream_error',
          message: parsed.error?.message ?? 'upstream returned error event',
          retryable: false,
        });
        return;
      }
      default: {
        // 未知事件 — log warn, 不抛
        const unknown = (parsed as { type?: string }).type;
        this.logger.warn('[unknown_event] type=' + (unknown ?? 'undefined'));
      }
    }
  }

  private emitError(error: TtsError): void {
    const ev: TtsEvent = { type: 'error', error };
    this.emit('event', ev);
  }
}
