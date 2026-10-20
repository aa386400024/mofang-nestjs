// V2026-10-20 治本 (专项技能训练中心改版 — 10 训练项展示元数据, 1:1 PRD §5.2):
//   原因: 设计规格 §3.1 审计结论 — 现状 UI 里 TrainingExerciseMode 10 档「全程隐形」,
//     只按 type 3 tab + difficulty 分组, mode 维度从未暴露给用户. 改版后 mode 是
//     页面原子单位, 必须有稳定的中文名/说明/归属校验.
//   修复: 定义 TRAINING_EXERCISE_TYPE_META (3) + TRAINING_EXERCISE_MODE_META (10),
//         提供 mode → type 的反向归属表 (运行时断言 seed 数据未 drift).
//   反双胞胎:
//     - 不写进 training_exercises 表 (展示文案属应用层, 换文案不该 migration)
//     - 不放在前端 (客户端与 server 双份文案必然 drift, server 为单一事实源)
//   验证: tsc 0 错 + MODES_BY_TYPE 三个 key 的 count 分别为 3/4/3.
//   时间戳: 2026-10-20
import { TrainingExerciseMode } from '../enums/training-exercise-mode.enum';
import { TrainingExerciseType } from '../enums/training-exercise-type.enum';

export interface TrainingExerciseTypeMeta {
  /** 中文标题, 跟设计规格 §4.1 区块头一致 */
  title: string;
  /** 区块副标题: 概括该类训练项 */
  subtitle: string;
  /** Material icon 名, 前端按名映射 IconData (跨端不传 IconData 本身) */
  icon: string;
}

export interface TrainingExerciseModeMeta {
  /** 中文名, 设计规格 §4.2 mode 行标题 */
  label: string;
  /** 归属的 type, 用于 seed 数据漂移校验 */
  type: TrainingExerciseType;
  /** 一句话说明, 跟 mode 行「约 N 分钟」并列展示 */
  summary: string;
}

export const TRAINING_EXERCISE_TYPE_META: Record<TrainingExerciseType, TrainingExerciseTypeMeta> = {
  [TrainingExerciseType.LISTENING]: {
    title: '倾听共情',
    subtitle: '情绪反射 · 事实评判分离 · 无建议挑战',
    icon: 'hearing_outlined',
  },
  [TrainingExerciseType.QUESTIONING]: {
    title: '提问技术',
    subtitle: '封闭转开放 · 一次一问 · 聚焦话题',
    icon: 'help_outline',
  },
  [TrainingExerciseType.VOICE_MICRO]: {
    title: '语音微训练',
    subtitle: '语速控制 · 语气平稳 · 开口破冰',
    icon: 'mic_none',
  },
};

export const TRAINING_EXERCISE_MODE_META: Record<TrainingExerciseMode, TrainingExerciseModeMeta> = {
  [TrainingExerciseMode.EMOTION_REFLECTION]: {
    label: '情绪反射练习',
    type: TrainingExerciseType.LISTENING,
    summary: '把来访者说的事件, 翻译成他此刻的情绪并还回去',
  },
  [TrainingExerciseMode.FACT_FEELING_SEPARATION]: {
    label: '事实-评判分离',
    type: TrainingExerciseType.LISTENING,
    summary: '拆开「我看到的事实」和「我给出的评价」',
  },
  [TrainingExerciseMode.NO_ADVICE_CHALLENGE]: {
    label: '无建议挑战',
    type: TrainingExerciseType.LISTENING,
    summary: '来访者求建议时, 如何不越位地接住',
  },
  [TrainingExerciseMode.CLOSED_TO_OPEN]: {
    label: '封闭转开放式提问',
    type: TrainingExerciseType.QUESTIONING,
    summary: '把「是/不是」问题改成可展开的问题',
  },
  [TrainingExerciseMode.ONE_AT_A_TIME]: {
    label: '一次一问',
    type: TrainingExerciseType.QUESTIONING,
    summary: '避免连续追问压到来访者, 一次只推进一件事',
  },
  [TrainingExerciseMode.AVOID_INTERROGATION]: {
    label: '避免质问式表达',
    type: TrainingExerciseType.QUESTIONING,
    summary: '把「你为什么」换成不会激起防御的说法',
  },
  [TrainingExerciseMode.FOCUS_TOPIC]: {
    label: '聚焦话题',
    type: TrainingExerciseType.QUESTIONING,
    summary: '来访者跑题时, 不打断地把他带回主线',
  },
  [TrainingExerciseMode.SPEECH_RATE]: {
    label: '语速控制',
    type: TrainingExerciseType.VOICE_MICRO,
    summary: '稳定在每分钟 120-140 字的专业区间',
  },
  [TrainingExerciseMode.TONE_STABILITY]: {
    label: '语气平稳',
    type: TrainingExerciseType.VOICE_MICRO,
    summary: '来访者激动时, 语调基频保持稳定',
  },
  [TrainingExerciseMode.ICE_BREAKING]: {
    label: '开口破冰',
    type: TrainingExerciseType.VOICE_MICRO,
    summary: '面对沉默的来访者, 自然地开场',
  },
};

/** type → 该 type 下所有 mode. 设计规格 §4.1 的 3 区块结构由此派生. */
export const TRAINING_EXERCISE_MODES_BY_TYPE: Record<TrainingExerciseType, TrainingExerciseMode[]> = {
  [TrainingExerciseType.LISTENING]: [
    TrainingExerciseMode.EMOTION_REFLECTION,
    TrainingExerciseMode.FACT_FEELING_SEPARATION,
    TrainingExerciseMode.NO_ADVICE_CHALLENGE,
  ],
  [TrainingExerciseType.QUESTIONING]: [
    TrainingExerciseMode.CLOSED_TO_OPEN,
    TrainingExerciseMode.ONE_AT_A_TIME,
    TrainingExerciseMode.AVOID_INTERROGATION,
    TrainingExerciseMode.FOCUS_TOPIC,
  ],
  [TrainingExerciseType.VOICE_MICRO]: [
    TrainingExerciseMode.SPEECH_RATE,
    TrainingExerciseMode.TONE_STABILITY,
    TrainingExerciseMode.ICE_BREAKING,
  ],
};
