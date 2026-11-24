---
taskId: AF-485
contextId: phase2.5-orchestration-closed-loop
title: AF-478 回执 scope 对齐与提交自洽修复
type: fix
status: backlog
baselineRef: 221475aab79d9e2c06aa1a9844bf4402c879018d
dependsOn: [AF-478, AF-481, AF-482]
priorTasks: [AF-478, AF-481, AF-482]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.2, conventions.md#1.3]
createdAt: 2026-11-25T07:50:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/voice/
    - docs/worklog/records/phase2.5-visitor-register-eval/AF-478/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-485/
    - docs/worklog/completed/phase2.5/
  modules:
    - voice
    - orchestration-receipt
  interfaces:
    - durable-receipt
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af485-af478-receipt-scope-and-self-consistency-2026-11-25.md
    kind: report
gates:
  - command: pnpm lint
    check: lint 0 error
    threshold: 0
  - command: pnpm typecheck
    check: typecheck 0 error
    threshold: 0
successCriteria:
  - AF-478 提交 221475aa 单独检出时可 lint/typecheck 通过，不再依赖 AF-481 的 LlmUsage 补丁。
  - 保留 RC-AF-478-1 冻结证据，新增 RC-AF-478-2 按 221475aa 的 22 个文件判定 in-scope。
  - 六个 wiring/observability/agent-llm 文件不进入 AF-478 提交，由 AF-481 承接。
---

## 1. 背景

AF-478 的实现与 AF-481 的接线在同一工作树完成，提交被拆开。AF-478 的 `voice.service.ts` 在 `buildLlmDoneUsage` 里读取 `cachedTokens`，但该字段的 `LlmUsage` 声明在 AF-481 的提交里。结果 AF-478 分支单独检出时 `pnpm lint` 报 `no-unsafe-assignment`，PR 无法作为独立提交通过闸门。

同时 `RC-AF-478-1` 把 `scopeCheck` 记为 `deviated`，是因为实现阶段曾触及六处接线文件；但最终提交 221475aa 只有 22 个文件，全部在 AF-478 任务单 scope 内，六处接线文件没有进入该提交。

## 2. 目标

- 让 AF-478 提交自洽：在 `voice.service.ts` 内用 `LlmUsage & { cachedTokens?: number }` 承接缓存字段，不依赖 AF-481 的类型补丁。
- 保留 RC-1，新增 RC-2 只修正“提交本身”的 scope 判定。

## 3. 口径

- 不修改 `src/agent/llm/llm.types.ts`，不重复 AF-481 的改动。
- RC-1 文件与冻结哈希不动；RC-2 保留 B1/B2 accepted，B3 标记 closed（AF-482 已修）。
