---
taskId: AF-425
contextId: phase2.5-orchestration-closed-loop
title: 在场 delta 标定台账 v1.0：把 AF-418/420/421/422 的可复算结论收成单页，并修掉第三处过期注释
type: documentation
status: backlog
baselineRef: 0441514b86326629a27457b26e4c466a9784cc8c
dependsOn: []
priorTasks: [AF-418, AF-420, AF-421, AF-422]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T05:58:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - src/engine-adapters/deliberation/
    - docs/architecture/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af425-presence-calibration-ledger-2026-11-24.md
    kind: report
  - name: 标定台账
    path: docs/architecture/presence-delta-calibration-ledger-v1.0.md
    kind: report
gates:
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
  - 新增单页台账 docs/architecture/presence-delta-calibration-ledger-v1.0.md，把 AF-418/420/421/422 的种子值、env 覆写通道、幅度扫描曲线、cap 有效性结论收成一张可复算的表，并标注每个数字的出处任务
  - 台账明确写出结构事实：规则轨词表刻意不扩，两类在场 kind 只能由模型轨产出；因此真实批次能否出现这两类事件取决于模型轨是否开启
  - 台账单列「冷缺席样本不足」这一证据缺口（当前语料 cold 仅 1 轮），给出后续取样要求
  - 修掉 src/engine-adapters/deliberation/deliberation-types.ts 中「两类 delta 种子是 ZERO」的过期注释（AF-322 起已有非零种子），结论（不纳入规则对齐组）不变
  - lint / typecheck / 全量测试全绿；engine-core 零 diff
---

## 背景

AF-418 → AF-422 四单在同一议题上连续推进：在场投影同源校准 → env 覆写通道 → 幅度扫描 → cap 感知重放。四份交付记录各自完整，但结论分散；`deliberation-types.ts` 还留着第三处「种子是 ZERO」的过期注释（前两处已在 AF-420 修掉）。

## 目标

1. 单页台账：种子值 / 覆写键 / 幅度曲线 / cap 有效性 / 结构事实 / 证据缺口，每个数字带出处。
2. 修掉过期注释，不改任何判定语义与代码行为。
