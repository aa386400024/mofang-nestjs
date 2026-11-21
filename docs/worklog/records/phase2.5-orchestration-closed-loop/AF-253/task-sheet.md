---
taskId: AF-253
contextId: phase2.5-orchestration-closed-loop
title: AF-252 返修：补齐 .env.example scope 与交付记录护栏字段
type: fix
status: backlog
baselineRef: 1e84b267
dependsOn: []
priorTasks: [AF-252]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-22T07:52:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - .env.example
    - src/engine-adapters/wiring/
    - test/engine-adapters/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af253-af252-rework-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec vitest run test/engine-adapters/af252-visitor-render-provider.spec.ts test/engine-adapters/af210-render-model-override.spec.ts
    check: AF-252 候选切换与旧行为回归仍全绿
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm exec tsc --noEmit -p tsconfig.json
    check: CI 全量 typecheck 0 error
    threshold: exit=0
---
# AF-253 · AF-252 返修

## 背景

AF-252 的代码与测试已通过全量闸门，但机读验收在归档前拒绝：

1. `scope` 未声明根目录 `.env.example`，按 commit 事实比对判为 scope 外；
2. 交付记录未出现 `scopeCheck` / `contractChecks` / `backlogItems` / `deviationTable` / `reviewVerdict` 字段标记。

AF-252 已归档为 `rejected`，按编排规则不得在其上追加实现提交；本任务从 AF-252 HEAD `1e84b267` 切 stacked 分支，`priorTasks` 显式指向 AF-252，保留原提交链。

## 目标

1. 在任务 `scope` 中显式包含 `.env.example`。
2. 新交付记录逐项写出五个护栏字段标记，说明 scope 内文件、契约检查、遗留项、偏差与验收结论。
3. 不改 AF-252 的代码、测试与 env 说明；只补流程契约与记录。
4. 在 stacked 分支上重新跑定向测试、lint、tsc 与全量测试，形成新回执。

## 非目标

- 不改 `src/engine-core`。
- 不改 AF-252 的候选/模型解析逻辑。
- 不改生产 `.env`。

## 验收

- AF-252 6 例 + AF-210 5 例全过。
- 新交付记录含 `scopeCheck`、`contractChecks`、`backlogItems`、`deviationTable`、`reviewVerdict` 五个字段标记。
- lint、CI 同口径 tsc、全量测试全绿；`git diff HEAD -- src/engine-core` 为空。
