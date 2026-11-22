# TD-5 · 根 tsconfig 类型债分批清零 — 交付记录

> 状态：✅ 已交付（2026-11-13）
> 执行方：MiniMax Code
> 仓库：`E:\Work\Project\backend\mofang-nestjs`，分支 `integrate`，起点 HEAD `2e27bf1`
> 任务单：[td5-type-debt-clearing-task-2026-11-13.md](td5-type-debt-clearing-task-2026-11-13.md)（同目录，已归档）
> 一句话结论：**根 `tsconfig.json` 全量类型检查从 401 条 / 87 文件清到 0 条 / 0 文件（exit 0），零运行时变化、零生产契约改动、零新增/删除用例。**

---

## 一、结论

| 维度                                            | 起点（HEAD `2e27bf1`）                        | 终态（本单实测）                                              |
| ----------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------- |
| 根 `tsc -p tsconfig.json`                       | **exit 2 · 401 条 / 87 文件**                 | **exit 0 · 0 条 / 0 文件**                                    |
| build 口径 `tsc -p tsconfig.build.json`         | exit 0 · 0 错                                 | exit 0 · **0 错**（不退化）                                   |
| `pnpm lint`                                     | 0 error / 0 warning                           | **0 error / 0 warning**                                       |
| 全量 `pnpm test`                                | 3248 passed + 4 skipped（3252 例 / 194 文件） | **3248 passed + 4 skipped（3252 例 / 194 文件）**（逐字一致） |
| boundary（`test/engine-core/boundary.spec.ts`） | 12 绿                                         | **12 绿**                                                     |
| `git diff --stat HEAD -- src/engine-core`       | 空                                            | **空**                                                        |
| 生产 `src/` 非 spec 文件                        | —                                             | **零改动**                                                    |
| 保留条目（测试层无法收敛）                      | —                                             | **0 条**（详见 §五）                                          |

改动面：**89 个文件、+508 / −452 行**，全部落在 `test/**/*.spec.ts`（80）、`src/**/*.spec.ts`（2）、`bin/*.ts`（5）、`docs/`（2）四个允许面内，**无新增仓库文件、无删除文件、无并行产物混入**。

---

## 二、A / B / C 三批清理条数对照

复算命令（每批结束各跑一次）：

```
pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"
```

| 节点                                                                    | 剩余条数 | 剩余文件数 | 说明                                                                                                                                                                                                       |
| ----------------------------------------------------------------------- | -------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 起点（基线）                                                            | **401**  | **87**     | 错误码分布与任务单 §1.3 逐字一致（TS4111=155 / TS2554=44 / TS2345=41 / TS6133=23 / TS2349=20 / TS2339=17 / TS2322=17 / TS2503=13 / TS2352=12 / TS18048=10 / TS2307=10 / TS7006=5 / TS2688=4 / TS2493=4 …） |
| 批次 A · 第 1 轮（bin + vi 命名空间）                                   | 388      | 81         | A1 bin 6 条 + A2 TS2503 13 条                                                                                                                                                                              |
| 批次 A · 第 2 轮（TS2307 模块解析）                                     | **369**  | **78**     | 任务单 §3.4 期望 ≈372，**实测 369**（以实跑为准）                                                                                                                                                          |
| 批次 B · TS4111 批量方括号化（首轮含脚本语法瑕疵）                      | 2        | 1          | 一次性脚本误把可选链 `x?.prop` 写成 `x?['prop']`（TS1005 语法错），已修回                                                                                                                                  |
| 批次 B · 修语法后复算                                                   | **214**  | **75**     | 任务单 §3.4 期望 ≈217，**实测 214**                                                                                                                                                                        |
| 批次 C-1（类型导入对齐 + TS6133/TS6196）                                | 186      | 66         | —                                                                                                                                                                                                          |
| 批次 C-2（TS2554 调用参数对齐）                                         | 145      | 48         | —                                                                                                                                                                                                          |
| 批次 C-3（TS2352 / TS18048 / TS2493）                                   | 125      | 48         | —                                                                                                                                                                                                          |
| 批次 C-4（TS2339 / TS2741 / TS2739 / TS2344 …）                         | 93       | 47         | —                                                                                                                                                                                                          |
| 批次 C-5（TS2322 / TS2345 / TS2540 / TS2353 …）                         | 70       | 41         | —                                                                                                                                                                                                          |
| 批次 C-6（本轮续做：方括号访问收口 + 夹具断言）                         | 7        | 4          | —                                                                                                                                                                                                          |
| 批次 C-7（末 7 条：supertest 断言冗余 / wp63 断言重叠 / wp12 构造参数） | **0**    | **0**      | **exit 0**                                                                                                                                                                                                 |

### 2.1 批次 A · 基础设施根因（32 条）

- **A1 · `bin/` 6 条 / 5 文件**
  - TS2688 ×4（`batch-report.ts` / `entity.ts` / `ormconfig.ts` / `synchronize.ts`）：**删除** `/// <reference types="../typings/global" />` 引用行（偏差说明见 §三·1）。
  - TS7027 ×1（`bin/batch-report.ts:98`）：`--help` 分支里 `process.exit(0);` 之后的不可达 `break;` → 改为 `return process.exit(0);`（偏差说明见 §三·2）。
  - TS2352 ×1（`bin/seed-visitors-jsonl.ts:123`）：`script as unknown as VisitorPoolTemplate['script']`。
- **A2 · TS2503 `vi` 命名空间 13 条 / 4 文件**：`src/good_state_diary/providers/good-state-diary.service.spec.ts`（8）、`src/practice/providers/growth-tool-complete.service.spec.ts`（1）、`test/e2e/privacy-guard.e2e-spec.ts`（2）、`test/engine-adapters/wp8-wiring.spec.ts`（3）—— 全部改成 vitest 5 的**具名类型导入**（`import { vi, type Mock } from 'vitest'`），并按 vitest 5 的 `Mock<T extends Procedure>` 形态把 `vi.Mock<...>` 改写为函数签名形态。
- **A3 · TS2307 模块解析 10 条 / 1 文件**：`test/e2e/knowledge-search.e2e-spec.ts` 10 个 import 由 `../src/...` 改为 `../../src/...`（e2e 在 `test/` 下，原路径少一层），其中 `SentryService` 指向真实聚合导出 `../../src/shared/infra/observability/index.js`。

### 2.2 批次 B · TS4111 索引签名点访问（155 条）

规则：只改报错行的**访问写法**（`obj.identifier` → `obj['identifier']`），不动值、不动对象形状、不动具名属性。

- 用一次性脚本按 tsc 输出的 `(file, line, col, prop)` 精确定位并校验替换，**155 处全部命中、0 跳过**，覆盖 12 个文件（deliberation-stats 63、shared/sentry-redaction 55、e2e/sentry-redaction 14、deliberation-stats-redis 6、good-state-diary.e2e 4、wp65-queue 4、wp-k-config 3、gate-decisions 2，其余 4 文件各 1）。
- 脚本曾把可选链 `x?.prop` 误写成 `x?['prop']`（丢了点 → 变三元运算符，TS1005），**已按原样修回** `opts.order?.['createdAt']` / `opts.order?.['id']`。

### 2.3 批次 C · 业务类型对齐（214 条）

按错误簇处理，全部在测试层收敛：

| 簇                                                                                          | 条数 | 修法要点                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 类型导入对齐真实导出                                                                        | 7    | `CounselorHistoryTurn` → `counselor-agent.service.js`；`DeliberationDeltaEntry` / `DeliberationDim` → `deliberation/deliberation-types.js`；`VisitorPersonaSnapshot` → `agent/visitor/visitor.types.js`；`VoiceCatchUpTurn` → `voice/voice.types.js` |
| TS6133 / TS6196 未使用标识符                                                                | 23   | 删未用 import / 死常量 `ALLOWED_CLAMP01_DECLARATION` / 死函数 `fakeRequest`；未用形参加 `_` 前缀                                                                                                                                                     |
| TS2554 调用参数个数                                                                         | 44   | 生产首参**变必填**（`raw: string                                                                                                                                                                                                                     | undefined` 形态）→ spec 补实参；构造器补参（`AutoPracticeController` 6 参、`PracticeBatchHealthService` 4 参、`VptSessionBridgeService` 6 参等） |
| TS2345 / TS2322 夹具形状                                                                    | 58   | 夹具 / 断言对象对齐生产当前类型（补必填字段、收窄字面量、`as unknown as T` 中转）                                                                                                                                                                    |
| TS2339 字段不存在                                                                           | 17   | spec 对齐生产**现字段名**（`intentionShift` / `forbiddenBehaviors` / `sensitiveTopics` / `verbalVoice` / `versionMajor·Minor·Patch` 等），**不新增生产字段**                                                                                         |
| TS18048 / TS2352 / TS2493 / TS2540 / TS2353 / TS2420 / TS2769 / TS2307 / TS2488 / TS2493 等 | 25   | 逐处最小修复（可选链收窄、元组 `!`、`Object.assign` 写 readonly 字段、`ConstructorParameters` 取构造参数、`Extract<>` 取 Sentry integrations 数组形态等）                                                                                            |
| prompt content 收窄                                                                         | 34   | 生产 `ChatMessage.content` 放宽为 `string                                                                                                                                                                                                            | ChatMessageContentPart[]`后，spec 取值统一写成`(expr ?? '') as string` —— **纯类型断言，运行时零变化**                                           |

---

## 三、与任务单的偏差（逐条说明）

| #   | 任务单原写法                                                                                             | 实际做法                                                                                                                                                                            | 原因                                                                                                                                                                                                                                                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | §3.1 A1：TS2688 修法 `/// <reference types="..." />` → `/// <reference path="../typings/global.d.ts" />` | **删除该引用行**（4 个 bin 脚本）                                                                                                                                                   | `path=` 形式的 triple-slash 引用会被 `@typescript-eslint/triple-slash-reference`（默认 `path: 'never'`）判为 **error**；而根 `tsconfig.json` 的 `include` **本来就含 `"typings/global.d.ts"`**，这 4 行引用**完全冗余**（其余 bin 脚本如 `seed-*.ts` 从来没有这行也能过类型检查）。删除后：类型同源（全局声明仍由 tsconfig include 提供）、lint 0 error、TS2688 消失。 |
| 2   | §3.1 A1：TS7027 `删死代码或修控制流`                                                                     | `--help` 分支改为 `return process.exit(0);`                                                                                                                                         | 直接删 `break;` 会让 switch 落到 `default:` → 触发 `no-fallthrough`（error）。`process.exit` 返回类型是 `never`，`return process.exit(0)` 同时满足「不落 default」与「无不可达代码」，运行时逐字等价（进程照样退出）。                                                                                                                                                 |
| 3   | §3.3 TS2554：`spec 调用对齐生产签名`                                                                     | 生产首参是**必填**的 `T                                                                                                                                                             | undefined`→ 显式补实参，并写成`void 0`                                                                                                                                                                                                                                                                                                                                 | TS 要求显式传 1 个实参；但 `unicorn/no-useless-undefined` 只看「最后一个实参是不是 `undefined` 标识符」就判"没用" —— 两个工具对同一行给出相反结论。`void 0` 编译期类型仍是 `undefined`、运行时与 `undefined` **同一个值**，两边同时过。共 36 处（22 文件）。 |
| 4   | §3.3 TS2345/TS2322：`补全缺失字段、收窄字面量类型`                                                       | 对**后加的实体列**（`personalityTraits` / `verbalVoice` / `versionMajor·Minor·Patch` / WP-N 9 列 / `forbiddenBehaviors` / `sensitiveTopics`）用**类型断言**保住夹具形状，**不补值** | 补值会改变夹具运行时形状（例如 `versionMajor: 1` 会让版本判定从 `undefined` 变 `1`），违反「零运行时变化」红线；断言是纯编译期行为。                                                                                                                                                                                                                                   |
| 5   | §5 闸门 3：`pnpm lint` 0 error；warning 基线如实记录，不新增                                             | **0 error / 0 warning**（warning 也清零）                                                                                                                                           | 顺带清掉了 2 条失效的 `eslint-disable` 指令（`src/practice/providers/growth-tool-complete.service.spec.ts`、`test/e2e/knowledge-search.e2e-spec.ts`）与 1 条 import 顺序 warning。                                                                                                                                                                                     |
| 6   | 任务单未预期                                                                                             | `test/good-state-diary.e2e-spec.ts` **删除 18 处 `(await ...) as HttpResponse` 断言** + 连带删除 `HttpResponse` 类型别名与 `SupertestResponse` 导入                                 | supertest 改成 default import 后链式调用本身就有类型（superagent `Response`），那层 cast 变成**同类型断言**，被 `@typescript-eslint/no-unnecessary-type-assertion` 判为冗余（实测三种改法：`as HttpResponse` / `as unknown as HttpResponse` 都报，只有"不写 cast"能过）。删除是纯编译期行为，`.body` 仍是 `any`（与之前一致）。                                        |
| 7   | §3.4 复核节点 A ≈372 / B ≈217                                                                            | 实测 A 后 **369/78**、B 后 **214/75**                                                                                                                                               | 任务单已声明「数字以实跑为准」，偏差在噪声范围内。                                                                                                                                                                                                                                                                                                                     |

---

## 四、改动文件清单（89 文件 / +508 −452；无新增、无删除）

### 4.1 `bin/`（5 文件 · 修改）

`bin/batch-report.ts` · `bin/entity.ts` · `bin/ormconfig.ts` · `bin/seed-visitors-jsonl.ts` · `bin/synchronize.ts`

### 4.2 `src/`（2 文件 · **均为 spec**，生产文件零改动）

`src/good_state_diary/providers/good-state-diary.service.spec.ts` · `src/practice/providers/growth-tool-complete.service.spec.ts`

### 4.3 `test/`（80 文件 · 修改）

`test/admin-debug/`：deliberation-stats-redis.integration · deliberation-stats · gate-decisions · wp26-admin-role-guard · wp30-admin-real-api · wp31-cost-board · wp38-debug-event-tags · wp58-debug-session（8）

`test/auto-practice/`：counselor-agent · crisis-metrics-persist · intake-v2-mode-stratified-acceptance · practice-runner-cost · practice-runner · wp-h-wave2-3-batch-observability · wp-k-config-fingerprint（7）

`test/base/`：auth-reset-password · wp25-security-hardening（2）

`test/counselor/`：practice-engine · session-degraded · session-material · supervision-alternatives · supervision-failure · voice-catalog · vpt-config · wp44-growth-archive（8）

`test/e2e/`：knowledge-search.e2e-spec · privacy-guard.e2e-spec · sentry-redaction.spec（3）

`test/engine-adapters/`（38）：character-baseline-calibration · character-baseline-seed-calibration · deliberation-gate/evaluator · eval/eval.runner · g123-deliberation-scenario-fingerprint · i12-session-threshold-plumbing · model-event-classifier · phase25-wp-a-deliberation-input-minimization · r9-deliberation-hook · r9-deliberation-mode-config · wp-deliberation-cap-config · wp-deliberation-clinical-sanity · wp-deliberation-delta-cap · wp-g-render-prompt · wp-h-render-availability · wp-h-wave2-3-prompt-tokens · wp-j-p1d-attachment-style-wiring · wp-j-p1d-info-increment-depth · wp-j-p2-verbal-voice-wiring · wp10-ethical-scripts · wp11-psyguard-probe · wp12-memory-closeout · wp14-block-no-llm-start · wp14-student-risk-disposal · wp37-rolling-session-summary · wp38-character-version-semver · wp41-expression-style-rendering · wp43-evaluation-wiring · wp45-qdrant-sdk-contract · wp49-character-five-factor-personality · wp51-character-seed-alliance-baseline · wp63-deliberation-schema · wp64-deliberation-shadow · wp65-deliberation-mutex-revision · wp65-deliberation-queue · wp66-deliberation-retry · wp67-deliberation-circuit-breaker · wp68-deliberation-intention-lock · wp7-turn-render · wp8-wiring · wp9b-character-admin · wp9b-db-character-resolver

`test/engine-core/`（3 · **spec 文件，非 core 源码**）：kernel-internal-clamp-unify · wp3-trajectory · wp5-rendering（`boundary.spec.ts` **一行未动**）

`test/good-state-diary.e2e-spec.ts`（1）

`test/quality/`：quality-annotation-contract（1）

`test/shared/`：sentry-redaction（1）

`test/user/`：set-password-first-set（1）

`test/voice/`：wp16-turn-incomplete · wp22-voice-concurrency-budget · wp23-ws-disconnect-grace（3）

### 4.4 `docs/`（2 文件 · 修改）+ 本单新增文档（2）

- 修改：`docs/worklog/pending/phase2.5-README.md`、`docs/worklog/pending/phase2.5-wp-list-2026-11-08.md`（§2 索引回写）
- 新增：本交付记录 + 归档后的任务单（同目录）

---

## 五、保留条目清单（测试层无法收敛 → 登记 backlog）

**本单保留条目：0 条。** 401 条全部在测试层收敛，**没有任何一条需要改动生产契约**（`src/` 非 spec 生产文件零改动）。

下列 **生产契约演进点** 是本单撞到、但**已由测试层收敛**的条目 —— 它们不构成 backlog（测试层可最小修复），但**值得生产侧后续核对**（夹具与生产契约长期漂移的信号）：

| 生产契约演进点                                                                                      | 位置                                                                   | 本单处理                                                                                         | 建议后续处置                                                                                                  |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `DeliberationOutput` 新增必填 `intentionShift`（WP68）                                              | `src/engine-adapters/deliberation/deliberation-types.ts:290`           | `wp63` / `wp67` 的三件套夹具用 `as unknown as DeliberationOutput` 保住运行时三键形状             | 该 spec 的断言视角（"输出契约 = 三件套"）已落后于生产四件套，**建议后续单独对齐断言口径**（本单不改断言期望） |
| `CharacterProfile` 的 `forbiddenBehaviors` / `sensitiveTopics` 变必填                               | `src/engine-core/domain/character-profile.ts:106`                      | `wp38-debug-event-tags` / `wp58-debug-session` 的角色夹具用断言保住形状                          | 生产侧这两列对调试服务其实不读，可考虑后续标注为可选                                                          |
| `CharacterProfileEntity` 后加列（`personalityTraits` / `verbalVoice` / `versionMajor·Minor·Patch`） | `src/engine-adapters/wiring/character/character-profile.entity.ts:173` | 5 个实体夹具用断言                                                                               | 夹具长期少列 → 建议后续给实体夹具加一个统一的 `buildEntityRow()` helper                                       |
| `VoiceTurnBackendTurnOptions.userId` 变必填                                                         | `src/voice/voice-turn-backend.port.ts:325`                             | `wp43` 的"故意不带 userId"用例用 `as VoiceTurnBackendTurnOptions`                                | 该用例靠"缺 userId"验归属判定，**建议生产侧把 userId 标注为可选**（语义上就是可选）                           |
| `RiskProbeResult.categories` 类型只收 `VisitorRiskCategory`                                         | `src/engine-core/domain/ports/risk-probe.ts:33`                        | `wp14-block-no-llm-start` 喂咨询师侧类别 `promise_cure` 的用例用 `as unknown as RiskProbeResult` | 生产侧类别口径是"来访侧 11 类"，用例却要喂咨询师侧类别 → **建议后续核对探测端口的类别口径**                   |
| `DeliberationInput` 形状被 WP-A 重写                                                                | `src/engine-adapters/deliberation/deliberation-types.ts:427`           | `g123` 的旧形状夹具用 `as unknown as DeliberationInput`                                          | 该用例不消费 structured（exam 场次一次 LLM 都不发），但夹具形状已过时                                         |
| `QualityAnnotationEntity` WP-N 新增 9 列                                                            | `src/quality/quality-annotation.entity.ts:36`                          | 夹具用断言                                                                                       | 同上                                                                                                          |

> 以上 7 项均为**观察项**，不阻塞本单交付；按仓库纪律归"后续可另派小单"，本单未改生产代码、未改断言期望。

---

## 六、闸门表（真实命令 / exit code / 数字）

机器状态：Windows 11 Home China 10.0.26300 (build 26300) · Node **v26.13.0** · pnpm **9.15.0** · PowerShell **5.1.26100.9818** · 8 逻辑核 · 无 `nest start --watch` / `vite dev` 长驻进程 · git 走 `D:\Apps\Git\cmd`（仅影响依赖 git 的 spec）

| #   | 命令                                                                    | exit  | 结果                                                                                                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` | **0** | **0 error / 0 文件**（起点 401 / 87）                                                                                                                                                                                                                                                 |
| 2   | `pnpm exec tsc -p tsconfig.build.json --noEmit`                         | **0** | **0 error**                                                                                                                                                                                                                                                                           |
| 3   | `pnpm lint`                                                             | **0** | **0 error / 0 warning**（基线同为 0/0）                                                                                                                                                                                                                                               |
| 4   | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                | **0** | **12 passed / 12**（Test Files 1 passed；Duration 2.52s）                                                                                                                                                                                                                             |
| 5   | `pnpm test`                                                             | **0** | **Test Files 193 passed \| 1 skipped (194)**；**Tests 3248 passed \| 4 skipped (3252)**；vitest Duration **119.17s**；墙钟 **121.1s**                                                                                                                                                 |
| 6   | e2e（本单改了 `test/e2e/` 3 文件 + `good-state-diary.e2e-spec.ts`）     | —     | 本单**未跑 `pnpm test:e2e`**：该配置需要 DB / 服务环境，本机不可达（e2e 文件不在 `pnpm test` 执行集内）。e2e 相关改动全部是**类型层**（import 路径 / 断言 / 夹具），**零运行时变化**；`test/e2e/sentry-redaction.spec.ts` 与 `test/good-state-diary.e2e-spec.ts` 的运行时逻辑未动一行 |
| 7   | `git diff --stat HEAD -- src/engine-core`                               | 0     | **空输出**（core 源码零 diff）                                                                                                                                                                                                                                                        |
| 8   | `git diff --name-only HEAD`                                             | 0     | 89 文件：`test/` 80 · `bin/` 5 · `src/` 2（**均 spec**）· `docs/` 2 —— **无生产 src 非 spec 文件、无并行产物**                                                                                                                                                                        |

未跟踪文件仅 2 个：任务单（本单归档后移入 `completed/phase2.5/`）与本交付记录。

---

## 七、回归说明（零运行时变化核对）

1. **用例数量未变**：全量 **3252 例 / 194 文件**，与起点基线**逐字一致**（3248 passed + 4 skipped）；本单**未新增、未删除**任何用例。
2. **断言期望未变**：未改任何 `expect(...)` 的期望值、匹配器或条件；未改任何 mock 的**返回值内容**。
3. **mock 语义未变**：本单只改 mock 的**类型标注 / 调用参数形态**（如 `vi.fn()` 的类型实参、`mock.calls` 的读取写法、构造器补参），返回值与调用顺序未变。
4. **改动性质逐类核对**：
   - 类型标注 / 泛型实参 / `import type` —— 编译期，运行时零痕迹；
   - `as` / `as unknown as` 断言 —— 编译期，运行时零痕迹；
   - 索引签名访问 `obj.x` → `obj['x']` —— 同一属性同一取值，运行时逐字等价；
   - `undefined` → `void 0`（36 处）—— **同一个值**（`void 0` 求值即 `undefined`）；
   - `Object.assign(turn, {...})` 写 readonly 字段（`eval.runner`）—— 与直接赋值逐字等价（同一对象、同一字段）；
   - `param?.[k]`（`good-state-diary.e2e`）—— 原代码在 `params` 为 undefined 时会抛 TypeError，调用点均在 `Object.keys(params ?? {})` 循环内，`params` 必非空，行为不变；
   - `bin/` 三处结构性改动 —— **删除冗余 triple-slash 引用**（全局声明仍由 tsconfig include 提供）、`--help` 分支改 `return process.exit(0)`（进程照样退出）、`seed-visitors-jsonl` 的类型中转断言（编译期）。
5. **e2e 未跑的原因已如实登记**（闸门 6），不 silently skip：环境不可达 + 改动纯属类型层。
6. **生产面零 diff**：`src/` 非 spec 文件一个都没动；`src/engine-core/**` diff 为空；未改生产签名 / 类型 / 模块导出 / 配置 / 阈值 / prompt / 判据 / 表结构 / migration。

---

## 八、关键决策与取舍

1. **TS4111 用一次性脚本批量改方括号访问**，不手抄长行：脚本按 tsc 的 `(file, line, col, prop)` 精确定位并校验，155 处 0 跳过；改完逐条抽查 diff + 复算 tsc。
2. **生产函数首参变必填（`raw: string | undefined` 形态）→ spec 补实参**，因为函数体对 undefined 的分支与"不传"运行时等价，不改断言。
3. **可选链必须写 `x?.['k']`**（不能 `x?['k']`）；非空断言 `!` 用于 `calls.at(-1)` 这类"可能为空但用例保证非空"的位置（运行时零变化，不用可选链以免改变抛错语义）。
4. **`as` 重叠不足一律 `as unknown as T` 中转**；`mock.calls` 元组长度 0 时给 `mock.calls` 加类型标注。
5. **prompt content 收窄用纯类型断言** `(expr ?? '') as string`，不引入运行时 helper。
6. **supertest 用 default import + 内联 `type` 具名导入**（`@types/supertest` 是 `export =` 形态，命名空间导入的值不可调用）。
7. **e2e mock 补 `setUser`**：属测试 mock 缺方法的真实运行时缺陷（e2e 不在 `pnpm test` 执行集内故一直没暴露），在测试层补齐、**不改断言**。
8. **生产契约演进点一律断言化、不补值**（见 §五），确保"补值改变夹具运行时形状"的风险不发生。

---

## 九、后续建议（非阻塞）

1. **§五 的 7 个生产契约演进点**建议另派小单核对（尤其 `VoiceTurnBackendTurnOptions.userId` 可选化、`RiskProbeResult.categories` 类别口径）。
2. **类型债复算口径固化**：建议把 `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` 加进 CI 闸门（当前 0 error，容易回潮）。
3. **夹具统一 helper**：角色实体行 / 标注实体行的统一 builder 可消除"后加列就得改一堆夹具"的长期漂移。

---

_交付：MiniMax Code · 2026-11-13 · 仓库 mofang-nestjs 分支 integrate · 起点 HEAD `2e27bf1`_
