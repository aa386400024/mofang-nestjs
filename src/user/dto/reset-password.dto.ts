import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

import { isStrongPassword } from '../../common/validators/is-strong-password.validator';

/**
 * 重置密码 DTO — 通过邮件 token + 新密码.
 */
export class ResetPasswordDto {
  @ApiProperty({ description: '邮件里的重置 token' })
  @IsString()
  token!: string;

  @ApiProperty({ description: '新密码 (强密码)' })
  @IsString()
  @isStrongPassword()
  newPassword!: string;
}