# AF-067 · 回归判定器四态边界回归测试补齐

> 交付日期：2026-11-17
> 任务单：[af067-regression-evaluator-boundary-tests-task-2026-11-17.md](../../pending/af067-regression-evaluator-boundary-tests-task-2026-11-17.md)
> 基线：`79a5ee2bf7d213bd74f9a92a44e86909176eec87`
> 分支：`task/AF-067-regression-evaluator-boundary-tests`
> 角色：executor（只做实现与回执；提交 / 状态迁移 / 归档由主控执行）

## 1. 结论

`src/auto-practice/metrics/regression-evaluator.ts`（WP-K 回归判定器）的四态边界现已由独立回归测试锁定：新增 `test/auto-practice/regression-evaluator-boundary.spec.ts`，27 例全绿，覆盖 incomparable 的五类原因、regressed 优先于 improved、neutral 方向指标不参与好坏判定、REGRESSION_TOL 临界两侧，以及缺失 / 未知指标不硬判。

本单**零生产代码改动**：`git diff --stat HEAD -- src/engine-core` 为空，`src/` 全树未改。

## 2. 交付物

| 工件                         | 路径                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| 新增回归测试（唯一代码产物） | `test/auto-practice/regression-evaluator-boundary.spec.ts`（338 行 / 27 例）              |
| 交付记录（本文件）           | `docs/worklog/completed/phase2.5/af067-regression-evaluator-boundary-tests-2026-11-17.md` |
| 机读回执                     | `docs/team/agent-orchestration/transport/receipts/AF-067.json`                            |
| 回复原文                     | `docs/worklog/pending/relay-response-20261117-2248.md`                                    |

未改既有测试（`test/auto-practice/wp-k-regression-evaluator.spec.ts` 保持原样）、未改 `src/`、未动 `data/batch-reports/**`、`admin-dashboard/**`、`web/orchestration/**`。

## 3. 用例矩阵

夹具策略：不复用 `computeBatchSnapshot`，改用**字面量最小 `BatchMetricsV1`**（1 场血缘 + 满覆盖 10/10 + 空指标表），使测试只依赖 `evaluateRegression` 纯函数，不触碰计算层、容器、DB 与网络；指标方向一律取自生产字典（`METRIC_BY_ID`），不自造口径。

### 3.1 incomparable（不可比时绝不硬比）

| 场景                     | 断言要点                                                                                                                       | 用例名                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| acceptance 判据段不同    | `verdict=incomparable`；`reasons` 精确等于 `['两批验收判据 (acceptance) 不同']`；`items=[]`；`changedSegments` 含 `acceptance` | acceptance 判据段不同 → incomparable, reasons 精确且 items 为空     |
| 基线批覆盖率 < 0.9       | 理由精确指向**基线批**：`['基线批覆盖率低于 0.9']`                                                                             | 基线批覆盖率 0.8 → incomparable, 理由指向基线批                     |
| 候选批覆盖率 < 0.9       | 理由精确指向**候选批**：`['候选批覆盖率低于 0.9']`                                                                             | 候选批覆盖率 0.8 → incomparable, 理由指向候选批                     |
| 覆盖率**恰好** 0.9       | 可比（`verdict=neutral`，`reasons=[]`）—— 阈值是「低于」才不可比                                                               | 覆盖率恰好等于阈值 0.9 → 可比 (低于才不可比)                        |
| 覆盖率 0.89              | 不可比（阈值下侧）                                                                                                             | 覆盖率 0.89 → 不可比 (阈值下侧)                                     |
| counselorModeId 集合不同 | 理由精确 `['两批 counselorModeId 集合不同']`；**不误报** characterSlug 原因                                                    | counselorModeId 集合不同 → incomparable, 且不误报角色原因           |
| characterSlug 集合不同   | 理由精确 `['两批 characterSlug 集合不同']`；**不误报** counselorModeId 原因                                                    | characterSlug 集合不同 → incomparable, 且不误报模式原因             |
| 集合 size 同、成员不同   | 仍不可比（`setsEqual` 不只比 size）                                                                                            | 集合大小相同但成员不同 → 仍 incomparable (不只比 size)              |
| 基线批 combined=unknown  | 理由 `['基线批配置指纹 combined=unknown']`                                                                                     | 基线批 combined=unknown → incomparable                              |
| 候选批 combined=unknown  | 理由 `['候选批配置指纹 combined=unknown']`                                                                                     | 候选批 combined=unknown → incomparable                              |
| 仅 combined 不同         | `changedSegments=[]`（combined 不在 7 段比较序列内）                                                                           | 仅 combined 不同 → 7 段指纹无变化段 (combined 不参与段比较)         |
| 多条原因并存             | 四条原因按生产实现顺序齐出、**不合并不去重**、不吞并                                                                           | acceptance 不同 + 覆盖率不足 + combined 未知 → 四条原因齐出, 不吞并 |

> 纪律要点：每个不可比用例都断言 `reasons` **原文**而非只断言 `verdict`。静默丢原因比判错更危险 —— 报告读者要能看出「为什么不可比」。

### 3.2 四态判定

| 场景                          | 断言要点                                                                                                                                              | 用例名                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 仅改善                        | `improved`；`movement=improved`                                                                                                                       | 仅改善 → improved                                                       |
| **regressed 优先于 improved** | 同时有 trust↑（improved）与 zero_motion↑（lower_is_better → regressed）→ 整批 `regressed`；`items` 两条且 movement 分别为 improved / regressed        | regressed 优先于 improved (任一指标回归即整批回归)                      |
| 全部落在容差内                | `neutral`；`items` 仍在且 movement 全为 `neutral`                                                                                                     | 全部落在容差内 → neutral (items 仍在, movement 全 neutral)              |
| neutral 方向指标不参与判定    | `event.empathy.rate` / `dim.arousal.delta_avg` / `session.outcome.completed` / `text.disfluency.filler_per_turn` 剧变 → `items=[]`、`verdict=neutral` | neutral 方向指标不参与好坏判定 (事件率/唤醒/出口/不流利 全部不进 items) |
| neutral 变化不掩盖方向改善    | 方向指标改善 + neutral 指标剧变 → 仍 `improved`，`items` 只 1 条                                                                                      | neutral 指标剧烈变化不掩盖方向指标的改善                                |

### 3.3 REGRESSION_TOL 边界（`REGRESSION_TOL = 0.01`）

| 场景                                | 断言要点                                                                                                 | 用例名                                                                       |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| delta **恰好等于** 容差             | `delta === REGRESSION_TOL`；`movement=neutral`；`verdict=neutral`                                        | delta 恰好等于容差 → neutral (不判 movement)                                 |
| delta 略超容差（+1e-6），正向       | higher_is_better → `improved`                                                                            | delta 略超容差 → improved (higher_is_better)                                 |
| delta 略超容差，负向                | higher_is_better → `regressed`                                                                           | delta 略超容差且为负 → regressed (higher_is_better)                          |
| lower_is_better，delta 恰好等于容差 | `neutral`                                                                                                | lower_is_better 指标: delta 恰好等于容差 → neutral                           |
| lower_is_better，delta 略超容差     | `regressed`                                                                                              | lower_is_better 指标: delta 略超容差 → regressed                             |
| lower_is_better，delta 略超且为负   | `improved`                                                                                               | lower_is_better 指标: delta 略超容差且为负 → improved                        |
| 十进制意义上的「恰好 0.01」         | `0.51 - 0.5 = 0.010000000000000009 > REGRESSION_TOL` → 判为 movement（**浮点现状如实锁定**，不静默改判） | 十进制意义上的"恰好 0.01"在二进制下略大于容差 → 判为 movement (浮点现状锁定) |

> 之所以把「等于容差」写成 `base=0 / candidate=REGRESSION_TOL`：这是二进制下**真正精确等于**容差的构造方式。若用 `0.5 → 0.51`，浮点差值略大于容差，会被判为 movement —— 该事实由独立用例显式记录，不混进「等于容差」用例里。

### 3.4 缺失 / 未知指标不硬判

| 场景               | 断言要点                            | 用例名                                           |
| ------------------ | ----------------------------------- | ------------------------------------------------ |
| 候选批缺该指标     | 跳过，`items=[]`、`verdict=neutral` | 候选批缺该指标 → 跳过, 不产出 improved/regressed |
| 任一侧为 `null`    | 跳过，`items=[]`、`verdict=neutral` | 任一侧为 null → 跳过, 不产出 improved/regressed  |
| 指标 id 不在字典中 | 跳过（未知口径不硬比），`items=[]`  | 指标 id 不在字典中 → 跳过 (不硬比未知口径)       |

## 4. 闸门（真实数字，2026-11-17 现场复跑）

| 闸门                 | 命令                                                                            | 结果                                                        |
| -------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 定向回归（任务闸门） | `pnpm exec vitest run test/auto-practice/regression-evaluator-boundary.spec.ts` | exit 0；**1 file / 27 tests passed / 0 failed**；333ms      |
| 目录回归（加固）     | `pnpm exec vitest run test/auto-practice/`                                      | exit 0；**20 files / 333 tests passed / 0 failed**；2.31s   |
| 类型检查（任务闸门） | `pnpm typecheck`                                                                | exit 0；**0 error**（`tsc -b tsconfig.check.json`）         |
| 类型检查（含 test/） | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`         | exit 0；**0 error**（根 tsc，`include` 覆盖 `test/**/*`）   |
| Lint                 | `pnpm lint`                                                                     | exit 0；**0 error / 0 warning**（`{src,test,bin}/**/*.ts`） |
| 内核边界             | `git diff --stat HEAD -- src/engine-core`                                       | **空**（本单未动内核 / 引擎边界）                           |

机器：`DESKTOP-E3EVQ9P` / node v26.13.1 / PowerShell 5.1。

> ⚠️ 口径如实说明（见 §7 偏差 ①）：任务单写的 `pnpm typecheck` 走 `tsconfig.check.json` → 继承 `tsconfig.build.json`，其 `exclude` 含 `**/*.spec.ts` 与 `test/**/*`，**新增的 spec 文件不在该闸门覆盖内**。故额外跑根 tsc（`tsconfig.json` 的 `include` 含 `test/**/*`）确认新增文件本身 0 error，两条都记入回执 `gateResults`，不拿不含文件的闸门冒充覆盖。

## 5. 范围与隔离

- **只新增** `test/auto-practice/regression-evaluator-boundary.spec.ts` 一个代码文件；未改 `src/` 任何文件、未改任何既有测试。
- 未运行 LLM 批次、未动数据库 / Redis / `.env`、未跑任何 `node scripts/orchestration/cli.mjs` 子命令、未执行 `git commit` / `push` / `checkout` / `reset`。
- 工作树内存在并行产物（`data/batch-reports/**` 增删、`admin-dashboard/pnpm-lock.yaml`、`web/orchestration/data.js`、`docs/team/agent-orchestration/` 状态面、`docs/architecture/phase3-judge-layer-ai-review-design-2026-11-15.md`、AF-064 / AF-066 任务单等），**一律不计入本单交付集**（回执 `changedFiles` 只列本单 3 个文件，`parallelArtifactsExcluded=true`）。
- 本单属 `verification` 类型，只产测试与报告，不占写域。

## 6. 六组机读字段（验收机读标记）

- `gateResults`：定向回归 27 passed / 0 failed（exit 0）；目录回归 333 passed / 0 failed（exit 0）；`pnpm typecheck` exit 0 / 0 error；根 tsc exit 0 / 0 error；`pnpm lint` exit 0 / 0 error / 0 warning；`git diff --stat HEAD -- src/engine-core` 为空。
- `scopeCheck`：`in-scope`；只新增 1 个测试文件 + 交付记录 + 回执 + 回复原文，无 `src/` 改动、无数据 / 环境 / 运行态变更。
- `contractChecks`：taskId / state-write / index-schema / event-chain 四项通过 —— 本单未执行任何状态面写入命令，任务状态仍由主控持有（submitted）。
- `backlogItems`：1 条（BL-AF067-01，类型闸门对 `test/**/*.spec.ts` 长期无覆盖，既有债，本单只如实记录不修）。
- `deviationTable`：3 条 —— ①类型闸门不覆盖 spec（补跑根 tsc）；②任务单归档与状态迁移留给主控；③机读回执落 transport 收件箱（gitignore），durable 副本由编排归档流程复制。
- `reviewVerdict`：`passed`；理由见 §7。

## 7. 偏差表

| 项                 | 任务单写法                                                                  | 代码 / 工程现实                                                                                                                                    | 实际处理                                                                                              | 理由                                                                                                                |
| ------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| ① 类型闸门覆盖范围 | gates 写 `pnpm typecheck`                                                   | `tsconfig.check.json` → `tsconfig.build.json` 的 `exclude` 含 `**/*.spec.ts` 与 `test/**/*`，新增 spec 不在其覆盖内                                | 保留 `pnpm typecheck`（exit 0 / 0 error），另跑根 tsc（exit 0 / 0 error），两条都进回执 `gateResults` | 闸门数字必须能复跑且不夸大覆盖；不拿不含该文件的闸门冒充验证                                                        |
| ② 任务单成对归档   | `artifacts` 只列交付记录                                                    | `conventions.md` §六要求任务单与交付记录一同移入 `completed/phase2.5/`；但本单状态由主控持有，executor 被禁止跑 `promote` / `archive` / `run-once` | 只产出交付记录与机读回执，**任务单不动**，归档与状态迁移由主控在 archive 步骤执行                     | 状态迁移是主控职责；executor 自行搬任务单会与主控归档动作打架                                                       |
| ③ 机读回执落点     | 本单简报指定 `docs/team/agent-orchestration/transport/receipts/AF-067.json` | 该目录在 `.gitignore` 内（transport 只作收件箱）；durable 副本由编排摄入流程复制到 `docs/worklog/pending/archive/`                                 | 回执按简报写入 transport 收件箱，**不自行复制 archive 副本**（该步骤属主控归档动作）                  | 回执摄取与归档由编排侧 `ingestReceipts` / `archiveReceiptFile` 完成，executor 越权写 archive 会造成双份与指纹不一致 |

## 8. 结论

- `finalStatus`：`completed`
- `reviewVerdict`：`passed`
- `verdictRationale`：新增 `test/auto-practice/regression-evaluator-boundary.spec.ts` 27 例全绿，逐条锁定 incomparable 五类原因（含 acceptance / 双侧覆盖率 / counselorModeId 集合 / characterSlug 集合 / combined=unknown）与原因文案原文、regressed 优先于 improved、neutral 方向指标不参与好坏判定、REGRESSION_TOL 临界两侧（含浮点「十进制恰好 0.01」现状）、缺失与未知指标不硬判；目录回归 20 文件 333 例全绿；`pnpm typecheck` 0 error、根 tsc（含 test/）0 error、`pnpm lint` 0 error 0 warning；`git diff --stat HEAD -- src/engine-core` 为空；未改 `src/` 与既有测试，未提交并行产物，未执行任何状态面命令。

## 9. 遗留与主控待办

1. **BL-AF067-01**：类型闸门对 `test/**/*.spec.ts` 长期无覆盖（`pnpm typecheck` 排除 test/）。影响面：所有新增测试的类型正确性需另跑根 tsc 才能保证。既有债、非本单引入，本单不改工程配置；如需修复应另立任务单改 `tsconfig.check.json` 的 include/exclude。
2. **主控待办**：①提交本单 3 个文件（建议 commit message `test(AF-067): 补齐回归判定器四态边界回归测试`）；②`run-once` 摄入回执（transport 收件箱 → `docs/worklog/pending/archive/` durable 副本）；③把任务单移入 `docs/worklog/completed/phase2.5/` 并更新状态索引 / 事件链。
