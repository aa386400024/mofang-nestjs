---
taskId: AF-503
contextId: phase2.5-admin-dashboard-alignment
title: 优化 auto-practice 调试面板纵向密度与 BDI 长滚动（执行单）
type: fix
status: backlog
baselineRef: a64abcc948965cea5913eb57b7dca46f7c89d787
dependsOn: []
priorTasks: [AF-502]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.2, conventions.md#1.3]
createdAt: 2026-11-25T11:20:00+08:00
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
    path: docs/worklog/completed/phase2.5/af503-auto-practice-debug-panel-density-2026-11-25.md
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
  - auto-practice 右侧调试面板只保留一个内部滚动区，tab 栏与面板头固定，切换 tab 不改变页面整体高度。
  - BDI 状态 tab 默认只展示本轮内容，历史趋势改为独立的“走势”子视图；默认视图无需长距离滚动即可看到雷达、关键数值、效价与状态细节。
  - BDI 历史趋势与效价趋势合并为一张 ECharts 双轴图，左轴 0~1、右轴 -1~1，选中轮标记线保留，点击数据点仍可切换轮次。
  - 本轮关键数值不再在 BDI 面板与 DebugTracePanel 底部重复渲染；雷达旁的紧凑数值区替代重复的“数值明细”。
  - 细节信息（阻抗三维、移情三态、核心信念、本轮 Δ）改为紧凑网格/可折叠区，默认不把面板撑高。
  - 图表继续统一使用现有 echarts / vue-echarts 依赖；不引入新的图表库，不修改 src/engine-core。
  - admin-dashboard type-check/build 通过，后端 lint/typecheck 0 error，engine-core 零改动。
---

# AF-503 · 优化 auto-practice 调试面板纵向密度与 BDI 长滚动（修复）

> 状态：📋 待执行（2026-11-25）
> 执行方：自做
> 仓库：D:\work\Project\backend\mofang-nestjs-af281r，分支 integrate
> 唯一事实源：admin-dashboard/src/components/BdiStatePanel.vue、admin-dashboard/src/components/DebugTracePanel.vue、admin-dashboard/src/views/AutoPractice.vue
> 任务性质：前端布局/可读性优化
> 改动范围：仅 admin-dashboard 前端 + 交付文档；后端契约只读，不改 engine-core

## 1. 背景

AF-502 已把 auto-practice 的 trace 能力补齐，但右侧调试面板沿用了“所有 BDI 区块纵向堆叠”的布局：雷达、数值标签、效价条、阻抗三维、移情三态、核心信念、本轮 Δ、历史趋势、效价趋势依次排列，BDI 状态 tab 单项高度超过面板可用高度，用户必须长距离滚动才能看到趋势或细节。DebugTracePanel 底部还重复渲染一份 0~1 数值明细，与 BdiStatePanel 内部标签重复。右侧面板的滚动容器也需要收紧，保证 tab 栏固定、只有内容区滚动。

## 2. 范围

**在范围内：**

- `admin-dashboard/src/components/BdiStatePanel.vue`：本轮/走势子视图、紧凑数值区、细节折叠、双轴趋势图。
- `admin-dashboard/src/components/DebugTracePanel.vue`：移除重复数值明细、固定 tab 布局与单一内部滚动区、长文本区域收紧。
- `admin-dashboard/src/views/AutoPractice.vue`：仅在右栏容器高度/滚动约束需要时调整。
- 本任务交付记录与任务记录。

**明确不在范围内（禁止顺手做）：**

- 不修改 `src/engine-core/` 任何文件；`git diff --stat HEAD -- src/engine-core` 必须为空。
- 不修改后端 trace 契约、数据库、migration、prompt、模型名。
- 不修改 Flutter 客户端。
- 不引入新的图表库；继续使用 `echarts` / `vue-echarts`。
- 不清理仓库里既有的未提交文档/并行产物；提交时只暂存本任务文件。
- 不在本任务里处理成本看板缓存命中聚合、gateDecision 后端接入等后端能力。

## 3. 目标实现

- **BDI 子视图**：`本轮` / `走势` 两个轻量切换；默认 `本轮`，避免首次进入就加载两条趋势图。
- **本轮布局**：雷达（约 160px）与紧凑数值区并排；效价双极条保留；阻抗/移情/核心信念/Δ 放进紧凑网格或默认折叠的“状态细节”，避免面板被撑高。
- **走势布局**：历史维度线（trust/safety/bond/arousal/阻抗话量）与 valence 合并为一张 ECharts 双轴图；左轴 0~1，右轴 -1~1；选中轮 markLine 保留；点击仍可 `select-turn`。
- **去重**：删除 DebugTracePanel 底部的“数值明细（0~1）”重复块；关键数值只在本轮紧凑区出现。
- **滚动约束**：DebugTracePanel 的 NTabs / NTabPane 使用 `h-full min-h-0` 与唯一 `overflow-auto`，tab 栏不随内容滚动；长 prompt、JSON、审议 trace 继续各自限高。
- **长文本**：intention rationale、deliberation trace 等长内容保持限高/折叠，不把 event tab 撑成整页。

## 4. 红线

- engine-core 零改动；纯前端布局与图表配置。
- 不把缺失的 BDI 字段补成 0；老 trace 缺失字段仍按“无数据”处理。
- 心理对话原文与 prompt 只在既有调试面板展示，不新增日志/console。
- 提交只含本任务授权的 admin-dashboard 文件与文档，不混入既有未提交产物。

## 5. 闸门

- `pnpm --dir admin-dashboard type-check`：0 error。
- `pnpm --dir admin-dashboard build-only`：构建通过。
- `pnpm lint`：0 error，记录 warning 数。
- `pnpm typecheck`：0 error。
- `git diff --stat HEAD -- src/engine-core`：空。

## 6. 交付

交付记录写到 `docs/worklog/completed/phase2.5/af503-auto-practice-debug-panel-density-2026-11-25.md`，含六组机读字段标记；回执写 `docs/team/agent-orchestration/transport/receipts/AF-503.json`，随后按编排闭环归档。
