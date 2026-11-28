# AF-609 交付记录 · 主会话回收口径调整：执行方自验收后主会话只做台账回收

## 1. 任务口径

- 任务号：AF-609
- 类型：documentation / R0 / orchestrator
- 依赖：AF-608；无前置返修任务
- 目标：明确 Flutter 置顶会话、NestJS 置顶会话、MiniMax Code 等执行方已在任务闭环内完成闸门与自验收；主会话不再重复跑业务验收，只做回执、工件、字段、清单引用和台账归档状态的回收核对。
- 执行方式：小豆（编排中枢）直接交付；不承接业务编码。

## 2. 后端仓工件清单

| 编号 | 文件 | 动作 |
| --- | --- | --- |
| R1-1 | `docs/team/agent-orchestration/collaboration-workflow.md` | 将“主会话验收”调整为“执行方自验收 + 主会话台账回收”，明确不重复跑测试、lint、typecheck、analyze 等业务闸门 |
| R1-2 | `docs/worklog/records/phase3-orchestration/AF-609/task-sheet.md` | AF-609 CLI 任务单记录包 |
| R1-3 | `docs/worklog/completed/phase3-orchestration/af609-orchestrator-intake-scope-2026-11-28.md` | 本交付记录 |

本地小豆侧同步调整（不属于后端仓提交文件，不写入后端 `changedFiles.commits`）：

| 编号 | 位置 | 动作 |
| --- | --- | --- |
| L1-1 | `.user_skills/ai-handoff-acceptance/SKILL.md` | 从重复验收清单改为回执工件、字段、清单引用与台账状态回收清单 |
| L1-2 | `.user_skills/ai-handoff-acceptance/references/acceptance-checklist.md` | 去掉关键路径抽跑复现口径，保留回执字段、范围引用与台账一致性核对 |
| L1-3 | `.user_skills/xinsu-task-executor/SKILL.md` | 回执交回步骤改为主会话台账登记与 scope 元数据核对 |
| L1-4 | `.user_skills/orchestration-cli-runbook/SKILL.md` | 下游回执口径从验收判定改为台账回收 |

## 3. 闸门证据

| 命令 | 退出码 | 错误 | 警告 | 关键数字 / 说明 | 证据来源 |
| --- | ---: | ---: | ---: | --- | --- |
| `node scripts/orchestration/cli.mjs events verify` | 0 | 0 | 0 | 事件日志 2569 条；schema state-event 1.0.0；哈希链、状态索引与投影一致 | 后端 CLI stdout |
| `node scripts/orchestration/cli.mjs validate --sheet docs/worklog/records/phase3-orchestration/AF-609/task-sheet.md` | 1（仅历史遗留失败） | 3 | 0 | AF-609 任务单元 PASS；FAIL 仅 AF-600 / AF-601 / AF-602 历史回执 schema 缺口，非本单引入 | 后端 CLI stdout |
| `pnpm orchestration:preflight` | 待提交前执行 | — | — | 暂存清单唯一归属 AF-609，不含状态面生成物、业务代码或 legacy migrate 遗留 | 后端 preflight stdout |

本单为 R0 文档治理任务，不触发 Flutter analyze / test；后端未新增 `src/`、迁移、种子数据或环境启停改动。

## 4. Scope、契约与并行隔离

- `scopeCheck`：`in-scope`；后端仓改动仅限协作备忘与 AF-609 记录包、交付记录。
- 执行方职责：scope 内实现、闸门运行、测试 / lint / typecheck / analyze、回执字段自洽与偏差记录。
- 主会话职责：回执与交付记录路径回流、verdict / scope / 契约 / 遗留字段核对、文件清单与跨仓引用比对、CLI 台账归档状态核对。
- 状态面检查：`events verify`、归档计数和任务索引用于确认台账事件链与归档状态一致；这不是对执行方业务结果的重复验收。
- 并行隔离：legacy migrate 遗留 manifest 修改、回执删除件、未跟踪 legacy 记录包，以及状态投影 / Web `data.js` 继续保持未暂存、未提交。
- Framework 规范件未修改；冻结期 PsyGuard 未触碰。

## 5. 遗留、偏差与人工复核

- `deviationTable`：空数组；`deviationAbsent=true`。本单只调整回收分工，未改变执行方闸门口径、任务单契约或回执 schema。
- `backlogItems`：无新增遗留。既有历史战线（AF-600 / AF-601 / AF-602 回执 schema 缺口、VPT 哈希漂移、临时脚本与 legacy migrate 清理、AF-545 缺任务单）继续另立任务处理。
- 人工复核清单：空。后端备忘口径落地后，前端仓同名协作备忘如需同步，另按前端仓任务流程处理。
- 未决问题：无新增产品或架构未决项。

## 6. 提交、推送与结论

- 后端提交：AF-609 备忘、任务记录包与本交付记录随任务分支提交；提交 SHA 在 `git show --name-only` 复核后回填。
- Push / PR：AF-604 PR #311 合并前不创建后端台账合并 PR；禁止直推 `integrate`、force push、删除 required checks 或绕过 `--no-verify`。
- `finalStatus`：`completed`
- `reviewVerdict`：`passed`
