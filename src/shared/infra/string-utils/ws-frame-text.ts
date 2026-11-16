// V2026-11-13 (TD-9 · T-3): WebSocket 原始帧 → UTF-8 文本 (纯函数).
//
//   背景: ws 的 message 事件载荷类型是 RawData = string | Buffer | ArrayBuffer | Buffer[].
//   直接调 data.toString('utf8') 在 ArrayBuffer 分支得到 '[object ArrayBuffer]'
//   (JSON 解析必失败, 帧被静默丢弃), 在 Buffer[] 分支得到逗号拼接的字符串.
//
//   口径:
//     · string      → 原样返回
//     · Buffer      → utf8 解码
//     · Buffer[]    → 逐块 utf8 解码后按 ',' 拼接 (与 Array.prototype.toString 的逐字结果一致)
//     · ArrayBuffer → utf8 解码
//
//   ⚠️ 关于 ArrayBuffer 分支: ws 默认 binaryType='nodebuffer', 现行配置下该分支不可达;
//     旧写法返回 '[object ArrayBuffer]' 必然解析失败, 新写法按 utf8 解码 ——
//     现行运行行为不变, 顺带把这条死分支的语义修正 (见交付记录 §三 T-3 表).
//
//   纯函数: 无 IO、无全局状态、不改入参.

/** WebSocket 原始帧的载荷形状 (与 ws 的 RawData 对齐). */
export type WsFramePayload = string | Buffer | ArrayBuffer | Buffer[];

/**
 * 把 WebSocket 原始帧转成 UTF-8 文本.
 *
 * @param payload 原始帧载荷
 * @returns UTF-8 文本
 */
export function toUtf8Text(payload: WsFramePayload): string {
  if (typeof payload === 'string') return payload;
  if (Array.isArray(payload)) return payload.map((chunk) => chunk.toString('utf8')).join(',');
  if (Buffer.isBuffer(payload)) return payload.toString('utf8');
  return Buffer.from(payload).toString('utf8');
}
