---
taskId: AF-504
contextId: phase2.5-admin-dashboard-alignment
title: 修复 BDI ECharts tooltip 浮点长尾（执行单）
type: fix
status: backlog
baselineRef: 6b39b3a3e93e7e2f542c25063db432345d9c46d7
dependsOn: []
priorTasks: [AF-503]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.2, conventions.md#1.3]
createdAt: 2026-11-25T11:45:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - admin-dashboard/src/
    - docs/worklog/pending/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-admin-dashboard-alignment/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af504-bdi-tooltip-format-2026-11-25.md
    kind: report
gates:
  - command: pnpm --dir admin-dashboard type-check
    check: admin-dashboard vue-tsc 0 error
    threshold: 0 error
  - command: pnpm --dir admin-dashboard build-only
    check: admin-dashboard vite build 通过
    threshold: exit code 0
  - command: pnpm lint
    check: 后端 lint 0 error / 记录 warning
    threshold: 0 error
  - command: pnpm typecheck
    check: 后端 typecheck 0 error
    threshold: 0 error
  - command: git diff --stat HEAD -- src/engine-core
    check: engine-core 零改动
    threshold: empty output
successCriteria:
  - BDI 雷达图 hover tooltip 的每个维度值按 2 位小数展示，不再出现 0.6895000000000001 这类长尾。
  - BDI 走势图 hover tooltip 按轮次列出各序列值：0~1 维度用 2 位小数，效价用带符号 2 位小数；缺失值显示“—”。
  - tooltip 保留全部可见序列与系列颜色标识，不因格式化丢字段或改名。
  - 不修改数据链路与 trace JSON 导出精度（JSON 仍为 4 位）；只改展示层 tooltip。
  - admin-dashboard type-check/build 通过，后端 lint/typecheck 0 error，engine-core 零改动。
---

# AF-504 · 修复 BDI ECharts tooltip 浮点长尾（修复）

> 状态：📋 待执行（2026-11-25）
> 执行方：自做
> 仓库：D:\work\Project\backend\mofang-nestjs-af281r，分支 integrate
> 唯一事实源：admin-dashboard/src/components/BdiStatePanel.vue
> 任务性质：前端展示精度修复
> 改动范围：仅 admin-dashboard 前端 + 交付文档；后端契约只读，不改 engine-core

## 1. 背景

AF-503 已把 BDI 面板改成紧凑布局，但 ECharts 的 radar / line tooltip 仍使用默认 formatter，hover 时直接把 IEEE 浮点原值显示出来，例如 0.6895000000000001，和面板卡片、原始 JSON 的精度口径不一致。本次只修 tooltip 展示层，不改数据。

## 2. 范围

**在范围内：**

- `admin-dashboard/src/components/BdiStatePanel.vue`：radar tooltip 与走势图 tooltip 的展示格式。
- 必要时复用 `admin-dashboard/src/utils/trace-format.ts` 的 `formatMetric` / `formatSigned`。
- 本任务交付记录与任务记录。

**明确不在范围内（禁止顺手做）：**

- 不修改 `src/engine-core/` 任何文件；`git diff --stat HEAD -- src/engine-core` 必须为空。
- 不修改 trace 数据链路、JSON 导出精度、后端契约。
- 不引入新的图表库。
- 不清理仓库里既有的未提交文档/并行产物；提交时只暂存本任务文件。

## 3. 目标实现

- 雷达 tooltip 用自定义 formatter：标题显示第 N 轮，逐项列出维度名与 2 位小数值。
- 走势 tooltip 用自定义 formatter：标题显示第 N 轮，逐项列出系列颜色、系列名与格式化值；效价带符号，0~1 维度普通两位小数；null/undefined 显示“—”。
- 保留 tooltip 的深色背景、边框、字号等现有样式。
- 不动雷达与走势的数据、轴、图例、markLine、点击切轮逻辑。

## 4. 红线

- engine-core 零改动；纯展示层格式化。
- 不把缺失字段补成 0；缺失值仍显示“—”。
- 不新增对话原文日志或 console。
- 提交只含本任务授权的 admin-dashboard 文件与文档，不混入既有未提交产物。

## 5. 闸门

- `pnpm --dir admin-dashboard type-check`：0 error。
- `pnpm --dir admin-dashboard build-only`：构建通过。
- `pnpm lint`：0 error，记录 warning 数。
- `pnpm typecheck`：0 error。
- `git diff --stat HEAD -- src/engine-core`：空。

## 6. 交付

交付记录写到 `docs/worklog/completed/phase2.5/af504-bdi-tooltip-format-2026-11-25.md`，含六组机读字段标记；回执写 `docs/team/agent-orchestration/transport/receipts/AF-504.json`，随后按编排闭环归档。
