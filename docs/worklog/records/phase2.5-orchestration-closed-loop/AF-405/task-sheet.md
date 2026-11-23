---
taskId: AF-405
contextId: phase2.5-orchestration-closed-loop
title: zero_motion 归因口径拆分（flat / net-zero / untagged 可诊断）
type: implementation
status: backlog
baselineRef: eb051e3c06914cb91cd938713dcdf301f906eac9
dependsOn: []
priorTasks: [AF-404]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T02:56:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/auto-practice/metrics/
    - test/auto-practice/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
    - docs/worklog/pending/archive/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af405-zero-motion-attribution-2026-11-24.md
    kind: report
gates:
  - command: pnpm exec vitest run test/auto-practice/wp-k-batch-compute.spec.ts
    check: 批次指标单测全绿，含 flat / net-zero / untagged 断言
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
successCriteria:
  - ZeroMotionBreakdown 增量输出 flat / netZero / untagged 三个诊断计数，旧字段 total / closure / idle 语义不变
  - ZeroMotionSessionDetail 增量输出 isFlat / maxExcursion / dimensionFirstLast / eventTagPositions，全部为合规数值投影
  - schema 守卫接受新增字段，缺省时旧快照仍可读
  - 单测覆盖真冻结、净零回原值、全程无标签、有非 neutral 四类场次
  - 交付记录写明口径边界：idle 仍按原定义计数，三桶只作诊断，不改变阈值分子
---

## 背景

AF-404 已把 `zero_motion` 从三个计数扩到逐场明细，但归因口径仍把三种不同的“没动”压在同一桶：真冻结（每轮快照都等于首轮）、净零（中途动过又回原值）、无标签（`eventTags` 从未落盘）。MiniMax Code 的只读 BDI 审计（`docs/worklog/pending/relay-response-BDI-20261124-0230.md`）指出这会让缺失提取被静默计入失效、让净零场次被误判为 idle，并且无法判断“冻在哪个值、动作发生在第几轮”。

## 目标

在**不改变** `total / closure / idle` 既有语义与阈值分子的前提下，增量输出诊断字段，让下一批 `zero_motion` 场次能直接区分真冻结、净零、无标签，并看到八维首末与最大偏移、非 neutral 标签出现位置。

## 范围隔离

只改 `src/auto-practice/metrics/` 与对应测试、交付记录；不碰 `src/engine-core`、`src/voice`、前端、数据库 migration。
