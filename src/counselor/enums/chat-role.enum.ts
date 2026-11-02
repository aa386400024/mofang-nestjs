// V2026-10-19 治本 (V1.1 §6.5 — transcript ChatRole 3 角色枚举):
//   原因: counselor-mode-v1.1 §6.5 拍板 transcript json 字段用 ChatMessage[] 数组, 每条
//     message 含 role 字段 (counselor/visitor/system), 跟 xin_su_app V0.5 client
//     ChatRole enum 1:1 wire. V0.3 §13 baseline 0 transcript role enum (V0.x
//     TrainingSession.transcript 走 json 数组, 没显式 role enum), 1:1 wire 0 破坏.
//
//   反双胞胎:
//     - 不用单字母 (u/a/s): V0.5 client enum 用 counselor/visitor/system 完整词,
//       1:1 wire 防 drift
//     - 不加 "ai"/"human" 别名: V0.5 client 1:1 wire, 跟 LongTermCaseSession
//       SessionTranscriptTurn ('counselor' | 'visitor') 区分 (本 enum 加 system 3 档,
//       W1-2 长程 2 档)
//     - 不用 i18n: 跟 user.state 同 pattern
//
//   验证: 1. tsc 0 错
//   时间戳: 2026-10-19

/**
 * 对话角色 3 档 (V1.1 §6.5, 跟 xin_su_app V0.5 client ChatRole 1:1 wire).
 *
 * Transcript JSON 数组元素的 role 字段: counselor (用户) / visitor (AI 来访者) /
 * system (系统提示, V0.5 暂不用, V1.x 真接 LLM 后用).
 */
export enum ChatRole {
  /** 咨询师 (用户) */
  COUNSELOR = 'counselor',
  /** 来访者 (AI Agent) */
  VISITOR = 'visitor',
  /** 系统提示 (V0.5 暂不用, V1.x 真接 LLM 后用) */
  SYSTEM = 'system',
}
