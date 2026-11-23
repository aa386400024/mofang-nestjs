# AF-351 · 修正多任务编号提交 · 交付记录

- 任务：`AF-351`
- 分支：`task/AF-349-bdi-semantic`
- 提交：`448bd65f80fbc077ad1c667f0e3bb877126ebb4e`
- 日期：2026-11-23

## 1. 问题

AF-350 的提交标题同时出现 `AF-350 / AF-347 / AF-348`，`ci-task-gate.mjs` 判为 `ambiguous-task-id`，PR #172 的 `Orchestration Gate` 在“Validate every commit against its own task snapshot”步骤失败。

本地复现：

```
[ORCH-CI-GATE] FAIL 6d512cfc1c4c reason=ambiguous-task-id subject=docs(orchestration): AF-350 补齐 AF-347/AF-348 取消任务交付指针
  - 提交标题含多个任务编号：AF-350、AF-347、AF-348
```

## 2. 处理

- 用 `git reset --soft 5620a89159e7bd4c59b350d89f6bac9e264443d3` 把 AF-350 的两次收口提交合回索引，未丢弃任何文件内容。
- 以单任务编号 `AF-351` 重新提交：`docs(orchestration): AF-351 统一取消任务指针提交`。
- 提交内容与原两次提交等价：AF-347 / AF-348 取消记录、AF-350 任务单/回执/交付记录、状态索引、事件链、看板快照。
- 未改任何证据文件内容，未改代码。

## 3. 结果历史

```
3e3b98c7 chore(orchestration): AF-349 登记 BDI 决策链修复任务
9282f477 feat(orchestration): AF-349 BDI 决策链语义与状态机制修复批次
5620a891 chore(orchestration): AF-349 回执摄入与归档
448bd65f docs(orchestration): AF-351 统一取消任务指针提交
```

每个提交标题只含一个任务编号。

## 4. gateResults

| 命令 | 退出码 | 结果 |
| --- | ---: | --- |
| `node scripts/orchestration/ci-task-gate.mjs --base origin/integrate --head HEAD --require-accepted --task-id task/AF-349-bdi-semantic` | 0 | 4 个提交全 pass；ACCEPTANCE AF-349 pass=true |
| `pnpm orchestration:preflight` | 0 | PASS task=AF-351 status=submitted files=12 |
| `node scripts/orchestration/cli.mjs worklog verify --strict` | 0 | PASS |

## 5. scopeCheck

`in-scope`：只改 `docs/worklog/completed/`、`docs/worklog/records/` 与状态面，未改代码。

## 6. contractChecks

| 检查项 | 结果 | 说明 |
| --- | --- | --- |
| taskId | pass | AF-351 经 CLI register / promote / run-once |
| state-write | pass | 状态面由 CLI 写 |
| index-schema | pass | 登记由 CLI 完成 |
| no-evidence-change | pass | 原 AF-347/348/349/350 文件内容未改 |
| no-code-change | pass | 纯文档与历史消息修正 |

## 7. backlogItems

- `AF351-B1`：`ci-task-gate` 对提交标题的多任务编号判定应在登记阶段就暴露，而不是等 CI；建议在 `task-entry-gate` 增加同款正则预检。

## 8. deviationTable

| 任务单写法 | 实际情况 | 处理 | 理由 |
| --- | --- | --- | --- |
| 只重写提交消息 | 原提交已在远端 | 需 force-with-lease 重写任务分支 | 保持证据文件不变，只改历史消息 |

## 9. reviewVerdict

**`passed`。**

- 本地逐提交门 4/4 pass；
- `worklog verify --strict` pass；
- 证据内容零改动，只改提交边界。

## 10. 已知限制

远端仍需 force-with-lease 推送后，PR #172 的 Orchestration Gate 才会重新计算。若分支保护拒绝 force push，则需关闭 PR 并以新分支重开。
