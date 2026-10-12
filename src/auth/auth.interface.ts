export interface JwtSign {
  access_token: string;
  refresh_token: string;
  /** access token TTL in seconds — 用于 Set-Cookie Max-Age 跟 token TTL 对齐 (V1.1.2) */
  expiresIn: number;
  /** refresh token TTL in seconds — 同上 */
  refreshExpiresIn: number;
}

export interface JwtPayload {
  sub: string;
  username: string;
  roles: string[];
  /**
   * V2026-08-27 治本: token 类型字段 (access / refresh).
   * JwtAuthGuard 会校验 payload.type === TokenType.Access, 防止 refresh token
   * 被误用成 access token. 之前 AuthService.jwtSign 漏了这个字段, 签出
   * 的 token 在 JwtAuthGuard 永远被拒 (payload.type === undefined).
   * 跟 user.service.ts 的新签名逻辑保持一致 (该路径已正确).
   */
  type?: 'access' | 'refresh';
  // V2026-10-12 (Phase 8.2 — Admin RBAC, spec §12.4):
  //   server-side 取 user.adminRole (3 角色 editor / reviewer / admin) 透传,
  //   跟客户端 7.8 PermissionResolver 严格对应. V0.x dev fallback:
  //   user.service.buildAuthResponse 检测 user.adminRole 为 null 时 fallback 'admin'.
  adminRole?: 'editor' | 'reviewer' | 'admin';
  // V2026-10-12 (Phase 8.2 — 多租户, spec §0 / §3 A9 / §8.3):
  //   V0.x 默认 tenantId = uid (一人一租户), V1.x 接 Tenant entity 改 nullable.
  tenantId?: string;
}

export interface Payload {
  userId: string;
  username: string;
  roles: string[];
  // V2026-10-12 (Phase 8.2): 跟 JwtPayload 同步, 给 @TenantId() / @Roles() decorator 读.
  adminRole?: 'editor' | 'reviewer' | 'admin';
  tenantId?: string;
}
