---
taskId: AF-409
contextId: phase2.5-orchestration-closed-loop
title: BDI 在场信号收窄版 A′/B′/C′ 离线验证
type: investigation
status: backlog
baselineRef: c7673951c3d2e40a8f91d63f818df83bbfa2171d
dependsOn: []
priorTasks: [AF-408]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T04:00:00+08:00
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
    path: docs/worklog/completed/phase2.5/af409-presence-narrowing-2026-11-24.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/af409-presence-narrowing.spec.mjs
    check: 收窄版纯函数单测全绿
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
successCriteria:
  - 新增 A′/B′/C′ 收窄版纯函数与只读校准脚本
  - 在 157 轮落盘 neutral 池上给出命中数、剩余 neutral、cold 场投影
  - 明确回答“是否达到 50% 降幅”和“是否仍过宽”
  - 不修改生产分类器、不碰 engine-core、不启用 feature flag
  - lint / typecheck / 定向单测全绿
---

## 背景

AF-408 证明原候选 A/B/C/D 不可原样上线：A 只覆盖 16/157 neutral，AS 覆盖 135/157，B/C 各 1 轮。MiniMax 建议收窄版：A′ 用结构化/内容承载替代绝对字数；B′ 拆最小应答；C′ 纯短句；加对峙守卫。

## 目标

把 A′/B′/C′ 落成只读纯函数，在 157 轮落盘 neutral 池与 cold 14 轮上量化命中率、neutral 降幅、trust 投影与误判样例，判断是否达到 50% 降幅、是否仍过宽。

## 范围隔离

只改 `scripts/ops/quality/`、`scripts/orchestration/__tests__/`、交付记录与记录包；不碰 `src/engine-core`、`src/engine-adapters`、生产装配、`.env`。
