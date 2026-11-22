# AF-068 · AF-065 已验收场景透传改动落地

> 交付日期：2026-11-17
> 任务单：[af068-af065-scenario-type-landing-task-2026-11-17.md](../../pending/af068-af065-scenario-type-landing-task-2026-11-17.md)
> 基线：`ec345612fac8382acf333c744ca4c60c0a03ff29`（= 本单起点 HEAD）
> 分支：`task/AF-068-af065-scenario-type-landing`
> 来源提交：AF-065 `7fe02e524fbbb838de9c1727acbc5735df68e664`

## 1. 结论

AF-065 已验收的 `scenarioType` 透传改动已**原样落到当前 integrate 基线**（`ec34561`）：批次入口 → 队列 → worker → runner 四段链路闭合，`exam`（考核场景）有了生产 HTTP 入口，非法 `scenarioType` 明确报错且**不入队**，未传场景时 job data **不写该键**、由 runner 侧缺省 `full_simulation`。

本单**不改语义**：取回的三个路径内容与 AF-065 提交**逐字节一致**（`git diff 7fe02e5 -- <三个路径>` 输出为空），AF-065 交付记录 §3 的设计决策全部保留。闸门在本基线上复跑全绿。

> 与 AF-065 的区别只有一点：**AF-065 的改动当时只留在 stash / 提交里没并进 integrate**，本单把它真正落到工作树与暂存区，供主控提交。

## 2. 取回方式（严格限定三条路径）

按任务单 §取回方式，在仓库根执行：

```text
git checkout 7fe02e524fbbb838de9c1727acbc5735df68e664 -- src/auto-practice/auto-practice.controller.ts src/auto-practice/practice-queue.service.ts test/auto-practice/batch-scenario-type.spec.ts
```

- **只取这三条路径**：AF-065 提交里还含 `docs/team/agent-orchestration/**` 状态面改动、`scripts/orchestration/task-entry-gate.mjs` 门禁修复、`improvement-log.json`、AF-065 回执与归档件等 —— **一律未取回**，任务单明确要求。
- **未执行 `git stash pop` / `git stash apply`**：stash 里混着 docs/state/scripts 的门禁修复与状态面改动，弹整个 stash 会把越权内容一起带进工作树。
- 该命令把三个文件写入**暂存区**（`M` / `A`）；**未 commit、未 push、未 reset** —— 提交与状态迁移由主控执行。

## 3. 与 AF-065 交付记录的逐条核对

核对方式：`git diff 7fe02e524fbbb838de9c1727acbc5735df68e664 -- src/auto-practice/auto-practice.controller.ts src/auto-practice/practice-queue.service.ts test/auto-practice/batch-scenario-type.spec.ts` → **输出为空**（exit 0），即工作树内容与 AF-065 提交完全一致，无需按交付记录做修正。

| 核对项                                  | AF-065 交付记录要求                                                 | 落地实况                                                                                                                             | 位置                                               |
| --------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| `BatchBody.scenarioType` 可选           | `readonly scenarioType?: ScenarioType`（`import type`，编译期擦除） | ✅ 一致                                                                                                                              | `src/auto-practice/auto-practice.controller.ts:67` |
| `parseBatchScenarioType()` 未传         | 返回空对象 `{}`（不产出场景）                                       | ✅ `if (raw === undefined \|\| raw === null) return {};`                                                                             | `auto-practice.controller.ts:516`                  |
| `parseBatchScenarioType()` 合法值       | 返回 `{ value }`                                                    | ✅ `return { value: value as ScenarioType };`                                                                                        | `auto-practice.controller.ts:522`                  |
| `parseBatchScenarioType()` 非法值       | 返回 `{ error }`，错误带**原值 + 可选项清单**                       | ✅ `scenarioType 非法：${value \|\| '(空字符串)'}；可选值 ${DELIBERATION_SCENARIO_TYPES.join(' / ')}`                                | `auto-practice.controller.ts:519-521`              |
| `enqueueBatch()` 先校验再入队           | 非法 → **0 个 job**                                                 | ✅ 校验在 `:159-162`（早于 `:165` 入队循环），非法直接 `return { error }`                                                            | `auto-practice.controller.ts:154-179`              |
| 只在显式给场景时才写键                  | `...(scenario.value ? { scenarioType: scenario.value } : {})`       | ✅ 一致                                                                                                                              | `auto-practice.controller.ts:174`                  |
| 取值清单单一来源                        | 运行时用审议侧权威常量 `DELIBERATION_SCENARIO_TYPES`                | ✅ `src/engine-adapters/deliberation/deliberation-mode.config.ts:68` = `['freeform','full_simulation','exam']`，**未复制第二份枚举** | `auto-practice.controller.ts:39`                   |
| `AutoPracticeJobData.scenarioType` 可选 | `readonly scenarioType?: ScenarioType`                              | ✅ 一致                                                                                                                              | `src/auto-practice/practice-queue.service.ts:51`   |
| `processJob()` 原样透传                 | `runner.run({ ..., scenarioType: data.scenarioType })`              | ✅ 一致（缺省即 `undefined`）                                                                                                        | `practice-queue.service.ts:191`                    |
| 队列 `enqueue()` 不动                   | 薄 payload 纪律不变                                                 | ✅ 未改 `enqueue()`，payload 仍只传 id 类字段 + `scenarioType` 原样                                                                  | `practice-queue.service.ts:185-192`                |
| 不改 runner / turn-engine               | `practice-runner.service.ts`、`ports/turn-engine.port.ts` 一行未改  | ✅ `git status` 两文件均无改动                                                                                                       | —                                                  |
| 不改审议边界 / LLM / DB / `.env`        | —                                                                   | ✅ 本单未触碰任何相关路径                                                                                                            | —                                                  |

**未改文件**：`src/auto-practice/practice-runner.service.ts`、`src/auto-practice/ports/turn-engine.port.ts`、审议判定与策略边界、LLM 调用、`.env`、数据库。

## 4. 改动文件清单

| 文件                                             | 改动                                                                                | 行数 |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- | ---- |
| `src/auto-practice/auto-practice.controller.ts`  | `BatchBody.scenarioType` + `parseBatchScenarioType()` + `enqueueBatch()` 校验与透传 | +44  |
| `src/auto-practice/practice-queue.service.ts`    | `AutoPracticeJobData.scenarioType` + `processJob()` 透传 `runner.run()`             | +10  |
| `test/auto-practice/batch-scenario-type.spec.ts` | 新增：9 个用例（HTTP 入口 6 + 队列/worker 3）                                       | +332 |

`git diff --stat HEAD -- <三个路径>` → **3 files changed, 386 insertions(+)**，**0 deletions** —— 纯增量，未改任何既有行。

## 5. 测试

`test/auto-practice/batch-scenario-type.spec.ts`（9 例，本基线上复跑全绿）：

**HTTP 入口**（真 Nest app + supertest 打真路由 + 真 body 解析；只把 runner / repo / guard / bullmq / ioredis 打桩）

| 用例              | 断言要点                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| `exam` 透传       | 201；`enqueued=1`；job data `scenarioType === 'exam'`                                               |
| `exam` × 笛卡尔积 | 2 角色 × 2 模式 → 4 个 job **每个**都带 `exam`                                                      |
| 缺省              | 不传 → job data **不含** `scenarioType` 键（`Object.hasOwn === false`），不是"写成 full_simulation" |
| 非法值            | `scenarioType='exam-mode'` → body 带 `error`（含原值 + 三个可选项）；**入队 0 次**                  |
| 非法值（空白串）  | `'   '` → 判非法（不当作"没传"）；入队 0 次                                                         |
| `freeform`        | 自由练习场景同样可从生产入口创建                                                                    |

**队列 → worker → runner**（真 `PracticeQueueService`；bullmq 替身捕获入队 payload 与 Worker 处理器）

| 用例        | 断言要点                                                                                           |
| ----------- | -------------------------------------------------------------------------------------------------- |
| `enqueue`   | payload 原样带 `scenarioType: 'exam'`                                                              |
| worker 透传 | job data 带 `exam` → `runner.run()` 原样收到 `exam`                                                |
| worker 缺省 | job data 不带场景 → `runner.run()` 收到 `undefined`；`?? 'full_simulation'` 仍为 `full_simulation` |

> ⚠️ **未做真实批次实测**：本单不跑真实批次、不连生产库、不发 LLM（任务单 §边界明确禁止）。`exam` 的**入口**在 HTTP 层实测（真路由 + 真 body 解析 + 真 controller + 真队列 payload 断言）；`exam` 之后的引擎侧行为由既有 `practice-runner.spec.ts` 覆盖，本单不重复造。

## 6. 闸门（真实复跑数字）

| 闸门                   | 命令                                                                    | exit | 结果                                                       |
| ---------------------- | ----------------------------------------------------------------------- | ---- | ---------------------------------------------------------- |
| 定向单测（任务单指定） | `pnpm exec vitest run test/auto-practice/batch-scenario-type.spec.ts`   | 0    | 1 file / **9 tests passed** / 0 failed（1.65s）            |
| 目录回归（补充）       | `pnpm exec vitest run test/auto-practice/`                              | 0    | **21 files passed / 342 tests passed** / 0 failed（2.31s） |
| 类型检查（任务单指定） | `pnpm typecheck`                                                        | 0    | **0 error**（增量）                                        |
| 根类型检查（补充）     | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` | 0    | **0 error**（全量，**覆盖 test/**）                        |
| Lint（任务单指定）     | `pnpm lint`                                                             | 0    | **0 error / 0 warning**                                    |
| 内核边界（补充）       | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                | 0    | 1 file / **12 tests passed** / 0 failed（1.36s）           |
| 内核对账               | `git diff --stat HEAD -- src/engine-core`                               | 0    | **空**（内核一行未动）                                     |

**机器**：`DESKTOP-E3EVQ9P` / node `v26.13.1` / Windows NT 10.0.22631.0 / PowerShell 5.1。

**回归对账**：目录回归 21 files / 342 tests，相对 AF-067 记录的 20 files / 333 tests 恰好 **+1 file / +9 tests** —— 增量全部来自本单新增的 `batch-scenario-type.spec.ts`，**既有用例零回归**。

**Lint 说明**：AF-065 当时 lint 首轮报过 1 error + 2 warning（`unicorn/prefer-string-repeat` + 两处 `import/order`）并已修完；本单取回的是**修完后的版本**，故 lint **首轮即 0 error / 0 warning**，无需二次修法。

## 7. 偏差与设计决策

1. **类型闸门覆盖范围**：`pnpm typecheck`（`tsconfig.check.json` → `tsconfig.build.json`）的 `exclude` 含 `**/*.spec.ts` 与 `test/**/*`，**本单新增的 spec 文件不在该闸门覆盖内**。为不拿"不含该文件的闸门"冒充验证，额外跑根 `tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`（根 tsconfig 的 include 覆盖 `test/**/*`）确认新测试文件类型正确 —— **0 error**。两条都写进 `gateResults`。工程缺口本身属既有债（非本单引入），已登记为 backlog。
2. **额外闸门**：任务单只列 3 条 gates，本单额外跑了「目录回归」「根类型检查」「内核边界」3 条 —— 均为只读、无副作用，用于证明"落地未引入回归"与"内核一行未动"。超出任务单的闸门数不构成范围越界（不改任何文件）。
3. **任务单状态行与归档未动**：任务由主控持有（`submitted`），executor 被禁止运行 `promote` / `run-once` / `archive` 等编排命令。按 AF-063 / AF-067 先例，**只产出交付记录与机读回执**，任务单原文与状态面保持不动；归档、状态索引 / 事件链更新由主控在 `archive` 步骤执行。
4. **机读回执落点**：回执写在 `docs/team/agent-orchestration/transport/receipts/AF-068.json`（`transport/` 在 `.gitignore` 内，只作收件箱）；durable 副本由编排摄取流程 `archiveReceiptFile` 复制到 `docs/worklog/pending/archive/`，executor 不越权写 archive（避免双份与指纹不一致）。
5. **取回用 `git checkout -- <paths>` 而非 `stash pop`**：AF-065 提交与 stash 里混有 `docs/` `state/` `scripts/` 的门禁修复与状态面改动，按路径限定取回是唯一能保证不越权的做法；代价是三个文件进入暂存区（提交由主控执行）。
6. **未重跑 AF-065 的 `pnpm orchestration:preflight`**：该命令属编排门禁（由主控/Husky 在提交时执行），且本单明确禁止运行任何 `node scripts/orchestration/cli.mjs` 子命令。改以「内核 diff 空 + 范围只含三条路径」的自证方式记录。
7. **未跑真实批次 / 未连生产库 / 未发 LLM**：任务单 §边界明确禁止；`exam` 的引擎侧行为由既有 `practice-runner.spec.ts` 覆盖。

## 8. 范围与隔离

- 本单改动**仅 3 个代码/测试路径** + 本交付记录 + 回执 + 回复原文，全部在任务单 `scope.files`（`src/auto-practice/`、`test/auto-practice/`、`docs/worklog/pending/`、`docs/worklog/completed/phase2.5/`）内。
- **未触碰并行产物**（工作树内存在，**不清理、不还原、不纳入本单声明集**）：
  - `admin-dashboard/pnpm-lock.yaml`
  - `data/batch-reports/**`（多条删除 / 修改 + `index.md` + 新增 `uJHgP8uQGeM8Z6HbZY7M5.*`）
  - `web/orchestration/data.js`
  - `docs/team/agent-orchestration/orchestration-snapshot.json`、`state/journal.jsonl`、`task-state-index.json`（主控的状态面）
  - `docs/architecture/phase3-judge-layer-ai-review-design-2026-11-15.md`
  - `docs/worklog/pending/af064-wp-k-missing-batch-exit-task-2026-11-17.md`、`af066-local-gate-archived-delivery-task-2026-11-17.md`（AF-064 / AF-066 另单的并行产物）
  - `docs/worklog/pending/archive/AF-062-receipt-RC-AF-062-1.json`
- **未执行**：任何 `node scripts/orchestration/cli.mjs` 子命令（无 promote / resume / run-once / archive / channel confirm）、`git commit`、`git push`、`git reset`、`--no-verify`。
- **未改**：`src/engine-core/**`、`.env`、数据库、LLM 调用、审议判定与策略边界。

## 9. 机读回执字段（验收机读标记）

- `gateResults`：定向单测 9 passed / 0 failed（exit 0）；目录回归 21 files / 342 tests passed / 0 failed（exit 0）；`pnpm typecheck` exit 0 / 0 error；根 tsc exit 0 / 0 error（覆盖 test/）；`pnpm lint` exit 0 / 0 error / 0 warning；内核边界 12 passed / 0 failed（exit 0）；`git diff --stat HEAD -- src/engine-core` 空。
- `scopeCheck`：`in-scope`；改动仅 2 源文件 + 1 新测试 + 本单文档，均在任务单 `scope.files` 内；并行产物已排除且未纳入本单声明集。
- `contractChecks`：taskId / state-write / scope-file / contract-ref / enum-ssot 五项通过；任务单 4 条 gates 阈值齐全，六组机读字段齐全。
- `backlogItems`：1 项 —— 类型闸门对测试目录长期无覆盖（既有债，非本单引入）。
- `deviationTable`：见 §7 七条（类型闸门覆盖范围 / 额外闸门 / 任务单状态行与归档 / 回执落点 / checkout 取回方式 / 未跑 preflight / 未跑真实批次）。
- `reviewVerdict`：`passed`；理由见 §10。

## 10. 结论

- `finalStatus`: `completed`
- `reviewVerdict`: `passed`
- `verdictRationale`: AF-065 已验收的 `scenarioType` 透传改动已**逐字节**落到当前 integrate 基线 `ec34561`（`git diff 7fe02e5 -- <三个路径>` 输出为空），四段链路（HTTP 入口 → 队列 → worker → runner）闭合：`exam` 有生产 HTTP 入口且非法值**报错并 0 入队**（不静默降级 `full_simulation`），未传场景时 job data **不写该键**、缺省语义只留 runner 一份。闸门真实数字：定向 vitest 1 file / 9 tests passed / 0 failed；目录回归 21 files / 342 tests passed / 0 failed（较 AF-067 恰好 +1 file / +9 tests，既有用例零回归）；`pnpm typecheck` 0 error；根 tsc（含 test/）0 error；`pnpm lint` 0 error / 0 warning；内核边界 12 passed / 0 failed；`git diff --stat HEAD -- src/engine-core` 为空。runner、turn-engine、审议判定、策略边界与 LLM 调用一行未改；并行产物未清理、未还原、未纳入本单；未执行任何编排状态面命令，提交与归档由主控完成。
