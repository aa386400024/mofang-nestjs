# AF-521 · AF-393 修复后的生产批次与 long 会话灰度验证

> taskId: AF-521
> contextId: phase2.5-orchestration-closed-loop
> baselineRef: a721af85e6fcd69d0d295da0c7cfae541da2a414
> finalStatus: completed
> reviewVerdict: passed
> 日期：2026-11-26

## 1. 落地

用当前 `integrate` HEAD（`100ca2dd`，工作树 `a721af85`）重新构建并启动实例，在隔离 Redis DB5 上跑完两批真实对练：

- 生产批次 `NdkPh-flsoT5dO_re-0TC`：24 场 / 475 轮，24/24 completed，`batchHealth.valid=true`。
- long 批次 `D10-b0XnYa0iOcDjjzxbY`：4 场 / 156 轮，4/4 completed，`batchHealth.valid=true`。
- 合计 28 场 / 631 轮 / 957,211 tokens / ¥1.46039；0 失败场次。
- 危机样本 3 场，全部 `safety_plan_completed`，`incomplete=0`。

批次证据（可入库副本）：

- `docs/worklog/completed/phase2.5/af521-evidence/summary.json`
- `docs/worklog/completed/phase2.5/af521-evidence/batch-24.json`
- `docs/worklog/completed/phase2.5/af521-evidence/batch-4.json`

原始副本同时留在 `data/phase25-exit/af521-af393-postfix-batch/`（`data/phase25-exit/` 被 `.gitignore` 忽略，故另存 docs 副本）。

## 2. 闸门证据

### gateResults

| 闸门 | 命令 | 结果 |
| --- | --- | --- |
| 构建 | `pnpm build` | exit 0 |
| 类型 | `pnpm typecheck` | exit 0，0 error |
| Lint | `pnpm lint` | exit 0，0 error |
| 源码范围 | `git diff --stat HEAD -- src test` | 空 |
| 内核 | `git diff --stat HEAD -- src/engine-core` | 空 |
| 事件链 | `node scripts/orchestration/cli.mjs events verify` | PASS：2142 条事件，哈希链与索引投影一致 |
| 生产批次 | `GET /admin/api/auto-practice/batches/NdkPh-flsoT5dO_re-0TC` | total=24，completed=24，valid=true，llmCallRatio=1，fallbackRatio=0，counterConsistent=true |
| long 批次 | `GET /admin/api/auto-practice/batches/D10-b0XnYa0iOcDjjzxbY` | total=4，completed=4，valid=true，llmCallRatio=1，fallbackRatio=0.01，counterConsistent=true |

### 关键数字

| 批次 | 场次 | 轮次 | Tokens | 成本 | 危机场次 | incomplete | safety_plan_completed |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 生产 24（legacy, maxTurns=20） | 24 | 475 | 682,716 | ¥1.042188 | 2 | 0 | 2 |
| long 4（long, maxTurns=50） | 4 | 156 | 274,495 | ¥0.418202 | 1 | 0 | 1 |
| 合计 | 28 | 631 | 957,211 | ¥1.46039 | 3 | 0 | 3 |

引擎版本：`v2026.11.16-6cfb46e-255-ga721af85-dirty`；promptVersion：`249cac9c8a289ad4`；deliberationMode 均为 `rule_only`。

### 与上一批对比

上一批 `hRW4V44-t43yyty_EyLke`（48 场 / 840 轮）：`incomplete=7`、`safety_plan_completed=2`、`escalated=1`。本批 28 场：`incomplete=0`、`safety_plan_completed=3`、`escalated=0`。

**结论边界**：本批只有 3 场危机样本，不能据此宣称“历史 7 场 incomplete 全部修复”。能确认的是：在相同角色/模式组合下，本批没有复现 `crisis_practice_max + incomplete`；危机收束一旦触发，3/3 都完成了风险五组。

## 3. 范围核对

`scopeCheck: in-scope`

- 只写 `docs/worklog/` 与 `data/phase25-exit/`；未改 `src/`、`test/`、`scripts/`、migration、`.env`、prompt。
- `git diff --stat HEAD -- src test` 与 `git diff --stat HEAD -- src/engine-core` 均为空。
- 未触碰 `admin-dashboard/` 与 Flutter 代码。
- 未把其他并行产物混入本单提交。

## 4. 契约核对

`contractChecks`

- taskId `AF-521` 贯穿任务单、批次证据、交付记录、回执。
- 状态面只经 `scripts/orchestration/cli.mjs` 写入；未手改 `task-state-index.json` / `journal.jsonl`。
- 索引 schema：`urn:agent-collaboration-framework:schema:task-state-index:1.2.0`。
- 事件链：`events verify` PASS，2142 条事件，哈希链与投影一致。
- 口径真相源：批次有效性读 `PracticeBatchHealthService` 输出的 `batchHealth`，未在报告里另算阈值。

## 5. 遗留

`backlogItems`

- **B1｜危机样本量不足**：本批仅 3 场危机。下一步建议针对历史 7 个 incomplete 组合（grief intermediate/expert、general cold/intermediate、workplace cold/expert、self_worth expert）各跑 3 repeats，或做种子受控的危机触发批次，目标至少 10 场危机样本。
- **B2｜共享 Redis 队列串环境**：`.env` 的 `REDIS_DB=0` 与远端实例共用；远端主机 `127.0.0.1` 上有 `bullmq:auto-practice` worker，会抢走本地入队的 job 并报“引擎调试面板接口未启用”。本地批次已改用 `REDIS_DB=5` 隔离；BullMQ 的 `prefix` 不读 `REDIS_KEY_PREFIX`，需要单独立项做队列命名空间隔离。
- **B3｜共享 MySQL 启动恢复会误伤本地长会话**：long 批次中 1 场 45 轮会话在 0:39:39 被标记“进程重启中断”，随后 BullMQ 第 2 次 attempt 重跑至 50 轮 completed。远端实例启动恢复扫描同一张 `ap_practice_sessions` 会命中本地 running 行；1000 场长批次前需要环境级 DB 隔离或租约保护。
- **B4｜AF-517 历史索引指针**：本地 `worklog verify --strict --state-free` 仍报 AF-517 的 `artifacts.taskSheet` 指向 `transport/tasks/AF-517.json`；CI 当前不阻塞，需在后续状态同步时修。
- **B5｜本地实例运行态依赖手动 env**：当前 3000 端口实例以 `REDIS_DB=5` 启动，未写进 `.env`；如果直接重启会回到 DB0，批次又会被远端 worker 抢。需要把开发环境默认队列隔离做成代码/配置层的显式能力，而不是每次手工注入。

## 6. 偏差表

`deviationTable`

| 项 | 任务单原方案 | 实际做法 | 原因 |
| --- | --- | --- | --- |
| D1 | 不改环境配置 | 启动进程时注入 `REDIS_DB=5` 与 `ENGINE_DEBUG_CHAT_ENABLED=true`，未改 `.env` | DB0 与远端 worker 共用，首批 24 场被远端抢走 22 场；不改 `.env` 但必须隔离运行态 |
| D2 | 只跑 24+4 两批 | 先在 DB0 跑了 `PMadjESNE1eTnDFLrhXkS`（22 failed / 2 running）和 `lW_Jqz9Slzm1j__QSBIws`（24 failed），两批全部排除，不作为证据 | 失败原因是环境串队列，不是产品行为；保留批次 ID 作为环境证据，结论只取 DB5 两批 |
| D3 | 证据落 `data/phase25-exit/` | 原始副本仍在 data，同时复制到 `docs/worklog/completed/phase2.5/af521-evidence/` | `data/phase25-exit/` 被 `.gitignore` 忽略，无法随 PR 入库 |
| D4 | 未要求全量测试 | 只跑 build / typecheck / lint / events verify，不跑 `pnpm test` | 本单无源码改动；全量测试按仓库口径只在源码任务收尾跑 |

## 7. 结论

`reviewVerdict: passed`

任务目标达成：当前 HEAD 构建实例上 24 场生产批次与 4 场 long 批次全部 terminal，两个批次有效性门均 `valid=true`；3 场危机样本全部 `safety_plan_completed`，`incomplete=0`。同时查明并隔离了一个会污染本地批次的共享 Redis DB0 远端 worker 问题。

安全门不能据此单独关闭：样本只有 3 场，且 κ / 督导师盲标仍未做。建议把 B1 作为下一项验证任务，B2/B3 作为 1000 场出口⑤之前的阻塞项。
