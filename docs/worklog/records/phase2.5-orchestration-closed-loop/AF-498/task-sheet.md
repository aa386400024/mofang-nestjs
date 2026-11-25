---
taskId: AF-498
contextId: phase2.5-orchestration-closed-loop
title: 编排状态锚定、编号台账与合并生命周期治本修复
type: fix
status: backlog
baselineRef: 8986a3ce55aaec4be5032530920eaf15145c01a3
dependsOn: []
priorTasks: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.2, conventions.md#1.3]
createdAt: 2026-11-25T09:00:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/
    - package.json
    - .husky/
    - docs/team/agent-orchestration/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-498/
    - docs/worklog/completed/phase2.5/
  modules:
    - orchestration-state
    - task-identity
    - pr-release
    - ci-task-gate
  interfaces:
    - state-plane
    - receipt
    - pr-merge
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af498-orchestration-root-fix-2026-11-25.md
    kind: report
gates:
  - command: pnpm lint
    check: lint 0 error
    threshold: 0
  - command: pnpm typecheck
    check: typecheck 0 error
    threshold: 0
successCriteria:
  - 分支切换后状态索引与事件日志不会回落到旧基线。
  - 归档任务可由分支直接发起 squash 合并，不再依赖手工改状态。
  - 同一 SHA 的旧失败 check 不再阻断新 run。
  - 缺回执的 submitted 任务不再被自动打成 rejected。
  - 提交标题里的 RC-2 等回执编号不再被当成任务编号。
  - 本地 pre-commit 只校验当前 staged 任务，不做全量记录包 strict 比对。
  - 任务编号在取消/失败/目录清理后仍不复用。
  - 相关单测与全量闸门通过。
---

## 1. 背景

2026-11-25 合并 AF-478/AF-481 时，实际代码早已完成，却因状态面随分支回退、归档任务无法被 `pr-release merge` 识别、同一 SHA 旧 failure check 累计、回执缺失被自动拒绝、`RC-2` 被 CI 当成任务号，反复换号与重建分支，耗时 1 小时 29 分钟。

## 2. 口径

- 不改 `src/engine-core`。
- 不削弱门禁：仍保留单任务单 PR、回执冻结、scope 校验、squash 合并。
- 把「身份」与「状态」从 git 工作树和自由文本中剥离，改为外部持久锚点与结构化判定。
