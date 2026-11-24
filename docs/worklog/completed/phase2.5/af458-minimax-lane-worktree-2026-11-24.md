# AF-458 · MiniMax Code 专用工作树隔离与资源域约定（交付记录）

- 任务：AF-458（implementation / orchestrator）
- 上下文：phase2.5-orchestration-closed-loop
- 基线：`d2429c7f6d60345ecabb53ae8711b9e7c7e88569`（AF-455 stacked 分支 HEAD）
- 前序：AF-457 → AF-456
- 日期：2026-11-24

## 一、做了什么

给 MiniMax Code 建了一块独立物理工作区，让它与主 AI 的 `mofang-nestjs-af281r` 不再共用同一个工作树：

```powershell
git worktree add "D:/work/Project/backend/mofang-nestjs-minimax" ^
  -b lane/minimax-work e855dbcc2f8b5a1ad59873ca5a44a3fd0857ea26
```

- 新树：`D:/work/Project/backend/mofang-nestjs-minimax`
- 分支：`lane/minimax-work`（长期车道，非任务分支）
- 基线：`e855dbcc`（当时 `origin/integrate`），4593 个文件检出完成
- 依赖：`pnpm install --frozen-lockfile` 成功，`node_modules` 独立一份

隔离约定落成文档：`docs/team/agent-orchestration/minimax-lane-worktree.md`。

## 二、资源域（大炮 2026-11-24 拍板）

| 类别 | 清单                                                                                                                                                                                                                                                 |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 允许 | `src/`（含 `engine-adapters/`、业务层、`admin-debug/`）、`test/`、`bin/`、`admin-dashboard/`                                                                                                                                                         |
| 禁止 | `src/engine-core/**`（纯层红线）、`docs/team/agent-orchestration/**`（状态面）、`docs/worklog/records/**` 与 `docs/worklog/completed/**`（记录包）、`.github/**`、`.husky/**`、`scripts/orchestration/**`、`contracts/**`、`.env*`、`pnpm-lock.yaml` |

约定文档同时写清了分支纪律（`task/<taskId>-<slug>` 自 `origin/integrate` 切出、单提交单任务号、禁止 `--no-verify`）、两阶段提交顺序、闸门分层、依赖与磁盘维护、以及旧树（`af152-minimax`）不再充当车道的原因。

## 三、闸门（实测）

| 闸门          | 命令                                              | 结果                                                                       |
| ------------- | ------------------------------------------------- | -------------------------------------------------------------------------- |
| 工作树登记    | `git worktree list`                               | 出现 `mofang-nestjs-minimax e855dbcc [lane/minimax-work]`，既有 5 棵树不变 |
| 工作区干净    | `git -C .../mofang-nestjs-minimax status --short` | 0 行                                                                       |
| 依赖可用      | `Test-Path node_modules/.bin/vitest`              | True                                                                       |
| lockfile 未改 | `git -C ... diff --stat HEAD -- pnpm-lock.yaml`   | 空输出                                                                     |
| 安装结果      | `pnpm install --frozen-lockfile`                  | exit=0，耗时 **49s**                                                       |

磁盘占用实测：`node_modules` **615 MB**，整棵工作树 **670 MB**（含 4593 个受控文件）。

## 四、与任务单的偏差

无。任务单五项成功判据逐条满足；未触碰 `engine-core`、未跑业务测试、未改既有工作树。

## 五、遗留与风险

1. **磁盘**：车道 `node_modules` 与主树各一份，等于多占约 615 MB。空间紧张时优先清车道（可随时 `pnpm install` 重装）。
2. **lockfile 变更路径**：升级依赖必须回主树走任务，改完 `pnpm-lock.yaml` 后车道再 `--frozen-lockfile` 同步；车道内直接装包会被 `--frozen-lockfile` 拒绝，这是有意设计。
3. **旧树清理未做**：`mofang-nestjs-af152-minimax`（`526ebb80`，分支 `task/AF-152-minimax-scoring`）与 `af069-rebase`（detached）、`af070`、`af281` 仍在，处置需单独拍板（是否归档分支、是否删除工作树），本任务不动。
4. **node 版本**：本机 node v22（仓库要求 ≥26），车道 `pnpm` 同样会打印 engine 警告，不影响 exit code，但与 CI 的 node 26 存在潜在差异。
