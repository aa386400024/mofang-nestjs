import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';

/**
 * 趋势点 DTO — 情绪曲线 / 练习完成趋势共用.
 */
export class TrendPointDto {
  @ApiProperty({ description: '日期 (YYYY-MM-DD)', example: '2026-08-20' })
  date!: string;

  @ApiProperty({ description: '数值 (情绪稳定性 0-100 / 练习分钟数)', example: 78 })
  value!: number;
}

/**
 * 能力维度变化 DTO — V2.0 §Tab4 心理成长报告"能力变化"区.
 */
export class DimensionChangeDto {
  @ApiProperty({ description: '维度名', example: '情绪调节' })
  label!: string;

  @ApiProperty({ description: '变化方向', enum: ['up', 'flat', 'down'] })
  delta!: 'up' | 'flat' | 'down';

  @ApiProperty({ description: '变化文案', example: '↑ 较稳定' })
  deltaText!: string;
}

/**
 * 查询 DTO — GET /profile/growth-report?range=1m|3m.
 */
export class GrowthReportQueryDto {
  @ApiProperty({ description: '时间范围', enum: ['1m', '3m'], required: false, default: '1m' })
  @IsOptional()
  @IsString()
  @IsIn(['1m', '3m'])
  range?: '1m' | '3m';
}

/**
 * 响应 DTO — GET /profile/growth-report.
 *
 * V2.0 占位: 趋势数据用静态 mock, dimensions 用 4 个固定维度,
 *   summary / suggestions 硬编码. V3 接真实统计 pipeline.
 */
export class GrowthReportDto {
  @ApiProperty({ description: '查询范围', enum: ['1m', '3m'] })
  range!: '1m' | '3m';

  @ApiProperty({ description: '情绪稳定性曲线', type: [TrendPointDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TrendPointDto)
  emotionCurve!: TrendPointDto[];

  @ApiProperty({ description: '练习完成趋势', type: [TrendPointDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TrendPointDto)
  practiceTrend!: TrendPointDto[];

  @ApiProperty({ description: '能力维度变化', type: [DimensionChangeDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DimensionChangeDto)
  dimensions!: DimensionChangeDto[];

  @ApiProperty({ description: '成长总结文案' })
  summary!: string;

  @ApiProperty({ description: '行动建议', type: [String] })
  suggestions!: string[];
}
