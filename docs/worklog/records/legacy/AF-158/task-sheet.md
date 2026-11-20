---
taskId: AF-158
contextId: phase2.5-orchestration-closed-loop
title: 标注台告警码人类可读与空态语义修正
type: fix
status: backlog
baselineRef: 77ec305
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-20T03:10:00+08:00
deadline: 2026-11-20T08:00:00+08:00
agentRole: executor
scope:
  files:
    - admin-dashboard/src/views/AnnotationTool.vue
    - docs/worklog/pending/af158-annotation-warning-ux-task-2026-11-20.md
    - docs/worklog/completed/phase2.5/af158-annotation-warning-ux-2026-11-20.md
  modules: [admin-dashboard]
  interfaces: ['GET /admin/api/quality/batches']
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af158-annotation-warning-ux-2026-11-20.md
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
  - 批次下拉下方不再直接展示 INVALID_BATCHES_HIDDEN:13 原始告警码，改为人类可读中文
  - 未选中场次但队列非空时，中间区提示“从左侧选择一场”，不误报“没有待标注场次”
  - 不改判定器、接口与标注数据
---

# AF-158 · 标注台告警与空态语义修正

## 背景

运行态打开 `#/quality/annotation`：

1. 批次选择器下方直接显示 `INVALID_BATCHES_HIDDEN:13`，违反 API 契约要求的“提示另有 n 个批次未通过有效性门禁”。
2. 左栏队列已有 189 条待标，但中间区因未选中场次显示“没有待标注场次”，与事实矛盾。

## 目标

- 告警码转中文，动态数量保留。
- 空态区分“队列为空”与“尚未选择场次”。
