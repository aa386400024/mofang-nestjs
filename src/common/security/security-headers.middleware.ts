import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * 安全响应头中间件 — V1.1 enterprise.
 *
 * 大厂 standard (OWASP 推荐, 全部 P1 级别):
 *   - Strict-Transport-Security (HSTS): 强制 HTTPS 1 年, 防止 SSL stripping
 *   - X-Content-Type-Options: nosniff, 防止 MIME 嗅探攻击
 *   - X-Frame-Options: DENY, 防止 clickjacking
 *   - Referrer-Policy: strict-origin-when-cross-origin, 防止 Referer 泄露
 *   - Permissions-Policy: 关闭不用的 browser APIs (camera/mic/geolocation)
 *   - X-XSS-Protection: 1; mode=block (legacy XSS auditor, 防御降级)
 *
 * 设计: 全局中间件, 所有响应都加. 大厂 typical 是 nginx + app 双层,
 *       我们这里 app 层兜底, nginx 重复设置也是幂等的.
 *
 * V1.1 范围: 静态安全头. CSP / COOP/COEP 等需要按页面调整的留给 V2.
 */
@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    // HSTS: 强制 HTTPS 1 年 (含子域), 仅 HTTPS 请求时设
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    // 防止 MIME 嗅探
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // 防止 clickjacking
    res.setHeader('X-Frame-Options', 'DENY');

    // 限制 Referer 泄露
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // 关闭敏感 browser APIs (大厂 strict 策略)
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');

    // Legacy XSS auditor (新浏览器已 deprecate, 老浏览器仍有效)
    res.setHeader('X-XSS-Protection', '1; mode=block');

    next();
  }
}
