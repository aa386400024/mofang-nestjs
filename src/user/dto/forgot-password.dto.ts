import { IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * 忘记密码 DTO — 只接邮箱 (V2 暂不支持手机号).
 *
 * V2 大炮明确: "暂时邮箱, 手机还不行"
 */
export class ForgotPasswordDto {
  @ApiProperty({ description: '注册邮箱', example: 'user@example.com' })
  @IsEmail({}, { message: '邮箱格式不正确' })
  email!: string;
}