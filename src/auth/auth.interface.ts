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
}

export interface Payload {
  userId: string;
  username: string;
  roles: string[];
}
