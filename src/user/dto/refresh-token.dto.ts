import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

/**
 * Refresh token DTO (大厂企业级).
 *
 * V1 简化: 只接 refresh_token 字段.
 *     V2 加 deviceId (用于多端登录管理) + appType (区分心塑/魔方).
 */
export class RefreshTokenDto {
  @ApiProperty({ description: 'refresh token (从 /user/login 或上次 refresh 获取)' })
  @IsString()
  refreshToken!: string;
}
