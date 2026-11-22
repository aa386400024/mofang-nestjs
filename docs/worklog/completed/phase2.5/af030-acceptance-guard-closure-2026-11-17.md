# AF-030 交付记录：验收护栏收口（AF-024 返修）

- 任务单：`docs/worklog/pending/af030-acceptance-guard-closure-task-2026-11-17.md`
- 返修对象：`AF-024`（GUI 派发通道接入）被自动验收判 `rejected`
- 角色：orchestrator
- 交付时间：2026-11-17（本地 +08:00）
- 结论：**passed**。三处真实缺陷修完，仓内运行态由缺陷态恢复为可校验态，AF-024 的历史拒绝记录保留不改写。

## 1. 根因（不是文档问题，是护栏自身的三处缺陷）

| 编号 | 缺陷                                         | 表现                                                                                         | 影响面                                                                                  |
| ---- | -------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| D-1  | V7 残留把「本任务自己的任务单」算成交付面    | AF-024 验收报 `scope 外变更文件：docs/worklog/pending/af024-gui-dispatch-task-2026-11-17.md` | 任何走正规流程的任务（登记/提级/提交/归档都要改状态行）必然 `rejected`，`passed` 不可达 |
| D-2  | 索引归档工件对象投影了 `artifactRefs.others` | `[FAIL] 状态索引 /archivedTasks/45/artifacts：must NOT have additional properties`           | `task-state-index 1.1.0` 归档 artifacts 只允许三键，带 `others` 时索引 schema 直接失败  |
| D-3  | 事件 `at` 未归一，接受带偏移的 `createdAt`   | schema 报 2 条事件非法；`events verify` 报「同一任务 at 倒退（02:55 → 02:48:57）」           | 任务单写 `+08:00` 会让事件日志双闸（schema + 单调性）同时红                             |

D-1 与之前 `7dd3539` 修的「状态面生成物误判越域」同类：都是把编排自身的写入算进任务交付面。区别是任务单不属于 `STATE_PLANE_ARTIFACTS` 固定清单（它是每任务一个路径），所以必须按 `task.artifacts.taskSheet` 精确排除。

## 2. 修法

### 2.1 任务单豁免 V7（`acceptance-runner.mjs`）

- 新增 `isTaskSheetArtifact(task, file)`：仅排除**本任务**任务单路径（精确比对，归一 `\` → `/` 与 `./` 前缀）。
- `checkResidual` 先剔状态面、再剔本任务任务单，剩下来的才与 `scope.files` 比对；报告文案区分「编排状态面生成物 N 项」与「本任务任务单 M 项」。
- 不按目录前缀豁免：同目录其它任务单仍是交付面（有单测固定）。

### 2.2 索引工件指针三键（`event-store.mjs`）

- `pickArtifactPointers` 白名单由四键收为 `taskSheet / deliveryRecord / reply`，`others` 不再进索引；回执证据留在运行态 `task.receipt`。
- 归档投影 `archived.push(...)` 追加一次 `pickArtifactPointers` 兜底，历史事件里遗留的 `others` 也不会漏进索引。
- 用 `events rebuild` 由日志重建索引，44/45 号归档条目同步收敛。

### 2.3 时间戳归一与链纠偏（`event-store.mjs` + `cli.mjs`）

- 新增 `toUtcIso()`：`10:44:00+08:00 → 02:44:00.000Z`；无法解析的值原样返回，交给 schema 报错而不是静默改成 `now`。
- `buildCreatedEvent` / `buildHistoryEvent` / `buildArchivedEvent` 的 `at` 与 `taskSnapshot().createdAt` 全部经归一。
- 新增 `rechainEvents(events, { fromEventId, prevSeq, prevHash })` 与 `loadJournalSegment / saveJournalSegment`；CLI 增 `events rechain --from <EV-xxxx> [--apply]`：切点前逐字保留，切点起重编号重算，段首切点必须显式给前一段末位序号与哈希，归档段永不重写。
- 本次实修：`EV-0075..EV-0110`（当前段全部）重算，AF-029/AF-030 两条 created 事件的 `at` 校正到各自迁移之前；原段先备份到本地临时文件，纠偏完成、`verify` 通过后即删除，不入库。

## 3. 闸门

| 字段             | 实测                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gateResults`    | `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` → exit 0，**164 passed / 0 failed**（1.07s）；`ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate` → exit 0，**20 PASS / 0 FAIL**；`pnpm orchestration:contracts` → exit 0，14 文件哈希与 v2.0.0(`c507188`) 一致；`node scripts/orchestration/cli.mjs events verify` → exit 0，**110 条**事件，哈希链与索引投影一致 |
| `scopeCheck`     | `in-scope`：改动只在 `scripts/orchestration/`、`docs/team/agent-orchestration/`、本单任务单与交付记录；未碰业务代码与框架仓 schema                                                                                                                                                                                                                                                                  |
| `contractChecks` | taskId 一致 ✅；状态写入只经 `commitIndex`（未手改索引）✅；索引 schema PASS ✅；事件 schema + 哈希链 PASS ✅；`events rechain` 为显式切点运维通道 ✅                                                                                                                                                                                                                                               |
| `backlogItems`   | 无（本单只修护栏，不带新欠账；AF-024 的 IM-028 / AF-024-R2 仍挂在 AF-024 回执）                                                                                                                                                                                                                                                                                                                     |
| `deviationTable` | 1 条：AF-029 因 `dependsOn: AF-024`（rejected）无法提级，改由 AF-030 承接（见 §4）                                                                                                                                                                                                                                                                                                                  |
| `reviewVerdict`  | `passed`                                                                                                                                                                                                                                                                                                                                                                                            |

新增单测 3 条（`toUtcIso` 归一含畸形值、`rechainEvents` 切点保留 + 链仍通过、任务单豁免 V7 且其它任务单仍 fail）。

## 4. 过程事故与处置（如实记录）

| 事故                                                                       | 处置                                                                                                                                    |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| AF-029 任务单把返修关系写成 `dependsOn: AF-024`，rejected 上游导致提级被拒 | `task cancel` + `archive` 留痕为 `canceled`，原因写明；返修关系改记在 AF-030 正文（`reworkOf=AF-024`），`dependsOn` 只放真实前置 AF-023 |
| AF-029/AF-030 任务单 `createdAt` 写得晚于其迁移时间，事件 `at` 倒退        | 代码层加 `toUtcIso` 根治；两条已落事件经 `events rechain` 校正（切点 `EV-0075`，段首 `prevSeq/prevHash` 取自归档段末条）                |
| 手改事件时间戳导致链断裂                                                   | 用 `rechain --from` 显式切点重算，不整段静默重写；`verify` 现为 PASS                                                                    |

## 5. 遗留

- AF-024 的 `rejected` 归档是真实历史，不改写；其交付内容（GUI 通道 + 协商轮整改）在本单之后即为可验收状态，`validate` 的 Review 交接件、索引、事件三面均为 PASS。
- `events rechain` 属运维例外通道，README §4.0 已写清使用边界（仅本地未发布段 + 显式切点 + 归档段只读），未接入常规调度路径。

## 6. 回写清单

- `scripts/orchestration/acceptance-runner.mjs`（`isTaskSheetArtifact` + V7 排除）
- `scripts/orchestration/event-store.mjs`（三键白名单、归档投影兜底、`toUtcIso`、`rechainEvents`、`loadJournalSegment` / `saveJournalSegment`、`segmentEntryPoint`）
- `scripts/orchestration/cli.mjs`（`events rechain` 动作与导入）
- `scripts/orchestration/__tests__/orchestration.spec.mjs`（+3 用例，164 passed）
- `docs/team/agent-orchestration/README.md` §4.0（时间戳口径 + 纠偏通道）
- 运行态重建：`task-state-index.json`、`orchestration-snapshot.json`、`state/journal.jsonl`、`web/orchestration/data.js`
- 本单任务单与交付记录
