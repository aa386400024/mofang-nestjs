// V2026-10-08 治本 (TTS 高层 facade — VoiceGateway 用):
//   职责: 屏蔽 pool 细节, 提供简单的 startSession/endSession API
//   调用方: VoiceGateway (Slice 1.3 写), 流程:
//     1. startSession → 拿 handle (events stream + sendText + cancel + finish)
//     2. 监听 handle.events → 转发 audio 给 client WS, 转发 sentence_* 给 client (字幕)
//     3. LLM 推 text → handle.sendText(chunk)
//     4. LLM 结束 → handle.finish() → 等 done event → endSession
//     5. 用户打断 → handle.cancel() → 协议级 task_cancel
//
//   错误处理: 内部 client 错误 yield 到 events stream (不 throw),
//     让 VoiceGateway 决定是结束 session 还是重建.
//
// 反双胞胎:
//   - 不用 callback (onAudio / onSentence / onError) — 改 AsyncIterable
//   - 不在 service 里做 pool acquire/release 的 retry — pool 内部已有超时
//
// 如何验证:
//   1. TtsService.startSession → 1 个 pool acquire 1 个 client
//   2. handle.sendText('你好') → events 流输出 audio + sentence_start/end
//   3. handle.finish() → events 流输出 done, 1 个 pool release
//   4. handle.cancel() → events 流输出 task_canceled, 不影响 release

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

import { TtsBidiPoolService } from './tts-bidi-pool.service';
import type { TtsEvent, TtsOptions, TtsSessionHandle } from './tts.types';

@Injectable()
export class TtsService implements OnModuleDestroy {
  private readonly logger = new Logger(TtsService.name);

  constructor(private readonly pool: TtsBidiPoolService) {}

  /** 启动 TTS session — VoiceGateway 在用户开始训练时调. */
  async startSession(opts: TtsOptions): Promise<TtsSessionHandle> {
    const client = await this.pool.acquire(opts);
    this.logger.log(`[start_session] session=${opts.sessionId} tenant=${opts.tenantId} user=${opts.userId}`);

    // 内部事件流 — 包装 client 的 'event' emitter 为 AsyncIterable
    const eventStream = this.wrapEvents(client);

    return {
      sessionId: opts.sessionId,
      events: eventStream,
      sendText: (text: string) => client.sendText(text),
      cancel: () => client.cancel(),
      finish: () => client.finish(),
    };
  }

  /** 结束 session — VoiceGateway 在 LLM 推流完成 + 等 done event 后调. */
  endSession(sessionId: string): void {
    this.logger.log(`[end_session] session=${sessionId}`);
    this.pool.release(sessionId);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.shutdown();
  }

  // ── private ────────────────────────────────────────────────────

  /**
   * 包装 EventEmitter 为 AsyncIterable<TtsEvent>.
   * 'data' / 'end' / 'error' 三个事件:
   *   - 'event': TtsEvent from client
   *   - 'end': client close, 流自然结束
   *   - 'error': 严重错误, 流带 error event 结束
   */
  private async *wrapEvents(client: import('./tts-bidi-client').TtsBidiClient): AsyncGenerator<TtsEvent> {
    const queue: TtsEvent[] = [];
    let resolveNext: (() => void) | null = null;
    let ended = false;

    const onEvent = (event: TtsEvent): void => {
      queue.push(event);
      resolveNext?.();
    };

    const onErrorEvent = (err: Error): void => {
      ended = true;
      // 如果上游还没 yield error event, 补一个
      const hasErrorInQueue = queue.some((e) => e.type === 'error');
      if (!hasErrorInQueue) {
        queue.push({
          type: 'error',
          error: { code: 'client_error', message: err.message, retryable: false },
        });
      }
      resolveNext?.();
    };

    client.on('event', onEvent);
    // client 继承 EventEmitter, 'close' 触发 onErrorEvent
    client.on('close', onErrorEvent);
    client.on('error', onErrorEvent);

    try {
      while (true) {
        if (queue.length > 0) {
          const event = queue.shift();
          if (event) yield event;
          // 终结性事件后, 等到 client close 才退
          if (event?.type === 'done' || event?.type === 'error') {
            // 等到 client 关闭 (调用 endSession 后), 然后退出
            // V2026-10-09 lint fix (no-unmodified-loop-condition + promise/param-names):
            //   while (!ended) { ... } 循环体内没改 ended, lint 报; 改 for (;;) + 内部 if break.
            //   Promise executor 参数 r → resolve (promise/param-names 要求 ^_?resolve$).
            for (;;) {
              if (ended) break;
              await new Promise<void>((resolve) => {
                resolveNext = resolve;
              });
            }
            return;
          }
          continue;
        }
        if (ended) {
          // close 时如果队列里还有非终结事件, 继续 yield 完再退
          if (queue.length > 0) continue;
          return;
        }
        // V2026-10-09 lint fix (promise/param-names): r → resolve
        await new Promise<void>((resolve) => {
          resolveNext = resolve;
        });
      }
    } finally {
      client.off('event', onEvent);
      client.off('error', onErrorEvent);
    }
  }
}
