import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Response } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { COOKIE_NAMES, COOKIE_OPTIONS, COOKIE_PATHS, cookieMaxAge } from './cookie-token';

/**
 * V1.1.2 JwtCookieInterceptor — 大厂 standard (Auth0 / Stripe 风格).
 *
 * 职责:
 *   1. controller response body 含 accessToken/refreshToken 时, 把它们从 body 移除
 *   2. 通过 Set-Cookie header 把 token 写到客户端 (HttpOnly + Secure + SameSite=Lax)
 *   3. 支持 logout: 清空两个 cookie
 *
 * 配合:
 *   - JwtCookieAuthGuard (反方向: 从 cookie 读 token)
 *   - client fetch / dio 加 credentials: 'include'
 *
 * 防御:
 *   - XSS: JS 拿不到 HttpOnly cookie → 即使页面被注入也无法偷 token
 *   - CSRF: SameSite=Lax 阻止跨站 POST 带 cookie
 *   - 中间人: Secure (生产 HTTPS) + HSTS (SecurityHeadersMiddleware) 双层
 */
@Injectable()
export class JwtCookieInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const res = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      map((body: unknown) => {
        if (!body || typeof body !== 'object') return body;

        const obj = body as Record<string, unknown>;

        // 1. 写 access_token cookie (如果有)
        if (typeof obj['accessToken'] === 'string') {
          const expiresInSec = Number(obj['expiresIn']) || 900; // 默认 15min
          res.cookie(COOKIE_NAMES.ACCESS_TOKEN, obj['accessToken'], {
            ...COOKIE_OPTIONS,
            path: COOKIE_PATHS.ACCESS,
            maxAge: cookieMaxAge(expiresInSec),
          });
          delete obj['accessToken']; // 从 body 移除
          delete obj['expiresIn'];
        }

        // 2. 写 refresh_token cookie (如果有)
        if (typeof obj['refreshToken'] === 'string') {
          const expiresInSec = Number(obj['refreshExpiresIn']) || 604_800; // 默认 7d
          res.cookie(COOKIE_NAMES.REFRESH_TOKEN, obj['refreshToken'], {
            ...COOKIE_OPTIONS,
            path: COOKIE_PATHS.REFRESH, // 仅 /auth/* 用
            maxAge: cookieMaxAge(expiresInSec),
          });
          delete obj['refreshToken']; // 从 body 移除
          delete obj['refreshExpiresIn'];
        }

        return obj;
      }),
    );
  }
}

/**
 * 清空 cookie (logout 用) — 从 response 注入可调用.
 */
export function clearAuthCookies(res: Response): void {
  res.clearCookie(COOKIE_NAMES.ACCESS_TOKEN, {
    ...COOKIE_OPTIONS,
    path: COOKIE_PATHS.ACCESS,
  });
  res.clearCookie(COOKIE_NAMES.REFRESH_TOKEN, {
    ...COOKIE_OPTIONS,
    path: COOKIE_PATHS.REFRESH,
  });
}
