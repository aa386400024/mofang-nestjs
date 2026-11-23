---
taskId: AF-408
contextId: phase2.5-orchestration-closed-loop
title: BDI 影子审计 v2 口径对齐与在场信号离线校准
type: fix
status: backlog
baselineRef: 2dbedce2bcb0a871577b50541e2feeda9f6a575b
dependsOn: []
priorTasks: [AF-322, AF-323, AF-405]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T03:35:00+08:00
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
    path: docs/worklog/completed/phase2.5/af408-bdi-presence-calibration-2026-11-24.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/af408-presence-calibration.spec.mjs
    check: 在场校准纯函数单测全绿
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
successCriteria:
  - 影子审计规则轨默认与生产一致使用 v2，不再默认 legacy
  - 新增只读在场校准脚本，只输出计数/比率，不输出逐字稿原文
  - 报告给出 203 轮上的 neutral 降幅、误判样例与 14 轮投影
  - 不修改 src/engine-core、不启用任何生产 feature flag
  - lint / typecheck / 定向单测全绿
---

## 背景

AF-322 已给内核补上 `holding_present` / `cold_absent` 的小幅 delta，但规则轨按设计不产出这两个跨轮标签，模型轨默认未启用。结果 cold 场 14 轮全 `neutral`，八维冻结，`zero_motion` 无法区分“真缺席”与“规则词表盲区”。

同时 `scripts/ops/quality/af322-classifier-shadow-audit.ts` 的规则轨仍用默认 legacy，与生产 `semantics:'v2'` 不一致，影子审计会报偏高命中率。

## 目标

1. 影子审计脚本默认切到 v2，保留 `--legacy` 仅用于历史复现。
2. 新增只读在场校准脚本：在 13 份本地调试逐字稿上，测“疑问结构 → holding_present”的覆盖率、neutral 降幅与误判风险；只输出计数、比率、合成示例。
3. 用现有 delta 做 14 轮投影，验证该信号不会抬高 trust。
4. 产出报告，明确是否值得进入适配层 feature flag；本单不改生产行为。

## 范围隔离

只改 `scripts/ops/quality/`、`scripts/orchestration/__tests__/`、交付记录与记录包；不碰 `src/engine-core`、`src/engine-adapters`、前端、数据库、`.env`。
