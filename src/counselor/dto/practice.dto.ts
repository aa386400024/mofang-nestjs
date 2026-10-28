// V2026-10-22 治本 (V1.3 §3 — 微技能自由练习 API 契约 DTO, 1:1 wire §3.1-§3.5):
//   原因: spec §3 拍板 5 个端点的 REST 契约 (进度聚合 / 取场景 / 提交评判 /
//     随机抽练 / 自定义场景). 这些 DTO 是**前后端唯一契约面**, 任何字段改名都会
//     同时打断客户端 dart model 与服务端. 故集中定义 + 全部标 swagger 注解,
//     便于在 Control UI / swagger 页直接核对契约.
//   修法: 一份 DTO 文件覆盖 5 个端点的入参与出参, 命名与 spec §3 字段逐字对齐.
//   反双胞胎:
//     - **不下发分数**: 全部出参 DTO 均无 score / isCorrect / grade 字段
//       (spec §6.2「practice_attempts 不下发分数; 任何『评级』文案不进响应」).
//       这一条是**结构级**保证: 契约里没有这个字段, 客户端就不可能渲染出"0 分"
//     - 不回传 rubric 原文到列表 / 详情: rubric 是评判内部锚点, 下发会让客户端
//       有机会自己算分, 破坏零压红线; 只在评判结果里体现技术批注
//     - 不用 class-validator 装饰 json 内部结构: 见 domain/practice/practice.types.ts
//   验证:
//     1. tsc 0 错
//     2. swagger 页面 5 个端点的字段与 spec §3 逐字段对齐
//     3. 全仓 grep 'score' 于本文件 → 0 命中 (零压红线结构级校验)
//
//   时间戳: 2026-10-22
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

import { PracticeCustomScenarioDegradeReason } from '../config/practice-custom-scenario.config';
import type { PracticeScenarioPersona } from '../domain/practice/practice.types';
import { PracticeDefenseStyle } from '../enums/practice-defense-style.enum';
import { PRACTICE_DIFFICULTY_VALUES, PracticeDifficulty } from '../enums/practice-difficulty.enum';
import { PracticeEmotionIntensity } from '../enums/practice-emotion-intensity.enum';
import { PracticeEngine } from '../enums/practice-engine.enum';
import { PracticeFeedbackSource } from '../enums/practice-feedback-source.enum';
import { PracticeFeedbackTone } from '../enums/practice-feedback-tone.enum';
import { PracticeRubricCheck } from '../enums/practice-rubric-check.enum';
import {
  PRACTICE_SCENARIO_ORIGIN_VALUES,
  PRACTICE_SCENARIO_SOURCE_VALUES,
  PracticeScenarioOrigin,
  PracticeScenarioSource,
} from '../enums/practice-scenario-source.enum';
import { TrainingExerciseMode } from '../enums/training-exercise-mode.enum';
import { TrainingExerciseType } from '../enums/training-exercise-type.enum';

const MODE_VALUES = Object.values(TrainingExerciseMode);
const TYPE_VALUES = Object.values(TrainingExerciseType);
const ENGINE_VALUES = Object.values(PracticeEngine);
const DIFFICULTY_VALUES = [...PRACTICE_DIFFICULTY_VALUES];
const DEFENSE_STYLE_VALUES = Object.values(PracticeDefenseStyle);
const EMOTION_INTENSITY_VALUES = Object.values(PracticeEmotionIntensity);
const FEEDBACK_TONE_VALUES = Object.values(PracticeFeedbackTone);
const FEEDBACK_SOURCE_VALUES = Object.values(PracticeFeedbackSource);

/** 单次作答提交的最大文本长度 (字). 超长会挤爆 LLM 上下文, 且练习场景不需要长文. */
export const PRACTICE_SUBMITTED_TEXT_MAX_LENGTH = 2000;

/** 单次作答的最大耗时 (秒). 8 小时 = 28800s 上限, 远超任何一次微练习. */
export const PRACTICE_DURATION_MAX_SECONDS = 28_800;

/** P2 多轮: 单个场景允许的最大往返轮数. */
export const PRACTICE_MAX_TURN = 5;

// ════════════════════════════════════════════════════════════════════════════
// §3.1 GET /counselor/practice/progress
// ════════════════════════════════════════════════════════════════════════════

export class PracticeScenarioVariantDto {
  @ApiProperty({ description: '场景 id (UUID)', example: '0f1c8f4e-7a1b-4a1e-9f2e-8b7c6d5e4f3a' })
  scenarioId!: string;

  @ApiProperty({ description: '稳定场景 slug (对外契约, 改名等同换场景)', example: 'emotion_reflection_l1_01' })
  scenarioKey!: string;

  @ApiProperty({ description: '难度梯 1/2/3', enum: DIFFICULTY_VALUES, example: 1 })
  difficulty!: PracticeDifficulty;

  @ApiProperty({ description: '难度梯中文名 (server 单一事实源)', example: '入门' })
  difficultyLabel!: string;

  @ApiProperty({ description: '来访者称呼', example: '阿宁' })
  personaName!: string;

  @ApiProperty({ description: '来访者一句话背景', example: '和伴侣异地三年, 最近项目加班' })
  personaNote!: string;

  @ApiProperty({ description: '来访者开场白 (气泡直接展示)', example: '我知道说出来也没什么用，但最近确实有点撑不住。' })
  openingLine!: string;

  @ApiProperty({ description: '是否练过 (存在已落库的评判记录)', example: false })
  completed!: boolean;

  @ApiProperty({ description: '累计练习次数', example: 3 })
  attemptCount!: number;

  @ApiProperty({ description: '最近一次练习时间 (ISO 8601, 未练习时 null)', nullable: true, example: '2026-10-22T08:30:00.000Z' })
  lastPracticedAt!: string | null;

  @ApiProperty({
    description: '场景来源表 (seed = 标准内容库; custom = 我的真实场景). V1.3 §7.5',
    enum: PRACTICE_SCENARIO_SOURCE_VALUES,
    example: 'seed',
  })
  scenarioSource!: PracticeScenarioSource;
}

export class PracticeModeProgressDto {
  @ApiProperty({ description: '基本功 (10 档)', enum: MODE_VALUES, example: 'emotionReflection' })
  mode!: TrainingExerciseMode;

  @ApiProperty({ description: '基本功中文名 (server 单一事实源)', example: '情绪反射练习' })
  modeLabel!: string;

  @ApiProperty({ description: '归属训练类型', enum: TYPE_VALUES, example: 'listening' })
  type!: TrainingExerciseType;

  @ApiProperty({ description: '三引擎 (接话演练 / 改写工坊 / 语音微训练)', enum: ENGINE_VALUES, example: 'aiResponse' })
  engine!: PracticeEngine;

  @ApiProperty({ description: '该基本功下的全部场景变体', type: [PracticeScenarioVariantDto] })
  variants!: PracticeScenarioVariantDto[];
}

export class PracticeProgressSummaryDto {
  @ApiProperty({ description: '场景总数 (含用户自建)', example: 60 })
  totalScenarios!: number;

  @ApiProperty({ description: '已练过的场景数', example: 12 })
  completedScenarios!: number;

  @ApiProperty({ description: '累计练习次数', example: 27 })
  totalAttempts!: number;

  @ApiProperty({ description: '最近 7 天有练习的自然天数 (非连续, 避免打卡压力)', example: 3 })
  activeDaysLast7d!: number;
}

export class PracticeProgressDto {
  @ApiProperty({ description: '汇总指标', type: PracticeProgressSummaryDto })
  summary!: PracticeProgressSummaryDto;

  @ApiProperty({ description: '逐基本功进度 (固定 10 个基本功, 未练习也返回)', type: [PracticeModeProgressDto] })
  modes!: PracticeModeProgressDto[];

  @ApiProperty({
    description: '弱项推荐: 全 mode 中练习次数最少的 3 个 (含从未练的), 供列表置顶',
    enum: MODE_VALUES,
    example: ['noAdviceChallenge', 'closedToOpen', 'speechRate'],
  })
  weakModes!: TrainingExerciseMode[];

  @ApiProperty({ description: '随机入口可用的下一个场景 id (服务端混洗)', example: '0f1c8f4e-7a1b-4a1e-9f2e-8b7c6d5e4f3a' })
  nextRandomScenarioId!: string;
}

// ════════════════════════════════════════════════════════════════════════════
// §3.2 GET /counselor/practice/scenarios/:scenarioId
// ════════════════════════════════════════════════════════════════════════════

export class PracticeScenarioPersonaDto {
  @ApiProperty({ description: '来访者称呼', example: '阿宁' })
  name!: string;

  @ApiProperty({ description: '年龄', example: 26 })
  age!: number;

  @ApiProperty({ description: '性别', example: '女' })
  gender!: string;

  @ApiProperty({ description: '职业', example: '电商运营' })
  occupation!: string;

  @ApiProperty({ description: '防御风格', enum: DEFENSE_STYLE_VALUES, example: 'cooperative' })
  defenseStyle!: PracticeDefenseStyle;

  @ApiProperty({ description: '情绪负荷', enum: EMOTION_INTENSITY_VALUES, example: 'calm' })
  emotionIntensity!: PracticeEmotionIntensity;

  @ApiProperty({ description: '一两句背景' })
  background!: string;
}

export class PracticeScenarioDetailDto {
  @ApiProperty({ description: '场景 id (UUID)' })
  scenarioId!: string;

  @ApiProperty({ description: '基本功 (10 档)', enum: MODE_VALUES })
  exerciseMode!: TrainingExerciseMode;

  @ApiProperty({ description: '基本功中文名', example: '情绪反射练习' })
  modeLabel!: string;

  @ApiProperty({ description: '归属训练类型', enum: TYPE_VALUES })
  type!: TrainingExerciseType;

  @ApiProperty({ description: '三引擎', enum: ENGINE_VALUES })
  engine!: PracticeEngine;

  @ApiProperty({ description: '引擎中文名 (server 单一事实源)', example: '接话演练' })
  engineLabel!: string;

  @ApiProperty({
    description: '引擎一句话引导 (server 单一事实源)',
    example: '写下你会如何回应，不做对错判定，只看技术动作',
  })
  engineIntro!: string;

  @ApiProperty({ description: '难度梯 1/2/3', enum: DIFFICULTY_VALUES })
  difficulty!: PracticeDifficulty;

  @ApiProperty({ description: '难度梯中文名 (server 单一事实源)', example: '入门' })
  difficultyLabel!: string;

  @ApiProperty({ description: '来访者画像', type: PracticeScenarioPersonaDto })
  persona!: PracticeScenarioPersonaDto;

  @ApiProperty({ description: '来访者开场白 (气泡直接展示)' })
  openingLine!: string;

  @ApiProperty({ description: '训练任务说明 (给用户看的一句话)' })
  taskPrompt!: string;

  @ApiProperty({ description: '改写工坊专用: 被砸了的原话 (非改写场景为 null)', nullable: true })
  botchedUtterance!: string | null;

  @ApiProperty({ description: '语音微训练专用: 要求朗读的文本 (非语音场景为 null)', nullable: true })
  voiceScript!: string | null;

  @ApiProperty({ description: '该用户在本场景已练次数 + 1 (第几次作答)', example: 1 })
  attemptOrdinal!: number;

  @ApiProperty({ description: '期望的往返轮数 (P2 多轮; 单轮场景恒为 1)', example: 1 })
  expectedTurns!: number;

  @ApiProperty({
    description: '场景来源表 (seed = 标准内容库; custom = 我的真实场景). V1.3 §7.5',
    enum: PRACTICE_SCENARIO_SOURCE_VALUES,
    example: 'seed',
  })
  scenarioSource!: PracticeScenarioSource;

  @ApiProperty({ description: '是否用户私有场景 (等价于 scenarioSource === custom)', example: false })
  isCustom!: boolean;

  @ApiProperty({
    description: '内容出处 (user_generated = 用户描述 + AI 生成; standard_library = 标准题库)',
    enum: PRACTICE_SCENARIO_ORIGIN_VALUES,
    example: 'standard_library',
  })
  origin!: PracticeScenarioOrigin;

  @ApiProperty({
    description: 'L3 高情绪负荷场景的知情同意式铺垫文案 (非 L3 场景为 null, 前端弹轻提示不阻挡)',
    nullable: true,
    example: '这是一个情绪负荷较高的场景，可以随时退出，不用有压力。',
  })
  highLoadNotice!: string | null;
}

// ════════════════════════════════════════════════════════════════════════════
// §3.3 POST /counselor/practice/scenarios/:scenarioId/evaluate
// ════════════════════════════════════════════════════════════════════════════

export class SubmitPracticeAttemptDto {
  @ApiProperty({
    description: '用户提交内容 (接话 = 回应文本; 改写 = 改写后文本; 语音 = ASR 转写文本, 允许空串表示未识别)',
    example: '听起来你这阵子是真的很累，脑子一直转停不下来。',
  })
  @IsString()
  @MaxLength(PRACTICE_SUBMITTED_TEXT_MAX_LENGTH)
  submittedText!: string;

  @ApiPropertyOptional({ description: '录音时长 (秒, 语音引擎专用)', required: false, example: 42 })
  @IsOptional()
  @IsInt()
  // §8.5 B3 治本 — 明确 0 的语义: 0 = "本次没有录到有效音频"
  //   (例如用户点错了没说话, 或客户端拿不到时长). 它是**合法值**, 不是异常输入:
  //   服务端据此**不折算语速** (没有时长就没有"字/分"可言), 评判时只出
  //   ℹ️ 技术提示. 真正非法的输入是负数, 由 @Min(0) 拦掉.
  @Min(0)
  @Max(PRACTICE_DURATION_MAX_SECONDS)
  recordSeconds?: number;

  @ApiProperty({ description: '本次作答耗时 (秒)', example: 68 })
  @IsInt()
  // §8.5 B3 治本 — 明确 0 的语义: 0 = "提交快到来不及计时" (用户秒答秒交),
  //   属于合法值, 统计时按 0 计入平均耗时即可, 不代表数据异常.
  @Min(0)
  @Max(PRACTICE_DURATION_MAX_SECONDS)
  durationSeconds!: number;

  @ApiPropertyOptional({
    description: '第几轮 (P2 多轮; 缺省为 1 = 单轮作答)',
    required: false,
    example: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(PRACTICE_MAX_TURN)
  turn?: number;
}

export class PracticeFeedbackItemDto {
  @ApiProperty({ description: '批注语气三态 (✅ 动作达成 / ⚠️ 可以留意 / ℹ️ 技术提示)', enum: FEEDBACK_TONE_VALUES, example: 'positive' })
  tone!: PracticeFeedbackTone;

  @ApiProperty({ description: '语气对应的图标 (server 单一事实源, 客户端不二次定义)', example: '✅' })
  icon!: string;

  @ApiProperty({ description: '锚定的 rubric 维度 key', example: 'namesEmotion' })
  dimensionKey!: string;

  @ApiProperty({ description: '批注文案 (只做技术描述, 不评价人)' })
  text!: string;
}

export class PracticeFeedbackDto {
  @ApiProperty({ description: '技术批注清单 (3-5 条)', type: [PracticeFeedbackItemDto] })
  items!: PracticeFeedbackItemDto[];

  @ApiProperty({ description: '参考回应 (可以参考这样回应)' })
  referenceResponse!: string;

  @ApiProperty({ description: '常见偏差 (留意避免)', type: [String] })
  commonPitfalls!: string[];

  @ApiProperty({ description: '该用户在本场景的第几次作答', example: 2 })
  attemptOrdinal!: number;

  @ApiProperty({
    description: '产出来源 (keyword = 确定性关键词判定; llm = 模型结构化输出)',
    enum: FEEDBACK_SOURCE_VALUES,
    example: 'llm',
  })
  source!: PracticeFeedbackSource;

  @ApiProperty({
    description: 'P2 多轮: AI 来访者对用户这一轮的情绪反应 (单轮场景恒为 null)',
    nullable: true,
  })
  visitorReaction!: string | null;
}

export class PracticeEvaluationResultDto {
  @ApiProperty({ description: '练习记录 id (UUID)' })
  attemptId!: string;

  @ApiProperty({ description: '零压批注反馈', type: PracticeFeedbackDto })
  feedback!: PracticeFeedbackDto;
}

// ════════════════════════════════════════════════════════════════════════════
// §3.4 POST /counselor/practice/random
// ════════════════════════════════════════════════════════════════════════════

export class RandomPracticeScenarioDto {
  @ApiPropertyOptional({
    description: '避开某个基本功 (可选: 避开当前正在练的 mode)',
    required: false,
    enum: MODE_VALUES,
  })
  @IsOptional()
  @IsIn(MODE_VALUES)
  exceptMode?: TrainingExerciseMode;
}

export class RandomPracticeScenarioResultDto {
  @ApiProperty({ description: '随机选中的场景 id, 直接交给 §3.2 取场景' })
  scenarioId!: string;
}

// ════════════════════════════════════════════════════════════════════════════
// §3.5 POST /counselor/practice/custom-scenarios
// ════════════════════════════════════════════════════════════════════════════

/**
 * 去除首尾空白 (trim).
 *
 * §8.5 B2 治本: 原来的 `@MinLength(10)` 允许「十个空格」通过校验 ——
 * 用户看起来填了内容, 实际是个空字符串. 治本做法是**先 trim 再校验**,
 * 让"看起来有内容但其实是空白"在入口就被挡掉, 而不是白烧一次 LLM 调用.
 */
const Trim = () => Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

/**
 * 可选字符串的 trim + 空串归一为 undefined.
 *
 * 为什么需要空串归一: 客户端常把"没填"的输入框序列化成 `""` 而不是省略字段.
 * 若只做 trim, `""` 会被 `@IsUUID()` 判成格式非法 → 400 —— 而用户的真实意图
 * 是"我没填这栏". 归一为 undefined 后, `@IsOptional()` 才会正确地跳过校验.
 */
const OptionalTrim = () =>
  Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') {
      return value;
    }
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  });

export class CreateCustomPracticeScenarioDto {
  @ApiProperty({ description: '归属基本功 (10 档)', enum: MODE_VALUES, example: 'emotionReflection' })
  @IsIn(MODE_VALUES)
  mode!: TrainingExerciseMode;

  @ApiProperty({
    description: '用户描述的真实情况 (例: "我今天遇到一个回避型来访, 谈20分钟就沉默")',
    example: '我今天遇到一个回避型来访，谈了20分钟他就一直沉默，我不知道怎么接。',
  })
  @Trim()
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  situation!: string;
}

export class CustomPracticeScenarioResultDto {
  @ApiProperty({ description: '生成的场景 id, 直接交给 §3.2 取场景' })
  scenarioId!: string;
}

// ════════════════════════════════════════════════════════════════════════════
// §7.2 POST /counselor/practice/scenarios:generate
// ════════════════════════════════════════════════════════════════════════════

/** 用户三问表单的文本长度上限 (字). */
export const PRACTICE_CUSTOM_QUOTE_MAX_LENGTH = 2000;

/** 用户三问表单的文本长度下限 (字; trim 后). */
export const PRACTICE_CUSTOM_QUOTE_MIN_LENGTH = 2;

export class GenerateCustomPracticeScenarioDto {
  @ApiProperty({
    description: '来访者当时说了什么 / 什么反应 (必填; trim 后至少 2 字)',
    example: '他说我妈就是重男轻女，这么多年我怎么讨好都没用。',
  })
  @Trim()
  @IsString()
  @MinLength(PRACTICE_CUSTOM_QUOTE_MIN_LENGTH)
  @MaxLength(PRACTICE_CUSTOM_QUOTE_MAX_LENGTH)
  visitorQuote!: string;

  @ApiPropertyOptional({
    description: '你当时是怎么回应的 (可选; 用户可能只记得来访者说了啥)',
    required: false,
    example: '我说你已经做得很好了，他就不说话了。',
  })
  @IsOptional()
  @OptionalTrim()
  @IsString()
  @MaxLength(PRACTICE_CUSTOM_QUOTE_MAX_LENGTH)
  counselorReply?: string;

  @ApiPropertyOptional({
    description: '你觉得卡在哪 (可选; 枚举 + 自由补充)',
    required: false,
    example: '接不住，说完就冷场了。',
  })
  @IsOptional()
  @OptionalTrim()
  @IsString()
  @MaxLength(PRACTICE_CUSTOM_QUOTE_MAX_LENGTH)
  stuckPoint?: string;

  @ApiPropertyOptional({
    description: '这主要在练哪项基本功 (可选; 传 training_exercises 的 id, 不传则由服务端/模型判断)',
    required: false,
    example: '33333333-3333-3333-3333-333333333331',
  })
  @IsOptional()
  @OptionalTrim()
  @IsString()
  @IsUUID()
  hintExerciseId?: string;
}

/**
 * 评判维度 (§7.2 响应体的 `content.dimensions[]`).
 *
 * 跟共享内容库的 rubric 维度 1:1 (同 key / label / positiveKeywords / antiKeywords / check),
 * 单独建 DTO 是因为出参里不叫 `positiveKeywords` —— 那会泄漏"判定依据"的名字,
 * 客户端只要知道每条维度的标题与命中措辞即可.
 */
export class CustomScenarioDimensionDto {
  @ApiProperty({ description: '维度稳定 key', example: 'namesEmotion' })
  key!: string;

  @ApiProperty({ description: '维度中文名', example: '说出了对方的情绪' })
  label!: string;

  @ApiProperty({ description: '命中即视为该动作达成的措辞', type: [String] })
  positiveKeywords!: string[];

  @ApiProperty({ description: '代表越位的措辞', type: [String] })
  antiKeywords!: string[];

  @ApiProperty({ description: '判定方式', enum: Object.values(PracticeRubricCheck), example: 'contains_any' })
  check!: PracticeRubricCheck;
}

/**
 * 场景内容块 (§7.2 响应体的 `content`).
 */
export class CustomScenarioContentDto {
  @ApiProperty({ description: '来访者第一句话 (忠实于用户描述的原意)', example: '我妈就是重男轻女，这么多年我怎么讨好都没用。' })
  visitorLine!: string;

  @ApiProperty({ description: '给练习者的一句话任务说明', example: '重新接一次这句话，这次不急着评价。' })
  taskPrompt!: string;

  @ApiProperty({ description: '评判维度 (3-5 条)', type: [CustomScenarioDimensionDto] })
  dimensions!: CustomScenarioDimensionDto[];

  @ApiProperty({ description: '可以参考这样回应 (可多条)', type: [String] })
  referenceResponses!: string[];

  @ApiProperty({ description: '常见偏差 (留意避免)', type: [String] })
  commonErrors!: string[];
}

/**
 * §7.2 场景生成响应体.
 *
 * `id` 与 `scenarioId` 同值: spec §7.2 的响应示例用 `id`, 而 §3.2 / §3.5 的
 * 路径参数与响应叫 `scenarioId` —— 同一份 spec 里两种叫法, 服务端**同时**给出,
 * 免得客户端两边猜 (猜错就是 404 / 取不到场景).
 */
export class GeneratedCustomPracticeScenarioDto {
  @ApiProperty({ description: '场景 id (UUID; 直接当作 §3.2 的 :scenarioId 传入)', example: '3f1c8f4e-7a1b-4a1e-9f2e-8b7c6d5e4f3a' })
  id!: string;

  @ApiProperty({ description: '场景 id (与 id 同值; 兼容 §3.2/§3.5 的 scenarioId 叫法)' })
  scenarioId!: string;

  @ApiProperty({
    description: '关联的 training_exercises id (未指定 hint 时为 null)',
    nullable: true,
    example: '33333333-3333-3333-3333-333333333331',
  })
  exerciseId!: string | null;

  @ApiProperty({ description: '难度梯 1/2/3', enum: DIFFICULTY_VALUES, example: 2 })
  difficulty!: PracticeDifficulty;

  @ApiProperty({ description: '来访者称呼 (脱敏后用代称)', example: '他' })
  personaName!: string;

  @ApiProperty({ description: '来访者背景注记 (只保留年龄/性别/议题类信息)', example: '28 岁男性，与母亲长期关系紧张' })
  personaNote!: string;

  @ApiProperty({ description: '三引擎 (aiResponse / rewrite / voiceMetric)', enum: ENGINE_VALUES, example: 'aiResponse' })
  type!: PracticeEngine;

  @ApiProperty({ description: '场景内容块', type: CustomScenarioContentDto })
  content!: CustomScenarioContentDto;

  @ApiProperty({ description: '是否用户私有场景', example: true })
  isCustom!: boolean;

  @ApiProperty({ description: '内容出处', enum: PRACTICE_SCENARIO_ORIGIN_VALUES, example: 'user_generated' })
  source!: PracticeScenarioOrigin;

  @ApiProperty({
    description: '是否走了降级路径 (true = 本次给的不是新生成的自定义场景, 而是标准题库里的一个)',
    example: false,
  })
  degraded!: boolean;

  @ApiProperty({
    description: '降级原因 (未降级时为 null): quota_exceeded / generation_unavailable / storage_limit_reached',
    nullable: true,
    enum: Object.values(PracticeCustomScenarioDegradeReason),
    example: null,
  })
  degradedReason!: PracticeCustomScenarioDegradeReason | null;
}

/**
 * §7.2 「我的真实场景」列表项 (不带 content 全文).
 */
export class CustomPracticeScenarioListItemDto {
  @ApiProperty({ description: '场景 id (UUID)' })
  id!: string;

  @ApiProperty({ description: '场景 id (与 id 同值)' })
  scenarioId!: string;

  @ApiProperty({ description: '关联的 training_exercises id', nullable: true })
  exerciseId!: string | null;

  @ApiProperty({ description: '归属基本功', enum: MODE_VALUES, example: 'emotionReflection' })
  mode!: TrainingExerciseMode;

  @ApiProperty({ description: '基本功中文名', example: '情绪反射练习' })
  modeLabel!: string;

  @ApiProperty({ description: '难度梯 1/2/3', enum: DIFFICULTY_VALUES, example: 2 })
  difficulty!: PracticeDifficulty;

  @ApiProperty({ description: '来访者称呼 (脱敏后用代称)', example: '他' })
  personaName!: string;

  @ApiProperty({ description: '来访者背景注记', example: '28 岁男性，与母亲长期关系紧张' })
  personaNote!: string;

  @ApiProperty({ description: '三引擎', enum: ENGINE_VALUES, example: 'aiResponse' })
  type!: PracticeEngine;

  @ApiProperty({
    description: '来访者第一句话 (摘要行; 完整内容点进去用 §3.2 取)',
    example: '我妈就是重男轻女，这么多年我怎么讨好都没用。',
  })
  visitorLine!: string;

  @ApiProperty({ description: '内容出处', enum: PRACTICE_SCENARIO_ORIGIN_VALUES, example: 'user_generated' })
  source!: PracticeScenarioOrigin;

  @ApiProperty({ description: '累计练习次数', example: 2 })
  attemptCount!: number;

  @ApiProperty({ description: '最近一次练习时间 (ISO 8601, 未练过为 null)', nullable: true })
  lastPracticedAt!: string | null;

  @ApiProperty({ description: '生成时间 (ISO 8601)', example: '2026-10-22T08:30:00.000Z' })
  createdAt!: string;
}

/**
 * §7.2 「我的真实场景」列表响应.
 */
export class CustomPracticeScenarioListDto {
  @ApiProperty({ description: '私有场景列表 (按最近练过倒序)', type: [CustomPracticeScenarioListItemDto] })
  items!: CustomPracticeScenarioListItemDto[];

  @ApiProperty({ description: '总条数', example: 3 })
  total!: number;
}

// ════════════════════════════════════════════════════════════════════════════
// 类型导出 (供 service 层复用, 避免 DTO 与内部类型两套)
// ════════════════════════════════════════════════════════════════════════════

export type { PracticeScenarioPersona };
