# AF-527 验证边界收口：旧实例清理 + 双实例队列隔离 smoke

- 任务：AF-527（verification）
- 分支：`task/AF-527-validation-boundaries`
- 基线：`40986c804f35c4520fbee769cac2228ca093898c`（AF-526 合并后的 integrate）
- 结论：`passed`

## 1. 旧实例清理

盘点时本机仍有三条 `af281r` 旧工作树进程：

| PID | 类型 | 命令 | 处理 |
| --- | --- | --- | --- |
| 13352 | 后端 watcher | `nest start --watch` | 已停止 |
| 38884 | 后端 app | `dist/app`，监听 3000 | 已停止 |
| 46400 | 管理后台前端 | `admin-dashboard/vite` | 保留（不参与队列/启动恢复） |

`af281r` 源码仍写死 `prefix: 'bullmq'`（`practice-queue.service.ts` 第 154、164 行），确认是旧代码实例。停止后复核：

- `3000` 端口无监听；
- 进程列表中不再有 `af281r` 的 `nest start --watch` / `dist/app`；
- `oldBackendCount=0`。

证据：

- `docs/worklog/completed/phase2.5/af527-evidence/process-before.json`
- `docs/worklog/completed/phase2.5/af527-evidence/process-after.json`

## 2. 双实例队列隔离 smoke

新增 `scripts/validation/queue-isolation-smoke.mjs`：

- 在同一 Redis DB（`REDIS_DB=5`）上启动两个独立 Worker 进程；
- 两个进程分别使用 `BULLMQ_PREFIX=af527-smoke-a` / `af527-smoke-b`；
- 生产者向两边各入 2 个 `af527-smoke` job；
- 断言 A 只消费 `A1/A2`、B 只消费 `B1/B2`；
- 断言两个前缀的 key 命名空间不交叉；
- 结束后 `obliterate` smoke 队列，复查两套前缀 key 均为 0。

实测结果：

```json
{
  "ok": true,
  "prefixes": { "a": "af527-smoke-a", "b": "af527-smoke-b" },
  "consumed": { "a": ["A1", "A2"], "b": ["B1", "B2"] },
  "keyCounts": { "a": 5, "b": 5 },
  "redis": { "host": "117.72.30.78", "port": 6379, "db": 5 },
  "workers": { "a": 57396, "b": 59940 }
}
```

清理后复查：`af527-smoke-a:*` = 0，`af527-smoke-b:*` = 0。

证据：

- `docs/worklog/completed/phase2.5/af527-evidence/queue-smoke.json`
- `docs/worklog/completed/phase2.5/af527-evidence/queue-smoke-cleanup.json`

## 3. 闸门

| 命令 | 结果 |
| --- | --- |
| `pnpm build` | exit 0 |
| `pnpm lint` | exit 0（含 `scripts/**/*.mjs`） |
| `node scripts/validation/queue-isolation-smoke.mjs` | exit 0，A/B 无交叉 |
| `git diff --stat HEAD -- src/engine-core` | 输出为空 |
| `node scripts/orchestration/cli.mjs events verify` | PASS |
| `node scripts/orchestration/cli.mjs worklog verify --strict --state-free` | PASS |

## 4. 与任务单的偏差

- 双实例 smoke 使用两个独立 Node Worker 进程，没有启动两个完整 Nest 应用：这样只验证 BullMQ 前缀与消费隔离，不引入共享 MySQL 启动清理、HTTP 端口和额外业务副作用；`resolveBullPrefix` 取自构建产物，仍是真实 Redis + 真实 BullMQ。
- 保留 `af281r/admin-dashboard` 的 vite 进程（PID 46400）：它不消费队列、不参与启动恢复，不属于本次旧代码实例风险面。

## 5. 遗留 / 后续

- 1000 场出口⑤批次本次未启动，未产生 LLM 费用。
- 后续如果要把双实例 smoke 提升到完整 Nest 双实例，可另立任务覆盖 `PORT` 隔离、启动清理日志与 HTTP 健康检查；本次边界只到队列命名空间。
- `af281r` 的 vite 进程仍在运行，若后续要彻底清理旧工作树，需要单独确认后再停。
