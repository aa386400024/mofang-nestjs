---
taskId: AF-162
contextId: phase2.5-orchestration-closed-loop
title: AF-161 验收返修与编排入口收口
type: fix
status: backlog
baselineRef: 85b6bdbd8dc83d14c9afe26422fdc0b1c983eaad
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-20T09:20:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/
    - docs/worklog/
    - docs/team/agent-orchestration/
    - .husky/
    - package.json
    - AGENTS.md
  modules: [orchestration]
  interfaces:
    - node scripts/orchestration/cli.mjs
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af162-worklog-closeout-2026-11-20.md
    kind: report
gates:
  - command: pnpm lint
    check: lint 零错误
    threshold: exit=0
  - command: pnpm typecheck
    check: 类型检查零错误
    threshold: exit=0
  - command: pnpm test
    check: 全量测试通过
    threshold: exit=0
successCriteria:
  - AF-161 任务单行尾规范为 LF，manifest SHA-256 同步更新
  - AF-161 交付记录补齐 gateResults / scopeCheck / contractChecks / backlogItems / deviationTable / reviewVerdict 六组机读标记
  - package.json 暴露 orchestration:worklog 与 orchestration:worklog:verify
  - pre-commit 在 preflight 后强制执行 worklog verify
  - AGENTS.md 的待开工任务入口改为 inbox + records
  - lint / typecheck / 全量测试全绿，worklog verify --strict 通过
---

# AF-162 · AF-161 验收返修与编排入口收口

## 背景

AF-161 实现已提交 `85b6bdb`，但验收被两条机读护栏判 `rejected`：

1. 记录包内 `task-sheet.md` 保留 CRLF，验收探针报 `taskSheet: 含 CR`；
2. 交付记录缺少六组字段标记，进入人工复核。

同时，AF-161 的 scope 未包含根级 `package.json`、`.husky/` 与 `AGENTS.md`，导致本地钩子、pnpm 别名和 agent 入口文档无法随该任务提交。

## 目标

- 规范 AF-161 任务单行尾并同步 manifest 哈希；
- 补齐 AF-161 交付记录机读标记；
- 在 AF-162 scope 内提交 pnpm 别名、pre-commit 门与 AGENTS 入口校正；
- 全量闸门重跑，worklog verify --strict 通过。

## 非目标

- 不改 AF-161 的历史 commit，不重写已归档状态；
- 不改生产 `src/` 业务代码；
- 不恢复 15 个确实缺失的历史任务单。
