// V2026-10-23 治本 (AI 模拟来访池 — API 契约 DTO, 1:1 wire spec §3):
//   原因: `docs/specs/counselor-visitor-pool.md` §3 拍板了 3 组公共端点 + 1 组内部端点,
//     前端契约 `xin_su_app/docs/product/visitor-pool-design.md` §4 给了表层字段清单.
//     两者是**前后端唯一契约面** —— 字段改名会同时打断客户端与本端, 且人物卡字段
//     是用户第一眼看到的东西, 改一次等于重做 UI.
//
//   修法: 一份 DTO 文件覆盖全部端点的入参与出参, 全部标 swagger 注解, 便于在
//     swagger 页逐字段核对契约.
//
//   反双胞胎 (重点: 不造孪生 DTO):
//     - **7 大块剧本 DTO 直接复用** `visitor-persona.dto.ts` 里已有的
//       VisitorPersonaBasicsFullDto / ...DevelopmentalStageDto / ...InnerWorkingModelDto /
//       ...SocialRelationDto / ...CopingDto / ...TherapyExpectationDto / ...PresentingIssueDto.
//       管理端 §3.6 要返回含 script 的全量详情, 而 script 的结构与「上帝视角全量视图」
//       完全同构 —— 复用一个类, 契约只有一份, 不会出现"两处描述同一份剧本但字段漂移".
//     - **不新建** difficulty / styleHint / mode 的 DTO: 直接用仓库既有的
//       TrainingDifficulty / VisitorStyle / VisitorMode 枚举 (见 enums/visitor-pool.enum.ts).
//     - **不出参不含 script**: 公共 DTO 只引用 VisitorPoolCardDto, 7 大块 DTO 仅出现在
//       管理端 DTO 里 —— 公共接口下发剧本 = 破防信息分层 (spec §4 红线).
//     - **不出参不含任何计数字段**: 零压红线 (无 likeCount / favoriteCount / useCount).
//       契约里没有这个字段, 客户端就不可能渲染出"42 人收藏".
//
//   验证:
//     1. tsc 0 错
//     2. swagger 页 /counselor/visitor-pool* 可见端点与字段, 逐字段对齐 spec §3
//     3. 全文件 grep 'likeCount\|favoriteCount\|useCount\|script' 于公共 DTO → 0 命中
//
//   时间戳: 2026-10-23
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

import {
  VisitorPersonaBasicsFullDto,
  VisitorPersonaCopingDto,
  VisitorPersonaDevelopmentalStageDto,
  VisitorPersonaInnerWorkingModelDto,
  VisitorPersonaPresentingIssueDto,
  VisitorPersonaSocialRelationDto,
  VisitorPersonaTherapyExpectationDto,
} from './visitor-persona.dto';
import {
  VISITOR_POOL_GENERATE_MAX_COUNT_DEFAULT,
  VISITOR_POOL_GENERATE_MAX_COUNT_LIMIT,
  VISITOR_POOL_LIST_DEFAULT_LIMIT,
  VISITOR_POOL_LIST_MAX_LIMIT,
} from '../config/visitor-pool.config';
import { TrainingDifficulty } from '../enums/training-difficulty.enum';
import { VisitorMode } from '../enums/visitor-mode.enum';
import { VisitorPoolDefenseType, VisitorPoolIssueDomain, VisitorPoolSource, VisitorPoolTemplateStatus } from '../enums/visitor-pool.enum';
import { VisitorStyle } from '../enums/visitor-style.enum';

// 值导入 (非 import type): @ApiProperty({ type: X }) 需要运行时类引用.
//   (DTO 作为 @Body/@Query 参数时必须是**值导入**, 否则 design:paramtypes 元数据
//    退化成 Object → 全局 ValidationPipe 静默跳过校验. 本文件里 7 大块 DTO 只做
//    出参 type 引用, 但仍走值导入, 与仓库既有 DTO 写法一致.)

// ════════════════════════════════════════════════════════════════════════════
// 公共端点 (§3.1 图鉴 / §3.2 详情 / §3.3 实例化 / §3.4 收藏)
// ════════════════════════════════════════════════════════════════════════════

export class VisitorPoolCardDto {
  @ApiProperty({ description: '公共模板唯一 id (图鉴详情 / 实例化 / 收藏三个路径都用它)', example: 'vpt_intimate_avoidance_l1' })
  templateId!: string;

  @ApiProperty({
    description: '匿名称呼 (中性乳名, 后端命名规则维护; 撞名时带去重尾号)',
    example: '晚晴',
  })
  codename!: string;

  @ApiProperty({ description: '年龄区间 (不给精确生日)', example: '28-35' })
  ageRange!: string;

  @ApiProperty({ description: '初次见面主动呈现的一句话主诉', example: '总在关系里先讨好，事后又一个人觉得委屈' })
  presentingComplaint!: string;

  @ApiProperty({
    description: '主导防御类型 (人物属性, 临场锁定不可改)',
    enum: VisitorPoolDefenseType,
  })
  defenseType!: VisitorPoolDefenseType;

  @ApiProperty({ description: '议题领域 (筛选 + 标签)', enum: VisitorPoolIssueDomain })
  issueDomain!: VisitorPoolIssueDomain;

  @ApiProperty({ description: '推荐训练目标', example: '练开放式提问与情绪反射' })
  trainingGoal!: string;

  @ApiProperty({ description: '难度档 (配合度梯度)', enum: TrainingDifficulty })
  difficulty!: TrainingDifficulty;

  @ApiProperty({ description: '案例来源 (本期恒为 official)', enum: VisitorPoolSource })
  source!: VisitorPoolSource;

  @ApiProperty({
    description: '本人是否已收藏 (**仅本人状态**, 不含任何他人信息与全站计数)',
    example: false,
  })
  favorited!: boolean;
}

export class VisitorPoolListDto {
  @ApiProperty({ description: '人物卡列表', type: [VisitorPoolCardDto] })
  items!: VisitorPoolCardDto[];

  @ApiProperty({
    description: '下一页游标 (传回列表接口的 cursor 参数); 已是末页时为 null',
    nullable: true,
    example: 'vpt_workplace_intellectualization_l1',
  })
  nextCursor!: string | null;
}

export class VisitorPoolQueryDto {
  @ApiPropertyOptional({ description: '按议题领域过滤', enum: VisitorPoolIssueDomain })
  @IsOptional()
  @IsEnum(VisitorPoolIssueDomain)
  issueDomain?: VisitorPoolIssueDomain;

  @ApiPropertyOptional({ description: '按难度档过滤', enum: TrainingDifficulty })
  @IsOptional()
  @IsEnum(TrainingDifficulty)
  difficulty?: TrainingDifficulty;

  @ApiPropertyOptional({ description: '按主导防御类型过滤', enum: VisitorPoolDefenseType })
  @IsOptional()
  @IsEnum(VisitorPoolDefenseType)
  defenseType?: VisitorPoolDefenseType;

  @ApiPropertyOptional({
    description: '按推荐训练目标过滤 (模糊匹配, 命中子串即算)',
    example: '开放式提问',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  trainingGoal?: string;

  @ApiPropertyOptional({ description: '按案例来源过滤', enum: VisitorPoolSource })
  @IsOptional()
  @IsEnum(VisitorPoolSource)
  source?: VisitorPoolSource;

  @ApiPropertyOptional({
    description: '游标 (上一页返回的 nextCursor); 传它则取"该条之后"的一批',
    example: 'vpt_workplace_intellectualization_l1',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  cursor?: string;

  @ApiPropertyOptional({
    description: `单批条数 (默认 ${VISITOR_POOL_LIST_DEFAULT_LIMIT}, 上限 ${VISITOR_POOL_LIST_MAX_LIMIT})`,
    example: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(VISITOR_POOL_LIST_MAX_LIMIT)
  limit?: number;
}

/**
 * 实例化入参 —— 临场参数覆盖 (全部可选, 缺省用模板默认).
 *
 * 注意这里**没有** defenseType: 防御类型是人物属性, 临场不可改 (前端契约 §1 红线).
 * 可覆盖的只有"数值音量": 情绪基线 / 防御水平 / 难度 / 模式 / 种子.
 */
export class InstantiateVisitorPoolDto {
  @ApiPropertyOptional({ description: '情绪基线 0-1 (在人物默认值上覆盖)', example: 0.4 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  emotionBaseline?: number;

  @ApiPropertyOptional({ description: '防御水平 0-1 (数值覆盖, **不是**换防御类型)', example: 0.3 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  defenseLevel?: number;

  @ApiPropertyOptional({ description: '难度档 (在人物默认值上覆盖)', enum: TrainingDifficulty })
  @IsOptional()
  @IsEnum(TrainingDifficulty)
  difficulty?: TrainingDifficulty;

  @ApiPropertyOptional({ description: '训练模式: 按我设置 / 完全真实', enum: VisitorMode })
  @IsOptional()
  @IsEnum(VisitorMode)
  mode?: VisitorMode;

  @ApiPropertyOptional({ description: '随机种子 (完全真实模式下重 roll 用)', example: 'seed-20261023' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  randomSeed?: string;
}

export class VisitorPoolDefaultPresetDto {
  @ApiProperty({ description: '配合风格 (实例化时写入私有副本)', enum: VisitorStyle })
  styleHint!: VisitorStyle;

  @ApiProperty({ description: '生效的情绪基线 0-1', example: 0.35 })
  emotionBaseline!: number;

  @ApiProperty({ description: '生效的防御水平 0-1', example: 0.2 })
  defenseLevel!: number;

  @ApiProperty({ description: '生效的难度档', enum: TrainingDifficulty })
  difficulty!: TrainingDifficulty;

  @ApiProperty({ description: '生效的训练模式', enum: VisitorMode })
  mode!: VisitorMode;

  @ApiProperty({ description: '生效的随机种子', example: 'seed-20261023' })
  randomSeed!: string;
}

export class VisitorPoolInstantiateResultDto {
  @ApiProperty({ description: '新建私有副本的 id (后续用现有 visitor-personas 端点读写它)', example: 'uuid-副本' })
  personaId!: string;

  @ApiProperty({ description: '来源模板的表层卡片', type: VisitorPoolCardDto })
  card!: VisitorPoolCardDto;

  @ApiProperty({ description: '本场生效的临场参数 (人物默认值 + 本次覆盖)', type: VisitorPoolDefaultPresetDto })
  defaultPreset!: VisitorPoolDefaultPresetDto;
}

export class VisitorPoolFavoriteResultDto {
  @ApiProperty({ description: '公共模板 id', example: 'vpt_intimate_avoidance_l1' })
  templateId!: string;

  @ApiProperty({ description: '操作后本人的收藏状态', example: true })
  favorited!: boolean;
}

// ════════════════════════════════════════════════════════════════════════════
// 内部端点 (§3.5 AI 生成 / §3.6 管理读写)
// ════════════════════════════════════════════════════════════════════════════

export class GenerateVisitorPoolTemplateDto {
  @ApiPropertyOptional({ description: '议题领域 (缺省由 LLM 决定)', enum: VisitorPoolIssueDomain })
  @IsOptional()
  @IsEnum(VisitorPoolIssueDomain)
  issueDomain?: VisitorPoolIssueDomain;

  @ApiPropertyOptional({ description: '主导防御类型 (缺省由 LLM 决定)', enum: VisitorPoolDefenseType })
  @IsOptional()
  @IsEnum(VisitorPoolDefenseType)
  defenseType?: VisitorPoolDefenseType;

  @ApiPropertyOptional({ description: '难度档 (缺省由 LLM 决定)', enum: TrainingDifficulty })
  @IsOptional()
  @IsEnum(TrainingDifficulty)
  difficulty?: TrainingDifficulty;

  @ApiPropertyOptional({ description: '推荐训练目标方向 (缺省由 LLM 决定)', example: '练开放式提问' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  trainingGoal?: string;

  @ApiPropertyOptional({
    description: '代号方向提示 (常见中性称呼的方向, 如「一字/双字/叠字」; 缺省由模型决定; 落地时若不合规或已占用, 后端从词库另配)',
    example: '普通双字称呼',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  codenameHint?: string;

  @ApiPropertyOptional({
    description: `生成条数 (默认 ${VISITOR_POOL_GENERATE_MAX_COUNT_DEFAULT}, 硬顶 ${VISITOR_POOL_GENERATE_MAX_COUNT_LIMIT}; 实际还受 env 上限约束)`,
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(VISITOR_POOL_GENERATE_MAX_COUNT_LIMIT)
  count?: number;

  @ApiPropertyOptional({
    description: '是否直接上架 (缺省 false = 落草稿待人工审核; spec §3.5 规定默认草稿)',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  publish?: boolean;
}

/**
 * 管理端模板详情 (含 7 大块剧本).
 *
 * **仅内部**: 公共接口的出参里没有 script (spec §4: script 全量剧本任何公共接口都不下发).
 */
/**
 * 7 大块剧本 (管理端专用容器).
 *
 * **必须声明在 VisitorPoolAdminTemplateDto 之前**: `@ApiProperty({ type: X })` 在类定义时
 * 就会被求值, 引用尚未声明的类会报 TS2449 (used before its declaration).
 */
export class VisitorPoolAdminScriptDto {
  @ApiProperty({ description: '1. 基础信息', type: VisitorPersonaBasicsFullDto })
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
}

export class VisitorPoolAdminTemplateDto {
  @ApiProperty({ description: '公共模板 id', example: 'vpt_intimate_avoidance_l1' })
  templateId!: string;

  @ApiProperty({ description: '匿名称呼', example: '晚晴' })
  codename!: string;

  @ApiProperty({ description: '年龄区间', example: '28-35' })
  ageRange!: string;

  @ApiProperty({ description: '一句话主诉' })
  presentingComplaint!: string;

  @ApiProperty({ description: '主导防御类型', enum: VisitorPoolDefenseType })
  defenseType!: VisitorPoolDefenseType;

  @ApiProperty({ description: '议题领域', enum: VisitorPoolIssueDomain })
  issueDomain!: VisitorPoolIssueDomain;

  @ApiProperty({ description: '推荐训练目标' })
  trainingGoal!: string;

  @ApiProperty({ description: '难度档', enum: TrainingDifficulty })
  difficulty!: TrainingDifficulty;

  @ApiProperty({ description: '案例来源', enum: VisitorPoolSource })
  source!: VisitorPoolSource;

  @ApiProperty({ description: '配合风格', enum: VisitorStyle })
  styleHint!: VisitorStyle;

  @ApiProperty({ description: '默认情绪基线 0-1' })
  emotionBaselineDefault!: number;

  @ApiProperty({ description: '默认防御水平 0-1' })
  defenseLevelDefault!: number;

  @ApiProperty({ description: '上下架开关 (1 = 已上架)' })
  enabled!: boolean;

  @ApiProperty({ description: '上架状态 (由 enabled + deletedAt 派生)', enum: VisitorPoolTemplateStatus })
  status!: VisitorPoolTemplateStatus;

  @ApiProperty({ description: '图鉴排序', example: 10 })
  sortOrder!: number;

  @ApiProperty({ description: '7 大块全量剧本 (**仅内部可见**)', type: VisitorPoolAdminScriptDto })
  script!: VisitorPoolAdminScriptDto;

  @ApiProperty({ description: '创建时间' })
  createdAt!: Date;

  @ApiProperty({ description: '更新时间' })
  updatedAt!: Date;
}

export class VisitorPoolAdminListItemDto {
  @ApiProperty({ description: '公共模板 id' })
  templateId!: string;

  @ApiProperty({ description: '匿名称呼' })
  codename!: string;

  @ApiProperty({ description: '议题领域', enum: VisitorPoolIssueDomain })
  issueDomain!: VisitorPoolIssueDomain;

  @ApiProperty({ description: '主导防御类型', enum: VisitorPoolDefenseType })
  defenseType!: VisitorPoolDefenseType;

  @ApiProperty({ description: '难度档', enum: TrainingDifficulty })
  difficulty!: TrainingDifficulty;

  @ApiProperty({ description: '案例来源', enum: VisitorPoolSource })
  source!: VisitorPoolSource;

  @ApiProperty({ description: '上下架开关' })
  enabled!: boolean;

  @ApiProperty({ description: '上架状态 (由 enabled + deletedAt 派生)', enum: VisitorPoolTemplateStatus })
  status!: VisitorPoolTemplateStatus;

  @ApiProperty({ description: '图鉴排序' })
  sortOrder!: number;

  @ApiProperty({ description: '更新时间' })
  updatedAt!: Date;
}

export class VisitorPoolAdminListDto {
  @ApiProperty({ description: '模板列表 (含草稿 / 已下架)', type: [VisitorPoolAdminListItemDto] })
  items!: VisitorPoolAdminListItemDto[];

  @ApiProperty({ description: '下一页游标; 已是末页时为 null', nullable: true })
  nextCursor!: string | null;
}

export class VisitorPoolAdminListQueryDto {
  @ApiPropertyOptional({
    description: '按上架状态过滤: draft (待审草稿) / enabled (已上架) / off (已下架软删); 缺省返回全部',
    enum: VisitorPoolTemplateStatus,
  })
  @IsOptional()
  @IsEnum(VisitorPoolTemplateStatus)
  status?: VisitorPoolTemplateStatus;

  @ApiPropertyOptional({ description: '按议题领域过滤', enum: VisitorPoolIssueDomain })
  @IsOptional()
  @IsEnum(VisitorPoolIssueDomain)
  issueDomain?: VisitorPoolIssueDomain;

  @ApiPropertyOptional({ description: '按难度档过滤', enum: TrainingDifficulty })
  @IsOptional()
  @IsEnum(TrainingDifficulty)
  difficulty?: TrainingDifficulty;

  @ApiPropertyOptional({ description: '游标 (上一页返回的 nextCursor)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  cursor?: string;

  @ApiPropertyOptional({
    description: `单批条数 (默认 ${VISITOR_POOL_LIST_DEFAULT_LIMIT}, 上限 ${VISITOR_POOL_LIST_MAX_LIMIT})`,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(VISITOR_POOL_LIST_MAX_LIMIT)
  limit?: number;
}

/**
 * 管理端编辑入参 (表层字段 / 上下架 / 排序).
 *
 * 全部可选: 只改**显式传入**的字段, 未传的保持原样 (逐字段白名单拷贝,
 * 不用 spread 覆盖成 undefined).
 */
export class UpdateVisitorPoolTemplateDto {
  @ApiPropertyOptional({ description: '匿名称呼' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  codename?: string;

  @ApiPropertyOptional({ description: '年龄区间', example: '28-35' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  ageRange?: string;

  @ApiPropertyOptional({ description: '一句话主诉' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  presentingComplaint?: string;

  @ApiPropertyOptional({ description: '主导防御类型', enum: VisitorPoolDefenseType })
  @IsOptional()
  @IsEnum(VisitorPoolDefenseType)
  defenseType?: VisitorPoolDefenseType;

  @ApiPropertyOptional({ description: '议题领域', enum: VisitorPoolIssueDomain })
  @IsOptional()
  @IsEnum(VisitorPoolIssueDomain)
  issueDomain?: VisitorPoolIssueDomain;

  @ApiPropertyOptional({ description: '推荐训练目标' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  trainingGoal?: string;

  @ApiPropertyOptional({ description: '难度档', enum: TrainingDifficulty })
  @IsOptional()
  @IsEnum(TrainingDifficulty)
  difficulty?: TrainingDifficulty;

  @ApiPropertyOptional({ description: '配合风格', enum: VisitorStyle })
  @IsOptional()
  @IsEnum(VisitorStyle)
  styleHint?: VisitorStyle;

  @ApiPropertyOptional({ description: '默认情绪基线 0-1' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  emotionBaselineDefault?: number;

  @ApiPropertyOptional({ description: '默认防御水平 0-1' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  defenseLevelDefault?: number;

  @ApiPropertyOptional({ description: '上下架开关 (true = 上架, false = 下架)' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ description: '图鉴排序 (小的在前)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999_999)
  sortOrder?: number;
}
