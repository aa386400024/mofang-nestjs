// V2026-11-02 治本 (WP22 · voice 侧 · 会话闸门错误):
//   职责: 定义"语音对练被闸门拦下"这件事的**唯一错误形状** —— 错误码 / 文案 /
//         可重试性, 以及它到 WS `error` 帧的映射.
//   边界: 纯类型 + 纯函数, 零 IO / 零 NestJS 依赖.
//         为什么单独成文件: 网关要把它映射成帧, 限流服务要抛它 ——
//         两边都 import 它, 若塞进服务文件, 网关就得 import 整个服务 (连带 Redis 依赖).
//
//   为什么错误码是**两个固定值**而不是自由字符串:
//     前端按 code 分支处理 (提示文案 / 是否弹重试按钮), 自由字符串等于没有契约.
//     新增码 = 前端要跟着改, 所以加码必须走前端联调 (本单不加).
//
//   反双胞胎:
//     - 不用 HTTP 状态码: WS 没有状态码, 帧里只有 code / message.
//     - 不把两个失败合并成一个码: "并发上限"与"额度用完"对用户是**两件不同的事**
//       (前者让用户去结束旧会话, 后者让用户明天再来), 合并会让提示无法行动.
//     - 不在错误里塞 retryable = false 了事: "能不能重试"是**事实**, 由错误自己说清,
//       免得网关每加一个码就要重新想一遍.

import type { VoiceServerMessage } from './voice.types.js';

/**
 * 会话闸门错误码.
 *
 * - `session_already_active`: 同一用户已有一场活跃语音会话 (并发上限).
 * - `daily_budget_exceeded`: 当日全局 token 预算已用完.
 */
export type VoiceSessionLimitCode = 'session_already_active' | 'daily_budget_exceeded';

/**
 * 会话闸门错误.
 *
 * 为什么是**独立错误类**而不是裸 Error:
 *   网关要把它与"引擎挂了 / 人物不存在 / TTS 建连失败"区分开 —— 那些走通用
 *   `session_start_failed` 帧, 而闸门错误必须带**自己的 code 与可读文案**
 *   发给前端. 只靠 message 文本匹配 = 靠字符串认类型, 改一次文案就漏.
 */
export class VoiceSessionLimitError extends Error {
  constructor(
    /** 错误码 (前端按它分支). */
    readonly code: VoiceSessionLimitCode,
    /** 给用户看的文案 (直接显示). */
    override readonly message: string,
    /** 用户结束旧会话 / 稍后重试后, 是否可能成功. */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'VoiceSessionLimitError';
  }
}

/**
 * 闸门错误 → WS `error` 帧.
 *
 * 为什么帧形状是 `{ type: 'error', error: { code, message, retryable } }`:
 *   这是仓库**既有**的 error 帧格式 (`voice.types.ts` 的 `VoiceServerMessage`
 *   联合类型就是这么定的, 网关里 `unauthorized` / `template_not_found` /
 *   `session_start_failed` 等全部走它). 前端已经按这个形状解析, 所以本单
 *   **必须**沿用 —— 另起一个平铺格式 (`{ type, code, message }`) 前端反而认不出.
 *
 * @param error 闸门错误
 * @returns WS error 帧
 */
export function buildVoiceLimitErrorFrame(error: VoiceSessionLimitError): VoiceServerMessage {
  return {
    type: 'error',
    error: { code: error.code, message: error.message, retryable: error.retryable },
  };
}
