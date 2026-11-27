# AF-574 · quality 脚本 lint 闸门返修验收 — 交付记录

- **任务单**：`docs/worklog/records/phase2.5-toolchain/AF-574/task-sheet.md`
- **前序任务**：AF-573（实现与原始闸门证据）、AF-572（scope 重签发原单）
- **分支**：`task/AF-574-quality-scripts-lint`
- **基线**：`cf830014158bff0547eb05d0aa3e6ce8b8234409`
- **日期**：2026-11-27
- **性质**：返修验收，R1，standard gate

## 一、返修原因

AF-573 已完成 `scripts/ops/quality` 14 个 TS 脚本的 lint 清零（185 errors / 4 warnings → 0/0），并把目录纳入 `pnpm lint` / `lint:fix`。实现提交：

- `aed982305f788ade7a65ddd5c55e9de275f5bfc6` — lint 覆盖 + 脚本修复 + 交付记录
- `20c81c921af55744c9af0a8a016072322d39b09e` — AF-572/573 记录包
- `9cb997f1ef34028eb5dbfbbab749c2ae5063bc42` — 交付记录补记测试证据
- `cf830014158bff0547eb05d0aa3e6ce8b8234409` — 冻结回执与 manifest

AF-573 回执取 `conditional-pass`，原因是本机标准 `pnpm test` 在 363 并发 worker 下，`test/auto-practice/af073-batch-report-cli.spec.ts` 的 4 个 `spawnSync` CLI 用例触及 30s 内置超时。编排器按门禁判 `rejected` 并归档。本返修任务不改实现，只以真实全量通过证据重出 `passed` 回执。

## 二、复核证据

| 闸门 | 结果 |
| --- | --- |
| `pnpm exec eslint "scripts/ops/quality/**/*.ts"` | exit 0；14 文件 0 error / 0 warning |
| `pnpm lint` | exit 0；全仓 0 error |
| `pnpm typecheck` | exit 0；0 error |
| `pnpm exec vitest run --exclude "**/e2e/**/*.ts" --no-file-parallelism` | exit 0；362 passed / 1 skipped 文件，5143 passed / 4 skipped 用例，0 失败，3586.86s |
| `git diff --stat HEAD -- src/engine-core` | 输出为空 |
| 三个超时文件隔离复跑 | 48 passed / 0 failed |

标准并发 `pnpm test` 的失败已复现为环境冷启动抖动：`--maxWorkers=64` 仍出现 5 例超时，单文件复跑全部通过；全量串行执行 0 失败。该问题登记为 `BL-AF574-01`，属测试基础设施，不在本单改 `test/`。

## 三、偏差与边界

1. **返修未新增业务改动**：代码与 AF-573 相同，只重出验收记录与回执。
2. **闸门命令采用串行全量**：为规避本机并发冷启动超时，task sheet 的测试闸门写为 `--no-file-parallelism`，用例与断言未改。
3. **标准 `pnpm test` 仍可能在本机间歇红**：已登记遗留，建议另立任务评估提高 CLI 超时或固定本地 `maxWorkers`。
4. **AF-572 重签发事实保留**：AF-572 canceled/archived，AF-573 rejected/archived，AF-574 为返修验收任务，priorTasks 串起两条链。

## 四、机读字段

| 字段 | 内容 |
| --- | --- |
| taskId | AF-574 |
| contextId | phase2.5-toolchain |
| type | fix |
| agentRole | orchestrator |
| baselineRef | cf830014158bff0547eb05d0aa3e6ce8b8234409 |
| priorTasks | AF-573, AF-572 |
| scopeCheck | in-scope |
| reviewVerdict | passed |
| implementationCommits | aed98230, 20c81c92, 9cb997f1 |
