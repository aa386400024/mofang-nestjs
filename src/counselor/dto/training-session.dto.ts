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

import { ChatRole } from '../enums/chat-role.enum';
import { DimensionVariance } from '../enums/dimension-variance.enum';
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
}

export class TrainingSessionListQueryDto {
  @ApiPropertyOptional({ description: '按场景过滤' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  scenarioId?: string;

  @ApiPropertyOptional({ description: '按状态过滤', enum: TrainingSessionStatus })
  @IsOptional()
  @IsEnum(TrainingSessionStatus)
  status?: TrainingSessionStatus;

  @ApiPropertyOptional({ description: '页码 (从 1 开始)', default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: '每页条数 (1-100)', default: 20 })
  @IsOptional()
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
    description: '督导派发状态: queued = 已入 BullMQ 队列; enqueue_failed = 入队失败 (client 需提示重试)',
  })
  supervision!: {
    schoolCode: SupervisionSchoolCode;
    status: 'queued' | 'enqueue_failed';
  };
}
