import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

import { BizCode } from '../../common/exceptions/biz-code.enum';
import { BizException } from '../../common/exceptions/biz.exception';
import { COOKIE_NAMES } from '../../common/security/cookie-token';
import { JwtBlacklistService } from '../providers/jwt-blacklist.service';
import { TokenType } from '../user.constant';

/**
 * JwtAuthGuard — 企业级 JWT 验证 guard (大厂标准).
 *
 * V1.1.2 升级: token 来源从 Authorization header 改为 HttpOnly Cookie.
 *
 * 职责:
 *   1. 从 Cookie 提取 access_token (V1.1.2) / Authorization header (兼容 V1.x 测试)
 *   2. 用 JwtService.verify 验证 token 签名 + 过期
 *   3. 检查 token type === 'access' (防止 refresh token 被误用)
 *   4. 检查 blacklist (token 是否被主动撤销, 改密码/登出后) — Redis
 *   5. 把 payload 注入 request.user (供 @CurrentUser() decorator 取)
 *
 * 大厂 standard (Auth0 / Stripe 风格):
 *   - access token 走 HttpOnly cookie + Secure + SameSite=Lax
 *   - XSS 防御: JS 拿不到 HttpOnly cookie
 *   - CSRF 防御: SameSite=Lax 阻止跨站 POST 带 cookie
 *   - V1.x 兼容: 仍支持 Authorization Bearer header (测试 / 外部集成 / Swagger 用)
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly blacklist: JwtBlacklistService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: unknown; cookies?: Record<string, string> }>();

    // V1.1.2: 优先从 HttpOnly cookie 提取 token (大厂 standard).
    // 兼容: 仍支持 Authorization Bearer header (V1.x 测试 / 外部集成 / Swagger 用).
    let token: string | undefined;

    // 强类型 cast 治本 @typescript-eslint/no-unsafe-assignment
    const cookies = (request.cookies ?? {}) as Record<string, string>;
    if (cookies[COOKIE_NAMES.ACCESS_TOKEN]) {
      token = cookies[COOKIE_NAMES.ACCESS_TOKEN];
    } else {
      const authHeader = request.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.slice('Bearer '.length).trim();
      }
    }

    if (!token) {
      throw new BizException(BizCode.Unauthorized, '缺少 access token (cookie 或 Authorization header)');
    }

    let payload: { sub: string; jti: string; type: string };
    try {
      payload = this.jwt.verify<{ sub: string; jti: string; type: string }>(token, {
        secret: this.config.get<string>('jwtSecret'),
      });
    } catch {
      throw new BizException(BizCode.TokenExpired, 'token 无效或已过期');
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
    if (payload.type !== TokenType.Access) {
      throw new BizException(BizCode.TokenInvalid, 'token 类型错误, 需要 access token');
    }

    // 检查 blacklist (Redis backend, 改密码 / 主动下线 后 token 被撤销)
    const revoked = await this.blacklist.isRevoked(payload.jti);
    if (revoked) {
      throw new BizException(BizCode.TokenRevoked, 'token 已被撤销');
    }

    (request as unknown as { user: { sub: string; jti: string; type: string } }).user = payload;
    return true;
  }
}
