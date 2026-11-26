# AF-549 · executor 资源域补齐 pnpm-lock

日期：2026-11-26
分支：`task/AF-549-executor-lockfile-resource`
基线：`2414d749835df16fe560038fd4b1868bcf598e14`

## 改动

- `docs/team/agent-orchestration/agent-cards/executor.json`
  - `resources` 新增 `pnpm-lock.yaml`。

## 原因

AF-548 登记后 `run-once` 返回 `scope-domain-conflict`：任务 scope 中的 `pnpm-lock.yaml` 不在 executor Agent Card 的资源域内。依赖安装必须同时改 `package.json` 与 lockfile；只允许前者会让变更落在 scope 之外，或迫使绕过门禁。

本任务只补资源域声明。`limits.cannotDo` 与 `requiresApproval` 未改：新增依赖仍需任务单显式声明并经编排登记，不是放开依赖审批。

## 验证

| 命令 | 结果 |
| --- | --- |
| `node scripts/orchestration/cli.mjs validate` | 见回执 |
| `pnpm typecheck` | 见回执 |
| `pnpm lint` | 见回执 |

`src/engine-core` 无改动。

## 后续

AF-548 已因本缺口取消并归档；GraphQL 深度限制以新任务承接，任务单显式声明 `pnpm-lock.yaml`。
