# AF-393 · 危机收束不可达缺口修复

- taskId: `AF-393`
- contextId: `phase2.5-orchestration-closed-loop`
- baselineRef: `2b9968e2f41f1542eb913e0898904be273844907`
- dependsOn: 无
- policyRefs: `conventions.md#1.3`, `agent-orchestration/README.md#强制准入`
- finalStatus: `completed`
- reviewVerdict: `passed`

## 1. 落地

修复最新有效批次 `hRW4V44-t43yyty_EyLke` 的 7 场 `crisis_outcome=incomplete`。根因是 legacy 档在 `postTurns == crisisPracticeTurns` 时直接以 `crisis_practice_max` 结束，下一轮的风险收束 cue 永远没有机会发出；这些场次 `max_turns=20`，turn_count 8–15，结束轮不在最后 3 轮的强制收束窗内，`crisisClosing` 始终为 false。

实现采用最小安全出口：

- `decideCrisisWindowStop`：legacy 档到达上限时，若本轮已在 `forcedClose` 窗（`crisisClosing` 已生效、五组已补齐），允许正常结束；否则先继续一轮，下一轮用 `crisisClosing` 补齐五组后再结束。
- `standard` / `long` 档既有“用满后留 1 轮收束、收束后结束”的行为不变。
- 风险五组仍由 `completeRiskClosingText` 按会话级覆盖账本补齐，没有另写模板。

改动文件：

- `src/auto-practice/practice-runner.service.ts`
- `test/auto-practice/practice-runner-decide-turn.spec.ts`
- `test/auto-practice/practice-runner.spec.ts`
- 本交付记录与记录包

## 2. gateResults

| 闸门       | 命令                                                                                                                                                                                                                                                                              | exit | 结果                                             |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------ |
| 定向回归   | `pnpm exec vitest run test/auto-practice/practice-runner-decide-turn.spec.ts test/auto-practice/practice-runner.spec.ts test/auto-practice/session-profile.spec.ts test/auto-practice/af187-encounter-output-integrity.spec.ts test/auto-practice/crisis-metrics-persist.spec.ts` | 0    | 5 文件 / 92 用例全绿                             |
| 全量测试   | `pnpm test`                                                                                                                                                                                                                                                                       | 0    | 311 passed / 1 skipped；4,752 passed / 4 skipped |
| Lint       | `pnpm lint`                                                                                                                                                                                                                                                                       | 0    | 0 error                                          |
| 类型检查   | `pnpm typecheck`                                                                                                                                                                                                                                                                  | 0    | 0 error                                          |
| 内核零改动 | `git diff --stat HEAD -- src/engine-core`                                                                                                                                                                                                                                         | 0    | 输出为空                                         |
| 事件链     | `node scripts/orchestration/cli.mjs events verify`                                                                                                                                                                                                                                | 0    | PASS，1,692 条；哈希链与索引投影一致             |

## 3. scopeCheck

`in-scope`。人工写入仅落在 `src/auto-practice/practice-runner.service.ts`、两份 `test/auto-practice/*`、`docs/worklog/`；未触碰 `src/engine-core`、`bin/`、`admin-dashboard/`、`.env`、migration、MySQL、Redis。

`parallelArtifactsExcluded`：工作区在开工前为 clean；本次 diff 未混入其他进程产物。

`noOutscopeRefactor`：未改危机升级路径（AF-137）、安全修复轮（AF-138）、风险分级阈值与会话档案字段。

## 4. contractChecks

- taskId：`AF-393` 贯穿任务单、回执、交付记录、commit message。
- state-write：状态面只经 `cli.mjs task register/promote/run-once/archive` 写入，未手改索引。
- index-schema：`task-state-index.json` 仍为 `urn:agent-collaboration-framework:schema:task-state-index:1.2.0`。
- event-chain：`events verify` PASS，1,692 条事件，投影一致。
- 口径唯一真相源：7 场 incomplete 的 `exit_reason / max_turns / turn_count` 来自只读 SQL；不以测试数量替代真实批次结论。

## 5. backlogItems

- `BL-AF393-01`：本次只修代码路径，未重跑 `hRW4V44-t43yyty_EyLke` 或新批次；7 场历史 incomplete 仍是旧数据，需下一批灰度验证 `safety_plan_completed` 比例。
- `BL-AF393-02`：`crisisRiskClosingRound` 字段现在只影响升级路径（AF-137），不再决定普通危机窗硬切；后续若要清理档案字段，需单独任务并同步文档。
- `BL-AF393-03`：AF-391（角色域错误）、AF-392（scope 漏文件）均因登记问题取消并归档；本单为第三次登记，记录包保留完整审计链。

## 6. deviationTable

| 原方案                                           | 实际方案                                                                              | 原因                                                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| legacy 一律在 `postTurns == 上限` 后多留 1 轮    | 若本轮已进入 `forcedClose` 窗且 `crisisClosing` 已生效，则允许当轮结束；否则多留 1 轮 | 最后 3 轮的 `crisisClosing` 已经补齐五组，再追加一轮是重复收束；该条件同时保住既有 maxTurns=8 的回归口径 |
| 原计划只改 `practice-runner-decide-turn.spec.ts` | 同时改 `practice-runner.spec.ts` 的既有危机窗用例                                     | 该用例默认 legacy、maxTurns=8，直接断言 4 个 postTurns；新契约需要它显式验证 `safety_plan_completed`     |

## 7. reviewVerdict

`passed`。理由：根因路径已修到唯一出口函数；定向 92 例与全量 4,752 例全绿；lint/typecheck 零错误；engine-core 零改动；未伪造批次结果，未把历史 incomplete 数据洗成达标。

commit message: `fix(af393): guarantee risk closing round for legacy crisis sessions`
