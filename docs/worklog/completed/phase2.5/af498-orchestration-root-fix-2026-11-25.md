# AF-498 交付记录 · 编排状态锚定、编号台账与合并生命周期治本修复

- 日期：2026-11-25
- 基线：`8986a3ce55aaec4be5032530920eaf15145c01a3`（integrate）
- 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-498/task-sheet.md`
- 设计说明：`docs/team/agent-orchestration/af498-root-fix.md`

## 1. 改了什么

| 文件                                                              | 改动                                                                                                                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/orchestration/state-anchor.mjs`（新增）                  | 状态锚点：索引 / journal / 归档说明 / 运行态 / 快照镜像到 `%LOCALAPPDATA%\mofang-orchestration\<hash>`；锚点权威、分支镜像可回退；CI 与 state-free 禁用 |
| `scripts/orchestration/state-store.mjs`                           | `saveIndex` / `saveRuntimeState` 落盘后镜像锚点                                                                                                         |
| `scripts/orchestration/event-store.mjs`                           | `appendEvents` / `saveArchivedNotes` / `rebuildIndex` 写后镜像锚点                                                                                      |
| `scripts/orchestration/cli.mjs`                                   | CLI 启动恢复锚点、退出同步；state-free strict 不再因「待同步孤儿」告警失败                                                                              |
| `scripts/orchestration/pr-release.mjs`                            | merge 从 `task/AF-NNN-*` 反推任务号；允许 archived completed 合并；同名 check 只认最新 run；入口恢复锚点                                                |
| `scripts/orchestration/task-id-occupancy.mjs`                     | 新增锚点侧 `retired-task-ids.json` 退役台账，纳入占用清单；终态编号永久不复用                                                                           |
| `scripts/orchestration/scheduler.mjs`                             | 归档时登记退役编号；缺机读回执时保持 submitted 并记 `receipt-missing`，不再自动 rejected                                                                |
| `scripts/orchestration/ci-task-gate.mjs`                          | 排除 `RC` / `PR` / `ISSUE` / `ADR` / `BUG` / `CI` 前缀；有 Task trailer 时不再先扫标题                                                                  |
| `scripts/orchestration/__tests__/af498-root-fix.spec.mjs`（新增） | 4 条回归：锚点恢复、check 去重、RC-2 识别、缺回执不拒绝                                                                                                 |
| `package.json`                                                    | pre-commit worklog 校验改 `--strict --state-free`，只校验当前任务，不做全树 strict                                                                      |
| `.husky/pre-push`                                                 | 只改文档/状态时跳过；代码改动跑 lint + typecheck + 受影响测试，全量留给 CI/收尾                                                                         |
| `docs/team/agent-orchestration/af498-root-fix.md`（新增）         | 根因与修复对照、锚点口径、门禁未削弱说明                                                                                                                |
| 框架仓 `docs/state-machine.md`                                    | 新增 §8.1：状态面必须锚定工作树外；编号终态退役                                                                                                         |

未改 `src/engine-core/**` 一行。

## 2. 关键设计决策

1. **锚点权威、仓库镜像**：仓库里的索引不再被当作事实来源；分支切回旧基线不会覆盖锚点。锚点不存在时才用工作树首次播种，避免首次启用丢状态。
2. **合并资格按任务状态判，不按当前 checkout 判**：`merge` 允许 `status=completed` 的归档任务由分支反推合并，仍要求 durable 回执、PR HEAD == 本地 HEAD、required checks 全绿。
3. **check 去重按时间**：同名 check 取 `completed_at`/`started_at` 最新一条；旧 run 的 failure/cancelled 不再累计。
4. **缺回执不是验收失败**：`processReceipts` 对无回执任务只等待，不跑验收、不闭合终态；避免把已完成任务锁成 rejected。
5. **pre-push 分层**：全量 `pnpm test` 只在任务收尾/CI 跑；push 只挡本次改动的直接失败。

## 3. 闸门数字（本机实测）

- `pnpm lint`：0 error / 0 warning。
- `pnpm typecheck`：0 error（`tsc -p tsconfig.json --noEmit --incremental`）。
- `pnpm exec vitest run scripts/orchestration/__tests__`：23 files / 451 tests 全绿。
- `pnpm exec vitest run --changed origin/integrate --exclude '**/e2e/**/*.ts'`：337 files passed（1 skipped），4953 tests passed（4 skipped），0 failed。
- `git diff --stat HEAD -- src/engine-core`：空（本单未动纯层）。

## 4. 遗留项

- 当前工作树状态面在此之前被手工补过 AF-478/AF-481/AF-497，journal 未必逐条对应；锚点已按当前镜像播种。收尾时以 `events verify` / `rebuildIndex` 再确认一次，必要时用锚点快照重建。
- `AF-481` 仍为 ready 且依赖 AF-478；本单不替它闭合，避免越权改业务任务状态。
- 框架仓 §8.1 是规范补强，不改 schema；后续适配层实现应把「锚点存在性」纳入启动自检。
