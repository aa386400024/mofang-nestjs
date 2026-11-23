---
taskId: AF-431
contextId: phase2.5-orchestration-closed-loop
title: PR #212 提交标题歧义修复：b370f884 同时出现两个 taskId 导致 CI 编排门失败
type: fix
status: backlog
baselineRef: 67e54372e171920fad603e667b181cfce59cb9b7
dependsOn: []
priorTasks: [AF-427, AF-429, AF-428]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T06:15:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/__tests__/af427-operator-delta-ledger.spec.mjs
    - docs/architecture/debug-corpus-kernel-version-drift-v1.0.md
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af431-pr212-ambiguous-taskid-2026-11-24.md
    kind: report
gates:
  - command: node scripts/orchestration/cli.mjs worklog verify --strict
    check: 记录包校验 PASS
    threshold: exit=0
---

# 背景

PR #212 的 CI `Orchestration Gate` 失败，日志给出精确原因：

```
[ORCH-CI-GATE] FAIL b370f88470e6 reason=ambiguous-task-id
subject=fix(af429): AF-427 端到端用例加无语料守卫（data/debug-sessions 被 gitignore）
```

`ci-task-gate.mjs` 要求一条提交标题里只能出现一个 taskId；`fix(af429): AF-427 ...` 同时出现 `af429` 与 `AF-427`，被判歧义，整条 PR 的编排门因此不通（其余 3 条提交 PASS）。

# 目标

1. 把该提交标题重写为只含一个 taskId（保留 af429），历史其余内容不变。
2. 顺带把 AF-428 的取证文档与交付记录纳入版本控制（此前因任务状态被自动闭合而未提交）。

# 做法

- `git rebase` 到 `b370f884` 处 `edit`，`git commit --amend` 仅改标题，不动 tree。
- 新增一个提交带 AF-428 取证文档与交付记录（本单 scope 覆盖）。

# 成功判据

1. `git log --format=%s b5c94f3a..HEAD` 每条标题只含一个 taskId。
2. 下一次 CI 的 Orchestration Gate 通过。
