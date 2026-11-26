# AF-526 · 验证环境隔离加固：BullMQ 命名空间 + 会话租约

- 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-526/task-sheet.md`
- 基线：`9d700bf865db82a782d2be337688c52489f0f48e`
- 分支：`task/AF-526-environment-isolation`
- 结论：已完成；双实例串扰的两个代码面均已收口，未跑 1000 场批次。

## 1. 背景与病根

AF-524 定向复刻期间出现两次环境串扰：

1. 本地实例接共享 Redis `DB0`，BullMQ prefix 固定 `bullmq`，远端 / 旧 worktree 的 `bullmq:auto-practice` worker 抢走本地 job，报“引擎调试面板接口未启用”。
2. `af281r` 工作树重启时，`PracticeRunnerService.onModuleInit` 把共享 MySQL 里所有 `status='running'` 的场次一律标成 `failed/interrupted`，把本机正在跑的场次短暂误标。

本任务只修代码面的两个根因，不改部署拓扑，不跑新批次。

## 2. 改动

### 2.1 BullMQ 队列命名空间

新增 `src/shared/infra/queue/bullmq-prefix.ts`：

- `BULLMQ_PREFIX` 显式配置优先；
- `production` / `test` / Vitest 未配置时回落 `bullmq`，存量生产队列与既有测试断言不变；
- `development` 未配置时生成 `bullmq:dev:<REDIS_DB>:<主机名>:<工作树哈希>`；同一工作树重启稳定，不同工作树 / DB 自动隔离；
- 主机名做字符归一化，空主机名回落 `unknown-host`。

全仓 8 个队列文件、14 处 `Queue` / `Worker` 构造统一改为同一入口：

- `src/auto-practice/practice-queue.service.ts`
- `src/engine-adapters/deliberation/deliberation.processor.ts`
- `src/shared/infra/queue/audit-log.processor.ts`
- `src/agent/supervisor/supervisor.processor.ts`
- `src/counselor/providers/turn-analysis.processor.ts`
- `src/counselor/providers/counselor-supervision.processor.ts`
- `src/knowledge-base/providers/scheduled-publish.service.ts`
- `src/knowledge-base/providers/scheduled-publish.processor.ts`

### 2.2 自动对练会话租约

新增 `src/auto-practice/practice-session-lease.service.ts`：

- key：`<REDIS_KEY_PREFIX>practice:lease:<practiceSessionId>`；
- acquire：`SET NX EX 30`，值为进程唯一 owner token；
- heartbeat：每 10 秒续租，Lua `GET` 到 owner 才 `EXPIRE`；
- release：Lua compare-and-delete，只删自己的 key；
- 用 BullMQ 专用连接（无 ioredis keyPrefix）+ 显式拼 `REDIS_KEY_PREFIX`，避免 Lua 脚本里 keyPrefix 不生效导致删错 key；
- 进程退出只清 timer，租约靠 TTL 自然回收，不在 shutdown 做网络调用。

`PracticeRunnerService`：

- `onModuleInit` 改为先查 running 行，再逐场确认租约；只对“无活跃租约”的 id 集合执行 `update({ id: In(orphanIds), status: 'running' }, ...)`；
- 未注入租约服务、Redis 故障时跳过本轮清理并显式告警，不退回全表标记；
- `run()` 在落 running 行前 acquire 租约，抢不到 / Redis 异常时关引擎会话、落 `failed / lease_unavailable` 行并返回，不进入对话循环；
- 租约覆盖整个运行期，`try/finally` 在终态落库后释放；
- 新依赖作为可选尾参，既有 10 处直接 `new PracticeRunnerService(...)` 的单测不需改造。

`AutoPracticeModule` 注册 `PracticeSessionLeaseService`；`redis.constants.ts` 增加 `practiceLease` key 模板；`.env.example` 增加 `BULLMQ_PREFIX` 可选说明，不改实际 `.env`。

### 2.3 运行手册

新增 `docs/runbooks/validation-environment-isolation.md`：两层隔离、本机验证配置、Redis key 自检、1000 场批次前检查清单、旧代码实例风险。

## 3. 与任务单的偏差

1. 任务单原以 `AF-525` 登记，`agentRole: orchestrator`；`run-once` 报 `scope-domain-conflict`（orchestrator 资源域不含 `src/` / `test/`），未领单、未改代码。按框架规则重签发为 `AF-526`（`agentRole: executor`），AF-525 以 `canceled` 归档，代码全部落在 AF-526。
2. AF-526 任务单复制自 AF-525，正文标题与 `artifacts.path` 仍残留 `AF-525` / `af525` 字样；任务单登记后不可变，未回改。实际交付记录使用本文件 `af526-environment-isolation-2026-11-26.md`，以此为准。
3. 未做真实双实例队列 smoke；用构建产物解析 smoke + 单测覆盖前缀行为，运行手册给出双实例自检命令。

## 4. 闸门

| 闸门 | 结果 |
| --- | --- |
| `pnpm build` | exit 0（`C:\Users\Admin\AppData\Local\Temp\af526-build.log`） |
| `pnpm typecheck` | exit 0（`af526-typecheck.log`） |
| `pnpm lint` | exit 0，0 error / 0 warning（`af526-lint.log`） |
| 目标测试 | 5 文件 56 用例全绿（`af526-target-tests.log`） |
| `pnpm test` | 352 passed / 1 skipped；5045 passed / 4 skipped（`af526-full-tests.log`） |
| `git diff --stat HEAD -- src/engine-core` | 空 |
| 构建产物前缀 smoke | `NODE_ENV=development REDIS_DB=5` → `bullmq:dev:5:DESKTOP-E3EVQ9P:186f0d61` |

## 5. 风险与边界

- 本修复只保护升级后的新实例；旧代码实例仍会用写死的 `bullmq` 前缀，并在启动时无差别标记所有 running。1000 场批次前必须停止 / 升级旧 worktree 实例，这是环境纪律。
- 租约采用 fail-closed：Redis 不可用时拒绝开跑并落 `failed / lease_unavailable`，不会在无租约状态下落 running 行；启动清理在 Redis 故障时跳过，宁可留孤儿也不误标活跃场次。
- 租约不新增 DB 列、不做 migration；崩溃后租约最多 30 秒自然过期。
- 未改 `.env`、生产部署拓扑、admin-dashboard、Flutter、engine-core。

## 6. 提交

`feat(af526): 隔离 BullMQ 队列命名空间并为自动对练加会话租约`
