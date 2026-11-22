---
taskId: AF-072
contextId: phase2.5-orchestration-closed-loop
title: AF-071 返修：提交链原子化与 CI 任务识别
type: fix
status: backlog
baselineRef: 0749d153b795a14b38d738a3f30e6d208a11f360
dependsOn: []
priorTasks: [AF-071, AF-070]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-18T09:30:00.000Z
deadline: null
agentRole: orchestrator
scope:
  files:
    - package.json
    - eslint.config.mjs
    - .github/workflows/ci.yml
    - scripts/
    - docs/team/agent-orchestration/
    - docs/security/
    - docs/worklog/pending/
    - docs/worklog/completed/phase2.5/
    - web/orchestration/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af072-af071-ci-chain-rework-2026-11-18.md
    kind: report
gates:
  - command: pnpm lint
    check: lint 覆盖 scripts 下 mjs/cjs 且 0 error 0 warning
    threshold: 0 error 0 warning
  - command: pnpm typecheck
    check: 类型检查 0 error
    threshold: 0 error
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排定向单测全绿
    threshold: 0 failed
  - command: pnpm orchestration:validate
    check: 编排索引与契约校验通过
    threshold: exit 0
  - command: node scripts/orchestration/cli.mjs events verify
    check: 事件链哈希与投影一致
    threshold: PASS
successCriteria:
  - 把 AF-070 与 AF-071 的两条提交压成一条只含 AF-072 任务号的原子提交，消除 CI 逐提交校验中的 scope-residual 与 ambiguous-task-id
  - 单条提交必须包含 AF-072 任务单、状态索引与工作树快照，使 CI 能在该提交快照中解析到 submitted 的 AF-072
  - 提交树保留 AF-070/AF-071 的交付记录与回执，不删除历史证据；AF-070 rejected、AF-071 completed 的事实仍可读
  - 复用已实现的代码改动，不重新设计、不扩大业务范围
  - 不改 src 业务代码、practice-runner、engine-core、LLM、数据库与 migration
  - 不执行与 AF-072 无关的批量数据、migration、seed 或环境清理
---

# AF-072 · AF-071 返修：提交链原子化与 CI 任务识别

## 背景

AF-070 的实现提交 `d51601b` 因任务单 scope 只覆盖 `scripts/orchestration/`，被 `ci-task-gate` 判 `scope-residual`（`scripts/deploy-tested.cjs` 等 4 个文件越界）；AF-071 的提交标题同时含 `AF-071` 与 `AF-070`，被 `extractCommitTaskId` 判 `ambiguous-task-id`。两项叠加导致 PR #20 的 `Orchestration Gate` failure。

AF-071 的本地验收与 durable 回执已通过，但 CI 门要求“提交链逐提交可解析且 scope 自洽”。继续在尾部追加提交无法修复历史提交，因此本单把两条提交原子化为一条只属于 AF-072 的提交，并在该提交中保留全部证据。

## 目标

1. 以 AF-072 为唯一提交任务号，压平 `d51601b` + `3539497` 的实现与交付内容。
2. 单条提交同时包含任务单、状态索引和工作树，确保 CI 在提交快照中看到 `submitted` 的 AF-072。
3. 保留 AF-070/AF-071 交付记录、回执与 rejected/completed 结论，不删除审计证据。

## 边界

- 不改 `src/`、`test/`、`practice-runner`、`engine-core`、LLM、数据库与 migration。
- 不删除、不移动用户文件或并行产物。
- 不关闭 Security Audit、不删 required checks、不使用 `--no-verify`。
- 历史重写只发生在任务分支；`integrate` 仍只接受受保护 PR。
