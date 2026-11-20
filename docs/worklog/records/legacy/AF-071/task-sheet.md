---
taskId: AF-071
contextId: phase2.5-orchestration-closed-loop
title: AF-070 返修：脚本 lint 范围与交付字段收口
type: fix
status: backlog
baselineRef: d51601b15eaab0c4540ef3c1c0b16486b48a7ee7
dependsOn: []
priorTasks: [AF-070]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-18T09:20:00.000Z
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
    path: docs/worklog/completed/phase2.5/af071-af070-rework-2026-11-18.md
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
  - 承接 AF-070 被拒原因：把脚本 lint 修复文件 scripts/deploy-tested.cjs、scripts/ensure-utf8.cjs、scripts/smoke-ai-engine.cjs、scripts/smoke-rag.cjs 纳入本任务 scope
  - 复用 AF-070 已提交的修复事实 d51601b，不重写已推送/已提交代码，不制造第二套实现
  - 交付记录正文显式出现 gateResults 字段标记，六组字段均可被机读识别
  - 回执如实记录 AF-070 的 rejected 结论与本次返修关系，不把返修伪装成首次通过
  - 不改 src 业务代码、practice-runner、engine-core、LLM、数据库与 migration
  - 不执行与 AF-071 无关的批量数据、migration、seed 或环境清理
---

# AF-071 · AF-070 返修：脚本 lint 范围与交付字段收口

## 背景

AF-070 已实现并通过本地闸门，但 `run-once` 的机读护栏按 commit 事实比对后给出 `rejected`：

- scope 外提交文件：`scripts/deploy-tested.cjs`、`scripts/ensure-utf8.cjs`、`scripts/smoke-ai-engine.cjs`、`scripts/smoke-rag.cjs`；
- 交付记录未出现字段标记 `gateResults`。

根因不是代码错误，而是 AF-070 任务单 scope 只写 `scripts/orchestration/`，而 lint 覆盖脚本天然会修到 `scripts/` 下其他 `.cjs`；同时交付记录用中文表头，未写机读标记。

## 目标

1. 把上述四个脚本修复文件纳入返修任务 scope，保留 AF-070 的真实实现与证据。
2. 补齐交付记录的 `gateResults` 字段标记，让六组字段都能被验收器识别。
3. 以新的 AF-071 回执完成返修闭环；AF-070 保持 `rejected` 历史，不篡改事件链。

## 边界

- 不重写、不 squash、不 amend `d51601b`；复用该提交作为实现事实。
- 不改 `src/`、`test/`、`practice-runner`、`engine-core`、LLM、数据库与 migration。
- 不删除、不移动任何用户文件或并行产物。
- 不关闭 Security Audit、不删 required checks、不使用 `--no-verify`。
