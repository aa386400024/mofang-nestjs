---
taskId: AF-098
contextId: phase2.5-exit4-proxy-quality
title: 验收器状态面豁免修复：improvement-log 不再判越域
type: fix
status: backlog
baselineRef: c58be14c2cec46330f59cb787b08b97d0d8e58ca
dependsOn: [AF-097]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-18T19:50:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/
    - docs/team/agent-orchestration/
    - docs/worklog/
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
  - command: node scripts/orchestration/cli.mjs events verify
    check: 事件链一致
    threshold: exit=0
successCriteria:
  - improvement-log.json 被纳入 STATE_PLANE_ARTIFACTS，V7 不再把 CLI 自动写入判成任务越域
  - 回归单测覆盖 improvement-log、全部已声明状态面与普通交付文件三种判定
  - 不改普通交付文件的 scope 判定，不扩大豁免到 src/test/docs 交付面
  - 交付记录说明 AF-095 首轮 rejected 的根因与修复证据
  - engine-core 零 diff
---
# AF-098 验收器状态面豁免修复

## 背景

AF-095 首轮 `run-once` 被 rejected，机读结论是：

`scope 外提交文件（已按 commit 事实比对）：docs/team/agent-orchestration/improvement-log.json`

该文件由 CLI 每轮 `improvements` / 归档流程自动重写，属于编排状态面，却不在
`STATE_PLANE_ARTIFACTS` 列表中，导致合规任务永久 rejected。

## 目标

1. 将 `docs/team/agent-orchestration/improvement-log.json` 加入 `STATE_PLANE_ARTIFACTS`。
2. 新增回归单测，锁死状态面与普通交付面的边界。
3. 交付记录写明根因、修复、验证与影响面。
4. 不扩大到 `src/`、`test/`、`docs/worklog/` 的普通交付文件。

## 验收

- `vitest run scripts/orchestration/__tests__/acceptance-state-plane.spec.mjs` 全绿。
- `vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` 无回归。
- `events verify` PASS。
- `git diff --stat c58be14 -- src/engine-core` 为空。
