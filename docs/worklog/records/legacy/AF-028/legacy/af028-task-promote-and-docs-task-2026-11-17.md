---
taskId: AF-028
contextId: phase2.5-orchestration-closed-loop
title: backlog → ready 提级入口与文档口径对齐
type: implementation
status: ready
baselineRef: 976b833
dependsOn: [AF-027]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs:
  - conventions.md#1.3
  - conventions.md#1.4
createdAt: 2026-11-17T10:05:00+08:00
deadline: 2026-11-17T11:05:00+08:00
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/
    - docs/team/agent-orchestration/
    - docs/worklog/completed/phase2.5/
artifacts:
  - name: 提级入口实施记录
    path: docs/worklog/completed/phase2.5/af028-task-promote-and-docs-2026-11-17.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs --reporter=dot
    check: 编排单测全绿
    threshold: 'failed=0'
  - command: ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate
    check: 适配层 schema 校验全 PASS
    threshold: 'fail=0'
successCriteria:
  - backlog 任务有 CLI 入口提到 ready，且提级前硬校验任务单指针 / 基线 / 依赖
  - 提级走事件写入（commitIndex），不直接改索引
  - README 与设计稿口径同步，不留下「只能注册不能启用」的死状态
evidenceFormat: 命令 + exit code + 用例数
---

# AF-028 任务单：backlog → ready 提级入口与文档口径对齐

## 1. 缺口

框架 `docs/state-machine.md` §4.1 允许 `backlog ↔ ready` 来回，`ready` 的前置是「契约齐全 + 基线明确 + 依赖满足」。适配层此前只有 `task register --status backlog` 的写入路径，没有任何把 backlog 提到 ready 的入口：`AF-024`（GUI 派发）登记后只能永久停在 backlog，等于「能立项、不能启用」。

## 2. 要做的事

1. `scheduler.mjs` 新增 `promoteTask()`：`backlog → ready`，提级前硬校验任务单指针、`taskId/contextId/type`、`baselineRef`、依赖满足（活跃 + 归档双查）；不满足即拒。
2. `cli.mjs` 新增 `task promote --taskId <id> [--reason]`，走 `commitIndex` 写事件 + `saveRuntimeState` + 刷新快照 + 审计登记；帮助文本与未知子命令提示同步。
3. 单测覆盖提级成功、上游归档算满足、依赖未满足 / 缺基线 / 缺任务单指针 / 非 backlog / 不存在等拒绝分支。
4. README §4 与 `autonomous-team-design.md` 补入口口径。

## 3. 边界

不改验收护栏 V1–V7，不改 transport 协议，不改 cancel / resume 语义，不启用 `AF-024` 本体（GUI 通道仍属 backlog）。
