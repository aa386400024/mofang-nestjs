---
taskId: AF-547
contextId: phase2.5-audit-remediation
title: 认证与授权 P2 安全加固
type: fix
status: backlog
baselineRef: ef2a341b58f64527cba6966b6fd7a52ccb2b9675
dependsOn: [AF-540]
priorTasks: [AF-540, AF-545, AF-546]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.1]
createdAt: 2026-11-26T20:10:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/base
    - src/user
    - src/profile
    - src/gql
    - src/sample
    - src/common/security
    - src/common/guards
    - bin
    - test
    - package.json
    - docs/runbooks
    - docs/worklog/records
    - docs/worklog/completed
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af547-authz-p2-hardening-2026-11-26.md
    kind: report
gates:
  - command: pnpm typecheck
    check: 0 error
    threshold: exit 0
  - command: pnpm lint
    check: 0 error 0 warning
    threshold: exit 0
  - command: pnpm test
    check: 全绿
    threshold: exit 0
successCriteria:
  - refresh_token cookie path 与真实刷新端点 /user/refresh 匹配
  - 短信验证码 Redis key 不再包含明文手机号
  - 密码重置 token 校验即原子消费，重复申请使旧 token 立即失效
  - 邮箱在注册/登录/重置链路统一小写归一化，LoginDto 有邮箱格式校验
  - 头像上传校验真实文件魔数，不只信扩展名/MIME
  - 业务角色端点不再被错误 RolesGuard 恒拒；JWT access token 带角色声明
  - 提供仅非生产可用的本地 access token 铸造脚本
---

# AF-547 · 认证与授权 P2 安全加固

## 背景

审计 §7.3 认证与授权 8 条中，以下问题已回源码确认：

- `COOKIE_PATHS.REFRESH = '/auth'`，真实刷新端点是 `/user/refresh`，浏览器 Cookie 作用域不匹配。
- `VerificationCodeService` 的 `sms:{phone}:{purpose}`、`sms:ratelimit:{phone}`、失败计数 key 均含明文手机号。
- `PasswordResetService.verifyToken` 只 `get` 不消费，存在重放竞态；`requestReset` 不清理旧 token。
- `RegisterDto` 存原始大小写邮箱，`findByEmail` 却用小写查询，导致重置密码静默失效。
- 头像上传只按 `fileType` 正则（MIME/扩展名）判断，可伪造。
- `buildAuthResponse` 签发的 access token 不带 `roles`；`RolesGuard` 依赖 `roles`/`adminRole`，导致 `@Roles('companion')` 业务端点恒 403；`sample.controller` 只挂 RolesGuard 不挂认证。
- GqlModule 未挂载，但 resolver 的 create/read/find/remove 无鉴权，需加静态防护。
- 调试缺 access token：新增非生产 token 铸造脚本，生产环境硬拒绝。

## 非目标

- 不碰 `src/engine-core`。
- 不做 OAuth token 加密 / PKCE（另开任务）。
- 不改 `test/engine-core/boundary.spec.ts`。
- 不新增第三方依赖。

## 验收

- `pnpm typecheck` / `pnpm lint` / `pnpm test` 全绿。
- 新增/更新单测覆盖 cookie path、手机号 key 哈希、reset token 消费、邮箱归一化、头像魔数、JWT roles。
- `pnpm dev:token` 在非生产可用，`NODE_ENV=production` 拒绝。
