---
taskId: AF-457
contextId: phase2.5-orchestration-closed-loop
title: AF-456 交付记录入库补齐（两阶段提交顺序纠偏）
type: documentation
status: backlog
baselineRef: d3e85a47865a6d2f8cdbee95497fd91b3b6e4fcc
dependsOn: []
priorTasks: [AF-456, AF-455]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.2]
createdAt: 2026-11-24T11:05:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - docs/worklog/completed/phase2.5/af456-improvement-intake-2026-11-24.md
    - docs/worklog/completed/phase2.5/af457-commit-order-backfill-2026-11-24.md
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-456/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-457/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af457-commit-order-backfill-2026-11-24.md
    kind: report
gates:
  - command: node scripts/orchestration/cli.mjs worklog verify --strict
    check: 记录包完整
    threshold: exit=0
  - command: git diff --stat HEAD -- src/
    check: 零代码改动
    threshold: exit=0
successCriteria:
  - AF-456 的交付记录与记录包（任务单 / manifest / 冻结回执副本）真实进入版本库。
  - AF-457 交付记录写清本次踩到的提交顺序问题：先 run-once 收口、后提交实现，会触发 preflight「没有处于 ready/submitted/... 的编排任务」而无法提交。
  - node scripts/orchestration/cli.mjs worklog verify --strict 退出码 0。
  - git diff --stat HEAD -- src/ 为空。
---

# AF-457 · AF-456 交付记录入库补齐

## 背景

AF-456 在本地就地执行时，顺序走错了：先把回执冻结、跑 `run-once` 完成 `receipt-ingested` 与 `archive-completed`，之后才尝试提交交付记录。pre-commit 的 `orchestration:preflight` 按两阶段提交口径判定，此时已不存在 `ready/submitted/working/input-required/completed` 的在办任务（AF-456 已归档），于是把 AF-456 的交付记录与记录包判为「越界文件」并阻断提交；显式传 `ORCH_TASK_ID=AF-456` 也只能得到同一条提示。

正确顺序（AF-454 / AF-455 都走的这条）：实现与交付记录提交 → 回执冻结 → `run-once` 收口 → 状态面与冻结回执副本单独提交。

## 范围

- `docs/worklog/completed/phase2.5/af456-improvement-intake-2026-11-24.md`（AF-456 交付记录，已在磁盘、未入库）
- `docs/worklog/completed/phase2.5/af457-commit-order-backfill-2026-11-24.md`（本任务交付记录）
- `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-456/`、`AF-457/`（记录包）

## 验收

1. AF-456 交付记录与记录包入库，内容不改写（只补提交事实）。
2. `worklog verify --strict` exit 0。
3. `git diff HEAD -- src/` 为空。

## 不做

- 不改 AF-456 台账内容（`improvement-log.json` 已由 AF-456 经 CLI 写入，随状态面单独提交）。
- 不重跑 AF-456 的收口动作。
