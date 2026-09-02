import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, Matches } from 'class-validator';

/**
 * 响应 DTO — GET /profile/me/notifications.
 *
 * V2.0 §Tab4 通知设置页:
 *   - practiceReminder / statusUpdate / companionMessage 三个开关
 *   - quietStart / quietEnd 免打扰时段 (HH:mm 字符串)
 *   - reminderIntensity 提醒强度
 */
export class NotificationSettingsDto {
  @ApiProperty({ description: '练习提醒', example: true })
  practiceReminder!: boolean;

  @ApiProperty({ description: '状态更新通知', example: true })
  statusUpdate!: boolean;

  @ApiProperty({ description: '陪伴者消息', example: true })
  companionMessage!: boolean;

  @ApiProperty({ description: '免打扰开始时间 (HH:mm)', example: '22:00' })
  quietStart!: string;

  @ApiProperty({ description: '免打扰结束时间 (HH:mm)', example: '08:00' })
  quietEnd!: string;

  @ApiProperty({ description: '提醒强度', enum: ['low', 'medium', 'high'] })
  reminderIntensity!: 'low' | 'medium' | 'high';
}

/**
 * 请求 DTO — PUT /profile/me/notifications.
 *
 * 大厂做法:
 *   - 部分更新 (PATCH 语义), 但用 PUT endpoint 是为了一致性
 *   - 所有字段 optional, 客户端只传要改的字段
 */
export class UpdateNotificationSettingsDto {
  @ApiProperty({ description: '练习提醒', required: false })
  @IsOptional()
  @IsBoolean()
  practiceReminder?: boolean;

  @ApiProperty({ description: '状态更新通知', required: false })
  @IsOptional()
  @IsBoolean()
  statusUpdate?: boolean;

  @ApiProperty({ description: '陪伴者消息', required: false })
  @IsOptional()
  @IsBoolean()
  companionMessage?: boolean;

  @ApiProperty({ description: '免打扰开始时间 (HH:mm)', required: false, example: '22:00' })
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: '时间格式必须为 HH:mm (00:00-23:59)' })
  quietStart?: string;

  @ApiProperty({ description: '免打扰结束时间 (HH:mm)', required: false, example: '08:00' })
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: '时间格式必须为 HH:mm (00:00-23:59)' })
  quietEnd?: string;

  @ApiProperty({ description: '提醒强度', required: false, enum: ['low', 'medium', 'high'] })
  @IsOptional()
  @IsString()
  @IsIn(['low', 'medium', 'high'])
  reminderIntensity?: 'low' | 'medium' | 'high';
}
