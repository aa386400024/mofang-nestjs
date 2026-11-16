// V2026-10-29 治本 (WP9-B · B 层 · 角色资产池管理端 DTO):
//   职责: 角色 CRUD / 上下架端点的入参与出参契约 (一份文件覆盖全部端点).
//   边界: 纯类型 + 校验装饰器; 零业务逻辑、零 DB.
//
//   为什么用 PartialType 做更新 DTO (而不是像 counselor 那样手写字段):
//     counselor 那边刻意不用 PartialType, 原因是**信息分层** —— 公共端点不能把
//     7 大块剧本暴露成可写. 而这里是**内部 admin 端点**: 5Ps / 信念 / 愿望 /
//     负向约束 / 敏感议题**本来就是**运营要编辑的东西, 没有分层约束.
//     用 PartialType 少写一份 40 行的重复 DTO, 也少一处"字段加漏了"的漂移点.
//
//   反双胞胎:
//     - **不把展示字段塞进来**: 年龄/职业/风险标签等速查卡字段属于
//       visitor_pool_templates 与 BFF, 不归角色基线管 (任务单 §11.3).
//     - **不接受 id**: id 由 template_id 内容派生, 不允许外部指定 (否则会出现
//       "同 id 对两个模板"的历史脏行).
//     - **不开放 count 类字段**: 零压红线, 表里没有、契约里也不下发.
//     - DTO 全部**值导入** (非 import type): 全局 ValidationPipe 靠
//       design:paramtypes 元数据拿 DTO 类, type-only 导入会让校验静默失效.
//
//   验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. swagger 页 /engine/admin/character-profiles 可见端点与字段
//
//   时间戳: 2026-10-29

import { PartialType } from '@nestjs/mapped-types';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import type { CharacterProfileSnapshot } from './character-profile-version.entity.js';
import type { CharacterAuditStatus } from './character-profile.entity.js';
import type { CharacterVersionBump, CharacterVersionChangeType } from './character-version.js';
import type { AttachmentStyle, CoreBelief, UnderlyingDesireSeed } from '../../../engine-core/index.js';

/** 允许的依恋风格 (与内核 AttachmentStyle 同一取值域). */
export const CHARACTER_ATTACHMENT_STYLES: readonly AttachmentStyle[] = ['secure', 'avoidant', 'anxious', 'disorganized'];

/** 允许的审核状态. */
export const CHARACTER_AUDIT_STATUSES: readonly CharacterAuditStatus[] = ['draft', 'approved', 'rejected'];

/**
 * 允许的版本递增档位 (WP38).
 *
 * - major —— 角色定位大改: 进行中锁定 (有活跃会话时拒绝);
 * - minor —— 参数调整: 平滑生效;
 * - patch —— 文案 / 小参数微调: 实时生效 (缺省档).
 */
export const CHARACTER_VERSION_BUMPS: readonly CharacterVersionBump[] = ['major', 'minor', 'patch'];

/**
 * 核心信念入参.
 */
export class CharacterCoreBeliefDto {
  @ApiProperty({ description: '主题标签 (供报告/检索)', example: 'abandonment' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  theme!: string;

  @ApiProperty({ description: '第一人称信念陈述', example: '我要是靠得太近, 最后还是会被抛下。' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  statement!: string;

  @ApiProperty({ description: '激活标签 (命中即激活该信念)', type: [String], example: ['closeness', 'rejection'] })
  @IsArray()
  @IsString({ each: true })
  activationTags!: string[];
}

/**
 * 底层愿望入参.
 */
export class CharacterDesireDto {
  @ApiProperty({ description: '愿望 key', example: 'autonomy' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  key!: string;

  @ApiProperty({ description: '愿望标签', example: '保持自主与距离' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  label!: string;

  @ApiProperty({ description: '基线权重 [0,1]', example: 0.7 })
  @IsNumber()
  @Min(0)
  @Max(1)
  baselineWeight!: number;
}

/**
 * 5Ps 专业材料入参.
 */
export class CharacterFivePsDto {
  @ApiProperty({ description: '当前主诉 (来访者自己怎么说)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  presenting!: string;

  @ApiProperty({ description: '诱发因素 (最近发生了什么)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  precipitating!: string;

  @ApiProperty({ description: '维持因素 (什么让它持续)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  maintaining!: string;

  @ApiProperty({ description: '保护因素 (什么在托住他)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  protective!: string;

  @ApiProperty({ description: '易感因素 (什么让他脆弱)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  vulnerability!: string;
}

/**
 * 新建角色入参.
 */
export class CreateCharacterProfileDto {
  @ApiProperty({ description: '关联的公共模板 id (vpt_* slug); 逻辑外键, 不加 DB FK', example: 'vpt_intimate_avoidance_l1' })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(64)
  templateId!: string;

  @ApiProperty({ description: '展示用角色名 (= 模板代号)', example: '晚晴' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  displayName!: string;

  @ApiProperty({ description: '依恋风格', enum: CHARACTER_ATTACHMENT_STYLES })
  @IsIn(CHARACTER_ATTACHMENT_STYLES)
  attachmentStyle!: AttachmentStyle;

  @ApiProperty({ description: '5Ps 专业材料', type: CharacterFivePsDto })
  @ValidateNested()
  @Type(() => CharacterFivePsDto)
  fivePs!: CharacterFivePsDto;

  @ApiProperty({ description: '初始信任 [0,1]', example: 0.28 })
  @IsNumber()
  @Min(0)
  @Max(1)
  baselineTrust!: number;

  @ApiProperty({ description: '阻抗 · 话量 [0,1]', example: 0.42 })
  @IsNumber()
  @Min(0)
  @Max(1)
  baselineResistanceVerbal!: number;

  @ApiProperty({ description: '阻抗 · 内容深度 [0,1]', example: 0.5 })
  @IsNumber()
  @Min(0)
  @Max(1)
  baselineResistanceDepth!: number;

  @ApiProperty({ description: '阻抗 · 表达风格 [0,1]', example: 0.38 })
  @IsNumber()
  @Min(0)
  @Max(1)
  baselineResistanceStyle!: number;

  @ApiProperty({ description: '情绪效价 [-1,1]', example: -0.45 })
  @IsNumber()
  @Min(-1)
  @Max(1)
  baselineEmotionValence!: number;

  @ApiProperty({ description: '情绪唤醒 [0,1]', example: 0.62 })
  @IsNumber()
  @Min(0)
  @Max(1)
  baselineEmotionArousal!: number;

  @ApiPropertyOptional({
    description: '关系安全感基线 [0,1] (缺省 0.5 —— 走 DB DEFAULT, 与内核 DEFAULT_SAFETY 一致)',
    example: 0.25,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  baselineSafety?: number;

  @ApiPropertyOptional({
    description: '关系联结基线 [0,1] (缺省 0 —— 走 DB DEFAULT, 与内核 DEFAULT_BOND 一致)',
    example: 0.05,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  baselineBond?: number;

  @ApiProperty({ description: '核心信念', type: [CharacterCoreBeliefDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CharacterCoreBeliefDto)
  coreBeliefs!: CharacterCoreBeliefDto[];

  @ApiProperty({ description: '底层愿望', type: [CharacterDesireDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CharacterDesireDto)
  underlyingDesires!: CharacterDesireDto[];

  @ApiProperty({ description: '绝不会做的事 (负向约束; 不作风险信号)', type: [String] })
  @IsArray()
  @IsString({ each: true })
  forbiddenBehaviors!: string[];

  @ApiProperty({ description: '敏感议题词表 (命中触发 sensitive_touch)', type: [String] })
  @IsArray()
  @IsString({ each: true })
  sensitiveTopics!: string[];

  @ApiPropertyOptional({ description: '审核状态 (缺省 draft —— 需显式过审才可被引擎命中)', enum: CHARACTER_AUDIT_STATUSES })
  @IsOptional()
  @IsIn(CHARACTER_AUDIT_STATUSES)
  auditStatus?: CharacterAuditStatus;

  @ApiPropertyOptional({ description: '是否上架 (缺省 true)', example: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/**
 * 编辑角色入参 (全字段可选; 未提供的字段原样保留).
 */
export class UpdateCharacterProfileDto extends PartialType(CreateCharacterProfileDto) {
  /**
   * 版本递增档位 (WP38 · 缺省 patch).
   *
   * 每次更新都会按此档位递增 semver 版本号, 并把**变更后**的完整内容存一份历史快照.
   * major 档在有活跃会话用着这个角色时会被拒绝 (409).
   */
  @ApiPropertyOptional({ description: '版本递增档位 (缺省 patch)', enum: CHARACTER_VERSION_BUMPS })
  @IsOptional()
  @IsIn(CHARACTER_VERSION_BUMPS)
  versionBump?: CharacterVersionBump;
}

/**
 * 管理列表出参 (单条).
 */
export class CharacterProfileAdminDto {
  @ApiProperty({ description: '公共模板 id' })
  templateId!: string;

  @ApiProperty({ description: '展示用角色名' })
  displayName!: string;

  @ApiProperty({ description: '依恋风格', enum: CHARACTER_ATTACHMENT_STYLES })
  attachmentStyle!: AttachmentStyle;

  @ApiProperty({ description: '5Ps 专业材料', type: CharacterFivePsDto })
  fivePs!: CharacterFivePsDto;

  @ApiProperty({ description: '初始信任 [0,1]' })
  baselineTrust!: number;

  @ApiProperty({ description: '阻抗 · 话量 [0,1]' })
  baselineResistanceVerbal!: number;

  @ApiProperty({ description: '阻抗 · 内容深度 [0,1]' })
  baselineResistanceDepth!: number;

  @ApiProperty({ description: '阻抗 · 表达风格 [0,1]' })
  baselineResistanceStyle!: number;

  @ApiProperty({ description: '情绪效价 [-1,1]' })
  baselineEmotionValence!: number;

  @ApiProperty({ description: '情绪唤醒 [0,1]' })
  baselineEmotionArousal!: number;

  @ApiProperty({ description: '关系安全感基线 [0,1] (WP51)' })
  baselineSafety!: number;

  @ApiProperty({ description: '关系联结基线 [0,1] (WP51)' })
  baselineBond!: number;

  @ApiProperty({ description: '核心信念', type: [CharacterCoreBeliefDto] })
  coreBeliefs!: CoreBelief[];

  @ApiProperty({ description: '底层愿望', type: [CharacterDesireDto] })
  underlyingDesires!: UnderlyingDesireSeed[];

  @ApiProperty({ description: '绝不会做的事', type: [String] })
  forbiddenBehaviors!: string[];

  @ApiProperty({ description: '敏感议题词表', type: [String] })
  sensitiveTopics!: string[];

  @ApiProperty({ description: '审核状态', enum: CHARACTER_AUDIT_STATUSES })
  auditStatus!: CharacterAuditStatus;

  @ApiProperty({ description: '是否上架' })
  enabled!: boolean;

  @ApiProperty({ description: '内容版本号 (内容变更即递增)' })
  version!: number;

  @ApiProperty({ description: '主版本号 (semver major; 角色定位大改档)' })
  versionMajor!: number;

  @ApiProperty({ description: '次版本号 (semver minor; 参数调整档)' })
  versionMinor!: number;

  @ApiProperty({ description: '修订号 (semver patch; 文案 / 小参数微调档)' })
  versionPatch!: number;

  @ApiProperty({ description: '版本号字符串 (例 "1.2.0")' })
  versionLabel!: string;

  @ApiProperty({ description: '创建时间' })
  createdAt!: Date;

  @ApiProperty({ description: '更新时间' })
  updatedAt!: Date;
}

/**
 * 历史版本摘要 (一行 = 角色的一版).
 */
export class CharacterProfileVersionSummaryDto {
  @ApiProperty({ description: '公共模板 id' })
  templateId!: string;

  @ApiProperty({ description: '主版本号' })
  versionMajor!: number;

  @ApiProperty({ description: '次版本号' })
  versionMinor!: number;

  @ApiProperty({ description: '修订号' })
  versionPatch!: number;

  @ApiProperty({ description: '版本号字符串 (例 "1.2.0")' })
  versionLabel!: string;

  @ApiProperty({ description: '变更类型: create (首版) / major / minor / patch', enum: ['create', 'major', 'minor', 'patch'] })
  changeType!: CharacterVersionChangeType;

  @ApiProperty({ description: '变更人 id (未知时 null)' })
  changedBy!: string | null;

  @ApiProperty({ description: '留痕时间' })
  createdAt!: Date;
}

/**
 * 历史版本详情 (摘要 + 该版的内容快照).
 */
export class CharacterProfileVersionDetailDto extends CharacterProfileVersionSummaryDto {
  @ApiProperty({ description: '该版本的内容快照 (完整行)' })
  snapshot!: CharacterProfileSnapshot;
}

/**
 * 历史版本列表出参.
 */
export class CharacterProfileVersionListDto {
  @ApiProperty({ description: '历史版本列表', type: [CharacterProfileVersionSummaryDto] })
  items!: CharacterProfileVersionSummaryDto[];

  @ApiProperty({ description: '总条数' })
  total!: number;
}

/**
 * 管理列表出参 (分页).
 */
export class CharacterProfileAdminListDto {
  @ApiProperty({ description: '角色列表', type: [CharacterProfileAdminDto] })
  items!: CharacterProfileAdminDto[];

  @ApiProperty({ description: '总条数' })
  total!: number;
}

/**
 * 管理列表查询入参.
 */
export class CharacterProfileAdminListQueryDto {
  @ApiPropertyOptional({ description: '按公共模板 id 精确过滤', example: 'vpt_intimate_avoidance_l1' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  templateId?: string;

  @ApiPropertyOptional({ description: '按审核状态过滤', enum: CHARACTER_AUDIT_STATUSES })
  @IsOptional()
  @IsIn(CHARACTER_AUDIT_STATUSES)
  auditStatus?: CharacterAuditStatus;

  @ApiPropertyOptional({ description: '按上下架过滤 (字符串 true/false, 避免 query 布尔解析歧义)' })
  @IsOptional()
  @IsIn(['true', 'false'])
  enabled?: string;

  @ApiPropertyOptional({ description: '条数上限 (默认 50)', example: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ description: '偏移量', example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;
}
