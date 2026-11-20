---
taskId: AF-097
contextId: phase2.5-exit4-proxy-quality
title: AF-095 返修：质量锚定审计与长会话证据重新交付
type: implementation
status: backlog
baselineRef: 6a52d7e62795bc427408d0cc7c6eb415b03363c5
dependsOn: [AF-091, AF-093]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-18T19:44:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/
    - test/
    - docs/worklog/pending/
    - docs/worklog/completed/
  modules:
    - auto-practice-metrics
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af095-anchor-calibrated-quality-audit-2026-11-18.md
    kind: report
  - name: 校准与审计证据
    path: docs/worklog/completed/phase2.5/af095-counselor-quality-evidence-2026-11-18.json
    kind: report
gates:
  - command: corepack pnpm exec tsc --noEmit -p tsconfig.json
    check: 类型检查全绿
    threshold: error=0
  - command: corepack pnpm exec vitest run test/auto-practice/counselor-quality.spec.ts
    check: 审计器单测全绿
    threshold: failed=0
  - command: node scripts/orchestration/cli.mjs events verify
    check: 事件链一致
    threshold: exit=0
successCriteria:
  - 以 496 轮真人质量标签为唯一锚点，交付可复算的咨询师行为审计器
  - 给出每个信号的 AUC 与阈值精确率/召回率，明确标注可作分诊、不可冒充六维临床验收
  - 用真实逐字稿跑出批次级审计，证据 JSON 不含对话原文
  - 长会话批次按 sessionProfile=long 实际运行并记录轮数、结束态与空输出缺陷
  - 交付记录含六组机读字段标记，出口④仍判未达标 / 部分可判
  - engine-core 零 diff
---
# AF-097 AF-095 返修：质量锚定审计与长会话证据重新交付

## 背景

AF-095 首次交付被验收拒绝，一部分原因是交付记录缺六组机读标记；另一部分
`improvement-log.json` 状态面豁免缺失由 AF-098 单独修复。本单只负责执行侧交付面：
把质量审计代码、单测、两份证据 JSON 与 README 回写在干净分支上重新提交。

## 目标

1. 保留 `counselor-quality` 模块、CLI、9 例单测与两份证据 JSON。
2. 交付记录补齐六组机读标记。
3. README §3.2 维持「未达标 / 部分可判」，记录 36.3% 空输出与角色缺失。
4. 不重跑 96 场批次，不新跑 long 批次。

## 非目标

- 不改验收器与编排状态面（归 AF-098）。
- 不伪造督导师六维标注，不把合成分数当验收。
- 不改 `engine-core` 与案例原文。

## 验收

- `tsc --noEmit` exit 0。
- `vitest run test/auto-practice/counselor-quality.spec.ts` 9/9 passed。
- `events verify` PASS。
- 交付记录六组标记齐全。
- `git diff --stat 6a52d7e -- src/engine-core` 为空。
