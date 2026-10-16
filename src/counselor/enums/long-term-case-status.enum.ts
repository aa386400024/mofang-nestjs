// V2026-10-15 治本 (V1.2 — long_term_cases.status 3 态枚举):
//   原因: counselor-mode-v1.0 §6.1 写 LongTermCaseStatus: Active/Completed/Abandoned,
//     V0.3 §13 baseline 0 长程状态, 1:1 wire 0 破坏. 跟 knowledge-items.status (V0.x
//     4 态: draft/review/published/archived) 同 pattern 简化到 3 态, 长程语义只需
//     Active/Completed/Abandoned.
//
//   修法:
//     - 3 status 跟 counselor-mode-v1.0 §6.1 严格 1:1 (Active/Completed/Abandoned)
//     - snake_case 序列化 (跟 user.state / kb-status 风格一致)
//     - Active 默认 (用户新建时长程默认 Active), 跟 spec §6.1 default(LongTermCaseStatus.Active) 1:1
//
//   反双胞胎:
//     - 不加 paused 状态: V0.x 简化 (暂停 = Abandoned 走重新开始流程), V1.x 重新进入改
//       dropout_risk_score 重置, 不增加状态空间
//     - 不用 i18n: 跟 user.state 同 pattern, V0.x 中文 / V1.x 加 i18n
//     - 不在 enum 加转换规则: 转换在 service.buildNextSessionContext 内部判断
//
//   验证:
//     1. SELECT status enum: 3 值全在
//     2. 跟 counselor-mode-v1.0 §6.1 1:1
//
//   时间戳: 2026-10-15

/**
 * 长程个案状态 (V1.x counselor-mode §6.1).
 *
 * 跟 xin_su_app LongTermCaseStatus enum 1:1 同步.
 */
export enum LongTermCaseStatus {
  /** 进行中 — 用户可继续开始下次会话 */
  ACTIVE = 'active',
  /** 已完成 — 走完 totalSessions 次, 过程圆满 */
  COMPLETED = 'completed',
  /** 已脱落 — 脱落风险 >0.7 自动转, 或用户手动结束 */
  ABANDONED = 'abandoned',
}
