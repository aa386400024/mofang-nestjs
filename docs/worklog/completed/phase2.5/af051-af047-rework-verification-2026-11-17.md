# AF-051 交付记录 · AF-047 返修复验

- 任务单：`docs/worklog/pending/af051-af047-rework-verification-task-2026-11-17.md`
- 基线：`a27aba504b48b245f59a8f6ef1791310b68f94a9`（`integrate`）
- 交付时间：2026-11-17T17:30+08:00
- 类型：verification
- 结论：**passed**。AF-047 的强制编排门交付仍在位，正反门禁、205 例单测、typecheck、lint、57 项适配层校验全部通过；AF-047 原始终态 `rejected` 未被改写，AF-050 已修复导致误判的 V7 边界。

## 1. 返修背景

AF-047 的交付内容与时序均已完成，但首轮 `run-once` 被 V7 整棵工作树扫描误判为 `rejected`：把 `data/batch-reports/**` 与 `admin-dashboard/pnpm-lock.yaml` 等并行/清库产物算成了 AF-047 的越界变更。AF-050 已修复：

- 无 commit 事实时，V7 优先使用回执 `changedFiles` 声明集；
- 未声明的脏文件在 `parallelArtifactsExcluded=true` 时只留痕；
- 回执未标记并行的任务仍然失败，不默认放行。

本任务按返修路径复核同一交付集，提供可归档的 `completed` 载体，避免篡改 AF-047 的 rejected 终态。

## 2. 复验清单

| 交付件                                        | 状态 | 证据                                                       |
| --------------------------------------------- | ---- | ---------------------------------------------------------- |
| `AGENTS.md` 强制编排门                        | 在位 | 第 0 节四层约束与只读豁免                                  |
| `docs/team/conventions.md` §1.4               | 在位 | 强制准入四段                                               |
| `docs/team/agent-orchestration/README.md` §0  | 在位 | 准入、只读豁免、禁止替代、提交门禁、收尾                   |
| `docs/team/wp-task-template.md`               | 在位 | 通用写入型任务模板；`backlog` + `agentRole`                |
| `.husky/pre-commit`                           | 在位 | `pnpm orchestration:preflight                              |     | exit 1` 在 lint-staged 前 |
| `package.json`                                | 在位 | `orchestration:preflight` 脚本                             |
| `scripts/orchestration/task-entry-gate.mjs`   | 在位 | 任务匹配、状态、scope residual、状态面豁免                 |
| `scripts/orchestration/acceptance-runner.mjs` | 在位 | AF-050 声明集优先与并行留痕                                |
| `scripts/orchestration/receipts.mjs`          | 在位 | 回执 `changedFiles` / `parallelArtifactsExcluded` 入运行态 |
| 编排单测                                      | 在位 | 205 例，含 AF-050 V7 三组用例                              |
| 外置 Skill 与用户偏好                         | 在位 | 交接摘要与用户偏好记录可查；外置目录不入仓                 |

## 3. gateResults

| 命令                                                                          | 退出码 | 结果                                                  |
| ----------------------------------------------------------------------------- | ------ | ----------------------------------------------------- |
| `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 0      | 1 文件 / 205 用例 passed / 0 failed                   |
| `pnpm typecheck`                                                              | 0      | 0 error                                               |
| `pnpm lint`                                                                   | 0      | 0 error / 0 warning                                   |
| `$env:ORCH_REQUIRE_FRAMEWORK='1'; pnpm orchestration:validate`                | 0      | 57 项 PASS，含事件链与索引投影                        |
| `node scripts/orchestration/task-entry-gate.mjs --files <11 个交付件>`        | 0      | PASS task=AF-051 status=submitted files=11 covered=11 |
| `node scripts/orchestration/task-entry-gate.mjs --files 'src/app.module.ts'`  | 1      | 负向用例，预期 `scope-residual`，列出越界文件         |
| `git diff --stat HEAD -- src/engine-core`                                     | 0      | 空，内核 0 行改动                                     |

## 4. scopeCheck

- 本任务不新增业务代码、不改内核、不重跑 LLM、不动数据库/Redis。
- 复验动作只读文件与跑定向闸门；新增文件仅 AF-051 任务单、交付记录与回执副本。
- `data/batch-reports/**`、`admin-dashboard/pnpm-lock.yaml`、`docs/architecture/phase3-...md` 为并行/清库产物，不进入本任务交付集。
- 原 AF-047 记录 §1–§9、AF-050 记录 §1–§10 保留原样，本记录只追加复核结论。

## 5. contractChecks

| 项           | 结果 | 说明                                     |
| ------------ | ---- | ---------------------------------------- |
| taskId       | pass | 任务单 / 交付记录 / 回执均为 AF-051      |
| state-write  | pass | 登记、提级、领单、回执摄入、归档均经 CLI |
| index-schema | pass | `task-state-index.json` 1.1.0，投影一致  |
| event-chain  | pass | 回执摄入前事件链哈希与索引投影一致       |

## 6. backlogItems

1. **历史终态**：AF-047 / AF-048 / AF-049 仍为 `rejected`；框架禁止归档改写终态。本任务只提供返修载体，不改写历史。
2. **跨仓门禁**：Flutter、psyguard、framework 仓尚未接入同等任务/scope 校验。
3. **`--no-verify` 旁路**：本地 Husky 可被显式跳过，服务器端 CI 才能彻底封死。
4. **未跟踪文件**：`git diff --name-only HEAD` 不含未跟踪稿，V7 的“未声明脏文件”留痕只覆盖已跟踪改动。
5. **`scripts/*.mjs` 无 ESLint**：`pnpm lint` 仅覆盖 `{src,test,bin}/**/*.ts`，编排脚本以 `node --check` + vitest 兜底。

## 7. deviationTable

| 项          | 任务单写法            | 实际                | 处理                          | 原因                                     |
| ----------- | --------------------- | ------------------- | ----------------------------- | ---------------------------------------- |
| 任务性质    | `implementation` 返修 | 改为 `verification` | 只复核不改代码                | 交付件已在位，返修目标是恢复正式验收载体 |
| AF-047 终态 | 期望 completed        | 仍为 rejected       | 不改写，另立 AF-051 completed | 框架禁止 archive 改终态                  |
| 提交与分支  | 任务分支提交          | 未切分支、未提交    | 保持工作区                    | 并行产物多，等待统一收尾                 |
| 外置 Skill  | 仓内交付              | 用户目录 Skill      | 只在记录中说明                | 外置文件不入仓、不进 changedFiles        |

## 8. reviewVerdict

**passed**。AF-047 的强制门交付完整在位；正向门禁 11/11 放行，负向 `src/app.module.ts` 按预期阻断；205 例单测、typecheck、lint、57 项适配层校验全部通过，内核零改动。AF-047 的 rejected 是已修复的 V7 误判，不是交付内容失败；本任务作为返修复核载体归档为 completed。

## 9. 结论

强制编排门仍在生效，且验收器的并行产物边界已经修复。AF-047 的历史记录保留 rejected 以保审计真实；AF-051 completed 作为返修复核结论。后续开发任务按 `AGENTS.md` 第 0 节与适配层 §0 直接走新任务闭环即可，不会再被同类并行产物误杀。
