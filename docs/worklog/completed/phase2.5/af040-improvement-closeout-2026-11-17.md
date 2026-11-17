# AF-040 交付记录 · 改进台账未实现项收口（通道可靠性 / 分支收口 / 远端 CI 门禁 / 口径裁定）

- 任务单：`docs/worklog/pending/af040-improvement-closeout-task-2026-11-17.md`
- 角色：orchestrator ｜ 类型：implementation ｜ 基线 `ba582325d10426d5bf194048b07899dcb3a1a373`
- 日期：2026-11-17 ｜ 结论：**completed / passed**

## 1. 一句话

台账 14 条活跃项一次收口：6 条代码级 tech-debt 落地并补 9 条单测，6 条决策题从「待讨论」变为**裁定书**，IM-002 / IM-028 状态收口，IM-003 评估后判 `wontfix` 并写明触发条件。IM-034 因资源域切到 AF-041。

## 2. 落地清单（按台账编号）

| 编号   | 形态                              | 落点                                                                                                                                                                       |
| ------ | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IM-007 | 回执指纹优先工件版本 `taskId@rev` | `dispatch.mjs#receiptFingerprint`                                                                                                                                          |
| IM-011 | scope 通配按真实目录展开          | `scope-mutex.mjs#expandScopePattern` / `scopeEntriesWithExpansion` / `findScopeConflicts(...,{rootDir})`                                                                   |
| IM-012 | squash 合并四阶段收口             | `branch-workflow.mjs#finalizeSquashMerge` + `createGitPort().commitSquash` + `cli.mjs branch merge --apply`                                                                |
| IM-017 | 通道熔断参数化 + 可观察事件       | `dispatch-channel.mjs#evaluateCircuitBreaker`、`scheduler.mjs#releaseFailedDeliveries`、`gui-dispatch.mjs`、`state-store.mjs#validateConfig`、`config.json#circuitBreaker` |
| IM-018 | 远端 CI 合并门禁                  | 新建 `ci-status.mjs`（`ciGateVerdict` / `resolveGithubToken` / `fetchCheckRuns` / `evaluateRemoteCiGate`）+ `cli.mjs --require-ci`                                         |
| IM-020 | 12 条差异三层落点                 | `channel-failure-decisions-2026-11-17.md` §2                                                                                                                               |
| IM-023 | 终态出口裁定（ready 为准）        | 同 §3                                                                                                                                                                      |
| IM-024 | 重试预算归属裁定（通道侧）        | 同 §4                                                                                                                                                                      |
| IM-025 | 熔断维度裁定（复用通用熔断）      | 同 §5                                                                                                                                                                      |
| IM-026 | 三分法适用范围裁定（不豁免）      | 同 §6                                                                                                                                                                      |
| IM-027 | 演练基线裁定（结构+数值两层）     | 同 §7                                                                                                                                                                      |
| IM-002 | 实测确认已在库，状态收口          | 全仓检索 `typeorm-model-generator` 命中 0                                                                                                                                  |
| IM-028 | 决策链运行时接线已闭环，状态收口  | AF-032 / AF-034 既有实现                                                                                                                                                   |
| IM-003 | 评估后 `wontfix` + 触发条件       | 见 §5                                                                                                                                                                      |

## 3. 闸门（实跑，2026-11-17 11:47 CST，Windows 本机，无长驻 watch 进程）

| 命令                                                                          | 退出码 | 结果                                                               |
| ----------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------ |
| `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 0      | **178 passed / 0 failed（1.10s）**                                 |
| `pnpm lint`（带缓存）                                                         | 0      | 0 error / 0 warning                                                |
| `pnpm typecheck`                                                              | 0      | 0 error                                                            |
| `pnpm test`（全量）                                                           | 0      | **3551 passed / 8 skipped（201 文件 passed + 1 skipped；21.76s）** |
| `ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate`                        | 0      | **35 PASS / 0 FAIL / 0 SKIP**                                      |
| `pnpm orchestration:contracts`                                                | 0      | PASS（框架契约包 2.0.0，14 文件哈希一致）                          |
| `node scripts/orchestration/cli.mjs events verify`                            | 0      | PASS（157 事件；哈希链与索引投影一致）                             |

墙钟说明：全量 21.76s 为独占机器、无 `nest start --watch` / `vite dev` 长驻进程时的读数，与 `docs/team/gate-performance-remediation-2026-11-11.md` §1.5 的口径一致。

## 4. 单测变更

新增 9 条（178 = 169 + 9）：

| 用例               | 覆盖点                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------- |
| IM-007 指纹版本 ×1 | `AF-010@1` ≠ `AF-010@2`；无版本退回 `taskId\|deliveryRef`                                     |
| IM-011 通配 ×2     | 真实目录枚举不产幽灵路径；`src/*.ts` 不再误报 `src/shared/`                                   |
| IM-012 ×2          | 四阶段链与标题含 taskId；commit 失败即停不删分支                                              |
| IM-017 ×2          | 阈值取配置、`reason` 含「连续失败 N 次」；开闸写 `channelCircuit` 并出 `channel-circuit-open` |
| IM-018 ×2          | 四态判定矩阵；token 双源 + 403 判 `unknown` 不冒充通过                                        |

既有断言随语义更新：`CIRCUIT_BREAKER_RESERVED.reserved` 由 `true → false`，并断言 `semantics` 文案（熔断从「预留位」变成「已实现」的标志）。

## 5. IM-003 依赖治理结论

`pnpm audit --prod --registry=https://registry.npmjs.org`：**3 moderate / 0 high** —— `uuid <11.1.1`、`glob <14.0.2`、`minimatch <11.0.1`，三条均只能靠跨大版本 `pnpm.overrides` 强修。其中 uuid 11 为 **ESM-only**，而 `gaxios` 等传递依赖走 CJS，硬覆盖有运行时炸裂风险。

CI 的 `security-audit` job 以 `--audit-level=high` 为门禁（`.github/workflows/ci.yml`），moderate 不阻断，本仓 CI 12/12 绿。故判 `wontfix`，登记触发条件：**主依赖上游自行放宽版本范围，或集群整体升级（Node ≥ 26）时重评**。不在本单赌运行时兼容性。

## 6. 偏差表

| 项                     | 任务单说                | 现实                                                                                                                                                                                        | 处置                                                                                    | 为什么                                                                               |
| ---------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 任务编号               | AF-039 一单收全部       | AF-039 scope 含 `test/`、`web/`，超出 orchestrator 资源域（`docs/worklog/*` / `docs/team/agent-orchestration/` / `scripts/orchestration/`），`run-once` 判 `scope-domain-conflict` 拒绝领单 | AF-039 取消（`cancelReason` 留痕），重切 AF-040（本单，代码+文档）与 AF-041（用例预算） | 资源域是角色级护栏；为了让一单跑通去放宽角色可写域，等于把护栏拆掉。重切比改护栏诚实 |
| IM-034                 | 本批一并修              | 用例在 `test/admin-debug/`，同属 executor 资源域                                                                                                                                            | 切 AF-041 单独承接                                                                      | 同上                                                                                 |
| 熔断 `cooldownMinutes` | 原文「阈值参数化」      | 冷却期只做了参数校验与口径，未实现到点自动闭合的半开态                                                                                                                                      | 参数已入 config 并写进 README §5.2；`half-open` 仍为预留位，登记后续项                  | 半开态要配恢复试探计数，硬塞进本批会变成无人验证的代码                               |
| IM-017 原文            | 「通道独立计数预留 P2」 | 框架 §5.1 明确「不按派发通道另立独立计数」                                                                                                                                                  | 采通用熔断、按通道（下游实例）计数                                                      | 与框架规范对齐优于照抄旧待办措辞                                                     |

## 7. 结论

台账活跃项从 15 降到 1（仅剩 IM-034，由 AF-041 承接）。七道闸门全绿且数字为本次实跑。IM-020 的跨仓修订与熔断半开态已明确挂触发条件，不留「无主待办」。

## 8. 回执字段标记（机读口径）

- gateResults：见 §3 闸门表（7 条命令，全部 exitCode=0）
- scopeCheck：in-scope（改动全部落在 scripts/orchestration/、docs/team/agent-orchestration/、docs/worklog/{pending,completed}/）
- contractChecks：taskId / state-write / index-schema / event-chain 四项 pass
- backlogItems：AF-040-I1（熔断半开态）、AF-040-I2（CI token 来源）、AF-040-I3（框架仓 §4/§5.1 待修订）
- deviationTable：见 §6 偏差表（任务编号重切 / IM-034 归属 / 熔断冷却期）
- reviewVerdict：passed
