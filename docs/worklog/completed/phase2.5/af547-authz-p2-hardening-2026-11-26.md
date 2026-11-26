---
taskId: AF-547
contextId: phase2.5-audit-remediation
title: 认证与授权 P2 安全加固
status: completed
completedAt: 2026-11-26T19:12:00+08:00
baselineRef: ef2a341b58f64527cba6966b6fd7a52ccb2b9675
commit: 任务分支 HEAD（以回执 changedFiles.commits 为准）
---

# AF-547 认证与授权 P2 安全加固

## 结论

审计 §7.3 的 8 条逐条回源码核实后，6 条为真实缺陷并已修复；2 条属于“代码存在但模块未挂载”的静态风险，已补上防护并如实登记残留。同步补了用户明确要求的本地 token 调试入口：`pnpm dev:token`，只允许非生产，不新增 HTTP 端点。

`src/engine-core` 零 diff。

## 逐条复核

| 审计项 | 是否真实 | 处置 |
|---|---|---|
| refresh cookie path 与刷新端点不一致 | 是 | `COOKIE_PATHS.REFRESH` 从 `/auth` 改为 `/user`，覆盖真实 `POST /user/refresh` |
| 密码重置 token 可重放 | 是 | `verifyToken` 改 `GETDEL` 原子消费；重复申请先原子失效旧 token，并加 10s 并发锁 |
| 短信 Redis key 含明文手机号 | 是 | 新增 `hashOpaqueIdentifier()`，code / rate-limit / fail key 统一用 HMAC 摘要 |
| 邮箱注册原样存、查询小写，重置静默失效 | 是 | 注册/登录/重发验证码统一 `normalizeEmail`；`findByEmail` 用 `LOWER()` 兼容历史混合大小写；`LoginDto` 加 `@IsEmail()` |
| 头像只信扩展名/MIME | 是 | 新增 `detectImageExtension()` 读文件头魔数，只接受 JPG/PNG/WebP，落盘后缀由真实格式决定 |
| JWT 缺 `roles`，`@Roles` 端点恒拒 | 是 | 抽出 `buildTokenClaims()` 统一 access/refresh claim，补 `username` + `roles`；profile 业务端点移除误用的 `@Roles('companion')` |
| GraphQL create/read/find/remove 无鉴权 | 静态风险 | GqlModule 当前未挂载 AppModule，线上不可利用；仍给 resolver 加 `JwtAuthGuard + RolesGuard + @Roles('admin')`，GqlModule 补 `AuthModule` |
| sample 只挂 RolesGuard 不挂认证 | 静态风险 | SampleModule 当前未挂载；controller 改为 `JwtAuthGuard + RolesGuard`，admin 端点保留 `@Roles('admin')` |

## 主要改动

- 安全基础：`src/common/security/cookie-token.ts`、`verification-code-hash.ts`、新增 `email-normalize.ts` / `image-signature.ts`。
- 用户链路：`src/user/providers/user.service.ts`、`password-reset.service.ts`、`verification-code.service.ts`、`src/user/dto/login.dto.ts`。
- 头像：`src/profile/providers/profile.service.ts`；移除 profile controller 的业务角色误用，`profile.module.ts` 不再注入 RolesGuard。
- 静态防护：`src/gql/gql.module.ts`、`src/gql/resolvers/simple.resolver.ts`、`src/sample/controllers/sample.controller.ts`。
- 调试入口：新增 `bin/dev-token.mjs`，`package.json` 加 `dev:token`，`docs/runbooks/local-setup.md` 补 6.1 节。
- 测试：新增 `test/user/af547-authz-hardening.spec.ts`；更新 `test/base/wp25-security-hardening.spec.ts` 使用真实 PNG 魔数。

## 关键设计决策

1. **业务身份不等于 RBAC 角色**：`companion` 是产品角色，`users.admin_role` 是内部管理角色，二者不是一个体系。继续用 `@Roles('companion')` 只会恒 403，因此移除注解，保留 JwtAuthGuard + service 自有数据归属校验。
2. **角色声明单一来源**：`buildTokenClaims()` 同时供 access/refresh 用，避免两条签发路径再次漂移；普通用户 `roles=['user']`，管理员追加 `adminRole`。
3. **密码重置先失效再签发**：先 `GETDEL` 旧 byUid token 并删除旧 token key，再写新 token；并发申请用 10s `SETNX` 锁合并，保证同一时刻只有一个有效链接。
4. **PII 不进 Redis key**：手机号摘要用与验证码同一 pepper 的 HMAC-SHA256，保持稳定映射且不可逆；日志仍只输出掩码手机号。
5. **魔数优先于后缀**：上传落盘名完全由文件头决定，客户端给的 `originalname` / `Content-Type` 不再参与后缀选择。
6. **调试 token 不降生产安全**：脚本只读本机 `.env`，`NODE_ENV=production` 硬拒绝，不新增任何 HTTP 端点；TTL 默认 900s，上限 24h。

## 未闭环 / 残留

- `GqlModule` 仍未挂载 AppModule，`SampleModule` 仍未挂载：本次只做静态防护，没有把它们重新接回主应用（重新挂载会改变对外路由面，需单独产品决策）。
- GraphQL 查询深度限制未做：仓库没有 `graphql-depth-limit` 依赖，任务单又禁止新增依赖；当前模块未挂载，暂不构成线上风险。
- `PasswordResetService` 仍没有 controller 调用方：实际 `/auth/reset-password` 走 `LoginCodeService` + `UserService.resetPasswordByEmail`；本次按“消灭潜在风险代码”修复，未删除，留给后续清理任务决定去留。
- 历史大小写混合邮箱通过 `LOWER()` 查询兼容，未做数据回填 migration；若未来加函数索引需单独评估。
- OAuth token 明文存储、隐私撤销 mock、成长报告 mock 等 §7.4 项未在本单处理。

## 闸门

- `pnpm typecheck`：exit 0，0 error。
- `pnpm lint`：exit 0，0 error，0 warning。
- `pnpm test`：exit 0；`353 passed | 1 skipped（354 文件）`，`5060 passed | 4 skipped（5064 例）`。
- `git diff --stat HEAD -- src/engine-core`：输出为空。
- `pnpm dev:token -- --uid test-uid --json`：exit 0，token payload 含 `sub/username/roles/jti/type/iss/aud/tenantId`。
- `NODE_ENV=production pnpm dev:token -- --uid test-uid`：exit 1，输出“拒绝在 NODE_ENV=production 下签发调试 token”。
- 环境备注：Node v22.23.2 与 `engines.node >=26` 不一致，pnpm 仅告警；闸门以 exit code 为准。

## 偏差

- 任务单写“JWT access token 带角色声明”，实现时同时给 refresh token 加了同一套 claim，保持对称；refresh 只用于换发，不扩大权限面。
- 任务单写“头像校验真实文件魔数”，实现上直接由魔数决定落盘后缀，比只做校验更彻底。
- 任务单未写 GraphQL 深度限制，实际未做，原因见“未闭环”。
