# AF-575 · quality lint 闸门返修验收（第 2 次）— 交付记录

- **任务单**：`docs/worklog/records/phase2.5-toolchain/AF-575/task-sheet.md`
- **前序任务**：AF-574、AF-573、AF-572
- **分支**：`task/AF-575-quality-scripts-lint`
- **基线**：`2ba07843ab04e8a44d266e996da875e4c7f5730e`
- **日期**：2026-11-27
- **性质**：返修验收，R1，standard gate

## 一、返修原因

AF-574 回执的 `changedFiles.commits` 声明了 `20c81c92`，该提交新增 `docs/worklog/records/phase2.5-toolchain/AF-572/task-sheet.md` 与 `manifest.json`；AF-574 的 `scope.files` 只含 AF-573/AF-574，不含 AF-572，机读护栏据此判“scope 外提交文件”并 rejected。

AF-575 把 AF-572/573/574/575 四个记录包目录全部纳入 scope，重出六组标记齐全的交付记录与 passed 回执。实现代码与 AF-573 相同，无新增业务改动。

## 二、实现与证据

AF-573 已完成 `scripts/ops/quality` 14 个 TS 脚本 lint 清零（185 errors / 4 warnings → 0/0），并把目录纳入 `pnpm lint` / `lint:fix`。

| 提交 | 内容 |
| --- | --- |
| `aed982305f788ade7a65ddd5c55e9de275f5bfc6` | lint 覆盖扩展 + 6 个 quality 脚本修复 + AF-573 交付记录 |
| `20c81c921af55744c9af0a8a016072322d39b09e` | AF-572/573 记录包 |
| `9cb997f1ef34028eb5dbfbbab749c2ae5063bc42` | AF-573 交付记录补记测试证据 |
| `8353dba3f0c5a2254a68f1ac589b3ffd2cec6ada` | AF-574 返修记录 |

## 三、闸门结果（gateResults）

| 闸门 | 结果 |
| --- | --- |
| `pnpm exec eslint "scripts/ops/quality/**/*.ts"` | exit 0；14 文件 0 error / 0 warning |
| `pnpm lint` | exit 0；全仓 0 error |
| `pnpm typecheck` | exit 0；0 error |
| `pnpm exec vitest run --exclude "**/e2e/**/*.ts" --no-file-parallelism` | exit 0；362 passed / 1 skipped 文件，5143 passed / 4 skipped 用例，0 失败，3586.86s |
| `git diff --stat HEAD -- src/engine-core` | 输出为空 |
| 三个超时文件隔离复跑 | 48 passed / 0 failed |

标准并发 `pnpm test` 的 4 例失败已复现为本机 363 worker 冷启动超时，非代码回归；全量串行执行 0 失败。

## 四、范围核对（scopeCheck）

`scopeCheck`: **in-scope**。代码改动仅 `package.json` 与 `scripts/ops/quality/` 下 6 个 TS 文件；记录改动落在 AF-572/573/574/575 记录包与 `docs/worklog/completed/phase2.5/`；未改 `src/`、`test/`、`admin-dashboard/`、`eslint.config.mjs`。

## 五、契约核对（contractChecks）

`contractChecks`：

- taskId：AF-575 贯穿任务单、交付记录、回执与状态索引。
- state-write：register / promote / run-once 均经 CLI。
- index-schema：任务单 frontmatter 与回执七组字段齐全。
- event-chain：AF-572/573/574/575 流转均由 CLI 写入事件链。
- engine-boundary：`src/engine-core` 零 diff。
- scope-domain：回执 commit 集合的文件均落在 AF-575 scope。

## 六、遗留项（backlogItems）

`backlogItems`：

- `BL-AF575-01`：本机 363 并发 worker 下，`af073-batch-report-cli` 4 个 `spawnSync` CLI 用例与 `wp12` / `crud.service` 重型 hook 会触及 30s/10s 超时，标准 `pnpm test` 间歇红；串行与隔离复跑均通过。建议另立测试基础设施任务评估提高 CLI 超时或固定本地 `maxWorkers`，不改断言。

## 七、偏差表（deviationTable）

`deviationTable`：

| 任务单口径 | 实际情况 | 处置 |
| --- | --- | --- |
| AF-573 回执 conditional-pass | 编排器判 rejected 并归档，任务终态不可改 | 依次登记 AF-574、AF-575 返修任务 |
| 标准 `pnpm test` | 本机并发冷启动 4 例超时；全量串行 0 失败 | AF-575 测试闸门显式写为 `--no-file-parallelism`，回执记录真实命令，不改 `test/` |
| AF-574 scope 未含 AF-572 记录包 | 回执 commit `20c81c92` 新增 AF-572 任务包，被判越域 | AF-575 scope 显式纳入 AF-572/573/574/575 四个记录包 |

## 八、验收结论（reviewVerdict）

`reviewVerdict`: **passed**。

lint 覆盖已扩展到 `scripts/ops/quality` 的 14 个 TS 文件并清零至 0/0；`pnpm lint`、`pnpm typecheck` 均 0 error；全量 5143 用例串行 0 失败；`src/engine-core` 零 diff；回执 commit 集合全部落在 scope。
