// V2026-10-19 治本 (V1.1 §4.2.7 §6.5 — training_session.status 5 态枚举):
//   原因: counselor-mode-v1.1 §4.2.7 拍板 TrainingSessionStatus 5 态 (Idle/Listening/
//     Thinking/Speaking/Finished), 跟 xin_su_app V0.5 client TrainingSessionStatus
//     enum 1:1 wire. 跟 V0.3 §13 baseline TrainingSession status 4 态 (active/paused/
//     completed/abandoned) 正交: V0.3 是 server 端会话生命周期, V0.5 是 client UI
//     对话状态, V1.x server PATCH /training/sessions/:id 双轨支持.
//
//   反双胞胎:
//     - 不复写 V0.3 §13 baseline 4 态: V0.3 4 态保留, V1.x 走独立表 (V0.3 TrainingSession
//       跟 V1.1 training_sessions 不冲突, V0.3 客户端继续读 V0.3 字段)
//     - 不用 i18n: 跟 user.state 同 pattern, V0.x 中文 / V1.x 加 i18n
//     - 不在 enum 加 paused 状态: V0.5 stage UI 状态机不需要 pause (中断 = InterruptVisitor
//       event 走 speak → idle, 不走 paused)
//
//   验证: 1. tsc 0 错
//   时间戳: 2026-10-19

/**
 * 训练 session 5 状态机 (V1.1 §4.2.7, 跟 xin_su_app V0.5 client TrainingSessionStatus 1:1 wire).
 *
 * V1.x server 端 PATCH /training/sessions/:id API 接受这 5 态流转, 跟 V0.3 §13
 * baseline TrainingSession.status 4 态 (active/paused/completed/abandoned)
 * 正交不冲突.
 */
export enum TrainingSessionStatus {
  /** 待开始 — session 创建后, 等待 client 调 start (V0.5 stage UI: VoiceOrb 静态) */
  IDLE = 'idle',
  /** 正在倾听 — client 调 voice.start, server 返 ASR token stream (V0.5 UI: VoiceOrb 红色脉动 + ASR partial 显示) */
  LISTENING = 'listening',
  /** 来访者思考中 — client 调 send_text, server 调 LLM 思考中 (V0.5 UI: VoiceOrb 暗色 + 3 圆点跳动) */
  THINKING = 'thinking',
  /** 来访者说话中 — server TTS stream, client 播放 (V0.5 UI: VoiceOrb 彩虹 + TTS 播放) */
  SPEAKING = 'speaking',
  /** 已结束 — session 关闭, 异步派发 BullMQ 督导生成 (V0.5 UI: 跳转督导列表) */
  FINISHED = 'finished',
}
