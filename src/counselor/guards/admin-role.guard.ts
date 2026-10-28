// V2026-10-23 治本 (AI 模拟来访池 — 内部管理角色守卫):
//   原因: spec `docs/specs/counselor-visitor-pool.md` §4 要求「生成 / 编辑 / 上下架 /
//     删除只走内部管理端点, **普通用户访问一律 403**」, §3.6 要求「管理/生成端点的
//     角色鉴权复用仓库现有内部/admin 角色体系 (具体守卫由后端按现状对接)」.
//     现状 (2026-10-23 扫描) 仓库有 3 套"内部能力"的鉴权口径, 各自职责不同:
//       ① `common/guards/roles.guard.ts` (RolesGuard) —— 读 request.user.adminRole /
//          request.user.roles. 但**当前注入 request.user 的 JwtAuthGuard
//          (src/user/guards/jwt-auth.guard.ts) 根本不注入 adminRole**, 且
//          `users` 表**没有 roles 列** → RolesGuard 在本仓当前链路上恒不放行.
//       ② `common/guards/privacy.guard.ts` (PrivacyGuard) —— L2_INTERNAL 只要求
//          "已登录", 不区分管理员与普通用户 (它管的是**访问层级**, 不是**角色**).
//       ③ `users.admin_role` 列 —— 3 档 (editor / reviewer / admin), 才是仓库真正的
//          内部/admin 角色体系真值源 (dev 种子已给 editor/reviewer/admin 三个账号落库).
//
//   修法: 本守卫直读 ③ `users.admin_role`:
//     - 身份认证交给 JwtAuthGuard (本守卫只判"是不是内部角色");
//     - 角色判定读 DB 真值 (不读 JWT 里的副本): JWT 里的 adminRole 最多 15 分钟过期,
//       角色被回收后旧 token 仍能进内部端点 —— 读 DB 才是即时生效的.
//     - 角色任一命中即放行 (OR 语义, 跟仓库既有 RolesGuard 一致): 内容运营 (editor)
//       与审核 (reviewer) 都需要接触官方人物库.
//
//   反双胞胎:
//     - 不复用 RolesGuard: 它在本仓当前链路上恒不放行 (见上), 用了等于"端点看着有鉴权,
//       实际全 403" —— 比没有鉴权更危险 (会让人误以为已经拦住).
//     - 不复用 PrivacyGuard: 那是访问**层级** (L1/L2/L3), 不是**角色**, 职责不同.
//     - 不在 JWT 里加 adminRole 再靠 token 判角色: token 快照过期 = 权限回收延迟.
//     - 不把角色判定写在 controller 里: 6 个端点各写一遍 = 漏一个就开天窗; 守卫是唯一入口.
//
//   验证:
//     1. tsc 0 错
//     2. 普通用户 token 调 /counselor/admin/visitor-pool/* → 403 (BizCode.VisitorPoolForbidden)
//     3. admin_role='admin' 的账号 → 200
//     4. 角色被置空后, 旧 token 再调 → 立即 403 (读 DB, 不等 token 过期)
//
//   时间戳: 2026-10-23
import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { BizCode } from '../../common/exceptions/biz-code.enum';
import { BizException } from '../../common/exceptions/biz.exception';
import { UserService } from '../../user/providers/user.service';

/**
 * 内部管理角色守卫.
 *
 * 判定依据: `users.admin_role` ∈ {editor, reviewer, admin}.
 * 抛 403 (BizException) 而不是返回 false —— 返回 false 会让 Nest 抛一个**没有业务码**的
 * 裸 ForbiddenException, 前端分不清"没登录"与"不是管理员".
 */
@Injectable()
export class AdminRoleGuard implements CanActivate {
  constructor(private readonly userService: UserService) {}

  /**
   * 判定当前请求是否具备内部管理角色.
   *
   * @param context 执行上下文
   * @returns 放行返回 true
   * @throws BizException 未登录 (401) / 无内部角色 (403)
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: { userId?: string } }>();
    const userId = request.user?.userId;
    if (!userId) {
      throw new BizException(BizCode.Unauthorized, '缺少身份信息');
    }

    const user = await this.userService.findByUid(userId);
    // adminRole 为 NULL = 非内部角色 (仓库既有约定: NULL = 无权限).
    if (!user || !user.adminRole) {
      throw new BizException(BizCode.VisitorPoolForbidden, '该能力仅对内部管理角色开放');
    }
    return true;
  }
}
