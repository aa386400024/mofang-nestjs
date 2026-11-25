import { type CanActivate, type ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

import type { AdminDebugRequest } from '../../admin-debug/admin-basic-auth.middleware.js';
import { BizCode } from '../../common/exceptions/biz-code.enum.js';
import { BizException } from '../../common/exceptions/biz.exception.js';
import { User } from '../../user/entities/user.entity.js';

/**
 * 会员运营端点管理员守卫 — 复用 `/admin/api` 的身份中间件结果。
 *
 * 与 admin-debug 的 AdminRoleGuard 同源同口径，只是错误文案改成“会员运营接口”；
 * basic 运维凭据直接放行，学员身份必须查 DB `users.admin_role = 'admin'`（不信 JWT 快照）。
 */
@Injectable()
export class MembershipAdminGuard implements CanActivate {
  private readonly logger = new Logger(MembershipAdminGuard.name);

  constructor(@InjectRepository(User) private readonly userRepo: Repository<User>) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminDebugRequest>();
    if (request.adminBasicAuth === true) return true;
    if (request.adminAnonymousDev === true && process.env.NODE_ENV !== 'production') return true;

    const userId = (request.user?.userId ?? '').trim();
    if (!userId) throw new BizException(BizCode.Forbidden, '会员运营接口仅对管理员开放');
    try {
      const user = await this.userRepo.findOne({ where: { uid: userId }, select: { adminRole: true } });
      if (user?.adminRole !== 'admin') throw new BizException(BizCode.Forbidden, '会员运营接口仅对 admin 角色开放');
      return true;
    } catch (error) {
      if (error instanceof BizException) throw error;
      // 鉴权查询失败必须 fail-close：不能因为 DB 抖动把运营改价能力放开。
      this.logger.error(`会员运营守卫查询 admin_role 失败 uid=${userId}`, error instanceof Error ? error.stack : String(error));
      throw new BizException(BizCode.Forbidden, '会员运营接口鉴权失败，请稍后再试');
    }
  }
}
