// V2026-10-15 治本 (VS-4 隐私分级 — PrivacyGuard):
//   原因: V0.3 spec §11.3 标 "完整 enforcement 待做", 缺 PrivacyGuard 实施.
//         1 message VS-4 只建 guard, 不应用 (应用留 V1.x 后续 VS).
//   修法: @Injectable() CanActivate + Reflector 读 'privacy_level' metadata.
//         L1 放行 / L2 校验 request.user.userId 存在 throw 401
//              (JwtAuthGuard 之前已跑) / L3 校验 request.user.userId
//              vs request.params.userId/:id 抛 403, 调 PrivacyLogger.logL3Access().
//   反双胞胎: 不改 JwtAuthGuard (JWT 鉴权是身份验证, L1/L2/L3 是访问层级).
//             不复用 RolesGuard (那是 admin RBAC, 不同职责).
//             不应用 @RequirePrivacyLevel 到现有 controller
//             (1 message 只建基础设施, 应用留 V1.x).
//             不写 graphql 适配 (V0.x 估 REST only, V1.x 加 GqlContext 适配).
//   验证: 大炮跑 pnpm test mock JWT 测 L1 放行 + L2 401 + L3 403
//         + 验 PrivacyLogger L3 log 写入.
//   时间戳: 2026-10-15

import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { PrivacyLevel, PrivacyFailure } from '../privacy/privacy-level.enum';
import { PrivacyLogger } from '../privacy/privacy-logger.service';

/**
 * 隐私分级 enforcement guard.
 *
 * 业务 controller 用法:
 *   @UseGuards(JwtAuthGuard, PrivacyGuard)  // 顺序: JwtAuthGuard 先
 *   @RequirePrivacyLevel(PrivacyLevel.L3_CONFIDENTIAL)
 *   @Get(':id')
 *   async getOne(@Param('id') id: string) { ... }
 */
@Injectable()
export class PrivacyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly privacyLogger: PrivacyLogger,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const level = this.reflector.getAllAndOverride<PrivacyLevel | undefined>('privacy_level', [context.getHandler(), context.getClass()]);
    // 没标 @RequirePrivacyLevel = 放行 (跟现有 RolesGuard 同 pattern)
    if (!level) return true;
    // L1 公开 = 放行
    if (level === PrivacyLevel.L1_PUBLIC) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as { userId?: string } | undefined;

    // L2 内部 = 必须有 JWT 鉴权 (JwtAuthGuard 先跑)
    if (level === PrivacyLevel.L2_INTERNAL) {
      if (!user?.userId) throw PrivacyFailure.unauthorized();
      return true;
    }

    // L3 保密 = 必须有 JWT 鉴权 + ownership 校验
    if (level === PrivacyLevel.L3_CONFIDENTIAL) {
      if (!user?.userId) throw PrivacyFailure.unauthorized();
      const params = request.params as { userId?: string; id?: string };
      const targetUserId = params.userId ?? params.id;
      if (targetUserId && targetUserId !== user.userId) {
        throw PrivacyFailure.forbidden();
      }
      // 记 L3 审计 log (owner 访问自己资源也记, 审计完整性)
      this.privacyLogger.logL3Access({
        userId: user.userId,
        endpoint: request.originalUrl ?? request.url,
        method: request.method,
      });
      return true;
    }

    return true;
  }
}
