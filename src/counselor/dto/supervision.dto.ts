// V2026-10-15 治本 (V2.3 — supervision.dto.ts, 5 DTO 1:1 wire):
//   原因: counselor-mode-v1.0 §6.2 + §4.6 拍板 4 流派 + polymorphic feedback, V0.3
//     §13 baseline 0 督导持久化 DTO, 1:1 wire 0 破坏. 5 DTO 1:1 对应 xin_su_app
//     SupervisionFeedback entity 字段.
//
//   修法:
//     - 5 DTO 跟 V0.5 已有 counselor-home / counselor-training / long-term-case DTO 风格一致
//     - SupervisionSchoolListItemDto: 流派列表 (无 promptTemplate, 减少 list 流量)
//     - SupervisionSchoolDetailDto: 流派详情 (含 promptTemplate, V0.5 mock 用)
//     - GenerateSupervisionFeedbackDto: 生成 1 流派反馈 (sessionId+sessionType+schoolCode)
//     - CompareSupervisionFeedbackDto: 多流派对比 (sessionId+sessionType+schoolCodes[])
//     - SupervisionFeedbackDto: 反馈结果 (overallScore+perSentence+errorCategories+growthSuggestion)
//     - 跟 SupervisionSchoolCode 4 enum 严格 1:1 wire
//
//   反双胞胎:
//     - 不在 DTO 写 promptTemplate 完整模板: 1:1 wire 跟 entity 1:1, promptTemplate 在 entity / config
//     - 不在 DTO 暴露 sessionType polymorphic 复杂逻辑: 走 enum + 4 流派 school 拼接
//     - 不用 snake_case wire (用 camelCase 跟 V0.x DTO 风格一致, server 端 entity snake_case,
//       JSON 序列化时 TypeORM 自动 camelCase)
//
//   验证:
//     1. tsc 0 错 (5 DTO 字段 type 严格)
//     2. 跟 xin_su_app SupervisionFeedback entity 字段 1:1 wire (V1.x client 端联调时)
//
//   时间戳: 2026-10-15

import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsEnum, IsString, MaxLength, MinLength } from 'class-validator';

import { SupervisionSchoolCode } from '../enums/supervision-school-code.enum';
import { SessionType } from '../enums/session-type.enum';

// ════════════════════════════════════════════════════════════════════════════
// 单个流派 list 项 (无 promptTemplate, 减少 list 流量)
// ════════════════════════════════════════════════════════════════════════════

export class SupervisionSchoolListItemDto {
  @ApiProperty({ description: '流派 id (UUID)' })
  id!: string;

  @ApiProperty({ description: '4 流派 enum (跟 SupervisionSchoolCode 1:1)', enum: SupervisionSchoolCode })
  code!: SupervisionSchoolCode;

  @ApiProperty({ description: '流派中文名' })
  name!: string;

  @ApiProperty({ description: '关注重点 (跟 counselor-mode-v1.0 §4.6 表 1:1)', type: [String] })
  focusAreas!: string[];

  @ApiProperty({ description: '典型反馈示例 (跟 §4.6 表 1:1)', type: [String] })
  exampleFeedback!: string[];

  @ApiProperty({ description: '是否启用 (V0.x 4 流派全 active, 未来灰度 A/B 用)' })
  isActive!: boolean;
}

// ════════════════════════════════════════════════════════════════════════════
// 流派详情 (含 promptTemplate, V0.5 mock 用, V1.x 真接 LLM 时改 provider 注入)
// ════════════════════════════════════════════════════════════════════════════

export class SupervisionSchoolDetailDto extends SupervisionSchoolListItemDto {
  @ApiProperty({ description: 'LLM prompt 模板 (V0.5 mock 阶段返回, V1.x 真接 LLM 内部用)', nullable: true })
  promptTemplate!: string | null;
}

// ════════════════════════════════════════════════════════════════════════════
// 督导反馈结果 (4 字段结构化, 跟 entity.feedback 1:1)
// ════════════════════════════════════════════════════════════════════════════

export class SupervisionPerSentenceDto {
  @ApiProperty({ description: '原句文本' })
  sentence!: string;

  @ApiProperty({ description: '单句评分 0-100' })
  score!: number;

  @ApiProperty({ description: '1-2 句点评' })
  comment!: string;
}

export class SupervisionFeedbackDto {
  @ApiProperty({ description: '整体评分 0-100', example: 72 })
  overallScore!: number;

  @ApiProperty({ description: '逐句标注', type: [SupervisionPerSentenceDto] })
  perSentence!: SupervisionPerSentenceDto[];

  @ApiProperty({ description: '错误分类汇总 (e.g. ["打断", "给建议", "过早诊断"])', type: [String] })
  errorCategories!: string[];

  @ApiProperty({ description: '成长建议 (1-3 短句)' })
  growthSuggestion!: string;
}

// ════════════════════════════════════════════════════════════════════════════
// 生成 1 流派反馈输入
// ════════════════════════════════════════════════════════════════════════════

export class GenerateSupervisionFeedbackDto {
  @ApiProperty({ description: 'session id (polymorphic, 跟 W1-2 LongTermCaseSession + V0.x TrainingSession 1:1)' })
  @IsString()
  @MinLength(36)
  @MaxLength(36)
  sessionId!: string;

  @ApiProperty({ description: 'session 类型 (polymorphic)', enum: SessionType })
  @IsEnum(SessionType)
  sessionType!: SessionType;

  @ApiProperty({ description: '4 流派 enum', enum: SupervisionSchoolCode })
  @IsEnum(SupervisionSchoolCode)
  schoolCode!: SupervisionSchoolCode;
}

// ════════════════════════════════════════════════════════════════════════════
// 多流派对比输入 (高级会员)
// ════════════════════════════════════════════════════════════════════════════

export class CompareSupervisionFeedbackDto {
  @ApiProperty({ description: 'session id (polymorphic)' })
  @IsString()
  @MinLength(36)
  @MaxLength(36)
  sessionId!: string;

  @ApiProperty({ description: 'session 类型 (polymorphic)', enum: SessionType })
  @IsEnum(SessionType)
  sessionType!: SessionType;

  @ApiProperty({ description: '多流派 enum 数组 (高级会员 2-3 流派对比)', enum: SupervisionSchoolCode, isArray: true })
  @IsArray()
  @ArrayMinSize(2)
  @IsEnum(SupervisionSchoolCode, { each: true })
  schoolCodes!: SupervisionSchoolCode[];
}

// ════════════════════════════════════════════════════════════════════════════
// 多流派对比响应 (1 session × N 流派)
// ════════════════════════════════════════════════════════════════════════════

export class CompareSupervisionFeedbackResponseDto {
  @ApiProperty({ description: 'session id' })
  sessionId!: string;

  @ApiProperty({ description: 'session 类型', enum: SessionType })
  sessionType!: SessionType;

  @ApiProperty({ description: 'N 流派反馈 (key=SupervisionSchoolCode enum 值)', type: SupervisionFeedbackDto, isArray: false })
  feedbackBySchool!: Record<SupervisionSchoolCode, SupervisionFeedbackDto>;
}
