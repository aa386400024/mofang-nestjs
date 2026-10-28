// V2026-10-27 治本 (情景演练 · REST 出参 DTO):
//   原因: 任务单 §4 拍板了 3 个端点的契约, §1.3 拍板了判定结果的通用结构.
//     DTO 是**前后端唯一契约面** —— 字段一改, 客户端 dart model 就得同步改,
//     所以这一层必须逐字段对齐任务单, 且**结构级**地保证零压红线.
//
//   修法: 一份 DTO 文件覆盖 3 个端点的入参与出参, 全部标 swagger 注解.
//
//   ── 零压红线 (结构级保证, 不是靠文案自觉) ──
//   任务单 §8.4: "响应全局无分数字段".
//   本文件里**任何出参 DTO 都不含** score / grade / rating / 分数 / 星级 之类字段 ——
//   契约里没有这个字段, 客户端就不可能渲染出"62 分"或"三颗星".
//   隔离测试第 ⑥ 条用物理断言锁死这一点 (见 test/counselor/drill-isolation.spec.ts).
//
//   ── 不下发什么 (任务单 §4.2) ──
//   GET /:drillId 只下发"开练所需": 人设 / 场景 / 来访者原话 / 锚点的 key+label.
//   **不下发**:
//     · requiredPoints 的关键词表 (positiveKeywords / antiKeywords) —— 下发等于发答案,
//       学员照着关键词拼一句就能"通过", 练习失去意义 (任务单 §4.2 明确要求)
//     · referenceResponse / commonPitfalls —— 开练前不展示 (任务单 §4.2 明确要求),
//       它们在 POST respond 的判定结果里才出现.
//
//   ── 反双胞胎 ──
//   - **不复用 practice 的反馈 DTO**: practice 的反馈有 dimensionKey / attemptOrdinal /
//     visitorReaction 等练习引擎专属字段, 语义与演练不同; 复用会让契约掺进无关字段.
//     共用的只有**枚举值** (tone / source / difficulty 三个 enum —— 值域完全一致, 见 drill.types.ts).
//   - **不在 DTO 里塞 domain 对象**: 一律逐字段映射, domain 将来加内部字段不会顺手泄到前端.
//   - **不给 crisis 单独的 DTO**: 两个赛道共用一套结构, 靠字段值区分 (crisis 的 verdict 恒 null),
//     前端不用维护两套解析器.
//
//   验证:
//     1. tsc 0 错
//     2. swagger 页 /counselor/drills* 可见 3 个端点, 字段与任务单 §4 逐字段对齐
//     3. grep 'score\|grade\|rating' 于本文件 → 0 命中 (零压红线结构级校验)
//   时间戳: 2026-10-27 20:45 GMT+8
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

import { PracticeDifficulty } from '../../enums/practice-difficulty.enum';
import { PracticeFeedbackSource } from '../../enums/practice-feedback-source.enum';
import { PracticeFeedbackTone } from '../../enums/practice-feedback-tone.enum';
import { DRILL_TRACK_VALUES, DRILL_VERDICT_VALUES, type DrillTrack, type DrillVerdict } from '../domain/drill.types';

/**
 * GET /counselor/drills 查询参数.
 */
export class DrillListQueryDto {
  @ApiPropertyOptional({
    description: '按赛道过滤 (boundary=设置压力测试 / crisis=危机识别会内突发); 不传 = 全部',
    enum: DRILL_TRACK_VALUES,
    example: 'boundary',
  })
  @IsOptional()
  @IsIn(DRILL_TRACK_VALUES)
  track?: DrillTrack;
}

/**
 * 列表项 (元信息, 不含全文与关键词表).
 */
export class DrillListItemDto {
  @ApiProperty({ description: '剧本稳定 slug (对外契约, 发布后不改名)', example: 'boundary_wechat_contact' })
  drillId!: string;

  @ApiProperty({ description: '赛道', enum: DRILL_TRACK_VALUES, example: 'boundary' })
  track!: DrillTrack;

  @ApiProperty({ description: '难度 1/2/3 (仅排序/展示, 不参与判定)', enum: [1, 2, 3], example: 1 })
  difficulty!: PracticeDifficulty;

  @ApiProperty({ description: '列表标题 (前端卡片主文案)', example: '结束时提出加微信' })
  title!: string;

  @ApiProperty({ description: '场景一句话说明 (任务背景)', example: '会谈接近尾声, 来访提出私下留联系方式' })
  setting!: string;

  @ApiProperty({ description: '边界声明 (前端隔离壳直接渲染)', example: '本模块练习的是会谈设置与边界的表达方式…' })
  boundaryNotice!: string;
}

/**
 * 列表响应.
 */
export class DrillListDto {
  @ApiProperty({ description: '剧本元信息清单', type: [DrillListItemDto] })
  drills!: DrillListItemDto[];
}

/**
 * 开练详情里下发的锚点 (只有 key + label, **没有关键词表**).
 */
export class DrillPointDto {
  @ApiProperty({ description: '锚点 key (前端覆盖清单展示用)', example: 'holdsBoundary' })
  key!: string;

  @ApiProperty({ description: '锚点中文名 (前端直接展示)', example: '守住设置' })
  label!: string;
}

/**
 * 来访者人设 (表层).
 */
export class DrillPersonaDto {
  @ApiProperty({ description: '来访者称呼', example: '阿宁' })
  name!: string;

  @ApiProperty({ description: '年龄', example: 29 })
  age!: number;

  @ApiProperty({ description: '性别', example: '女' })
  gender!: string;

  @ApiProperty({ description: '职业', example: '客服主管' })
  occupation!: string;

  @ApiProperty({ description: '一句背景', example: '工作节奏紧, 习惯把"随时能找到人"当作安全感来源' })
  background!: string;
}

/**
 * 开练详情 (POST respond 的入参是另一份 DTO, 见下).
 */
export class DrillDetailDto {
  @ApiProperty({ description: '剧本稳定 slug', example: 'boundary_wechat_contact' })
  drillId!: string;

  @ApiProperty({ description: '赛道', enum: DRILL_TRACK_VALUES, example: 'boundary' })
  track!: DrillTrack;

  @ApiProperty({ description: '难度 1/2/3', enum: [1, 2, 3], example: 1 })
  difficulty!: PracticeDifficulty;

  @ApiProperty({ description: '标题', example: '结束时提出加微信' })
  title!: string;

  @ApiProperty({ description: '来访者人设', type: DrillPersonaDto })
  persona!: DrillPersonaDto;

  @ApiProperty({ description: '场景一句话说明', example: '会谈接近尾声, 来访提出私下留联系方式' })
  setting!: string;

  @ApiProperty({ description: '来访者抛出的那句话 (首条气泡直接展示)', example: '老师, 结束的时候能不能加个微信?' })
  visitorPrompt!: string;

  @ApiProperty({
    description: '本场景要求覆盖的技术点 (**只给 key+label, 不下发关键词表** — 下发即发答案)',
    type: [DrillPointDto],
  })
  requiredPoints!: DrillPointDto[];

  @ApiProperty({ description: '边界声明', example: '本模块练习的是会谈设置与边界的表达方式…' })
  boundaryNotice!: string;
}

/**
 * POST respond 入参.
 */
export class SubmitDrillResponseDto {
  @ApiProperty({
    description: '学员本次的回应原文 (文本练习直接输入; 语音场景可先做一次性转写再提交)',
    example: '我理解你担心临时联系不上, 这份不安挺不容易的。我们的设置是不加私人联系方式…',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  submittedText!: string;

  @ApiPropertyOptional({
    description: '录音时长 (秒, 语音转写场景透传; **不参与判定**)',
    required: false,
    example: 42,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(28_800)
  recordSeconds?: number;
}

/**
 * 单条零压技术批注.
 */
export class DrillItemDto {
  @ApiProperty({ description: '语气三态 (positive=动作达成 / warning=可以留意 / info=技术提示)', enum: PracticeFeedbackTone })
  tone!: PracticeFeedbackTone;

  @ApiProperty({ description: '锚定到的技术点 key', example: 'holdsBoundary' })
  pointKey!: string;

  @ApiProperty({ description: '批注文案 (只描述技术动作, 不评价人)', example: '「按我们的设置」这个动作出现了 —— 守住设置。' })
  text!: string;
}

/**
 * POST respond 响应 (任务单 §1.3 的通用结构).
 */
export class DrillResponseDto {
  @ApiProperty({ description: '剧本稳定 slug', example: 'boundary_wechat_contact' })
  drillId!: string;

  @ApiProperty({ description: '赛道', enum: DRILL_TRACK_VALUES, example: 'boundary' })
  track!: DrillTrack;

  @ApiProperty({
    description: '技术形态标签 (boundary 三档; crisis 恒为 null). **不是分数、不是对错** — 前端文案不得出现"得分/及格/失败"',
    enum: DRILL_VERDICT_VALUES,
    nullable: true,
    example: 'steady_firm',
  })
  verdict!: DrillVerdict | null;

  @ApiProperty({ description: '已覆盖的技术点 key 清单', type: [String], example: ['namesEmotion', 'holdsBoundary'] })
  coveredPointKeys!: string[];

  @ApiProperty({ description: '未覆盖的技术点 key 清单', type: [String], example: ['offersAlternative'] })
  missedPointKeys!: string[];

  @ApiProperty({ description: '3-5 条零压技术批注', type: [DrillItemDto] })
  items!: DrillItemDto[];

  @ApiProperty({
    description: '参考回应 (开练前不下发, 判定后才给)',
    example: '我理解你担心临时联系不上…',
  })
  referenceResponse!: string;

  @ApiProperty({ description: '常见偏差 (留意避免)', type: [String], example: ['先答应加微信再解释'] })
  commonPitfalls!: string[];

  @ApiProperty({
    description: '产出来源: keyword=确定性关键词判定 / llm=模型润色措辞 (**判定档位始终由确定性规则产出**)',
    enum: PracticeFeedbackSource,
    example: PracticeFeedbackSource.KEYWORD,
  })
  source!: PracticeFeedbackSource;
}
