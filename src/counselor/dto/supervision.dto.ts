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

// V2026-10-26 治本 (spec 任务 6): 报告状态类型与归一函数在 domain 层 (唯一真值源),
//   本文件只做**转出** —— 保持 `import type { SessionReportStatus } from '../dto/supervision.dto'`
//   的既有引用全部照旧可用, 且全仓只有一份定义.
//   注意: 下面那行 `export type { ... }` 需要配套的 `import type` —— 只写 re-export 的话,
//   本文件内引用该类型会报 "Cannot find name" (本文件里的 DTO 类确实要用它).
import { SessionTechStatsDto, TransferenceMarkDto } from './session-core.dto';
import type { SessionReportStatus } from '../domain/session-core/session-core.types';
import { SessionType } from '../enums/session-type.enum';
import { SupervisionSchoolCode } from '../enums/supervision-school-code.enum';
// V2026-10-26 治本 (spec 任务 6 — 复盘报告 DTO):
//   **值导入** (不是 `import type`): `@ApiProperty({ type: X })` 里的 X 是**运行时取值**
//   (swagger 要拿它当 class 反射元数据), type-only 导入会被 TS 擦除 → TS1361
//   "'X' cannot be used as a value because it was imported using 'import type'".
//   这跟 DTO 出现在 `@Body()` 里必须值导入是**同一个根因** (见 session-core.dto.ts 的口径).

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

// ════════════════════════════════════════════════════════════════════════════
// 复盘报告 (V2026-10-26, spec 任务 6)
// ════════════════════════════════════════════════════════════════════════════

/**
 * 报告状态 (定义在 domain 层, 这里转出).
 */
export type { SessionReportStatus };

/** 督导报告里的单条标注 (锚在 transcript 时间戳上). */
export class SupervisionReportAnnotationDto {
  @ApiProperty({ description: '锚点 (transcript 里的 ms 时间戳)' })
  timestamp!: number;

  @ApiProperty({ description: '标注类型', enum: ['good', 'warn', 'error'] })
  type!: 'good' | 'warn' | 'error';

  @ApiProperty({ description: '问题分类 (如"急于给建议")' })
  category!: string;

  @ApiProperty({ description: '1-2 句点评' })
  message!: string;

  @ApiProperty({ description: '可执行改进建议 (可选)', nullable: true })
  suggestion!: string | null;
}

/** 督导六维评分. */
export class SupervisionReportDimensionsDto {
  @ApiProperty({ description: '共情 0-100' })
  empathy!: number;

  @ApiProperty({ description: '主动倾听 0-100' })
  activeListening!: number;

  @ApiProperty({ description: '提问技术 0-100' })
  questioning!: number;

  @ApiProperty({ description: '边界 0-100' })
  boundary!: number;

  @ApiProperty({ description: '反应 0-100' })
  response!: number;

  @ApiProperty({ description: '专业度 0-100' })
  professionalism!: number;
}

/**
 * 复盘报告 (本场会谈的完整复盘出口).
 *
 * 内容是**三个已有来源的整合** (spec 任务 6), 不是新造的一套:
 *   - 亮点 / 改进建议 / 风险线索 ← agent/supervisor 的结构化督导报告 (时间戳锚定)
 *   - 技术统计              ← training_sessions.tech_stats (任务 3)
 *   - 移情 / 阻抗标记        ← transference_resistance_marks (任务 4)
 *   - 4 流派反馈            ← supervision_feedback (可按 CBT / 精神动力学 / 人本 / 家庭治疗切视角)
 *
 * 报告没生成时: `status='pending'` + 其余字段为 null / 空数组 —— **不返回编造内容**.
 */
export class SessionReportDto {
  @ApiProperty({ description: '会话 id (training_sessions.id, 稳定落库 id)' })
  sessionId!: string;

  @ApiProperty({ description: 'session 类型', enum: SessionType })
  sessionType!: SessionType;

  @ApiProperty({ description: '报告状态', enum: ['completed', 'parse_error', 'pending'] })
  status!: SessionReportStatus;

  @ApiProperty({ description: '整体评分 0-100 (报告未生成时为 null)', nullable: true })
  overallScore!: number | null;

  @ApiProperty({ description: '六维评分 (报告未生成时为 null)', type: SupervisionReportDimensionsDto, nullable: true })
  dimensions!: SupervisionReportDimensionsDto | null;

  @ApiProperty({ description: '逐条标注 (亮点 / 改进建议 / 风险线索, 锚时间戳)', type: [SupervisionReportAnnotationDto] })
  annotations!: SupervisionReportAnnotationDto[];

  @ApiProperty({ description: '可复用的错误模式 (3-5 条)', type: [String] })
  errorPatterns!: string[];

  @ApiProperty({ description: '成长方向建议 (3-5 条)', type: [String] })
  growthSuggestions!: string[];

  @ApiProperty({ description: '技术统计 (任务 3; 未生成时为 null)', type: SessionTechStatsDto, nullable: true })
  techStats!: SessionTechStatsDto | null;

  @ApiProperty({ description: '移情 / 阻抗标记 (任务 4; 按时间线升序)', type: [TransferenceMarkDto] })
  marks!: TransferenceMarkDto[];

  @ApiProperty({ description: '4 流派反馈 (key=SupervisionSchoolCode; 未生成的流派不在其中)', type: Object })
  feedbackBySchool!: Record<string, SupervisionFeedbackDto>;

  @ApiProperty({ description: '会话开始时间', nullable: true })
  startedAt!: Date | null;

  @ApiProperty({ description: '会话结束时间', nullable: true })
  endedAt!: Date | null;

  @ApiProperty({ description: '对话轮次 (逐字稿条数; 咨询师与来访者各算一条)' })
  turnCount!: number;

  @ApiProperty({ description: '报告生成时间 (ms; 未生成时为 null)', nullable: true })
  createdAt!: number | null;
}
