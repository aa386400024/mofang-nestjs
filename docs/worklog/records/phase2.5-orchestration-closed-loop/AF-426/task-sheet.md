---
taskId: AF-426
contextId: phase2.5-orchestration-closed-loop
title: 在场 delta 标定台账 v1.0：AF-418/420/421/422 的可复算结论收成单页
type: documentation
status: backlog
baselineRef: 0441514b86326629a27457b26e4c466a9784cc8c
dependsOn: []
priorTasks: [AF-425, AF-418, AF-420, AF-421, AF-422]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T06:14:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - docs/architecture/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af426-presence-calibration-ledger-2026-11-24.md
    kind: report
  - name: 标定台账
    path: docs/architecture/presence-delta-calibration-ledger-v1.0.md
    kind: report
gates:
  - command: node scripts/orchestration/cli.mjs worklog verify --strict
    check: 记录包与索引一致
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
  - command: git diff --stat HEAD -- src/engine-core
    check: engine-core 零改动
    threshold: empty
successCriteria:
  - 新增单页台账 docs/architecture/presence-delta-calibration-ledger-v1.0.md，把 AF-418/420/421/422 的种子值、env 覆写通道、幅度扫描曲线、cap 有效性结论收成一张可复算的表，每个数字标出处任务
  - 台账写明结构事实：规则轨词表刻意不扩，两类在场 kind 只能由模型轨产出，真实批次是否出现取决于模型轨开关
  - 台账单列证据缺口：当前 13 场语料里 cold_absent 仅 1 轮，冷缺席方向无法给临床结论
  - 台账给出后续标定所需的三件事（取样、真人度评分、临床阈值拍板），不写实施步骤之外的代码改动
  - lint / typecheck / strict verify 全绿；engine-core 零 diff
---

## 背景

AF-418 → AF-422 四单在同一议题上连续推进：在场投影同源校准 → env 覆写通道 → 幅度扫描 → cap 感知重放。四份交付记录各自完整，但结论分散在四份文档里，后续做临床标定时要翻四次。

## 目标

单页台账：种子值 / 覆写键 / 幅度曲线 / cap 有效性 / 结构事实 / 证据缺口，每个数字带出处。

## 范围隔离

纯文档，只写 `docs/`。`src/engine-adapters/deliberation/deliberation-types.ts` 的过期注释属 orchestrator 资源域外，不在本单范围内，登记为 backlog。
