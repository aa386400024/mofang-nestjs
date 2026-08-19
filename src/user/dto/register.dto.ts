import { IsEmail, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

import { isChinesePhone } from '../../common/validators/is-chinese-phone.validator';
import { isStrongPassword } from '../../common/validators/is-strong-password.validator';

/**
 * 注册 DTO — 心塑 + 魔方共用注册入口 (大厂企业级).
 *
 * V2 校验规则:
 *   - phone / email 至少二选一
 *   - phone 必须中国大陆格式
 *   - email 标准格式
 *   - password 强密码 (8+ 位 + 大小写 + 数字)
 *
 * V2 行为变更:
 *   - 注册成功后 state=PendingVerification (待邮箱验证), 不能登录
 *   - 发邮件验证 token, 用户点击后才进 Active
 *   - 但当前 V2 大炮要求"暂时邮箱, 手机还不行" — V2 实现里:
 *     - 注册时如果同时提供 phone + email, 可走短信验证 (需 SMS 通道)
 *     - 纯邮箱注册, 必须邮箱验证
 *     - 纯手机号注册, V2 暂不支持 (TODO: V3 加 SMS 验证)
 *   - V2 简化: 注册即 Active (兼容老行为), 但强制要求邮箱验证后能登录
 *     - 注册完成后: state=Active, email_verified_at=NULL
 *     - 登录时: 如果 email_verified_at=NULL → 抛 EmailNotVerified, 引导去验证
 *
 * 大炮决策 (2026-08-19): 邮箱必填 + 必验证, 手机号可选 (待后续 SMS 接入)
 */
export class RegisterDto {
  @ApiProperty({ description: '手机号 (可选, V2 暂不验证)', example: '13800138000', required: false })
  @IsOptional()
  @IsString()
  @isChinesePhone()
  phone?: string;

  @ApiProperty({ description: '邮箱 (必填)', example: 'user@example.com' })
  @IsOptional()
  @IsEmail({}, { message: '邮箱格式不正确' })
  email?: string;

  @ApiProperty({ description: '密码 (8+ 位, 包含大小写字母和数字)', example: 'MyP@ssw0rd' })
  @IsString()
  @isStrongPassword()
  password!: string;

  @ApiProperty({ description: '设备描述 (可选, 用于多端管理)', required: false })
  @IsOptional()
  @IsString()
  deviceInfo?: string;
}