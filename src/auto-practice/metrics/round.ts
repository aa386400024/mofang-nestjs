// V2026-11-11 WP-K (统一数值舍入):
//   职责: 所有进入快照 / 指纹 / 报告的浮点统一 round6, 保证跨机器、跨次运行复算一致.
//   背景: 实测 bdiSnapshot.resistance 末值出现 0.2500000000000001 这种浮点残值
//         (0.55 经多次浮点减法), 不 round 会导致 JSON 不可 diff、指纹不稳定.
//   边界: 纯函数, 零依赖.

/** 统一保留的小数位数. */
export const ROUND_DECIMALS = 6;

/**
 * 把一个数字舍入到 6 位小数.
 *
 * 非有限数 (NaN / Infinity) 原样返回, 由调用方在更上层决定如何处理
 * (本函数不擅自把异常值改成 0, 避免静默吞错).
 *
 * @param value 原始值
 * @returns 舍入后的值
 */
export function round6(value: number): number {
  if (!Number.isFinite(value)) return value;
  // 用指数法避免 toFixed 在某些边界的字符串误差, 再转回 number.
  const factor = 10 ** ROUND_DECIMALS;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * 对一个数值对象的所有键做 round6 (返回新对象).
 *
 * @param record 原始对象
 * @returns 各值舍入后的新对象
 */
export function roundRecord<T extends Record<string, number>>(record: T): T {
  const out: Record<string, number> = {};
  for (const key of Object.keys(record)) {
    out[key] = round6(record[key]);
  }
  return out as T;
}
