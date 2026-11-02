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

import type { ChatReasoningEffort } from '../../llm/common/interfaces/chat-provider.interface';

/** OpenAI 风格 message. */
export interface LlmMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}
/**
 * V2026-10-21 治本 (V1.2 VS-A — M3.1-Flash 思考深度档位):
 *   原因: MiniMax 官方文档 (OpenAI 兼容协议) 明确 `reasoning_effort` 仅 MiniMax-M3.1-Flash
 *     生效, 取值 low/medium/high/xhigh/max, 省略时服务端默认 max. 该字段是 M3.1-Flash
 *     唯一可控的"思考量"旋钮 (M3.1-Flash 强制 adaptive thinking, 传 thinking.disabled 返 400).
 *   修法: 新增本类型, 挂到 LlmStreamOptions.reasoningEffort, 由调用方按场景选档.
 *   反双胞胎:
 *     - 不加 'none' 档: 官方明确不支持, 传了返 400.
 *     - 不做模型名硬判断: 判断逻辑放调用方 (counselor client), 本层保持 dumb.
 *     - V2026-10-29 治本 (WP9-C): 档位集合的**唯一真相**上移到厂商抽象层
 *       (`src/llm` 的 ChatReasoningEffort) —— 本类型改为别名, 两处各写一份字符串联合
 *       必然漂移 (加了一档就忘了另一处), 而"上游支持哪些档位"是**协议事实**, 不该有两个答案.
 *   验证: 1. tsc 0 错  2. 联调时看 LlmService 日志 [stream_done] usage.completion_tokens 随档位变化
 *   时间戳: 2026-10-21
 */
export type LlmReasoningEffort = ChatReasoningEffort;

/** 流式选项. tenantId / userId 必传 (V2026-10-08 多租户治本). */
export interface LlmStreamOptions {
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly topP?: number;
  /**
   * V2026-10-21 治本 (V1.2 VS-A — per-call 模型覆盖):
   *   默认走 env MINIMAX_LLM_MODEL. counselor 分析链路显式指定 MiniMax-M3.1-Flash,
   *   **不改 .env 全局值** (MINIMAX_BASE_URL 同时被 ASR/TTS 共用, 改它会打断已跑通的语音链路).
   */
  readonly model?: string;
  /**
   * V2026-10-21 治本 (V1.2 VS-A — M3.1-Flash 思考深度):
   *   仅 M3.1-Flash 生效; 传了会随请求下发 reasoning_effort. 其他模型请勿传.
   */
  readonly reasoningEffort?: LlmReasoningEffort;
  /**
   * V2026-10-21 治本 (V1.2 VS-A — 新生长度上限字段):
   *   官方文档: `max_completion_tokens` 是新接入建议字段, 且 **thinking token 也计入本上限**,
   *   设小会 finish_reason=length 且 content 为空 (结构化 JSON 直接解析失败).
   *   传了就用 max_completion_tokens, 不传则沿用旧的 max_tokens (向后兼容).
   */
  readonly maxCompletionTokens?: number;
  /**
   * V2026-10-21 治本 (V1.2 VS-A — per-call 超时覆盖):
   *   默认 env MINIMAX_LLM_TIMEOUT_MS (30s). 长 transcript 督导分析需要更长窗口.
   */
  readonly timeoutMs?: number;
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
  | {
      readonly type: 'done';
      readonly usage: LlmUsage;
      /**
       * 上游结束原因 (OpenAI 兼容口径: stop / length / content_filter / tool_calls …).
       *
       * V2026-10-29 治本 (WP18): **只增可选字段** (老消费方零破坏), 但它是"输出是不是
       * 被上游按长度砍断"的唯一现场证据 —— `length` 意味着正文是半截的, 与"模型吐了
       * 非法 JSON"是两类问题 (前者调预算能修好, 后者要改 prompt 契约).
       * 缺省 = 上游没给 (老 provider / 非 OpenAI 兼容上游).
       */
      readonly finishReason?: string;
    }
  | { readonly type: 'error'; readonly error: LlmError };

/** Token 用量, 写 billing. */
export interface LlmUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  /**
   * 思考 token 数 (推理模型专用; 非推理模型缺省).
   *
   * V2026-10-29 治本 (WP9-C): `completionTokens` 含思考, 单看它分不清
   * "输出被上游截断" 与 "思考吃光了预算" —— 拆开上报才查得动.
   */
  readonly reasoningTokens?: number;
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
