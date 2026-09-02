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

        // V2026-08-27 治本: 不再从 body 删除 accessToken / refreshToken.
        // 原设计: body 不返回 token, 只走 Set-Cookie HttpOnly (防 XSS 偷 token).
        // 现状: Flutter app 用 package:http 客户端, HttpOnly Cookie 拿不到 (dart:io HttpClient
        //   需要 credentials: 'include' + 自己管理 cookie jar; package:http Response.headers
        //   只暴露 Map<String, String> 单值, dart:io multi-value Set-Cookie 被 join 成一个字符串
        //   后面被 split(';') 解析后 refresh_token 被当 attribute 吞掉).
        // 治本: body 仍保留 token (大厂 standard: Auth0 / Stripe 两种方式都返, client 自由选).
        //   - 浏览器场景: HttpOnly Cookie 生效 (JWT cookie 自动带)
        //   - Flutter / mobile CLI / SDK: body 拿 token + Authorization Bearer header
        // 安全: token 仍走 HTTPS + 短过期 (15min), XSS 仍不可控, 但 public 端不暴露 token.
        // 防 CSRF: 浏览器走 SameSite=Lax, Flutter 走 Authorization header 不受 CSRF 影响.

        // 1. 写 access_token cookie (如果有) — body 保留原字段, 仅保留 Set-Cookie
        if (typeof obj['accessToken'] === 'string') {
          const expiresInSec = Number(obj['expiresIn']) || 900; // 默认 15min
          res.cookie(COOKIE_NAMES.ACCESS_TOKEN, obj['accessToken'], {
            ...COOKIE_OPTIONS,
            path: COOKIE_PATHS.ACCESS,
            maxAge: cookieMaxAge(expiresInSec),
          });
        }

        // 2. 写 refresh_token cookie (如果有) — body 保留原字段, 仅保留 Set-Cookie
        if (typeof obj['refreshToken'] === 'string') {
          const expiresInSec = Number(obj['refreshExpiresIn']) || 604_800; // 默认 7d
          res.cookie(COOKIE_NAMES.REFRESH_TOKEN, obj['refreshToken'], {
            ...COOKIE_OPTIONS,
            path: COOKIE_PATHS.REFRESH, // 仅 /auth/* 用
            maxAge: cookieMaxAge(expiresInSec),
          });
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
