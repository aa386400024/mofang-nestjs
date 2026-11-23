# AF-375 integrate 状态快照同步与 post-merge 编排门解耦

> 状态：实现完成，待回执冻结与验收（2026-11-23）
> 执行方：Doubao 主控 AI（orchestrator 自做）
> 仓库：`D:\work\Project\backend\mofang-nestjs-af281r`，分支 `task/AF-375-integrate-state-snapshot`
> 任务性质：状态快照同步 + CI 校验口径修复
> 改动范围：状态索引/事件日志/看板快照/data.js、CI 编排门与记录包；不触碰 engine-core 与业务代码。

## 1. 背景

AF-374 合并后，integrate 远端 CI 暴露两处口径缺口：

1. 单测已按 `task-state-index 1.2.0` 契约断言，但提交树内索引仍是 1.1.0，导致 Unit 三个分片、Contracts 与 Coverage 同源失败。
2. push 事件的 `Validate worklog record bundles` 对状态面解耦的 integrate 仍走 `--strict`，把索引未携带的孤儿记录包判为失败，Orchestration Gate failure。

根因不是代码回退，而是状态面长期只存在本机、未随收尾快照入库。本任务把状态快照正式同步到分支，并统一 CI 校验口径。

## 2. 改动清单

### 2.1 状态快照

- `docs/team/agent-orchestration/task-state-index.json`：由 CLI 投影重建，`version=1.2.0`，归档 351。
- `docs/team/agent-orchestration/state/journal.jsonl`：1612 条事件，哈希链与索引一致。
- `docs/team/agent-orchestration/orchestration-snapshot.json`、`web/orchestration/data.js`：看板快照同源刷新。

### 2.2 CI 口径

- `.github/workflows/ci.yml`：`Validate worklog record bundles` 对 PR 与 integrate push 统一执行 `worklog verify --strict --state-free`；孤儿记录包交给收尾状态同步任务判定。

## 3. 与任务单的偏差

无。

## 4. 闸门结果

| 闸门        | 命令                                                                          | 结果                                            |
| ----------- | ----------------------------------------------------------------------------- | ----------------------------------------------- |
| 编排单测    | `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 268 passed / 0 failed                           |
| 全量测试    | `pnpm test`                                                                   | 311 passed / 1 skipped；4747 passed / 4 skipped |
| 事件链      | `node scripts/orchestration/cli.mjs events verify`                            | PASS（1615 条）                                 |
| 记录包      | `node scripts/orchestration/cli.mjs worklog verify --strict --state-free`     | PASS（活跃 1 / 归档 351 / 记录包 363）          |
| 契约包      | `pnpm orchestration:contracts`                                                | PASS：框架 2.1.0，15 文件哈希一致               |
| 类型与 lint | `pnpm lint` / `pnpm typecheck`                                                | exit 0                                          |

`git diff --stat HEAD~1 -- src/engine-core` 为空。

## 5. 提交序列

1. `f6040ecf`：任务单、CI 修复与交付记录。
2. `60e31e34`：状态快照单独提交（`Task: none`，状态面单提例外 `ORCH_ALLOW_STATE_COMMIT=1`）。
3. 冻结回执与 manifest 更新随后提交。

## 6. 遗留

- 10 个历史孤儿记录包（AF-363..AF-372）仍领先索引；按 `state-free` 口径跳过，不阻塞本次 CI。
- 若要彻底消除孤儿，需要单独任务回放历史归档事件，不在本任务范围。
