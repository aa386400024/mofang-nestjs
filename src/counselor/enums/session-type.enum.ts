// V2026-10-15 治本 (V2.1 — supervision_feedback.sessionType polymorphic 3 态枚举):
//   原因: counselor-mode-v1.0 §4.6 拍板督导覆盖长程 (W1-2 LongTermCaseSession) + 全流程
//     (V0.x TrainingSession) + 专项技能 (V0.x TrainingSession) 3 类 session, 1:1 wire
//     0 破坏 V0.3 §13 baseline. supervision_feedback.session_id 是 polymorphic FK,
//     需 sessionType enum 区分实际指向.
//
//   修法:
//     - 3 sessionType 跟 counselor-mode-v1.0 §4.6 覆盖范围 1:1 (snake_case)
//     - 静态 enum (无 DB 行, 跟 V0.x enum 风格一致)
//     - 跟 W1-2 LongTermCaseSession + V0.x TrainingSession 1:1 配对 (应用层按 sessionType
//       走对应 Repository 查 transcript, 不写 DB-level polymorphic FK, V0.x 风格 软删兼容)
//
//   反双胞胎:
//     - 不用 jsonb sessionRef: V0.x 风格 enum + char(36) sessionId 强类型, 防 drift
//     - 不用 varchar(50) free-form: 强 enum 约束
//     - 不在 V0.x TrainingSession 加 supervisionSchoolId 字段: 破坏 1:1 wire, 1:1 wire
//       0 破坏 V0.3 baseline
//
//   验证:
//     1. SELECT enum: 3 值全在
//     2. 跟 W1-2 LongTermCaseSession + V0.x TrainingSession 1:1 配对
//
//   时间戳: 2026-10-15

/**
 * supervision_feedback.sessionId 指向的 session 类型 (V1.x counselor-mode §4.6 polymorphic).
 *
 * 跟 xin_su_app SupervisionSessionType enum 1:1 同步.
 */
export enum SessionType {
  /** W1-2 长程个案会话 (long_term_case_sessions 表, V1.x counselor-mode §4.3) */
  LONG_TERM_CASE_SESSION = 'long_term_case_session',
  /** V0.x 全流程模拟 session (training_sessions 表, V0.3 §13 baseline) */
  TRAINING_SESSION = 'training_session',
  /** V0.x 专项技能 session (复用 training_sessions 表, V0.3 §13 baseline) */
  FULL_SESSION = 'full_session',
}
