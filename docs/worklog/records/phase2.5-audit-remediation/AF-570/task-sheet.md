---
taskId: AF-570
contextId: phase2.5-audit-remediation
title: 认证链路密码状态语义与验证码限流加固
type: fix
status: backlog
baselineRef: 4f421229482c8cfbe09840aaaf2a011dc1e5284c
riskClass: R2
gateProfile: full
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-27T11:30:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/base/controllers/
    - src/user/providers/
    - src/shared/infra/security/
    - test/user/
    - test/base/
    - docs/worklog/pending/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-audit-remediation/AF-570/
  modules: [auth, user]
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af570-auth-password-semantics-2026-11-27.md
    kind: report
gates:
  - command: pnpm typecheck
    check: 0 error
    threshold: exit 0
  - command: pnpm lint
    check: 0 error
    threshold: exit 0
  - command: pnpm exec vitest run test/user/af570-auth-password-semantics.spec.ts test/user/set-password-first-set.spec.ts
    check: 定向认证语义与首次设密码回归全绿
    threshold: exit 0
  - command: pnpm test
    check: 全量测试无失败
    threshold: exit 0
  - command: git diff --stat HEAD -- src/engine-core
    check: engine-core 零 diff
    threshold: 输出为空
successCriteria:
  - 为 send-code 增加与 check-email 同档的 5 req/min/IP 端点严格限流，同时保留 LoginCodeService 的同邮箱 60 秒冷却与 300 秒验证码 TTL
  - 新增统一的可用密码判定，空字符串与 OAuth 占位值均视为未设密码；verify-code 不再把 OAuth 用户返回为 hasPassword=true
  - auth/set-password 与 UserService.setInitialPassword 使用同一可用密码判定，OAuth 占位账号可以完成首次设密码，真实已设密码账号仍被拒绝
  - login-password 遇到无可用密码账号时对外仍返回 InvalidCredentials 统一 401，不新增可枚举业务码或文案
  - login-password 遇到无可用密码账号时不增加 failedLoginCount、不锁定账号、不因 OAuth 占位值触发异常；审计 reason 记为 password_not_set
  - 补回归测试覆盖空密码、OAuth 占位、真实 hash、verify-code 响应、首次设密码与无密码登录不锁定
  - 不改 check-email 的 userExists 与 hasPassword 既有契约，不改前端、admin-dashboard、engine-core、migration
---

# AF-570 · 认证链路密码状态语义与验证码限流加固

## 背景

AF-537 反账号枚举把 `/auth/check-email` 的 `hasPassword` 固定为 false，前端已改为“用户自选密码或验证码”。只读核对发现三个相邻问题仍未闭合：

1. `/auth/send-code` 没有挂 `@AuthStrictRateLimit()`，只有全局 60 req/min/IP 与同邮箱 60 秒冷却；`check-email`、`login-password`、`verify-code` 等敏感端点已是 5 req/min/IP。发送验证码属于高成本、可被邮件轰炸的敏感端点，应同档。
2. `/auth/verify-code` 的 `hasPassword` 仍直接写 `!!user.passwordHash`。OAuth 新用户使用 `!OAUTH_NO_PASSWORD!` 占位，`!!` 会把它判成“已设密码”；`UserService.setInitialPassword` 的 `if (user.passwordHash)` 同样会拒绝这类账号首次设密码。
3. `/auth/login-password` 对所有失败统一返回 `InvalidCredentials` 是正确的反枚举契约，但无密码账号会走密码校验失败分支，累计 `failedLoginCount`，5 次锁 30 分钟；OAuth 占位值还可能让 argon2 校验抛异常。不能为了前端精确引导而在未认证接口暴露“该邮箱未设密码”，否则重新打开账号存在性 oracle。

## 范围

- `src/shared/infra/security/password-hasher.ts`：新增统一“可用密码哈希”判定；`verifyPassword` 对空值、占位值、损坏哈希 fail-closed 返回 false，不抛异常。
- `src/base/controllers/auth.controller.ts`：`send-code` 增加严格限流；`verify-code` 与 `set-password` 改用统一判定。
- `src/user/providers/user.service.ts`：`login()` 在密码校验前识别无可用密码账号，仍走统一 `InvalidCredentials`，但不计数、不锁定、不抛 500；`setInitialPassword` 改用统一判定。
- `test/user/af570-auth-password-semantics.spec.ts`：覆盖 helper、verify-code 响应、首次设密码、无密码登录不锁定、OAuth 占位不抛异常。
- 交付记录与回执按仓库编排规范回写。

## 不在范围

- 不修改 `/auth/check-email` 的 `userExists` 或 `hasPassword` 契约。
- 不新增“邮箱未设密码”独立业务码或可枚举文案；前端引导仍走验证码登录成功后的 `hasPassword=false`。
- 不改 OAuth 登录、绑定、解绑流程，不改数据库 schema 或补数据迁移。
- 不改前端 Flutter、`admin-dashboard/`、`src/engine-core/`。
- 不做真实邮件发送压测，不连接生产 Redis/MySQL。

## 验收口径

- `send-code` 路由元数据带 5 req/min/IP 限流；同邮箱 60 秒冷却与 300 秒 TTL 不变。
- 空字符串、`null`、`undefined`、任意 `!` 前缀占位值均判定为无可用密码；真实 argon2 哈希判定为有密码。
- `verify-code` 对 OAuth 占位账号返回 `hasPassword=false`，对真实密码账号返回 `true`。
- `set-password`/`setInitialPassword` 对 OAuth 占位账号允许首次设密码，对真实密码账号仍拒绝。
- `login-password` 对无密码账号返回 `BizCode.InvalidCredentials` 401，`failedLoginCount` 不变、`lockedUntil` 不变，审计 reason 为 `password_not_set`。
- 全量闸门与 engine-core 零 diff 通过。
