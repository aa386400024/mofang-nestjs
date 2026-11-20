# AF-038 交付记录：复核 AF-036 交付范围与多任务同树归因

- 任务单：`docs/worklog/pending/af038-scope-attribution-recheck-task-2026-11-17.md`
- 角色：orchestrator
- 交付时间：2026-11-17（本地 +08:00）
- 结论：**passed**。AF-036 的代码改动真实在库且可复现；`rejected` 的成因是回执虚报，不是实现缺陷。

## 1. 复核结论

### 1.1 AF-036 代码改动在库

`git diff --stat` 中 `scripts/orchestration/scheduler.mjs`（+74 行中含 AF-036 的持单原因透传与 AF-032 的回收分流）与 `scripts/orchestration/__tests__/orchestration.spec.mjs`（+112 行含 AF-036 新增的两条用例与断言加强）均在改动列表内。单测复跑 **169 passed**，其中「持单原因随运行态」用例正是 AF-036 加的。

### 1.2 `rejected` 的真实成因

`AF-036` 的 `autoVerdict.rationale`：`机读护栏不通过：scope 外变更文件（不进提交分组）：docs/team/agent-orchestration/README.md`。

`git status` 确认该文件确实处于 modified，**但改动来自 AF-034**（其 scope 含 `docs/team/agent-orchestration/`，§5.1 决策/回收表与配置归一说明），AF-036 从未打开过它。AF-036 的回执把上一单清单整段照抄，于是「本单声明改过的文件」里出现了自己没碰的文件。

因此这是**回执归因错误**，验收器按单任务 scope 判越界是正确行为——护栏抓对了，错在交付侧。

### 1.3 归因表（当前未提交工作树）

| 文件                                                                                       | 归属                        | 依据                                         |
| ------------------------------------------------------------------------------------------ | --------------------------- | -------------------------------------------- |
| `scripts/orchestration/dispatch.mjs`                                                       | AF-032                      | `resolveChannelSelection` + 五值原因         |
| `scripts/orchestration/scheduler.mjs`                                                      | AF-032 + AF-036             | 回收分流（032）与持单原因透传（036）         |
| `scripts/orchestration/gui-dispatch.mjs`、`cli.mjs`                                        | AF-032                      | `failure.facts` 与 `channel fallback` 新参数 |
| `scripts/orchestration/state-store.mjs`                                                    | AF-034                      | `dispatch` 段归一与校验                      |
| `scripts/orchestration/task-intake.mjs`、`event-store.mjs`                                 | AF-034                      | 登记事件时间取写入时刻                       |
| `scripts/orchestration/__tests__/orchestration.spec.mjs`                                   | AF-032 / AF-034 / AF-035-B1 | 选路矩阵、配置归一、持单原因                 |
| `docs/team/agent-orchestration/README.md`                                                  | AF-032 + AF-034             | §5.1 决策原因表、回收动作表、配置归一        |
| `docs/team/agent-orchestration/*.json`、`state/journal.jsonl`、`web/orchestration/data.js` | 运行态投影                  | 由 CLI 写入，随批次整体入库                  |
| `docs/worklog/**`                                                                          | AF-032…AF-038               | 各单任务单 / 交付记录                        |

## 2. 口径（写入本记录即生效）

1. **回执只列本单实际改动的文件**；同批次其他任务改的文件归它们自己的回执。宁可少列，不可虚报。
2. 运行态投影（`task-state-index.json` / `orchestration-state.json` / `orchestration-snapshot.json` / `state/journal.jsonl` / `web/orchestration/data.js`）属批次共享产物，各单可列，验收器已放行。
3. 被判 `rejected` 的终态**不改写**；复核开新单（本单即为此例）。

## 3. 可改进点（登记给框架/后续批次）

| 编号        | 问题                                                                               | 建议                                                                                                                                            |
| ----------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `AF-038-I1` | `dependsOn` 指向 `rejected` 终态任务时永远无法提级（AF-037 因此退单重开为 AF-038） | 框架引入 `supersedes` / `followsUp` 语义：允许「承接已 rejected 任务」作为合法的前置关系，`dependencyState` 对 `rejected` + `reworkOf` 场景放行 |
| `AF-038-I2` | 验收器只看「回执声明 vs 本单 scope」，无法识别「同树多单未提交改动」               | 回执增加 `attribution` 字段（文件 → 归属任务），或验收器按 `git diff` 与任务时间窗交叉核对                                                      |

## 4. 闸门

| 项               | 实测                                                                                                                                                                                                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gateResults`    | `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs --reporter=dot` → exit 0，**169 passed / 0 failed**；`node scripts/orchestration/cli.mjs events verify` → exit 0，PASS；`ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate` → exit 0，27 PASS / 0 FAIL |
| `scopeCheck`     | `in-scope`：只写 `docs/worklog/` 本单任务单与本记录                                                                                                                                                                                                                                    |
| `contractChecks` | taskId 一致 ✅；状态只经 CLI ✅；索引 schema PASS ✅；事件链 PASS ✅                                                                                                                                                                                                                   |
| `backlogItems`   | 2 条（`AF-038-I1`、`AF-038-I2`）                                                                                                                                                                                                                                                       |
| `deviationTable` | 1 条：AF-037 登记后无法提级，退单重开为本单                                                                                                                                                                                                                                            |
| `reviewVerdict`  | `passed`                                                                                                                                                                                                                                                                               |

## 5. 回写清单

- `docs/worklog/completed/phase2.5/af038-scope-attribution-recheck-2026-11-17.md`（本记录）
- `docs/team/agent-orchestration/transport/receipts/AF-038.json`
- 运行态投影（CLI 写入）
