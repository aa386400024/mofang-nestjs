---
taskId: AF-501
contextId: phase2.5-admin-dashboard-alignment
title: 修复 auto-practice 调试面板并补齐 admin-dashboard 新 trace 能力
type: fix
status: backlog
baselineRef: b2834b3ede8d0b90a5a1191d0856820cad974e9c
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.2, conventions.md#1.3]
createdAt: 2026-11-25T09:45:00+08:00
deadline: null
agentRole: orchestrator
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
    path: docs/worklog/completed/phase2.5/af501-admin-dashboard-auto-practice-alignment-2026-11-25.md
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
  - 点击某一轮气泡“查看这轮的调试数据”后，右侧调试面板的当前轮、BDI 快照、原始 JSON、原始输出均锁定该轮，不再显示最后轮；新轮次到达不覆盖用户手动选中的旧轮，并提供“回到最新”。
  - 原始 JSON 与导出 JSON 的浮点数按统一精度展示，不再出现 0.6895000000000001 这类长尾；复制/导出与面板使用同一口径。
  - 左侧场次卡片压缩为角色/状态/轮数/模式/场景等核心信息，对练时间、时长、成本、来访/咨询模型移入当前会话信息栏；状态值完成中文化。
  - BDI 状态 tab 用适配正负语义的图表：0~1 维度用多维雷达/趋势，valence 使用双极刻度，不把 valence 归一化进 0~1 雷达。
  - 补齐前端对后端已有 trace 字段的消费：promptFull、cachedTokens、transference、coreBeliefActivation、resistance 三维、delta、intention；修正 PracticeSession.status 等过期类型。
  - 不修改 src/engine-core；admin-dashboard type-check/build 通过。
---

# AF-501 · 修复 auto-practice 调试面板并补齐 admin-dashboard 新 trace 能力（修复）

> 状态：📋 待执行（2026-11-25）
> 执行方：自做
> 仓库：D:\work\Project\backend\mofang-nestjs-af281r，分支 integrate
> 唯一事实源：admin-dashboard/src/views/AutoPractice.vue、admin-dashboard/src/components/DebugTracePanel.vue、src/admin-debug/debug-session.service.ts（DebugTurnTrace 契约）
> 任务性质：bug 修复 + 前端能力对齐
> 改动范围：仅 admin-dashboard 前端 + 交付文档；后端契约只读，不改 engine-core

## 1. 背景

admin-dashboard 的核心页面已能跑 auto-practice，但调试面板仍按“最后轮”口径组织数据，且没有消费后端近期补齐的 trace 字段。用户实测点击历史轮次的气泡后，右侧 BDI 当前快照与原始 JSON 仍停在最后轮；左栏场次卡片把时间、成本、模型等信息全部堆在 256px 宽度里，会话信息栏反而只有角色和模式；BDI 只画 trust/safety/bond 三条线，valence 的正负语义被归一化进度条抹平；原始 JSON 直接输出 IEEE 浮点尾数。另有一批后端已有、前端类型/UI 未对齐的字段（promptFull、cachedTokens、transference、coreBeliefActivation 等）。

## 2. 范围

**在范围内：**

- `admin-dashboard/src/views/AutoPractice.vue`：选中轮语义、会话信息栏、场次卡片信息分层、状态中文化、导出 JSON 精度。
- `admin-dashboard/src/components/DebugTracePanel.vue`：按 turnIndex 取快照、BDI 图表、原始输出、JSON 精度、promptFull/cachedTokens/额外 trace 字段展示。
- `admin-dashboard/src/api/types.ts`：与后端 `DebugTurnTrace` / `PracticeSession` 对齐类型。
- `admin-dashboard/src/api/client.ts`：仅在已有接口签名需要参数时补齐，不扩展后端。
- 必要的纯前端格式化/图表小组件（如新增 `admin-dashboard/src/utils/trace-format.ts`）。
- 本任务交付记录与任务记录。

**明确不在范围内（禁止顺手做）：**

- 不修改 `src/engine-core/` 任何文件；`git diff --stat HEAD -- src/engine-core` 必须为空。
- 不修改后端 trace 契约、数据库结构、migration、prompt、模型名。
- 不修改 Flutter 客户端。
- 不清理仓库里既有的未提交文档/并行产物；提交时只暂存本任务文件。
- 不在本任务里处理“历史摘要中的 `<think>` 污染”和“成本看板缓存命中聚合”这两个需要后端/数据侧处置的问题；在交付记录中登记为遗留。

## 3. 目标实现

- **单一选中轮状态**：`selectedTurnIndex` 由气泡/图表点击设置；`DebugTracePanel` 以该轮 `trace` 与 `bdiHistory` 同轮数据渲染；默认跟随最新，手动选中后不被新轮覆盖；提供“回到最新”。
- **信息分层**：左侧卡片只保留角色、状态、轮数、模式、场景/危机结论；会话信息栏展示对练时间、时长、成本、来访/执行模型、状态/结束原因。历史场次不在当前分页时，用当前选中 `PracticeSession` 兜底。
- **BDI 图表**：0~1 维度（trust/safety/bond/arousal/阻抗话量）用 ECharts radar；阻抗深度/风格用三横条；valence 用 -1~+1 双极刻度；历史趋势用折线，选中轮画标记线。复用已有 echarts / vue-echarts 依赖。
- **精度统一**：面板卡片 2 位、trace/JSON 4 位、成本 4 位、毫秒整数；`-0` 归一为 `0`；JSON 与导出共用 formatter。
- **契约对齐**：类型补 `renderSpec.promptFull`、`llmUsage.cachedTokens`、`promptTokens: number | null`、`bdiSnapshot.transference/coreBeliefActivation`、`BdiSnapshotPoint.resistance`、`PracticeSession.status` 全量枚举；UI 展示对应字段。
- **原始输出**：默认只展示选中轮 visitor 消息，另给“显示全部轮次”开关；prompt 全文与 preview 分开，全文可折叠/复制。

## 4. 红线

- engine-core 零改动；纯 UI/类型/格式化逻辑放前端。
- 心理对话原文只出现在既有调试面板和 prompt 查看区，不新增日志/console。
- 不把缺失的 safety/bond 补成 0；老 trace 缺失字段按“无数据”处理。
- 提交只含本任务授权的 admin-dashboard 文件与文档，不混入既有未提交产物。

## 5. 闸门

- `pnpm --dir admin-dashboard type-check`：0 error（记录既有类型债基线，如存在）。
- `pnpm --dir admin-dashboard build-only`：构建通过。
- `pnpm lint`：0 error，记录 warning 数。
- `pnpm typecheck`：0 error。
- `git diff --stat HEAD -- src/engine-core`：空。

## 6. 交付

交付记录写到 `docs/worklog/completed/phase2.5/af501-admin-dashboard-auto-practice-alignment-2026-11-25.md`，含六组机读字段标记；回执写 `docs/team/agent-orchestration/transport/receipts/AF-501.json`，随后按编排闭环归档。
