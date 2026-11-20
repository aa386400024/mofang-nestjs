---
taskId: AF-166
contextId: phase2.5-orchestration-closed-loop
title: Phase2.5 发布快照代码侧整合与 CI 全量类型修复
type: fix
status: backlog
baselineRef: 856788d066852bff6653abf118b0b14db843305c
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-20T10:40:00+08:00
deadline: null
agentRole: executor
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
    - src/
    - bin/
    - test/
    - admin-dashboard/
  modules: [release]
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af166-release-code-snapshot-2026-11-20.md
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
  - command: git diff --stat HEAD -- src/engine-core
    check: 内核零改动
    threshold: 空输出
successCriteria:
  - 以 origin/integrate 为基线，把 AF-164 HEAD 的代码侧文件落成 AF-166 单任务提交
  - 修复 CI 全量 tsconfig.json 暴露的 5 处类型错误，本地闸门与 CI 口径一致
  - src/engine-core 零改动
  - 提交通过 Orchestration Gate 的逐提交校验
---

# AF-166 · Phase2.5 发布快照代码侧整合与 CI 全量类型修复

> 状态：待执行（2026-11-20）
> 执行方：自做（主 AI，executor 角色）
> 仓库：D:\work\Project\backend\mofang-nestjs-af070
> 唯一事实源：PR #50 远端检查日志、AF-164 交付记录、ci-task-gate.mjs
> 任务性质：发布工程修复
> 改动范围：仅后端代码、测试与 bin；admin-dashboard 仅随快照原样带入

## 1. 背景

AF-164 的批次 PR #50 暴露 `Lint + Typecheck` 全量类型 5 处错误。根因是本地 `pnpm typecheck` 只跑 `tsconfig.check.json`（排除 bin/test），CI 跑全量 `tsconfig.json`。同时 60 个历史提交的逐提交门禁无法通过，因此发布分支改为“代码侧 + 文档侧”两个合规任务提交重建，本任务负责代码侧。

## 2. 范围

在范围内：

- 从 `origin/integrate` 建立发布分支，把 AF-164 HEAD 的 `src/`、`bin/`、`test/`、`admin-dashboard/` 最终状态落成单任务提交。
- 修复 `bin/ai-double-blind.ts`、`test/auto-practice/ai-double-blind.spec.ts`、`test/auto-practice/practice-runner-decide-turn.spec.ts` 的 5 处全量类型错误。

不在范围内：

- 不改 `src/engine-core/`。
- 不改 `docs/`、`scripts/`、`data/`、`web/`、`.github/`、`package.json`（由 AF-167 承担）。
- 不改业务逻辑、评分口径、数据库结构。

## 3. 交付物

- 代码侧发布提交（AF-166）。
- 5 处类型错误修复。
- `docs/worklog/completed/phase2.5/af166-release-code-snapshot-2026-11-20.md` 交付记录。

## 4. 红线

- engine-core 零改动。
- 不使用 `--no-verify`、不关闭分支保护。
- 只提交代码侧文件与任务状态面；文档/脚本残留留给 AF-167。

## 5. 闸门

- `pnpm lint` exit 0
- `pnpm exec tsc --noEmit -p tsconfig.json` exit 0
- `pnpm test` 全绿
- `git diff --stat HEAD -- src/engine-core` 空

## 6. 交付记录

`docs/worklog/completed/phase2.5/af166-release-code-snapshot-2026-11-20.md`

## 7. 回写清单

- 交付记录、回执、状态面、归档齐全。
- 与 AF-167 的文档侧提交组成完整发布快照。
