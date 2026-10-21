// V2026-10-08 治本 (MiniMax m3 LLM streaming 客户端):
//   协议: HTTPS streaming, OpenAI-compatible chat completions
//   凭证: env MINIMAX_API_KEY, 不下发到 client
//   超时: AbortSignal.timeout (Node 18+ native fetch)
//   SSE 解析: buffer 累积, 切行, 解析 `data: {...}` 行, `[DONE]` 收尾
//   错误: 上游 4xx/5xx → LlmBusinessError (单次 fail, 不重试业务错);
//         网络/超时 → 普通 Error (走重试, 指数退避 200/600/1400ms, 最多 2 次)
//   不 throw: 调用方 for-of 拿到 error chunk 自然结束, streaming 状态保持
//   日志: NestJS Logger structured (含 tenantId/userId/first_token_ms/chars)
//
// 反双胞胎:
//   - 不用 @nestjs/axios + RxJS Observable — Axios SSE 支持烂, Observable 跟
//     NestJS 其他模块风格不一致, native fetch + AsyncIterable 更 idiomatic.
//   - 不在 service 内部 emit OTel span — 暂不引 OTel 依赖 (Phase 1 用 NestJS
//     Logger 顶上, 链路/性能监控 V1.x 加 OTel 时再补).
//   - 不用 LlmResponse 单类型 — 流式天然多事件, union type 强制 type 判别.
//
// 如何验证:
//   1. pnpm build 无 type error
//   2. pnpm start:dev → curl POST /agent/llm/stream 看 SSE 流式输出
//   3. 故意改错 MINIMAX_API_KEY → 收到 error chunk 含 httpStatus: 401
//   4. 故意断网 5s → 触发重试, 恢复后正常输出
//   5. 日志看 [first_token] / [stream_done] / [sse_parse_error] 关键事件

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { LlmError, LlmMessage, LlmReasoningEffort, LlmStream, LlmStreamOptions, LlmUsage } from './llm.types';

interface MiniMaxChatRequest {
  model: string;
  messages: readonly { role: string; content: string }[];
  stream: true;
  temperature: number;
  top_p: number;
  /** 旧版生成长度上限. 与 max_completion_tokens 二选一 (不同时传). */
  max_tokens?: number;
  /** 新版生成长度上限 (thinking token 计入本上限). 与 max_tokens 二选一. */
  max_completion_tokens?: number;
  /** M3.1-Flash 思考深度. 仅 M3.1-Flash 生效, 其他模型传了可能被上游拒. */
  reasoning_effort?: LlmReasoningEffort;
}

interface MiniMaxStreamDelta {
  readonly id?: string;
  readonly choices?: readonly {
    readonly delta: { readonly content?: string; readonly role?: string };
    readonly finish_reason?: string | null;
    readonly index: number;
  }[];
  readonly usage?: {
    readonly prompt_tokens: number;
    readonly completion_tokens: number;
    readonly total_tokens: number;
  };
}

/** 内部业务错误: 上游返回非 2xx, 携带可重试标志. 不对外暴露. */
class LlmBusinessError extends Error {
  constructor(public readonly error: LlmError) {
    super(error.message);
    this.name = 'LlmBusinessError';
  }
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(config: ConfigService) {
    this.baseUrl = this.configMust(config, 'MINIMAX_BASE_URL');
    this.apiKey = this.configMust(config, 'MINIMAX_API_KEY');
    this.model = this.configMust(config, 'MINIMAX_LLM_MODEL');
    this.timeoutMs = config.get<number>('MINIMAX_LLM_TIMEOUT_MS') ?? 30_000;
    this.maxRetries = config.get<number>('MINIMAX_LLM_MAX_RETRIES') ?? 2;
  }

  /**
   * 流式聊天 — 异步生成器.
   * @param messages OpenAI 风格 messages
   * @param opts 流式选项, tenantId / userId 必传
   * @throws 当 tenantId / userId 缺失时同步抛 (配置错误, 重试无意义)
   */
  async *streamChat(messages: readonly LlmMessage[], opts: LlmStreamOptions): LlmStream {
    if (!opts.tenantId) {
      throw new Error('LlmService.streamChat: tenantId is required (V2026-10-08 治本)');
    }
    if (!opts.userId) {
      throw new Error('LlmService.streamChat: userId is required (V2026-10-08 治本)');
    }

    const startMs = Date.now();
    let firstTokenMs: number | null = null;
    let totalContentLength = 0;
    let attempt = 0;
    let lastRetryableError: LlmError | null = null;

    while (attempt <= this.maxRetries) {
      attempt += 1;
      const attemptStart = Date.now();

      try {
        const stream = await this.executeStream(messages, opts, (token) => {
          if (firstTokenMs === null) {
            firstTokenMs = Date.now() - startMs;
            this.logger.log(`[first_token] tenant=${opts.tenantId} user=${opts.userId} ` + `latency_ms=${firstTokenMs} attempt=${attempt}`);
          }
          totalContentLength += token.length;
        });

        for await (const chunk of stream) {
          yield chunk;
        }

        // 成功结束, 输出 metrics
        const totalMs = Date.now() - startMs;
        this.logger.log(
          `[stream_done] tenant=${opts.tenantId} user=${opts.userId} ` +
            `attempts=${attempt} total_ms=${totalMs} ` +
            `first_token_ms=${firstTokenMs ?? 'n/a'} chars=${totalContentLength}`,
        );
        return;
      } catch (err) {
        // 业务错误 (上游 4xx/5xx) — 不重试, 直接 yield
        if (err instanceof LlmBusinessError) {
          this.logger.error(
            `[stream_business_error] tenant=${opts.tenantId} user=${opts.userId} ` +
              `code=${err.error.code} http=${err.error.httpStatus ?? 'n/a'} ` +
              `msg=${err.error.message.slice(0, 200)}`,
          );
          yield { type: 'error', error: err.error };
          return;
        }

        // 临时错误 (网络/超时/解析) — 重试
        lastRetryableError = {
          code: 'fetch_error',
          message: err instanceof Error ? err.message : String(err),
          retryable: true,
        };
        this.logger.warn(
          `[stream_attempt_failed] tenant=${opts.tenantId} user=${opts.userId} ` +
            `attempt=${attempt} ms=${Date.now() - attemptStart} ` +
            `err=${lastRetryableError.message.slice(0, 200)}`,
        );

        if (attempt > this.maxRetries) {
          break;
        }

        // 指数退避: 200ms / 600ms / 1.4s (attempt=1/2/3)
        const backoffMs = 200 * Math.pow(3, attempt - 1);
        // V2026-10-09 lint fix (promise/param-names): Promise executor resolve 参数名必须 ^_?resolve$, r → resolve
        await new Promise<void>((resolve) => setTimeout(resolve, backoffMs));
      }
    }

    // 重试用尽
    this.logger.error(
      `[stream_exhausted] tenant=${opts.tenantId} user=${opts.userId} ` +
        `attempts=${attempt} last_err=${lastRetryableError?.message ?? 'n/a'}`,
    );
    yield {
      type: 'error',
      error: lastRetryableError ?? {
        code: 'unknown',
        message: 'Stream exhausted without error context',
        retryable: false,
      },
    };
  }

  /**
   * 单次流式请求 — 内部抛 LlmBusinessError (上游非 2xx) 或普通 Error (网络/超时).
   */
  private async executeStream(
    messages: readonly LlmMessage[],
    opts: LlmStreamOptions,
    onToken: (token: string) => void,
  ): Promise<LlmStream> {
    // V2026-10-21 治本 (V1.2 VS-A — 4 个 per-call 开关, 全部 optional, 老调用方 0 行为变化):
    //   原因: counselor 分析链路要用 M3.1-Flash + 思考深度 + 新生长度上限字段 + 更长超时,
    //     但 .env 的 MINIMAX_LLM_MODEL / MINIMAX_BASE_URL 是 ASR/TTS/voice 共用的全局值, 不能改.
    //     官方文档另确认: M3.1-Flash 的 temperature/top_p 已被忽略 (固定 1 / 0.95),
    //     且 thinking token 计入生成长度上限 → 结构化 JSON 必须用 max_completion_tokens 且留足余量.
    //   修法:
    //     - model: opts.model ?? this.model (per-call 覆盖, 不传则跟老行为一致)
    //     - max_completion_tokens: 传了就用新的, 不传沿用旧 max_tokens (向后兼容)
    //     - reasoning_effort: 仅调用方显式指定才下发 (非 M3.1 模型由调用方负责不传)
    //     - timeoutMs: opts.timeoutMs ?? this.timeoutMs (combineSignals 透传)
    //   反双胞胎:
    //     - 不改 .env 全局 MINIMAX_LLM_MODEL: 会波及 voice/visitor/supervisor 既有链路 (红线)
    //     - 不同时下发 max_tokens 与 max_completion_tokens: 语义歧义, 上游可能按旧字段截断
    //   验证: 1. tsc 0 错  2. 老 endpoint /agent/llm/stream 请求体与改前一致 (除 model 可选覆盖外)
    //   时间戳: 2026-10-21
    const request: MiniMaxChatRequest = {
      model: opts.model ?? this.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
      temperature: opts.temperature ?? 0.7,
      top_p: opts.topP ?? 1,
      ...(opts.maxCompletionTokens === undefined
        ? { max_tokens: opts.maxTokens ?? 2048 }
        : { max_completion_tokens: opts.maxCompletionTokens }),
      ...(opts.reasoningEffort ? { reasoning_effort: opts.reasoningEffort } : {}),
    };

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(request),
      // V2026-10-09 治本: 修 Phase 3 AbortController 创建但未注入的 bug.
      //   组合 caller signal (barge-in) + 内部 timeout, 任一触发即中断 fetch + 关 reader.
      // V2026-10-21 治本 (V1.2 VS-A — per-call timeout): combineSignals 收 timeoutMs 参数,
      //   由调用方按场景覆盖 (长 transcript 督导分析 30s 不够). 默认仍走 env MINIMAX_LLM_TIMEOUT_MS.
      signal: this.combineSignals(opts.signal, opts.timeoutMs ?? this.timeoutMs),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '<no body>');
      throw new LlmBusinessError({
        code: `http_${response.status}`,
        message: errorText.slice(0, 500),
        httpStatus: response.status,
        retryable: response.status >= 500 || response.status === 429,
      });
    }

    if (!response.body) {
      throw new LlmBusinessError({
        code: 'no_body',
        message: 'Upstream returned no response body',
        retryable: true,
      });
    }

    return this.parseSseStream(response.body, opts, onToken);
  }

  private async *parseSseStream(body: ReadableStream<Uint8Array>, opts: LlmStreamOptions, onToken: (token: string) => void): LlmStream {
    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let finalUsage: LlmUsage | null = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) {
            continue;
          }

          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') {
            yield {
              type: 'done',
              usage: finalUsage ?? {
                promptTokens: 0,
                completionTokens: 0,
                totalTokens: 0,
              },
            };
            return;
          }

          let parsed: MiniMaxStreamDelta;
          try {
            parsed = JSON.parse(payload) as MiniMaxStreamDelta;
          } catch {
            this.logger.warn(`[sse_parse_error] tenant=${opts.tenantId} user=${opts.userId} ` + `payload=${payload.slice(0, 100)}`);
            continue;
          }

          if (parsed.usage) {
            finalUsage = {
              promptTokens: parsed.usage.prompt_tokens,
              completionTokens: parsed.usage.completion_tokens,
              totalTokens: parsed.usage.total_tokens,
            };
          }

          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            onToken(content);
            yield { type: 'content', content };
          }

          const finishReason = parsed.choices?.[0]?.finish_reason;
          if (finishReason === 'length') {
            this.logger.warn(
              `[stream_truncated] tenant=${opts.tenantId} user=${opts.userId} ` + 'finish_reason=length — max_tokens 可能不够',
            );
          }
        }
      }

      // 流自然结束但没收到 [DONE] 标记
      this.logger.warn(`[sse_unexpected_eof] tenant=${opts.tenantId} user=${opts.userId} — ` + 'stream ended without [DONE] marker');
      if (finalUsage) {
        yield { type: 'done', usage: finalUsage };
      }
    } finally {
      reader.releaseLock();
    }
  }

  private configMust(config: ConfigService, key: string): string {
    const value = config.get<string>(key);
    if (!value) {
      throw new Error(`Missing required env var: ${key}`);
    }
    return value;
  }

  /**
   * 组合 caller signal (barge-in) + 内部 timeout.
   * V2026-10-09 治本: 修 Phase 3 AbortController 创建但未注入的 bug.
   *   任一 signal 触发即中断 fetch + 关 reader, 上层 for-await 自然收到 abort.
   *   Node 20+ 原生 AbortSignal.any, 不引第三方库.
   * V2026-10-21 治本 (V1.2 VS-A): timeoutMs 提为参数, 支持 per-call 覆盖.
   */
  private combineSignals(callerSignal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    if (!callerSignal) return timeoutSignal;
    return AbortSignal.any([callerSignal, timeoutSignal]);
  }
}
