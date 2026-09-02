import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import type { JwtPayload, JwtSign, Payload } from './auth.interface';
import { User, UserService } from '../shared/user';

/** 把 '15m' / '7d' 字符串转秒数 (跟 user.service.ts 保持一致). */
function parseExpiresIn(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const m = /^(\d+)([smhd])$/.exec(value.trim());
  if (!m) return fallback;
  const n = Number.parseInt(m[1], 10);
  const unit = m[2];
  // sonarjs/no-nested-conditional: switch 替代嵌套三元
  switch (unit) {
    case 's':
      return n;
    case 'm':
      return n * 60;
    case 'h':
      return n * 3600;
    default: // 'd'
      return n * 86_400;
  }
}

@Injectable()
export class AuthService {
  constructor(
    private jwt: JwtService,
    private user: UserService,
    private config: ConfigService,
  ) {}

  /**
   * Passport-Local 校验: username + password.
   * user.password 字段在 user.service.ts 已是 bcrypt hash.
   */
  public async validateUser(username: string, password: string): Promise<User | null> {
    const user = await this.user.fetch(username);

    if (user?.password === password) {
      // eslint-disable-next-line sonarjs/no-unused-vars
      const { password: pass, ...result } = user;
      return result;
    }

    return null;
  }

  public validateRefreshToken(data: Payload, refreshToken: string): boolean {
    if (!this.jwt.verify(refreshToken, { secret: this.config.get('jwtRefreshSecret') })) {
      return false;
    }

    const payload = this.jwt.decode<{ sub: string }>(refreshToken);
    return payload.sub === data.userId;
  }

  public jwtSign(data: Payload): JwtSign {
    // V2026-08-27 治本: payload 必须带 type: 'access' / 'refresh' 字段.
    // 之前没带 → payload.type === undefined → JwtAuthGuard 校验
    // `payload.type !== TokenType.Access` 永远 true → 401.
    // 跟 user.service.ts 的新签名路径保持一致 (该路径已正确).
    const payload: JwtPayload = { sub: data.userId, username: data.username, roles: data.roles };

    const accessExpiresSec = parseExpiresIn(
      this.config.get<string>('jwtExpiresIn'),
      900, // 15min default
    );
    const refreshExpiresSec = parseExpiresIn(
      this.config.get<string>('jwtRefreshExpiresIn'),
      604_800, // 7d default
    );

    return {
      access_token: this.jwt.sign({ ...payload, type: 'access' }, { expiresIn: accessExpiresSec }),
      refresh_token: this.getRefreshToken(payload.sub),
      expiresIn: accessExpiresSec,
      refreshExpiresIn: refreshExpiresSec,
    };
  }

  public getPayload(token: string): Payload | null {
    try {
      const payload = this.jwt.decode<JwtPayload | null>(token);
      if (!payload) {
        return null;
      }

      return { userId: payload.sub, username: payload.username, roles: payload.roles };
    } catch {
      // Unexpected token i in JSON at position XX
      return null;
    }
  }

  private getRefreshToken(sub: string): string {
    // V2026-08-27 治本: refresh token 也带 type 字段, 跟 access token 保持对称.
    // 大厂 standard: refresh token 不能被 access 接口验证 (防止被误用).
    return this.jwt.sign(
      { sub, type: 'refresh' },
      {
        secret: this.config.get('jwtRefreshSecret'),
        expiresIn: '7d', // Set greater than the expiresIn of the access_token
      },
    );
  }
}
