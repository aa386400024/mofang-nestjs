---
taskId: AF-078
contextId: phase2.5-orchestration-closed-loop
title: squash 多任务携带时按任务单并集校验 scope
type: fix
status: backlog
baselineRef: 2ab76f0311511e1821b16f790e1a752d7041e6f6
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-18T04:15:00.000Z
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/ci-task-gate.mjs
    - scripts/orchestration/__tests__/orchestration.spec.mjs
    - docs/team/agent-orchestration/README.md
    - docs/worklog/pending/
    - docs/worklog/completed/phase2.5/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af078-squash-scope-union-2026-11-18.md
    kind: report
gates:
  - command: corepack pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排单测全绿，覆盖 squash 多任务 scope 并集
    threshold: 0 failed
  - command: corepack pnpm lint
    check: lint 全绿且 scripts 覆盖生效
    threshold: 0 error 0 warning
  - command: node scripts/orchestration/cli.mjs validate
    check: 状态索引、任务单、回执与契约目录全部 PASS
    threshold: exit 0
successCriteria:
  - squash 提交若同时携带多张已完成任务单，门禁按这些任务已验收 scope 的并集校验，而不是只看提交标题里的第一个任务
  - 只有 completed + 可合并 durable 回执 + 任务单在本次改动内的任务才能加入并集
  - 单任务 squash 与在办任务提交行为保持不变
  - 本地用 2ab76f 复现原失败提交，修复后判 pass
---

# AF-078 · squash 多任务 scope 并集任务单

## 背景

PR #24 以 squash 合并后，integrate push 的 Orchestration Gate 报：

```text
FAIL 2ab76f031151 reason=scope-residual subject=feat(orchestration): AF-075 ...
  - 暂存文件越出任务 AF-075 的 scope
```

根因是 stacked 任务共用一条任务分支：AF-075 完成后再叠加 AF-076、AF-077，squash 把三个任务的提交压成一个。门禁只从标题取 `AF-075`，只加载 AF-075 的 scope，于是 AF-076 引入的 `ci-task-gate.mjs`、AF-077 引入的 `pr-release.mjs` 全部被判越界。

这不是配置漏项，是框架在「stacked 任务 squash」场景缺少多任务 scope 合并语义。逐个补 scope 只能救一次，下一组 stacked 任务还会复现。

## 修复方向

- 当提交满足 squash 全生命周期特征（父提交无该任务、当前已归档 completed、存在可合并 durable 回执）时：
  - 扫描本次提交实际携带的任务单（`docs/worklog/pending/*-task-*.md`）；
  - 只接纳「当前索引已 completed + 该任务自身有可合并 durable 回执 + 任务单在本次改动内」的任务；
  - 把这些任务从任务单恢复的 scope 取并集，作为 squash 提交的校验 scope；
  - 标题主任务仍必须是 completed/archived，且任务单存在。
- 不接纳 canceled/rejected、无回执、回执不可合并、或任务单不在本次改动内的任务，避免用历史任务扩大 scope。
- 单任务 squash 的并集只有一个成员，行为与现状一致。

## 验证

- 单测覆盖并集/拒绝两侧。
- 本地以 `fbe2470..2ab76f` 复现原失败提交，修复后 `ci-task-gate.mjs` 应判 pass。
- 不改业务 `src/`，不新跑 LLM 批次。
