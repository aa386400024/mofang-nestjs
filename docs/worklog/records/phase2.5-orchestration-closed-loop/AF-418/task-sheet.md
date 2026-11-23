---
taskId: AF-418
contextId: phase2.5-orchestration-closed-loop
title: BDI 在场投影同源校准：delta 表一致性断言与逐轮重放
type: implementation
status: backlog
baselineRef: 34220dcca35d03897750a82abb22a326cf4e490c
dependsOn: []
priorTasks: [AF-408, AF-409, AF-412]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T04:45:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/ops/quality/
    - scripts/orchestration/__tests__/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af418-presence-replay-calibration-2026-11-24.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/af418-presence-replay-calibration.spec.mjs
    check: 投影/重放/一致性断言单测全绿
    threshold: exit=0
  - command: node scripts/ops/quality/af418-presence-replay-calibration.mjs --dir data/debug-sessions
    check: 只读跑通，输出不含对话原文
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
  - command: pnpm test
    check: 全量测试全绿，记录真实数字
    threshold: exit=0
  - command: git diff --stat HEAD -- src/engine-core
    check: engine-core 零改动
    threshold: empty
successCriteria:
  - 断言 scripts 侧 PRESENCE_DELTAS 与内核 aggregateTurnDelta 对 holding_present / cold_absent 的输出逐字段相等，漂移即红
  - 提供逐轮重放：用真实 trace 快照差 + A′ 标签逐轮叠加并夹取，输出与 AF-412 末轮单次加法的差值
  - 提供逐场与批次差值：safety / bond 总增量、差值绝对值、受影响场次、饱和导致的回退
  - 只读 data/debug-sessions，不打印对话原文，不写仓库数据文件
  - lint / typecheck / 定向单测 / 全量测试全绿；engine-core 零 diff
---

## 背景

AF-412 的在场误判投影是「末轮快照 + Σdelta」的单次加法，而真实内核是逐轮 `transitionState`（含 clamp / cap / 人格调节）。MiniMax Code 评审指出：本量级下数值接近，但口径不同源，不能把 AF-412 的数字直接当内核结论；同时 `af408-presence-calibration.mjs` 里的 `PRESENCE_DELTAS` 是内核 delta 表的第三份手抄拷贝，没有任何一致性断言。

## 目标

1. 在单测里用内核公开导出 `aggregateTurnDelta` 对 `PRESENCE_DELTAS` 逐字段断言，把「手抄拷贝」变成「自动校验的镜像」。
2. 新增只读脚本 `af418-presence-replay-calibration.mjs`：
   - 从 trace 相邻快照差还原每轮真实位移；
   - 按 A′ 标签逐轮叠加 presence delta 并夹取到 [0,1]；
   - 与 AF-412 的「末轮单次加法」对比，输出批次与逐场差值；
   - 明确报告饱和（中间触顶后回落）造成的非线性差异。
3. 不修改 AF-408/409/412 既有行为，不碰 engine-core，不碰生产分类器与 prompt。

## 范围隔离

只新增脚本、单测、交付记录、记录包；只读 `data/debug-sessions`，不写数据文件，不输出任何对话原文。
