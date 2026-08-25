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
}

export interface Payload {
  userId: string;
  username: string;
  roles: string[];
}
