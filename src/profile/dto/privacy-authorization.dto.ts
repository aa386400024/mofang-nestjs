import { ApiProperty } from '@nestjs/swagger';

import type { PrivacyAuthorizationStatus, PrivacyAuthorizationType } from '../../shared/types/practice.types';

/**
 * 隐私授权 DTO — V2.0 §Tab4 「授权管理」.
 *
 * 前端 PrivacySettingsPage 补"授权管理"项后, 跳转到该页面.
 * 列表展示当前用户所有授权 (OAuth 第三方 / 设备权限 / 推送), 支持单项撤销.
 */
export class PrivacyAuthorizationDto {
  @ApiProperty({ description: '授权记录 id', example: 'uuid-v4' })
  id!: string;

  @ApiProperty({
    description: '授权类型',
    enum: [
      'oauth_google',
      'oauth_wechat',
      'oauth_apple',
      'device_camera',
      'device_microphone',
      'device_location',
      'device_health_sensor',
      'notification_push',
    ],
  })
  type!: PrivacyAuthorizationType;

  @ApiProperty({ description: '状态', enum: ['active', 'revoked', 'expired'] })
  status!: PrivacyAuthorizationStatus;

  @ApiProperty({ description: '显示名', example: 'Google · 张大炮' })
  displayName!: string;

  @ApiProperty({ description: '授权授予时间', example: '2026-08-15T10:30:00Z' })
  grantedAt!: string;

  @ApiProperty({ description: '过期时间', nullable: true })
  expiresAt!: string | null;
}

export class PrivacyAuthorizationsResponseDto {
  @ApiProperty({ type: [PrivacyAuthorizationDto] })
  items!: PrivacyAuthorizationDto[];
}
