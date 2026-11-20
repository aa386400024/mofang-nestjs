---
taskId: AF-101
contextId: phase2.5-exit4-proxy-quality
title: 验收器状态面豁免修复：improvement-log 不再判越域
type: fix
status: backlog
baselineRef: 6873f0692b116fc2ae7ccc73ed07b8cb49a5175d
dependsOn: [AF-100]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-18T20:10:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/
    - docs/team/agent-orchestration/
    - docs/worklog/pending/
    - docs/worklog/completed/
    - web/orchestration/
  modules:
    - orchestration-acceptance
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af098-state-plane-acceptance-fix-2026-11-18.md
    kind: report
  - name: 回归单测
    path: scripts/orchestration/__tests__/acceptance-state-plane.spec.mjs
    kind: report
gates:
  - command: corepack pnpm exec vitest run scripts/orchestration/__tests__/acceptance-state-plane.spec.mjs
    check: 状态面豁免回归单测全绿
    threshold: failed=0
  - command: corepack pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排既有单测无回归
    threshold: failed=0
successCriteria:
  - improvement-log.json 纳入 STATE_PLANE_ARTIFACTS
  - 回归单测覆盖状态面与普通交付文件边界
  - 不扩大豁免到 src/test/docs 普通交付面
  - 提交树保留 AF-101 submitted，满足逐提交门
  - engine-core 零 diff
---
# AF-101 验收器状态面豁免修复

## 背景

AF-095 首轮 rejected 的直接根因是 `improvement-log.json` 不在 `STATE_PLANE_ARTIFACTS`。
AF-100 已把质量证据线性化；本单只修验收器并补齐回归证据。

## 验收

- 新单测 3/3 passed。
- 既有编排单测 251/251 passed。
- `events verify` PASS。
- `src/engine-core` 零 diff。
