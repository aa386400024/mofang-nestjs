// V2026-10-22 治本 (V1.3 §1.1 — 三引擎枚举 + mode → engine 映射):
//   原因: spec §1.1 定义三引擎:
//     接话演练 (aiResponse) / 改写工坊 (rewrite) / 语音微训练 (voiceMetric),
//     明确「**后端不加 practiceMode 列**」—— 三引擎由现有 `type` 字段推导.
//     但 type 只有 3 档, 推导到引擎只能是粗粒度:
//       listening → aiResponse / questioning → rewrite / voiceMicro → voiceMetric
//     而客户端 (xin_su_app lib/features/counselor_training_exercise/domain/entities/
//     practice_mode.dart) 实际是**按 mode 细粒度**映射的:
//       emotionReflection → aiResponse / noAdviceChallenge → aiResponse
//       factFeelingSeparation → rewrite          (← 倾听类里也有改写场景)
//       closedToOpen → rewrite / avoidInterrogation → rewrite
//       oneAtATime → aiResponse / focusTopic → aiResponse
//       speechRate / toneStability / iceBreaking → voiceMetric
//     两套口径在 3 个 mode 上直接冲突 (factFeelingSeparation / closedToOpen /
//     avoidInterrogation). 若后端按 type 下发引擎, 客户端按 mode 渲染, 就会出现
//     "后端说是接话演练, 客户端渲染成改写工坊" 的错位.
//   修法:
//     - 定义 PracticeEngine 3 档 enum (字符串值 1:1 wire 客户端 PracticeMode)
//     - mode → engine 映射在**服务端**落地 (PRACTICE_MODE_ENGINE_META), 口径对齐
//       客户端既有映射 (客户端保留本地映射作为后端未上线期的降级)
//     - 不新增 DB 列: 引擎是 mode 的**派生属性**, 落库会产生第二事实源, mode 改了
//       引擎没改就会静默错位; 派生 + 服务端单一事实源才是治本
//
//   反双胞胎:
//     - 不加 practice_mode 列: spec §2.1/§1.1 明确「不新增 enum / 不加列」;
//       加列 = 内容库与代码双份映射, 违反单一事实源
//     - 不改前端映射: 本次只交付后端; 客户端既有映射保留为降级兜底
//     - 不用 type 粗粒度推导: 见上, 3 个 mode 会错位
//
//   验证:
//     1. tsc 0 错
//     2. PRACTICE_MODE_ENGINE_META 覆盖 TrainingExerciseMode 全部 10 档 (编译期穷尽)
//     3. mode → engine 映射与客户端 practice_mode.dart 逐档一致
//
//   时间戳: 2026-10-22

/**
 * 微技能练习三引擎 (V1.3 §1.1 拍板).
 *
 * 字符串值 1:1 wire xin_su_app PracticeMode.
 */
export enum PracticeEngine {
  /** 接话演练 —— 来访者说一句, 用户自己写一句回应 */
  AI_RESPONSE = 'aiResponse',
  /** 改写工坊 —— 给出砸了的原话, 用户改写 */
  REWRITE = 'rewrite',
  /** 语音微训练 —— 朗读/录音任务, 结束后给技术批注 */
  VOICE_METRIC = 'voiceMetric',
}

/** 引擎展示文案 (server 单一事实源). */
export const PRACTICE_ENGINE_LABELS: Record<PracticeEngine, string> = {
  [PracticeEngine.AI_RESPONSE]: '接话演练',
  [PracticeEngine.REWRITE]: '改写工坊',
  [PracticeEngine.VOICE_METRIC]: '语音微训练',
};

/** 引擎一句话引导 (server 单一事实源). */
export const PRACTICE_ENGINE_INTROS: Record<PracticeEngine, string> = {
  [PracticeEngine.AI_RESPONSE]: '写下你会如何回应，不做对错判定，只看技术动作',
  [PracticeEngine.REWRITE]: '把这句砸了的话重写一遍，再看技术批注',
  [PracticeEngine.VOICE_METRIC]: '按任务开口说一段，结束后给你技术批注',
};
