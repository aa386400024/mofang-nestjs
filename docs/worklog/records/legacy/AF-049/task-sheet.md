---
taskId: AF-049
contextId: phase2.5-orchestration-enforcement
title: 编排者资源域补齐治理文档（conventions / 任务模板）
type: implementation
status: backlog
baselineRef: a27aba504b48b245f59a8f6ef1791310b68f94a9
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs:
  - conventions.md#1.3
  - conventions.md#1.4
createdAt: 2026-11-17T17:06:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - docs/team/agent-orchestration/agent-cards/
    - docs/worklog/pending/
    - docs/worklog/completed/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af049-orchestrator-governance-docs-2026-11-17.md
    kind: report
gates:
  - command: pnpm orchestration:validate
    check: Agent Card 与适配层校验通过
    threshold: 'FAIL=0'
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排单测全绿
    threshold: 'failed=0'
successCriteria:
  - 编排者 resources 显式包含 docs/team/conventions.md 与 docs/team/wp-task-template.md
  - 不授予 docs/team 其他文件，不改变角色职责
  - orchestration:validate 与编排单测通过
evidenceFormat: git diff 的 resources 字段 + validate PASS 计数 + vitest 用例数
---

# AF-049 · 编排者治理文档资源域补齐

## 1. 背景

AF-047 第二次领单仍返回 `scope-domain-conflict`。AF-048 已补齐根入口文件，剩余未覆盖项为：

- `docs/team/conventions.md`
- `docs/team/wp-task-template.md`

这两份是编排流程的活规范，编排者在执行强制门任务时必须能修改；当前只授权了 `docs/team/agent-orchestration/` 子目录，粒度过窄。

## 2. 目标

在 `orchestrator.json` 的 `resources` 中精确新增：

- `docs/team/conventions.md`
- `docs/team/wp-task-template.md`

不新增 `docs/team/` 整目录。资源域仍是上限，实际写入以任务单 `scope.files` 为准。

## 3. 验收

- 只改 agent card 与工作记录；
- `pnpm orchestration:validate` 49 项以上 PASS；
- 编排单测 195 例不回归。
