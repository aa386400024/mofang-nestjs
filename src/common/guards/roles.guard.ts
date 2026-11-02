import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlContextType, GqlExecutionContext } from '@nestjs/graphql';
import type { Request } from 'express';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  public canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<string[] | undefined>('roles', [
      context.getHandler(), // Method Roles
      context.getClass(), // Controller Roles
    ]);

    if (!roles) {
      return true;
    }

    let request: Request;
    if (context.getType<GqlContextType>() === 'graphql') {
      const ctx = GqlExecutionContext.create(context).getContext<{ req: Request }>();
      request = ctx.req;
    } else {
      request = context.switchToHttp().getRequest<Request>();
    }

    const { user } = request;
    if (!user) {
      return false;
    }

    // V2026-10-12 (Phase 8.2 — Admin RBAC, spec §12.4):
    //   支持 adminRole 校验 (跟 user.roles 区分). 跟客户端 7.8 PermissionResolver
    //   can/cant 语义对齐: 命中任一即放行 (OR 语义, 跟 V0.x 客户端 canAny 同 pattern).
    //
    //   V0.x dev: user.adminRole 由 JwtStrategy.validate 透传, buildAuthResponse
    //   fallback 到 'admin' (server-side 兜底, V0.x dev 走完整 RBAC 矩阵).
    //   V1.x 真值下发后: adminRole 可能是 'editor' / 'reviewer' / 'admin' / undefined
    //   (NULL = 无权限, 跟 client 7.8 PermissionResolver.currentAdminRole null 一致).
    //
    //   user.roles 保留 (V1.x 多角色场景的 future-proof, V0.x 跟 adminRole 重叠).
    const userAdminRole = user.adminRole as string | undefined;
    const userRoles = user.roles ?? [];
    return roles.some((role) => userAdminRole === role || userRoles.includes(role));
  }
}
