import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import type { JwtPayload, Payload } from '../auth.interface.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('jwtSecret'),
      algorithms: ['HS256'],
      issuer: 'mofang-nestjs',
      audience: 'mofang-client',
    });
  }

  public validate(payload: JwtPayload): Payload {
    // AF-537 P0-7: NULL / 缺省 = 无内部权限，不再 fallback 'admin'.
    // 旧 token 不带 adminRole 时保持 undefined，由 RolesGuard / AdminRoleGuard 拒绝。
    return {
      userId: payload.sub,
      username: payload.username,
      roles: payload.roles,
      adminRole: payload.adminRole,
      tenantId: payload.tenantId ?? payload.sub,
    };
  }
}
