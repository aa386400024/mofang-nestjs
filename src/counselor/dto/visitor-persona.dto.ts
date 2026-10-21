// V2026-10-21 治本 (V1.2 VS-B1 — M1 分层人设 DTO):
//   原因: v1.2 spec §4.2 给了两层视图契约, 但没给 DTO 形状. 前端要靠 DTO 拿:
//     - 视图 A (表层配置): 只暴露"来访初次见面愿意主动呈现的内容" + 允许编辑的字段
//     - 全量视图 (上帝视角): 默认关闭, 开启才返回完整 7 大块
//     - 视图 B (动态解锁档案): 按 layer 分区的条目列表
//   修法: 7 个 DTO:
//     - VisitorPersonaSurfaceDto        视图 A 读 (表层)
//     - VisitorPersonaFullDto           上帝视角读 (7 大块)
//     - UpdateVisitorPersonaSurfaceDto  视图 A 写 (只含表层可编辑字段, 深层字段不在 DTO 里)
//     - GenerateVisitorPersonaDto       「随机生成个案」入参
//     - CaseProfileEntryDto             档案条目读
//     - CreateCaseProfileEntryDto       档案条目写 (咨询师手写)
//     - CaseProfileEntriesDto           档案列表 (按 layer 分区)
//   反双胞胎:
//     - 不在 Update DTO 里放全量字段: 表层 PATCH **只改暴露字段**, 深层字段连 DTO 都不出现,
//       前端就算传了也过不了白名单 (class-validator whitelist:true 会剥掉无装饰器的属性)
//     - 不用 PartialType 全量 DTO: 那样等于把 7 大块暴露成可写, 直接破防"信息分层" (§2.2 原则 2)
//     - 不用 `Record<string, unknown>` 装 json 字段: noPropertyAccessFromIndexSignature 下
//       点访问会报 TS4111, 且无编译期保护
//   验证:
//     1. tsc 0 错
//     2. 大炮 PATCH 传 { basics: { age: 30 } } → 200, 深层字段原样不动
//     3. 大炮 PATCH 传 { innerWorkingModel: {...} } → 400 (DTO 里没有该字段)
//   时间戳: 2026-10-21

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

import type {
  AttachmentType,
  SelfReportedRisk,
  SocialRelationType,
  SocialResourceDrain,
  DevelopmentalStage,
} from '../domain/visitor-persona/visitor-persona.types';

// ════════════════════════════════════════════════════════════════════════════
// 视图 A: 表层信息 (读)
// ════════════════════════════════════════════════════════════════════════════

export class VisitorPersonaBasicsSurfaceDto {
  @ApiProperty({ description: '年龄', example: 28 })
  age!: number;

  @ApiProperty({ description: '自报性别', example: '女' })
  gender!: string;

  @ApiProperty({ description: '职业', example: '中学教师' })
  occupation!: string;
}

export class VisitorPersonaPresentingIssueDto {
  @ApiProperty({ description: '来访自述症状', example: '最近三个月总是失眠, 白天没精神' })
  selfReport!: string;

  @ApiProperty({ description: '持续时长', example: '3 个月' })
  duration!: string;

  @ApiProperty({ description: '睡眠 / 食欲状况', example: '入睡困难, 食欲下降' })
  sleepAppetite!: string;

  @ApiProperty({
    description: '自述风险水平 (concealed = 来访隐瞒真实风险)',
    enum: ['low', 'medium', 'high', 'concealed'],
  })
  selfReportedRisk!: SelfReportedRisk;
}

export class VisitorPersonaRelationSurfaceDto {
  @ApiProperty({ description: '关系类型', enum: ['parent', 'intimate', 'workplace', 'peer'] })
  relationType!: SocialRelationType;

  @ApiProperty({ description: '当前关系状态 (一句话)', example: '和父亲关系紧张, 常年不联系' })
  currentStatus!: string;
}

export class VisitorPersonaSurfaceDto {
  @ApiProperty({ description: '全量人设 id (UUID)' })
  id!: string;

  @ApiProperty({ description: '来访者代号', example: '来访者 A' })
  displayName!: string;

  @ApiProperty({ description: '表层基础信息 (年龄 / 性别 / 职业)', type: VisitorPersonaBasicsSurfaceDto })
  basics!: VisitorPersonaBasicsSurfaceDto;

  @ApiProperty({ description: '当前主诉', type: VisitorPersonaPresentingIssueDto })
  presentingIssue!: VisitorPersonaPresentingIssueDto;

  @ApiProperty({
    description: '表层关系简述 (只含 intimate / parent 2 类)',
    type: [VisitorPersonaRelationSurfaceDto],
  })
  relations!: VisitorPersonaRelationSurfaceDto[];

  @ApiProperty({ description: '归属长程个案 id (未转长程时为 null)', nullable: true })
  caseId!: string | null;

  @ApiProperty({ description: '创建时间' })
  createdAt!: Date;

  @ApiProperty({ description: '更新时间' })
  updatedAt!: Date;
}

// ════════════════════════════════════════════════════════════════════════════
// 上帝视角: 全量视图 (读)
// ════════════════════════════════════════════════════════════════════════════

export class VisitorPersonaDevelopmentalStageDto {
  @ApiProperty({ description: '成长阶段', enum: ['0-6', '7-12', '13-18', '19-25', '26+'] })
  stage!: DevelopmentalStage;

  @ApiProperty({ description: '养育模式', example: '严父弱母, 情感表达被压抑' })
  parentingStyle!: string;

  @ApiProperty({ description: '重大事件', type: [String] })
  keyEvents!: string[];

  @ApiProperty({ description: '家庭禁忌话题 (触发阻抗的钩子)', type: [String] })
  tabooTopics!: string[];
}

export class VisitorPersonaInnerWorkingModelDto {
  @ApiProperty({ description: '依恋类型', enum: ['secure', 'anxious', 'avoidant', 'disorganized'] })
  attachmentType!: AttachmentType;

  @ApiProperty({ description: '核心信念', type: [String] })
  coreBeliefs!: string[];

  @ApiProperty({ description: '隐性创伤', type: [String] })
  hiddenTrauma!: string[];

  @ApiProperty({ description: '未完成情结', type: [String] })
  unfinishedBusiness!: string[];

  @ApiProperty({ description: '防御机制', type: [String] })
  defenseMechanisms!: string[];
}

export class VisitorPersonaSocialRelationDto {
  @ApiProperty({ description: '关系类型', enum: ['parent', 'intimate', 'workplace', 'peer'] })
  relationType!: SocialRelationType;

  @ApiProperty({ description: '当前关系状态' })
  currentStatus!: string;

  @ApiProperty({ description: '冲突模式' })
  conflictPattern!: string;

  @ApiProperty({ description: '资源 / 消耗', enum: ['resource', 'drain', 'neutral'] })
  resourceOrDrain!: SocialResourceDrain;
}

export class VisitorPersonaCopingDto {
  @ApiProperty({ description: '适应性资源', type: [String] })
  adaptiveResources!: string[];

  @ApiProperty({ description: '非适应性策略', type: [String] })
  maladaptiveStrategies!: string[];

  @ApiProperty({ description: '情绪触发点', type: [String] })
  emotionTriggers!: string[];
}

export class VisitorPersonaTherapyExpectationDto {
  @ApiProperty({ description: '对咨询的偏见', type: [String] })
  biases!: string[];

  @ApiProperty({ description: '期待', type: [String] })
  expectations!: string[];

  @ApiProperty({ description: '潜在移情倾向' })
  transferenceTrend!: string;

  @ApiProperty({ description: '阻抗模式' })
  resistancePattern!: string;
}

export class VisitorPersonaBasicsFullDto {
  @ApiProperty({ description: '年龄', example: 28 })
  age!: number;

  @ApiProperty({ description: '自报性别', example: '女' })
  gender!: string;

  @ApiProperty({ description: '职业', example: '中学教师' })
  occupation!: string;

  @ApiProperty({ description: '教育程度', example: '本科' })
  education!: string;

  @ApiProperty({ description: '居住状态 (独居 / 合租 / 与家人同住)', example: '与家人同住' })
  livingStatus!: string;

  @ApiProperty({ description: '躯体健康史', example: '无重大躯体疾病, 偶尔偏头痛' })
  somaticHistory!: string;

  @ApiProperty({ description: '既往精神科就诊 / 咨询史', example: '2 年前做过 3 次心理咨询' })
  psychHistory!: string;
}

export class VisitorPersonaFullDto {
  @ApiProperty({ description: '全量人设 id (UUID)' })
  id!: string;

  @ApiProperty({ description: '来访者代号' })
  displayName!: string;

  @ApiProperty({ description: '1. 基础信息 (含教育 / 居住状态 / 躯体史 / 精神科史)', type: VisitorPersonaBasicsFullDto })
  basics!: VisitorPersonaBasicsFullDto;

  @ApiProperty({ description: '2. 成长时间线 (5 段)', type: [VisitorPersonaDevelopmentalStageDto] })
  developmentalTimeline!: VisitorPersonaDevelopmentalStageDto[];

  @ApiProperty({ description: '3. 内在工作模型', type: VisitorPersonaInnerWorkingModelDto })
  innerWorkingModel!: VisitorPersonaInnerWorkingModelDto;

  @ApiProperty({ description: '4. 社会关系图谱', type: [VisitorPersonaSocialRelationDto] })
  socialMap!: VisitorPersonaSocialRelationDto[];

  @ApiProperty({ description: '5. 应对模式', type: VisitorPersonaCopingDto })
  coping!: VisitorPersonaCopingDto;

  @ApiProperty({ description: '6. 咨询预设', type: VisitorPersonaTherapyExpectationDto })
  therapyExpectation!: VisitorPersonaTherapyExpectationDto;

  @ApiProperty({ description: '7. 当前主诉', type: VisitorPersonaPresentingIssueDto })
  presentingIssue!: VisitorPersonaPresentingIssueDto;

  @ApiProperty({ description: '当前咨访信任度 0-1' })
  trustLevel!: number;

  @ApiProperty({ description: '归属长程个案 id', nullable: true })
  caseId!: string | null;
}

// ════════════════════════════════════════════════════════════════════════════
// 视图 A: 表层字段编辑 (写)
// ════════════════════════════════════════════════════════════════════════════

export class UpdateVisitorPersonaBasicsDto {
  @ApiPropertyOptional({ description: '年龄', example: 30 })
  @IsOptional()
  @IsInt()
  @Min(12)
  @Max(100)
  age?: number;

  @ApiPropertyOptional({ description: '自报性别' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  gender?: string;

  @ApiPropertyOptional({ description: '职业' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  occupation?: string;
}

export class UpdateVisitorPersonaPresentingIssueDto {
  @ApiPropertyOptional({ description: '来访自述症状' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  selfReport?: string;

  @ApiPropertyOptional({ description: '持续时长' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  duration?: string;

  @ApiPropertyOptional({ description: '睡眠 / 食欲状况' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sleepAppetite?: string;

  @ApiPropertyOptional({
    description: '自述风险水平',
    enum: ['low', 'medium', 'high', 'concealed'],
  })
  @IsOptional()
  @IsIn(['low', 'medium', 'high', 'concealed'])
  selfReportedRisk?: SelfReportedRisk;
}

export class UpdateVisitorPersonaRelationDto {
  @ApiProperty({ description: '关系类型 (只允许 intimate / parent, 跟视图 A 展示口径一致)', enum: ['parent', 'intimate'] })
  @IsIn(['parent', 'intimate'])
  relationType!: 'parent' | 'intimate';

  @ApiProperty({ description: '当前关系状态 (一句话)', example: '和母亲相依为命, 但很少聊心里话' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  currentStatus!: string;
}

export class UpdateVisitorPersonaSurfaceDto {
  @ApiPropertyOptional({ description: '来访者代号' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  displayName?: string;

  @ApiPropertyOptional({ description: '表层基础信息', type: UpdateVisitorPersonaBasicsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateVisitorPersonaBasicsDto)
  basics?: UpdateVisitorPersonaBasicsDto;

  @ApiPropertyOptional({ description: '当前主诉', type: UpdateVisitorPersonaPresentingIssueDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateVisitorPersonaPresentingIssueDto)
  presentingIssue?: UpdateVisitorPersonaPresentingIssueDto;

  @ApiPropertyOptional({
    description: '表层关系简述 (只允许 intimate / parent)',
    type: [UpdateVisitorPersonaRelationDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateVisitorPersonaRelationDto)
  relations?: UpdateVisitorPersonaRelationDto[];
}

// ════════════════════════════════════════════════════════════════════════════
// 「随机生成个案」入参
// ════════════════════════════════════════════════════════════════════════════

export class GenerateVisitorPersonaDto {
  @ApiPropertyOptional({
    description: '来访者代号 (缺省自动生成, e.g. "来访者 A")',
    example: '来访者 A',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayName?: string;

  @ApiPropertyOptional({
    description: '主诉种子 (给「随机生成」一个方向, 缺省由 LLM 自由发挥)',
    example: '长期失眠伴随工作压力',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  complaintSeed?: string;

  @ApiPropertyOptional({
    description: '性别 (缺省由 LLM 决定)',
    example: '女',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  gender?: string;

  @ApiPropertyOptional({
    description: '年龄 (缺省由 LLM 决定)',
    example: 28,
  })
  @IsOptional()
  @IsInt()
  @Min(12)
  @Max(100)
  age?: number;

  @ApiPropertyOptional({
    description: '归属长程个案 id (转长程时带上, 一次调用完成建档 + 绑定)',
  })
  @IsOptional()
  @IsString()
  @MinLength(36)
  @MaxLength(36)
  caseId?: string;
}

// ════════════════════════════════════════════════════════════════════════════
// 视图 B: 动态解锁档案
// ════════════════════════════════════════════════════════════════════════════

export class CaseProfileEntryDto {
  @ApiProperty({ description: '条目 id (UUID)' })
  id!: string;

  @ApiProperty({ description: '归属长程个案 id' })
  caseId!: string;

  @ApiProperty({ description: '在第几次会谈中披露 (无关联时为 null)', nullable: true })
  sessionId!: string | null;

  @ApiProperty({
    description: '条目层级: self_disclosed (来访主动披露) / therapist_note (咨询师手写)',
    enum: ['self_disclosed', 'therapist_note'],
  })
  layer!: 'self_disclosed' | 'therapist_note';

  @ApiProperty({
    description: '锚点 (对应全量人设的 JSON path)',
    example: 'innerWorkingModel.attachmentType',
  })
  anchorKey!: string;

  @ApiProperty({ description: '条目正文 (披露原话 / 咨询师观察)' })
  content!: string;

  @ApiProperty({ description: '创建时间' })
  createdAt!: Date;
}

export class CreateCaseProfileEntryDto {
  @ApiPropertyOptional({
    description: '在第几次会谈中披露 (long_term_case_sessions.id); 咨询师手写时可省略',
  })
  @IsOptional()
  @IsString()
  @MinLength(36)
  @MaxLength(36)
  sessionId?: string;

  @ApiPropertyOptional({
    description: '锚点 (对应全量人设的 JSON path); 省略表示不指向具体人设节点',
    example: 'innerWorkingModel.attachmentType',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  anchorKey?: string;

  @ApiProperty({ description: '条目正文 (咨询师观察 / 假设)', example: '来访在提到父亲时明显回避目光' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content!: string;
}

export class CaseProfileEntriesDto {
  @ApiProperty({ description: '归属长程个案 id' })
  caseId!: string;

  @ApiProperty({
    description: '来访主动披露的条目 (按时间线升序)',
    type: [CaseProfileEntryDto],
  })
  selfDisclosed!: CaseProfileEntryDto[];

  @ApiProperty({
    description: '咨询师手写观察 / 假设 (与披露区分区展示)',
    type: [CaseProfileEntryDto],
  })
  therapistNotes!: CaseProfileEntryDto[];
}
