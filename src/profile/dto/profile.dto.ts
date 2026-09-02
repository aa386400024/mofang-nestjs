import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { GenderValues, OccupationValues } from '../entities/user-profile.entity';

/**
 * 响应 DTO — GET /profile/me 返回.
 *
 * V2.0 §Tab4 我的头部 + 功能卡共享这一个 DTO:
 *   - 头像 / 昵称 / 出生日期 / 性别 / 职业
 *   - currentRole 当前激活角色 (成长用户 / 陪伴者)
 *
 * 不暴露:
 *   - userId / uid (前端从 session 自己拿, 不需要在这里)
 *   - 手机号 / 邮箱 (从 /user/me 拿, 这里避免重复)
 *   - 实名认证 / 会员等敏感信息 (单独 endpoint 拿)
 */
export class ProfileDto {
  @ApiProperty({ description: '昵称', nullable: true, example: '你' })
  nickname!: string | null;

  @ApiProperty({ description: '头像 URL', nullable: true })
  avatarUrl!: string | null;

  @ApiProperty({ description: '出生日期 (YYYY-MM-DD)', nullable: true, example: '1995-01-01' })
  birthDate!: string | null;

  @ApiProperty({
    description: '性别',
    nullable: true,
    enum: GenderValues,
  })
  gender!: 'female' | 'male' | 'undisclosed' | null;

  @ApiProperty({
    description: '职业 (枚举字符串, V2.0 给 6 个选项)',
    nullable: true,
    enum: OccupationValues,
  })
  occupation!: string | null;

  @ApiProperty({
    description: '当前激活角色',
    enum: ['growth_user', 'companion'],
  })
  currentRole!: 'growth_user' | 'companion';
}

/**
 * 请求 DTO — PUT /profile/me 完整更新.
 *
 * 大厂做法:
 *   - PUT 是全量替换, 部分更新用 PATCH (本接口给的是 PUT, V3 可扩 PATCH)
 *   - 所有字段 optional, 客户端只传要改的字段 (空字符串 / null 表示不变)
 *   - 字符串字段带 length 校验防 buffer overflow
 */
export class UpdateProfileDto {
  @ApiProperty({ description: '昵称 (1-20 字)', required: false, example: '你' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  nickname?: string;

  @ApiProperty({ description: '出生日期 (YYYY-MM-DD)', required: false, example: '1995-01-01' })
  @IsOptional()
  @IsDateString({ strict: true })
  birthDate?: string;

  @ApiProperty({ description: '性别', required: false, enum: GenderValues })
  @IsOptional()
  @IsString()
  @IsIn(GenderValues)
  gender?: 'female' | 'male' | 'undisclosed';

  @ApiProperty({ description: '职业', required: false, enum: OccupationValues })
  @IsOptional()
  @IsString()
  @IsIn(OccupationValues)
  occupation?: string;
}

/**
 * 请求 DTO — PUT /profile/me/current-role 切换角色.
 *
 * 单独 endpoint 而不是合并到 UpdateProfileDto, 因为:
 *   - 切角色触发不同副作用 (审计日志 + 多端推送)
 *   - 角色值受约束 (仅 2 个枚举)
 */
export class SwitchRoleDto {
  @ApiProperty({
    description: '目标角色',
    enum: ['growth_user', 'companion'],
  })
  @IsString()
  @IsIn(['growth_user', 'companion'])
  currentRole!: 'growth_user' | 'companion';
}

/**
 * 响应 DTO — POST /profile/me/avatar.
 *
 * V2.0 上传后返回新头像 URL (后端 oss / cdn 上传后回传).
 * V3 接 oss 真实上传后, 此字段填 cdn url. V2.0 占位, 用 mock url.
 */
export class UploadAvatarResponseDto {
  @ApiProperty({ description: '新头像 URL' })
  avatarUrl!: string;
}
