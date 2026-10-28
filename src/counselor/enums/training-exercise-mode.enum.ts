// V2026-10-19 治本 (V1.1 §5.2 企业级 — training_exercises.mode 10 档 enum, 1:1 wire §5.2 + V0.5 client 1:1 wire):
//   原因: counselor-mode-v1.1 §5.2 拍板专项技能 10 训练项 (倾听共情 3 + 提问技术
//     4 + 语音微训练 3), V0.5 stage 简化版 0 落地 1:1 阻断 §5.2 1:1 wire. 1:1 wire
//     §5.2.1/5.2.2/5.2.3 拍板 10 子模式命名, 跟 TrainingExerciseType 3 档
//     (listening/questioning/voiceMicro) 1:1 wire 嵌套关系 (1 type → N mode).
//     跟 xin_su_app V0.5 治本 V2026-10-19 落地 TrainingExerciseMode 10 档 1:1 wire.
//   修法: 加 TrainingExerciseMode 10 档 enum (3 + 4 + 3, 1:1 wire §5.2 拍板 10
//     子模式), 跟 V0.5 counselor_training_session.entity.ts V2026-10-19 治本
//     V8.3 拍板 TrainingSessionStatus 5 档 1:1 wire 风格 (snake_case enum 字符串).
//   反双胞胎:
//     - 不用 "other" 兜底值: V1.x 续做时第 11 项 + 直接加 enum 值, 防 enum drift
//     - 不用 string 拼接: enum 字符串 1:1 wire 跟 V0.5 client 1:1 wire 同步
//     - 不用 "未分类" 兜底: 10 训练项全覆盖 1:1 wire §5.2 拍板, V0.5 stage 简化
//       0 占位 (大炮 16:10 "A, 要企业级的方案, 不要凑活" 1:1 落地)
//   验证: 1. tsc 0 错 2. 大炮跑 pnpm migration:run + 10 子模式 seed 数据 1:1 wire
//     §5.2.1/5.2.2/5.2.3 全覆盖 (Phase 2 1:1 wire 拍板).
//   时间戳: 2026-10-19

/**
 * 训练题子模式 10 档 (V1.1 §5.2 拍板 1:1 wire, 跟 xin_su_app TrainingExerciseMode 1:1 wire).
 *
 * 1:1 wire §5.2.1/5.2.2/5.2.3 10 训练项:
 *   - listening 3 模式: emotionReflection / factFeelingSeparation / noAdviceChallenge
 *   - questioning 4 项: closedToOpen / oneAtATime / avoidInterrogation / focusTopic
 *   - voiceMicro 3 项: speechRate / toneStability / iceBreaking
 */
export enum TrainingExerciseMode {
  // ─── 倾听共情 3 模式 (V1.1 §5.2.1) ───
  /** 情绪反射练习 */
  EMOTION_REFLECTION = 'emotionReflection',
  /** 事实-评判分离练习 */
  FACT_FEELING_SEPARATION = 'factFeelingSeparation',
  /** 无建议挑战 */
  NO_ADVICE_CHALLENGE = 'noAdviceChallenge',

  // ─── 提问技术 4 项 (V1.1 §5.2.2) ───
  /** 封闭式转开放式提问练习 */
  CLOSED_TO_OPEN = 'closedToOpen',
  /** 一次一问训练 */
  ONE_AT_A_TIME = 'oneAtATime',
  /** 避免质问式表达练习 */
  AVOID_INTERROGATION = 'avoidInterrogation',
  /** 聚焦话题训练 */
  FOCUS_TOPIC = 'focusTopic',

  // ─── 语音微训练 3 项 (V1.1 §5.2.3) ───
  /** 语速控制: 训练每分钟 120-140 字专业语速 */
  SPEECH_RATE = 'speechRate',
  /** 语气平稳: 模拟来访者激动场景, 训练语气稳定 */
  TONE_STABILITY = 'toneStability',
  /** 开口破冰: 模拟沉默场景, 练习自然开场 */
  ICE_BREAKING = 'iceBreaking',
}
