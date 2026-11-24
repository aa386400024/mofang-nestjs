---
taskId: AF-482
contextId: phase2.5-orchestration-closed-loop
title: 修复 AF-427 台账测试对本地语料漂移的脆弱断言
type: fix
status: backlog
baselineRef: 221475aab79d9e2c06aa1a9844bf4402c879018d
dependsOn: [AF-478]
priorTasks: [AF-478, AF-479, AF-480]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.2, conventions.md#1.3]
createdAt: 2026-11-25T01:38:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/__tests__/af427-operator-delta-ledger.spec.mjs
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-482/
  modules:
    - orchestration-worklog-test
  interfaces:
    - af427-ledger-render
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af482-af427-corpus-debt-2026-11-25.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/af427-operator-delta-ledger.spec.mjs
    check: AF-427 台账测试在本机真实语料下全绿
    threshold: 0 failed
  - command: pnpm test
    check: 含 data/debug-sessions 全量测试全绿
    threshold: 0 failed
  - command: pnpm lint
    check: lint 通过
    threshold: 0 error
successCriteria:
  - 测试不再硬编码 empathy 34/31/897，改为从 data/debug-sessions 动态解析会话数、轮次、单算子/多算子轮与 8 维幅度和。
  - 断言三张表标题、empathy 行存在、行内计数与解析一致、百分比分母自洽；语料缺失显式 skip。
  - 保留原测试意图：仍校验表一/表二/表三关键结构与 empathy 覆盖行，不放宽为只检查标题。
  - 本机含真实语料执行 pnpm test 全绿，无需临时移走 data/debug-sessions。
  - 不改台账渲染口径、不改 src/engine-core、不把台词原文写入仓库。
---

## 1. 背景

`scripts/orchestration/__tests__/af427-operator-delta-ledger.spec.mjs` 把 `empathy 34/31/897` 写死。本地 `data/debug-sessions` 语料增长到 74 场 / 1711 轮后，表三实际是 `empathy 137/134/3`，测试必失败。结果每次 push 前都要临时移走语料目录，形成流程噪声，也掩盖真实回归。

## 2. 目标

让测试跟随本地语料规模，而不是要求语料迁就测试；语料缺失时显式 skip，存在时必须校验真实行。

## 3. 实现口径

- 复用现有台账渲染/解析逻辑读取 `data/debug-sessions`，统计真实会话与轮次。
- 从渲染出的 markdown 中解析 empathy 行的「命中轮次 / 单算子轮 / 多算子同轮 / 幅度和 / 实测比」，与独立统计结果比对。
- 断言表一/表二/表三标题与 empathy 行存在；断言表三计数等于解析值、单算子+多算子等于命中轮次、百分比与幅度和分母自洽。
- 语料目录不存在或为空时 `it.skipIf`；打印跳过原因，不静默通过。

## 4. 非目标

- 不改台账算子系数、cap 规则或渲染格式。
- 不改 `src/engine-core`；不修缓存接线（AF-481）。
