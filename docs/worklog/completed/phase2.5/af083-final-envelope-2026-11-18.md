# AF-083 活跃改进项集中处置与 relay 三单回归交付记录

- 任务单：`docs/worklog/pending/af083-final-envelope-task-2026-11-18.md`
- 任务 ID：`AF-083`（前序 AF-079 因资源域登记错误取消并归档，未声称完成）
- 分支：`task/AF-083-improvement-closeout-envelope`（自 `integrate` 的 `845d20d` 切出）
- 日期：2026-11-18
- 结论：`passed`

## 1. 背景

AF-078 合并后，改进台账仍有 5 项活跃：IM-044 / IM-046 / IM-047 / IM-052 / IM-053。
本单按「能代码化的代码化、能文档化的文档化、受架构约束的显式风险接受」逐项处置，并在收尾跑一次全量测试。

## 2. 修改

- `scripts/orchestration/handover-contract.mjs`
  - `changedFiles.externalCommits` 可选字段：`[{ repo: "owner/repo", commits: ["7–40 位小写十六进制"] }]`。
  - 只做形状校验；本仓 `commits` 仍只解析本仓对象库，外部仓 SHA 不进入 V7 本仓 commit 比对。
- `scripts/orchestration/__tests__/orchestration.spec.mjs`
  - 新增 IM-046 用例：合法跨仓声明通过，非法 repo / SHA / 空数组被拒。
  - 新增 IM-053 用例：三单连续 `send→ack→auto-confirm` 不串单；第三单重派后旧 ack（早于本轮 `preparedAt`）被拒，状态留 `pending`；新 ack 到达后恢复 `delivered`。
- `docs/team/agent-orchestration/README.md`
  - §5.5 补跨仓提交声明口径。
- `docs/team/agent-orchestration/improvement-dispositions-2026-11-18.md`
  - 五项处置结论、架构性暂缓理由与重启条件。
- `docs/team/agent-orchestration/production-readiness-checklist-2026-11-18.md`
  - 生产前五类收口清单：部署 / secrets / 迁移 / 监控告警 / 回滚。
- 改进台账经 CLI 流转：IM-046 / IM-047 / IM-053 → `done`；IM-044 / IM-052 → `wontfix`（架构性暂缓，重启条件已写）。

未改 `src/` 业务代码；未新跑 LLM 批次；未改数据库 / Redis。

## 3. gateResults（闸门结果）

| 命令 | 退出码 | 真实结果 |
| --- | --- | --- |
| `corepack pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 0 | 1 file / **244 tests passed / 0 failed**，634ms |
| `corepack pnpm lint` | 0 | 0 error / 0 warning；scripts 段覆盖生效；仅 node engine WARN（v22.23.2 vs >=26） |
| `corepack pnpm test` | 0 | **207 files passed / 1 skipped；3675 tests passed / 8 skipped**，21.54s |
| `corepack pnpm typecheck` | 0 | `tsc -b tsconfig.check.json` 0 error |
| `corepack pnpm exec vitest run test/engine-core/boundary.spec.ts` | 0 | **12 tests passed / 0 failed** |
| `git diff --stat HEAD -- src/engine-core` | 0 | 空输出（内核零改动） |
| `node scripts/orchestration/cli.mjs validate` | 0 | **30 项 PASS**（回执摄入时为 27 项；AF-080/081 归档后新增校验项） |
| `node scripts/orchestration/cli.mjs events verify` | 0 | 事件日志 **343 条**（回执摄入时为 336 条）；schema + 哈希链 + 索引投影一致 |

## 4. scopeCheck（范围核对）

`in-scope`。改动仅编排脚本、编排单测、编排文档、工作记录与状态面生成物。未触碰业务 `src/`、`src/engine-core`、数据库、Redis、LLM 批次。

## 5. contractChecks（契约核对）

- `taskId` 贯穿任务单、交付记录、回执：`AF-083`。
- AF-079 因 `scope-domain-conflict` 取消归档；未用 `--no-verify`、未手改状态索引、未放宽资源域。
- 状态写只经 CLI：`task register` → `task promote` → `run-once` → 回执摄入 / 归档。
- IM-046 只扩展回执形状，不改变本仓 commit 比对的硬口径。
- 未新增框架 tag/release；L4 冻结动作仍未执行。

## 6. backlogItems（遗留登记）

无新增。五项活跃改进均已终态：
- `done`：IM-046 / IM-047 / IM-053。
- `wontfix`（架构性暂缓，重启条件见处置文档）：IM-044 / IM-052。

## 7. deviationTable（偏差说明）

| 项 | 任务单原方案 | 实际实现 | 原因 |
| --- | --- | --- | --- |
| 任务号 | AF-079 | AF-083 | AF-079 scope 含 orchestrator 资源域外路径，登记后无法原地修订，按不绕过门禁原则取消并重登记 |
| 生产清单位置 | `docs/team/` | `docs/team/agent-orchestration/` | 满足 orchestrator Agent Card 资源域；内容不变 |
| IM-053 验证 | 真实 3 单窗口长跑 | 3 单状态机自动化回归 | 不占用桌面、不依赖 MiniMax 在线；真实窗口延迟另由 relay supervisor 观测，不作为本单验收前置 |

## 8. reviewVerdict（验收结论）

`passed`。

理由：编排单测 244 项全绿；全量 3675 项通过、0 failed；typecheck / lint / boundary 全绿；`validate` 30 项 PASS、事件链 343 条一致。五项活跃改进全部终态，未新增 LLM 批次或业务代码改动。

## 9. 返修说明

AF-080 首次验收被拒：回执把状态面生成物 improvement-log.json 列入 changedFiles.modified，机读护栏判为声明集含 scope 外文件。AF-083 删除该声明并复用同一实现重新验收；代码与文档内容不变。

## 10. 提交封套说明

AF-083 是提交封套：实现与验收证据已在 AF-081 完成。此单用于把实现、AF-079/080/081 记录与状态面合法提交到任务分支；git commit 9c067e9 已通过 orchestration:preflight（task=AF-083 status=submitted files=19）。

## 11. 二次返修

AF-082 回执被拒原因：交付记录含 1 个 CR 字符。AF-083 将记录统一为 LF 后重新验收；实现与提交内容不变。
