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

import type { LlmError, LlmMessage, LlmReasoningEffort, LlmStream, LlmStreamChunk, LlmStreamOptions, LlmUsage } from './llm.types';

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
    /**
     * 思考 token 明细 (V2026-10-29 治本 · WP9-C).
     *
     * 实测 MiniMax-M3.1-Flash 会回 `completion_tokens_details.reasoning_tokens`;
     * 缺省时按"没有思考"处理 (字段可选).
     */
    readonly completion_tokens_details?: { readonly reasoning_tokens?: number };
  };
}

/**
 * SSE 单行解析结果 (V2026-10-29 治本 · WP18).
 *
 * `kind='done'` = 收到 `[DONE]` 标记 (流正常结束);
 * `kind='data'` = 一条正常的增量 (可能带 content / usage / finish_reason).
 */
interface SseLineEvent {
  readonly kind: 'done' | 'data';
  readonly content?: string;
  readonly usage?: LlmUsage;
  readonly finishReason?: string;
}

/** usage 缺省值 (上游没带 usage 时). */
const ZERO_USAGE: LlmUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

/**
 * 构造 done 事件 (usage + 可选 finishReason).
 *
 * V2026-10-29 治本 (WP18): `finishReason` 是**可选**字段 (老消费方零破坏),
 *   但它是"输出是不是被上游按长度砍断"的唯一现场证据 —— 见 `LlmStreamChunk` 的说明.
 *
 * @param usage token 用量
 * @param finishReason 上游结束原因 (缺省 = 上游没给)
 * @returns done 事件
 */
function buildDoneChunk(usage: LlmUsage, finishReason: string | undefined): LlmStreamChunk {
  return {
    type: 'done',
    usage,
    ...(finishReason === undefined ? {} : { finishReason }),
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
    // V2026-10-29 治本 (WP9-B 启动验证时挖出): 这两个数值**不能**用 `config.get<number>('MINIMAX_*')`
    //   读**裸 env 键** —— ConfigService 不做类型转换, 拿到的是**字符串** ('60000'),
    //   一路传到 `AbortSignal.timeout(timeoutMs)` 就会抛
    //   `The "delay" argument must be of type number. Received type string ('60000')`
    //   → **每一次 LLM 调用都炸** (语音/督导/分析全断, 且只在 .env 里配了这两个键时炸).
    //   改走**已归一化的配置命名空间** (config/envs/default.ts: Number(process.env...) ?? 默认值),
    //   与 tts-bidi-client 等同款读法 —— 数值只在一处归一, 别处只消费.
    this.timeoutMs = config.get<number>('minimax.llmTimeoutMs') ?? 30_000;
    this.maxRetries = config.get<number>('minimax.llmMaxRetries') ?? 2;
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
    //     但 .env 的 MINIMAX_LLM_MODEL / MINIMAX_BASE_URL 是 ASR/TTS/voice/STT 共用的全局值,
    //     改它会同时波及所有链路, 所以模型选择只能 per-call 覆盖.
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

  /**
   * 解析一行 SSE.
   *
   * V2026-10-29 治本 (WP18): 从 `parseSseStream` 里**抽出来** —— 主循环只留"编排",
   *   每行的"这是什么 / 有没有 usage / 有没有 finish_reason"交给本方法.
   *   为什么要抽: 加了 finishReason 之后主函数的分支数越过了 ESLint complexity 20
   *   与 sonarjs cognitive-complexity 25 两条红线 —— 而这两条红线存在的意义就是
   *   "别让一个函数同时管太多事", 正好借这次抽行把职责切干净.
   *
   * @param line 一行原始 SSE 文本
   * @param opts 流式选项 (日志要 tenantId / userId)
   * @returns 解析结果; null = 空行 / 非 data 行 / 解析失败 (都跳过)
   */
  private parseSseLine(line: string, opts: LlmStreamOptions): SseLineEvent | null {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('data:')) {
      return null;
    }

    const payload = trimmed.slice(5).trim();
    if (payload === '[DONE]') {
      return { kind: 'done' };
    }

    let parsed: MiniMaxStreamDelta;
    try {
      parsed = JSON.parse(payload) as MiniMaxStreamDelta;
    } catch {
      this.logger.warn(`[sse_parse_error] tenant=${opts.tenantId} user=${opts.userId} ` + `payload=${payload.slice(0, 100)}`);
      return null;
    }

    const content = parsed.choices?.[0]?.delta?.content;
    const finishReason = parsed.choices?.[0]?.finish_reason ?? undefined;
    return {
      kind: 'data',
      ...(content ? { content } : {}),
      ...(parsed.usage ? { usage: toLlmUsage(parsed.usage) } : {}),
      ...(finishReason ? { finishReason } : {}),
    };
  }

  private async *parseSseStream(body: ReadableStream<Uint8Array>, opts: LlmStreamOptions, onToken: (token: string) => void): LlmStream {
    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let finalUsage: LlmUsage | null = null;
    // V2026-10-29 治本 (WP18): 上游结束原因 —— `length` 说明正文被按长度砍断了.
    //   它跟"模型吐了非法 JSON"是两类问题, 上层要能分开报 (见 SupervisorService).
    let finalFinishReason: string | undefined;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const event = this.parseSseLine(line, opts);
          if (event === null) {
            continue;
          }
          if (event.kind === 'done') {
            yield buildDoneChunk(finalUsage ?? ZERO_USAGE, finalFinishReason);
            return;
          }
          if (event.usage) {
            finalUsage = event.usage;
          }
          if (event.finishReason) {
            finalFinishReason = event.finishReason;
            if (event.finishReason === 'length') {
              this.logger.warn(
                `[stream_truncated] tenant=${opts.tenantId} user=${opts.userId} ` + 'finish_reason=length — max_tokens 可能不够',
              );
            }
          }
          if (event.content) {
            onToken(event.content);
            yield { type: 'content', content: event.content };
          }
        }
      }

      // 流自然结束但没收到 [DONE] 标记
      this.logger.warn(`[sse_unexpected_eof] tenant=${opts.tenantId} user=${opts.userId} — ` + 'stream ended without [DONE] marker');
      if (finalUsage) {
        yield buildDoneChunk(finalUsage, finalFinishReason);
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

/**
 * 上游 usage → 内部用量口径 (纯映射).
 *
 * V2026-10-29 治本 (WP9-C): 思考 token 单独上报 —— `completion_tokens` **含**思考,
 * 单看它分不清"输出被上游截断"与"思考吃光了预算"; 拆开才查得动.
 *
 * 抽成独立函数而不是内联在 SSE 循环里: 那段循环已经贴着仓库的复杂度红线,
 * 而"usage 怎么映射"是**纯数据搬运** —— 独立出来既降复杂度, 又只有一个落点.
 *
 * @param usage 上游 usage
 * @returns 内部用量
 */
function toLlmUsage(usage: NonNullable<MiniMaxStreamDelta['usage']>): LlmUsage {
  const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens;
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    ...(typeof reasoningTokens === 'number' ? { reasoningTokens } : {}),
  };
}
