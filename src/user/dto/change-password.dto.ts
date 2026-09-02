import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

import { isStrongPassword } from '../../common/validators/is-strong-password.validator';

/**
 * 改密 DTO — 已登录状态, 知道旧密码.
 */
export class ChangePasswordDto {
  @ApiProperty({ description: '旧密码' })
  @IsString()
  oldPassword!: string;

  @ApiProperty({ description: '新密码 (强密码, 8+ 位 + 大小写 + 数字)' })
  @IsString()
  @isStrongPassword()
  newPassword!: string;
}
