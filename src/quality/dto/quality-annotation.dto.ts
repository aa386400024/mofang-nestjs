// V2026-11-10 治本 (WP-J P2 · 专业级标注工具 · 入参 DTO):
//   职责: 保存标注的入参校验 —— 与前端 `AnnotationSaveBody` 严格 1:1.
//   边界: 只有入参; 出参在 quality-annotation.view.ts.
//
//   ⚠️ **全局 ValidationPipe 是 `{ transform: true, whitelist: true }`** (app.module.ts):
//     没声明的字段会被**静默剥掉**, 所以本 DTO 的字段集就是契约本身 ——
//     前端多传一个字段不会报错, 但那个字段**不会落库** (静默丢字段比报错更难查,
//     所以这里把前端实际用到的字段全部声明齐).

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import {
  ANNOTATION_LABEL,
  ANNOTATION_DURATION_MS_MAX,
  ANNOTATION_NOTES_MAX_LENGTH,
  ANNOTATION_TURN_MIN,
  CRISIS_LEVEL_MAX,
  CRISIS_LEVEL_MIN,
  type AnnotationLabel,
} from '../quality-annotation.constants.js';

/**
 * 保存标注入参 (前端 AnnotationSaveBody).
 */
export class QualityAnnotationSaveDto {
  /**
   * 人工标注: 探索开始轮次 (NULL = 本场无探索).
   *
   * ⚠️ **不用 `@Type(() => Number)`**: JSON body 里的数字本来就是 number,
   *   加了 class-transformer 的 Number 转换反而可能把 `null` 变成 0 ——
   *   "本场无探索"会被悄悄写成"第 0 轮", 那比报错危险.
   */
  @ApiPropertyOptional({ description: '人工标注: 探索开始轮次 (null = 本场无探索)', nullable: true, type: Number })
  @IsOptional()
  @IsInt()
  @Min(ANNOTATION_TURN_MIN)
  firstExplorationTurn?: number | null;

  /**
   * 人工标注: 主导行为标签 (NULL = 未标).
   */
  @ApiPropertyOptional({
    description: '人工标注: 主导行为标签 (null = 未标)',
    enum: Object.values(ANNOTATION_LABEL),
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsEnum(ANNOTATION_LABEL)
  dominantLabel?: AnnotationLabel | null;

  /**
   * 人工标注: 危机峰值档位 (0~3; 缺省 0).
   */
  @ApiPropertyOptional({ description: '人工标注: 危机峰值档位 (0~3)', minimum: CRISIS_LEVEL_MIN, maximum: CRISIS_LEVEL_MAX })
  @IsOptional()
  @IsInt()
  @Min(CRISIS_LEVEL_MIN)
  @Max(CRISIS_LEVEL_MAX)
  crisisPeakLevel?: number;

  /**
   * 人工标注: 危机首次出现轮次 (NULL = 无).
   */
  @ApiPropertyOptional({ description: '人工标注: 危机首次出现轮次 (null = 无)', nullable: true, type: Number })
  @IsOptional()
  @IsInt()
  @Min(ANNOTATION_TURN_MIN)
  crisisFirstTurn?: number | null;

  /**
   * 人工标注: 咨询师"该断轮次" (NULL = 未标).
   */
  @ApiPropertyOptional({ description: '人工标注: 该断轮次 (null = 未标)', nullable: true, type: Number })
  @IsOptional()
  @IsInt()
  @Min(ANNOTATION_TURN_MIN)
  shouldEndTurn?: number | null;

  /**
   * 存疑 / 待复审.
   */
  @ApiPropertyOptional({ description: '存疑 / 待复审', type: Boolean })
  @IsOptional()
  @IsBoolean()
  needsReview?: boolean;

  /**
   * 本场标注耗时 (毫秒; 缺省 0).
   */
  @ApiPropertyOptional({ description: '本场标注耗时 (毫秒)', type: Number })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(ANNOTATION_DURATION_MS_MAX)
  durationMs?: number;

  /**
   * 备注 (存疑原因等).
   */
  @ApiPropertyOptional({ description: '备注 (存疑原因等)', type: String })
  @IsOptional()
  @IsString()
  @MaxLength(ANNOTATION_NOTES_MAX_LENGTH)
  notes?: string;
}
