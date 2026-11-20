# AF-044 交付记录：遗留待办五项落地（2026-11-17）

## 1. 来源与判据

五项均来自**真实误判**，不是优化臆想：

| 项                    | 事实                                                        | 后果                                          |
| --------------------- | ----------------------------------------------------------- | --------------------------------------------- |
| AF-043-I1             | V7 按 `git diff` 全树比对单任务 scope                       | AF-040 / AF-042 实现全在库却连续判 `rejected` |
| AF-043-I2 / AF-042-I1 | `channel fallback` 缺 `--cause` 缺省 `deterministic-defect` | AF-041 直接进 `failed` 终态（不可复活）       |
| 熔断 half-open        | 只有 `closed` / `open`，冷却期满无法安全恢复                | 要么永久熔断、要么人工复位，都不可自动收敛    |
| `--require-ci` token  | CI 容器内无 `git credential` 交互                           | Actions 内取不到 token，门禁只能 abort        |
| 框架 §4.1 / §5.1      | 规范口径落后于适配层实现                                    | 文档与实现漂移，跨仓无法对齐                  |

## 2. 落地清单

### 2.1 V7 按 commit 事实比对（AF-043-I1）

- `handover-contract.mjs`：允许可选 `changedFiles.commits`（7–40 位小写十六进制），非法回 `changedFiles.commits` 错误。
- `acceptance-runner.mjs#checkResidual` 分流：声明 commit → `checkResidualByCommits`，比对**声明提交的文件集**（`opts.resolveCommitFiles(sha)`），不再拿工作树套单任务；解析不到 → `fail`（声明即证据）；无解析器 → `skip`（不冒充通过）；工作树另有未提交改动只写进 detail。
- `branch-workflow.mjs#createGitPort` 增 `filesInCommit(sha)`（`git show --name-only --pretty=format:`，失败返回 `null`）。
- `cli.mjs` 在 `run-once` 与 `watch` tick 两处注入 `resolveCommitFiles`；`scheduler.mjs` 透传到 `processReceipts` → `runAcceptance`。

### 2.2 非失败事实（AF-043-I2 / AF-042-I1）

- `dispatch-channel.mjs`：`NON_FAILURE_CAUSES=['executed-in-session']`、`DELIVERY_CAUSES`、`isNonFailureCause()`；`resolveDispatchDecision` 在不可恢复短路前插入 `continue-in-session`（`result: 'working'`）。
- `gui-dispatch.mjs#fallbackDelivery`：旁路 cause 写 `state=bypassed` + `bypassedAt` / `bypassCause`，`consecutiveFailures` **不递增**，`classification` 置 null；`DELIVERY_STATES` 增 `bypassed`。
- `scheduler.mjs#releaseFailedDeliveries`：`continue-in-session` 不动任务状态，只写 `entry.dispatchDecisionResult` / `deliveryBypassed=true` + `delivery-bypassed` 动作。
- `cli.mjs#fallback`：`--cause` **必填**并校验枚举，缺省/非法 exit 2；帮助文案同步。

### 2.3 熔断半开自动闭合

- `evaluateCircuitBreaker(input, config, { now })`：达阈值且 `openedAt + cooldownMinutes` 未过 → `open`；已过 → `half-open` + `probeAllowed: true`；返回增 `openedAt` / `cooldownMinutes` / `probeAllowed`；新增 `CIRCUIT_BREAKER_STATES`。
- `scheduler.mjs`：`open` / `half-open` 都写 `entry.channelCircuit` 并推 `channel-circuit-open` / `channel-circuit-half-open`；开闸时刻同步写 `record.delivery.circuitOpenedAt` 跨轮算冷却；计数回落封 `closed` + `channel-circuit-closed`。
- `confirmDelivery` 成功即 `consecutiveFailures: 0`、`circuitOpenedAt: null`（试探成功即封闭）。

### 2.4 CI token 来源（AF-043-I4）

- `ci-status.mjs#resolveGithubTokenDetail`：优先级 `GITHUB_TOKEN` → `GH_TOKEN` → `ORCH_GITHUB_TOKEN` → `git credential fill`，返回 `{token, source, hint}`。
- `GITHUB_ACTIONS=true` 且无 token：**不再白跑 credential helper**，直接给注入提示（`env: GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`，需 `permissions: checks: read`）。
- `fetchCheckRuns` 接受 `opts.env` / `opts.apiBase`；基址取 `GITHUB_API_URL`（GHES），缺省 `https://api.github.com`。

### 2.5 跨仓规范修订

- 框架 `docs/reliability.md` §4.1 新增第三类「非失败事实」；§5.1 把 `half-open` 从「预留概念位」改为正式迁移表（冷却期满放一次试探、成功封闭、失败重开）。
- 框架 `docs/receipt-contract.md` §3.1 登记可选扩展字段 `changedFiles.commits`。
- 框架 `CHANGELOG.md` 增 `[Unreleased]` 修订号级说明（schema 未变，哈希不变）。
- 后端 `docs/team/agent-orchestration/README.md` §5.1 / §5.2 / §5.3 / §5.5 同步口径。

## 3. 提交

| 仓库                          | commit    | 内容                                       |
| ----------------------------- | --------- | ------------------------------------------ |
| mofang-nestjs                 | `fd4bac4` | 代码 + 用例（9 文件，+532/−55）            |
| mofang-nestjs                 | `2dd8a9b` | README 口径 + AF-044 任务单                |
| agent-collaboration-framework | `53c2b2b` | reliability / receipt-contract / CHANGELOG |

框架 commit 属**另一仓库**，不进后端回执的 `changedFiles.commits`（该字段由后端 `filesInCommit()` 解析，跨仓 SHA 无法解析即 `fail`）。

## 4. 闸门

| #   | 命令                                                                          | 结果                                          |
| --- | ----------------------------------------------------------------------------- | --------------------------------------------- |
| 1   | `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 189 passed / 0 failed（基线 179，净增 10 例） |
| 2   | `pnpm lint`                                                                   | exit 0，0 error / 0 warning                   |
| 3   | `pnpm typecheck`                                                              | exit 0，0 error                               |
| 4   | `pnpm test`                                                                   | 见 §4.1                                       |
| 5   | `ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate`                        | 全 PASS / 0 FAIL                              |
| 6   | `pnpm orchestration:contracts`                                                | 14 文件哈希与 v2.0.0 一致                     |
| 7   | `node scripts/orchestration/cli.mjs events verify`                            | 见 §4.1                                       |

### 4.1 全量数字

- `pnpm test`：3562 passed / 8 skipped（201 passed | 1 skipped spec files，23.20s）。
- `events verify`：173 事件；哈希链与索引投影一致。

## 5. 收尾字段

- gateResults：见 §4 闸门表（7 条命令，全部 exitCode=0）
- scopeCheck：in-scope（脚本 / 编排文档 / 任务单 / 交付记录；未动 `src/`、`test/`、`config.json`）
- contractChecks：taskId / state-write / index-schema / event-chain 四项 pass
- backlogItems：无新增（五项已全部落地；半开试探的派发侧硬拦截留作观察项，见 §6）
- deviationTable：见 §6
- reviewVerdict：passed

## 6. 偏差与观察项

| 项                          | 任务单说       | 实际                         | 处置                                                                              | 理由                                         |
| --------------------------- | -------------- | ---------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------- |
| 框架仓提交                  | 与后端同批入库 | 另一个仓库，需独立 commit    | `53c2b2b` 独立提交并写进本记录                                                    | 跨仓纪律：各仓只管自己的路径                 |
| `changedFiles.commits` 归属 | 后端回执校验   | 属适配层扩展字段             | 框架 `receipt-contract.md` 登记为可选                                             | 不登记就成了无出处的私有字段                 |
| 半开试探的派发侧硬拦截      | 未在任务单内   | 当前只在回收环节写状态与事件 | **观察项**：若后续出现「熔断开着仍派发」的实证，再在 `claimReadyTasks` 加快速失败 | 没有实证不改派发主路径，避免引入无证据的拦截 |

观察项不入 backlog 台账（未达「可复现缺陷」门槛），在本记录留证，出现实证时再登记。
