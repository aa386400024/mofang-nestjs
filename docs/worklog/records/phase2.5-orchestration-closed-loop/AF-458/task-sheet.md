---
taskId: AF-458
contextId: phase2.5-orchestration-closed-loop
title: MiniMax Code 专用工作树隔离与资源域约定
type: implementation
status: backlog
baselineRef: d2429c7f6d60345ecabb53ae8711b9e7c7e88569
dependsOn: []
priorTasks: [AF-457, AF-456]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.2]
createdAt: 2026-11-24T11:15:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - docs/team/agent-orchestration/minimax-lane-worktree.md
    - docs/worklog/completed/phase2.5/af458-minimax-lane-worktree-2026-11-24.md
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-458/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af458-minimax-lane-worktree-2026-11-24.md
    kind: report
gates:
  - command: git worktree list
    check: 专用工作树已登记在列
    threshold: exit=0
  - command: git -C D:/work/Project/backend/mofang-nestjs-minimax status --short
    check: 专用工作树工作区干净
    threshold: exit=0
  - command: node -e "const fs=require('fs'); const p='D:/work/Project/backend/mofang-nestjs-minimax/node_modules/.bin'; if(!fs.existsSync(p)) process.exit(1)"
    check: 依赖已预装（node_modules/.bin 存在）
    threshold: exit=0
successCriteria:
  - 新建独立 worktree `D:/work/Project/backend/mofang-nestjs-minimax`，分支 `lane/minimax-work`，基线为当时 origin/integrate。
  - 该工作树完成 pnpm install --frozen-lockfile，node_modules 可用，不改动 lockfile。
  - 隔离约定文档写清：MiniMax 允许改动的资源域（src / test / bin / admin-dashboard）、禁止触碰的资源（engine-core 纯层、状态面生成物、docs/worklog 记录包、.github、scripts/orchestration）、以及分支与提交纪律。
  - git worktree list 可看到新树，原 af281r 工作树不受影响。
  - 交付记录给出依赖安装耗时与磁盘占用实测数字。
---

# AF-458 · MiniMax Code 专用工作树隔离与资源域约定

## 背景

MiniMax Code 与本次会话当前共用 `mofang-nestjs-af281r` 一个工作树：两边同时开工就会互相切分支、互踩 `git status`，任何一边 `git add -A` 都可能把另一边的半成品带进提交。「多 AI 并行」在只有一个工作树时只是口号。

现存 `mofang-nestjs-af152-minimax`（分支 `task/AF-152-minimax-scoring`，`526ebb80`）是 AF-152 时期的任务分支残留，基线已过期、依赖未校准，不宜直接复用。

大炮 2026-11-24 决策：

- 资源域：**代码域 + `admin-dashboard`**（`src/`、`test/`、`bin/`、`admin-dashboard/`）；
- 执行：**现在就建好专用工作树并预装依赖**。

## 范围

- 新建工作树 `D:/work/Project/backend/mofang-nestjs-minimax`（分支 `lane/minimax-work`，自 `origin/integrate`）
- 新增约定文档 `docs/team/agent-orchestration/minimax-lane-worktree.md`
- 交付记录与本任务记录包

## 验收

1. `git worktree list` 出现新树，分支名 `lane/minimax-work`，基线等于当时 `origin/integrate`。
2. `pnpm install --frozen-lockfile` 成功，`node_modules/.bin` 存在，`pnpm-lock.yaml` 无改动。
3. 约定文档写清允许域、禁止域、分支纪律、状态面归属、以及「发现越界怎么办」。
4. 原 `mofang-nestjs-af281r` 工作树与其它既有工作树零影响。
5. 交付记录记录安装耗时、磁盘占用与实测闸门输出。

## 不做

- 不删除、不改名既有工作树（`af069-rebase`、`af070`、`af152-minimax`、`af281`）。
- 不改 `engine-core`、不跑任何业务测试。
- 不给 MiniMax 分配状态面写权限（task-state-index / journal / improvement-log 仍只归主 AI）。
