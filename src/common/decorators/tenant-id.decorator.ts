// V2026-10-08 治本 (TenantId / UserId parameter decorators):
//   从 req.user.tenantId / req.user.userId 提取 (JWT payload, 见 §16.2 改造)
//   业务 service / controller 用 @TenantId() / @UserId() 取值, 防止 client 越权
//
//   强约束: 只能用于 @UseGuards(JwtAuthGuard) 之后, 否则 req.user 为 undefined
//   缺这两 decorator 时, 业务代码不得不 req.user.tenantId (类型不安全)
//
//   反双胞胎:
//     - 不用 TenantContextMiddleware 注入 req.tenantId 字符串 — 跟 user 字段
//       分裂, 类型不安全, 跟 JwtAuthGuard 重复解 JWT. 用 @TenantId() 一处搞定.

import { ExecutionContext, createParamDecorator } from '@nestjs/common';

interface AuthenticatedUser {
  readonly userId?: string;
  readonly sub?: string;
  readonly tenantId?: string;
  readonly username?: string;
  readonly roles?: readonly string[];
}

function extractUser(req: unknown): AuthenticatedUser | undefined {
  if (typeof req !== 'object' || req === null) return undefined;
  const r = req as { user?: unknown };
  if (typeof r.user !== 'object' || r.user === null) return undefined;
  return r.user;
}

/** 从 JWT 提取 tenantId, 缺失抛 UnauthorizedException. */
export const TenantId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  // V2026-10-09 lint fix (@typescript-eslint/no-unsafe-assignment):
  //   getRequest() 返回 any, 赋给 const req 触发 no-unsafe-assignment.
  //   修法: 内联到 extractUser(...) — extractUser 签名是 (unknown) → AuthenticatedUser | undefined, 类型安全.
  const user = extractUser(ctx.switchToHttp().getRequest());
  if (!user?.tenantId) {
    throw new Error('TenantId: missing tenantId on req.user — check JwtAuthGuard');
  }
  return user.tenantId;
});

/** 从 JWT 提取 userId, 缺失抛 UnauthorizedException. */
export const UserId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  // V2026-10-09 lint fix (@typescript-eslint/no-unsafe-assignment): 同 TenantId, 内联 getRequest()
  const user = extractUser(ctx.switchToHttp().getRequest());
  const id = user?.userId ?? user?.sub;
  if (!id) {
    throw new Error('UserId: missing userId/sub on req.user — check JwtAuthGuard');
  }
  return id;
});
