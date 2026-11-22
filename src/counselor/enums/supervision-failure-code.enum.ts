// V2026-10-27 治本 (督导失败原因码 — spec 任务 D1):
//   原因: 督导反馈是**异步**生成的 (BullMQ + LLM), 失败有好几种完全不同的成因:
//     · 上游 503 / 连不上 → 退避后重试大概率能成
//     · 上游 429 限流     → 退避后重试大概率能成
//     · 模型返回的不是 JSON / 字段缺失 → 重试大概率还是这样 (但换个采样也许能成, 故仍算可重试)
//     · 请求超时          → 重试有意义
//     · 素材不足 (空局)   → 重试 100 次还是空 —— 归 `no_content`, 不该出现在失败表里
//     · 流派缺种子        → 重试 100 次还是缺 —— 运营问题, warn 留空即可
//   之前这些成因**全部塌缩成"生成失败"一个态**, 前端只知道"失败了", 不知道能不能重试,
//   学员点"重试"也是白点 (重试的是永久性失败).
//   修法: 引入失败原因码枚举 —— 每个码自带"可重试 / 不可重试"语义, 落库 (反馈记录的
//     可空附加字段) + 出参 (failureCode), 前端据此决定要不要给"重试"按钮.
//   反双胞胎:
//     - 不用 HTTP 状态码表达: 前端要的是**业务语义** (能不能重试), 不是传输层语义
//     - 不把失败码写死在 service 的 if 里: 分类口径集中在本枚举 + 纯函数 classifySupervisionFailure
//     - 不为失败码新增 DB 列: 落在 `supervision_feedback.feedback` json 的**可空附加字段**上
//       (任务单 D1 明确"落报告行/反馈记录的附加字段 (可空)"), 0 migration
//   验证:
//     1. tsc 0 错
//     2. 上游不可用 → failureCode=upstream_unavailable 且可重试
//     3. 素材不足 → failureCode=empty_material 且不可重试 (归 no_content)
//   时间戳: 2026-10-27 13:35 GMT+8

/**
 * 督导生成失败原因码.
 *
 * 字符串值即 wire 值 (前端按字面量判断), 改动等于破坏契约.
 */
export enum SupervisionFailureCode {
  /** LLM 上游不可用 (连接失败 / 5xx / 空响应) — 可重试. */
  UPSTREAM_UNAVAILABLE = 'upstream_unavailable',
  /** 上游限流 (429) — 可重试 (退避后). */
  RATE_LIMITED = 'rate_limited',
  /** 返回不是合法 JSON / 未通过 schema 校验 — 可重试 (换个采样可能成). */
  PARSE_FAILED = 'parse_failed',
  /** 上游请求超时 — 可重试. */
  TIMEOUT = 'timeout',
  /** 素材不足 (空局) — 不可重试, 直接归 `no_content`. */
  EMPTY_MATERIAL = 'empty_material',
  /** 流派缺种子 (supervision_schools 无该 code / 未播种) — 不可重试, warn 留空. */
  SCHOOL_MISSING = 'school_missing',
}

/**
 * 失败码取值域 (供 DTO 校验 + Swagger 展示).
 *
 * 可变数组 (不是 `as const` 元组): Swagger 的 `enum` 选项要求可变数组类型.
 */
export const SUPERVISION_FAILURE_CODE_VALUES: SupervisionFailureCode[] = [
  SupervisionFailureCode.UPSTREAM_UNAVAILABLE,
  SupervisionFailureCode.RATE_LIMITED,
  SupervisionFailureCode.PARSE_FAILED,
  SupervisionFailureCode.TIMEOUT,
  SupervisionFailureCode.EMPTY_MATERIAL,
  SupervisionFailureCode.SCHOOL_MISSING,
];
