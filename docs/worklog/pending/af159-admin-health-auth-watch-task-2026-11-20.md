---
taskId: AF-159
contextId: phase2.5-orchestration-closed-loop
title: 顶栏探活在登录态切换后即时刷新
type: fix
status: backlog
baselineRef: 19b0c52
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-20T03:13:00+08:00
deadline: 2026-11-20T08:00:00+08:00
agentRole: executor
scope:
  files:
    - admin-dashboard/src/App.vue
    - docs/worklog/pending/af159-admin-health-auth-watch-task-2026-11-20.md
    - docs/worklog/completed/phase2.5/af159-admin-health-auth-watch-2026-11-20.md
  modules: [admin-dashboard]
  interfaces: ['GET /admin/api/health']
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af159-admin-health-auth-watch-2026-11-20.md
    kind: report
gates:
  - command: pnpm lint
    check: lint 零错误
    threshold: exit=0
  - command: pnpm typecheck
    check: 类型检查零错误
    threshold: exit=0
  - command: pnpm --dir admin-dashboard build
    check: admin 生产构建通过
    threshold: exit=0
successCriteria:
  - 登录成功后顶栏立即重新探活，不再沿用登录前的 401 离线结论
  - 登出后状态回到未探测
  - lint / typecheck / admin build 三闸门通过
---

# AF-159 · 顶栏探活登录态联动

## 背景

AF-156 的探活在 App 挂载时执行一次。登录页阶段请求 `/health` 无凭据 → 401 → 状态置离线；登录成功后顶栏若沿用该状态，会错误显示“引擎离线”，最长 30 秒才被下一次轮询纠正。

## 目标

- 监听 `auth.isAuthenticated`：登录成功立即 probe 一次；登出清为 `null`（未探测）。
- 不改探活接口与 30s 轮询。
