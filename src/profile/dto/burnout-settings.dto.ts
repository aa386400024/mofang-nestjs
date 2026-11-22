import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * 响应 DTO — GET /profile/burnout-settings.
 */
export class BurnoutSettingsDto {
  @ApiProperty({ description: '启用耗竭预警' })
  enableWarning!: boolean;

  @ApiProperty({ description: '每周自检报告' })
  enableWeeklyReport!: boolean;

  @ApiProperty({ description: '自动休息提醒' })
  autoRestReminder!: boolean;

  @ApiProperty({ description: '每日陪伴次数上限 (1-10)', example: 5 })
  dailyLimit!: number;
}

/**
 * 请求 DTO — PUT /profile/burnout-settings.
 *
 * 大厂做法:
 *   - 部分更新 (客户端只传要改的字段)
 *   - 数值字段加 range 校验 (dailyLimit 1-10)
 */
export class UpdateBurnoutSettingsDto {
  @ApiProperty({ description: '启用耗竭预警', required: false })
  @IsOptional()
  @IsBoolean()
  enableWarning?: boolean;

  @ApiProperty({ description: '每周自检报告', required: false })
  @IsOptional()
  @IsBoolean()
  enableWeeklyReport?: boolean;

  @ApiProperty({ description: '自动休息提醒', required: false })
  @IsOptional()
  @IsBoolean()
  autoRestReminder?: boolean;

  @ApiProperty({ description: '每日陪伴次数上限 (1-10)', required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  dailyLimit?: number;
}
