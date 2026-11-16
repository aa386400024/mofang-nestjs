# AF-019 交付记录 · 适配层收尾：development 退役、CI 运行时升级与记录闭环

> 任务单：`af019-adapter-finalization-node26-2026-11-16.md`｜执行：主控 AI（orchestrator 自做）｜日期：2026-11-16
> 仓库：`D:\work\Project\backend\mofang-nestjs`（分支 `task/AF-019-adapter-finalization-node26`，基线 `355aae6`，合流提交 `d57a767`）
> 上游：AF-018 适配层迁移完成；框架仓 `v2.0.0` 口径不变

## 1. 落地

本单在 AF-018 迁移、旧口径清理、Node 26 基线三批之后，把仍开口的三项收尾一次性闭环：分支退役、CI action 运行时升级、工作记录补全。

### 1.1 `development` 分支退役

退役前按 `autonomous-team-design.md` §4.4 复核：

| 检查项                                 | 结果                             |
| -------------------------------------- | -------------------------------- |
| `origin/development` 独有非 merge 提交 | 0 条                             |
| `git diff integrate...development`     | 空                               |
| 最近提交                               | 2026-11-02，仅历史 PR merge 记录 |

执行：删除远端 `development`；本地无同名分支；`.github/workflows/ci.yml` 的 `push.branches` 由 `[master, integrate, development]` 收敛为 `[master, integrate]`。`improvement-log.json` 的 `IM-019` 由 candidate 经 queued / accepted 流转至 done，`resolution.linkedTaskId = AF-019`，三次流转均留 history。

### 1.2 GitHub Actions 运行时升级

| Action                       | 变更                 | 说明                                              |
| ---------------------------- | -------------------- | ------------------------------------------------- |
| `actions/checkout`           | `v4` → `v5`          | Node 24 运行时                                    |
| `actions/setup-node`         | `v4` → `v5`          | Node 24 运行时；补 `package-manager-cache: false` |
| `actions/cache`              | `v4` → `v5`          | Node 24 运行时                                    |
| `actions/upload-artifact`    | `v4` → `v6`          | v5 仍目标 Node 20，故跨到 v6                      |
| `docker/setup-buildx-action` | `v3` → `v4`          | Node 24 运行时                                    |
| `aquasecurity/trivy-action`  | `master` → `v0.36.0` | 去掉浮动引用，固定稳定版本                        |

关键修复：`setup-node@v5` 默认按 `packageManager` 自动缓存，会在 corepack 启用前调用 pnpm，导致五个 job 的 Setup Node.js 步骤失败；显式 `package-manager-cache: false` 后恢复，缓存仍由既有 `actions/cache` 负责。

前置修复：编排单测对框架仓 sibling 的硬依赖已改为 `skipped` 时只断言不误报（提交 `354f145`），使 CI 无框架仓环境稳定通过。

### 1.3 本机运行时

核实用户真实 PATH：`D:\Tools\nodejs26\node.exe` = `v26.13.1`，pnpm = `9.15.0`；`.nvmrc` 为 `26`、`package.json engines.node >=26`。AI 沙箱 shell 会前置内置 Node 22，属工具环境差异，不是本机安装缺失。

尝试 `pnpm runtime set node 26.13.1 -D` 时被 pnpm 9.15 的模块目录配置校验阻断（`ERR_PNPM_VIRTUAL_STORE_DIR_MAX_LENGTH_DIFF` / `PUBLIC_HOIST_PATTERN_DIFF`），且 pnpm 9.15 不消费 `devEngines.runtime`；因此不引入无效声明，保留 `.nvmrc` + `engines` 作为项目口径，运行时以真实 PATH 为准。

### 1.4 记录与索引

- 新增本任务单与交付记录；`task-state-index.json` 的 `archivedTasks` 追加 AF-019（只含 `taskId / status / artifacts`），`archivedNotes` 追加 AF-019 一条。
- `orchestration-snapshot.json` 与 `web/orchestration/data.js` 重生成：归档 36 条、审计 12 条、协议视图 `archivedTasks` 36 条。
- `docs/worklog/pending/phase2.5-README.md` 补 AF-019 已交付行。

## 2. 证据

| 闸门       | 命令                                                                          | 结果                                 |
| ---------- | ----------------------------------------------------------------------------- | ------------------------------------ |
| 契约校验   | `node scripts/orchestration/cli.mjs validate`                                 | `7/7 PASS`                           |
| 编排层单测 | `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | `130 passed / 0 failed`              |
| 全量单测   | `pnpm test`                                                                   | `3503 passed / 8 skipped / 0 failed` |
| Lint       | `pnpm lint`                                                                   | `0 error`                            |
| Typecheck  | `pnpm typecheck`                                                              | `0 error`                            |
| 远端分支   | `git ls-remote --heads origin`                                                | 仅 `master` / `integrate`            |
| CI         | GitHub Actions run `43875858880`（`d57a767`）                                 | 七个作业全 success，warning 注解 0   |

## 3. 范围核对

- `src/` 业务源码、依赖、migration：零改动。
- 框架仓：零改动；历史交付记录：零改写。
- 用户未跟踪设计稿 `phase3-judge-layer-ai-review-design-2026-11-15.md`：保持未跟踪、未改动。
- 无并行进程产物混入。

## 4. 契约核对

- `task-state-index.json` 仍为 `task-state-index:1.1.0`；新增归档条目仅保留指针字段，说明外移 `archivedNotes`。
- AF-019 任务单 `contractRef = task-sheet:1.1.0`；交付记录与任务单路径均已登记索引。
- CI 不新增契约字段；`development` 移除不改变 workflow 结构。

## 5. 遗留与另案

- 无未闭环的 AF-019 范围内事项。
- `development` 退役后，`master` 合并、tag、release、部署仍属 L4 人工冻结动作。
- AI 沙箱 shell 的 Node 22 属执行环境差异；用户终端已为 Node 26.13.1，无需改系统安装。
