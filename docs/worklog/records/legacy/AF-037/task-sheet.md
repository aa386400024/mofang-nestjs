---
taskId: AF-037
contextId: phase2.5-orchestration-closed-loop
title: 复核 AF-036 交付范围与回执一致性
type: verification
status: backlog
baselineRef: 306870288568ef12bf0c2218cd3f748d5c651bd6
dependsOn: [AF-036]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs:
  - conventions.md#1.3
  - conventions.md#1.4
createdAt: 2026-11-17T03:24:00.000Z
deadline: null
agentRole: orchestrator
scope:
  files:
    - docs/worklog/pending/
    - docs/worklog/completed/
  modules: []
  interfaces: []
artifacts:
  - name: 范围复核记录
    path: docs/worklog/completed/phase2.5/af037-scope-recheck-2026-11-17.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排单测仍全绿
    threshold: 'failed=0'
successCriteria:
  - 确认 AF-036 实际改动文件与 scope 一致（README.md 未被本单改动）
  - 单测与事件链复跑一致，AF-036 的代码改动确实在库
evidenceFormat: git diff --stat 文件名清单 + 单测用例数
---

# AF-037 任务单（复核 AF-036 交付范围与回执一致性）

## 1. 背景

AF-036 被机读护栏判 `rejected`：回执 `changedFiles.modified` 里出现 `docs/team/agent-orchestration/README.md`，而该文件不在 AF-036 scope 内，且 AF-036 并未改动它——是回执照抄上一单清单造成的**虚报**。

终态不得改写，因此另开本单复核：确认代码改动真实在库、清单与 scope 一致、闸门可复现。

## 2. 复核口径

- `git diff --stat` 只认实际改动；
- 回执清单必须逐条对得上实际 diff；
- 单测与事件链复跑；

## 3. 状态

✅ 已完成，见 `docs/worklog/completed/phase2.5/af037-scope-recheck-2026-11-17.md`。
