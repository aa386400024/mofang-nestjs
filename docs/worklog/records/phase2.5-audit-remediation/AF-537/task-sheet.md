---
taskId: AF-537
contextId: phase2.5-audit-remediation
title: 第三方技术审计 P0 逐条复核与修复（安全 / 合规 / 数据完整性）
type: fix
status: ready
baselineRef: 33fe92e616ae3562ca7dec029fd84cfc06f9fb3e
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.1, conventions.md#1.3, conventions.md#二]
createdAt: 2026-11-26T17:00:00+08:00
agentRole: orchestrator
---

# AF-537 · 第三方技术审计 P0 逐条复核与修复（企业级）

> 状态：📋 待执行（2026-11-26）
> 执行方：自做
> 仓库：D:\work\Project\backend\mofang-nestjs-af070，分支 integrate
> 唯一事实源：`D:\work\Project\backend\_audits\2026-11-26-mofang-nestjs-technical-audit.md` §5（P0-1 至 P0-13）
> 任务性质：安全 / 合规 / 数据完整性修复
> 改动范围：仅后端 src / test / bin / 配置 / compose / .env.example / docs

## 1. 背景

MiniMax 于审计基线 `8745f764` 对 `integrate` 做了只读技术审计，报告列出 13 条 P0。主 AI 已回源码复核 P0-1、P0-2、P0-3、P0-5、P0-6、P0-7、P0-8、P0-9、P0-10、P0-11、P0-12、P0-13，均真实存在；本任务只处理 P0，逐条落企业级修复，P1/P2 另案。

关键现状：

- `shared/user` 是固定 `{id:'test',password:'crypto'}` mock，`AuthService.validateUser` 做明文等值比较，`/auth/login`、`/auth/jwt/login` 公开可达。
- `.env.example` 公开可预测 JWT 密钥，配置层不拒绝已知开发默认值。
- 5 张在线表无建表 migration：`companion_trees`、`companion_tree_water_logs`、`companion_dual_puzzle_sets`、`companion_dual_puzzle_questions`、`Companion_dual_puzzle_answers`。
- `docker-compose.yml` Redis 无密码、绑 0.0.0.0、`allkeys-lru`。
- 账号删除只写日志；软删 cron 只清 4 张账号表；consent 无业务闸门、无 withdraw。
- `adminRole ?? 'admin'` 在 JWT 与用户服务里把 NULL 变成管理员。
- OAuth callback 的 state 可省略、GET+DEL 非原子、微信不校验；邮箱已验证即自动绑定。
- LLM 会话主键直接取客户端 `conversationId`；`getSession` / `recentLogs` 缺归属校验。

## 2. 范围

**在范围内：**

- P0-1：删除 mock 用户模块与旧 LocalStrategy / `/auth/login` / `/auth/jwt/login`；`AuthService` 只保留 refresh 校验与旧签名（不用于登录）。
- P0-2：`.env.example` 改不可直接使用的占位；配置启动强校验 JWT 密钥长度/默认值/refresh 差异；统一 `jwtSecret` 读取为 `getOrThrow`。
- P0-3：新增手写 DDL migration 建 5 张表 + 索引，并在 `bin/ormconfig.ts` 注册；同时把 `Companion_dual_puzzle_answers` 表名改为小写规范。
- P0-4：`docker-compose.yml` Redis 强制密码、端口仅绑 127.0.0.1、`noeviction`；healthcheck 带认证。
- P0-5：`JwtAuthGuard` 注入 `sub` / `jti` / `adminRole` / `tenantId`；`@CurrentUser(field)` 对未知字段 fail-fast。
- P0-6：`deleteAccount` 真正软删用户 + 撤销全部 session + 解绑 OAuth + 写审计；导出任务改为按 uid 持久化并校验归属，不再返回常量。
- P0-7：删除全部 `adminRole ?? 'admin'`；NULL/缺省即无权限；`JwtStrategy` 同步。
- P0-8：OAuth `state` 强制必填；Redis `GETDEL` 原子消费；微信同样校验；邮箱已注册不再自动绑定，返回需登录后绑定。
- P0-9：软删 hard purge 扩展到全部含 `uid` / `userId` 的实体表（由 TypeORM metadata 驱动），事务内先子表后 users。
- P0-10：`ConsentService` 增加 `assertAccepted` 业务前置断言与 `withdraw`；consent 模块对外提供；LLM 编排入口接入同意闸门；新增 `DELETE /consent/:consentType`。
- P0-11：`ChatCompletionDto` / `ChatMessageDto` 增加运行时校验；`conversationId` 服务端生成或按 `{id, uid}` 续接；所有 update 带 `{id, uid}`。
- P0-12：`CompanionService.getSession` 按 `companionUid` 或 `ownerUid` 过滤。
- P0-13：`CompanionTreeController.recentLogs` 传当前用户；service 校验 `ownerAId/ownerBId`。
- 对应测试：新增/更新 P0 回归 spec；不改 `test/engine-core/boundary.spec.ts`。

**明确不在范围内：**

- 不动 `src/engine-core/**` 一行。
- 不处理审计 P1/P2/P3（另案 AF-538+）。
- 不改 `admin-dashboard/` 与 Flutter。
- 不引入新依赖；不跑 `flutter` / `dart` / `pub`。
- 不改 `test/engine-core/boundary.spec.ts`。

## 3. 交付物

- 交付物 1：认证链清理 —— 删除 `src/shared/user/**`、`src/auth/strategies/local.strategy.ts`、`src/auth/guards/local-*.ts`；`auth.controller` 删除 `login` / `jwt/login`；`AuthService` 去掉 mock 依赖。
- 交付物 2：`src/config/env.validation.ts` —— 启动期强校验生产 JWT/Redis/DB 密钥，拒绝已知默认值。
- 交付物 3：`src/migration/1714900000057-AddCompanionTreeAndDualPuzzleTables.ts` —— 5 张表 + 索引 + 注册。
- 交付物 4：`Docker`/compose 加固。
- 交付物 5：`src/user/providers/account-erasure.service.ts` —— metadata 驱动账号数据擦除；供 soft-delete cron 与 deleteAccount 复用。
- 交付物 6：`src/consent` 业务断言 + withdraw + 控制器端点 + LLM 闸门。
- 交付物 7：JWT guard/decorator 字段贯通；OAuth state 原子化；LLM/companion 归属校验。
- 交付物 8：测试 —— 至少覆盖 P0-1/2/5/6/7/8/9/10/11/12/13 的正负路径。

## 4. 红线

- 分层归属：`engine-core` 零 diff；不新增 IO 到纯层。
- 心理原文不进日志；P0 修复中的日志只出 uid 截断 / 计数 / 错误码。
- migration 必须在 `bin/ormconfig.ts` 注册；counselor 系手写 DDL 规则沿用。
- 软删不是 `@DeleteDateColumn`；每处查询手写 `deletedAt: IsNull()`（本任务新增查询同样遵守）。
- 不越权扩大 P1/P2；不修改 `boundary.spec.ts`。
- 提交按仓库分层：任务分支、preflight、13 项检查、受保护 PR。

## 5. 闸门

| 闸门 | 命令 | 要求 |
|---|---|---|
| 类型 | `pnpm typecheck` | 0 error |
| Lint | `pnpm lint` | 0 error，记录 warning |
| 测试 | `pnpm test` | 全绿，记录用例数 |
| engine-core | `git diff --stat HEAD -- src/engine-core` | 空 |
| migration | `pnpm exec tsc --noEmit` + 单测检查 migration 类名/注册 | 5 张表均注册 |
| 安全 | `pnpm audit --prod` | 不新增 high/critical |

## 6. 交付记录

`docs/worklog/completed/phase2.5/af537-audit-p0-remediation-2026-11-26.md`

## 7. 回写清单

- 交付记录、回执、状态索引、PR、commit message 均以 `AF-537` 贯穿。
- `git diff --stat HEAD -- src/engine-core` 为空。
- 不混入并行产物。
