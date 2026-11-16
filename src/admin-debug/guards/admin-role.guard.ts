// V2026-11-03 治本 (WP26 §1 P2-4 · admin-debug 命名空间加角色校验):
//   问题 (WP25 审查 P2-4): `/admin/api/*` 整条路由只有**身份**校验 (basic auth / 学员 JWT),
//   **没有角色校验** —— 任何学员拿自己的 token 就能进调试器 (只看得到自己的会话, 但"调试器"
//   这个入口本身就不该对普通学员开放).
//
//   修法: 新增本守卫, 判"是不是管理员" —— 读 **DB 真值** `users.admin_role`.
//
//   为什么必须查 DB, 不能信 JWT 里的 `adminRole`:
//     `src/user/providers/user.service.ts:675` 有 V0.x dev fallback:
//       `const adminRole = user.adminRole ?? 'admin';`
//     即 **DB 里 admin_role 为 NULL 的普通学员, JWT 里的 adminRole 也是 'admin'** ——
//     照抄 token 那份副本做判定 = 防护等于 0 (每个学员都是管理员).
//     附带理由: token 里的角色是签发时的快照 (access token 15 分钟过期),
//     角色被回收后旧 token 仍能进 —— 读 DB 才即时生效.
//
//   为什么 basic 凭据不受角色约束:
//     basic 凭据是**运维入口** (env `ADMIN_BASIC_AUTH_USER/PASS`), 不是学员入口 ——
//     它不对应 users 表里的任何一行, 自然也没有 admin_role.
//     调试器 SPA (admin-dashboard) 就是用它登录的.
//     要求"运维账号也得在 users 表里有一行 admin" = 把运维入口焊死在学员表上, 不合理.
//
//   为什么角色只认 'admin' (不含 editor / reviewer):
//     `/admin/api/*` 能看到**全部学员**的咨询逐字稿 (管理员不过滤), 属于"运营看全局"的能力;
//     editor / reviewer 在仓库里的职责是官方人物库的**内容治理** (见 counselor 的 AdminRoleGuard),
//     不该看到学员咨询原文 —— 故本守卫用**严格相等**, 不套用那边的 OR 语义.
//
//   为什么 DB 异常要 fail-close:
//     鉴权路径上的异常绝不能变成"放行" —— 查不到角色 = 无法证明是管理员 = 拒绝.
//     放行的话, DB 抖动一次就等于给整个调试器开了后门.
//
//   为什么不复用 `src/counselor/guards/admin-role.guard.ts` (同名 class, 不同物):
//     ① 角色口径不同 (那边 editor/reviewer 任一命中即放行; 这边只认 admin);
//     ② 那边没有 basic 凭据旁路 (它是纯 JWT 链路);
//     ③ 那边走 UserService.findByUid 拉整行, 这边只读 admin_role 一列 (最小权限读取).
//     语义不同硬复用 = 调试器会意外对 editor / reviewer 开放.
//
//   403 用哪个 BizCode: `BizCode.Forbidden` (1006, 通用段).
//     - 它在 `src/common/exceptions/biz.exception.ts:102` 的 FORBIDDEN_CODES 组里 → HTTP 403;
//     - 不用 `BizCode.VisitorPoolForbidden` (47_004): 那个码的默认文案是
//       "无权访问来访池管理能力", 语义绑死在**来访池**模块, 拿来判调试器是张冠李戴;
//     - 全局 BizExceptionFilter 统一把 BizException 转成 `{ code, message, data: null }`,
//       与仓库其它端点的错误响应格式一致.
//
//   反双胞胎:
//     - 不返回 false: Nest 会抛**没有业务码**的裸 ForbiddenException,
//       前端分不清"没登录"与"不是管理员" —— 一律抛 BizException (带 BizCode).
//     - 不把角色判定写进 controller: 4 个端点各写一遍 = 漏一个就开天窗; 守卫是唯一入口.
//     - 不挂 JwtAuthGuard: 本命名空间的身份由中间件解析 (basic 或 JWT 都可能),
//       再挂一遍 JWT 守卫会把 basic 运维入口打成 401.
//
//   验证: test/admin-debug/wp26-admin-role-guard.spec.ts
//   时间戳: 2026-11-03 GMT+8
import { type CanActivate, type ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

import { BizCode } from '../../common/exceptions/biz-code.enum.js';
import { BizException } from '../../common/exceptions/biz.exception.js';
import { User } from '../../user/entities/user.entity.js';
import type { AdminDebugRequest } from '../admin-basic-auth.middleware.js';

/**
 * admin-debug 命名空间的管理员角色守卫 (WP26 §1 P2-4).
 *
 * 判定依据: **DB 里的** `users.admin_role` 必须严格等于 `'admin'`.
 */
@Injectable()
export class AdminRoleGuard implements CanActivate {
  private readonly logger = new Logger(AdminRoleGuard.name);

  constructor(@InjectRepository(User) private readonly userRepo: Repository<User>) {}

  /**
   * 判定当前请求是否具备管理员角色.
   *
   * @param context 执行上下文
   * @returns 放行返回 true
   * @throws BizException 无管理员角色 (403) / 查不到身份 (403)
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminDebugRequest>();

    // ① 运维 basic 凭据 = 独立身份 (运维入口, 不是学员入口) → 直接放行, 不查 DB.
    //   中间件 (`AdminBasicAuthMiddleware`) 已经校验过凭据本身是否正确, 这里只判"是不是管理员".
    if (request.adminBasicAuth === true) {
      return true;
    }

    // ② 学员身份 → 必须查 DB 真值 (理由见文件头).
    const userId = (request.user?.userId ?? '').trim();
    if (userId.length === 0) {
      // 匿名 (dev 裸奔口径) 或身份缺失: 无法证明是管理员 → 403.
      // 为什么这里不是 401: "有没有凭据"由中间件判 (prod 口径已 401), 守卫这一层只回答
      // "你是不是管理员" —— 答不上来就是"不是", 统一 403 避免同一命名空间两套拒绝语义.
      throw new BizException(BizCode.Forbidden, '调试接口仅对管理员开放');
    }

    const adminRole = await this.readAdminRole(userId);
    // NULL / 'editor' / 'reviewer' / 用户不存在 (=查不到) → 一律 403.
    if (adminRole !== 'admin') {
      throw new BizException(BizCode.Forbidden, '调试接口仅对 admin 角色开放');
    }
    return true;
  }

  /**
   * 读 DB 里的 `users.admin_role` (只读这一列).
   *
   * 为什么只 select 一列: 守卫只需要角色, 没必要把用户的手机号 / 邮箱 / 密码哈希等
   * 整行拉进内存 —— 最小权限读取.
   *
   * 为什么查不到用户 (含软删) 也算"不是管理员": 软删账号 (`deleted_at` 非空) 默认被
   * TypeORM 的 `withDeleted: false` 过滤掉 → 查不到 → 403 (fail-close).
   *
   * @param userId 用户 uid
   * @returns admin_role 值; 用户不存在时返回 undefined
   * @throws BizException 查询异常 (fail-close, 不放行)
   */
  private async readAdminRole(userId: string): Promise<User['adminRole'] | undefined> {
    try {
      const user = await this.userRepo.findOne({
        where: { uid: userId },
        select: { adminRole: true },
      });
      return user?.adminRole;
    } catch (error) {
      // DB 挂了 / 查询出错 → **不能放行**: 鉴权路径上的异常绝不能变成"通过".
      // 打 error 日志 (运维要能看见"是 DB 故障"而不是"用户没权限"), 客户端只拿到 403.
      this.logger.error(
        `查 users.admin_role 失败 (uid=${userId}) —— 按"无法证明有权限"处理`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new BizException(BizCode.Forbidden, '权限校验失败, 请稍后重试');
    }
  }
}
