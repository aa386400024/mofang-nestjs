---
taskId: AF-538
contextId: phase2.5-audit-remediation
title: 第三方技术审计 P0/P1 复核与修复（安全 / 合规 / 数据完整性）
type: fix
status: backlog
baselineRef: 33fe92e616ae3562ca7dec029fd84cfc06f9fb3e
dependsOn: []
priorTasks: [AF-537]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.1, conventions.md#1.3, conventions.md#二]
createdAt: 2026-11-26T18:00:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - src
    - test
    - bin
    - docs/worklog
    - .env.example
    - .dockerignore
    - .github/workflows/ci.yml
    - Dockerfile
    - Dockerfile.prod
    - docker-compose.yml
    - docker-compose.prod.yml
    - package.json
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af538-audit-p0-p1-remediation-2026-11-26.md
    kind: report
gates:
  - command: pnpm typecheck
    check: 0 error
    threshold: exit 0
  - command: pnpm lint
    check: 0 error
    threshold: exit 0
  - command: pnpm test
    check: 全绿
    threshold: exit 0
successCriteria:
  - typecheck / lint / test 全绿
  - engine-core 零 diff
  - P0 全部修复
  - P1 主体修复并登记未闭环项
---

# AF-538 · 第三方技术审计 P0/P1 复核与修复

> 状态：📋 待执行（2026-11-26）
> 重签发原因：AF-537 任务单 frontmatter 缺少 `scope.files`，preflight 无法证明改动在授权范围内；按框架口径不原地改 scope，重签发 AF-538 并取消 AF-537。
> 唯一事实源：`D:\work\Project\backend\_audits\2026-11-26-mofang-nestjs-technical-audit.md` §5（P0）+ §6（P1）
> 改动范围：后端 `src` / `test` / `bin` / 配置 / compose / `.env.example` / `docs/worklog`

## 1. 背景

MiniMax 对基线 `8745f764` 做了只读技术审计。主 AI 已回源码复核 §5 全部 13 条 P0 均真实存在；用户要求“真实存在就都按企业级标准修复”，故本任务覆盖 P0 与 P1 主体。P2（§7）与 P3（§8）不在本单。

## 2. 范围

**在范围内：**

- P0-1 至 P0-13 全部修复。
- P1 6.1–6.21 中可落地的安全 / 合规 / 数据完整性问题。
- 对应测试更新与新增；`test/engine-core/boundary.spec.ts` 不改。
- 部署与 CI：Redis/compose/镜像/Trivy/`.dockerignore`/`entity:sync`。

**明确不在范围内：**

- 不动 `src/engine-core/**` 一行。
- 不改 `test/engine-core/boundary.spec.ts`。
- 不改 `admin-dashboard/` 与 Flutter。
- 不处理审计 §7 P2、§8 P3。
- 不引入新依赖；不跑 `flutter` / `dart` / `pub`。

## 3. 交付物

- 交付记录：`docs/worklog/completed/phase2.5/af538-audit-p0-p1-remediation-2026-11-26.md`
- 代码与测试改动：见交付记录“主要改动”。
- 机读回执：`docs/team/agent-orchestration/transport/receipts/AF-538.json` + durable 副本。

## 4. 红线

- `engine-core` 零 diff；纯层不新增 IO。
- 心理原文不进日志。
- migration 必须在 `bin/ormconfig.ts` 注册。
- 软删查询手写 `deletedAt: IsNull()`。
- 提交按仓库分层：任务分支、preflight、13 项检查、受保护 PR。

## 5. 闸门

| 闸门 | 命令 | 要求 |
|---|---|---|
| 类型 | `pnpm typecheck` | 0 error |
| Lint | `pnpm lint` | 0 error |
| 测试 | `pnpm test` | 全绿 |
| engine-core | `git diff --stat HEAD -- src/engine-core` | 空 |
| 安全 | `pnpm audit --prod` | 不新增 high/critical（环境不支持时记录原因） |

## 6. 未闭环项

- 6.18 token 预算、内核侧重复探测：受 engine-core 红线约束。
- 6.21#23–#25：需改 `boundary.spec.ts`，红线禁止。
- 6.21#11 persona 持久化、#33 未成年人门槛：需新表/契约/前端，另案。
- 6.20 人工通道/SLA：产品流程，另案。

## 7. 回写清单

- 交付记录、回执、状态索引、PR、commit message 均以 `AF-538` 贯穿。
- `git diff --stat HEAD -- src/engine-core` 为空。
- 不混入并行产物。
