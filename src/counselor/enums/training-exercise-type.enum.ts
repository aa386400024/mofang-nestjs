// V2026-10-19 治本 (V1.1 §5.2 企业级 — training_exercises.type 3 档 enum, 1:1 wire §5.2 + §6.5 + V0.5 client 1:1 wire):
//   原因: counselor-mode-v1.1 §5.2 拍板专项技能 3 子模块 (倾听共情 / 提问技术 /
//     语音微训练), V0.5 stage 简化版训 tab 9 场景共用 1 套 5 状态机 TrainingSessionPage
//     1:1 阻断 §5.2 1:1 wire (大炮 16:10 "A, 要企业级的方案, 不要凑活" 1:1 反馈).
//     V1.1 §5.2 拍板需要独立的"训练题模式" (选择题 + AI 评分 + 即时反馈), 跟
//     "全流程模式" (5 状态机 开放式 AI 对话) 1:1 wire 完全正交. 跟
//     xin_su_app V0.5 治本 V2026-10-19 落地 TrainingExerciseType 3 档
//     (listening/questioning/voiceMicro) 1:1 wire.
//   修法: 加 TrainingExerciseType 3 档 enum (V1.1 §5.2.1/5.2.2/5.2.3 1:1 wire
//     拍板), 跟 V0.5 counselor_training_session.entity.ts V2026-10-19 治本 V8.3 拍板
//     TrainingSessionStatus 5 档 1:1 wire 风格 (snake_case enum 字符串).
//   反双胞胎:
//     - 不复写 V0.3 §13 baseline (1:1 wire 0 破坏, V0.5 client TrainingExerciseType
//       已落地, server 1:1 wire 拍板)
//     - 不用 int 数值: V0.x 风格 enum 字符串, 防 drift
//     - 不加 "case_concept" / "case_ethics" 类型: 跟 V0.5 client 1:1 wire, 个案
//       概念化 (V1.1 §5.6) 走全流程 1:1 wire, 跟专项技能 1:1 训练题模式正交
//   验证: 1. tsc 0 错 2. 大炮跑 pnpm migration:run + SHOW TABLES LIKE 'training_exercises';
//     + 1:1 wire V0.5 client TrainingExerciseType 3 档 enum 字符串.
//   时间戳: 2026-10-19

/**
 * 训练题类型 3 档 (V1.1 §5.2 拍板 1:1 wire, 跟 xin_su_app TrainingExerciseType 1:1 wire).
 *
 * V1.1 §5.2.1 倾听共情 / §5.2.2 提问技术 / §5.2.3 语音微训练 1:1 wire.
 */
export enum TrainingExerciseType {
  /** 倾听共情 (V1.1 §5.2.1, 3 模式: 情绪反射 / 事实-评判分离 / 无建议挑战) */
  LISTENING = 'listening',
  /** 提问技术 (V1.1 §5.2.2, 4 项: 封闭转开放 / 一次一问 / 避免质问 / 聚焦话题) */
  QUESTIONING = 'questioning',
  /** 语音微训练 (V1.1 §5.2.3, 3 项: 语速控制 / 语气平稳 / 开口破冰) */
  VOICE_MICRO = 'voiceMicro',
}
