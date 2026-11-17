# AF-023 · 编排运行态闭环补齐（2026-11-17）

> 任务单：`docs/worklog/completed/phase2.5/af023-orchestration-runtime-closure-task-2026-11-17.md`
> 类型：`implementation` ｜ 角色：`orchestrator` ｜ 基线：`8607d68`
> 结论：`conditional-pass`（运行态闭环已打通；GUI 自动投递与协商轮按边界保留，不冒充闭环）

## 交付摘要

| 项         | 落地                                                                                  | 关键口径                                                                 |
| ---------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 任务立项   | `task-intake.mjs` 解析 Markdown frontmatter，`task register` / `task import` 两种入口 | 立项经框架 schema 校验后 `createTask` 写事件日志，索引只是投影           |
| 回执摄入   | `receipts.mjs` 扫描 `transport/receipts/*.json`，兼容包装与裸回执                     | 七组字段 + 工件指针校验通过才投影；`ingestedReceiptFingerprint` 保证幂等 |
| 验收归档   | `processReceipts` 消费回执触发 V1–V7，归档 `completed` / 提案返修 / 死信              | 回执与交付记录成对；终态不可变，返修同 `contextId` 新开任务              |
| 单任务队列 | `maxConcurrentTasks=1`，在办未回收不发下一单                                          | 先回收回执再领单，同一轮完成「验收归档 → 派发下一单」                    |
| 租约口径   | 超时释放写 `releaseReason=lease-expired`，`heldForHuman=true`，不自动重派             | 人工 `task resume` 恢复；超时后回执到达则恢复领取并验收，不重新派发      |
| 审计可追溯 | 回执副本与 transport 任务单副本落 `docs/worklog/pending/archive/`，索引留指针         | transport 只作收件箱；归档正文不随 gitignore 丢失                        |
| 防抖动     | 快照仅在内容变化时重写，`cmdSnapshot` 强制刷新                                        | 空跑不再产生 `generatedAt` 与网页数据整文件 diff                         |

## 1. 问题与根因

AF-020 完成的是规范层（任务单模板、索引、验收口径、改进台账），运行层仍有五处断点：

1. `config.json` 的 `autoLoop.enabled=false`，`shouldAdvance` 不推进领单 / 验收 / 归档；
2. `processReceipts` 只读索引里的 `task.artifacts.deliveryRecord`，**不读 `transport/receipts/*.json`**，执行侧回执无处进入；
3. `claimReadyTasks` 一次领取所有 ready 任务，没有调用 `canDispatch`，违反单任务队列；
4. 领单先改 `submitted` 再派发，派发抛错后任务停在 `submitted` 且无派发记录；
5. `allowedTaskTypes` 不含 `investigation`，DR-001 即使进索引也不会被领取。

更深一层是形状漂移：任务单 `artifacts` 被塞进索引指针对象（框架要求产出清单数组）；回执 `artifactRefs` 被当数组校验（schema 是对象）；`reviewVerdict=null` 被误判非法；`validate` 把 transport `{deliveredAt,payload}` 包装当任务单本体。

## 2. 实现

### 2.1 立项（`task-intake.mjs`）

- `parseTaskSheetFrontmatter`：解析 Markdown 首部 YAML（`yaml` 2.9.1），拒绝缺失或非对象 frontmatter。
- `buildTaskRecord`：把 frontmatter 投影成索引任务记录，`plannedArtifacts` 与索引 `artifacts` 分离，默认角色 `review/verification/investigation → reviewer`，其余 → `executor`。
- `registerTaskFromSheet` / `registerTaskFromHandover`：前者走 Markdown，后者兼容 transport `{deliveredAt,payload}`；两者都先 `validateTaskSheet` 再 `createTask`。

### 2.2 回执（`receipts.mjs`）

- 扫描 `transport/receipts/*.json`，按 `taskId` 取最新一份；非法 JSON / 缺 `taskId` / schema 不合法记 `receipt-invalid`，**不改任务状态**。
- 校验通过后把 `artifactRefs` 投影到任务 `artifacts`（`taskSheet / deliveryRecord / reply / receipt`），写 `entry.ingestedReceiptFingerprint` 做幂等。
- 回执副本复制到 `docs/worklog/pending/archive/<taskId>-receipt-<receiptId>.json`，`task.receipt.archiveRef`、`entry.receiptArchiveRef`、`task.artifacts.receipt` 三处留指针。
- `archiveTaskSheetFile`：归档前若 `artifacts.taskSheet` 位于 `transport/`，复制到 `pending/archive/<taskId>-task-sheet-<date>.json` 并回写指针。

### 2.3 调度（`scheduler.mjs`）

- `advanceOnce` 顺序：`releaseExpiredLeases → processReceipts → claimReadyTasks`。回执已到的那一轮不再先报 `queue-busy` 再空转一轮。
- `claimReadyTasks`：`maxConcurrentTasks` 门槛、`taskSheet` 存在性检查、`heldForHuman` 跳过（`held-for-human`）；派发前 `canDispatch` / `validateScopeDomain` / `findScopeConflicts`；`dispatchTask` 加 `force:true`。
- 派发失败或抛错：回滚 `ready`、恢复 history、清空租约与 dispatch、记 `dispatch-rejected`。
- `releaseExpiredLeases`：写 `releaseReason=lease-expired`、`releasedAt`、`heldForHuman=true`、`escalation`（waiting / evidence / attemptedPaths / suggestedDecision），history 记「持单待人工确认，不自动重派」。
- `processReceipts`：先 `ingestReceipts`；回执终态非 `completed` 按合法迁移链闭合归档；`completed` 缺交付记录记 `receipt-delivery-missing`；租约超时持单后回执到达时 `late-receipt-recovered` 恢复领取并验收，不重新派发。
- 归档 `completed` / `rejected` 前统一调用 `archiveTaskSheetFile`。

### 2.4 CLI 与校验

- `task register --sheet`、`task import --handover`、`task resume --taskId`（要求任务 `ready` 且确为 `heldForHuman`，清持单后写 `manual-resume`）。
- `validate` 解包 transport 任务单后校 `task-sheet`，并校验 `transport/receipts/*.json` 的 `receipt` schema。
- `watch` 启动先跑一轮，监听 pending / completed / transport tasks / receipts。
- `writeSnapshotArtifacts` 内容相同则跳过；`cmdSnapshot` 强制刷新；`cmdRunOnce` 不再二次写快照。

### 2.5 契约与配置

- `handover-contract.mjs`：任务单 `artifacts` 数组、索引指针 `artifactPointers`；回执 `artifactRefs` 按对象校验、`reviewVerdict=null` 合法；补 `contractRef` urn、`scopeCheck` 枚举、`changedFiles` 对象、`contractChecks` 非空 `{item,result}`、`backlogItems {id,impact}`、字符串数组字段、`deviationTable` 形状。
- `config.json`：`autoLoop.enabled=true`、六类任务、`maxConcurrentTasks=1`、`leaseDefaultMinutes=30`。
- 适配层 README 补 `statePlane`（journal / index / lock / writer / rebuildCommand）与 `conformance`（command / ciHook / tolerant）。

## 3. 运行态实测（DR-001）

| 步骤        | 证据                                                                                                                         |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 补登        | `task import --handover transport/tasks/DR-001.json --status ready`；索引 `agentRole=executor`、`type=investigation`         |
| 领单 + 派发 | `run-once` → `submitted=1`；交接件 `payload.artifacts` 数组、`artifactPointers` 对象，`deliveredAt=2026-11-17T00:49:38.422Z` |
| 回执        | `transport/receipts/DR-001.json` schema PASS；`finalStatus=completed`、`reviewVerdict=null`、`artifactRefs` 三指针           |
| 验收        | `run-once` → `receipt-ingested` → `archive-completed`；`autoVerdict=conditional-pass`                                        |
| 索引        | `archivedTasks` 含 `DR-001 status=completed`，工件三指针齐全；`tasks=[]`                                                     |
| 快照        | `counts` 全 0、`archivedCount=40`；连续空跑 `generatedAt` 不变                                                               |
| 归档副本    | `pending/archive/DR-001-receipt-2026-11-17.json`、`DR-001-task-sheet-2026-11-17.json`；交付记录头部同步指针                  |

说明：DR-001 归档早于回执/任务单副本功能落地，索引 `archivedTasks[DR-001].artifacts` 仍保留 transport 原指针；归档副本与交付记录头部可追溯。新任务由 `archiveTaskSheetFile` 自动回写归档指针。

## 4. 闸门

| 命令                                                                          | 结果                                                                                                     |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 144 passed / 0 failed                                                                                    |
| `ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate`                        | 10 项 PASS / 0 FAIL（含 DR-001 回执与任务单）                                                            |
| `pnpm orchestration:validate --sheet <AF-023 任务单>`                         | 任务单元 PASS                                                                                            |
| `pnpm orchestration:contracts`                                                | PASS（框架 2.0.0 / `v2.0.0` / `c507188`，14 文件哈希一致）                                               |
| `pnpm lint`                                                                   | exit 0                                                                                                   |
| `pnpm typecheck`                                                              | exit 0                                                                                                   |
| `pnpm test`                                                                   | 201 passed / 1 skipped（202 files）；3517 passed / 8 skipped（3525 tests），墙钟约 21 s，无长驻 dev 进程 |

CI：`c44388f` 12/12 success；`8607d68` 12/12 success（`Build Docker`、`Contracts`、`Coverage` 3 分片 + Gate、`E2E`、`Lint+Typecheck`、`Security Audit`、`Unit` 3 分片）。本轮加固提交的 CI 见提交后回填。

## 5. 偏差与取舍

| #   | 偏差                                                      | 原因与边界                                                                                                        |
| --- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| D1  | GUI 自动投递未启用                                        | `dispatch-channel.mjs` 仍是规则纯函数；浏览器 / 桌面自动化不可用时，不把「文件 Transport 闭环」外推成 GUI 闭环    |
| D2  | 协商轮未启用                                              | `transport/reviews`、review schema、交接件契约已具备；无活跃 review 文件，不把目录存在当协商已跑                  |
| D3  | `watch` 无常驻进程                                        | `run-once` 一次性执行；常驻属运维部署项，框架只要求可重复推进                                                     |
| D4  | `acceptance-runner` 的 `manualReviewItems` 固定 3 条      | 无 fail 时结论恒为 `conditional-pass`，`passed` 实际不可达；属验收器语义设计，未在本轮改动                        |
| D5  | `AF-023` 代码工作未走 claim 链路                          | 编排脚本改造的 `scope` 不在 executor 资源域，按 `orchestrator` 角色直接实施；DR-001 已提供完整 claim 链路实跑证据 |
| D6  | 快照 / `web/orchestration/data.js` 仍为 prettier 展开格式 | 已加入 `.prettierignore`；下一次真实任务写入会切到生成器格式，产生一次性 diff                                     |

## 6. 遗留与下一步

- GUI 派发：等桌面 / 浏览器自动化可用后，用 `minimax-code-relay` 口径接 `dispatch-channel`，并把发送结果回写 `dispatch.status`；在此之前保持「文件 Transport + 人工粘贴」半自动形态。
- 协商轮：需要真实任务触发一次 `transport/reviews` 往返，补齐裁决记录后再标闭环。
- 验收器语义：`manualReviewItems` 固定 3 条导致 `passed` 不可达，需在 `acceptance.md` 口径下决定「人工复核项是否阻断 passed」。
- DR-001 归档条目的 `artifacts.taskSheet` 仍指 transport；不做追溯改写，归档副本与交付记录头部承担审计。
- `task register --sheet` 仅单测覆盖，尚未用真实 Markdown 任务单实跑（`task import` 已实跑）。
- 真实发布 / 生产部署仍未执行（L4 冻结动作，归 Human）。

## 7. 回执形状（机读）

```yaml
taskId: AF-023
contextId: phase2.5-orchestration-closed-loop
type: implementation
baselineRef: 8607d68
changedFiles:
  added:
    - scripts/orchestration/task-intake.mjs
    - scripts/orchestration/receipts.mjs
    - docs/worklog/completed/phase2.5/af023-orchestration-runtime-closure-task-2026-11-17.md
    - docs/worklog/completed/phase2.5/af023-orchestration-runtime-closure-implementation-2026-11-17.md
  modified:
    - scripts/orchestration/scheduler.mjs
    - scripts/orchestration/handover-contract.mjs
    - scripts/orchestration/cli.mjs
    - scripts/orchestration/validator.mjs
    - scripts/orchestration/state-store.mjs
    - scripts/orchestration/branch-workflow.mjs
    - scripts/orchestration/acceptance-runner.mjs
    - scripts/orchestration/config.json
    - scripts/orchestration/__tests__/orchestration.spec.mjs
    - docs/team/agent-orchestration/README.md
    - docs/team/agent-orchestration/autonomous-team-design.md
    - docs/team/agent-orchestration/orchestration-snapshot.json
    - docs/team/agent-orchestration/task-state-index.json
    - docs/team/agent-orchestration/state/journal.jsonl
    - web/orchestration/data.js
    - .prettierignore
    - package.json
    - pnpm-lock.yaml
  deleted: []
artifactRefs:
  taskSheet: docs/worklog/completed/phase2.5/af023-orchestration-runtime-closure-task-2026-11-17.md
  deliveryRecord: docs/worklog/completed/phase2.5/af023-orchestration-runtime-closure-implementation-2026-11-17.md
  reply: null
  others: []
gateResults:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs --reporter=dot
    exitCode: 0
    errors: 0
    warnings: 0
    specFiles: 1
  - command: ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate
    exitCode: 0
    errors: 0
    warnings: 0
    specFiles: null
  - command: pnpm lint && pnpm typecheck
    exitCode: 0
    errors: 0
    warnings: 0
    specFiles: null
  - command: pnpm test
    exitCode: 0
    errors: 0
    warnings: 0
    specFiles: 202
scopeCheck: in-scope
parallelArtifactsExcluded: true
noOutscopeRefactor: true
contractChecks:
  - item: taskId
    result: pass
    note: 任务单与交付记录一致
  - item: artifacts
    result: pass
    note: 任务单为产出数组，索引指针分离
  - item: receipt-shape
    result: pass
    note: 回执按 receipt 1.0.0 七组字段
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
fieldAlignment:
  result: aligned
  note: 适配层版本范围与契约版本一致
backlogItems:
  - id: AF-023-B1
    impact: GUI 自动投递未启用，派发仍靠文件 Transport + 人工粘贴
    schedule: 待桌面自动化可用
  - id: AF-023-B2
    impact: 协商轮未跑真实往返，G4 只到能力就绪
    schedule: 下一轮真实任务触发
  - id: AF-023-B3
    impact: 验收器 manualReviewItems 固定 3 条，passed 不可达
    schedule: 验收口径评审后排期
openQuestions:
  - autoLoop 是否直接以 watch 常驻形态上线，还是先观察若干单再常驻
  - 超时持单后的回执恢复是否应自动清 escalation，还是保留人工确认痕迹
manualReviewList:
  - GUI 通道未验证，不得对外宣称全自动派发
  - DR-001 归档条目的 taskSheet 指针仍指 transport，审计以归档副本为准
  - 快照格式切换会在下一次真实写入时产生一次性 diff
deviationTable:
  - id: D1
    deviation: GUI 自动投递未启用
    impact: 派发需人工粘贴
    mitigation: 文件 Transport 闭环 + 回执归档
  - id: D2
    deviation: 协商轮未启用
    impact: G4 仅能力就绪
    mitigation: 保留 reviews 目录与 schema
  - id: D3
    deviation: watch 无常驻进程
    impact: 需外部调度触发 run-once
    mitigation: run-once 幂等、可重复执行
deviationAbsent: false
finalStatus: completed
reviewVerdict: conditional-pass
verdictRationale: 运行态闭环以 DR-001 实跑与 144 条编排单测为证；GUI 与协商轮按边界保留，不冒充闭环
```

## 8. 补丁：executor 资源域

- 发现：`executor.json` 的 `resources` 写作 `docs/worklog/pending/（任务切片范围内）`，路径带括号说明，`validateScopeDomain` 按前缀匹配永远判越域；且未覆盖 `docs/worklog/completed/`，执行侧写交付记录的任务会被路由拒绝。
- 修复：`resources` 改为 `docs/worklog/pending/`、`docs/worklog/completed/`；切片收窄仍由任务单 `scope.files` 与 `limits.canDo` 约束，不靠目录白名单。
- 证据：新增单测「真实 executor 卡资源域覆盖交付记录目录」，编排单测 145 passed。
