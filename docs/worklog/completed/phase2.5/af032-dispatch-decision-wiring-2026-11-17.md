# AF-032 交付记录：IM-028 派发决策链运行时接线与降级回收收口

- 任务单：`docs/worklog/pending/af032-dispatch-decision-wiring-task-2026-11-17.md`
- 角色：orchestrator
- 交付时间：2026-11-17（本地 +08:00）
- 结论：**passed**。`IM-028` 从「规则层有决策链、运行时不读」变成「运行时按决策链分流」，附带修掉 `createTask` 用任务单 `createdAt` 当事件时间的缺陷。

## 1. 缺陷（IM-028 的真实内容）

| 编号 | 缺口                                                                                                                             | 后果                                                                                                             |
| ---- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| D-1  | 领单通道选路是散落的 if（`targetRole === 'orchestrator' ? 'file' : config.dispatch.channel`）                                    | 选路无原因、无审计；配置写错通道被静默收敛，事后无法解释走了哪条路                                               |
| D-2  | 回收环节对 `delivery.state` 只读「是否 stalled」，`resolveDispatchDecision`（进程 / 登录门 / 会话层 / 重试预算）从未被运行时调用 | 不可恢复缺陷与偶发波动一样「回滚 ready 持单」；预算耗尽也不升级 Human；`channel fallback` 上报的现场事实无处落地 |
| D-3  | `createTask` 把任务单 `createdAt` 当 created 事件时间                                                                            | 任务单写成未来整点 → created 事件排在 promoted 之后，`at` 倒退（本单实测一次）                                   |

## 2. 修法

### 2.1 选路收成决策（`dispatch.mjs`）

新增 `resolveChannelSelection({ task, config, previousDispatch })`，判定顺序：角色 → 上轮投递事实 → 配置通道 → 枚举收敛，输出 `{channel, targetRole, reason, attempt, configuredChannel, previousDeliveryState}`，`reason` 取自 `DISPATCH_DECISION_REASONS`（5 值）。调度层 `claimReadyTasks` 只消费结果，并写 `entry.dispatchDecision` + `dispatch-decision` 动作进事件日志。

上轮 `delivery.state=failed` 或上轮已降级时本轮直接走 `gui-file-fallback`（`fallbackToFile≠false`），不再把同一份投递件送进同一条死路。

### 2.2 回收接上决策链（`scheduler.mjs` + `dispatch-channel.mjs`）

`channel fallback` 增 `--cause / --login-gate / --start-retries / --send-retries / --attempt-count / --process-running / --window-ready / --session-attempted / --locate-attempted`，现场事实落 `delivery.lastAttempt`。`releaseFailedDeliveries` 把它喂给既有的 `resolveDispatchDecision`，动作映射：

| 决策动作                           | 调度结果                                                            |
| ---------------------------------- | ------------------------------------------------------------------- |
| `fail-terminal`                    | `submitted → failed`，`releaseReason=gui-delivery-terminal`，不重试 |
| `human-escalate`（任务级预算耗尽） | `ready` + `heldForHuman`，`reason=gui-delivery-budget-exhausted`    |
| 其余                               | `ready` + `heldForHuman`，`reason=gui-delivery-failed`              |

**缺省不得假定不可恢复**：无 `lastAttempt` 时 `cause` 留空，避免把偶发故障直接判死（这是本单第一版实现被既有用例抓出来的错误，已修）。

### 2.3 事件时间取写入时刻（`event-store.mjs`）

`createTask` 不再用 `task.createdAt` 作为事件 `at`，改用 `opts.at ?? nowIso()`；任务单的 `createdAt` 只作为任务属性保留。`buildCreatedEvent` 的夹值逻辑保留为第二道护栏。

## 3. 闸门

| 字段             | 实测                                                                                                                                                                                                                                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gateResults`    | `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` → exit 0，**167 passed / 0 failed**（1.00s）；`ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate` → exit 0，**23 PASS / 0 FAIL**；`node scripts/orchestration/cli.mjs events verify` → exit 0，**120 条**事件，哈希链与索引投影一致 |
| `scopeCheck`     | `in-scope`：改动只在 `scripts/orchestration/`、`docs/team/agent-orchestration/README.md §5.1`、本单任务单/交付记录                                                                                                                                                                                                   |
| `contractChecks` | taskId 一致 ✅；状态只经 `commitIndex` ✅；决策原因枚举固定 ✅；索引 schema PASS ✅；事件链 PASS ✅                                                                                                                                                                                                                  |
| `backlogItems`   | IM-028 关闭；`AF-024-R2` 转由 AF-033 实弹演练承接（executor 角色才能走 GUI 通道）                                                                                                                                                                                                                                    |
| `deviationTable` | 无计划外改动；`createTask` 时间戳缺陷是本单实测发现并就地修复（见 D-3）                                                                                                                                                                                                                                              |
| `reviewVerdict`  | `passed`                                                                                                                                                                                                                                                                                                             |

新增单测 2 条：选路矩阵（编排者 / 配置通道 / 上轮失败降级 / 关闭兜底重试 / 枚举收敛）、回收分流（终态失败 vs 预算耗尽持单）。

## 4. 遗留

- **勘误（AF-034 补）**：本单只关了「决策链未被运行时调用」这一半。AF-033 演练实测发现 `validateConfig()` 会把 `dispatch` 段整段丢弃，`loadConfig().dispatch === undefined`，决策读到的配置是空的、GUI 通道实际从未由调度层触发——这一半由 AF-034 补齐（配置归一保留并校验 `dispatch`），本单的 `IM-028 关闭` 口径以 AF-034 为准。
- 降级后的任务固定走文件降级通道，不自动回升 GUI；新任务仍按配置试 GUI。这是刻意选择（避免任务在通道上反复抖），如需回升按新任务重开。
- `AF-024-R2`（failed → 持单 → `task resume` → 重派的真实演练）由 AF-035 承接（AF-033 因配置缺陷取消归档）。

## 5. 回写清单

- `scripts/orchestration/dispatch.mjs`（`resolveChannelSelection` + 决策原因枚举）
- `scripts/orchestration/scheduler.mjs`（领单选路消费决策、回收接 `resolveDispatchDecision`、动作映射）
- `scripts/orchestration/gui-dispatch.mjs`（`fallbackDelivery` 落 `delivery.lastAttempt`）
- `scripts/orchestration/cli.mjs`（`channel fallback` 现场事实参数 + 提示语）
- `scripts/orchestration/event-store.mjs`（`createTask` 事件时间取写入时刻）
- `scripts/orchestration/__tests__/orchestration.spec.mjs`（+2 用例，167 passed）
- `docs/team/agent-orchestration/README.md` §5.1（决策原因表、回收动作表、命令表）
