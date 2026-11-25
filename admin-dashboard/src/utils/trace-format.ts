/**
 * 调试 trace 的展示/导出精度统一入口。
 *
 * 后端 trace 是引擎真值，保留 IEEE 浮点；UI 不能直接把 0.6895000000000001
 * 甩给用户，也不能在 JSON.stringify 时用 toFixed（会变成字符串带引号）。
 * 这里只在“展示/导出”层做递归 round，数据链路本身不动。
 */

/** 四舍五入到指定小数位；-0 归一成 0。 */
export function roundNumber(value: number, digits = 4): number {
  if (!Number.isFinite(value)) return value
  const factor = 10 ** digits
  const rounded = Math.round((value + Number.EPSILON) * factor) / factor
  return Object.is(rounded, -0) ? 0 : rounded
}

/** 递归把对象/数组里的浮点收敛到指定精度；整数、字符串、null 原样保留。 */
export function sanitizeTraceValue(value: unknown, digits = 4): unknown {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : roundNumber(value, digits)
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeTraceValue(item, digits))
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, sanitizeTraceValue(item, digits)]),
    )
  }
  return value
}

/** 面板/导出共用的 JSON 序列化：默认 4 位小数。 */
export function stringifyTraceJson(value: unknown, digits = 4): string {
  return JSON.stringify(sanitizeTraceValue(value, digits), null, 2)
}

/** 指标展示：不把 null/undefined 伪装成 0。 */
export function formatMetric(value: number | null | undefined, digits = 2, fallback = '—'): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return fallback
  return Number(value).toFixed(digits)
}

/** 带符号展示，用于 delta / 效价。 */
export function formatSigned(value: number | null | undefined, digits = 2, fallback = '—'): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return fallback
  const rounded = Number(value).toFixed(digits)
  return Number(value) > 0 ? `+${rounded}` : rounded
}
