// V2026-10-22 治本 (V1.3 §7.6 P3-c — 练习基本功 → 五维画像子指标 的映射):
//   原因: spec §7.6 P3-c 拍板「attempt 回写五维画像」, §4 的对账表也写了
//     「本文 attempts 后续可回灌 errorCategories (V2)」. 也就是说: 练习记录不只
//     是"练过没练过"的历史, 它还应该**反过来喂养**用户的能力雷达.
//     但"哪个基本功对应画像里的哪个子指标"这件事必须**显式写死**:
//       - 不写死 → 就要在运行时靠字符串模糊匹配去猜, 猜错就把信号灌进了
//         不相关的维度 (比如把"避免质问"灌进"共情精准度"), 雷达图从此不可信
//       - 写死在这张表里 → 改映射是改一行常量, 可审阅、可回溯
//
//   修法: 10 档基本功 → ability_dimensions.sub_indicator_code 的显式映射表.
//     映射口径说明:
//       - 倾听共情 3 档 → BASIC_SKILL 下的 3 个子指标 (共情精准度 / 倾听准确率 / 边界意识)
//       - 提问技术 4 档 → 提问开放度 / 倾听准确度 (多个基本功可以喂同一个子指标:
//         封闭转开放 / 一次一问 / 避免质问 练的都是"开放式提问占比"这同一件事)
//       - 语音微训练 3 档 → VOICE 下的 3 个子指标 (语速 / 语调平稳度 / 沉默应对)
//
//   反双胞胎:
//     - 不新建 ability_dimensions 行: 画像的 28 子指标是既有基线 (counselor-mode-v1.0 §5.1),
//       练习只是**喂数据**进去, 不该顺手改画像的维度定义
//     - 不把映射写进 ability.service: 那是"画像的读写", 这里是"练习的语义",
//       放练习域 config 里, 依赖方向是练习 → 画像, 不反向
//     - 不做 1:1 强行铺满: 10 档基本功 → 8 个子指标 (提问技术 4 档共用 2 个),
//       因为"一次一问"和"封闭转开放"确实练的是同一件事, 硬拆成两个维度反而稀释信号
//
//   验证:
//     1. tsc 0 错 (Record<TrainingExerciseMode, string> 缺档即编译报错)
//     2. 每个映射值都能在 ability_dimensions.sub_indicator_code 里找到
//
//   时间戳: 2026-10-22
import { TrainingExerciseMode } from '../enums/training-exercise-mode.enum';

/**
 * 基本功 → 能力子指标 code 的映射 (10 档全覆盖).
 *
 * 值必须是 `ability_dimensions.sub_indicator_code` 里真实存在的 code,
 * 否则回写时会因为找不到维度而静默丢弃 (见 practice-ability-sync.service.ts).
 */
export const PRACTICE_MODE_ABILITY_MAPPING: Record<TrainingExerciseMode, string> = {
  // ─── 倾听共情 3 模式 ───
  [TrainingExerciseMode.EMOTION_REFLECTION]: 'skill_empathy_precision',
  [TrainingExerciseMode.FACT_FEELING_SEPARATION]: 'skill_listening_accuracy',
  [TrainingExerciseMode.NO_ADVICE_CHALLENGE]: 'skill_boundary_awareness',
  // ─── 提问技术 4 模式 ───
  [TrainingExerciseMode.CLOSED_TO_OPEN]: 'skill_questioning_openness',
  [TrainingExerciseMode.ONE_AT_A_TIME]: 'skill_questioning_openness',
  [TrainingExerciseMode.AVOID_INTERROGATION]: 'skill_questioning_openness',
  [TrainingExerciseMode.FOCUS_TOPIC]: 'skill_listening_accuracy',
  // ─── 语音微训练 3 模式 ───
  [TrainingExerciseMode.SPEECH_RATE]: 'voice_avg_speed',
  [TrainingExerciseMode.TONE_STABILITY]: 'voice_tone_stability',
  [TrainingExerciseMode.ICE_BREAKING]: 'voice_silence_handling',
};

/**
 * 取某个基本功对应的能力子指标 code.
 *
 * @param mode 基本功
 * @returns 子指标 code (映射表全覆盖, 理论恒有值)
 */
export function abilityDimensionCodeOfMode(mode: TrainingExerciseMode): string {
  return PRACTICE_MODE_ABILITY_MAPPING[mode];
}
