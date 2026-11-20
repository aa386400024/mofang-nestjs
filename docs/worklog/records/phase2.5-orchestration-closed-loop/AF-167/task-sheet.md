---
taskId: AF-167
contextId: phase2.5-orchestration-closed-loop
title: Phase2.5 发布快照文档与脚本侧整合
type: documentation
status: backlog
baselineRef: 06ba825cfe6cf0b88a9f42450769793ce8f709a4
dependsOn: [AF-168]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-20T10:25:00+08:00
deadline: null
agentRole: orchestrator
priorTasks:
  - AF-168
  - AF-166
  - AF-164
  - AF-163
  - AF-162
  - AF-161
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
  - IM-073
scope:
  files:
    - docs/
    - scripts/
    - data/phase25-exit/
    - web/orchestration/
    - .github/
    - .husky/
    - package.json
    - AGENTS.md
  modules: [release, orchestration]
  interfaces:
    - node scripts/orchestration/pr-release.mjs
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af167-release-docs-snapshot-2026-11-20.md
    kind: report
gates:
  - command: pnpm lint
    check: ESLint 脚本段
    threshold: exit=0
  - command: pnpm exec tsc --noEmit -p tsconfig.json
    check: 全量类型检查
    threshold: exit=0
  - command: node scripts/orchestration/cli.mjs worklog verify --strict
    check: 记录包严格校验
    threshold: exit=0
  - command: node scripts/orchestration/cli.mjs events verify
    check: 事件链一致
    threshold: exit=0
successCriteria:
  - 在 AF-168 代码侧提交之上，把 AF-164 HEAD 的文档、脚本、数据与前端编排视图差异落成 AF-167 单任务提交
  - 记录包 manifest / 回执 / 交付记录补齐，worklog verify --strict 通过
  - 13 项远端必需检查全绿后由 pr-release squash 合并进 integrate
---

# AF-167 · Phase2.5 发布快照文档与脚本侧整合

> 状态：待执行（2026-11-20）
> 执行方：自做（主 AI，orchestrator 角色）
> 仓库：D:\work\Project\backend\mofang-nestjs-af070
> 唯一事实源：AF-168 代码侧提交、AF-164 交付记录、worklog verify 规则
> 任务性质：发布工程整合
> 改动范围：文档、脚本、数据、前端编排视图与仓库级配置

## 1. 背景

代码侧 AF-168 已通过验收并归档。发布快照仍缺文档、脚本、数据与前端编排视图的最终状态；本任务把这些差异落成单任务提交，并补齐记录包与交付记录，使 PR 最终 HEAD 满足 worklog 严格校验和 13 项远端检查。

## 2. 范围

在范围内：

- `docs/`：任务记录包、交付记录、编排规范与状态面。
- `scripts/`：编排、发布与校验脚本。
- `data/phase25-exit/`：Phase2.5 退出证据数据。
- `web/orchestration/`、`.github/`、`.husky/`、`package.json`、`AGENTS.md`。

不在范围内：

- 不改 `src/`、`bin/`、`test/`、`admin-dashboard/`（已由 AF-168 提交）。
- 不改 `src/engine-core/`。
- 不改业务逻辑与评分口径。

## 3. 交付物

- 文档侧发布提交（AF-167）。
- AF-167 记录包、delivery record、durable 回执。
- 指向 `integrate` 的受保护 PR。

## 4. 红线

- engine-core 零改动。
- 不使用 `--no-verify`、不关闭分支保护、不删除必需检查。
- 只提交发布快照内的文档/脚本/数据/配置；未跟踪临时文件不入库。

## 5. 闸门

- `pnpm lint` exit 0
- `pnpm exec tsc --noEmit -p tsconfig.json` exit 0
- `node scripts/orchestration/cli.mjs worklog verify --strict` exit 0
- `node scripts/orchestration/cli.mjs events verify` exit 0

## 6. 交付记录

`docs/worklog/completed/phase2.5/af167-release-docs-snapshot-2026-11-20.md`

## 7. 回写清单

- 记录包与回执归档、状态面更新。
- PR 合并后 integrate 同步，旧 PR #50 关闭。
