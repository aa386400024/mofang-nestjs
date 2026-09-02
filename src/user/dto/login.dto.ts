import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

import { isChinesePhone } from '../../common/validators/is-chinese-phone.validator';

/**
 * 登录 DTO — 手机号 + 密码登录 (大厂企业级).
 *
 * V2 改造:
 *   - 支持手机号 (phone) 或邮箱 (email) 登录
 *   - password 强度在 register 校验, 登录端不再重复
 *
 * V2 行为:
 *   - email 登录: 必须 email_verified_at 不为 null (否则抛 EmailNotVerified)
 *   - phone 登录: 暂不强制验证 (V2 大炮明确"暂时邮箱, 手机还不行")
 */
export class LoginDto {
  @ApiProperty({ description: '手机号 (跟 email 二选一)', example: '13800138000', required: false })
  @IsOptional()
  @IsString()
  @isChinesePhone()
  phone?: string;

  @ApiProperty({ description: '邮箱 (跟 phone 二选一)', example: 'user@example.com', required: false })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiProperty({ description: '密码 (强密码, 8+ 位 + 大小写 + 数字)', example: 'MyP@ssw0rd' })
  @IsString()
  password!: string;

  /** 设备信息 (V2: 记录到 session.deviceInfo) */
  @ApiProperty({ description: '设备描述 (可选, 用于多端管理)', required: false })
  @IsOptional()
  @IsString()
  deviceInfo?: string;
}
