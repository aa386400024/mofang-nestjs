---
taskId: AF-157
contextId: phase2.5-orchestration-closed-loop
title: admin 全局 Naive UI 本地化：中文界面不再出现英文默认占位
type: fix
status: backlog
baselineRef: 603ffce
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-20T03:05:00+08:00
deadline: 2026-11-20T08:00:00+08:00
agentRole: executor
scope:
  files:
    - admin-dashboard/src/App.vue
    - docs/worklog/pending/af157-admin-naive-locale-task-2026-11-20.md
    - docs/worklog/completed/phase2.5/af157-admin-naive-locale-2026-11-20.md
  modules: [admin-dashboard]
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af157-admin-naive-locale-2026-11-20.md
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
  - 中文界面下 Naive UI 默认占位（下拉 Please Select、日期 Start/End Date、分页等）显示中文
  - 英文界面仍显示英文，不硬编码单一语言
  - 切换语言后无需刷新即生效
  - 不改业务数据与接口
---

# AF-157 · admin 全局 Naive UI 本地化

## 背景

GateDecisions 页中文界面里，角色/原因筛选显示 `Please Select`，日期范围显示 `Start Date` / `End Date`。根因不是页面文案，而是 `n-config-provider` 未绑定 `locale` / `date-locale`，Naive UI 全部回退英文默认。

## 目标

- 在 App 根 `n-config-provider` 绑定随 i18n 切换的 Naive UI locale。
- 中文 → `zhCN + dateZhCN`；英文 → `enUS + dateEnUS`。
- 覆盖所有页面的默认占位、日期面板、分页、空状态等组件内文案。
