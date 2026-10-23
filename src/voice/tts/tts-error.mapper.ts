// V2026-10-23 治本 (TTS 上游错误归一 — spec §3.7):
//   原因: 官方用 `base_resp.status_code` 表达一切失败 (10xx 鉴权 / 限流 / 超时,
//     20xx 参数, 22xx 协议与队列). 这些码的**处置策略完全不同**: 1004 重试一万次也没用,
//     1002 必须退避, 2205 重发那一条即可 (重连反而丢上下文), 2206 重试只会重复同一个 bug.
//     若把判断散落在 client / service / voice.service 三处, 必然出现口径漂移 ——
//     "client 判可重试, service 判不可重试" 这种矛盾, 上线后表现为偶发重试风暴.
//   修法: 本文件是 status_code → 业务错误码 + retryable 的**唯一真值源**,
//     上层只消费归一后的 TtsError, 不再认识上游状态码.
//   反双胞胎:
//     - 不直接透传上游 status_code 给前端: 前端要的是"能不能重试"这一个决策,
//       让前端去理解 2205 和 2206 的区别是泄漏上游协议细节
//     - 不在 catch 里凭感觉给 retryable: 每个码的重试语义不同, 必须查表
//   验证:
//     1. tsc 0 错
//     2. 1004 → retryable=false; 2205 → retryable=true 且**不重连**
//   时间戳: 2026-10-23

import { TTS_STATUS } from './tts-protocol.config';
import type { TtsError } from './tts.types';

/**
 * 状态码 → 业务错误码映射表.
 *
 * 值为 null 表示"该状态码不映射成错误" (仅 status 0 使用).
 */
const STATUS_TO_ERROR_CODE: Readonly<Record<number, string>> = {
  [TTS_STATUS.AUTH_FAILED]: 'tts_auth_failed',
  [TTS_STATUS.RATE_LIMITED]: 'tts_rate_limited',
  [TTS_STATUS.CONCURRENT_LIMITED]: 'tts_concurrent_limited',
  [TTS_STATUS.TIMEOUT]: 'tts_upstream_timeout',
  [TTS_STATUS.UNKNOWN]: 'tts_upstream_unknown',
  [TTS_STATUS.ILLEGAL_CHARACTERS]: 'tts_illegal_characters',
  [TTS_STATUS.INVALID_PARAMS]: 'tts_invalid_params',
  [TTS_STATUS.IDLE_DISCONNECT]: 'tts_idle_disconnect',
  [TTS_STATUS.ILLEGAL_EVENT]: 'tts_illegal_event',
  [TTS_STATUS.TEXT_TOO_LONG]: 'tts_text_too_long',
  [TTS_STATUS.QUEUE_OVERFLOW]: 'tts_queue_overflow',
  [TTS_STATUS.EVENT_ORDER]: 'tts_event_order',
};

/**
 * 明确**不可重试**的状态码集合.
 *
 * 这些是"再发一次还是同样的错": 鉴权 / 参数 / 协议顺序 / 文本非法.
 * 其余 (含未知码) 一律按可重试处理 —— 上游抖动是常态, 宁可重试也不要把整轮会谈判死.
 */
const NON_RETRYABLE_STATUS: ReadonlySet<number> = new Set([
  TTS_STATUS.AUTH_FAILED,
  TTS_STATUS.ILLEGAL_CHARACTERS,
  TTS_STATUS.INVALID_PARAMS,
  TTS_STATUS.ILLEGAL_EVENT,
  TTS_STATUS.EVENT_ORDER,
]);

/**
 * 状态码是否可重试.
 *
 * @param statusCode 官方 base_resp.status_code
 */
export function isRetryableTtsStatus(statusCode: number): boolean {
  if (statusCode === TTS_STATUS.OK) return false;
  return !NON_RETRYABLE_STATUS.has(statusCode);
}

/**
 * 官方状态码 → 业务错误 (归一).
 *
 * @param statusCode 官方 base_resp.status_code
 * @param statusMessage 官方 base_resp.status_msg (可空)
 * @returns 归一后的 TtsError
 */
export function mapTtsUpstreamError(statusCode: number, statusMessage?: string): TtsError {
  const code = STATUS_TO_ERROR_CODE[statusCode] ?? 'tts_upstream_error';
  const message = statusMessage && statusMessage.length > 0 ? statusMessage : `上游返回状态码 ${statusCode}`;
  return {
    code,
    message: message.slice(0, 300),
    retryable: isRetryableTtsStatus(statusCode),
    upstreamStatus: statusCode,
  };
}
