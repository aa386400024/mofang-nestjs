---
taskId: AF-048
contextId: phase2.5-orchestration-enforcement
title: 编排者资源域补齐根入口约束文件（AGENTS / package / husky）
type: implementation
status: backlog
baselineRef: a27aba504b48b245f59a8f6ef1791310b68f94a9
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs:
  - conventions.md#1.3
  - conventions.md#1.4
createdAt: 2026-11-17T17:04:00+08:00
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
    path: docs/worklog/completed/phase2.5/af048-orchestrator-resource-domain-2026-11-17.md
    kind: report
gates:
  - command: pnpm orchestration:validate
    check: Agent Card 与适配层校验通过
    threshold: 'FAIL=0'
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排单测全绿
    threshold: 'failed=0'
successCriteria:
  - 编排者 resources 显式包含 AGENTS.md、package.json、.husky/
  - 不扩大其他资源域，不改变角色 canDo / cannotDo 语义
  - orchestration:validate 通过
evidenceFormat: git diff 的 card 字段 + validate PASS 计数 + vitest 用例数
---

# AF-048 · 编排者资源域补齐

## 1. 背景

AF-047 登记后 `run-once` 返回 `scope-domain-conflict`。核对 `agent-cards/orchestrator.json` 的 `resources` 当前为：

- `docs/worklog/pending/`
- `docs/worklog/completed/`
- `docs/team/agent-orchestration/`
- `scripts/orchestration/`

AF-047 需要修改仓库入口 `AGENTS.md`、包脚本 `package.json` 与 Husky 钩子 `.husky/`，这三项不在资源域内，因此被 `validateScopeDomain` 正确拦下。问题不是门禁误判，而是角色授权没有覆盖配置入口文件。

## 2. 目标

只扩展 orchestrator 的可写资源域，新增：

- `AGENTS.md`
- `package.json`
- `.husky/`

不改变 `canDo` / `cannotDo` / `requiresApproval`，不把 `src/`、`test/`、migration、seed 等业务域授予编排者。资源域只是上限，实际写入仍由任务单 `scope.files` 切片约束。

## 3. 验收

- `orchestrator.json` 的 `resources` 精确新增三项；
- `pnpm orchestration:validate` 全 PASS；
- 编排单测不回归。
