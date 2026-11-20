---
taskId: AF-038
contextId: phase2.5-orchestration-closed-loop
title: 复核 AF-036 交付范围与多任务同树归因
type: verification
status: backlog
baselineRef: 306870288568ef12bf0c2218cd3f748d5c651bd6
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs:
  - conventions.md#1.3
  - conventions.md#1.4
createdAt: 2026-11-17T03:26:00.000Z
deadline: null
agentRole: orchestrator
scope:
  files:
    - docs/worklog/pending/
    - docs/worklog/completed/
  modules: []
  interfaces: []
artifacts:
  - name: 范围与归因复核记录
    path: docs/worklog/completed/phase2.5/af038-scope-attribution-recheck-2026-11-17.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排单测仍全绿
    threshold: 'failed=0'
successCriteria:
  - 逐条核对 AF-036 回执清单与 git diff，给出每个文件的归属任务
  - 确认 AF-036 的代码改动真实在库且单测复跑一致
  - 明确「多任务同一未提交工作树」下的回执归因口径，登记依赖指向终态任务的可改进点
evidenceFormat: git diff --stat 文件清单 + 单测用例数 + 归属判断
---

# AF-038 任务单（复核 AF-036 交付范围与多任务同树归因）

## 1. 背景

AF-036 被机读护栏判 `rejected`，理由：`changedFiles.modified` 出现 `docs/team/agent-orchestration/README.md`，不在 AF-036 scope 内。

复核发现这不是「代码错了」，而是**归因口径**问题：README 的改动属于 AF-034（其 scope 含 `docs/team/agent-orchestration/`），AF-036 的回执照抄上一单清单，把没碰过的文件写进了本单。同一未提交工作树里堆着多单改动时，验收只按本单 scope 比对，于是越界。

## 2. 复核内容

1. `git diff --stat` 逐文件归属到具体任务；
2. AF-036 的 scheduler 改动是否真实在库、单测是否仍 169 passed；
3. 回执书写口径：只列本单实际改动的文件；
4. 登记可改进点：`dependsOn` 指向 `rejected` 任务时无法提级（AF-037 因此退单），建议框架允许 `supersedes` 语义。

## 3. 状态

✅ 已完成，见 `docs/worklog/completed/phase2.5/af038-scope-attribution-recheck-2026-11-17.md`。
