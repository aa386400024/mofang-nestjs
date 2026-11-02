import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

import { isStrongPassword } from '../../common/validators/is-strong-password.validator.js';

/**
 * 已登录态首次设置密码 DTO — POST /user/set-password.
 *
 * 跟 POST /auth/set-password 的区别:
 *   - /auth/set-password: 登录中引导流程 (验证码登录后强制设密码), 鉴权方式不同
 *   - /user/set-password: 已登录态, 用户主动在"我的-账号与安全"设置密码
 *
 * 跟 POST /user/change-password 的区别:
 *   - /user/change-password: 已登录态**改**密码, 要旧密码 (DTO 里必须有 oldPassword)
 *   - /user/set-password: 已登录态**首次**设置密码, 不要旧密码 (用户压根没有旧密码)
 *
 * 为什么**不复用** `ChangePasswordDto`:
 *   语义不同 (首次设置 vs 修改), 错误码不同 (前者是"用户已有密码, 请用改密流程",
 *   后者是"旧密码错误"), 将来还要各自演进 (set 要加 re-auth, change 要加过期策略) ——
 *   合成一个 DTO 就是把两条链路搅在一起, 前端也会传错字段.
 *
 * 两个接口复用同一个 UserService.setInitialPassword().
 */
export class SetLoggedInPasswordDto {
  @ApiProperty({ description: '新密码 (强密码, 8+ 位 + 大小写 + 数字)' })
  @IsString()
  @isStrongPassword()
  newPassword!: string;
}
