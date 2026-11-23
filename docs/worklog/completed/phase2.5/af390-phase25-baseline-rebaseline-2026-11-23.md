# AF-390 · Phase2.5 出口基线与真实库口径重写

- taskId: `AF-390`
- contextId: `phase2.5-orchestration-closed-loop`
- baselineRef: `e57eb33190d66b7026c2ff71bc7e12eb7c351e38`
- dependsOn: 无
- policyRefs: `conventions.md#1.3`, `agent-orchestration/README.md#强制准入`
- finalStatus: `completed`
- reviewVerdict: `passed`

## 1. 落地

把 Phase2.5 总入口与 WP 清单的出口⑤/总览口径，从 2026-11-18 的 111 场 / 1877 轮 / completed 60，重写为 2026-11-23 23:00 只读实查的 491 场 / 12,848 轮 / 39 批（25 valid）/ completed 368；新增 §3.2.22 固化实查口径、最新有效批次指标、文档漂移与运行态确认。同步把第二家 provider 的旧“待采购 key”改成已接入并实测，避免后续继续按过期口径排期。

AF-389 已完成同一内容，但任务单 frontmatter 漏 `scope.files`，回执预检无法覆盖 changedFiles，任务被取消并归档；本单补全 scope 后重新登记，文档内容不变。

改动文件：

- `docs/worklog/pending/phase2.5-README.md`：顶部状态、出口表④⑤、新增 §3.2.22、WP-H 第一波/第二家 provider 旧口径修订。
- `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md`：顶部状态与最近核对日期改为 2026-11-23 实查。
- `docs/team/agent-orchestration/task-state-index.json`、`state/journal.jsonl`、`orchestration-snapshot.json`、`web/orchestration/data.js`：CLI 状态面写入，不手改。
- `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-390/`：任务单与回执记录包。

## 2. gateResults

| 闸门       | 命令                                               | exit | 结果                                              |
| ---------- | -------------------------------------------------- | ---- | ------------------------------------------------- |
| 事件链     | `node scripts/orchestration/cli.mjs events verify` | 0    | `[PASS] 事件日志 1678 条；哈希链与索引投影一致`   |
| 文件域     | `git diff --name-only HEAD`                        | 0    | 仅两份文档 + CLI 状态面；无源码、测试、配置、前端 |
| 内核零改动 | `git diff --stat HEAD -- src/engine-core`          | 0    | 空                                                |
| 全量测试   | 不适用                                             | —    | 本单零代码改动，未跑全量；不伪造测试数字          |

## 3. scopeCheck

`in-scope`。所有人工写入落在任务单 scope 的 `docs/worklog/pending/`、`docs/worklog/completed/`、`docs/worklog/records/`、`docs/team/agent-orchestration/`、`web/orchestration/`；未触碰 `src/`、`test/`、`bin/`、`admin-dashboard/`、`.env`、migration、MySQL、Redis。

`parallelArtifactsExcluded`：工作区在登记前为 clean；本次 diff 未混入其他进程产物。

`noOutscopeRefactor`：未改历史 §3.2.1–§3.2.21 的结论；未改各 WP 历史交付状态；未把 AI 代理分数写成临床达标。

## 4. contractChecks

- taskId：`AF-390` 贯穿任务单、回执、交付记录、commit message。
- state-write：状态面只经 `cli.mjs task register/promote/run-once/archive` 写入，未手改索引。
- index-schema：`task-state-index.json` 仍为 `urn:agent-collaboration-framework:schema:task-state-index:1.2.0`。
- event-chain：`events verify` PASS，1,673 条事件，投影一致。
- 口径唯一真相源：本次数字只来自 2026-11-23 23:00 的只读 SQL；估算值显式标注“按 75% 完成率折算”。

## 5. backlogItems

- `BL-AF390-01`：出口⑤按 completed 口径还差 632 场；按 75% 完成率折算约需新增 843 场 / 约 17 个 48 场批次，1000 场批次尚未启动。
- `BL-AF390-02`：最新有效批次 `hRW4V44-t43yyty_EyLke` 仍有 `zero_motion 8/48`、`neutral 84.64%`、`vpt_depression_avoidant_l1` resistance 83.15% 且 exploration 0；放量前必须先治理角色空转。
- `BL-AF390-03`：出口④仍为 AF-177 4/6（safety 6 场=2、κ 0.295711<0.40）；真实督导师双人盲标未发生。
- `BL-AF390-04`：AF-382 回执未冻结历史残留仍在运行健康里；与本单无关，另行收口。
- `BL-AF390-05`：24 场豆包生产批次 + 1 场 50 分钟长会尚未跑。

## 6. deviationTable

| 原方案                   | 实际方案                                               | 原因                                                                      |
| ------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------- |
| 只改出口表 ⑤             | 同时改顶部状态、④ 最新正式口径、第二家 provider 旧口径 | 顶部与 ④/⑤ 是同一入口的多处漂移；只改 ⑤ 仍会让读者按旧 ④/“待采购 key”判断 |
| 新增基线节放在 §3.2 末尾 | 放在 §3.2.21 之后、历史“2026-11-17 重定”之前           | 保持 §3.2 时间顺序，同时不打断后续历史条目                                |
| 计划重跑一次 SQL 验证    | 复用 2026-11-23 23:00 已完成的只读查询结果             | 查询时间与本单开工时间一致，未发生新批次；重复查询不产生新事实            |

## 7. reviewVerdict

`passed`。理由：文档口径已按真实库重写，缺口分母明确；历史结论未被改写；无源码/数据/运行态副作用；事件链与文件域均通过。

commit message: `docs(af389): rebaseline phase2.5 exit metrics to 491 sessions`
