import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { DiaryAiFeedbackSource, DIARY_AI_FEEDBACK_SOURCE_VALUES } from '../enums/diary-ai-feedback-source.enum';
import { DiaryEntryStatus, DIARY_ENTRY_STATUS_VALUES } from '../enums/diary-entry-status.enum';
import { DiaryMoodLevel, DIARY_MOOD_LEVEL_VALUES } from '../enums/diary-mood-level.enum';
import { DiaryTag, DIARY_TAG_VALUES } from '../enums/diary-tag.enum';

/**
 * V2026-09-11 治本 (好状态日记 · DTO 集合):
 *   原因: 心理产品前端契约稳定, 后端 DTO 必须严格 1:1 镜像 (字段名 / 类型 / 长度),
 *         否则前后端 round-trip 失败.
 *   修复: DTO 字段命名 camelCase, 跟前端 GoodStateDiaryEntryModel.toJson() 一致.
 *         enum 字段用字符串字面量 (前端 enum.name 1:1).
 *         时间字段全 ISO-8601 字符串 (前端 dart DateTime.parse 解析).
 *         class-validator 校验: body 长度 5000, title 长度 100, tags 数组上限 4 个,
 *         moodSnapshot / aiFeedback 嵌套结构 @ValidateNested 校验.
 *   如何验证: 任意 controller 用 @Body() 注入, ValidationPipe (全局开启)
 *             自动拒绝非法 body, BizException filter 翻译为 { code, message, data: null }.
 */

// ─── 类型别名 (TS 字符串字面量, 跟 enum.name 一致) ───

export type DiaryEntryStatusKey = `${DiaryEntryStatus}`;
export type DiaryMoodLevelKey = `${DiaryMoodLevel}`;
export type DiaryAiFeedbackSourceKey = `${DiaryAiFeedbackSource}`;
export type DiaryTagKey = `${DiaryTag}`;

// ════════════════════════════════════════════════════════════════
// 1. 情绪快照 DTO (moodSnapshot)
// ════════════════════════════════════════════════════════════════

export class MoodSnapshotDto {
  @ApiProperty({ enum: DIARY_MOOD_LEVEL_VALUES, example: DiaryMoodLevel.Low, description: '4 档情绪档位 (great / okay / low / crisis)' })
  @IsEnum(DiaryMoodLevel)
  level!: DiaryMoodLevel;

  @ApiProperty({ description: '情绪快照时间 ISO-8601', example: '2026-09-11T10:00:00.000Z' })
  @IsISO8601()
  snapshottedAt!: string;

  @ApiProperty({ description: '备注 (可选, e.g. "刚和家人吵完架")', required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @ApiProperty({ description: '弱关联 emotion_log.id (跨 feature 不建 FK)', required: false, nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 36)
  sourceEmotionLogId?: string | null;
}

// ════════════════════════════════════════════════════════════════
// 2. AI 反馈 DTO (response / update 入参)
// ════════════════════════════════════════════════════════════════

export class DiaryAiFeedbackDto {
  @ApiProperty({ description: '1-2 句中性总结, 禁评判词 (你应该 / 建议你 / 你有问题)', example: '今天的状态是一般, 提到了工作方面的内容.' })
  @IsString()
  @MaxLength(500)
  summary!: string;

  @ApiProperty({
    description: '3 个开放问题 — 引导用户进一步觉察, 不给答案',
    example: ['写下这段话的时候, 身体感觉如何?', '如果给这一刻取一个名字, 会是什么?', '过段时间回看, 你想对今天的自己说点什么?'],
  })
  @IsArray()
  @ArrayMaxSize(3)
  @IsString({ each: true })
  perspectiveQuestions!: string[];

  @ApiProperty({ description: '观察到的中性主题词 (例: ["工作", "睡眠"])', example: ['工作', '睡眠'] })
  @IsArray()
  @IsString({ each: true })
  observedThemes!: string[];

  @ApiProperty({ description: '生成时间 ISO-8601', example: '2026-09-11T10:05:00.000Z' })
  @IsISO8601()
  generatedAt!: string;

  @ApiProperty({ enum: DIARY_AI_FEEDBACK_SOURCE_VALUES, example: DiaryAiFeedbackSource.Cloud })
  @IsEnum(DiaryAiFeedbackSource)
  source!: DiaryAiFeedbackSource;

  @ApiProperty({ description: '端侧危机信号命中标记 (true 触发 /crisis/alert 流程)', example: false })
  @IsBoolean()
  crisisFlag!: boolean;
}

// ════════════════════════════════════════════════════════════════
// 3. AI 反馈请求 DTO (云端入参, 仅传元数据, 不传 body — PRD §11.1 隐私)
// ════════════════════════════════════════════════════════════════

export class RequestDiaryAiFeedbackDto {
  @ApiProperty({ description: '关联的日记 ID (UUID), 用于服务端校验所有权' })
  @IsString()
  @Length(1, 36)
  entryId!: string;

  @ApiProperty({ description: '端侧抽取的主题词', example: ['工作', '亲密关系'] })
  @IsArray()
  @IsString({ each: true })
  themes!: string[];

  @ApiProperty({
    description: '端侧情绪档位 hint (DiaryMoodLevel.name), 可选',
    enum: DIARY_MOOD_LEVEL_VALUES,
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsEnum(DiaryMoodLevel)
  moodHint?: DiaryMoodLevel | null;

  @ApiProperty({ description: '端侧 1-2 句摘要 (不上传 body, 上传的是端侧生成的简要观察)', example: '今天在...' })
  @IsString()
  @MaxLength(500)
  localSummary!: string;

  @ApiProperty({ description: '端侧 DiaryTag.name 列表', enum: DIARY_TAG_VALUES, example: [DiaryTag.GoodMoment, DiaryTag.Challenge] })
  @IsArray()
  @IsString({ each: true })
  tags!: string[];
}

// ════════════════════════════════════════════════════════════════
// 4. 创建 DTO
// ════════════════════════════════════════════════════════════════

export class CreateDiaryEntryDto {
  @ApiProperty({ description: '正文, 1-5000 字符 (PRD §6 心理产品合规底线)', example: '今天状态一般...' })
  @IsString()
  @Length(1, 5000)
  body!: string;

  @ApiProperty({ description: '标题 (可选), 1-100 字符', required: false, nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  title?: string | null;

  @ApiProperty({
    description: '状态: draft / finalized, 默认 draft',
    enum: DIARY_ENTRY_STATUS_VALUES,
    required: false,
    example: DiaryEntryStatus.Draft,
  })
  @IsOptional()
  @IsEnum(DiaryEntryStatus)
  status?: DiaryEntryStatus;

  @ApiProperty({ description: '写日记时的情绪快照 (可选)', type: MoodSnapshotDto, required: false, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => MoodSnapshotDto)
  moodSnapshot?: MoodSnapshotDto | null;

  @ApiProperty({ description: 'DiaryTag 列表 (4 选多)', enum: DIARY_TAG_VALUES, isArray: true, required: false })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsString({ each: true })
  tags?: string[];

  @ApiProperty({ description: '关联的练习 ID (V3 接 practice 模块时跨 feature 关联)', required: false, nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  linkedPracticeId?: string | null;

  @ApiProperty({ description: '是否私密, 默认 true (私密优先, 跨设备同步由用户主动开启)', required: false, example: true })
  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;
}

// ════════════════════════════════════════════════════════════════
// 5. 更新 DTO (partial — id / authorId / createdAt 不可改, 由 service 拦截)
// ════════════════════════════════════════════════════════════════

export class UpdateDiaryEntryDto {
  @ApiProperty({ description: '正文 (可选), 1-5000 字符', required: false })
  @IsOptional()
  @IsString()
  @Length(1, 5000)
  body?: string;

  @ApiProperty({ description: '标题 (可选), null = 清除', required: false, nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  title?: string | null;

  @ApiProperty({ description: '状态 (可选), draft ↔ finalized 可双向切换', enum: DIARY_ENTRY_STATUS_VALUES, required: false })
  @IsOptional()
  @IsEnum(DiaryEntryStatus)
  status?: DiaryEntryStatus;

  @ApiProperty({ description: '情绪快照 (可选), null = 清除', type: MoodSnapshotDto, required: false, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => MoodSnapshotDto)
  moodSnapshot?: MoodSnapshotDto | null;

  @ApiProperty({ description: 'Tag 列表 (可选), 空数组 = 清除', enum: DIARY_TAG_VALUES, isArray: true, required: false })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsString({ each: true })
  tags?: string[];

  @ApiProperty({ description: '关联的练习 ID (可选), null = 清除', required: false, nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  linkedPracticeId?: string | null;

  @ApiProperty({ description: 'AI 反馈 (可选), null = 清除', required: false, nullable: true, type: DiaryAiFeedbackDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DiaryAiFeedbackDto)
  aiFeedback?: DiaryAiFeedbackDto | null;

  @ApiProperty({ description: '是否私密', required: false })
  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;
}

// ════════════════════════════════════════════════════════════════
// 6. 查询 DTO
// ════════════════════════════════════════════════════════════════

export class ListDiaryEntriesQueryDto {
  @ApiProperty({ description: '限制条数, 默认 30, 上限 100', required: false, example: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiProperty({ description: '游标 (base64url 编码的 {createdAt ISO, id})', required: false })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiProperty({
    description: '状态过滤, 多个逗号分隔, 默认 finalized',
    required: false,
    example: `${DiaryEntryStatus.Draft},${DiaryEntryStatus.Finalized}`,
  })
  @IsOptional()
  @IsString()
  statusFilter?: string;
}

export class SearchDiaryEntriesQueryDto {
  @ApiProperty({ description: '搜索关键词 (LIKE 模糊匹配 body + title)', example: '工作' })
  @IsString()
  @Length(1, 100)
  query!: string;

  @ApiProperty({ description: '限制条数, 默认 30, 上限 100', required: false, example: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiProperty({ description: '游标', required: false })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiProperty({
    description: 'Tag 过滤 (AND 语义), 多个逗号分隔',
    required: false,
    example: `${DiaryTag.Challenge},${DiaryTag.Gratitude}`,
  })
  @IsOptional()
  @IsString()
  tagFilters?: string;
}

// ════════════════════════════════════════════════════════════════
// 7. 响应 DTO
// ════════════════════════════════════════════════════════════════

export class DiaryEntryDto {
  @ApiProperty({ description: '日记 ID (UUID)' })
  id!: string;

  @ApiProperty({ description: '作者 UID' })
  authorId!: string;

  @ApiProperty({ description: '状态', enum: DIARY_ENTRY_STATUS_VALUES })
  status!: DiaryEntryStatus;

  @ApiProperty({ description: '标题', nullable: true })
  title!: string | null;

  @ApiProperty({ description: '正文' })
  body!: string;

  @ApiProperty({ description: '情绪快照', nullable: true, type: MoodSnapshotDto })
  moodSnapshot!: MoodSnapshotDto | null;

  @ApiProperty({ description: 'Tag 列表', enum: DIARY_TAG_VALUES, isArray: true })
  tags!: string[];

  @ApiProperty({ description: '关联练习 ID', nullable: true })
  linkedPracticeId!: string | null;

  @ApiProperty({ description: 'AI 反馈 (详情页懒加载, 列表不取)', nullable: true, type: DiaryAiFeedbackDto })
  aiFeedback!: DiaryAiFeedbackDto | null;

  @ApiProperty({ description: '是否私密' })
  isPrivate!: boolean;

  @ApiProperty({ description: '创建时间 ISO-8601' })
  createdAt!: string;

  @ApiProperty({ description: '更新时间 ISO-8601' })
  updatedAt!: string;

  @ApiProperty({ description: '软删时间 ISO-8601, null = 未软删', nullable: true })
  deletedAt!: string | null;
}

export class DiaryPageDto {
  @ApiProperty({ description: '日记条目列表', type: [DiaryEntryDto] })
  entries!: DiaryEntryDto[];

  @ApiProperty({ description: '是否还有下一页' })
  hasMore!: boolean;

  @ApiProperty({ description: '下一页游标, null = 没有更多' })
  nextCursor!: string | null;
}

export class DiaryPurgeResultDto {
  @ApiProperty({ description: '物理擦除条目数' })
  deletedCount!: number;

  @ApiProperty({ description: '截止时间 ISO-8601' })
  cutoffIso!: string;
}
