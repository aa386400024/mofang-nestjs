// V2026-10-12 (Phase 8.2 — 多租户, spec §0 / §3 A9 / §8.3):
//   从 JWT 拿 tenantId 注入 req.tenantId, 业务层 controller / service 直接
//   @TenantId() 读 (见 common/decorators/tenant-id.decorator.ts).
//
//   V0.x tenantId = uid (一人一租户, JwtStrategy.validate 兜底),
//   V1.x 接 Tenant entity 改 nullable 走 B 端组织隔离.
//
//   大厂 spec (跟 LoggerContextMiddleware 同 pattern, 见 middleware/logger-context.middleware.ts):
//     - NestMiddleware 接口, use() 三参 (req, res, next).
//     - 无副作用: 单纯 set req.tenantId 字段.
//     - 全局装配: 在 CommonModule.configure(consumer) 注册 forRoutes('*').
//
//   治本:
//     - 不放 JwtAuthGuard 内部拿 (跟 auth 紧耦合, 改 business logic 牵动 auth).
//     - 不放 TenantContextService (中间件拿 req.user 是一次性副作用, 无副作用无需 DI).
//     - 不在 controller 各自 @TenantId() 读之前手动 req.tenantId = xxx (重复样板).

import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { Request, Response } from 'express';

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  public use(req: Request, _res: Response, next: () => void): void {
    // JwtStrategy.validate 已把 tenantId 透传到 req.user, 这里同步到 req.tenantId
    // 顶层, 让 @TenantId() decorator (从 req.user 读) 跟 @GetUser() / 直接读 req 都能用.
    const user = (req as { user?: { tenantId?: string; sub?: string } }).user;
    if (user?.tenantId) {
      (req as Request & { tenantId?: string }).tenantId = user.tenantId;
    } else if (user?.sub) {
      // 兜底: 极端情况下 JwtStrategy 没透传 (legacy token), 用 sub (uid) 当 tenantId.
      // V0.x dev fallback 跟 spec §3 A9 "V0.x 默认 tenantId = uid" 对齐.
      (req as Request & { tenantId?: string }).tenantId = user.sub;
    }
    next();
  }
}
