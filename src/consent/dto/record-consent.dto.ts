import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Record consent DTO — 用户同意时上报 (心塑 / 魔方共用).
 *
 * V3 设计要点:
 *   - 幂等 (重复 POST 不创建新行, 仅更新 IP/UA/metadata)
 *   - 客户端传 deviceId (flutter_secure_storage UUIDv4), 服务端不依赖 IP 识别设备
 *   - 严格校验 consentVersion (e.g. 'v1.0', 'v2.0'), 防止恶意构造
 *   - platform 限定白名单 (避免恶意值污染审计字段)
 */
export class RecordConsentDto {
  @ApiProperty({ description: '设备指纹 (UUIDv4, 32-128 字符)', example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  deviceId!: string;

  @ApiProperty({ description: '协议版本号', example: 'v1.0' })
  @IsString()
  @Matches(/^v\d+\.\d+$/, { message: 'consentVersion 必须匹配 vX.Y 格式 (e.g. v1.0)' })
  consentVersion!: string;

  @ApiProperty({ description: '协议类型', example: 'agreement+privacy' })
  @IsString()
  @MaxLength(64)
  consentType!: string;

  @ApiProperty({ description: '平台', example: 'android', enum: ['android', 'ios', 'web', 'windows', 'macos', 'linux'] })
  @IsIn(['android', 'ios', 'web', 'windows', 'macos', 'linux'])
  platform!: string;

  @ApiProperty({ description: '应用 ID (心塑 xin_su / 魔方 mofang)', example: 'xin_su' })
  @IsString()
  @MaxLength(64)
  appId!: string;

  @ApiProperty({
    description: '客户端 metadata (浏览器语言/屏幕尺寸等, 可选)',
    required: false,
    example: { lang: 'zh-CN', screen: '390x844' },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

/**
 * Record consent 响应.
 */
export class RecordConsentResponseDto {
  @ApiProperty({ description: '记录 ID' })
  id!: string;

  @ApiProperty({ description: '同意时间 (ISO 8601)' })
  acceptedAt!: string;
}
