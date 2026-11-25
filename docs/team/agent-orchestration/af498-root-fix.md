# AF-498 · 编排收口根因修复（状态锚点 / 编号台账 / 合并生命周期）

> 2026-11-25。三件交付物合并耗时 89 分钟，其中真正提交与合并不足 5 分钟；本单把「已完成任务却无法收口」的结构性原因逐条去掉。

## 1. 结论先行

框架的状态机契约没有错：事件溯源、只读投影、单写者、终态不可变仍是正确底座。问题在 mofang 适配层把**状态面当成代码产物**放进了 git 工作树，并且用自由文本与手工状态补丁承担了**任务身份**与**合并生命周期**。分支一切换，状态就回退；状态一缺，任务号就只能换；任务一归档，合并就被门禁挡住。

修复口径：**身份与状态出工作树，门禁判定结构化，本地闸门分层。**

## 2. 根因与修复对照

| #   | 根因（实测）                                                                                  | 修复                                                                                             | 代码落点                                                                              |
| --- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| 1   | 索引 / journal / 运行态都在仓库内，`git switch -f` 后 active 任务丢失、归档变 unknown         | 状态锚点外置到本机持久目录；CLI / pr-release 启动恢复锚点、退出镜像回锚点；CI 与 state-free 禁用 | `state-anchor.mjs`、`state-store.mjs`、`event-store.mjs`、`cli.mjs`、`pr-release.mjs` |
| 2   | 任务号靠记录目录 + 索引 + 远端 ref 判占用，目录一清理就可能放号                               | 终态即写入锚点侧退役台账，永久不复用；占用检查纳入台账                                           | `task-id-occupancy.mjs`、`scheduler.mjs`                                              |
| 3   | `pr-release merge` 要求当前分支含 `--taskId`，且任务必须 archived+completed，归档任务无法自证 | 无 `--taskId` 时从 `task/AF-NNN-*` 反推；允许 status=completed 的归档任务按分支合并              | `pr-release.mjs`                                                                      |
| 4   | 同一 SHA 旧 check run 的 failure/cancelled 一直累计，新 run 全绿仍判 9 项失败                 | 同名 check 只认时间最新一条                                                                      | `pr-release.mjs` `evaluateRequiredChecks`                                             |
| 5   | 提交标题里的 `RC-2` 被当成第二个任务号；trailer 存在时仍先扫标题                              | 排除回执/PR/ADR 等前缀；有 trailer 时先按 trailer 判定，`Task: none` 不再扫标题                  | `ci-task-gate.mjs`                                                                    |
| 6   | 本地 pre-commit 对整棵工作树做 strict 比对，并行分支记录包被判孤儿                            | 钩子改 `--state-free`；strict 只在非 state-free 时因告警失败                                     | `package.json`、`cli.mjs`                                                             |
| 7   | 每次 push 都跑 lint+typecheck+全量 4953 例测试，十余次推送累计十分钟级                        | pre-push 只跑 lint + typecheck + 受影响测试；全量留 CI 与任务收尾                                | `.husky/pre-push`                                                                     |
| 8   | `run-once` 在回执未落盘时跑验收，把 submitted 打成 rejected，之后无法合并                     | 缺回执只记 `receipt-missing` 并保持 submitted，等回执到达再验收                                  | `scheduler.mjs` `processReceipts`                                                     |

## 3. 状态锚点口径

- 目录：`%LOCALAPPDATA%\mofang-orchestration\<repo-path-hash>`（可用 `ORCH_STATE_HOME` 覆盖）。
- 锚定文件：`task-state-index.json`、`state/journal.jsonl`、`state/archived-notes.json`、`orchestration-state.json`、`orchestration-snapshot.json`。
- 启动：锚点存在即覆盖工作树镜像；锚点不存在则用工作树首次播种。
- 写入：`saveIndex` / `appendEvents` / `saveArchivedNotes` / `saveRuntimeState` 落盘后立即镜像；CLI 退出整体再同步一次。
- 禁用：`ORCH_STATE_ANCHOR=off`、`CI=true`、`GITHUB_ACTIONS=true`、`ORCH_STATE_FREE=1`。

## 4. 门禁没有被削弱

- 仍然一任务一 PR、squash 合并、base 保持 `integrate`。
- 仍然要求 durable 回执（passed，或已登记 backlog 的 conditional-pass）。
- 仍然校验 scope、任务单、PR HEAD == 本地 HEAD、required checks。
- 变化只有两点：状态事实不再随分支回退；归档任务的合并资格按「status=completed + 回执」判，而不是按「当前 checkout 的任务」判。

## 5. 验证

- 新增回归：`scripts/orchestration/__tests__/af498-root-fix.spec.mjs`（状态锚点恢复、check 去重、`RC-2` 识别、缺回执不拒绝）。
- 编排全量：`pnpm exec vitest run scripts/orchestration/__tests__` → 23 files / 451 tests 全绿。
- 全量闸门数字见同批交付记录。
