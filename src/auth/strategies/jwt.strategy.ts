import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import type { JwtPayload, Payload } from '../auth.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('jwtSecret'),
    });
  }

  public validate(payload: JwtPayload): Payload {
    // V2026-10-12 (Phase 8.2 — Admin RBAC + 多租户, spec §12.4 / §8.3):
    //   透传 adminRole + tenantId 到 req.user, 让 @Roles() guard (common/guards/roles.guard.ts)
    //   跟 @TenantId() decorator (common/decorators/tenant-id.decorator.ts) 同步读到.
    //
    //   V0.x dev fallback: 8.2 之前签发的旧 token (payload 无 adminRole + tenantId
    //   字段) 走 fallback 路径 (adminRole → 'admin', tenantId → payload.sub 即 uid),
    //   跟 user.service.ts buildAuthResponse V0.x dev fallback 严格 1:1 对齐. 大炮
    //   16:57 server log 5 个 500 都是同一 root cause (旧 token + req.user.tenantId
    //   undefined → TenantId 装饰器 throw). 修法: 1 行 fallback 解决.
    //   V1.x 后端真值下发后, fallback 删除 (跟 buildAuthResponse 同步).
    return {
      userId: payload.sub,
      username: payload.username,
      roles: payload.roles,
      adminRole: payload.adminRole ?? 'admin',
      // V2026-10-12 治本 (Phase 8.8 — prefer-nullish-coalescing 兼容):
      //   跟 user.service.ts buildAuthResponse V0.x dev fallback 1:1 保持 ||
      //   语义 (空字符串也 fallback), 不能改 ?? (?? 只对 null/undefined fallback,
      //   空字符串走真值, 跟 buildAuthResponse 行为分裂). V1.x 真值下发后改 ??.
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      tenantId: payload.tenantId || payload.sub,
    };
  }
}
