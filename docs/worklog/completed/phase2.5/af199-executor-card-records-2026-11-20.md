# AF-199 · 收口 executor 记录目录资源域

- 任务：AF-199（`phase2.5-orchestration-closed-loop`）
- 类型：fix
- 基线：`ca25d2e79abefef67d219a82a0c969f0c192da9d`
- 分支：`task/AF-199-executor-card-records`
- 日期：2026-11-20
- 结论：资源域口径与 CI 两阶段提交一致

## 根因与处置

executor Agent Card 的 `resources` 未包含 `docs/worklog/records/`，带记录的任务在调度层被 `validateScopeDomain` 拦截；而 CI 又要求任务单与实现同提交。处置为在 `resources` 增加 `docs/worklog/records/`，代码域与 `cannotDo` 不动。

## gateResults

| 命令 | 结果 | 证据 |
| --- | --- | --- |
| `pnpm orchestration:validate` | exit=0 | Agent Card / 契约 / 事件链 / 索引投影 PASS |
| `node scripts/orchestration/cli.mjs worklog verify --strict` | exit=0 | 归档 210 / 记录包 210 |
| `git diff --stat HEAD -- src/engine-core` | 空 | 纯配置修正 |

## scopeCheck

仅 Agent Card、AF-199 记录包与本文交付记录；无业务代码、无策略放宽。

## contractChecks

| 项 | 结果 | 说明 |
| --- | --- | --- |
| taskId | pass | AF-199 贯穿任务单、回执与记录 |
| state-write | pass | 状态只经 CLI |
| agent-card | pass | 资源域与框架 roles 口径一致 |
| engine-boundary | pass | engine-core 零 diff |

## backlogItems

无。

## deviationTable

无。

## reviewVerdict

`passed`：最小资源域修正，直接闭环调度与 CI 的口径冲突。
