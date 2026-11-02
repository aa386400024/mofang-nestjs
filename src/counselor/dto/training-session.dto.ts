// V2026-10-21 治本 (V1.2 VS-A — training session DTO):
//   原因: v1.1 §6.5 只落了 training_sessions 表 (entity + migration), **0 service / 0 controller**,
//     v1.2 §5.4 / §6.1 / §7.1 / §10.1 全部依赖 "会话生命周期 API" 这个宿主:
//       - §5.4 知情同意 (PATCH /training-sessions/:id/consent/mark, GET .../consent)
//       - §6.1 实时轻提示 (需要 "每轮 counselor 发言后" 这个事件源)
//       - §7.1 长程 24h 间隔校验 (需要上一节 endedAt)
//       - §10.1 初访分流 (单次结束 / 暂存 / 转长程)
//     没有 DTO 就没有 1:1 wire, 前后端契约会漂.
//   修法: 6 个 DTO, 风格跟 src/counselor/dto/ 下既有 6 个 DTO 一致 (camelCase wire +
//     class-validator + @ApiProperty):
//     - CreateTrainingSessionDto       建会话 (必填只留 scenarioId / personaName / personaComplaint,
//                                       其余给服务端默认值, 避免 client 漏传导致 400 打断主流程)
//     - UpdateTrainingSessionStatusDto 状态机推进 (只收目标状态, 合法性由领域守卫判)
//     - AppendTranscriptTurnDto        单轮消息 (跟 entity TrainingTranscriptTurn 1:1)
//     - AppendTranscriptDto            逐字稿写入 (append / replace 双模)
//     - TrainingSessionDetailDto       详情 (含 transcript)
//     - TrainingSessionListItemDto     列表项 (不含 transcript, 减少流量)
//     - TrainingSessionListQueryDto    列表查询 (分页 + 场景 + 状态过滤)
//   反双胞胎:
//     - 不在 DTO 暴露 promptTemplate / 内部评分: 跟 supervision.dto.ts 同口径, 内部字段不外泄
//     - 不用 snake_case wire: 跟 counselor 既有 DTO 风格一致 (server 端 entity snake_case,
//       TypeORM 序列化时自动 camelCase)
//     - 不在 DTO 里做状态迁移校验: 校验在领域守卫 (domain/session-status.guard.ts), DTO 只管形状
//   验证:
//     1. tsc 0 错 (字段 type 严格)
//     2. 大炮跑 swagger 确认 6 个 DTO 字段与接口一致
//   时间戳: 2026-10-21

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import {
  SESSION_LIST_REPORT_STATUS_VALUES,
  SESSION_LIST_TYPE_VALUES,
  type SessionListReportStatus,
  type SessionListType,
} from '../domain/session-view/session-view.types';
import { ChatRole } from '../enums/chat-role.enum';
import { DimensionVariance } from '../enums/dimension-variance.enum';
import { SUPERVISION_FAILURE_CODE_VALUES, SupervisionFailureCode } from '../enums/supervision-failure-code.enum';
import { SupervisionSchoolCode } from '../enums/supervision-school-code.enum';
import { TrainingDifficulty } from '../enums/training-difficulty.enum';
import { TrainingSessionStatus } from '../enums/training-session-status.enum';
import { VisitorMode } from '../enums/visitor-mode.enum';
import { VisitorStyle } from '../enums/visitor-style.enum';

// ════════════════════════════════════════════════════════════════════════════
// 建会话
// ════════════════════════════════════════════════════════════════════════════

export class CreateTrainingSessionDto {
  @ApiProperty({
    description: '场景 id (11 值, 跟 V0.5 client TrainingScenario.id 1:1)',
    example: 'first_interview',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  scenarioId!: string;

  @ApiPropertyOptional({ description: '难度, 缺省 L1', enum: TrainingDifficulty })
  @IsOptional()
  @IsEnum(TrainingDifficulty)
  difficulty?: TrainingDifficulty;

  @ApiPropertyOptional({ description: '计划时长 (分钟), 缺省按难度推导 (L1=10/L2=15/L3=20)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(180)
  durationMinutes?: number;

  @ApiProperty({ description: '来访者姓名 / 代号', example: '来访者 A' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  personaName!: string;

  @ApiPropertyOptional({ description: '来访者年龄, 缺省 28' })
  @IsOptional()
  @IsInt()
  @Min(12)
  @Max(100)
  personaAge?: number;

  @ApiPropertyOptional({ description: '来访者职业, 缺省空串' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  personaOccupation?: string;

  @ApiProperty({ description: '来访者主诉' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  personaComplaint!: string;

  @ApiPropertyOptional({ description: '来访者背景, 缺省空串' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  personaBackground?: string;

  @ApiPropertyOptional({ description: '行为风格, 缺省 mixed', enum: VisitorStyle })
  @IsOptional()
  @IsEnum(VisitorStyle)
  visitorStyle?: VisitorStyle;

  @ApiPropertyOptional({ description: '情绪基线 0-1, 缺省 0.5' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  emotionBaseline?: number;

  @ApiPropertyOptional({ description: '防御水平 0-1, 缺省 0.3' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  defenseLevel?: number;

  @ApiPropertyOptional({ description: '训练模式, 缺省 useMySettings', enum: VisitorMode })
  @IsOptional()
  @IsEnum(VisitorMode)
  mode?: VisitorMode;

  @ApiPropertyOptional({ description: '风格随机度, 缺省 medium', enum: DimensionVariance })
  @IsOptional()
  @IsEnum(DimensionVariance)
  styleVariance?: DimensionVariance;

  @ApiPropertyOptional({ description: '情绪随机度, 缺省 medium', enum: DimensionVariance })
  @IsOptional()
  @IsEnum(DimensionVariance)
  emotionVariance?: DimensionVariance;

  @ApiPropertyOptional({ description: '防御随机度, 缺省 medium', enum: DimensionVariance })
  @IsOptional()
  @IsEnum(DimensionVariance)
  defenseVariance?: DimensionVariance;
}

// ════════════════════════════════════════════════════════════════════════════
// 状态机推进
// ════════════════════════════════════════════════════════════════════════════

export class UpdateTrainingSessionStatusDto {
  @ApiProperty({ description: '目标状态 (迁移合法性由领域守卫判定)', enum: TrainingSessionStatus })
  @IsEnum(TrainingSessionStatus)
  status!: TrainingSessionStatus;
}

// ════════════════════════════════════════════════════════════════════════════
// 逐字稿写入
// ════════════════════════════════════════════════════════════════════════════

export class AppendTranscriptTurnDto {
  @ApiProperty({ description: '消息 id (UUID, 客户端生成)' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  id!: string;

  @ApiProperty({ description: '角色', enum: ChatRole })
  @IsEnum(ChatRole)
  role!: ChatRole;

  @ApiProperty({ description: '原始文本 (含 (sighs) 等语气词标签)' })
  @IsString()
  @MaxLength(8000)
  text!: string;

  @ApiProperty({ description: '毫秒级时间戳 (跟录音对齐)' })
  @IsInt()
  @Min(0)
  timestamp!: number;

  @ApiPropertyOptional({ description: 'Typing indicator 标记' })
  @IsOptional()
  @IsBoolean()
  isTyping?: boolean;
}

export class AppendTranscriptDto {
  @ApiProperty({ description: '本批消息', type: [AppendTranscriptTurnDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AppendTranscriptTurnDto)
  turns!: AppendTranscriptTurnDto[];

  @ApiPropertyOptional({
    description: '写入模式: append (默认, 追加到尾部) / replace (整体覆盖, 用于 client 断线重连后全量回传)',
    enum: ['append', 'replace'],
  })
  @IsOptional()
  @IsIn(['append', 'replace'])
  mode?: 'append' | 'replace';
}

// ════════════════════════════════════════════════════════════════════════════
// 响应
// ════════════════════════════════════════════════════════════════════════════

export class TrainingSessionDetailDto {
  @ApiProperty({ description: '会话 id (UUID)' })
  id!: string;

  @ApiProperty({ description: '场景 id' })
  scenarioId!: string;

  @ApiProperty({ description: '状态', enum: TrainingSessionStatus })
  status!: TrainingSessionStatus;

  @ApiProperty({ description: '难度', enum: TrainingDifficulty })
  difficulty!: TrainingDifficulty;

  @ApiProperty({ description: '计划时长 (分钟)' })
  durationMinutes!: number;

  @ApiProperty({ description: '来访者姓名' })
  personaName!: string;

  @ApiProperty({ description: '来访者年龄' })
  personaAge!: number;

  @ApiProperty({ description: '来访者职业' })
  personaOccupation!: string;

  @ApiProperty({ description: '来访者主诉' })
  personaComplaint!: string;

  @ApiProperty({ description: '来访者背景' })
  personaBackground!: string;

  @ApiProperty({ description: '行为风格', enum: VisitorStyle })
  visitorStyle!: VisitorStyle;

  @ApiProperty({ description: '情绪基线 0-1' })
  emotionBaseline!: number;

  @ApiProperty({ description: '防御水平 0-1' })
  defenseLevel!: number;

  @ApiProperty({ description: '训练模式', enum: VisitorMode })
  mode!: VisitorMode;

  @ApiProperty({ description: '逐字稿 (跟 V0.5 client ChatMessage 1:1)' })
  transcript!: AppendTranscriptTurnDto[];

  @ApiProperty({ description: '开始时间', nullable: true })
  startedAt!: Date | null;

  @ApiProperty({ description: '结束时间', nullable: true })
  endedAt!: Date | null;

  @ApiProperty({ description: '创建时间' })
  createdAt!: Date;
}

export class TrainingSessionListItemDto {
  @ApiProperty({ description: '会话 id (UUID)' })
  id!: string;

  @ApiProperty({ description: '场景 id' })
  scenarioId!: string;

  @ApiProperty({ description: '状态', enum: TrainingSessionStatus })
  status!: TrainingSessionStatus;

  @ApiProperty({ description: '难度', enum: TrainingDifficulty })
  difficulty!: TrainingDifficulty;

  @ApiProperty({ description: '来访者姓名' })
  personaName!: string;

  @ApiProperty({ description: '来访者主诉 (截断展示)' })
  personaComplaint!: string;

  @ApiProperty({ description: '轮次数' })
  turnCount!: number;

  @ApiProperty({ description: '开始时间', nullable: true })
  startedAt!: Date | null;

  @ApiProperty({ description: '结束时间', nullable: true })
  endedAt!: Date | null;

  @ApiProperty({ description: '创建时间' })
  createdAt!: Date;

  // ─── V2026-10-27 治本 (练习历史列表 — 聚合字段) ───
  //   原因: 成长 tab「练习历史」二级页要在一张卡上同时显示"会话类型 / 报告状态 / 总分 /
  //     是否中断", 而这些**全部是派生值** (库里没有对应列), 之前列表接口一个都不下发,
  //     前端只能自己猜 (或者干脆不显示) —— 猜出来的状态会跟报告页对不上.
  //   修法: 列表项在现有字段之后**追加** 4 个派生字段 (规则 A/B/C 的判定集中在
  //     domain/session-view/session-view.types.ts, 纯函数, 可单测).
  //   反双胞胎:
  //     - 不新建独立的 "列表状态" 枚举: 复用既有的 SessionReportStatus 再加 'none' 一档
  //       (详见 domain/session-view/session-view.types.ts 的说明)
  //     - 不在本 DTO 里做判定 (纯装饰器类, 无行为): 判定放 domain, DTO 只声明形状

  @ApiProperty({
    description: '会话类型 (派生: scenarioId == vpt_voice → vpt_voice, 其余 → training_session)',
    enum: SESSION_LIST_TYPE_VALUES,
  })
  sessionType!: SessionListType;

  @ApiProperty({
    description:
      '报告状态 (派生: completed = 报告就绪 / pending = 已结束但报告还没生成 / ' +
      'parse_error = 报告生成失败 (可重试) / no_content = 这场没有足够的对话内容, 报告不会生成 / ' +
      'none = 这条会话不会有报告 (未结束或已中断))',
    enum: SESSION_LIST_REPORT_STATUS_VALUES,
  })
  reportStatus!: SessionListReportStatus;

  @ApiProperty({
    description: '报告总分 0-100 (仅 reportStatus=completed 时有值, 其余一律 null, 绝不补 0)',
    nullable: true,
  })
  overallScore!: number | null;

  @ApiProperty({ description: '报告是否就绪 (= reportStatus === completed)' })
  reportReady!: boolean;

  @ApiProperty({
    description:
      '失败原因码 (仅 reportStatus=parse_error 时有值; 其余一律 null). ' +
      'upstream_unavailable / rate_limited / parse_failed / timeout / empty_material / school_missing',
    enum: SUPERVISION_FAILURE_CODE_VALUES,
    nullable: true,
  })
  failureCode!: SupervisionFailureCode | null;

  @ApiProperty({
    description: '是否可手动重试 (仅 reportStatus=parse_error 且素材充足时为 true; no_content 不可重试)',
  })
  retryable!: boolean;

  @ApiProperty({ description: '是否中断 (开过头没收尾, 前端灰态展示)' })
  interrupted!: boolean;

  @ApiProperty({
    description: '会话时长 (秒) — endedAt - startedAt, 后端算好下发; 未结束或缺起点时为 null',
    nullable: true,
  })
  durationSeconds!: number | null;
}

export class TrainingSessionListQueryDto {
  @ApiPropertyOptional({ description: '按场景过滤' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  scenarioId?: string;

  @ApiPropertyOptional({
    description:
      '按会话类型过滤 (前端分段切换用): vpt_voice = 全真语音, training_session = 单次训练; ' +
      '不传 = 全部. 内部映射到 scenarioId (表内无独立 type 列)',
    enum: SESSION_LIST_TYPE_VALUES,
  })
  @IsOptional()
  @IsIn(SESSION_LIST_TYPE_VALUES)
  sessionType?: SessionListType;

  @ApiPropertyOptional({ description: '按状态过滤', enum: TrainingSessionStatus })
  @IsOptional()
  @IsEnum(TrainingSessionStatus)
  status?: TrainingSessionStatus;

  @ApiPropertyOptional({ description: '页码 (从 1 开始)', default: 1 })
  @IsOptional()
  // V2026-10-27 治本 (练习历史列表 — 修 query 数字参数被当字符串拒掉):
  //   原因: 全局 ValidationPipe 只开了 transform + whitelist, **没开** enableImplicitConversion
  //     (src/app.module.ts:255) → class-transformer 不会把 query 里的 "1" 转成数字,
  //     于是 @IsInt() 直接 400 ("page must be an integer number").
  //     前端练习历史页 (GET /counselor/training-sessions?page=1&pageSize=20) 正是这样传的,
  //     也就是说这个列表端点**当前对前端是 400 的** —— 页面根本拿不到数据.
  //   修法: 按仓库既有写法 (dto/quote.dto.ts:102, dto/visitor-pool.dto.ts:160 等) 补
  //     @Type(() => Number), 让 class-transformer 先转类型再校验.
  //   反双胞胎:
  //     - 不去改全局 ValidationPipe 开 enableImplicitConversion: 那是全仓 200+ 个 DTO 的
  //       行为变更 (字符串字段也可能被误转), 影响面远超本单, 属独立改造.
  //     - 不用 `@Transform(({ value }) => Number(value))`: 仓库既有约定是 @Type(() => Number),
  //       不引第二种写法.
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: '每页条数 (1-100)', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

// ════════════════════════════════════════════════════════════════════════════
// 结束会话
// ════════════════════════════════════════════════════════════════════════════

export class FinishTrainingSessionDto {
  @ApiPropertyOptional({
    description: '本次生成督导反馈的流派, 缺省 CBT',
    enum: SupervisionSchoolCode,
  })
  @IsOptional()
  @IsEnum(SupervisionSchoolCode)
  schoolCode?: SupervisionSchoolCode;
}

export class FinishTrainingSessionResultDto {
  @ApiProperty({ description: '会话 id (UUID)' })
  sessionId!: string;

  @ApiProperty({ description: '结束后的状态', enum: TrainingSessionStatus })
  status!: TrainingSessionStatus;

  @ApiProperty({ description: '结束时间', nullable: true })
  endedAt!: Date | null;

  @ApiProperty({
    description:
      '督导派发状态: queued = 已入 BullMQ 队列; enqueue_failed = 入队失败 (client 需提示重试); ' +
      'no_content = 这场没有足够的对话内容 (有效轮 < 2 或有效字数 < 30), 不派发督导, 也不会有报告',
    enum: ['queued', 'enqueue_failed', 'no_content'],
  })
  supervision!: {
    schoolCode: SupervisionSchoolCode;
    status: 'queued' | 'enqueue_failed' | 'no_content';
  };
}
