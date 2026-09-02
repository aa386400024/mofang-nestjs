/**
 * V1.1.2 Cookie Token Constants — 大厂 standard (Auth0 / Stripe / Linear 风格).
 *
 * 设计目标:
 *   - accessToken / refreshToken 永远不出现 HTTP response body
 *   - 走 Set-Cookie: HttpOnly; Secure; SameSite=Lax
 *   - JS 拿不到 token → XSS 攻击拿不到 → 防浏览器扩展 / CDN 日志泄露
 *   - 浏览器自动管理 cookie → Flutter dio 走 CookieManager 持久化
 *
 * 命名:
 *   - access_token: 短期 (15min), 用于 Authorization header
 *   - refresh_token: 长期 (7d), 仅用于 /auth/refresh 接口
 *
 * SameSite=Lax:
 *   - 默认 (大厂 recommended) — 允许 GET 跨站访问, 但 POST/PUT/DELETE 不带
 *   - 严格防御 CSRF for state-changing requests
 *
 * Path 分隔:
 *   - access_token path=/ — 所有 endpoint 都能用
 *   - refresh_token path=/auth — 仅 refresh 接口能用 (最小权限)
 */
export const COOKIE_NAMES = {
  ACCESS_TOKEN: 'access_token',
  REFRESH_TOKEN: 'refresh_token',
} as const;

export const COOKIE_PATHS = {
  ACCESS: '/',
  REFRESH: '/auth',
} as const;

/** V1.1.2: cookie 安全配置 (跟 cookie options 一起塞). */
export const COOKIE_OPTIONS = {
  httpOnly: true, // JS 拿不到 (XSS 防御)
  secure: process.env.NODE_ENV === 'production', // 生产强制 HTTPS
  sameSite: 'lax' as const, // 大厂 recommended: 平衡 CSRF 防御和 UX
  // domain 不设 = 当前 host (localhost / api.xin-su.com), 防 subdomain 泄露
} as const;

/** 计算 cookie maxAge (毫秒, Express 用) — 跟 token TTL 对齐. */
export function cookieMaxAge(expiresInSec: number): number {
  return expiresInSec * 1000;
}
