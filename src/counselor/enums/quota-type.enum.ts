// V2026-10-15 治本 (V4.1 — quota_type 3 类配额枚举):
//   原因: counselor-mode-v1.0 §7.2 拍板 3 类配额 (voice_session 语音场次 / long_term_case
//     长程个案 / voice_analysis 语音分析), V0.3 §13 baseline 0 配额表 (V0.x AI engine
//     + gamification 不接配额), 1:1 wire 0 破坏. V1.x W7-8 新建 quota_usage 表,
//     3 类配额走静态 enum, 跟 W1-2 + W3-4 + W5-6 同 pattern.
//
//   修法:
//     - 3 quotaType 跟 counselor-mode-v1.0 §7.2 + §7.3 1:1
//     - 静态 enum (无 DB 行, 跟 V0.x enum 风格一致)
//     - 跟 membership-tier-presets.ts 5 preset 配额配置 1:1 配对
//
//   反双胞胎:
//     - 不用 i18n key: V0.x 阶段中文, V1.x 多语言时再加 i18n layer
//     - 不用 varchar(40) free-form: 强 enum 约束 (V0.x baseline pattern), 防 drift
//     - 不在 enum 加配额扣减规则: 扣减逻辑在 billing.service.consume 内部
//
//   验证:
//     1. SELECT enum: 3 值全在
//     2. 跟 counselor-mode-v1.0 §7.2 表 cross-ref: 3 名称 1:1
//     3. 跟 membership-tier-presets.ts 配对: 3 配额 1:1
//
//   时间戳: 2026-10-15

/**
 * 3 类配额 (V1.x counselor-mode §7.2).
 *
 * 跟 xin_su_app QuotaType enum 1:1 同步.
 * 跟 src/counselor/config/membership-tier-presets.ts 配额配置 1:1 配对.
 */
export enum QuotaType {
  /** 语音场次 (全流程语音 1 场 = 1, 长程 1 次 = 0.5) */
  VOICE_SESSION = 'voice_session',
  /** 长程个案 (W1-2 完整个案, V1.x 阶段限定 monthly 2 个 / yearly 不限) */
  LONG_TERM_CASE = 'long_term_case',
  /** 语音分析 (V0.x 语音专项分析, V1.x 限定 yearly 4 次/月) */
  VOICE_ANALYSIS = 'voice_analysis',
}
