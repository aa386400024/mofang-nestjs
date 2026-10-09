// V2026-10-08 治本 (MiniMax m3 LLM streaming 类型契约):
//   错误作为数据 (yield error chunk) 而非 throw — 让 Visitor / Supervisor
//   agent 层能用 for-of 优雅处理, streaming 状态不被异常打断.
//
//   命名约定:
//   - LlmMessage / LlmStreamOptions: 入参
//   - LlmStreamChunk: 联合类型, type 字段区分 content / done / error
//   - LlmUsage: token 计费 (V0.x 写日志, V1.x 写 DB billing_record)
//   - LlmError: 含 httpStatus + retryable, 上游决策依据
//
// 反双胞胎:
//   - 不用 Observable<LlmStreamChunk> — NestJS 其他模块风格不一致, AsyncIterable
//     更 idiomatic, for-of 即可消费.
//   - 不用 LlmResponse 单类型 — 流式天然多事件, union type 强制 type 判别.

/** OpenAI 风格 message. */
export interface LlmMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

/** 流式选项. tenantId / userId 必传 (V2026-10-08 多租户治本). */
export interface LlmStreamOptions {
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly topP?: number;
  /** 必传, 强 tenant 隔离. */
  readonly tenantId: string;
  /** 必传, 计费 + 审计. */
  readonly userId: string;
  /** 外部 trace id (NestJS request middleware 注入), 关联到日志. */
  readonly traceId?: string;
  /**
   * AbortSignal — barge-in 时 abort(), fetch 真正中断 + reader 释放.
   * V2026-10-09 治本: 修 Phase 3 AbortController 创建但未注入的 bug.
   * VoiceService.onUserText 创建 AbortController, signal 透传到此处.
   */
  readonly signal?: AbortSignal;
}

/** LLM streaming 事件 union. */
export type LlmStreamChunk =
  | { readonly type: 'content'; readonly content: string }
  | { readonly type: 'done'; readonly usage: LlmUsage }
  | { readonly type: 'error'; readonly error: LlmError };

/** Token 用量, 写 billing. */
export interface LlmUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

/** 错误信息, 含重试策略. */
export interface LlmError {
  /** 业务错误码, 如 http_401, http_429, http_500, no_body, parse_error, fetch_error. */
  readonly code: string;
  /** 人类可读错误信息 (truncate 500 字符). */
  readonly message: string;
  /** HTTP 状态码 (来自上游), 用于重试 + 监控. */
  readonly httpStatus?: number;
  /** 是否可重试 (5xx / 429 / 网络错误 = true, 4xx = false). */
  readonly retryable: boolean;
}

export type LlmStream = AsyncIterable<LlmStreamChunk>;
