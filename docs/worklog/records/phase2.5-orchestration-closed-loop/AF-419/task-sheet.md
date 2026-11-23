---
taskId: AF-419
contextId: phase2.5-orchestration-closed-loop
title: 在场 delta 可调性收口：补齐 holding_present / cold_absent 的 env 覆写键与注释漂移
type: implementation
status: backlog
baselineRef: 81f3730734f28cff86b073107aa7b7a82cf589c0
dependsOn: []
priorTasks: [AF-322, AF-408, AF-418]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T04:45:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/engine-adapters/wiring/delta-table.config.ts
    - src/engine-adapters/cognition/model-event-mapping.ts
    - src/engine-adapters/cognition/model-event-classifier.ts
    - test/engine-adapters/wp60-delta-table-config.spec.ts
    - .env.example
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af419-presence-delta-env-override-2026-11-24.md
    kind: report
gates:
  - command: pnpm exec vitest run test/engine-adapters/wp60-delta-table-config.spec.ts
    check: 覆写解析与优先级断言全绿
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
  - command: pnpm test
    check: 全量测试全绿，含 wp25-env-example-coverage
    threshold: exit=0
  - command: git diff --stat HEAD -- src/engine-core
    check: engine-core 零改动
    threshold: empty
successCriteria:
  - DeltaTableConfig 装配新增 ENGINE_DELTA_HOLDING_PRESENT / ENGINE_DELTA_COLD_ABSENT 两键，逐键字面量读取，非法 JSON / 非法维度 / 非有限数按既有口径丢弃并告警
  - .env.example 补两键（留空即可，注释写明内核种子幅度与「工程种子值非临床标定」）
  - 修正 model-event-mapping / model-event-classifier 中「两类在场 kind 的 DELTA_TABLE 种子仍是 ZERO」的过期注释，改为指向内核 AF-322 种子值
  - 覆写优先级仍为 ENGINE_DELTA_* > ENGINE_ALLIANCE_* > 内核基础系数，且不影响其余 11 个事件键
  - lint / typecheck / 定向单测 / 全量测试全绿；engine-core 零 diff
---

## 背景

在核 `DELTA_TABLE` 里 `holding_present` / `cold_absent` 自 AF-322 起已有非零工程种子幅度（safety +0.004 / bond +0.002 / verbal -0.002 等），但适配层 `resolveDeltaTableConfig` 只装配了 11 个行为事件的 `ENGINE_DELTA_*` 键，**两类在场事件没有任何 env 覆写通道** —— 想按标定批次调整「稳定陪伴」与「机械敷衍」的幅度，必须改代码发版。

同时 `model-event-mapping.ts` 与 `model-event-classifier.ts` 仍留着 D-2 阶段的注释：声称两类在场 kind 的 delta 种子是 ZERO。这句话在 AF-322 之后已不成立，是文档漂移，会让后来者以为通路是空壳。

## 目标

1. `resolveDeltaTableConfig` 增加两键解析，与既有键同一套 `parseEventOverride` 校验（非法即丢弃 + 告警）。
2. `.env.example` 补两键，注释写明种子幅度、留空走内核种子、幅度非临床标定。
3. 修正两处过期注释，明确「幅度已由内核种子给到，env 覆写只做标定批次调整」。
4. 单测覆盖：两键正常解析、非法维度丢弃、非法 JSON 丢弃、空字符串不产生条目、覆写命中后优先级高于内核种子。

## 范围隔离

只动适配层装配与注释、单测、`.env.example`、交付记录；不碰 `src/engine-core`，不改内核种子值本身，不改分类器判定逻辑与 prompt 文案。
