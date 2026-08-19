import { IsEmail, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * 验证邮箱 DTO — 邮件链接里的 token.
 */
export class VerifyEmailDto {
  @ApiProperty({ description: '邮件里的验证 token' })
  @IsString()
  token!: string;
}

/**
 * 重发验证邮件 DTO — 传邮箱, 后端找到对应用户重发.
 * 不暴露邮箱是否存在 (防用户枚举) — 找不到时静默成功.
 */
export class ResendVerificationDto {
  @ApiProperty({ description: '注册邮箱', example: 'user@example.com' })
  @IsEmail({}, { message: '邮箱格式不正确' })
  email!: string;
}