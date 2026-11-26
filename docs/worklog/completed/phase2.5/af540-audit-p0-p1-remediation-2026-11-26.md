---
taskId: AF-540
contextId: phase2.5-audit-remediation
title: 第三方技术审计 P0 逐条复核与修复（安全 / 合规 / 数据完整性）
status: completed
completedAt: 2026-11-26T17:50:00+08:00
baselineRef: 33fe92e616ae3562ca7dec029fd84cfc06f9fb3e
commit: 任务分支 HEAD（以回执 changedFiles.commits 为准）
---

# AF-540 第三方技术审计 P0/P1 修复

## 结论

审计报告 §5 的 13 条 P0 **全部回源码复核为真实存在**，已全部修复；同时按用户“真实存在就都修复”的要求，把 §6 的 P1 主体（6.1–6.21）一并处理。`src/engine-core` 零 diff，`test/engine-core/boundary.spec.ts` 未改。

**未闭环项（如实登记）**：

- 6.18 token 预算低估、6.16 的第二次内核侧探测点位于 `src/engine-core`，受“纯层一行不动”红线约束，未直接改内核；6.16 已在装配层加短 TTL 探测缓存，消除适配层重复调用。
- 6.21#23–#25 需改 `test/engine-core/boundary.spec.ts`，AGENTS.md 明确禁止，未改。
- 6.21#11 persona 仓储仍为进程内实现；改为持久化涉及新表与迁移，未在本单硬塞。
- 6.21#33 未成年人年龄门槛/监护人同意需要新增用户年龄字段、注册契约与前端流程，属于产品+数据模型变更，未做半套。
- 审计 §7 P2（37 条）与 §8 P3 不在本单范围，未处理。

## 复核结论

| 审计项 | 是否真实 | 处置 |
|---|---|---|
| P0-1 认证 mock 路径 | 是 | 删除 `src/shared/user/**`、LocalStrategy、旧 `/auth/login`、`/auth/jwt/*`，统一走 `UserService` 真实登录 |
| P0-2 `.env.example` 公开 JWT 密钥 | 是 | 改占位 + 启动期 `validateEnv` 拒绝默认值/弱密钥 |
| P0-3 5 张表无 migration | 是 | 新增手写 DDL 并在 `bin/ormconfig.ts` 注册 |
| P0-4 Redis 无密码暴露 | 是 | 强制密码、回环端口、`noeviction`、带认证 healthcheck |
| P0-5 Guard 字段与 `@CurrentUser` 不一致 | 是 | 注入 `sub/jti/userId/...`；未知字段 fail-fast |
| P0-6 账号删除只写日志 | 是 | 真软删 + 撤销 session/blacklist + 解绑 OAuth + 审计；导出返回 501 |
| P0-7 `adminRole ?? 'admin'` | 是 | 全部删除，NULL 即无权限 |
| P0-8 OAuth state 可省略/非原子 | 是 | state 必填、GETDEL 原子消费、邮箱冲突不再自动绑定 |
| P0-9 purge 只清 4 表 | 是 | `AccountErasureService` 按 TypeORM metadata 擦除全部含 `uid/user_id` 的表 |
| P0-10 consent 无闸门/无 withdraw | 是 | `assertAccepted` 接入 LLM 入口 + `DELETE /consent/:consentType` |
| P0-11 LLM 会话主键客户端可控 | 是 | DTO 全量校验；会话 id 必须存在且 uid 匹配；update 带 uid |
| P0-12 companion getSession 无归属 | 是 | 双归属过滤 |
| P0-13 recentLogs 丢身份 | 是 | 传 uid 并校验 ownerA/ownerB |
| 6.6 黑名单 fail-open | 是 | 读侧改 fail-closed（Redis 故障返回 503，不放行已撤销 token） |
| 6.12 邮件假成功 | 是 | 无真实凭据时抛 `ServiceUnavailable` |
| 6.11 短信空桩 | 是 | 三个 provider 改为抛错，不再假装成功 |
| 6.15 生效审议无并发闸 | 是 | 单会话 in-flight 互斥，慢调用不堆叠 |
| 6.16 同轮 3 次 PsyGUARD | 是 | 装配层短 TTL 缓存，同 text+side 共用一次结果 |
| 6.17 配额先读后写 | 是 | Redis Lua 原子“判上限+自增+写 last_turn” |
| 6.20 emergency 无告警信号 | 部分 | intensity 0..10 服务端校验；高危/完成态写结构化告警日志；完整值班工单/第三方热线推送需产品流程，未做 |
| 6.21#12 supervisor jobId | **否** | 报告给的 `src/counselor/providers/supervision.processor.ts` 不存在；实际督导链路未见该队列，未改 |
| 6.21#26 危机类别漂移 | 结构性风险 | 当前 10 项与内核危机集合一致；跨层清单联动需内核导出，未在本单改 |
| 其余 P1 6.1–6.21 | 是 | 已修：枚举限流/验证码失败计数/HMAC 存储/JWT HS256+iss+aud/XFF/Sentry 心理字段/日志去原文/收藏软删/人物模板软删/WS 长度/租约/jobId/拼图归属/徽章 N+1/persona 默认租户回退/KB cron 索引/express-session 删除/Trivy 产物扫描/entity:sync 删除/debug 归属 |

## 主要改动

- 认证与账号：`src/auth/**`、`src/base/controllers/auth.controller.ts`、`src/user/**`、`src/user/oauth/**`。
- 配置与启动：`src/config/env.validation.ts`、`src/config/configuration.ts`、`src/config/envs/default.ts`、`.env.example`、`src/app.ts`。
- 数据完整性：`src/migration/1714900000057-AddCompanionTreeAndDualPuzzleTables.ts`、`bin/ormconfig.ts`、`src/user/providers/account-erasure.service.ts`、`src/user/cron/soft-delete.cron.ts`。
- 同意与 LLM：`src/consent/**`、`src/ai-engine/**`、`src/agent/llm/**`。
- 归属与限流：`src/companion/**`、`src/engine-adapters/wiring/engine-wiring.controller.ts`、`src/voice/voice.gateway.ts`、`src/auto-practice/**`。
- 审议与风险：`src/engine-adapters/deliberation/**`、`src/engine-adapters/wiring/caching-risk-probe.ts`、`src/engine-adapters/rendering/**`。
- 基础设施：`src/shared/infra/**`、`src/inner_world/providers/badges.service.ts`、`src/knowledge-base/providers/scheduled-publish.service.ts`。
- 部署与 CI：`docker-compose.yml`、`docker-compose.prod.yml`、`Dockerfile`、`Dockerfile.prod`、`.dockerignore`、`.github/workflows/ci.yml`、`package.json`。
- 测试：`test/base/auth-reset-password.spec.ts`、`test/user/set-password-first-set.spec.ts`、`test/engine-adapters/wp7-turn-render.spec.ts`、`test/engine-adapters/wp8-wiring.spec.ts`、`test/engine-adapters/deliberation-gate/quotas.spec.ts`、`test/shared/sentry-redaction.spec.ts`、`test/consent/td17-consent-port-c2-batch1.spec.ts`。

## 关键设计决策

1. **认证只保留一条真实链**：旧 mock 用户与明文 `validateUser` 删除；`AuthService` 只保留 refresh 校验；所有登录/验证码签发统一走 `UserService.buildAuthResponse`，token 带 `jti/iss/aud`，可被黑名单命中。
2. **安全判定 fail-closed**：黑名单读失败不再放行，避免 Redis 抖动期间已登出 token 复活；代价是 Redis 故障时认证接口 503，这是安全优先的明确取舍。
3. **验证码哈希而非明文**：Redis 只存 HMAC-SHA256(pepper, code)，pepper 未配置时回退 JWT 密钥；同时保留失败计数，5 次作废。
4. **账号擦除由 metadata 驱动**：不维护手写表白名单，新增含 `uid/user_id` 的表自动纳入；保留 `audit_logs` 以留审计证据。
5. **配额原子预占**：Lua 把判定与自增合并，避免并发下 M 个请求都读到 N<上限。
6. **探测缓存只做请求内吸收**：2 秒 TTL、text+side 为键，失败不缓存；跨轮语义不变。
7. **生产端口不直接暴露**：保留 host 网络以兼容宿主机 MySQL/Redis，但 `app.listen` 支持 `BIND_HOST=127.0.0.1`，compose 显式设置。

## 闸门

- `pnpm typecheck`：exit 0，0 error。
- `pnpm lint`：exit 0，0 error，0 warning。
- `pnpm test`：exit 0；`352 passed | 1 skipped（353 文件）`，`5050 passed | 4 skipped（5054 例）`。
- `git diff --stat HEAD -- src/engine-core`：输出为空。
- `pnpm audit --prod`：**未能执行**——当前 registry `registry.npmmirror.com` 不提供 audit endpoint，返回 `ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS`；不是代码失败，属环境限制。
- 环境备注：Node v22.23.2 与 `engines.node >=26` 不一致，pnpm 仅告警，闸门以 exit code 为准。

## 偏差

- 任务单 §2 原写“不处理 P1/P2”，用户本轮明确要求“真实存在就都修复”，故扩展到 P1 主体；P2/P3 仍未处理，已在上方列明。
- 6.21#12 报告位置不存在，判定为不成立，未做无效改动。
- 6.16 只消除适配层重复探测；内核内部第二次探测受红线约束未改。
- 6.20 只做到服务端校验 + 告警信号，人工通道/工单/SLA 属产品流程，未假装完成。
- 6.21#11、#33、6.18 未做，原因见“未闭环项”。

## 回写

- 任务状态：`submitted → completed`（经 CLI 回执摄入）。
- 未改 `src/engine-core`、`test/engine-core/boundary.spec.ts`、`admin-dashboard/`、Flutter。
- commit message：`fix(af540): 修复第三方审计 P0 与 P1 安全合规问题`
