# MiniMax Code 专用车道工作树（lane workspace）

用途：给 MiniMax Code（并行执行的第二 AI）一块**独立物理工作区**，让它与主 AI 的 `mofang-nestjs-af281r` 互不切分支、互不踩 `git status`。这是「多 AI 并行」能成立的前提，不是可选项。

## 1. 工作树与分支

| 项         | 值                                                                |
| ---------- | ----------------------------------------------------------------- |
| 工作树路径 | `D:/work/Project/backend/mofang-nestjs-minimax`                   |
| 分支       | `lane/minimax-work`（长期车道分支，**不是**任务分支）             |
| 基线       | `integrate` 的提交（建树时为 `e855dbcc`）                         |
| 裸仓       | `D:/work/Project/backend/mofang-nestjs`（bare，所有工作树共享）   |
| 依赖       | 建树后 `pnpm install --frozen-lockfile` 预装，独立 `node_modules` |

`lane/minimax-work` 与 `task/<taskId>-<slug>` 是两套东西：车道分支用于**日常并行开发**，每个可交付的改动仍要落成任务分支 + 受保护 PR。不得把车道分支直推 `integrate`。

## 2. 资源域（2026-11-24 大炮拍板）

MiniMax 在本车道**允许**改动：

- `src/`（含 `src/engine-adapters/`、业务层、`src/admin-debug/`）
- `test/`
- `bin/`
- `admin-dashboard/`（Vue3 管理后台，按其自带 `type-check` / `build-only` 脚本自检）

MiniMax 在本车道**禁止**触碰：

| 禁止域                                                                                                                     | 原因                                                         |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `src/engine-core/**`                                                                                                       | 纯层红线，一行不动；例外只能由大炮在任务单里书面批准         |
| `docs/team/agent-orchestration/**`（`task-state-index.json`、`state/journal.jsonl`、`improvement-log.json`、`transport/`） | 状态面只归主 AI，经 CLI 写入；第二 AI 写它等于双写者         |
| `docs/worklog/records/**`、`docs/worklog/completed/**`                                                                     | 记录包与交付记录按任务归属，跨 AI 混写会让门禁无法判定 scope |
| `.github/workflows/**`、`.husky/**`                                                                                        | 闸门与钩子本身，改动等于改规则                               |
| `scripts/orchestration/**`、`contracts/**`                                                                                 | 契约与 CLI，归主 AI                                          |
| `.env*`、`pnpm-lock.yaml`                                                                                                  | 环境与依赖真相源；需要变更时回主树走任务                     |

跨域需求（例如既要改 `src/` 又要改 `docs/worklog`）：**回主 AI 开任务单**，由主 AI 在自己工作树里完成，不在车道里硬做。

## 3. 分支与提交纪律

1. 开工前 `git status --short` 必须干净；不干净先问，不要 `git add -A`。
2. 一个可交付改动 = 一个任务分支，自 `origin/integrate` 切出，命名 `task/<taskId>-<slug>`；车道分支只做集成测试与临时验证。
3. 提交标题只能含**一个**任务编号；`husky` 会自动追加 `Task: <id>` trailer，禁止 `--no-verify`。
4. 状态面与实现分提：实现提交在前（任务处于 `submitted`），`run-once` 收口与状态面提交在后。**不要先收口后提交**——2026-11-24 AF-456 已踩过一次，preflight 会直接阻断。
5. 推送与 PR：`node scripts/orchestration/pr-release.mjs create --taskId <id> --apply`，合并只能走受保护 PR（squash），不直推、不 `--no-verify`、不关保护。

## 4. 闸门与验证

- 内循环：按需 `pnpm exec vitest run <file>`、`pnpm typecheck`、`pnpm lint`（带缓存）。
- 收尾全量（`pnpm lint` / `pnpm typecheck` / `pnpm test`）每任务一次，数字写进交付记录。
- 前端任务可在 `admin-dashboard/` 内跑其自带脚本。
- 本机 node 当前为 v22（仓库要求 ≥26），`pnpm` 会打印 engine 警告；不影响 exit code，但闸门数字与 CI（node 26）可能不同，交付记录要写明本机版本。

## 5. 依赖与磁盘

- 建树后必须 `pnpm install --frozen-lockfile` 一次；`--frozen-lockfile` 保证不改 lockfile。
- 车道里的 `node_modules` 与主树各自一份，磁盘会翻倍；空间紧张时优先清车道（可随时重装）。
- 升级依赖属于跨域变更：回主树走任务，改 `pnpm-lock.yaml` 后车道再 `pnpm install --frozen-lockfile` 同步。

## 6. 维护动作

```powershell
# 查看所有工作树
git -C D:/work/Project/backend/mofang-nestjs worktree list

# 车道状态
git -C D:/work/Project/backend/mofang-nestjs-minimax status --short
git -C D:/work/Project/backend/mofang-nestjs-minimax log -1 --pretty='%h %s'

# 车道基线跟进（只在车道内做，不影响主树）
git -C D:/work/Project/backend/mofang-nestjs-minimax fetch origin
git -C D:/work/Project/backend/mofang-nestjs-minimax merge --ff-only origin/integrate

# 淘汰旧车道（先确认没有未提交改动；未合并分支需 -f）
git -C D:/work/Project/backend/mofang-nestjs worktree remove D:/work/Project/backend/mofang-nestjs-minimax
```

注意：分支 `lane/minimax-work` 被车道工作树占用期间，主树 `git switch lane/minimax-work` 会被 git 拒绝（`already checked out`），这是预期的保护行为，不要用 `--force` 绕。

## 7. 旧树处置

- `mofang-nestjs-af152-minimax`（分支 `task/AF-152-minimax-scoring`，`526ebb80`）是 AF-152 时期残留，基线已过期、依赖未校准：**不再作为 MiniMax 车道**，保留只作历史参考，需要时单独清理。
- `af069-rebase`、`af070`、`af281` 属于历史任务，与车道无关，不动。
