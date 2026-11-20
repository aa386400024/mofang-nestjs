---
taskId: AF-168
contextId: phase2.5-orchestration-closed-loop
title: Phase2.5 发布快照代码侧整合（AF-166 范围修正重开）
type: fix
status: backlog
baselineRef: bb46bf48d9658b2deb4b893ca8aca6117f6673c3
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-20T10:20:00+08:00
deadline: null
agentRole: executor
priorTasks:
  - AF-166
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
    path: docs/worklog/completed/phase2.5/af168-release-code-snapshot-2026-11-20.md
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
  - 以 origin/integrate 为基线，把 AF-164 HEAD 的代码侧文件落成 AF-168 单任务提交
  - 修复 CI 全量 tsconfig.json 暴露的 5 处类型错误
  - 提交只含代码侧与任务单/状态面，不提交 manifest 到本任务，避免记录包元数据越出 scope
  - src/engine-core 零改动
---

# AF-168 · Phase2.5 发布快照代码侧整合（AF-166 范围修正重开）

> 状态：待执行（2026-11-20）
> 执行方：自做（主 AI，executor 角色）
> 仓库：D:\work\Project\backend\mofang-nestjs-af070
> 唯一事实源：AF-166 验收拒绝理由、PR #50 远端检查日志
> 任务性质：发布工程修复
> 改动范围：仅后端代码、测试与 bin

## 1. 背景

AF-166 的代码侧提交内容正确，但把记录包 `manifest.json` 一并提交，验收机读护栏判定该文件越出 AF-166 scope。AF-166 已 rejected 归档。本任务以相同代码内容重开，提交时不包含 manifest；记录包元数据留给文档侧任务 AF-167 统一提交。

## 2. 范围

在范围内：

- 从 `origin/integrate` 建立发布分支，把 AF-164 HEAD 的 `src/`、`bin/`、`test/`、`admin-dashboard/` 最终状态落成 AF-168 单任务提交。
- 修复 5 处全量类型错误。
- 提交 AF-168 任务单与状态面。

不在范围内：

- 不提交 `docs/worklog/records/.../AF-168/manifest.json`。
- 不改 `src/engine-core/`。
- 不改 docs/scripts/data/web/.github/package.json。

## 3. 交付物

- 代码侧发布提交（AF-168）。
- 5 处类型错误修复。
- `docs/worklog/completed/phase2.5/af168-release-code-snapshot-2026-11-20.md` 交付记录。

## 4. 红线

- engine-core 零改动。
- 不使用 `--no-verify`、不关闭分支保护。
- 仅提交代码侧文件、任务单与状态面。

## 5. 闸门

- `pnpm lint` exit 0
- `pnpm exec tsc --noEmit -p tsconfig.json` exit 0
- `pnpm test` 全绿
- `git diff --stat HEAD -- src/engine-core` 空

## 6. 交付记录

`docs/worklog/completed/phase2.5/af168-release-code-snapshot-2026-11-20.md`

## 7. 回写清单

- 交付记录、回执、状态面、归档齐全。
- 与 AF-167 的文档侧提交组成完整发布快照。
