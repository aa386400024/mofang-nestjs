// V2026-10-22 治本 (V1.3 §7.4 — 练习域专属的配额类型):
//   原因: spec §7.4 原文「沿用现有 `quota_usage` 配额体系统计, 默认每用户**每天** 5 次」.
//     这里有一个容易被忽略的口径冲突: `quota_usage.quota_type` 列的值域是
//     `QuotaType` (会员**权益**类: voice_session / long_term_case / voice_analysis),
//     而 §7.4 要的是单次接口的**调用频率**上限 —— 性质完全不同:
//       - 会员权益: 升级会员能多用 → 是可售卖的价值
//       - 调用频率: 防滥用 + 控成本 → 不是权益, 不该被"升级会员"放大
//     若把这项塞进 `QuotaType`, 就会连带出两个坏结果:
//       (1) `BillingService.getQuotaStatuses` 会遍历 `Object.values(QuotaType)`,
//           会员状态响应里会多出一行 `practice_custom_scenario, limit=0`,
//           让人误以为"这项权益余额为 0"
//       (2) `QuotaType` 是跟客户端 1:1 wire 的枚举, 加值会污染那份契约
//   修法: 练习域用**自己的**配额类型枚举 (封闭集合, 同样是强类型),
//     与 `QuotaType` 并列写在 `quota_usage.quota_type` 列上 (列本身是 varchar(40),
//     两个枚举的值都放得下). `QuotaUsage.quotaType` 的类型放宽成两者的并集,
//     会员链路仍只认 `QuotaType`, 练习链路只认 `PracticeQuotaType`.
//
//   反双胞胎:
//     - 不加进 QuotaType: 见上 (会员权益与调用频率是两件事)
//     - 不用自由字符串: 那会让 quota_type 列退化成无约束字段, 拼错一个字母
//       就静默开出一个新的"配额桶", 统计时永远对不上
//     - 不新建一张配额表: spec §7.4 明确要求沿用 quota_usage; 分表会让
//       "今天用了多少次"这个查询散到两处
//
//   验证:
//     1. tsc 0 错
//     2. 全仓 grep 'practice_custom_scenario' 的 quota_type 取值只来自本枚举
//     3. GET /counselor/billing/membership 的 quotas 数组长度不变 (仍是 3 项)
//
//   时间戳: 2026-10-22

/**
 * 练习域专属的配额类型 (与会员权益 `QuotaType` 并列, 共用 quota_usage 表).
 */
export enum PracticeQuotaType {
  /** 「我遇到了真实情况」场景生成 (spec §7.4: 每用户每天 5 次). */
  CUSTOM_SCENARIO_GENERATION = 'practice_custom_scenario',
}
