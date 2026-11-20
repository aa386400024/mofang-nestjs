---
taskId: AF-156
contextId: phase2.5-orchestration-closed-loop
title: admin 审计口径修正：生效引擎版本回退与在线状态真实探活
type: fix
status: backlog
baselineRef: c72f4d2
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-20T02:58:00+08:00
deadline: 2026-11-20T08:00:00+08:00
agentRole: executor
scope:
  files:
    - src/admin-debug/admin-debug.controller.ts
    - admin-dashboard/src/App.vue
    - admin-dashboard/src/i18n/locales/zh-CN.ts
    - admin-dashboard/src/i18n/locales/en.ts
    - test/admin-debug/
    - docs/worklog/pending/af156-admin-audit-version-health-task-2026-11-20.md
    - docs/worklog/completed/phase2.5/af156-admin-audit-version-health-2026-11-20.md
  modules: [admin-debug, admin-dashboard]
  interfaces: ['GET /admin/api/debug/effective-config', 'GET /admin/api/health']
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af156-admin-audit-version-health-2026-11-20.md
    kind: report
gates:
  - command: pnpm exec vitest run test/admin-debug
    check: admin-debug 测试全绿
    threshold: exit=0
  - command: pnpm typecheck
    check: 类型检查零错误
    threshold: exit=0
  - command: pnpm lint
    check: lint 零错误
    threshold: exit=0
  - command: pnpm --dir admin-dashboard build
    check: admin 生产构建通过
    threshold: exit=0
successCriteria:
  - 生效参数页 engineVersion 不再恒为 unknown，env 缺失时回退 git describe
  - 顶栏在线状态由真实 /admin/api/health 探活驱动，后端不可达时显示离线
  - 探活不触发 Basic 凭据弹窗、不阻塞页面渲染
  - 不写业务数据、不改评分口径与 engine-core
---

# AF-156 · admin 审计口径修正

## 背景

AF-155 运行时冒烟发现两处“看起来正常、实际不可审计”的展示：

1. `GET /admin/api/debug/effective-config` 只读 `ENGINE_VERSION` env；本地未配时恒返回 `unknown`，而推理指纹服务已有 `git describe` 回退，导致同一进程里“批次指纹有版本、参数页没有版本”。
2. admin 顶栏“引擎在线”是静态绿点，后端 502 / 停机时仍然显示在线，误导排障。

## 目标

- 参数页版本值走与推理指纹相同的 `resolveEngineVersion(env, gitDescribeDirty)` 回退。
- 顶栏在线状态改为真实探活：进入页面即探一次，之后低频轮询；失败显示离线，恢复自动转在线。
- 探活失败不得触发 Basic 凭据输入框（静默 probe）。
