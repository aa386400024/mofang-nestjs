import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Consent status 查询 DTO (Query 参数) — 心塑 / 魔方共用.
 *
 * 设计:
 *   - GET /consent/status?deviceId=X&consentType=Y&appId=Z
 *   - 返回 hasAccepted + needReaccept (后端版本强制升级客户端重弹)
 */
export class ConsentStatusQueryDto {
  @ApiProperty({ description: '设备指纹' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  deviceId!: string;

  @ApiProperty({ description: '协议类型' })
  @IsString()
  @MaxLength(64)
  consentType!: string;

  @ApiProperty({ description: '应用 ID', enum: ['xin_su', 'mofang'] })
  @IsIn(['xin_su', 'mofang'])
  appId!: string;
}

/**
 * Consent status 响应.
 *
 * 字段语义:
 *   - hasAccepted: 当前 device 是否曾同意过该 consentType (任意版本)
 *   - needReaccept: 是否需要重新弹 dialog (后端版本升级 / 首次启动)
 *   - currentVersion: 服务端要求的最新版本号 (前端用于弹 dialog 的版本声明)
 *   - acceptedAt / consentVersion: 上次同意的时间 / 版本 (审计回溯用)
 */
export class ConsentStatusResponseDto {
  @ApiProperty({ description: '是否同意过 (任意版本)' })
  hasAccepted!: boolean;

  @ApiProperty({ description: '是否需要重新弹 dialog (首次启动 / 版本升级)' })
  needReaccept!: boolean;

  @ApiProperty({ description: '服务端要求的最新版本号 (前端用于 dialog 文案)', example: 'v1.0' })
  currentVersion!: string;

  @ApiProperty({ description: '上次同意时间 (ISO 8601, 可选)', required: false })
  acceptedAt?: string;

  @ApiProperty({ description: '上次同意的版本号 (可空, 未同意过)', required: false })
  consentVersion?: string;
}
