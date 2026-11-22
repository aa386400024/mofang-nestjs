# AF-055 交付记录 · squash 合并门禁快照修正与发布记录闭环

- 任务单：`docs/worklog/pending/af055-merge-gate-snapshot-task-2026-11-17.md`
- 上下文：`phase2.5-orchestration-enforcement`
- 登记提交：`a5641c4b19e485e43796a18023b3d017ac8403b9`
- 任务分支：`task/AF-055-merge-gate-snapshot`
- 实现提交：`3e620cc08bc3d427499ea1b7f91b0bed9bd6b314`
- 类型：fix / L1–L3 发布闭环
- 结论：**passed**。preflight 新增受约束的 `archived-transition` 快照路径，211 例编排单测、typecheck、lint、61 项 validate、契约包全部通过；AF-053 交付记录与回执 durable 副本已随本任务提交。

## 1. 根因与修正

AF-053 合并时，squash 暂存区同时包含业务交付和 `active → completed/archived` 状态投影。旧 preflight 只读取工作树索引，因此在归档投影下误报 `no-active-task`。

本任务在不放开业务文件准入的前提下新增：

1. 暂存文件包含 `task-state-index.json`；
2. 当前工作树索引没有可写在办任务；
3. 当前 `archivedTasks` 中同 taskId 为 `completed`；
4. HEAD 索引中同 taskId 为可写状态且任务单指针完整；

四者同时满足时，才使用 HEAD 中该任务做 scope 校验，返回 `archived-transition`。canceled/rejected、缺少状态索引、scope 越界均保持阻断。

## 2. gateResults

| 命令                                                                          | 退出码 | 结果                                               |
| ----------------------------------------------------------------------------- | ------ | -------------------------------------------------- |
| `node --check scripts/orchestration/task-entry-gate.mjs`                      | 0      | 语法通过                                           |
| `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 0      | 1 文件 / 211 用例 passed / 0 failed                |
| `pnpm typecheck`                                                              | 0      | 0 error                                            |
| `pnpm lint`                                                                   | 0      | 0 error / 0 warning；覆盖 `{src,test,bin}/**/*.ts` |
| `$env:ORCH_REQUIRE_FRAMEWORK='1'; pnpm orchestration:validate`                | 0      | 61 项 PASS                                         |
| `pnpm orchestration:contracts`                                                | 0      | 框架 2.0.0 / 14 文件一致                           |
| `pnpm orchestration:preflight`（登记提交）                                    | 0      | PASS task=AF-055 files=7 covered=2                 |
| `pnpm orchestration:preflight`（实现提交）                                    | 0      | PASS task=AF-055 files=6 covered=5                 |
| `git show --name-only --pretty=format: HEAD` + 禁入路径核对                   | 0      | 6 文件；并行产物 / engine-core / 架构稿混入数 0    |
| `git diff --stat HEAD -- src/engine-core`                                     | 0      | 空，内核 0 行改动                                  |
| `git push -u origin task/AF-055-merge-gate-snapshot`                          | 0      | 远端任务分支已建立并跟踪                           |

新增 4 例：

- completed 归档迁移 + HEAD 同任务 + scope 内文件 → `archived-transition` 放行；
- canceled 归档 → `no-active-task`；
- 未同次提交状态索引 → `no-active-task`；
- 归档迁移但文件越界 → `scope-residual`。

## 3. scopeCheck

`in-scope`。实现提交仅 6 个文件：门禁脚本、编排测试、适配层 README、工作记录导航、AF-053 交付记录、AF-053 回执 durable 副本。登记提交另含 AF-054/AF-055 任务单、orchestrator 资源域和 CLI 状态面。

明确排除：`admin-dashboard/**`、`data/batch-reports/**`、未跟踪架构稿、`src/engine-core/**`、全部业务 `src/**`。

## 4. contractChecks

| 项              | 结果           | 说明                                                      |
| --------------- | -------------- | --------------------------------------------------------- |
| taskId          | pass           | AF-055 贯穿登记、分支、提交、交付记录与回执               |
| state-write     | pass           | AF-054 取消/归档、AF-055 登记/领单/验收均经 CLI           |
| index-schema    | pass           | 索引 1.1.0；61 项 validate 含投影一致                     |
| event-chain     | pass           | 验收前事件链哈希一致                                      |
| baseline        | not-applicable | 显式缺省，避免落单提交造成伪漂移                          |
| resource-domain | pass           | orchestrator 精确新增 `docs/worklog/README.md` 后领单成功 |

## 5. backlogItems

1. AF-054 是登记方式纠错后的 canceled 归档，不是交付载体；实际修正在 AF-055。
2. AF-055 本记录与回执 durable 副本作为最新交接件，后续由下一文档任务入库；不影响本任务事件链与代码发布。
3. 跨仓门禁、`--no-verify` 服务器端防线、`scripts/*.mjs` ESLint 覆盖仍沿用既有遗留。

## 6. deviationTable

| 项           | 原计划                 | 实际                                     | 处理                           | 原因                               |
| ------------ | ---------------------- | ---------------------------------------- | ------------------------------ | ---------------------------------- |
| AF-054       | backlog 登记后 promote | 固定 baseline 与落单提交冲突             | CLI 取消，AF-055 以 ready 重建 | 沿用 AF-053 显式缺省 baseline 口径 |
| 工作记录导航 | 默认可写               | 资源域未含 `docs/worklog/README.md`      | orchestrator 增加精确资源路径  | 不删需求、不绕过资源域             |
| AF-053 合并  | CLI 自动完成           | 旧门读取归档工作树，需手工恢复 HEAD 索引 | 本单固化 archived-transition   | 消除后续任务的手工恢复             |
| 本单记录入库 | 与实现同提交           | 最新交接件后续入库                       | 保留 durable 副本              | 避免记录包含自身合并证据的自引用   |

## 7. reviewVerdict

**passed**。代码边界严格、4 条新增正反用例全部通过；实现提交真实经过 preflight、lint-staged 与 commit-msg，任务分支已推送，未使用 `--no-verify`。

## 8. 回执

`docs/worklog/pending/archive/AF-055-receipt-RC-AF-055-1.json`。正式验收、纯状态面提交、squash 合并与 integrate 推送结果见 §9。

## 9. 发布结果

| 项               | 实际结果                                                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 正式验收         | `2026-11-17T10:13:59Z` `receipt-ingested AF-055`；`autoVerdict=passed`                                                       |
| 归档             | `archive-completed AF-055`；归档任务数 73，活跃任务 0                                                                        |
| 纯状态面提交     | `0c5c08080a1755cdfd1840c794c4a6a4a45f6306`；无活跃任务时 4 个状态面文件 preflight / Husky 通过                               |
| squash 合并      | `3defc1ac2490a5bbc0e9a145f894e8f51b6e9ec5`；CLI `mergeExit=0`，完整走完 squash-merge → commit → delete-local → delete-remote |
| 新增快照路径验证 | 本次合并没有恢复工作树 `task-state-index.json`，没有设置绕过变量，没有 `--no-verify`；真实 pre-commit 在归档投影下通过       |
| integrate 推送   | 本地与 `origin/integrate` 均为 `3defc1ac2490a5bbc0e9a145f894e8f51b6e9ec5`                                                    |
| 分支清理         | 本地 / 远端 `task/AF-055-merge-gate-snapshot` 均为 0                                                                         |
| 合并提交 scope   | 10 个文件；admin-dashboard / batch-reports / 架构稿 / engine-core 混入数 0                                                   |
| 最终事件链       | `events verify` PASS，223 条事件，schema + 哈希链 + 索引投影一致                                                             |
| 并行产物         | tracked 并行改动在合并前 stash、推送后 pop 恢复；未进入合并提交                                                              |

AF-053 的记录与回执已随本任务合并提交入库。AF-055 本记录和 `AF-055-receipt-RC-AF-055-1.json` 保留为最新交接件，未伪装成已入库事实。
