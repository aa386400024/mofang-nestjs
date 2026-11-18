---
taskId: 'AF-069'
contextId: 'phase2.5-orchestration-closed-loop'
receiptRef: 'docs/worklog/pending/archive/AF-069-receipt-RC-AF-069-1.json'
deliveryRecordRef: 'docs/worklog/completed/phase2.5/af069-relay-supervisor-implementation-2026-11-18.md'
type: implementation
baselineRef: 0749d153b795a14b38d738a3f30e6d208a11f360
finalStatus: completed
reviewVerdict: passed
contractRef: urn:agent-collaboration-framework:schema:receipt:1.0.0
---

# 交付记录 · AF-069 Relay Supervisor：事件驱动回执回收与按档位兜底

> 分工定案：**交付记录 = 人读正文（本文件）；回执 = 同一次交付的机读摘要（receiptRef 指向的 JSON）**。
> 两者同一 `taskId`、两个文件、指针互引。七组字段一个都不能少；任一字段留“待执行”占位即视为回执不成立。
> 字段口径见框架仓 `docs/receipt-contract.md`，核对口径见框架仓 `docs/acceptance.md`。

---

## 0. 任务标识（审计链入口）

| 字段          | 值                                         |
| ------------- | ------------------------------------------ |
| `taskId`      | `AF-069`                                   |
| `contextId`   | `phase2.5-orchestration-closed-loop`       |
| `type`        | `implementation`                           |
| `baselineRef` | `0749d153b795a14b38d738a3f30e6d208a11f360` |
| `dependsOn`   | `[]`                                       |
| `policyRefs`  | `conventions.md#1.3`                       |

## 1. 落地

| 类别 | 路径                                                                                  | 用途 / 说明                                                                                                                   |
| ---- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 新增 | `scripts/orchestration/relay-supervisor.mjs`                                          | 本地 relay supervisor：任务账本、FileSystemWatcher、按档位兜底、归档/通知/审计、watch/tick/register/list/inbox/ack/cancel CLI |
| 新增 | `scripts/orchestration/__tests__/relay-supervisor.spec.mjs`                           | 12 条定向单测：档位、路径校验、文件稳定判定、命中归档、崩溃恢复、超时、事件绕过兜底、ack 清理                                 |
| 新增 | `docs/team/agent-orchestration/tools/TOOL-RELAY-SUPERVISOR.json`                      | 工具契约：`category=state-store`、`allowedRoles=[orchestrator]`、7 个子命令                                                   |
| 新增 | `docs/team/agent-orchestration/relay-supervisor.md`                                   | 运维说明：命令、生命周期、可靠性、Windows 计划任务、资源预算、失败模式                                                        |
| 新增 | `docs/worklog/pending/af069-relay-supervisor-task-2026-11-18.md`                      | 任务单                                                                                                                        |
| 新增 | `docs/worklog/completed/phase2.5/af069-relay-supervisor-implementation-2026-11-18.md` | 本交付记录                                                                                                                    |
| 新增 | `docs/worklog/pending/archive/AF-069-receipt-RC-AF-069-1.json`                        | durable 机读回执副本                                                                                                          |
| 修改 | `package.json`                                                                        | 新增 `"orchestration:relay": "node scripts/orchestration/relay-supervisor.mjs"`                                               |
| 修改 | `docs/team/agent-orchestration/README.md`                                             | §4.1 映射新增 `TOOL-RELAY-SUPERVISOR`；§5 改为 S/M/L/XL 四档与事件优先/兜底有界口径                                           |
| 修改 | `docs/team/agent-orchestration/task-state-index.json`                                 | AF-069 登记/领单状态投影（由 CLI 写入）                                                                                       |
| 修改 | `docs/team/agent-orchestration/state/journal.jsonl`                                   | AF-069 状态事件（由 CLI 写入，哈希链）                                                                                        |
| 修改 | `docs/team/agent-orchestration/orchestration-snapshot.json`                           | 编排快照刷新（由 CLI 写入）                                                                                                   |

- `artifactRefs`：任务单 `docs/worklog/pending/af069-relay-supervisor-task-2026-11-18.md` / 交付记录 本文件 / 回执 `docs/worklog/pending/archive/AF-069-receipt-RC-AF-069-1.json` / 其他：
  - 框架仓提交 `7395748`（`docs(spec): relay 回收改为事件优先与有界兜底`；本地 main，远端推送待网络恢复）
  - 框架仓 §8.1 注记、§8.2、`docs/evolution.md` §3.1、`docs/reliability.md` §3、`conformance/normative-anchors.json` 第五组、`CHANGELOG.md`
  - `minimax-code-relay` Skill §0 / §9.2 / 红线（Skill 目录非 git 仓，不在本仓提交）
  - Windows 计划任务 `Mofang Relay Supervisor`（登录触发、失败重启、单实例）

## 2. 证据

| 闸门                 | 实际命令                                                                                                     | 退出码 | 错误 | 警告 | 用例 / 文件数                                            | 备注                                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------ | ------ | ---- | ---- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 语法                 | `node --check scripts/orchestration/relay-supervisor.mjs`                                                    | 0      | 0    | 0    | —                                                        | exit 0；入口语法可解析                                                                                                                                                                       |
| 定向单测             | `pnpm exec vitest run scripts/orchestration/__tests__/relay-supervisor.spec.mjs`                             | 0      | 0    | 0    | 1 文件 / 12 例                                           | 12 passed / 0 failed；401ms                                                                                                                                                                  |
| 类型                 | `pnpm typecheck`                                                                                             | 0      | 0    | 0    | —                                                        | `tsc -b tsconfig.check.json`；0 error                                                                                                                                                        |
| Lint                 | `pnpm lint`                                                                                                  | 0      | 0    | 0    | —                                                        | `eslint --cache --cache-strategy content "{src,test,bin}/**/*.ts"`；0 error / 0 warning；不覆盖 `scripts/**/*.mjs`（见偏差③）                                                                |
| 编排契约             | `pnpm orchestration:validate`                                                                                | 0      | 0    | 0    | —                                                        | 状态索引、工具契约目录、协议视图、交付包、Agent Card、回执、运行态任务单、事件日志全部 PASS；`AF-069.json` PASS                                                                              |
| 事件链               | `pnpm orchestration:events verify`                                                                           | 0      | 0    | 0    | —                                                        | 281 条；schema `state-event:1.0.0`；哈希链与索引投影一致                                                                                                                                     |
| 边界                 | `git diff --stat HEAD -- src/engine-core`                                                                    | 0      | 0    | 0    | —                                                        | 输出为空；本单未动内核/引擎                                                                                                                                                                  |
| 全量测试（收尾一次） | `pnpm test`                                                                                                  | 0      | 0    | 0    | 206 文件 passed + 1 skipped / 3664 例 passed + 4 skipped | 22.27s；未改 `src`/`test`，作为任务收尾回归                                                                                                                                                  |
| 框架 conformance     | `python conformance/run.py --changelog-base HEAD~1`                                                          | 0      | 0    | 0    | 517 项 / 0 failed                                        | 框架仓 `7395748` 后重跑；规范正文条款锚点一致 17 项                                                                                                                                          |
| 框架单测             | `python -m unittest discover -s conformance/tests -v`                                                        | 0      | 0    | 0    | 16 tests                                                 | 16 tests OK；1.292s                                                                                                                                                                          |
| Relay CLI 冒烟       | `pnpm orchestration:relay register --taskId AF-069-SMOKE --file ... --profile S` → `list` → `cancel` → `ack` | 0      | 0    | 0    | 1 job                                                    | registered / pending / canceled / ack 全链路；结束后 `relay list` 无 job                                                                                                                     |
| Relay E2E            | 注册 `AF-069-E2E` → 写 24B 回执 → 等待 8s → `inbox --unread --json` → `ack`                                  | 0      | 0    | 0    | 1 job                                                    | `PENDING_EXISTS=False`、`ARCHIVE_EXISTS=True`、`NOTE_JSON=True`、`NOTE_MD=True`；归档 SHA-256 `88a67664b8382fea76d1b632000a326b461d4b06ef4d72ed070bbe4cf58bf6bc`；ack 后 `relay list` 无 job |
| 常驻任务             | `Start-ScheduledTask -TaskName 'Mofang Relay Supervisor'` + `Get-ScheduledTask` + `Get-Process`              | 0      | 0    | 0    | 1 任务 / 1 进程                                          | State=Running；PID 14464；RSS 40,484,864 B（约 38.6 MB）；CPU 0.078125s；LastTaskResult 267009（0x41301 运行态）；启用 cron 0 个                                                             |

- `reproNotes`：AF-069 的 supervisor 是纯本地 Node 工具，不依赖 DB/Redis/LLM。复跑顺序：`node --check` → 定向 vitest → `pnpm typecheck` → `pnpm lint` → `pnpm orchestration:validate` → `pnpm orchestration:events verify` → `git diff --stat HEAD -- src/engine-core` → 收尾 `pnpm test`。E2E 复跑：`pnpm orchestration:relay register --taskId AF-069-E2E --file docs/worklog/pending/relay-response-AF-069-E2E-20261118-0105.md --profile S`，写入 24B 内容，等待 8s，`pnpm orchestration:relay inbox --unread --json`，`pnpm orchestration:relay ack --taskId AF-069-E2E`；测试产物已删除，`relay list` 无 job。框架复跑：`python conformance/run.py --changelog-base HEAD~1` + `python -m unittest discover -s conformance/tests -v`。
- 失败项定性：无确定性失败；`pnpm lint` 的 `.mjs` 覆盖缺口是既有工具范围债，不是本单新增失败；Node 版本与 `engines.node >=26` 不一致是既有环境债（记录为 BL-AF069-02），本次测试仍通过。
- 既有债基线与本单新增改动分开：本单不清理 `admin-dashboard`、`data/batch-reports`、`web/orchestration` 等并行产物；不重构既有 orchestration CLI / scheduler。

## 3. 范围

| 核对项                      | 结果       | 说明                                                                                                                                                                                                                           |
| --------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scopeCheck`                | `in-scope` | 改动落在任务单 `scripts/orchestration/`、`docs/team/agent-orchestration/`、`docs/worklog/pending/`、`docs/worklog/completed/phase2.5/`、`package.json`；框架仓与 Skill 属 `artifactRefs.others`，未混入本仓提交                |
| `parallelArtifactsExcluded` | `true`     | 未纳入 `admin-dashboard/pnpm-lock.yaml`、`data/batch-reports/**`、`web/orchestration/data.js`、`docs/architecture/phase3-judge-layer-ai-review-design-2026-11-15.md`、`af064-*`、`af066-*`、`AF-062-receipt-*` 等并行/历史产物 |
| `noOutscopeRefactor`        | `true`     | 未改 `src/`、`test/`、`engine-core/`、`admin-dashboard/`、数据库、Redis、LLM；未重构既有 CLI / scheduler                                                                                                                       |

## 4. 契约

| 核对项           | 结果      | 说明                                                                                                                                                                                   |
| ---------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contractChecks` | `pass`    | `taskId` 贯穿任务单/回执/交付记录/状态索引/事件；状态面只经 CLI 写；`AF-069.json` 任务单与工具契约 `TOOL-RELAY-SUPERVISOR.json` 均通过 `orchestration:validate`；事件链 281 条哈希一致 |
| `fieldAlignment` | `aligned` | 档位单一真相源为 `docs/team/agent-orchestration/README.md` §5 与 `relay-supervisor.mjs` 的 `RELAY_PROFILES`；回执/交付记录同源同数字；框架 §8.2 与适配层不复制两套阈值口径             |

## 5. 遗留

- `backlogItems`：
  - `BL-AF069-01`：`pnpm lint` 覆盖 `{src,test,bin}/**/*.ts`，不覆盖 `scripts/**/*.mjs`；本单仅以 `node --check` + vitest 覆盖。影响：编排脚本静态质量门缺口；排期：另立任务扩展 lint 配置。
  - `BL-AF069-02`：仓 `engines.node >=26`，当前 PATH node v22.23.2、计划任务 node v24.20.0；本次测试通过但引擎契约未满足。影响：依赖 Node 26 特性的脚本可能在当前环境失败；排期：统一 Node 版本后复跑编排闸门。
  - `BL-AF069-03`：Windows 计划任务是机器级环境工件，不在仓库版本控制内；迁移/重装后需重新安装。影响：supervisor 可能不随机器迁移自动恢复；排期：纳入环境初始化清单或后续部署脚本。
- `openQuestions`：无（框架仓远端推送受本机网络阻断，已记入偏差①）。
- `manualReviewList`：无。

## 6. 偏差

| 任务单写法                                  | 现实情况                                                                                                     | 实际处理                                                                                                | 理由                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 任务单 §7 要求框架仓提交/推送               | `main` 已提交 `7395748`；`git push origin main` 因本机 `127.0.0.1:7897` 无监听失败（exit 128），直连被 reset | 保留本地提交，推送待网络恢复；回执 `artifactRefs.others` 记录 SHA                                       | 网络是外部阻塞，不伪造推送成功；不因推送失败重写契约           |
| 任务单 §3 目标架构未显式列 Windows 计划任务 | 常驻 supervisor 需要启动机制；仅靠手动 `watch` 不适合迁移/重启                                               | 安装 `Mofang Relay Supervisor`（AtLogOn、失败重启、单实例、ExecutionTimeLimit=0）并实测 Running         | 计划任务是系统级工件；写入交付记录与遗留项，不混入仓库代码     |
| 任务单 §5 写 `pnpm lint` 0 error            | `pnpm lint` 只覆盖 `{src,test,bin}/**/*.ts`，新增 `.mjs` 不在其范围                                          | 保留 lint 真实 0 error/0 warning，同时以 `node --check` + 定向 vitest 覆盖 `.mjs`；缺口登记 BL-AF069-01 | 不拿不含该文件的闸门冒充覆盖；缺口显式登记                     |
| 任务单 gates 未列全量测试                   | 任务收尾需要一次全量回归，确认脚本改动未影响既有测试面                                                       | 收尾跑 `pnpm test` 一次：206 文件 / 3664 例通过                                                         | 用户偏好「测试按需跑、全量仅任务收尾一次」；额外闸门不改变范围 |
| 任务单写“当前分支 integrate”                | 框架要求任务分支；登记后已切 `task/AF-069-relay-supervisor`                                                  | 实现、交付记录、回执均在任务分支；合并走受保护 PR                                                       | 不直推 integrate；任务分支是 L3 交付单位                       |
| 任务单 §7 只列框架 §8.2                     | 一致性还要求 §8.1 注记、`evolution.md` §3.1、`reliability.md` §3、锚点与 CHANGELOG 同步                      | 一并回写并跑框架 conformance 517 项 / 0 failed                                                          | 规范正文与锚点必须同源，否则 conformance 失败                  |

## 7. 结论

| 字段                 | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `finalStatus`        | `completed`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `reviewVerdict`      | `passed`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `verdictRationale`   | 落地：supervisor 核心/单测/工具契约/运维说明/README/package.json 全部落盘，任务单与 durable 回执成对；证据：语法、12 例定向单测、typecheck、lint、orchestration:validate、events verify、边界 diff、全量 3664 例、框架 517 项 conformance、16 tests、CLI 冒烟与真实 E2E 均有真实退出码和数字；范围：in-scope，并行产物未混入，无相邻重构；契约：taskId/状态写/索引/事件链/工具契约/档位单一真相源对齐；遗留：lint 覆盖、Node 版本、计划任务环境工件已登记，不阻塞本单。框架推送受网络阻断已记偏差，不改变本地交付结论。 |
| `failureReasonCode`  | `null`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `cancellationReason` | `null`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

---

## 交付前自查

- [x] 七组字段全部填写，无“待执行”占位；
- [x] `taskId`、`contextId`、`baselineRef` 与任务单、状态索引三方一致；
- [x] `receiptRef` 指向的机读回执已生成，且同 `taskId`；
- [x] 工件指针路径真实存在；
- [x] 门禁数字与现场可复现结果一致；
- [x] 遗留项已登记，本次未就地清理；
- [x] 偏差显式写入 `deviationTable`（非空，`deviationAbsent=false`）；
- [x] 状态迁移由 CLI 写入事件日志，索引投影一致；
- [x] 框架 `python conformance/run.py` 全绿（517 项 / 0 failed）。
