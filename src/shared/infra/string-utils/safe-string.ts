// V2026-11-13 (TD-9 · T-3): 安全字符串转换 (纯函数).
//
//   为什么需要: 请求体 / 外部载荷的字段类型是 unknown, 直接 String(value) 在对象分支下
//   会把内容抹成 '[object Object]' —— 排障时看不到真实值, 错误信息也失去意义.
//   仓库权威 ESLint 闸门把 no-base-to-string 全局关掉了 (见 eslint.config.mjs 的理由注释),
//   但 oxlint 的 type-aware 规则集更宽, 会把这层隐患重新报出来 —— 本文件是**统一出口**.
//
//   口径 (单一真相源, 消费端不另抄一份判断):
//     · string              → 原样返回 (不 trim、不加引号)
//     · number / bigint     → String(value) (NaN / Infinity 也照原样, 不静默吞掉)
//     · boolean             → String(value)
//     · null / undefined    → fallback
//     · 对象 / 数组          → JSON.stringify; 序列化失败 (循环引用 / BigInt) → fallback
//     · symbol / function   → fallback
//
//   纯函数: 无 IO、无全局状态、不改入参、不记日志 (可能带外部载荷, 不进普通日志).

/** 默认兜底值 (缺省空串). */
export const DEFAULT_SAFE_STRING_FALLBACK = '';

/**
 * 把 unknown 值安全地转成字符串.
 *
 * @param value 待转换的值 (任意来源)
 * @param fallback 取不到可读文本时的兜底值
 * @returns 可读字符串
 */
export function safeString(value: unknown, fallback: string = DEFAULT_SAFE_STRING_FALLBACK): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return fallback;
  try {
    // JSON.stringify 对 function / symbol 返回 undefined (运行时语义), TS 的 lib 类型却写成 string ——
    //   显式标注出 undefined 分支, 既让 ?? 成立, 也让 sonarjs 的"恒 false"判断闭嘴.
    const serialized: string | undefined = JSON.stringify(value);
    return serialized ?? fallback;
  } catch {
    // 循环引用 / BigInt 等不可序列化载荷 —— 回落兜底值, 绝不抛错打断主流程.
    return fallback;
  }
}
