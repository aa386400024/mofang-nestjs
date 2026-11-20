# AF-107 交付记录：executor Agent Card 资源域覆盖 bin

- 任务单：`docs/worklog/pending/af107-executor-card-resource-domain-task-2026-11-18.md`
- 基线：`c1bb8750f996faf74e1350c85e101d88967105d0`
- 类型：implementation（框架资源域修正）
- 提交：`b7b7e17`（`feat(orchestration): AF-107 executor 资源域覆盖 bin`）
- 快照：2026-11-18 22:46 CST

## 1. 现象与根因

AF-106（推理块零泄漏 + 8 角色池）登记后被 `run-once` 拦下：
动作 `scope-domain-conflict`，原因 `bin/seed-character-profiles.ts` 不在 executor
Agent Card 的 `resources` 资源域。

根因不是任务 scope 写错，而是**卡片声明与真实执行域不一致**：
`bin/` 是本仓种子 / 运维脚本目录，executor 在既有任务里已经执行过这些脚本，
但卡片只声明了 `src/` / `test/` / `docs/worklog/{pending,completed}/`。

## 2. 修复

`docs/team/agent-orchestration/agent-cards/executor.json`：

- `resources` 增加 `bin/`；
- `cannotDo` / `requiresApproval` 一字未改（仍不提交、不推送、engine-core 例外需批准）。

## 3. 闸门

| 闸门 | 命令 | 结果 |
| --- | --- | --- |
| 卡片声明 | `node -e "...resources.includes('bin/')..."` | exit 0，`resources=src/,bin/,test/,docs/worklog/pending/,docs/worklog/completed/` |
| 边界 | `git diff --stat HEAD -- src/engine-core` | 空输出，engine-core 零 diff |

## 4. Scope

- 修改：`docs/team/agent-orchestration/agent-cards/executor.json`、任务单、状态面
- 未改：scheduler 域校验规则、executor 权限约束、任何业务代码
- 并行产物：AF-108 的实现改动（`src/**` / `bin/seed-character-profiles.ts` / `test/**`）
  仍为未提交状态，未纳入本提交

## 5. 结论

资源域已与真实执行域对齐；AF-108 可在不绕过域校验的前提下继续实现。
