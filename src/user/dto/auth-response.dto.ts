import { ApiProperty } from '@nestjs/swagger';

/**
 * 登录/注册成功响应 DTO (大厂统一格式).
 *
 * token 设计:
 *   - access_token: 短期 (15 分钟), 用于 API 鉴权
 *   - refresh_token: 长期 (7 天), 用于换新 access token
 *   - 每次 refresh 都发新的 refresh_token (rotation), 旧的入黑名单
 */
export class AuthResponseDto {
  @ApiProperty({ description: 'access token (短期, 默认 15 分钟)' })
  accessToken!: string;

  @ApiProperty({ description: 'refresh token (长期, 默认 7 天, 用于刷新 access)' })
  refreshToken!: string;

  @ApiProperty({ description: 'access token 过期时间 (秒)', example: 900 })
  expiresIn!: number;

  @ApiProperty({ description: 'refresh token 过期时间 (秒)', example: 604_800 })
  refreshExpiresIn!: number;

  @ApiProperty({ description: '当前登录用户信息' })
  user!: {
    uid: string;
    phone: string | null;
    email: string | null;
    state: string;
    emailVerified: boolean;
    phoneVerified: boolean;
    // V2026-10-12 (Phase 8.2 — Admin RBAC, spec §12.4):
    //   server-side 取 user.adminRole 返. V0.x dev fallback: 永远 'admin' (V0.x
    //   后端 /auth/me / login 端点都会 fallback, 让 V0.x 内部 dev 能跑完整 RBAC 矩阵).
    //   V1.x 真值下发后, server 不 fallback, NULL = 非 admin 角色.
    adminRole: 'editor' | 'reviewer' | 'admin' | null;
    // V2026-10-12 (Phase 8.2 — 多租户, spec §0 / §3 A9 / §8.3):
    //   V0.x 默认 = uid (一人一租户), V1.x 接 Tenant entity 改 nullable 走 B 端组织.
    tenantId: string;
  };

  @ApiProperty({
    description: '当前 session ID (多端管理用, V2 新增)',
    required: false,
  })
  sid?: string;
}

/**
 * 当前用户信息 DTO — GET /user/me 返回.
 */
export class CurrentUserDto {
  @ApiProperty({ description: '用户 ID' })
  uid!: string;

  @ApiProperty({ description: '手机号', nullable: true })
  phone!: string | null;

  @ApiProperty({ description: '邮箱', nullable: true })
  email!: string | null;

  @ApiProperty({ description: '用户状态' })
  state!: string;

  @ApiProperty({ description: '邮箱是否已验证' })
  emailVerified!: boolean;

  @ApiProperty({ description: '手机号是否已验证' })
  phoneVerified!: boolean;

  @ApiProperty({ description: '最后登录时间', nullable: true })
  lastLoginAt!: Date | null;

  @ApiProperty({ description: '最后改密时间', nullable: true })
  passwordChangedAt!: Date | null;

  @ApiProperty({ description: '是否强制要求改密' })
  mustChangePassword!: boolean;

  // V2026-10-12 (Phase 8.2 — Admin RBAC, spec §12.4):
  //   server-side 取 user.adminRole 返. V0.x dev fallback: 永远 'admin' (V0.x
  //   后端 /user/me 跟 /user/login 端点都会 fallback, 让 V0.x 内部 dev
  //   能跑完整 RBAC 矩阵). V1.x 真值下发后, server 不 fallback, NULL = 非 admin.
  @ApiProperty({
    description: 'Admin 角色 (V0.x dev fallback: 永远 = admin; V1.x 真值下发后 = null 表示无权限)',
    enum: ['editor', 'reviewer', 'admin'],
    nullable: true,
  })
  adminRole!: 'editor' | 'reviewer' | 'admin' | null;

  // V2026-10-12 (Phase 8.2 — 多租户, spec §0 / §3 A9 / §8.3):
  //   V0.x 默认 = uid (一人一租户), V1.x 接 Tenant entity 改 nullable 走 B 端组织.
  @ApiProperty({ description: '租户 ID (V0.x = uid; V1.x = 真实租户)' })
  tenantId!: string;

  @ApiProperty({ description: '注册时间' })
  createdAt!: Date;
}
