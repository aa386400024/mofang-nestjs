# AF-068 · executor 回复（派单时间 2026-11-17 23:10）

> 任务：AF-068 · AF-065 已验收场景透传改动落地
> 角色：executor（只做实现、闸门、交付记录与回执；提交 / 状态迁移 / 归档由主控执行）
> 仓库：`D:\work\Project\backend\mofang-nestjs`
> 分支：`task/AF-068-af065-scenario-type-landing`
> 基线：`ec345612fac8382acf333c744ca4c60c0a03ff29`
> 来源提交：AF-065 `7fe02e524fbbb838de9c1727acbc5735df68e664`

## 1. 结论

**completed / reviewVerdict=passed。** AF-065 已验收的 `scenarioType` 透传改动已**逐字节**落到当前 integrate 基线：HTTP 入口 → 队列 → worker → runner 四段链路闭合，`exam`（考核场景）有了生产 HTTP 入口，非法 `scenarioType` 明确报错且 **0 个 job 入队**，未传场景时 job data **不写该键**（缺省语义只留 runner 一份）。

落地体量：**3 files changed, 386 insertions(+), 0 deletions**（纯增量，未改任何既有行）。`practice-runner.service.ts` / `ports/turn-engine.port.ts` 一行未改，`git diff --stat HEAD -- src/engine-core` 为空。

## 2. 交付物

| 工件                   | 路径                                                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 取回落地（2 个源文件） | `src/auto-practice/auto-practice.controller.ts`（+44）<br>`src/auto-practice/practice-queue.service.ts`（+10）               |
| 新增测试               | `test/auto-practice/batch-scenario-type.spec.ts`（+332 / 9 例）                                                              |
| 交付记录               | `docs/worklog/completed/phase2.5/af068-af065-scenario-type-landing-2026-11-17.md`                                            |
| 机读回执               | `docs/team/agent-orchestration/transport/receipts/AF-068.json`（已过框架 `receipt:1.0.0` schema 校验：`ok=true, errors=[]`） |
| 回复原文               | `docs/worklog/pending/relay-response-20261117-2310.md`                                                                       |

未改 `src/engine-core/**`、未改 `.env` / 数据库 / LLM 调用、未改审议判定与策略边界、未跑真实批次。

## 3. 取回方式（严格限定三条路径）

按任务单 §取回方式，在仓库根执行：

```text
git checkout 7fe02e524fbbb838de9c1727acbc5735df68e664 -- src/auto-practice/auto-practice.controller.ts src/auto-practice/practice-queue.service.ts test/auto-practice/batch-scenario-type.spec.ts
```

- **只取这三条路径**：AF-065 提交里还含 `docs/team/agent-orchestration/**` 状态面、`scripts/orchestration/task-entry-gate.mjs` 门禁修复、`improvement-log.json`、AF-065 回执与归档件 —— **一律未取回**。
- **未执行 `git stash pop` / `apply`**：stash 内混着 docs/state/scripts 的门禁修复与状态面改动，弹整个 stash 会把越权内容一起带进工作树。
- 该命令把三个文件写入**暂存区**（`M` / `A`）；**未 commit、未 push、未 reset**。

**内容一致性自证**：`git diff 7fe02e524fbbb838de9c1727acbc5735df68e664 -- <三个路径>` → **输出为空**（exit 0），即工作树内容与 AF-065 已验收提交逐字节一致，**无需**按交付记录做修正。

## 4. 覆盖对照（逐条对应派单要求）

| 派单要求                                           | 落地实况                                                                                                                         | 位置                                  |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `BatchBody.scenarioType` 可选                      | ✓ `readonly scenarioType?: ScenarioType`（`import type`，编译期擦除）                                                            | `auto-practice.controller.ts:67`      |
| `parseBatchScenarioType()` 未传返回空对象          | ✓ `if (raw === undefined \|\| raw === null) return {};`                                                                          | `auto-practice.controller.ts:516`     |
| `parseBatchScenarioType()` 合法返回值              | ✓ `return { value: value as ScenarioType };`                                                                                     | `auto-practice.controller.ts:522`     |
| 非法返回带**原值 + 可选项**的错误                  | ✓ `scenarioType 非法：${value \|\| '(空字符串)'}；可选值 ${DELIBERATION_SCENARIO_TYPES.join(' / ')}`                             | `auto-practice.controller.ts:519-521` |
| `enqueueBatch()` **先校验再入队**，非法时 0 个 job | ✓ 校验在 `:159-162`（早于 `:165` 入队循环），非法直接 `return { error }`                                                         | `auto-practice.controller.ts:154-179` |
| 只在显式给场景时才写 `scenarioType` 键             | ✓ `...(scenario.value ? { scenarioType: scenario.value } : {})`                                                                  | `auto-practice.controller.ts:174`     |
| 取值清单单一来源（不复制第二份枚举）               | ✓ 运行时用审议侧权威常量 `DELIBERATION_SCENARIO_TYPES`（`deliberation-mode.config.ts:68` = `freeform`/`full_simulation`/`exam`） | `auto-practice.controller.ts:39`      |
| `AutoPracticeJobData.scenarioType` 可选            | ✓ `readonly scenarioType?: ScenarioType`                                                                                         | `practice-queue.service.ts:51`        |
| `processJob()` 原样透传 `runner.run()`             | ✓ `runner.run({ ..., scenarioType: data.scenarioType })`（缺省即 `undefined`）                                                   | `practice-queue.service.ts:191`       |
| 不改 runner / turn-engine / 审议边界 / LLM / DB    | ✓ 两个文件 `git status` 均无记录；其余路径本单未触碰                                                                             | —                                     |

**测试 9 例全绿**：HTTP 入口 6 例（`exam` 透传 / `exam` 笛卡尔积 4 job 每个都带 / 缺省 `Object.hasOwn === false` / 非法值报错且入队 0 次 / 空白串判非法 / `freeform` 可创建）+ 队列与 worker 3 例（payload 原样带 `exam` / worker 原样透传 `exam` / worker 缺省收到 `undefined` 且 `?? 'full_simulation'` 仍成立）。

## 5. 闸门真实数字（2026-11-17 现场复跑，机器 `DESKTOP-E3EVQ9P` / node v26.13.1 / Windows NT 10.0.22631.0）

| 闸门                       | 命令                                                                    | 结果                                                      |
| -------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------- |
| 定向单测（任务闸门）       | `pnpm exec vitest run test/auto-practice/batch-scenario-type.spec.ts`   | exit 0；1 file / **9 tests passed / 0 failed**；1.65s     |
| 目录回归（补充）           | `pnpm exec vitest run test/auto-practice/`                              | exit 0；**21 files / 342 tests passed / 0 failed**；2.31s |
| 类型检查（任务闸门）       | `pnpm typecheck`                                                        | exit 0；**0 error**（增量）                               |
| 类型检查（含 test/，补充） | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` | exit 0；**0 error**（全量，实际覆盖新增 spec 文件）       |
| Lint（任务闸门）           | `pnpm lint`                                                             | exit 0；**0 error / 0 warning**                           |
| 内核边界（补充）           | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                | exit 0；1 file / **12 tests passed / 0 failed**；1.36s    |
| 内核对账                   | `git diff --stat HEAD -- src/engine-core`                               | **空**                                                    |
| 落地一致性对账             | `git diff 7fe02e5 -- <三个路径>`                                        | **空**（与 AF-065 逐字节一致）                            |

**回归对账**：目录回归 21 files / 342 tests，相对 AF-067 记录的 20 files / 333 tests 恰好 **+1 file / +9 tests** —— 增量全部来自本单新增的 `batch-scenario-type.spec.ts`，**既有 333 例零回归**。

**Lint 说明**：AF-065 当时 lint 首轮报过 1 error + 2 warning（`unicorn/prefer-string-repeat` + 两处 `import/order`）并已修完；本单取回的是**修完后的版本**，故 lint **首轮即 0 error / 0 warning**，无二次修法。

⚠️ **口径提醒**：`pnpm typecheck` 走 `tsconfig.check.json` → `tsconfig.build.json`，其 `exclude` 含 `**/*.spec.ts` 与 `test/**/*`，**不覆盖新增的 spec 文件**。故额外跑根 tsc（`include` 含 `test/**/*`）确认新增文件本身 0 error，两条均写入回执 `gateResults`。

## 6. 范围与隔离

- 本单改动**仅 3 个代码/测试路径** + 交付记录 + 回执 + 本回复，共 6 个文件，全部落在任务单 `scope.files`（`src/auto-practice/`、`test/auto-practice/`、`docs/worklog/pending/`、`docs/worklog/completed/phase2.5/`）内。
- **未运行任何 `node scripts/orchestration/cli.mjs` 子命令**（无 promote / resume / run-once / archive / channel confirm）；**未 `git commit` / `push` / `reset`**；未领单、未改状态索引 / 事件链 / 编排状态面。
- 工作树内存在并行产物（`data/batch-reports/**` 增删、`admin-dashboard/pnpm-lock.yaml`、`web/orchestration/data.js`、`orchestration-snapshot.json` / `journal.jsonl` / `task-state-index.json`、AF-064 / AF-066 任务单、`AF-062` 归档回执、`phase3-judge-layer-ai-review-design-2026-11-15.md`），**一律未清理、未还原、未计入本单交付集**（回执 `changedFiles` 只列本单文件，`parallelArtifactsExcluded=true`）。
- 未跑 LLM 批次、未动数据库 / Redis / `.env`。

## 7. 偏差（7 条，均已在交付记录 §7 与回执 `deviationTable` 如实登记）

1. **类型闸门不覆盖 spec**：保留 `pnpm typecheck` 并补跑根 tsc，避免用不含该文件的闸门冒充验证。
2. **额外闸门（超出任务单 3 条）**：补跑目录回归 / 根 tsc / 内核 boundary，用于兑现 successCriteria 里「不修改 runner/turn-engine/审议边界」的断言；均只读、无副作用。
3. **任务单归档与状态迁移留给主控**：`conventions.md` §六要求任务单随交付记录一同移入 `completed/phase2.5/` 并改状态行，但本单状态由主控持有（submitted）且 executor 被禁跑归档类命令，故任务单原文保持不动（沿用 AF-063 / AF-067 先例）。
4. **机读回执落 transport 收件箱**：`transport/` 在 `.gitignore` 内，durable 副本由编排摄取流程复制到 `docs/worklog/pending/archive/`，executor 不越权写 archive（避免双份与指纹不一致）。
5. **取回用按路径限定的 `git checkout --`**：不弹 stash、不取 docs/state/scripts；代价是三个文件进入暂存区，提交由主控执行。
6. **未重跑 `pnpm orchestration:preflight`**：该命令属编排门禁脚本，简报明确禁止运行任何 `cli.mjs` 子命令；改以「内核 diff 空 + 改动仅三条路径 + 并行产物未纳入」三项自证记录。
7. **未跑真实批次实测**：任务单 §边界禁止；`exam` 入口在 HTTP 层实测，引擎侧行为由既有 `practice-runner.spec.ts` 覆盖，不夸大成端到端验证。

## 8. 遗留（1 条）

- **BL-AF068-01（low，既有债，非本单引入）**：类型闸门对 `test/**/*.spec.ts` 长期无覆盖。本单已补跑根 tsc 兜住，工程缺口需另立任务单改 `tsconfig.check.json` 的 include/exclude。

## 9. 请主控接手

1. 提交本单文件（建议 commit message：`feat(AF-068): 落地 AF-065 已验收的 scenarioType 透传改动`）。注意暂存区已有本单三个代码路径，回执与交付记录若纳入提交需一并 `git add`（`transport/` 被 gitignore，durable 副本走摄取流程）。
2. `run-once` 摄入回执（transport 收件箱 → `docs/worklog/pending/archive/` durable 副本）。
3. 把任务单移入 `docs/worklog/completed/phase2.5/`，并更新状态索引 / 事件链（`finalStatus=completed`、`reviewVerdict=passed`）。
