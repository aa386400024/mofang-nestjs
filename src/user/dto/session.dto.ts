import { ApiProperty } from '@nestjs/swagger';

/**
 * Session DTO — 多端管理 UI 用.
 */
export class SessionDto {
  @ApiProperty({ description: 'session ID' })
  sid!: string;

  @ApiProperty({ description: '设备描述', nullable: true })
  deviceInfo!: string | null;

  @ApiProperty({ description: '设备类型', example: 'mobile' })
  deviceType!: string;

  @ApiProperty({ description: 'IP 地址', nullable: true })
  ipAddress!: string | null;

  @ApiProperty({ description: '登录地点', nullable: true })
  location!: string | null;

  @ApiProperty({ description: '最后活跃时间' })
  lastActiveAt!: Date | null;

  @ApiProperty({ description: '登录时间' })
  createdAt!: Date;

  @ApiProperty({ description: '过期时间' })
  expiresAt!: Date;

  @ApiProperty({ description: '是否是当前 session (用于前端标识)' })
  isCurrent!: boolean;
}

export class ListSessionsResponseDto {
  @ApiProperty({ description: '活跃 session 列表', type: [SessionDto] })
  sessions!: SessionDto[];
}