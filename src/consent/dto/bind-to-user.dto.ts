import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Bind consent to user DTO — 游客 → 已登录迁移.
 *
 * 用法: 登录成功后调用, 把 device_id 上所有 user_id IS NULL 的 consent 关联到当前 user.
 */
export class BindConsentToUserDto {
  @ApiProperty({ description: '设备指纹', example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  deviceId!: string;
}
