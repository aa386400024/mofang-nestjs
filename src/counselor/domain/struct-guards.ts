// V2026-10-23 治本 (counselor 端结构化输出的**原始值守卫** — 单一真值源):
//   原因: counselor 端的结构化输出 (LLM JSON / 脚本快照) 全部是「外部输入」, 校验方式
//     都是同一套: 从 `unknown` 里**安全取值**, 取不到就返回 null 让上层判定非法.
//       - `providers/visitor-persona.service.ts` 有 readString / readStringArray / readEnum
//       - AI 模拟来访池的 card + script 校验需要同一套语义, 但**不能**直接 import
//         service 里的私有函数 (它是 service 的实现细节, 不是对外契约)
//     若各写一份, 会出现「一个人认为空数组合法, 另一个人认为非法」的分歧 ——
//     而 7 大块剧本的数组字段**全部要求非空**, 这种分歧会直接变成"偶发校验失败".
//
//   修法: 抽本文件为 counselor 端唯一的原始值守卫, service 与 validator 共同引用.
//
//   反双胞胎:
//     - 不把守卫散回各文件: 那就是本文件要消灭的重复本身.
//     - 不用 class-validator 承载: 这些是**嵌套 JSON 结构** (数组/对象), class-validator
//       对嵌套 json 表达力弱; 校验走手写函数, 类型靠 TS 保证编译期 (与
//       visitor-persona.types.ts 顶部注释的结论一致).
//     - 不用 `as` 断言代替取值: 断言不校验, 外部输入经不起断言.
//     - 空数组视为**非法** (返回 null): 7 大块剧本的每个数组字段都要求至少 1 个元素
//       (如 developmentalTimeline.tabooTopics 允许语义上为空, 但结构契约要求非空,
//       让 LLM 显式写 "无" 而不是留空数组 —— 显式比省略更可校验).
//
//   验证:
//     1. tsc 0 错
//     2. grep 'function readString' 于 src/counselor → 只剩本文件 1 处
//
//   时间戳: 2026-10-23

/**
 * 取非空字符串; 非字符串 / 空串 / 纯空白返回 null.
 *
 * @param value 原始值
 */
export function readString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * 取字符串数组; 非数组 / 含非字符串元素 / 空数组返回 null.
 *
 * @param value 原始值
 */
export function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      return null;
    }
    out.push(item);
  }
  return out.length > 0 ? out : null;
}

/**
 * 取受限枚举值; 不在白名单内返回 null.
 *
 * @param value 原始值
 * @param allowed 白名单
 */
export function readEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/**
 * 取有限数值; 非数值 / NaN / Infinity 返回 null.
 *
 * 不在这里做区间判定: 区间是**业务**约束 (各字段的 0-1 / 12-100 不同), 由调用方给
 * 上下界, 本函数只负责"这是一个数吗".
 *
 * @param value 原始值
 */
export function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * 取布尔值; 非布尔返回 null.
 *
 * 刻意**不**把 'true' / 'false' 字符串当布尔: 那样 "Boolean('false') === true"
 * 的经典坑会被引进业务层. 布尔语义从严, 字符串由调用方显式解析.
 *
 * @param value 原始值
 */
export function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/**
 * 递归收集任意结构里的全部字符串 (用于内容边界关键词扫描).
 *
 * 为什么要递归: 剧本是 7 大块嵌套结构, 关键词可能出现在任何一层的任何文本字段里
 * (如 socialMap.currentStatus 里冒出危机内容). 逐字段列举必然漏 —— 漏一个就是
 * 危机内容漏进公共库.
 *
 * @param value 任意值
 * @returns 收集到的字符串 (含数组元素与对象属性值)
 */
export function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    const out: string[] = [];
    for (const item of value) {
      out.push(...collectStrings(item));
    }
    return out;
  }
  if (typeof value === 'object' && value !== null) {
    const out: string[] = [];
    for (const item of Object.values(value as Record<string, unknown>)) {
      out.push(...collectStrings(item));
    }
    return out;
  }
  return [];
}
