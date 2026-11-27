---
taskId: AF-578
contextId: phase2.5-admin-dashboard-alignment
title: 同步 admin-dashboard BdiStatePanel 组件声明（执行单）
type: fix
status: backlog
baselineRef: 9c22d61ff31f322d688d784df0ce94de778b1a41
dependsOn: []
priorTasks: [AF-504]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.2, conventions.md#1.3]
createdAt: 2026-11-27T19:33:21+08:00
deadline: null
agentRole: executor
scope:
  files:
    - admin-dashboard/components.d.ts
    - docs/worklog/pending/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-admin-dashboard-alignment/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af578-admin-dashboard-bdi-state-panel-declaration-2026-11-27.md
    kind: report
gates:
  - command: pnpm --dir admin-dashboard type-check
    check: admin-dashboard vue-tsc 0 error
    threshold: exit 0
  - command: pnpm --dir admin-dashboard build-only
    check: admin-dashboard vite build 通过且组件声明稳定
    threshold: exit 0
  - command: pnpm lint
    check: 后端 lint 0 error
    threshold: exit 0
  - command: pnpm typecheck
    check: 后端 typecheck 0 error
    threshold: exit 0
  - command: git diff --stat HEAD -- src/engine-core
    check: engine-core 零改动
    threshold: 输出为空
successCriteria:
  - admin-dashboard/components.d.ts 中存在 BdiStatePanel 的组件声明，且与已跟踪的 admin-dashboard/src/components/BdiStatePanel.vue 一致
  - 不改任何 .vue 源组件、路由、接口、样式或业务逻辑；只同步 unplugin-vue-components 生成的声明文件
  - 前端 type-check 与 build-only 通过，后端 lint/typecheck 0 error，engine-core 零改动
  - 交付记录写明生成来源、改动行、闸门真实数字，并说明未把前端改动混入后端任务
objective: 消除 admin-dashboard 工作树中最后一处已跟踪的生成声明脏点，让 BdiStatePanel 的自动导入类型声明与真实组件同步入库
outOfScope:
  - 不改 admin-dashboard/src/ 下任何 Vue/TS 源码
  - 不处理前端样式、交互、接口与后端业务逻辑
  - 不改 src/engine-core、scripts/orchestration 与框架契约
constraints:
  - 只允许提交 unplugin-vue-components 生成的 components.d.ts 增量
  - 不手工编造组件声明；以真实源组件与构建输出为准
  - 状态面只经 CLI 写入
---

## 背景

`admin-dashboard/components.d.ts` 是 `unplugin-vue-components` 生成的自动导入声明文件，当前工作树中有一行未提交增量：补上 `BdiStatePanel`。该组件 `admin-dashboard/src/components/BdiStatePanel.vue` 已被仓库跟踪，但声明文件长期缺失对应条目，属于历史生成物漏提交，不是临时垃圾。

该文件位于 `admin-dashboard/` 前端管理域。本任务由 `executor` 角色承接，范围只放开生成声明文件，不改任何前端源码，也不把该改动混入后端文档/脚本任务。

## 实施范围

1. 保留并核对 `admin-dashboard/components.d.ts` 中的 `BdiStatePanel` 声明行。
2. 跑前端 `type-check` 与 `build-only`，确认构建不会生成额外声明或产生回退。
3. 跑后端 `pnpm lint`、`pnpm typecheck` 与 `engine-core` 零 diff 复核。
4. 写交付记录，说明生成来源、实际 diff、闸门数字与“仅声明同步”的边界。

## 验收方式

以 `git diff -- admin-dashboard/components.d.ts` 只包含 `BdiStatePanel` 声明为准；`BdiStatePanel.vue` 已在 HEAD 中跟踪。前端 type-check/build 通过，后端 lint/typecheck 0 error，`src/engine-core` 零 diff。
