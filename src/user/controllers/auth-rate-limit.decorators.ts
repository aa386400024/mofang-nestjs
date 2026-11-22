import { SetMetadata, type CustomDecorator } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';

/**
 * 鉴权路由分级限流 (大厂防爆破标配).
 *
 * 设计:
 *   - login / register / forgot-password 等敏感路由单独限流 (5 req/min/IP)
 *   - refresh / me 等相对宽松 (10 req/min/IP)
 *   - 全局默认 60 req/min/IP (AppModule ThrottlerModule 配)
 *
 * 用法:
 *   @Post('login')
 *   @AuthStrictRateLimit()
 *   public login() { ... }
 */

/**
 * 严格限流 — 5 req/min (登录 / 注册 / 重置密码 / 短信发送)
 *
 * 大厂数据:
 *   - 5 req/min/IP 是业界主流 (Auth0 / Cognito / Firebase)
 *   - 真实用户输错密码平均 1-3 次, 5 次足够
 *   - 防止撞库 + 短信轰炸
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export function AuthStrictRateLimit(): MethodDecorator & ClassDecorator {
  return Throttle({ default: { limit: 5, ttl: 60_000 } });
}

/**
 * 中等限流 — 10 req/min (refresh / me / 验证邮箱)
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export function AuthMediumRateLimit(): MethodDecorator & ClassDecorator {
  return Throttle({ default: { limit: 10, ttl: 60_000 } });
}

/**
 * 宽松限流 — 30 req/min (登出 / 列 sessions)
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export function AuthLooseRateLimit(): MethodDecorator & ClassDecorator {
  return Throttle({ default: { limit: 30, ttl: 60_000 } });
}

/**
 * 完全不限流 — webhook 类路由 (OAuth callback)
 *
 * 注意: 大部分 OAuth callback 不应该完全无限制, 建议用 AuthMediumRateLimit
 * 这里是给真正需要无限制的场景 (比如内部服务调用)
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export function NoRateLimit(): MethodDecorator & ClassDecorator {
  return SkipThrottle();
}

/**
 * 标记鉴权路由 (供监控 / 日志 / 特殊中间件识别).
 * 当前未使用, 留作扩展点 (V3 加 risk-aware middleware 时用).
 */
export const IS_AUTH_ROUTE = 'isAuthRoute';
export const AuthRoute = (): CustomDecorator => SetMetadata(IS_AUTH_ROUTE, true);
