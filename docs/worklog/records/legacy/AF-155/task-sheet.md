---
taskId: AF-155
contextId: phase2.5-orchestration-closed-loop
title: admin 调试引擎真实后端运行时冒烟与修复
type: fix
status: backlog
baselineRef: dd179bd942d423eb04d47bd8bc6607790f5d794d
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-20T02:20:00+08:00
deadline: 2026-11-20T08:00:00+08:00
agentRole: executor
priorTasks: [AF-154, AF-152, AF-147, AF-146]
scope:
  files:
    - admin-dashboard/src/
    - admin-dashboard/README.md
    - src/admin-debug/
    - test/admin-debug/
    - docs/worklog/pending/af155-admin-runtime-smoke-task-2026-11-20.md
    - docs/worklog/completed/phase2.5/af155-admin-runtime-smoke-2026-11-20.md
  modules: [admin-dashboard, admin-debug]
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af155-admin-runtime-smoke-2026-11-20.md
    kind: report
gates:
  - command: pnpm typecheck
    check: 类型检查零错误
    threshold: exit=0
  - command: pnpm lint
    check: lint 零错误
    threshold: exit=0
  - command: pnpm --dir admin-dashboard build
    check: admin 生产构建通过
    threshold: exit=0
  - command: pnpm exec vitest run test/admin-debug
    check: admin-debug 测试全绿
    threshold: exit=0
successCriteria:
  - 真实启动 NestJS 后端，用 HTTP 拉取 admin 页面依赖的只读端点，记录状态码与真实响应
  - 覆盖 sessions / characters / dashboard / gate / quality / auto-practice / effective-config
  - 发现前端字段或路径与真实响应不一致时直接修复并补测试
  - 不写生产业务数据；如需写接口只用可回滚的调试会话并在结束时清理
  - 无法访问的依赖或环境限制如实登记，不伪造“冒烟通过”
---

## 背景

AF-152 完成了 admin 前端实数据化，但只做了 build/typecheck/测试，未在真实 NestJS + MySQL 环境点过页面。本单补运行时冒烟，目标是找出“响应形状对不上、路径 404、字段 undefined、空态错判”这类只在联调出现的问题。

## 边界

- 只读冒烟优先；不批量造数据、不改生产配置。
- 前端改动只落在 `admin-dashboard/`；后端只修 `src/admin-debug/` 的只读投影问题。
- 不碰 `src/engine-core`。
- 不复用 AF-152 的结论；本单只看运行时真实响应。
