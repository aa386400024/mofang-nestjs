---
taskId: AF-412
contextId: phase2.5-orchestration-closed-loop
title: BDI 在场误判的系统级影响审计（全会话投影）
type: investigation
status: backlog
baselineRef: 5ed82d71b659b2e7b3ff08e7614c7c5d06ba4297
dependsOn: []
priorTasks: [AF-409]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T04:10:00+08:00
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
    path: docs/worklog/completed/phase2.5/af410-presence-false-positive-impact-2026-11-24.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/af410-presence-false-positive-impact.spec.mjs
    check: 全会话投影纯函数单测全绿
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
successCriteria:
  - 新增只读全会话投影脚本：逐场统计落盘 neutral 轮、A′ 命中轮、当前八维是否零动
  - 给出“若开启 A′，多少场 zero_motion 翻 false、各场 safety/bond 最大累积量、全会话均值”
  - 给出误判率的分母与口径，明确哪些结论可外推、哪些不可
  - 不修改生产分类器、不碰 engine-core、不启用 feature flag
  - lint / typecheck / 定向单测全绿
---

## 背景

AF-408/409 只对 cold 单场做了 14 轮投影，证明 1 轮 holding 就能翻转 `zero_motion`。但“如果 A′ 全量上线，13 场里有多少场会被误翻、整批同盟指标会被抬高多少”没有量化——这正是判断“能不能开开关”的系统级证据缺口。

## 目标

把 A′ 的命中结果投影到全部 13 场、205 个咨询师轮：逐场统计命中 holding 的轮数、当前八维首末是否零动、投影后的 safety/bond 增量与 `zero_motion` 翻转数，给出批次级误判面。

## 范围隔离

只改 `scripts/ops/quality/`、`scripts/orchestration/__tests__/`、交付记录与记录包；不碰 `src/engine-core`、`src/engine-adapters`、生产装配、`.env`、数据库。
