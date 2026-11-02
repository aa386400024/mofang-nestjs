import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length } from 'class-validator';

import { isStrongPassword } from '../../common/validators/is-strong-password.validator.js';

/**
 * 忘记密码重置 DTO — POST /auth/reset-password.
 *
 * 流程: 输邮箱 → 发验证码 → 输新密码 → **一次性**改完, 不需要 JWT.
 *
 * 为什么不跟 `POST /user/reset-password` (邮件 token 流程) 合并:
 *   两条流程的凭证形态不同 —— 那个是"点邮件链接带 token", 这个是"输邮箱收到的 6 位码";
 *   前端页面形态也不同 (一个是从邮件跳回来, 一个是停留在忘记密码页).
 *
 * **字段名说明**: 客户端发的是 `newPasswordEnc` (RSA 加密), 服务端的
 * `EncryptedFieldsInterceptor` 会把它解密成 `newPassword` 并删掉 `newPasswordEnc`
 * (解密发生在 DTO 校验**之前**). 所以这里声明的是**明文字段** `newPassword` ——
 * 声明 `newPasswordEnc` 会让它在校验时已经不存在 → 永远 400.
 */
export class ResetPasswordDto {
  @ApiProperty({ description: '注册邮箱' })
  @IsEmail()
  email!: string;

  @ApiProperty({ description: '邮箱收到的 6 位验证码' })
  @IsString()
  @Length(6, 6)
  code!: string;

  @ApiProperty({ description: '新密码 (客户端 RSA 加密后发 newPasswordEnc; 强密码, 8+ 位 + 大小写 + 数字)' })
  @IsString()
  @isStrongPassword()
  newPassword!: string;
}
