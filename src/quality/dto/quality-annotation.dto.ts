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
  ANNOTATION_BAD_TURNS_MAX_LENGTH,
  ANNOTATION_LABEL,
  ANNOTATION_DURATION_MS_MAX,
  ANNOTATION_NOTES_MAX_LENGTH,
  ANNOTATION_TURN_MIN,
  ANNOTATION_TURN_NOTE_MAX_LENGTH,
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

  // ── V2026-11-11 治本 (WP-N): 轮级最小集 (三列) ──
  //
  // ⚠️ **这三列不参与 done 判定** (done 仍只认 dominant_label) ——
  //   前端进度条合同不变; 轮级标记是**补充事实**, 不是完成条件.
  //
  // ⚠️ **零压红线**: 只允许事实描述, **禁止**任何评分 / 等级 / 对错语义.
  //   服务层会再查一遍禁用词, 命中直接 400 —— DTO 只管形状, 管不了语义.

  /**
   * 轮级标记: 从第几轮开始"不对" (离题 / 崩 / 共情缺失).
   *
   * NULL = 未标, 或整场无问题. 上界 (≤ turn_count) 由服务层按该场轮数校验.
   */
  @ApiPropertyOptional({
    description: '轮级标记: 从第几轮开始不对 (null = 未标 / 整场无问题)',
    nullable: true,
    type: Number,
  })
  @IsOptional()
  @IsInt()
  @Min(ANNOTATION_TURN_MIN)
  firstBadTurn?: number | null;

  /**
   * 轮级标记: 明确有问题的轮次清单 (逗号分隔正整数).
   *
   * ⚠️ 非法值**不静默丢弃** —— 服务层返回 400, 让标注员知道自己写错了.
   */
  @ApiPropertyOptional({
    description: '轮级标记: 有问题的轮次清单 (逗号分隔, 最多 10 个, 升序去重)',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsString()
  @MaxLength(ANNOTATION_BAD_TURNS_MAX_LENGTH)
  badTurns?: string | null;

  /**
   * 轮级说明 (事实描述; **禁评分 / 等级 / 对错**).
   */
  @ApiPropertyOptional({
    description: '轮级说明 (事实描述; 禁评分 / 等级 / 对错)',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsString()
  @MaxLength(ANNOTATION_TURN_NOTE_MAX_LENGTH)
  turnNote?: string | null;
}
