---
taskId: AF-423
contextId: phase2.5-orchestration-closed-loop
title: 历史孤儿记录包纳管：显式继承清单替代 ORCH_STATE_FREE 全局跳过
type: fix
status: backlog
baselineRef: 8bac4cda848eb0046029974748f48f5f6c29239d
dependsOn: []
priorTasks: [AF-419, AF-420]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T05:20:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/
    - docs/team/agent-orchestration/
    - docs/worklog/pending/archive/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af423-legacy-record-packages-2026-11-24.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/worklog.spec.mjs scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 孤儿判定、继承清单白名单、清单过期检测三类断言全绿
    threshold: exit=0
  - command: node scripts/orchestration/cli.mjs worklog verify --strict
    check: 不带 ORCH_STATE_FREE 也通过，且继承清单数量与打印一致
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
  - command: pnpm test
    check: 全量测试全绿，记录真实数字
    threshold: exit=0
  - command: git diff --stat HEAD -- src/engine-core
    check: engine-core 零改动
    threshold: empty
successCriteria:
  - 新增版本化继承清单 docs/team/agent-orchestration/legacy-record-packages.json，逐条登记 taskId / reason / evidence（manifest 与交付记录路径）
  - worklog verify 对「在清单内的孤儿记录包」判为 legacy（计数 + 打印），不再报错；清单外的孤儿仍报错
  - 清单条目若已进入索引（不再是孤儿）必须报 stale 错误，防止清单变成永久豁免
  - 不设 ORCH_STATE_FREE 也通过 strict verify；保留该 env 作为临时调试开关但不再是常规路径
  - 两份 MiniMax 回交原文（relay-response-AF414 / relay-response-BDI）纳入版本控制，避免再丢
  - lint / typecheck / 定向单测 / 全量测试全绿；engine-core 零 diff
---

## 背景

10 个历史记录包（AF-363/364/365/366/367/368/369/370/372/376，均为 2026-11-23 v2.1 迁移期产物）在 `docs/worklog/records/` 下，但不在事件链索引里——索引由 `events rebuild` 从 journal 重建，那批任务没有 journal 事件。结果每一次提交都要靠 `ORCH_STATE_FREE=1` 跳过孤儿检查：这是**全局开关**，跳过的是"所有孤儿"，而不是"这 10 个已知历史包"。真正的风险是：新出现的孤儿也会被同一个开关静默放过。

## 目标

1. 把"已知历史包"写成版本化清单（taskId + reason + evidence），由 verify 读取；白名单内的孤儿判 legacy 并计数打印，白名单外照旧报错。
2. 清单条目一旦进入索引就报 stale，避免清单成为永久豁免。
3. strict verify 不再依赖 `ORCH_STATE_FREE`；该 env 保留为临时调试开关。
4. 顺带把两份 MiniMax 回交原文纳入版本控制（当前 untracked）。

## 范围隔离

只动编排脚本与单测、`docs/team/agent-orchestration/`、`docs/worklog/pending/archive/`、记录包；不碰业务代码、不碰 `src/engine-core`、不改事件链历史。
