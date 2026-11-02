// V2026-10-21 治本 (V1.2 VS-C — M2 知情同意 + M3 会谈核心 DTO):
//   原因: VS-C 4 组新 endpoint (知情同意 2 / 打点 2 / 移情标记 2 / 轻提示 2) 需要 DTO 契约.
//     DTO 形状定错, 前后端要来回改 —— 尤其「4 要素进度」的返回结构前端要直接渲染.
//   修法: 10 个 DTO, 风格跟 counselor 既有 dto/ 目录一致 (camelCase wire + class-validator):
//     - InformedConsentStatusDto        4 要素覆盖进度 (视图 A 风格)
//     - InformedConsentMarkDto           判定入参 (同意阶段转录)
//     - InformedConsentMarkResultDto     判定结果
//     - CreateTranscriptBookmarkDto      打点入参
//     - TranscriptBookmarkDto            打点读
//     - CreateTransferenceMarkDto        移情标记入参 (咨询师手动)
//     - TransferenceMarkDto              移情标记读
//     - LiveSupervisionHintDto           轻提示读 (含 SSE 推送体)
//     - SessionTechStatsDto              技术统计读
//   反双胞胎:
//     - DTO **值导入** (不用 import { type X }): 全局 ValidationPipe 开了 transform + whitelist,
//       靠 design:paramtypes 元数据拿 DTO 类; type-only 导入会让元数据退化成 Object → 校验静默失效
//     - 不把 4 要素做成 4 个独立 DTO 字段: 前端要按序渲染 4 个格子, 数组结构才灵活
//       (将来加第 5 个要素不用改 DTO)
//     - 不在 DTO 里暴露 entity 的 id/tenantId/userId: 只暴露前端真正要的字段
//   验证:
//     1. tsc 0 错
//     2. 大炮跑 swagger 确认 10 个 DTO 字段
//   时间戳: 2026-10-21

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { ChatRole } from '../enums/chat-role.enum';
import { INFORMED_CONSENT_ELEMENT_VALUES } from '../enums/informed-consent-element.enum';
import { LIVE_SUPERVISION_HINT_TIER_VALUES } from '../enums/live-supervision-hint-tier.enum';
import { TRANSCRIPT_BOOKMARK_MARK_TYPE_VALUES } from '../enums/transcript-bookmark-mark-type.enum';
import { TRANSFERENCE_MARK_DIRECTION_VALUES, TRANSFERENCE_MARK_TYPE_VALUES } from '../enums/transference-mark.enum';

// ════════════════════════════════════════════════════════════════════════════
// M2 知情同意
// ════════════════════════════════════════════════════════════════════════════

export class InformedConsentElementDto {
  @ApiProperty({ description: '要素', enum: INFORMED_CONSENT_ELEMENT_VALUES })
  element!: (typeof INFORMED_CONSENT_ELEMENT_VALUES)[number];

  @ApiProperty({ description: '是否已讲全' })
  covered!: boolean;

  @ApiProperty({ description: '来访当时的反应 / 追问原话' })
  visitorResponse!: string;

  @ApiProperty({ description: '在第几轮讲到的 (从 0 开始); 没讲到为 null', nullable: true })
  coveredAtTurn!: number | null;
}

export class InformedConsentStatusDto {
  @ApiProperty({ description: '会话 id' })
  sessionId!: string;

  @ApiProperty({ description: '是否需要走知情同意环节 (用户可在高级设置关闭)' })
  required!: boolean;

  @ApiProperty({ description: '4 要素是否已讲全 (AI 判定)' })
  passed!: boolean;

  @ApiProperty({ description: '4 要素逐项覆盖情况', type: [InformedConsentElementDto] })
  elements!: InformedConsentElementDto[];

  @ApiProperty({ description: '已讲全的要素数 / 总要素数', example: '2/4' })
  coveredCount!: string;
}

export class ConsentTurnDto {
  @ApiProperty({ description: '角色', enum: ChatRole })
  @IsEnum(ChatRole)
  role!: ChatRole;

  @ApiProperty({ description: '原始文本' })
  @IsString()
  @MaxLength(8000)
  text!: string;
}

export class InformedConsentMarkDto {
  @ApiProperty({
    description: '同意阶段的对话转录 (按顺序, 轮次序号 = 数组下标)',
    type: [ConsentTurnDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ConsentTurnDto)
  turns!: ConsentTurnDto[];
}

export class InformedConsentMarkResultDto {
  @ApiProperty({ description: '会话 id' })
  sessionId!: string;

  @ApiProperty({ description: '4 要素是否已讲全' })
  passed!: boolean;

  @ApiProperty({ description: '4 要素逐项覆盖情况', type: [InformedConsentElementDto] })
  elements!: InformedConsentElementDto[];
}

// ════════════════════════════════════════════════════════════════════════════
// M3.2 逐字稿打点
// ════════════════════════════════════════════════════════════════════════════

export class CreateTranscriptBookmarkDto {
  @ApiProperty({ description: '打点所在轮次 (transcript 里的 turn index)' })
  @IsInt()
  @Min(0)
  turnIndex!: number;

  @ApiProperty({ description: '在录音中的毫秒级偏移' })
  @Min(0)
  offsetMs!: number;

  @ApiProperty({ description: '打点类型', enum: TRANSCRIPT_BOOKMARK_MARK_TYPE_VALUES })
  @IsIn(TRANSCRIPT_BOOKMARK_MARK_TYPE_VALUES)
  markType!: (typeof TRANSCRIPT_BOOKMARK_MARK_TYPE_VALUES)[number];

  @ApiPropertyOptional({ description: '咨询师备注' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class TranscriptBookmarkDto {
  @ApiProperty({ description: '打点 id' })
  id!: string;

  @ApiProperty({ description: '会话 id' })
  sessionId!: string;

  @ApiProperty({ description: '打点所在轮次' })
  turnIndex!: number;

  @ApiProperty({ description: '毫秒级偏移' })
  offsetMs!: number;

  @ApiProperty({ description: '打点类型', enum: TRANSCRIPT_BOOKMARK_MARK_TYPE_VALUES })
  markType!: (typeof TRANSCRIPT_BOOKMARK_MARK_TYPE_VALUES)[number];

  @ApiProperty({ description: '咨询师备注', nullable: true })
  note!: string | null;

  @ApiProperty({ description: '创建时间' })
  createdAt!: Date;
}

// ════════════════════════════════════════════════════════════════════════════
// M3.4 双向移情/阻抗标记
// ════════════════════════════════════════════════════════════════════════════

export class CreateTransferenceMarkDto {
  @ApiProperty({ description: '标记所在轮次 (transcript 里的 turn index)' })
  @IsInt()
  @Min(0)
  turnIndex!: number;

  @ApiProperty({
    description: '标记类型 (咨询师手动侧通常用 counter_transference)',
    enum: TRANSFERENCE_MARK_TYPE_VALUES,
  })
  @IsIn(TRANSFERENCE_MARK_TYPE_VALUES)
  markType!: (typeof TRANSFERENCE_MARK_TYPE_VALUES)[number];

  @ApiPropertyOptional({ description: '简短备注' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class TransferenceMarkDto {
  @ApiProperty({ description: '标记 id' })
  id!: string;

  @ApiProperty({ description: '会话 id' })
  sessionId!: string;

  @ApiProperty({ description: '标记所在轮次' })
  turnIndex!: number;

  @ApiProperty({ description: '方向', enum: TRANSFERENCE_MARK_DIRECTION_VALUES })
  direction!: (typeof TRANSFERENCE_MARK_DIRECTION_VALUES)[number];

  @ApiProperty({ description: '标记类型', enum: TRANSFERENCE_MARK_TYPE_VALUES })
  markType!: (typeof TRANSFERENCE_MARK_TYPE_VALUES)[number];

  @ApiProperty({ description: '备注', nullable: true })
  note!: string | null;

  @ApiProperty({ description: '创建时间' })
  createdAt!: Date;
}

// ════════════════════════════════════════════════════════════════════════════
// M3.1 实时督导轻提示 + M3.3 技术统计
// ════════════════════════════════════════════════════════════════════════════

export class LiveSupervisionHintDto {
  @ApiProperty({ description: '提示 id' })
  id!: string;

  @ApiProperty({ description: '会话 id' })
  sessionId!: string;

  @ApiProperty({ description: '触发轮次' })
  turnIndex!: number;

  @ApiProperty({
    description: '命中规则类别',
    example: 'closed_question_run',
  })
  category!: string;

  @ApiProperty({ description: '提示正文 (方向性, 不含替代话术)' })
  hintText!: string;

  @ApiProperty({ description: '档位', enum: LIVE_SUPERVISION_HINT_TIER_VALUES })
  tier!: (typeof LIVE_SUPERVISION_HINT_TIER_VALUES)[number];

  @ApiProperty({ description: '创建时间' })
  createdAt!: Date;
}

export class SessionTechStatsDto {
  @ApiProperty({ description: '提问类型次数', type: Object })
  questionTypes!: {
    open: number;
    closed: number;
    semi: number;
  };

  @ApiProperty({ description: '干预技术次数', type: Object })
  interventions!: {
    reflection: number;
    paraphrase: number;
    summary: number;
    confrontation: number;
    interpretation: number;
    advice: number;
  };

  @ApiProperty({ description: '行为指标', type: Object })
  behavior!: {
    interruptions: number;
    silenceMs: number;
    topicJumps: number;
  };

  @ApiProperty({ description: '督导点评' })
  commentary!: string;
}
