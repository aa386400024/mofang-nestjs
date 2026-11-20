---
taskId: AF-165
contextId: phase2.5-orchestration-closed-loop
title: Phase2.5 批次发布快照整合与 CI 全量类型修复
type: fix
status: backlog
baselineRef: 856788d066852bff6653abf118b0b14db843305c
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-20T10:30:00+08:00
deadline: null
agentRole: orchestrator
priorTasks:
  - AF-126
  - AF-127
  - AF-128
  - AF-133
  - AF-136
  - AF-137
  - AF-140
  - AF-141
  - AF-142
  - AF-146
  - AF-147
  - AF-152
  - AF-154
  - AF-155
  - AF-156
  - AF-157
  - AF-158
  - AF-159
  - AF-161
  - AF-162
  - AF-163
  - AF-164
  - IM-073
scope:
  files:
    - .github/
    - .husky/
    - admin-dashboard/
    - AGENTS.md
    - bin/
    - data/
    - docs/
    - package.json
    - scripts/
    - src/
    - test/
    - web/
  modules: [release, orchestration]
  interfaces:
    - node scripts/orchestration/pr-release.mjs
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af165-release-snapshot-2026-11-20.md
    kind: report
gates:
  - command: pnpm lint
    check: ESLint 权威闸门
    threshold: exit=0
  - command: pnpm exec tsc --noEmit -p tsconfig.json
    check: 与 CI 同口径全量类型检查
    threshold: exit=0
  - command: pnpm test
    check: 全量测试
    threshold: exit=0 且 0 failed
  - command: node scripts/orchestration/cli.mjs worklog verify --strict
    check: 记录包严格校验
    threshold: exit=0
  - command: node scripts/orchestration/cli.mjs events verify
    check: 事件链一致
    threshold: exit=0
successCriteria:
  - 以 origin/integrate 为基线、用 AF-165 单一发布快照重建可过 Orchestration Gate 的发布分支，不改变已有任务分支的审计证据
  - 修复 CI 全量 tsconfig.json 暴露的 5 处类型错误，本地闸门与 CI 口径一致
  - 13 项远端必需检查全绿后 squash 合并进 integrate，worklog 与 events 保持通过
  - src/engine-core 零改动
---

# AF-165 · Phase2.5 批次发布快照整合与 CI 全量类型修复

> 状态：待执行（2026-11-20）
> 执行方：自做（主 AI）
> 仓库：D:\work\Project\backend\mofang-nestjs-af070
> 唯一事实源：PR #50 远端检查日志、AF-164 交付记录、ci-task-gate.mjs
> 任务性质：发布工程修复
> 改动范围：仅后端 + 文档 + 发布快照（admin-dashboard 仅随快照原样带入，不做新改动）

## 1. 背景

AF-164 已把 59 个已验收提交组成批次 PR #50，但远端检查暴露两个结构性问题：

1. `Lint + Typecheck` 使用全量 `tsconfig.json`（含 `bin/`、`test/`），本地 `pnpm typecheck` 只跑 `tsconfig.check.json`，导致 5 处类型错误在本地不可见、CI 红。
2. `Orchestration Gate` 逐提交读取该提交与父提交的任务状态面；60 个历史提交中有 31 个属于“任务已归档后仍携带实现改动 / 多任务号 / scope 残留 / merge commit”，按现行门禁必然 FAIL。这是分支历史合规缺陷，不是 AF-164 自身验收失败。

直接修改 CI 门放宽历史校验会削弱保护门，不符合企业级标准。因此采用发布工程的标准做法：保留原任务分支作为审计证据，另建一个**单提交发布快照**分支，以新的发布任务 AF-165 承载整棵树的最终状态，使门禁只审两个合规提交（实现快照 + 归档），再走受保护 PR。

## 2. 范围

在范围内：

- 从 `origin/integrate` 建立 `task/AF-165-release-snapshot`，以 AF-164 HEAD 的树作为发布快照。
- 修复 `bin/ai-double-blind.ts`、`test/auto-practice/ai-double-blind.spec.ts`、`test/auto-practice/practice-runner-decide-turn.spec.ts` 的 5 处全量类型错误。
- 更新 AF-165 记录包、交付记录、机读回执与状态面。
- 关闭 PR #50，创建 AF-165 的新 PR。

不在范围内：

- 不改 `src/engine-core/` 任何文件。
- 不放宽 `ci-task-gate.mjs` 或删除任何必需检查。
- 不改业务逻辑、不改评分口径、不改数据库结构。
- 不重写 `task/AF-152-quality-admin` 与 `task/AF-164-release-integrate` 的历史。

## 3. 交付物

- 发布快照分支 `task/AF-165-release-snapshot`，首个提交包含最终树与 AF-165 任务登记。
- 5 处类型错误修复。
- `docs/worklog/completed/phase2.5/af165-release-snapshot-2026-11-20.md` 交付记录。
- `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-165/` 记录包与 durable 回执。
- 指向 `integrate` 的受保护 PR。

## 4. 红线

- engine-core 零改动。
- 不使用 `--no-verify`、不关闭分支保护、不删除必需检查。
- 只提交本任务产物；工作区未跟踪的历史运行产物不进入提交。
- 心理内容不进日志。

## 5. 闸门

- `pnpm lint` exit 0
- `pnpm exec tsc --noEmit -p tsconfig.json` exit 0（CI 同口径）
- `pnpm test` 全绿
- `node scripts/orchestration/cli.mjs worklog verify --strict` exit 0
- `node scripts/orchestration/cli.mjs events verify` exit 0
- `git diff --stat HEAD -- src/engine-core` 为空

## 6. 交付记录

`docs/worklog/completed/phase2.5/af165-release-snapshot-2026-11-20.md`

## 7. 回写清单

- 交付记录、记录包、回执、状态面、PR 链接齐全。
- 旧 PR #50 关闭并注明被 AF-165 取代。
- 合并后 `integrate` 与本工作树同步，分支清理按发布规则执行。
