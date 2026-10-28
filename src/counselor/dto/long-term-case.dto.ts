// V2026-10-15 治本 (V1.2 — long-term-case.dto.ts, 5 DTO 1:1 wire):
//   原因: counselor-mode-v1.0 §6.1 拍板 long_term_case 1:N long_term_case_session 2 实体,
//     V0.3 §13 baseline 0 长程, 1:1 wire 0 破坏. 5 DTO 1:1 对应 xin_su_app LongTermCase
//     entity 字段, 跟 client 1:1 同步 wire 协议.
//
//   修法:
//     - 5 DTO 跟 V0.5 已有 counselor-home / counselor-training DTO 风格一致 (ApiProperty +
//       class-validator)
//     - LongTermCaseListItemDto: 列表 (无 sessions 数组, 减少瀑布流)
//     - CreateLongTermCaseDto: 创建输入 (只接 caseType enum, 其余从 preset 拿)
//     - LongTermCaseSessionListItemDto: 单次会话 (无 transcript 详细, 减少 list 流量)
//     - LongTermCaseDetailDto: 详情 (含 sessions 数组 + visitorPersona + nextSessionContext)
//     - NextSessionContextDto: 跨会话 memory 5 字段 (V1.2 🆕 跨会话 agent memory)
//     - 跟 LongTermCaseType 5 enum 严格 1:1 wire (V0.x enum 静态定义 5 值)
//
//   反双胞胎:
//     - 不在 DTO 加 nextSessionContext 写入: DTO 只读, 写入逻辑在 service.buildNextSessionContext
//     - 不在 DTO 加 transcript 完整字段: list 流量控制, 详情按需
//     - 不用 snake_case wire (用 camelCase 跟 V0.x DTO 风格一致, server 端 entity
//       snake_case, JSON 序列化时 TypeORM 自动 camelCase)
//
//   验证:
//     1. tsc 0 错 (5 DTO 字段 type 严格)
//     2. 跟 xin_su_app LongTermCase entity 字段 1:1 wire 验证 (V1.x client 端联调时)
//
//   时间戳: 2026-10-15

import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { LongTermCaseStatus } from '../enums/long-term-case-status.enum';
import { LongTermCaseType } from '../enums/long-term-case-type.enum';

// ════════════════════════════════════════════════════════════════════════════
// 来访者人设 (跟 long-term-case-presets.ts 1:1, 跟 xin_su_app LongTermCaseVisitorPersona 1:1)
// ════════════════════════════════════════════════════════════════════════════

export class LongTermCaseVisitorPersonaDto {
  @ApiProperty({ description: '来访者姓名', example: '小林' })
  name!: string;

  @ApiProperty({ description: '来访者年龄', example: 28 })
  age!: number;

  @ApiProperty({ description: '来访者职业', example: '互联网产品经理' })
  occupation!: string;

  @ApiProperty({ description: '主诉 (一句话)', example: '入职新公司半年, 频繁焦虑失眠' })
  complaint!: string;

  @ApiProperty({ description: '背景故事 (2-3 句)' })
  background!: string;

  @ApiProperty({ description: '防御层级 0.0-1.0 (0 无防御 / 1 完全封闭)', example: 0.4 })
  defenseLevel!: number;

  @ApiProperty({ description: '情绪基线 0.0-1.0 (0 极低 / 1 极正向)', example: 0.35 })
  emotionBaseline!: number;

  @ApiProperty({ description: '关键议题 (3-5 个, 用于 LLM prompt 约束话题)', type: [String] })
  keyTopics!: string[];
}

// ════════════════════════════════════════════════════════════════════════════
// 🆕 V1.2 跨会话 agent memory (nextSessionContext, 5 字段结构化)
// ════════════════════════════════════════════════════════════════════════════

export class NextSessionContextEmotionDto {
  @ApiProperty({ description: '情绪分数 0.0-1.0 (0 极低 / 1 极正向)', example: 0.45 })
  score!: number;

  @ApiProperty({ description: '情绪标签 (1-3 短词)', example: '焦虑缓解' })
  label!: string;
}

export class NextSessionContextDto {
  @ApiProperty({ description: '当前主导情绪 (score + label, 跨会话累积变化)', type: NextSessionContextEmotionDto })
  currentEmotion!: NextSessionContextEmotionDto;

  @ApiProperty({ description: '本次核心议题 (1-3 短句, 跨会话累积演进)', type: [String], example: ['职业压力', '自我效能'] })
  topic!: string[];

  @ApiProperty({ description: '咨询师已用技术 (数组, 跨会话反查防重复)', type: [String], example: ['开放式提问', '情绪反映'] })
  usedTechniques!: string[];

  @ApiProperty({ description: '咨询师表现亮点 (1-3 短句, 督导正面反馈)', type: [String] })
  counselorStrengths!: string[];

  @ApiProperty({ description: '咨询师待改进 (1-3 短句, 督导负面反馈)', type: [String] })
  counselorWeaknesses!: string[];
}

// ════════════════════════════════════════════════════════════════════════════
// 单次会话 list 项 (无 transcript 详细, 减少 list 流量)
// ════════════════════════════════════════════════════════════════════════════

export class LongTermCaseSessionListItemDto {
  @ApiProperty({ description: '会话 id (UUID)' })
  id!: string;

  @ApiProperty({ description: '1-based 序号 (1-12)', example: 1 })
  sessionNumber!: number;

  @ApiProperty({ description: '本次督导总分 0-100 (V1.x W3-4 接后填)', nullable: true, example: 72 })
  overallScore!: number | null;

  @ApiProperty({ description: '本次会话时长 (秒)', example: 1320 })
  durationSeconds!: number;

  @ApiProperty({ description: '创建时间 (ISO 8601)' })
  createdAt!: string;
}

// ════════════════════════════════════════════════════════════════════════════
// 长程个案 list 项 (无 sessions 数组, 减少瀑布流)
// ════════════════════════════════════════════════════════════════════════════

export class LongTermCaseListItemDto {
  @ApiProperty({ description: '长程个案 id (UUID)' })
  id!: string;

  @ApiProperty({ description: '5 预设类型 (跟 LongTermCaseType 1:1)', enum: LongTermCaseType })
  caseType!: LongTermCaseType;

  @ApiProperty({ description: '个案标题 (UI 列表 / 详情用)' })
  title!: string;

  @ApiProperty({ description: '一句话描述 (UI 卡片副标题)' })
  description!: string;

  @ApiProperty({ description: '1-based 当前会话序号 (1-12)', example: 1 })
  currentSession!: number;

  @ApiProperty({ description: '总会话次数 (4-12)', example: 6 })
  totalSessions!: number;

  @ApiProperty({ description: '3 态: active / completed / abandoned', enum: LongTermCaseStatus })
  status!: LongTermCaseStatus;

  @ApiProperty({ description: '4 段进展曲线: improve / regress / breakthrough / stable' })
  progressCurve!: 'improve' | 'regress' | 'breakthrough' | 'stable';

  @ApiProperty({ description: '脱落风险 0.0-1.0 (阈值 0.7 触发脱落建议)', example: 0.15 })
  dropoutRiskScore!: number;

  @ApiProperty({ description: '创建时间 (ISO 8601)' })
  createdAt!: string;
}

// ════════════════════════════════════════════════════════════════════════════
// 创建输入 (只接 caseType, 其余从 preset 拿)
// ════════════════════════════════════════════════════════════════════════════

export class CreateLongTermCaseDto {
  @ApiProperty({
    description: '5 预设长程个案类型 (跟 long-term-case-presets.ts 1:1)',
    enum: LongTermCaseType,
    example: LongTermCaseType.WORKPLACE,
  })
  @IsEnum(LongTermCaseType, { message: 'caseType 必须是 5 预设之一 (workplace/relationship/parenting/grief/anxiety)' })
  caseType!: LongTermCaseType;

  @ApiProperty({ description: '可选自定义标题 (留空走 preset 默认 title)', required: false, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @MinLength(1)
  customTitle?: string;
}

// ════════════════════════════════════════════════════════════════════════════
// 长程个案详情 (含 sessions 数组 + visitorPersona + nextSessionContext)
// ════════════════════════════════════════════════════════════════════════════

export class LongTermCaseDetailDto extends LongTermCaseListItemDto {
  @ApiProperty({ description: '来访者人设 (跟 preset 1:1)', type: LongTermCaseVisitorPersonaDto })
  visitorPersona!: LongTermCaseVisitorPersonaDto;

  @ApiProperty({ description: '所有会话列表 (倒序, 最新在前)', type: [LongTermCaseSessionListItemDto] })
  sessions!: LongTermCaseSessionListItemDto[];

  @ApiProperty({
    description: '🆕 V1.2 跨会话 agent memory (最后一次 session 的 nextSessionContext, 启动下次注入 LLM)',
    type: NextSessionContextDto,
    nullable: true,
  })
  nextSessionContext!: NextSessionContextDto | null;

  @ApiProperty({ description: '脱落建议 (dropoutRiskScore > 0.7 触发, 否则 null)', nullable: true })
  abandonmentSuggestion!: string | null;
}
