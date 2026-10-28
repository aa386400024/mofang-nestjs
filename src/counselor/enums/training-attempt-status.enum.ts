// V2026-10-19 治本 (V1.1 §5.2 企业级 — training_exercise_attempts.status 5 档 enum, 1:1 wire §5.2 + V0.5 1:1 wire):
//   原因: counselor-mode-v1.1 §5.2 拍板专项技能 训练题模式 (选择题 + AI 评分 +
//     即时反馈), V0.5 stage 简化版 0 落地 1:1 阻断 §5.2 1:1 wire. 答题记录需要
//     5 状态机 (pending / inProgress / submitted / graded / abandoned) 1:1 wire
//     server V0.3 §13 baseline TrainingSession.status 4 态 (active/paused/completed/
//     abandoned) 拍板风格, 5 态 1:1 wire §5.2 拍板.
//   修法: 加 TrainingAttemptStatus 5 档 enum, 跟 V0.5 counselor_training_session
//     V2026-10-19 治本 TrainingSessionStatus 5 态 1:1 wire 拍板风格
//     (snake_case enum 字符串, V0.3 §13 baseline 0 破坏).
//   反双胞胎:
//     - 不加 "expired" 状态 (V1.x 续做时跟 server V0.3 §13 baseline 1:1 wire
//       同步, V0.5 stage 简化 0 占位)
//     - 不用 int 数值: V0.x 风格 enum 字符串, 防 drift
//     - 不用 i18n: V0.5 中文硬编码, V1.x i18n 续做时再切
//   验证: 1. tsc 0 错 2. 答题记录 5 态流转 1:1 wire V0.5 client TrainingSessionState.
//   时间戳: 2026-10-19

/**
 * 答题记录状态 5 档 (V1.1 §5.2 拍板 1:1 wire, 跟 xin_su_app TrainingAttemptStatus 1:1 wire).
 *
 * 跟 V0.5 TrainingSessionStatus 5 态 1:1 wire 拍板风格 (扩展到答题记录).
 */
export enum TrainingAttemptStatus {
  /** 待开始 — 答题记录创建后, 用户未开始做答 */
  PENDING = 'pending',
  /** 进行中 — 用户开始做答, 候选项已选未提交 */
  IN_PROGRESS = 'inProgress',
  /** 已提交 — 用户提交答案, AI 评分中 */
  SUBMITTED = 'submitted',
  /** 已评分 — AI 评分完成, 显示维度分 + 专家反馈 */
  GRADED = 'graded',
  /** 已放弃 — 用户中途放弃 (back 离开 / 强制退出) */
  ABANDONED = 'abandoned',
}
