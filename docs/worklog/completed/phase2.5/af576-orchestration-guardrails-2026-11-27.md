# AF-576 · 编排 CLI 护栏收口 — 交付记录

- **任务单**：`docs/worklog/records/phase2.5-toolchain/AF-576/task-sheet.md`
- **分支**：`task/AF-576-orchestration-guardrails`
- **基线**：`c19a8246f9ae018966549946896a1ad02ecf7840`
- **合并**：PR #288 squash 合并，merge SHA `900b0414967666f3f33e924dfe202800dcf3b22f`
- **日期**：2026-11-27
- **性质**：编排适配层护栏修复（IM-076 / IM-077 / IM-080 / IM-084 / IM-085）

## 一、背景

AF-572→AF-575 返修链暴露了五个编排适配层缺口：登记阶段不校验资源域，导致 AF-572 到派发才报 `scope-domain-conflict` 并被迫重签发；canceled/rejected/failed 任务的历史交付指针失效仍让 `worklog verify --strict` 失败；`dependsOn` 指向失败上游时任务永久停在 `ready` 且无显性动作；`cli validate --sheet` 的单任务结论被全仓无关失败拖累；回执重冻后运行态 `receiptFingerprint` 未清除，下一次 `run-once` 误判已验收。本单一次收口五类行为，并补齐单测。

## 二、实现

| 改进 | 文件 | 落地方式 |
| --- | --- | --- |
| IM-077 域预检 | `scripts/orchestration/card-router.mjs`、`scripts/orchestration/task-intake.mjs` | `suggestRolesForScope` 计算可完整覆盖 scope 的可用角色；`scopeDomainCheck` 在 `registerTaskFromSheet` / `registerTaskFromHandover` 写记录包与 `createTask` 之前执行，越域报冲突文件和建议角色；只读任务、空 scope 豁免 |
| IM-076 失效交付指针 | `scripts/orchestration/worklog.mjs` | 仅 `completed` 强制交付记录存在且文件可解析；canceled/rejected/failed 的缺失指针降为 warning，不再让 strict 失败 |
| IM-080 失效依赖 | `scripts/orchestration/scheduler.mjs`、`scripts/orchestration/cli.mjs` | 新增 `INVALID_DEPENDENCY_STATUSES` 与 `dependencyHealth`；claim 对失败类上游发 `dependency-invalid`，未知上游仍发 `dependency-unresolved`；`status` 运行健康行输出 `失效依赖=N` 及前 5 条明细 |
| IM-084 单 sheet 退出码 | `scripts/orchestration/validator.mjs`、`scripts/orchestration/cli.mjs` | 新增 `resolveValidationOutcome`；`validate --only-sheet --sheet <file>` 只以任务单元结论决定退出码，并输出 `[SUMMARY] sheet=… global=… exit=…`；缺文件在 only-sheet 下也形成 FAIL 分区；默认全仓口径不变 |
| IM-085 重冻指纹失效 | `scripts/orchestration/dispatch.mjs`、`scripts/orchestration/cli.mjs` | 新增 `invalidateReceiptAcceptance`，删除运行态 `receiptFingerprint` / `autoVerdict`；`receipt freeze` 成功后清缓存并写 `receiptFrozenAt` / `receiptFreezeDigest`，打印“验收缓存已失效/无需清理” |

单测新增 5 例，覆盖：域预检与建议角色、canceled 缺交付只告警而 completed 失败、`dependency-invalid` 与健康视图、only-sheet 退出码、重冻清缓存。实现文件共 7 个脚本 + 1 个测试文件。

## 三、闸门结果（gateResults）

| 闸门 | 结果 |
| --- | --- |
| `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs --no-file-parallelism` | exit 0；1 file / 283 tests passed / 0 failed，3.93s |
| `pnpm lint` | exit 0；全仓 0 error |
| `pnpm typecheck` | exit 0；`tsc --noEmit` 0 error |
| `pnpm test`（标准并发） | exit 1；361 passed / 1 failed（`af073-batch-report-cli.spec.ts` 4 例），5144 passed / 4 skipped |
| `pnpm exec vitest run test/auto-practice/af073-batch-report-cli.spec.ts --no-file-parallelism` | exit 0；1 file / 4 tests passed，72.69s |
| `pnpm exec vitest run --exclude "**/e2e/**/*.ts" --no-file-parallelism` | exit 0；362 passed / 1 skipped 文件，5148 passed / 4 skipped 用例，0 failed，3599.47s |
| `node scripts/orchestration/cli.mjs validate --only-sheet --sheet docs/worklog/records/phase2.5-toolchain/AF-576/task-sheet.md` | exit 0；`[SUMMARY] sheet=PASS global=FAIL exit=0` |
| `$env:ORCH_STATE_FREE='1'; node scripts/orchestration/cli.mjs worklog verify --strict --state-free` | PASS；归档前跑：活跃=1 归档=512；合并后终态复核：活跃=0 归档=513 记录包=532 inbox=0 |
| `node scripts/orchestration/cli.mjs events verify` | PASS；事件日志 2396 条，哈希链与索引投影一致 |
| `git diff --stat HEAD -- src/engine-core` | 输出为空；engine-core 零 diff |

标准并发 `pnpm test` 的 4 例失败均为 `spawnSync` 返回 `status=null`（子进程冷启动超时），与 AF-575 已记录的 `BL-AF575-01` 同源；隔离串行复跑 4 例全通过。为取得权威全量结论，另跑一次串行全量，结果见上表。

### 合并后终态复核（AF-577 回填）

- PR #288 已 squash 合并，merge SHA `900b0414967666f3f33e924dfe202800dcf3b22f`；远端 required checks 20/20 pass，PR 已关闭。
- 本地 `integrate` 已对齐到该 merge SHA；AF-576 任务分支已在本地与远端清理。
- 终态状态面：活跃 0 / 归档 513 / 记录包 532 / inbox 0；事件日志 2396 条 PASS。
- 本机状态锚点在合并后曾短暂保留归档前旧状态，已按合并提交刷新；该问题属本机运行态，不影响仓库提交与远端状态面。

## 四、范围核对（scopeCheck）

`scopeCheck`：**in-scope**。代码与测试仅改 `scripts/orchestration/` 下 8 个文件；记录改动落在 `docs/worklog/`；状态面与台账改动落在 `docs/team/agent-orchestration/`；`web/orchestration/data.js` 为 CLI 自动刷新生成物，按 `STATE_PLANE_ARTIFACTS` 剔除，不纳入交付面比对；未改 `src/`、`test/`、`admin-dashboard/`、`bin/`。

## 五、契约核对（contractChecks）

`contractChecks`：

- taskId：AF-576 贯穿任务单、实现、交付记录、回执与状态索引。
- state-write：register / promote / run-once / archive / improvements transition 均经 CLI；未手改索引与 journal。
- index-schema：任务单 frontmatter 与回执六组必填标记齐全。
- event-chain：AF-576 全生命周期事件由 CLI 写入；收尾跑 `events verify`。
- engine-boundary：`src/engine-core` 零 diff；未改业务层。
- scope-domain：`agentRole=orchestrator` 与 `scripts/orchestration/`、`docs/worklog/`、`docs/team/agent-orchestration/` 资源域匹配；预检本身已实跑验证越域会拒绝并建议 orchestrator。

## 六、遗留项（backlogItems）

`backlogItems`：无新增。沿用 `BL-AF575-01`（本机高并发下 AF-073 `spawnSync` CLI 用例冷启动超时，隔离串行通过；建议另立测试基础设施任务评估固定本地 `maxWorkers` 或提高 CLI 超时，不改断言）。

## 七、偏差表（deviationTable）

`deviationTable`：

| 任务单口径 | 实际情况 | 处置 |
| --- | --- | --- |
| 任务单写 `validateScopeDomain` | 该函数返回 `{valid, outside, errors}`，直接报错缺少建议角色 | 新增 `scopeDomainCheck` 包装，保留原函数语义并补充建议角色与统一错误文案；`registerTaskFromSheet` / `registerTaskFromHandover` 调用包装 |
| 任务单写 `dependencyState` 区分失败态 | `dependencyState` 只回答 met/unmet，不产生 claim 动作 | 新增 `INVALID_DEPENDENCY_STATUSES` 与 `dependencyHealth`，claim 与 status 共用同一判定，避免两处口径漂移 |
| 全量测试闸门 `0 failed` | 标准并发在本机复现 AF-073 4 例 `spawnSync` 超时（`status=null`） | 按任务单“环境性并发超时须隔离复跑并记录”执行：隔离 4 例通过，并追加串行全量作为权威闸门；不改测试断言 |
| `web/orchestration/data.js` 被 CLI 自动重写 | 属状态面生成物，不在任务 scope | 单独随状态面提交，不与实现混提交；验收器按 `STATE_PLANE_ARTIFACTS` 剔除 |

## 八、验收结论（reviewVerdict）

`reviewVerdict`：**passed**。

五项行为均有单测覆盖；编排定向测试 283/283，lint 与 typecheck 0 error，engine-core 零 diff；标准并发仅复现已知 AF-073 子进程超时，隔离复跑全通过，串行全量结果见 gateResults。未引入新依赖，未改默认 `cli validate` 全仓口径。
