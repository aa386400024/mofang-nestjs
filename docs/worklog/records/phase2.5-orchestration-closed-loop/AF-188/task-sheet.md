---
taskId: AF-188
contextId: phase2.5-orchestration-closed-loop
title: AF-187 交付恢复与入账（场景建模与输出完整性）
type: fix
status: backlog
baselineRef: 4ca4dbe5c772bccc9bf1a3c73ad0dbc4a0e49866
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.2, conventions.md#1.3, conventions.md#5]
createdAt: 2026-11-20T18:40:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/shared/encounter/
    - src/shared/text/
    - src/engine-adapters/rendering/
    - src/engine-adapters/wiring/
    - src/auto-practice/
    - src/admin-debug/
    - src/migration/
    - bin/ormconfig.ts
    - admin-dashboard/src/
    - test/
    - docs/worklog/completed/phase2.5/af187-encounter-scene-output-integrity-2026-11-20.md
    - docs/worklog/completed/phase2.5/af188-af187-encounter-closure-2026-11-20.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af188-af187-encounter-closure-2026-11-20.md
    kind: report
gates:
  - command: pnpm lint
    check: 0 error 0 warning
    threshold: exit=0
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
  - command: pnpm test -- test/auto-practice/af187-encounter-output-integrity.spec.ts
    check: 定向回归全绿
    threshold: exit=0
  - command: pnpm test
    check: 全量全绿
    threshold: exit=0
successCriteria:
  - AF-187 已实现的场景一级配置、输出完整性闸门、风险收束会话级账本、crisisOutcome 与导出字段全部入账，不回退
  - 代码提交统一归属 AF-188；AF-187 的 rejected 历史原样保留，不伪造 completed
  - 全量 3949 例、lint、typecheck、前端 vue-tsc、preflight 真实通过
  - engine-core 零 diff
plannedArtifacts: []
requiredSkills: []
requiredTools: []
outOfScope:
  - src/engine-core/ 任何文件
  - Flutter 客户端代码
constraints:
  - 不手改 journal / task-state-index；状态只经 CLI
  - 不把 AF-187 的 rejected 事件改成 completed
priorTasks: [AF-187]
---

# AF-188 · AF-187 交付恢复与入账

## 背景

AF-187 主体实现与本地提交已完成，但 `run-once` 摄回执时任务租约已过期（claim 17:54 → 回执 18:37，超过 30 分钟租约），CLI 先 release 再按 late-receipt 路径把 AF-187 闭合为 `rejected` 并归档。代码提交 `b663fac` 因此不能作为 PR 提交（服务端 Orchestration Gate 会按 AF-187 的 rejected 终态逐提交拦截）。

## 处理

- 保留 AF-187 的 rejected 事件链、记录包与交付记录，不做任何状态篡改。
- 将同一批改动从 `4ca4dbe` 基线重新提交，统一归属 AF-188，保证 PR 内每个提交都有可验证的 completed 任务。
- AF-188 回执以真实闸门数字为准，交付记录写明 AF-187 → AF-188 的承接事实。

## 范围

与 AF-187 相同：场景契约、输出完整性闸门、风险账本、crisisOutcome、请求/落库/前端/导出接线与回归测试。

## 验收

见 frontmatter `successCriteria` 与 `gates`。
