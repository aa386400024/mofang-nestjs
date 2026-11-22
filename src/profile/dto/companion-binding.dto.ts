import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsOptional, IsString, Length, Matches, ValidateNested } from 'class-validator';

/**
 * V2026-08-27 治本 (sonarjs/use-type-alias): 提取 'L1' | 'L2' | 'L3' 为 type alias,
 *   避免在 property 类型注解里出现内联 union type (sonarjs 误报).
 */
export type PermissionLevel = 'L1' | 'L2' | 'L3';

/**
 * 响应 DTO — 单条绑定关系 (双角色共用).
 *
 * - 成长用户视角: owner_uid = 自己, companion_uid = 陪伴者
 * - 陪伴者视角: owner_uid = 自己, companion_uid = 被陪伴的人
 */
export class CompanionBindingDto {
  @ApiProperty({ description: '绑定 ID', example: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'owner UID (关系创建者, 成长用户 / 陪伴者)' })
  ownerUid!: string;

  @ApiProperty({ description: 'companion UID (关系对方)' })
  companionUid!: string;

  @ApiProperty({ description: '状态', enum: ['pending', 'active', 'terminated'] })
  status!: 'pending' | 'active' | 'terminated';

  @ApiProperty({ description: '权限等级 (V2.0 §Tab4 权限等级说明)', enum: ['L1', 'L2', 'L3'] })
  permissionLevel!: PermissionLevel;

  @ApiProperty({ description: '对方昵称', nullable: true })
  companionNickname!: string | null;

  @ApiProperty({ description: '对方头像 URL', nullable: true })
  companionAvatarUrl!: string | null;

  @ApiProperty({ description: '绑定生效时间', nullable: true })
  boundAt!: Date | null;

  @ApiProperty({ description: '解除时间', nullable: true })
  terminatedAt!: Date | null;
}

/**
 * 响应 DTO — GET /profile/companion-bindings (列表).
 */
export class ListCompanionBindingsResponseDto {
  @ApiProperty({ description: '绑定列表', type: [CompanionBindingDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CompanionBindingDto)
  bindings!: CompanionBindingDto[];
}

/**
 * 请求 DTO — POST /profile/companion-bindings/invite 生成邀请码.
 */
export class CreateInviteDto {
  @ApiProperty({ description: '目标权限等级', required: false, enum: ['L1', 'L2', 'L3'] })
  @IsOptional()
  @IsString()
  @IsIn(['L1', 'L2', 'L3'])
  permissionLevel?: PermissionLevel;
}

/**
 * 响应 DTO — POST /profile/companion-bindings/invite 返回邀请码.
 */
export class InviteCodeResponseDto {
  @ApiProperty({ description: '6 位邀请码', example: '123456' })
  inviteCode!: string;

  @ApiProperty({ description: '邀请码过期时间 (24h)' })
  expiresAt!: Date;

  @ApiProperty({ description: '权限等级', enum: ['L1', 'L2', 'L3'] })
  permissionLevel!: 'L1' | 'L2' | 'L3';
}

/**
 * 请求 DTO — POST /profile/companion-bindings/accept 用邀请码接受绑定.
 */
export class AcceptInviteDto {
  @ApiProperty({ description: '6 位邀请码', example: '123456' })
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, { message: '邀请码必须是 6 位数字' })
  inviteCode!: string;
}

/**
 * 请求 DTO — POST /profile/companion-bindings/:id/permission 修改权限等级.
 */
export class UpdatePermissionDto {
  @ApiProperty({ description: '新权限等级', enum: ['L1', 'L2', 'L3'] })
  @IsString()
  @IsIn(['L1', 'L2', 'L3'])
  permissionLevel!: 'L1' | 'L2' | 'L3';
}

/**
 * 请求 DTO — DELETE /profile/companion-bindings/:id 解除绑定.
 */
export class TerminateBindingDto {
  @ApiProperty({ description: '解除原因 (可选)', required: false })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  reason?: string;
}
