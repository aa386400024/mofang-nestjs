---
taskId: AF-111
contextId: phase2.5-long-session-acceptance
title: long 50 轮候选验收口径与双人盲标工具（不冒充临床硬门）
type: implementation
status: backlog
baselineRef: 90c864e974ef234afe7061fddf914bd789d3f8ea
dependsOn: [AF-109]
priorTasks: [AF-110]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-19T09:30:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/auto-practice/metrics/long-session-acceptance.ts
    - bin/long-session-acceptance.ts
    - test/auto-practice/af111-long-session-acceptance.spec.ts
    - docs/worklog/completed/phase2.5/af111-long-session-acceptance-protocol-2026-11-19.md
    - docs/worklog/pending/phase2.5-README.md
    - docs/worklog/completed/phase2.5/af111-long-session-acceptance-delivery-2026-11-19.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af111-long-session-acceptance-delivery-2026-11-19.md
    kind: report
gates:
  - command: corepack pnpm exec vitest run test/auto-practice/af111-long-session-acceptance.spec.ts
    check: 候选口径与盲标工具单测全绿
    threshold: exitCode=0
  - command: corepack pnpm exec tsc --noEmit -p tsconfig.json
    check: 类型检查 0 error
    threshold: errorCount=0
  - command: corepack pnpm exec eslint src/auto-practice/metrics/long-session-acceptance.ts bin/long-session-acceptance.ts test/auto-practice/af111-long-session-acceptance.spec.ts
    check: lint 0 error / 0 warning
    threshold: errorCount=0,warningCount=0
successCriteria:
  - 提供 long 50 轮候选验收口径，按 engagement/working/closing 三段定义可复核锚点
  - 明确候选状态，不接入任何硬门，不修改 intake 阈值，不把候选口径写成临床达标
  - 提供双人盲标 pack/ingest CLI：匿名化模式与角色，生成评分表，计算逐维一致性（线性加权 kappa、±1 一致率）与仲裁清单
  - 单测覆盖匿名化、分段边界、kappa 零分歧/全一致与仲裁判定
  - tsc/lint/定向 vitest 实跑并记录数字
  - 回写 phase2.5 README 的 ④ 说明，明确仍不可判定
---

## 背景

AF-109 已证明：16 场 long/50 轮真实批次可以跑完、逐字稿清洁度达标，但 `intake-v1/v2` 是首次会谈约 12 轮口径，把全时段 delta 套 12 轮阈值会把长程结盟增长误判为快速理想化。WP-K 对 96 场基线又因 acceptance 判据漂移为 `incomparable`。出口④缺的不是更多批次，而是与 40–50 轮阶段匹配的观察锚点，以及真实督导师双人盲标工具。

## 目标

- 建 **候选** long-session 验收口径：engagement（1–12）、working（13–40）、closing（41–50）；只输出观察与复核锚点，不产生 PASS/FAIL 硬门。
- 建双人盲标工具：匿名化 counselorModeId / characterSlug，生成 packet 与评分表；摄入两位督导师评分，算一致性并列出需仲裁 packet。
- 明确候选状态与升级条件：至少 100–200 轮真实督导师盲标 + 仲裁，κ 达标后，才允许另立任务讨论是否升为硬门。

## 非目标

- 不改 `acceptance-thresholds.ts` 的 intake 阈值；
- 不把候选锚点接入 `batch-report` / CI 硬门；
- 不生成假的督导师评分；
- 不声称临床准确率 80% 已达标。
