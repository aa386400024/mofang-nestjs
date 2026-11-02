// V2026-10-20 治本 (专项技能训练中心改版 — 训练题 / 进度 DTO, 1:1 设计规格 §4/§5/§10):
//   原因: 原 counselor-training.controller 只暴露 overview 一个端点 (纯 mock),
//     客户端进度、评分、历史全靠内存 mock 拼 — 刷新即丢, 且随机分无法复盘.
//     设计规格 §10 性能预算明确要求「单次请求聚合, 禁止 N 次 per-mode 请求」,
//     因此 progress 端点必须一次返回 summary + 全部 mode 项.
//   修复: 定义 exercise / progress / attempt 三组 DTO, 汇总与明细分离.
//   反双胞胎:
//     - 不把 rubric.correctOptionIndex 直接下发 (防前端拿到答案; 仅 submit 后返回对错)
//     - 不在 progress 里回传 options / scenarioContext (列表页不需要, 减少载荷)
//   验证: tsc 0 错 + 前端 model 与本文件字段名逐一对齐.
//   时间戳: 2026-10-20
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

import { COUNSELOR_UI_PREFERENCE_DEFAULTS, CounselorUiPreferenceKey } from '../enums/counselor-ui-preference-key.enum';
import { TrainingAttemptStatus } from '../enums/training-attempt-status.enum';
import { TrainingDifficulty } from '../enums/training-difficulty.enum';
import { TrainingExerciseMode } from '../enums/training-exercise-mode.enum';
import { TrainingExerciseType } from '../enums/training-exercise-type.enum';

const TYPE_VALUES = Object.values(TrainingExerciseType);
const MODE_VALUES = Object.values(TrainingExerciseMode);
const DIFFICULTY_VALUES = Object.values(TrainingDifficulty);
const ATTEMPT_STATUS_VALUES = Object.values(TrainingAttemptStatus);

// ═══════════════════ 训练题明细 ═══════════════════

export class TrainingExerciseDto {
  @ApiProperty({ description: '训练题 id (UUID)', example: '0f1c8f4e-7a1b-4a1e-9f2e-8b7c6d5e4f3a' })
  id!: string;

  @ApiProperty({ description: '训练类型', enum: TYPE_VALUES })
  type!: TrainingExerciseType;

  @ApiProperty({ description: '训练项 (10 档, 页面原子单位)', enum: MODE_VALUES })
  mode!: TrainingExerciseMode;

  @ApiProperty({ description: '训练项中文名 (server 单一事实源, 客户端不二次定义)', example: '情绪反射练习' })
  modeLabel!: string;

  @ApiProperty({ description: '训练项一句话说明', example: '把来访者说的事件, 翻译成他此刻的情绪并还回去' })
  modeSummary!: string;

  @ApiProperty({ description: '难度', enum: DIFFICULTY_VALUES })
  difficulty!: TrainingDifficulty;

  @ApiProperty({ description: '给定来访者陈述 (答题上下文)' })
  scenarioContext!: string;

  @ApiProperty({ description: '候选项 (4 个, 1 个为专业示范)', type: [String] })
  options!: string[];

  @ApiProperty({ description: '预计时长 (分钟)', example: 5 })
  durationMinutes!: number;

  @ApiProperty({ description: '来访者姓名', example: '小林' })
  personaName!: string;

  @ApiProperty({ description: '来访者背景' })
  personaBackground!: string;

  @ApiProperty({ description: '是否支持实时纠偏 (默认 false)', example: false })
  realTimeCorrectionEnabled!: boolean;
}

export class TrainingExerciseListDto {
  @ApiProperty({ description: '训练题列表', type: [TrainingExerciseDto] })
  items!: TrainingExerciseDto[];

  @ApiProperty({ description: '命中总数', example: 10 })
  total!: number;
}

// ═══════════════════ 进度聚合 ═══════════════════

export class TrainingExerciseProgressItemDto {
  @ApiProperty({ description: '训练类型', enum: TYPE_VALUES })
  type!: TrainingExerciseType;

  @ApiProperty({ description: '训练项', enum: MODE_VALUES })
  mode!: TrainingExerciseMode;

  @ApiProperty({ description: '绑定的训练题 id (该 mode 下首道启用题)', example: '0f1c8f4e-7a1b-4a1e-9f2e-8b7c6d5e4f3a' })
  exerciseId!: string;

  @ApiProperty({ description: '是否已完成 (存在 graded 记录)', example: false })
  completed!: boolean;

  @ApiProperty({ description: '是否进行中 (存在 inProgress 记录且未完成)', example: false })
  inProgress!: boolean;

  @ApiProperty({ description: '最近一次得分 (未完成时 null, 不返回 0 避免误导)', example: 90, nullable: true })
  lastScore!: number | null;

  @ApiProperty({ description: '最近一次练习时间 (ISO 8601, 未练习时 null)', nullable: true, example: '2026-10-19T08:30:00.000Z' })
  lastPracticedAt!: string | null;

  @ApiProperty({ description: '累计答题次数', example: 2 })
  attemptCount!: number;

  @ApiProperty({ description: '预计时长 (分钟), 由题目带出', example: 5 })
  durationMinutes!: number;
}

export class TrainingExerciseProgressSummaryDto {
  @ApiProperty({ description: '训练项总数 (按启用题目计)', example: 10 })
  totalItems!: number;

  @ApiProperty({ description: '已完成训练项数', example: 8 })
  completedItems!: number;

  @ApiProperty({ description: '平均分 (仅统计已完成项, 无完成项时 null, 不返回 0)', example: 82, nullable: true })
  averageScore!: number | null;

  @ApiProperty({ description: '最近 7 天内有练习的自然天数 (非连续, 避免打卡压力, PRD §2.4-3)', example: 3 })
  activeDaysLast7d!: number;
}

export class TrainingExerciseProgressDto {
  @ApiProperty({ description: '汇总指标', type: TrainingExerciseProgressSummaryDto })
  summary!: TrainingExerciseProgressSummaryDto;

  @ApiProperty({ description: '逐训练项进度 (固定 10 项, 未练习项也返回)', type: [TrainingExerciseProgressItemDto] })
  items!: TrainingExerciseProgressItemDto[];
}

// ═══════════════════ 答题 ═══════════════════

export class SubmitTrainingExerciseAttemptDto {
  @ApiProperty({ description: '选择的候选项索引 (0-based)', example: 0 })
  @IsInt()
  @Min(0)
  // V2026-10-22 治本 (§8.5 B4 — 去掉硬编码上限):
  //   原因: 原来的 `@Max(10)` 是个与数据脱钩的魔数 —— 候选项实际有几道由
  //     `training_exercises.options.length` 决定 (当前 4 个), 而 10 这个上限
  //     跟它没有任何关系. 它有两个害处:
  //       (1) 真正越界的索引 (比如 options 只有 4 项时传 7) 会被 DTO 放行,
  //           只能靠 service 兜底 —— 校验职责被拆成两处, 容易漂移
  //       (2) 将来某个题库有 12 个选项时, DTO 反而会把它挡掉
  //   修法: DTO 只管"非负整数"这个格式约束; 真正的业务上限 (options.length)
  //     由 service 判定 —— 它是唯一知道 options 长度的一方. service 侧已把
  //     越界从 NotFound 改成 BadRequest (越界是请求参数问题, 不是资源不存在).
  selectedOptionIndex!: number;

  @ApiProperty({ description: '答题耗时 (秒)', example: 42 })
  @IsInt()
  // 0 是合法值: 语义为"提交快到来不及计时" (例如用户秒答秒交), 不代表异常.
  @Min(0)
  @Max(3600)
  attemptDurationSeconds!: number;

  @ApiPropertyOptional({ description: '本次是否启用实时纠偏', required: false })
  @IsOptional()
  @IsBoolean()
  realTimeCorrectionUsed?: boolean;
}

export class TrainingExerciseAttemptResultDto {
  @ApiProperty({ description: '答题记录 id' })
  id!: string;

  @ApiProperty({ description: '是否命中专业示范选项 (只陈述事实, 不作评价)', example: true })
  isCorrect!: boolean;

  @ApiProperty({ description: '确定性得分 0-100', example: 90 })
  score!: number;

  // V2026-10-20 修正 (tsc TS2322 同 ②): 用 Object 构造函数替代字符串 'object'
  @ApiProperty({ description: '维度分 (维度名 → 0-100)', type: Object })
  dimensionScores!: Record<string, number>;

  @ApiProperty({ description: '本题专家反馈 (命中时) 或改进方向 (未命中时)' })
  feedback!: string;

  @ApiProperty({ description: '可继续尝试的改进提示 (未命中时非空)', type: [String] })
  improvementHints!: string[];

  @ApiProperty({ description: '记录状态', enum: ATTEMPT_STATUS_VALUES })
  status!: TrainingAttemptStatus;

  @ApiProperty({ description: '完成时间 (ISO 8601)', example: '2026-10-19T08:30:00.000Z' })
  completedAt!: string;
}

// ═══════════════════ 查询 DTO ═══════════════════

export class TrainingExerciseQueryDto {
  @ApiPropertyOptional({ description: '按训练类型过滤', required: false, enum: TYPE_VALUES })
  @IsOptional()
  @IsIn(TYPE_VALUES)
  @Type(() => String)
  type?: TrainingExerciseType;

  @ApiPropertyOptional({ description: '按训练项过滤', required: false, enum: MODE_VALUES })
  @IsOptional()
  @IsIn(MODE_VALUES)
  @Type(() => String)
  mode?: TrainingExerciseMode;

  @ApiPropertyOptional({
    description: '按难度过滤 (大小写均接受: l1 / L1 等价; 响应体固定为大写 L1/L2/L3)',
    required: false,
    enum: DIFFICULTY_VALUES,
  })
  @IsOptional()
  // V2026-10-22 治本 (§8.4#3 — 难度字面量统一):
  //   原因: 契约两侧对难度的字面量不一致, 且**带难度过滤必然 400**:
  //     - DB / entity / 响应体: 大写 'L1' / 'L2' / 'L3' (TrainingDifficulty)
  //     - 客户端列表过滤: 发小写 'l1' / 'l2' / 'l3'
  //       (客户端的 TrainingDifficulty enum 就是 { l1, l2, l3 }, .name 取出来是小写)
  //     - DTO 原来用 `@IsIn(['L1','L2','L3'])` 校验 → 小写直接被拦成 400
  //   修法: **query 兼容大小写** (统一转大写再校验), 响应体**固定大写**.
  //     为什么响应体不动: 客户端的解析是 `d.name.toUpperCase() == json['difficulty']`
  //     —— 它自己会把枚举名转成大写再比, 所以**只有大写**的响应能被解析命中;
  //     改成小写反而会让客户端的 firstWhere 抛异常、整条题目被丢弃.
  //     也就是说: query 放宽, 响应收紧 —— 两边都在"能用的那个方向"上对齐.
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.toUpperCase() : value))
  @IsIn(DIFFICULTY_VALUES)
  @Type(() => String)
  difficulty?: TrainingDifficulty;
}

// ═══════════════════ UI 偏好 ═══════════════════

const PREF_KEY_VALUES = Object.keys(COUNSELOR_UI_PREFERENCE_DEFAULTS);

export class CounselorUiPreferencesDto {
  @ApiProperty({
    description: '专项技能训练中心 Hero 横幅是否显示 (设计规格 §14-2, 用户可关闭)',
    example: true,
  })
  specializedSkillsHeroVisible!: boolean;

  @ApiProperty({
    description: '上帝视角开关: 是否允许查看完整来访者剧本 (v1.2 §4.2, **默认关闭**)',
    example: false,
  })
  godViewEnabled!: boolean;

  @ApiProperty({
    description: '实时督导轻提示档位 (v1.2 §6.1): light = 静默浮窗提示 / off = 完全无提示 (**默认关闭**)',
    enum: ['light', 'off'],
    example: 'off',
  })
  liveSupervisionHintTier!: 'light' | 'off';
}

export class UpdateCounselorUiPreferencesDto {
  @ApiProperty({
    description: '待更新的偏好键值对. 仅接受白名单内的 key, 未知 key 抛 400',
    example: { specializedSkillsHeroVisible: false },
    type: Object,
  })
  @IsOptional()
  // V2026-10-21 治本 (V1.2 VS-C — 值类型放宽为 boolean | string):
  //   新增的 liveSupervisionHintTier 是 2 值档位 (字符串), 与已有布尔偏好共存.
  //   值的合法性在 service 里按键校验 (动态键的 Record 无法用 @IsIn 逐键声明).
  preferences!: Partial<Record<CounselorUiPreferenceKey, boolean | string>>;
}

export { COUNSELOR_UI_PREFERENCE_DEFAULTS, PREF_KEY_VALUES };
