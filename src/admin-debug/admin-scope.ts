// V2026-11-05 治本 (admin 调试面 · 归属过滤口径共享):
//   职责: 给 admin 调试面的各 controller 提供**同一份**"这次请求能看到谁的会话"判定.
//   边界: 纯函数; 零 @nestjs/* / typeorm / IO.
//
//   为什么抽出来 (而不是每个 controller 各写一份):
//     `/admin/api/sessions` (WP19-R)、`/admin/api/cost/*` (WP31)、
//     `/admin/api/dashboard` (本次新增) 三处都问同一个问题.
//     口径散在三个 controller 里 = 三份实现迟早漂 —— 而"学员能不能看到别人的会话"
//     是**隐私边界**, 漂了就是越权, 不是显示问题.
//
//   口径 (与 WP19-R 的 D29 逐字一致):
//     · 带管理员 basic 凭据 → **不过滤** (运维要看全场);
//     · 学员 (有身份)        → 只看 `user_id = 自己`;
//     · 匿名 (dev 裸奔)      → 不过滤.
//
//   ⚠️ 注意"管理员 basic 凭据"与"admin 角色 JWT"是**两个身份**:
//     `AdminRoleGuard` 放行的是"basic 运维"或"`users.admin_role = 'admin'` 的账号";
//     而归属过滤只对**后者的学员身份**生效 —— 也就是说, 用 admin 账号的 JWT 登录
//     调试器时, 看板只统计**他自己**的会话. 这是 WP19-R 定下的口径, 本单不改,
//     只保证三处一致 (见交付记录 §偏差 B4).
//
//   验证: npx vitest run test/admin-debug/admin-insights.spec.ts
//   时间戳: 2026-11-05 GMT+8

import type { AdminDebugRequest } from './admin-basic-auth.middleware.js';

/**
 * 请求归属过滤条件 (学员隔离; 管理员不过滤).
 *
 * @param req 请求 (中间件解析出的身份)
 * @returns where 片段 (空 = 不过滤)
 */
export function buildOwnerFilter(req: AdminDebugRequest): { readonly userId?: string } {
  if (req.adminBasicAuth === true) return {};
  const userId = (req.user?.userId ?? '').trim();
  return userId.length > 0 ? { userId } : {};
}
