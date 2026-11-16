# TD-10 测试结构减重专项（P-DEBT-6 / L5）交付记录

| 项               | 值                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 任务单           | `docs/worklog/pending/td10-test-structure-debt-reduction-2026-11-13.md`（交付后归档至 `docs/worklog/completed/phase2.5/td10-test-structure-debt-reduction-task-2026-11-13.md`） |
| 唯一事实源       | `docs/team/gate-performance-remediation-2026-11-11.md` §3.2 L5 / §9 P-DEBT-6                                                                                                    |
| 基线 HEAD        | `997c6f9`（分支 `integrate`）                                                                                                                                                   |
| 执行             | MiniMax Code，2026-11-13                                                                                                                                                        |
| 闸门             | 全绿；用例数与基线逐字一致（3248 passed + 4 skipped / 3252 例 / 194 文件）                                                                                                      |
| engine-core diff | **空**                                                                                                                                                                          |
| 生产 `src/` diff | **空**                                                                                                                                                                          |

---

## 一、本单做了什么

把 183 个非 e2e spec 的 **import 阶段加载图**整体收窄：82 个 spec 在 SDK 包边界加 `vi.mock`（真实 ioredis / bullmq / qdrant / langchain 不再进 import 阶段）、12 个 spec 的 engine-core barrel 整树导入改深路径、4 个非 e2e 集成 spec 逐一定性并抽出共享 User 替身工厂。断言期望、用例数、mock 语义、隔离语义逐字未变。

结构口径实测（183 个非 e2e spec，同一分析器两次运行）：

| 指标                     | 改前           | 改后           | 变化            |
| ------------------------ | -------------- | -------------- | --------------- |
| spec 数                  | 183（+ 6 e2e） | 183（+ 6 e2e） | 0               |
| 本地模块加载总量         | 8013           | 7986           | **−27**         |
| 其中生产 `src/` 模块     | 7787           | 7753           | **−34**         |
| 包引用数                 | 766            | 673            | **−93**         |
| **触达重型 SDK 的 spec** | **98**         | **58**         | **−40**         |
| 触达 Nest 框架的 spec    | 118            | 118            | 0（见 §七 L-6） |

收益口径按任务单 §3.1：**以结构定性为准**，墙钟只记录不作验收指标（实测 61.80 s，机器不干净，见 §五）。

---

## 二、方案设计：实际实现 vs 任务单方案（偏差登记，conventions §2.5）

| 编号 | 任务单原方案                                                         | 实际方案                                                                                                      | 理由                                                                                                                                                                                                          |
| ---- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1  | T-2：在**端口 / 适配层** mock                                        | 在 **SDK 包边界** mock（`vi.mock('ioredis')` 等），适配层保持真实现                                           | 适配层（`RedisService` / BullMQ provider / `QdrantService` / LLM client）本身是被测对象；改适配层等于改 mock 语义，触碰 §4「断言 / 用例 / mock 语义冻结」红线。包边界拦截后适配层仍跑真代码，断言口径逐字不变 |
| D-2  | T-2：审计单元 spec 中重型 SDK 的引用方式并 mock 掉                   | 只对 **import 阶段真实加载、且该 spec 不使用真实 SDK 实现** 的 82 个 spec 加 mock；3 个真需真包的 spec 已回退 | 这 3 个 spec 断言的就是真 SDK 行为（见 §四 4.3 例外表），mock 掉会把断言对象替换掉，属降级交付                                                                                                                |
| D-3  | 任务单未规定替身失败语义                                             | 替身**数据面方法一律 throw**，生命周期方法惰性 no-op                                                          | 防「假绿」：若某 spec 在 mock 后仍触碰真实 SDK 数据面，用例当场炸而不是静默通过                                                                                                                               |
| D-4  | T-3：spec 中从 barrel 整树导入的，按实际用到的模块改深路径拆分       | 只拆 **运行时值导入**；type-only barrel 导入（69 个 spec）保持不动                                            | type-only 导入编译期即擦除、运行时成本为 0；且 `src/engine-core/index.ts` 是内核唯一公开 barrel（boundary 断言⑥双向白名单守它），拆 type-only 导入会割裂公开类型面且零收益                                    |
| D-5  | T-1：哪些断言真的需要全量装配，哪些可以收窄为端口级替身 / 单服务实例 | 4 个集成 spec **审计后判定：本来就不是全量装配，无需收窄**                                                    | 实测 4 个 spec 均为「单控制器最小 TestingModule + 端口级替身」，不拉 `app.module`、不连 DB / Redis；硬收窄会改变断言对象。可做的只有替身去重（→ `test/helpers/user-stub.ts`）与 SDK 包边界 mock               |
| D-6  | 复用替身抽进 `test/helpers/`，集中经 `test/helpers/index.ts` 出口    | `sdk-stubs.ts` 进 `index.ts` 出口；**`user-stub.ts` 走深路径导入，不进 barrel**                               | `user-stub.ts` 引用 `User` entity / `UserService`，进 barrel 后会把 typeorm 拖进所有引 `test/helpers/index.js` 的 spec（实测模块数 **+200**），与本单减重目标相反                                             |
| D-7  | 不改任何 `expect` 期望值                                             | 8 处 `toBe(x.length)` → `toHaveLength(x)`，**期望值逐字未变**                                                 | 新增 vitest 导入后 ESLint `sonarjs/prefer-specific-assertions` 才在这些文件生效（该规则要求文件出现 vitest 导入）；改的是断言写法而非期望值，语义等价                                                         |
| D-8  | 改动面严格在授权范围                                                 | `test/e2e/v2-user-flow.spec.ts:1` 的既有 unused eslint-disable warning **未修**                               | 该文件在 e2e 范围外于本单授权范围；`pnpm lint:fix` 的越界改动已 `git checkout` 回退                                                                                                                           |
| D-9  | §3.1：不强制墙钟指标                                                 | 墙钟只记录实测值与机器状态，不作验收硬指标                                                                    | 与任务单一致，登记实测：61.80 s；机器不干净（§五 机器状态），不可与 132 s 基线直接比较                                                                                                                        |

---

## 三、改动文件清单

### 3.1 新建（2 个）

- `test/helpers/sdk-stubs.ts`（8,257 B）—— 重型 SDK 纯替身工厂：`createIoredisStub` / `createBullmqStub` / `createQdrantStub` / `createLangchainOpenAiStub` / `createLangchainMessagesStub`；数据面方法 throw、生命周期 no-op、无模块级可变状态、不 import Nest 容器。
- `test/helpers/user-stub.ts`（5,484 B）—— 账号域共享替身工厂：`buildUserEntityStub` / `buildUserServiceStub` / `STUB_USER_UID` / `STUB_USER_EMAIL`；消除 `auth-reset-password` 与 `set-password-first-set` 两份同构替身，差异用入参（`mustChangePassword` / `recordPasswordHistory`）表达。

### 3.2 修改（91 个文件，+800 / −233 行）

- `test/helpers/index.ts`（+1 行）—— 出口补 `export * from './sdk-stubs.js'`（**不含** `user-stub`，理由见 D-6）。
- 90 个 spec —— 逐个用途见 §四 附录 A 的「处置」列：T-1 收敛审计 4 个、T-2 SDK 包级 mock 82 个、T-3 barrel 深路径拆分 12 个（同一文件命中多项时合并计）；3 个真需真包的 spec 已 `git checkout` 回退，最终不在改动面内。

### 3.3 删除（0 个）

---

## 四、逐 spec 结构审计表

### 4.1 度量口径与取证方法

- **分析器**：自写静态 import 图分析器（TypeScript 编译器 API），区分 **运行时值导入** / **type-only 擦除** / **动态 import**，输出每个 spec 的闭包模块数、包引用、重型 SDK 命中、Nest 框架命中与 hub 排名。
- **产物**：`data/quality/td10-import-graph-before.txt`（88,750 B，基线 HEAD `997c6f9`）/ `data/quality/td10-import-graph-after.txt`（85,120 B，改后）。均在 `.gitignore` 覆盖范围，**不入库**（取证材料随工作区留存）。
- **重型 SDK 集合**：`@langchain/core`、`@langchain/core/messages`、`@langchain/openai`、`@qdrant/js-client-rest`、`bullmq`、`ioredis`、`typeorm`、`@nestjs/typeorm`、`@node-rs/argon2`、`nodemailer`、`passport-jwt`、`ws` 等。
- **口径诚实登记（两处差异均非本单引入的回归）**：
  1. 基线那次运行**未记录** `mocked` 列，改后那次记录了。因此两个**基线就已存在** SDK mock 的文件，其 pkgCount 因「mock 被识别」而各减 1：`test/shared/sentry-redaction.spec.ts`（3→2）、`test/engine-core/i12-session-alliance-config.spec.ts`（其余字段不动，仅多出 mocked 列记录）。
  2. `test/engine-adapters/wp12-memory-closeout.spec.ts` 等 3 个引用 `test/helpers/index.js` barrel 的文件，因 `helpers/index.ts` 新增 `sdk-stubs` 导出而各多 1 个本地测试模块 —— 这是**真实副作用**（量级可忽略），不是分析器噪声。
- **hub 排名**（改前 top 6）：`src/app.module.ts` 872、`src/counselor/counselor.module.ts` 333、`src/engine-adapters/wiring/engine.module.ts` 284、`src/admin-debug/admin-debug-chat.module.ts` 291、`src/auto-practice/auto-practice.controller.ts` 107、`src/base/controllers/index.ts` 89 —— 本单**未删任何 src barrel 出口**（超范围），但已让 40 个 spec 不再把这些 hub 拉进 import 阶段。

### 4.2 T-1 · 4 个非 e2e 集成 spec 逐个定性

| spec                                                                  | 原形态（实测）                                                                                                                                                      | 定性结论                                                                    | 处置                                                                                                                                 | 改前 → 改后                                                                     |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `test/base/auth-reset-password.spec.ts`                               | 单控制器 TestingModule + supertest；真路由 / 真 ValidationPipe / 真拦截器；Redis 验证码 / email / session / blacklist / 审计 / 密码历史 / RSA 全 stub；不起真实容器 | **已是端口级替身**，不拉 `app.module`、不连 DB / Redis → 无可收窄空间       | 抽出共享 User 替身（去掉 `User` entity 值导入，改引 `test/helpers/user-stub.js`）；加 `bullmq` + `ioredis` 包级 mock                 | total 88→89，pkg 24→23，heavy 6→4（`bullmq` / `ioredis` 出 import 阶段）        |
| `test/user/set-password-first-set.spec.ts`                            | 只起一个只有 UserController 的微型 Nest 应用；真 UserService + stub 依赖                                                                                            | 同上                                                                        | 同上                                                                                                                                 | total 62→63，pkg 18→17，heavy 5→3（`bullmq` / `ioredis` 出图）                  |
| `test/counselor/wp21-report-sse-endpoint.spec.ts`                     | 单控制器 TestingModule + supertest；真 controller + 真 stream service，只把 SupervisionService 打桩                                                                 | 同上                                                                        | 加 `ioredis` 包级 mock                                                                                                               | total 68→68，pkg 12→12，heavy 2→1（`typeorm` 仍留 → 根因在 src 侧，见 §七 L-1） |
| `test/voice/wp22-voice-concurrency-budget.spec.ts`                    | DI 冒烟：起 TestingModule 验 `ConfigService` / `RedisService` 是否被正确注册为 provider token                                                                       | 同上，且**不可收窄**：它断言的对象就是「DI token 注册」本身，收窄即失去断言 | 加 `bullmq` + `ioredis` 包级 mock                                                                                                    | total 124→124，pkg 12→10，heavy 3→1（`ws` 是协议包、非重型 SDK，留）            |
| 补充：`test/admin-debug/deliberation-stats-redis.integration.spec.ts` | 真 Redis 集成验证（Lua 脚本语法与语义只有真 Redis 能验）；未设 `TEST_REDIS_URL` 整份跳过                                                                            | 本就是**真 Redis** 场景（任务单列的 4 个之外），不能替身化                  | 真 ioredis 改 **动态导入**（`import type { Redis }` + `await import('ioredis')`），未设 `TEST_REDIS_URL` 时 ioredis 不进 import 阶段 | total 4→4，pkg 2→1，heavy `ioredis` → 无                                        |

**T-1 小结**：4 个集成 spec **没有一个需要收窄**（全部已是「单控制器最小 TestingModule + 端口级替身」）；本单在该子项上的实际收益是 ①替身去重（消除两份同构 User 替身）②SDK 包边界 mock ③真 Redis spec 改动态导入。任务单预设的「可收窄为端口级替身」在本仓不存在对应项 —— 这是**审计结论**而非未执行项（已按 D-5 登记偏差）。

### 4.3 T-2 · SDK 包级 mock 分组

统一写法（每个 spec 一处，注释标明来源与口径）：

```ts
// TD-10 · T-2: 真实 ioredis 不进 import 阶段 (适配层仍是真实现; 替身口径见 test/helpers/sdk-stubs.ts).
vi.mock('ioredis', async () => {
  const { createIoredisStub } = await import('../helpers/sdk-stubs.js');
  return createIoredisStub();
});
```

| mock 组合                                                                                                              | spec 数 | 说明                                                              |
| ---------------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------- |
| `ioredis`                                                                                                              | 54      | 只触达 ioredis（多数经 `RedisService` 传递引入）                  |
| `bullmq` + `ioredis`                                                                                                   | 23      |                                                                   |
| `@langchain/core` + `@langchain/core/messages` + `@langchain/openai` + `@qdrant/js-client-rest` + `bullmq` + `ioredis` | 3       | `admin-insights` / `wp58-debug-session` / `wp58-turn-delta-audit` |
| `@qdrant/js-client-rest` + `bullmq` + `ioredis`                                                                        | 1       | `wp26-admin-role-guard`                                           |
| `@langchain/core` + `@langchain/core/messages` + `@langchain/openai`                                                   | 1       |                                                                   |
| **小计**                                                                                                               | **82**  | 覆盖后「触达重型 SDK 的 spec」98 → 58                             |

**例外（3 个保留真实 SDK，已回退 mock 并复跑 32 例全绿）**：

| spec                                                    | 保留原因                                                                |
| ------------------------------------------------------- | ----------------------------------------------------------------------- |
| `test/llm/minimax-provider.spec.ts`                     | 断言真 `ChatOpenAI` 实例带 `apiKey` / `baseURL`，替身化即断言对象被替换 |
| `test/llm/wp9c-token-fields.spec.ts`                    | 断言真客户端的 `modelKwargs`                                            |
| `test/engine-adapters/wp45-qdrant-sdk-contract.spec.ts` | 真 `QdrantClient` + 拦 `fetch` 验请求体（SDK 契约测试本身）             |

### 4.4 T-3 · barrel 深路径拆分逐条（12 文件 / 14 处导入语句）

| spec                                                                        | 改前                                                                                            | 改后                                                                             |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `test/engine-adapters/deliberation-gate/evaluator.spec.ts`                  | `createEmptyBdiSnapshot` ← `src/engine-core/index.js`                                           | `src/engine-core/domain/bdi-snapshot.js`                                         |
| `test/engine-adapters/deliberation-gate/quotas.spec.ts`                     | 同上                                                                                            | 同上                                                                             |
| `test/engine-adapters/phase25-wp-a-deliberation-input-minimization.spec.ts` | 同上                                                                                            | 同上                                                                             |
| `test/engine-adapters/wp11-psyguard-probe.spec.ts`                          | `assessSafety` + `DEFAULT_PROBE_TIMEOUT_MS` + `PSYGUARD_LEVEL_MAP` ← `src/engine-core/index.js` | `cognition/safety/assess-safety.js` + `domain/safety/safety-types.js`（拆 2 处） |
| `test/engine-adapters/wp26-delta-cap-config.spec.ts`                        | `DEFAULT_DELTA_CAP_CONFIG` ← `src/engine-core/index.js`                                         | `cognition/state-transition.js`                                                  |
| `test/engine-adapters/wp32-bdi-state-persistence.spec.ts`                   | `EngineCoreError` + `EngineErrorCode` + `createEmptyBdiSnapshot` ← `src/engine-core/index.js`   | `domain/engine-errors.js` + `domain/bdi-snapshot.js`（拆 2 处）                  |
| `test/engine-adapters/wp34-personality-modulator-config.spec.ts`            | `DEFAULT_PERSONALITY_MODULATOR_CONFIG` ← `src/engine-core/index.js`                             | `cognition/personality-modulator.js`                                             |
| `test/engine-adapters/wp36-session-decay-config.spec.ts`                    | `DEFAULT_SESSION_DECAY_CONFIG` ← `src/engine-core/index.js`                                     | `cognition/session-decay.js`                                                     |
| `test/engine-adapters/wp42-alliance-config.spec.ts`                         | `DEFAULT_ALLIANCE_CONFIG` ← `src/engine-core/index.js`                                          | `cognition/alliance-config.js`                                                   |
| `test/engine-adapters/wp9c-risk-probe.spec.ts`                              | `assessSafety` ← `src/engine-core/index.js`                                                     | `cognition/safety/assess-safety.js`                                              |
| `test/engine-core/wp42-alliance-three-dimensions.spec.ts`                   | `DEFAULT_ALLIANCE_CONFIG` ← `src/engine-core/index.js`                                          | `cognition/alliance-config.js`                                                   |
| `test/quality/d1-event-classifier-evidence.spec.ts`                         | `RuleBasedClassifier` ← `src/engine-core/index.js`                                              | `cognition/rule-based-classifier.js`                                             |

代表性加载图变化：`d1-event-classifier-evidence` **33 → 5 个模块**（src 31→3）；`wp42-alliance-three-dimensions` **35 → 29**（src 34→28）；`wp32-bdi-state-persistence` pkg 5→4。

### 4.5 明确不拆的 4 处 barrel（现场理由）

| barrel                                                       | 不拆理由                                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `test/engine-adapters/wp6-llm-render.spec.ts`                | 断言的就是 barrel 的**出口面本身**（namespace 断言），拆了就改了断言对象 |
| `test/admin-debug/wp58-debug-session.spec.ts` 的 user barrel | 传递可达（该 barrel 指向的文件必然被 user 模块引入），改深路径**零收益** |
| trajectory barrel                                            | 文件头写明「单测也从这里 import」，属该文件的显式设计口径                |
| string-utils                                                 | TD-9 共享纯函数出口（`test/helpers` 依赖它），拆开与 TD-9 产物割裂       |

### 4.6 附录 A · 全 183 个非 e2e spec 逐行加载图对比

（`total` = 闭包本地模块数；`pkg` = 包引用数；重型 SDK 列为改前 → 改后。本表由 §4.1 的两份 import 图机器生成，产物 `data/quality/td10-audit-table.txt` 与 gitignore 不入库）

| spec                                                                   | 形态 | total 改前→改后 | pkg 改前→改后 | 重型 SDK 改前→改后                                                                                                                              | 处置        |
| ---------------------------------------------------------------------- | ---- | --------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `admin-debug/admin-insights.spec.ts`                                   | 单元 | 164 → 164       | 19 → 15       | @langchain/core,@langchain/openai,@node-rs/argon2,@qdrant/js-client-rest,bullmq,ioredis,nodemailer,typeorm → @node-rs/argon2,nodemailer,typeorm | T-2+T-3     |
| `admin-debug/debug-session-persistence.spec.ts`                        | 单元 | 70 → 70         | 4 → 4         | ioredis → -                                                                                                                                     | T-2         |
| `admin-debug/deliberation-stats-redis.integration.spec.ts`             | 单元 | 4 → 4           | 2 → 1         | ioredis → -                                                                                                                                     | T-3         |
| `admin-debug/deliberation-stats.spec.ts`                               | 单元 | 76 → 76         | 6 → 5         | ioredis,typeorm → typeorm                                                                                                                       | T-2+T-3     |
| `admin-debug/gate-decisions.spec.ts`                                   | 单元 | 16 → 16         | 6 → 5         | ioredis,typeorm → typeorm                                                                                                                       | T-2+T-3     |
| `admin-debug/wp-f-cost-board-merge.spec.ts`                            | 单元 | 32 → 32         | 5 → 5         | ioredis,typeorm → typeorm                                                                                                                       | T-2         |
| `admin-debug/wp19r-trace-wiring.spec.ts`                               | 单元 | 93 → 93         | 8 → 8         | ioredis,typeorm → typeorm                                                                                                                       | T-2         |
| `admin-debug/wp26-admin-role-guard.spec.ts`                            | 单元 | 141 → 141       | 16 → 14       | @node-rs/argon2,@qdrant/js-client-rest,bullmq,ioredis,nodemailer,typeorm → @node-rs/argon2,nodemailer,typeorm                                   | T-2+T-3     |
| `admin-debug/wp30-admin-real-api.spec.ts`                              | 单元 | 32 → 32         | 5 → 5         | ioredis,typeorm → typeorm                                                                                                                       | T-2         |
| `admin-debug/wp31-cost-board.spec.ts`                                  | 单元 | 32 → 32         | 5 → 5         | ioredis,typeorm → typeorm                                                                                                                       | T-2         |
| `admin-debug/wp38-debug-event-tags.spec.ts`                            | 单元 | 74 → 74         | 5 → 4         | ioredis → -                                                                                                                                     | T-2+T-3     |
| `admin-debug/wp38-debug-session-resume.spec.ts`                        | 单元 | 83 → 83         | 7 → 6         | ioredis,typeorm → typeorm                                                                                                                       | T-2+T-3     |
| `admin-debug/wp58-debug-session.spec.ts`                               | 单元 | 292 → 292       | 25 → 20       | @langchain/core,@langchain/openai,@node-rs/argon2,@qdrant/js-client-rest,bullmq,ioredis,nodemailer,typeorm → @node-rs/argon2,nodemailer,typeorm | T-2+T-3     |
| `admin-debug/wp69-debug-panel-improvements.spec.ts`                    | 单元 | 77 → 77         | 10 → 9        | ioredis,typeorm → typeorm                                                                                                                       | T-2+T-3     |
| `agent/visitor-prompt-semantic-tags.spec.ts`                           | 单元 | 2 → 2           | 1 → 1         | -                                                                                                                                               | 未改动      |
| `agent/wp18-supervisor-llm-profile.spec.ts`                            | 单元 | 2 → 2           | 0 → 0         | -                                                                                                                                               | 未改动      |
| `agent/wp18-supervisor-report.spec.ts`                                 | 单元 | 8 → 8           | 2 → 2         | -                                                                                                                                               | 未改动      |
| `auto-practice/counselor-agent.spec.ts`                                | 单元 | 15 → 15         | 3 → 3         | -                                                                                                                                               | 未改动      |
| `auto-practice/crisis-metrics-persist.spec.ts`                         | 单元 | 108 → 108       | 9 → 7         | bullmq,ioredis,typeorm → typeorm                                                                                                                | T-2+T-3     |
| `auto-practice/dialogue-quality.spec.ts`                               | 单元 | 79 → 79         | 8 → 7         | ioredis,typeorm → typeorm                                                                                                                       | T-2+T-3     |
| `auto-practice/intake-v2-mode-stratified-acceptance.spec.ts`           | 单元 | 108 → 108       | 9 → 7         | bullmq,ioredis,typeorm → typeorm                                                                                                                | T-2+T-3     |
| `auto-practice/metrics/disfluency-analyzer.spec.ts`                    | 单元 | 4 → 4           | 1 → 1         | -                                                                                                                                               | 未改动      |
| `auto-practice/p1d-render-metrics-persist.spec.ts`                     | 单元 | 79 → 79         | 8 → 7         | ioredis,typeorm → typeorm                                                                                                                       | T-2+T-3     |
| `auto-practice/practice-runner-cost.spec.ts`                           | 单元 | 79 → 79         | 8 → 7         | ioredis,typeorm → typeorm                                                                                                                       | T-2+T-3     |
| `auto-practice/practice-runner.spec.ts`                                | 单元 | 79 → 79         | 8 → 7         | ioredis,typeorm → typeorm                                                                                                                       | T-2+T-3     |
| `auto-practice/prompt-version.spec.ts`                                 | 单元 | 53 → 53         | 4 → 3         | ioredis → -                                                                                                                                     | T-2+T-3     |
| `auto-practice/wp-h-wave2-3-batch-observability.spec.ts`               | 单元 | 78 → 79         | 8 → 7         | ioredis,typeorm → typeorm                                                                                                                       | T-2+T-3     |
| `auto-practice/wp-j-p1e-semantic-tag-parser.spec.ts`                   | 单元 | 3 → 3           | 1 → 1         | -                                                                                                                                               | 未改动      |
| `auto-practice/wp-j-p1e-semantic-turn-persister.spec.ts`               | 单元 | 5 → 5           | 4 → 4         | typeorm → typeorm                                                                                                                               | 未改动      |
| `auto-practice/wp-j-p1e-semantic-wiring.spec.ts`                       | 单元 | 79 → 79         | 8 → 7         | ioredis,typeorm → typeorm                                                                                                                       | T-2+T-3     |
| `auto-practice/wp-j-p1e-streaming-semantic-preprocessor.spec.ts`       | 单元 | 4 → 4           | 1 → 1         | -                                                                                                                                               | 未改动      |
| `auto-practice/wp-k-batch-compute.spec.ts`                             | 单元 | 5 → 5           | 1 → 1         | -                                                                                                                                               | 未改动      |
| `auto-practice/wp-k-config-fingerprint.spec.ts`                        | 单元 | 3 → 3           | 1 → 1         | -                                                                                                                                               | 未改动      |
| `auto-practice/wp-k-metric-catalog-endpoint.spec.ts`                   | 单元 | 108 → 108       | 9 → 7         | bullmq,ioredis,typeorm → typeorm                                                                                                                | T-2+T-3     |
| `auto-practice/wp-k-metric-dictionary.spec.ts`                         | 单元 | 2 → 2           | 1 → 1         | -                                                                                                                                               | 未改动      |
| `auto-practice/wp-k-regression-evaluator.spec.ts`                      | 单元 | 9 → 9           | 1 → 1         | -                                                                                                                                               | 未改动      |
| `base/auth-reset-password.spec.ts`                                     | 集成 | 88 → 89         | 24 → 23       | @node-rs/argon2,bullmq,ioredis,nodemailer,passport-jwt,typeorm → @node-rs/argon2,nodemailer,passport-jwt,typeorm                                | T-1+T-2+T-3 |
| `base/wp25-security-hardening.spec.ts`                                 | 单元 | 29 → 29         | 17 → 16       | ioredis,typeorm → typeorm                                                                                                                       | T-2+T-3     |
| `config/wp25-env-example-coverage.spec.ts`                             | 单元 | 1 → 1           | 1 → 1         | -                                                                                                                                               | 未改动      |
| `config/wp26-metrics-config.spec.ts`                                   | 单元 | 1 → 1           | 1 → 1         | -                                                                                                                                               | 未改动      |
| `config/wp45-prometheus-alert-metrics.spec.ts`                         | 单元 | 1 → 1           | 1 → 1         | -                                                                                                                                               | 未改动      |
| `config/wp69-env-blindspot-expansion.spec.ts`                          | 单元 | 1 → 1           | 1 → 1         | -                                                                                                                                               | 未改动      |
| `counselor/crisis-practice-isolation.spec.ts`                          | 单元 | 8 → 8           | 0 → 0         | -                                                                                                                                               | 未改动      |
| `counselor/drill-isolation.spec.ts`                                    | 单元 | 15 → 15         | 2 → 2         | -                                                                                                                                               | 未改动      |
| `counselor/drill-judge.spec.ts`                                        | 单元 | 9 → 9           | 0 → 0         | -                                                                                                                                               | 未改动      |
| `counselor/practice-engine.spec.ts`                                    | 单元 | 14 → 14         | 0 → 0         | -                                                                                                                                               | 未改动      |
| `counselor/quote-engine.spec.ts`                                       | 单元 | 3 → 3           | 3 → 3         | -                                                                                                                                               | 未改动      |
| `counselor/session-degraded.spec.ts`                                   | 单元 | 26 → 26         | 3 → 3         | typeorm → typeorm                                                                                                                               | 未改动      |
| `counselor/session-material.spec.ts`                                   | 单元 | 2 → 2           | 0 → 0         | -                                                                                                                                               | 未改动      |
| `counselor/session-report-status.spec.ts`                              | 单元 | 11 → 11         | 0 → 0         | -                                                                                                                                               | 未改动      |
| `counselor/session-view.spec.ts`                                       | 单元 | 12 → 12         | 0 → 0         | -                                                                                                                                               | 未改动      |
| `counselor/supervision-alternatives.spec.ts`                           | 单元 | 42 → 42         | 4 → 4         | typeorm → typeorm                                                                                                                               | 未改动      |
| `counselor/supervision-failure.spec.ts`                                | 单元 | 3 → 3           | 1 → 1         | -                                                                                                                                               | 未改动      |
| `counselor/visitor-pool-codename.spec.ts`                              | 单元 | 7 → 7           | 0 → 0         | -                                                                                                                                               | 未改动      |
| `counselor/voice-catalog.spec.ts`                                      | 单元 | 4 → 4           | 0 → 0         | -                                                                                                                                               | 未改动      |
| `counselor/vpt-config.spec.ts`                                         | 单元 | 2 → 2           | 0 → 0         | -                                                                                                                                               | 未改动      |
| `counselor/wp21-report-sse-endpoint.spec.ts`                           | 集成 | 68 → 68         | 12 → 12       | ioredis,typeorm → typeorm                                                                                                                       | T-1+T-2     |
| `counselor/wp21-report-stream.spec.ts`                                 | 单元 | 44 → 44         | 5 → 5         | typeorm → typeorm                                                                                                                               | 未改动      |
| `counselor/wp43-evaluation-engine.spec.ts`                             | 单元 | 88 → 88         | 12 → 11       | bullmq,ioredis,typeorm → typeorm                                                                                                                | T-2+T-3     |
| `counselor/wp44-growth-archive.spec.ts`                                | 单元 | 48 → 48         | 11 → 11       | ioredis,typeorm → typeorm                                                                                                                       | T-2         |
| `engine-adapters/character-baseline-calibration.spec.ts`               | 单元 | 43 → 43         | 3 → 3         | typeorm → typeorm                                                                                                                               | 未改动      |
| `engine-adapters/character-baseline-seed-calibration.spec.ts`          | 单元 | 5 → 5           | 1 → 1         | typeorm → typeorm                                                                                                                               | 未改动      |
| `engine-adapters/d2-event-kind-split.spec.ts`                          | 单元 | 50 → 50         | 7 → 6         | ioredis,typeorm → typeorm                                                                                                                       | T-2+T-3     |
| `engine-adapters/deliberation-gate/evaluator.spec.ts`                  | 单元 | 43 → 43         | 4 → 3         | ioredis → -                                                                                                                                     | T-2+T-3     |
| `engine-adapters/deliberation-gate/quotas.spec.ts`                     | 单元 | 49 → 49         | 4 → 3         | ioredis → -                                                                                                                                     | T-2+T-3     |
| `engine-adapters/eval/eval.dataset.spec.ts`                            | 单元 | 33 → 33         | 1 → 1         | -                                                                                                                                               | 未改动      |
| `engine-adapters/eval/eval.metrics.spec.ts`                            | 单元 | 4 → 4           | 1 → 1         | -                                                                                                                                               | 未改动      |
| `engine-adapters/eval/eval.runner.spec.ts`                             | 单元 | 51 → 51         | 5 → 4         | ioredis → -                                                                                                                                     | T-2+T-3     |
| `engine-adapters/g123-deliberation-scenario-fingerprint.spec.ts`       | 单元 | 69 → 69         | 5 → 4         | ioredis → -                                                                                                                                     | T-2+T-3     |
| `engine-adapters/i12-session-threshold-plumbing.spec.ts`               | 单元 | 59 → 59         | 5 → 4         | ioredis → -                                                                                                                                     | T-2+T-3     |
| `engine-adapters/model-event-classifier.spec.ts`                       | 单元 | 43 → 43         | 5 → 4         | ioredis → -                                                                                                                                     | T-2+T-3     |
| `engine-adapters/phase25-wp-a-deliberation-input-minimization.spec.ts` | 单元 | 52 → 52         | 4 → 3         | ioredis → -                                                                                                                                     | T-2+T-3     |
| `engine-adapters/qdrant-memory-store.spec.ts`                          | 单元 | 39 → 39         | 3 → 3         | -                                                                                                                                               | 未改动      |
| `engine-adapters/r9-deliberation-hook.spec.ts`                         | 单元 | 52 → 52         | 3 → 3         | ioredis → -                                                                                                                                     | T-2         |
| `engine-adapters/r9-deliberation-mode-config.spec.ts`                  | 单元 | 50 → 50         | 3 → 3         | ioredis → -                                                                                                                                     | T-2         |
| `engine-adapters/wp-deliberation-cap-config.spec.ts`                   | 单元 | 50 → 50         | 4 → 3         | ioredis → -                                                                                                                                     | T-2+T-3     |
| `engine-adapters/wp-deliberation-clinical-sanity.spec.ts`              | 单元 | 50 → 50         | 4 → 3         | ioredis → -                                                                                                                                     | T-2+T-3     |
| `engine-adapters/wp-deliberation-delta-cap.spec.ts`                    | 单元 | 50 → 50         | 4 → 3         | ioredis → -                                                                                                                                     | T-2+T-3     |
| `engine-adapters/wp-deliberation-stale-check.spec.ts`                  | 单元 | 51 → 51         | 4 → 3         | ioredis → -                                                                                                                                     | T-2+T-3     |
| `engine-adapters/wp-g-render-prompt.spec.ts`                           | 单元 | 56 → 56         | 5 → 4         | ioredis → -                                                                                                                                     | T-2+T-3     |
| `engine-adapters/wp-h-render-availability.spec.ts`                     | 单元 | 103 → 103       | 9 → 7         | bullmq,ioredis,typeorm → typeorm                                                                                                                | T-2+T-3     |
| `engine-adapters/wp-h-wave2-3-prompt-tokens.spec.ts`                   | 单元 | 39 → 39         | 4 → 2         | @langchain/core,@langchain/openai → -                                                                                                           | T-2+T-3     |
| `engine-adapters/wp-j-p1d-attachment-style-wiring.spec.ts`             | 单元 | 58 → 58         | 5 → 4         | ioredis → -                                                                                                                                     | T-2+T-3     |
| `engine-adapters/wp-j-p1d-info-increment-depth.spec.ts`                | 单元 | 56 → 56         | 5 → 4         | ioredis → -                                                                                                                                     | T-2+T-3     |
| `engine-adapters/wp-j-p2-verbal-voice-wiring.spec.ts`                  | 单元 | 58 → 58         | 5 → 4         | ioredis → -                                                                                                                                     | T-2+T-3     |
| `engine-adapters/wp10-ethical-scripts.spec.ts`                         | 单元 | 34 → 34         | 0 → 0         | -                                                                                                                                               | 未改动      |
| `engine-adapters/wp10-trajectory-injection.spec.ts`                    | 单元 | 79 → 79         | 6 → 5         | bullmq,ioredis,ws → ws                                                                                                                          | T-2+T-3     |
| `engine-adapters/wp10a-character-expression-fields.spec.ts`            | 单元 | 44 → 44         | 3 → 3         | typeorm → typeorm                                                                                                                               | 未改动      |
| `engine-adapters/wp11-psyguard-probe.spec.ts`                          | 单元 | 88 → 88         | 4 → 4         | ioredis → -                                                                                                                                     | T-2         |
| `engine-adapters/wp12-memory-closeout.spec.ts`                         | 单元 | 58 → 59         | 3 → 3         | -                                                                                                                                               | T-3         |
| `engine-adapters/wp14-block-no-llm-start.spec.ts`                      | 单元 | 47 → 47         | 1 → 1         | -                                                                                                                                               | 未改动      |
| `engine-adapters/wp14-student-risk-disposal.spec.ts`                   | 单元 | 79 → 79         | 4 → 4         | ioredis → -                                                                                                                                     | T-2         |
| `engine-adapters/wp15-delta-cap-log.spec.ts`                           | 单元 | 2 → 2           | 2 → 2         | -                                                                                                                                               | 未改动      |
| `engine-adapters/wp16-round-id-idempotency.spec.ts`                    | 单元 | 45 → 45         | 1 → 1         | -                                                                                                                                               | 未改动      |
| `engine-adapters/wp23-committed-turn-ledger.spec.ts`                   | 单元 | 45 → 45         | 1 → 1         | -                                                                                                                                               | 未改动      |
| `engine-adapters/wp24-session-cost-log.spec.ts`                        | 单元 | 79 → 79         | 5 → 4         | ioredis → -                                                                                                                                     | T-2+T-3     |
| `engine-adapters/wp26-delta-cap-config.spec.ts`                        | 单元 | 32 → 32         | 2 → 2         | -                                                                                                                                               | 未改动      |
| `engine-adapters/wp32-bdi-state-persistence.spec.ts`                   | 单元 | 80 → 80         | 5 → 4         | ioredis → -                                                                                                                                     | T-2+T-3     |
| `engine-adapters/wp34-personality-modulator-config.spec.ts`            | 单元 | 32 → 32         | 1 → 1         | -                                                                                                                                               | 未改动      |
| `engine-adapters/wp36-session-decay-config.spec.ts`                    | 单元 | 32 → 32         | 1 → 1         | -                                                                                                                                               | 未改动      |
| `engine-adapters/wp37-rolling-session-summary.spec.ts`                 | 单元 | 66 → 66         | 5 → 4         | ioredis → -                                                                                                                                     | T-2+T-3     |
| `engine-adapters/wp38-character-version-semver.spec.ts`                | 单元 | 73 → 73         | 12 → 10       | bullmq,ioredis,typeorm → typeorm                                                                                                                | T-2+T-3     |
| `engine-adapters/wp41-expression-style-rendering.spec.ts`              | 单元 | 60 → 60         | 7 → 6         | ioredis,typeorm → typeorm                                                                                                                       | T-2+T-3     |
| `engine-adapters/wp42-alliance-config.spec.ts`                         | 单元 | 32 → 32         | 1 → 1         | -                                                                                                                                               | 未改动      |
| `engine-adapters/wp43-evaluation-wiring.spec.ts`                       | 单元 | 46 → 46         | 1 → 1         | -                                                                                                                                               | 未改动      |
| `engine-adapters/wp45-qdrant-sdk-contract.spec.ts`                     | 单元 | 2 → 2           | 4 → 4         | @qdrant/js-client-rest → @qdrant/js-client-rest                                                                                                 | 例外        |
| `engine-adapters/wp49-character-five-factor-personality.spec.ts`       | 单元 | 36 → 36         | 3 → 3         | typeorm → typeorm                                                                                                                               | 未改动      |
| `engine-adapters/wp51-character-seed-alliance-baseline.spec.ts`        | 单元 | 44 → 44         | 3 → 3         | typeorm → typeorm                                                                                                                               | 未改动      |
| `engine-adapters/wp55-rolling-summary-both-sides.spec.ts`              | 单元 | 66 → 66         | 5 → 4         | ioredis → -                                                                                                                                     | T-2+T-3     |
| `engine-adapters/wp58-turn-delta-audit.spec.ts`                        | 单元 | 292 → 292       | 25 → 20       | @langchain/core,@langchain/openai,@node-rs/argon2,@qdrant/js-client-rest,bullmq,ioredis,nodemailer,typeorm → @node-rs/argon2,nodemailer,typeorm | T-2+T-3     |
| `engine-adapters/wp6-llm-render.spec.ts`                               | 单元 | 36 → 36         | 1 → 1         | -                                                                                                                                               | 未改动      |
| `engine-adapters/wp60-delta-table-config.spec.ts`                      | 单元 | 32 → 32         | 1 → 1         | -                                                                                                                                               | 未改动      |
| `engine-adapters/wp62-kernel-barrel-types.spec.ts`                     | 单元 | 32 → 32         | 0 → 0         | -                                                                                                                                               | 未改动      |
| `engine-adapters/wp63-deliberation-schema.spec.ts`                     | 单元 | 43 → 43         | 4 → 3         | ioredis → -                                                                                                                                     | T-2+T-3     |
| `engine-adapters/wp64-deliberation-shadow.spec.ts`                     | 单元 | 57 → 57         | 5 → 4         | ioredis → -                                                                                                                                     | T-2+T-3     |
| `engine-adapters/wp65-deliberation-mutex-revision.spec.ts`             | 单元 | 85 → 86         | 6 → 4         | bullmq,ioredis → -                                                                                                                              | T-2+T-3     |
| `engine-adapters/wp65-deliberation-queue.spec.ts`                      | 单元 | 52 → 52         | 5 → 3         | bullmq,ioredis → -                                                                                                                              | T-2+T-3     |
| `engine-adapters/wp66-deliberation-retry.spec.ts`                      | 单元 | 52 → 52         | 5 → 3         | bullmq,ioredis → -                                                                                                                              | T-2+T-3     |
| `engine-adapters/wp67-deliberation-circuit-breaker.spec.ts`            | 单元 | 55 → 56         | 5 → 3         | bullmq,ioredis → -                                                                                                                              | T-2+T-3     |
| `engine-adapters/wp68-deliberation-intention-lock.spec.ts`             | 单元 | 50 → 50         | 4 → 3         | ioredis → -                                                                                                                                     | T-2+T-3     |
| `engine-adapters/wp7-turn-render.spec.ts`                              | 单元 | 56 → 56         | 4 → 4         | ioredis → -                                                                                                                                     | T-2         |
| `engine-adapters/wp8-wiring.spec.ts`                                   | 单元 | 103 → 103       | 10 → 9        | ioredis → -                                                                                                                                     | T-2+T-3     |
| `engine-adapters/wp8b-stream-render.spec.ts`                           | 单元 | 36 → 36         | 1 → 1         | -                                                                                                                                               | 未改动      |
| `engine-adapters/wp8b-turn-stream.spec.ts`                             | 单元 | 56 → 56         | 4 → 4         | ioredis → -                                                                                                                                     | T-2         |
| `engine-adapters/wp9a-character-resolver.spec.ts`                      | 单元 | 34 → 34         | 0 → 0         | -                                                                                                                                               | 未改动      |
| `engine-adapters/wp9a-open-profile.spec.ts`                            | 单元 | 78 → 78         | 6 → 5         | bullmq,ioredis,ws → ws                                                                                                                          | T-2+T-3     |
| `engine-adapters/wp9b-character-admin.spec.ts`                         | 单元 | 43 → 43         | 7 → 7         | typeorm → typeorm                                                                                                                               | 未改动      |
| `engine-adapters/wp9b-db-character-resolver.spec.ts`                   | 单元 | 60 → 60         | 4 → 4         | typeorm → typeorm                                                                                                                               | 未改动      |
| `engine-adapters/wp9b-engine-stream-backend-wiring.spec.ts`            | 单元 | 79 → 79         | 4 → 4         | ioredis → -                                                                                                                                     | T-2         |
| `engine-adapters/wp9c-render-safety.spec.ts`                           | 单元 | 59 → 59         | 4 → 4         | ioredis → -                                                                                                                                     | T-2         |
| `engine-adapters/wp9c-risk-probe.spec.ts`                              | 单元 | 34 → 34         | 0 → 0         | -                                                                                                                                               | 未改动      |
| `engine-core/boundary.spec.ts`                                         | 单元 | 1 → 1           | 1 → 1         | -                                                                                                                                               | 未改动      |
| `engine-core/d3-timing-weight-port.spec.ts`                            | 单元 | 35 → 35         | 1 → 1         | -                                                                                                                                               | 未改动      |
| `engine-core/engine-core.spec.ts`                                      | 单元 | 35 → 35         | 1 → 1         | -                                                                                                                                               | 未改动      |
| `engine-core/i12-session-alliance-config.spec.ts`                      | 单元 | 32 → 33         | 2 → 2         | -                                                                                                                                               | T-2+T-3     |
| `engine-core/i20-valence-arousal-role-coefficients.spec.ts`            | 单元 | 31 → 31         | 1 → 1         | -                                                                                                                                               | 未改动      |
| `engine-core/kernel-internal-clamp-unify.spec.ts`                      | 单元 | 31 → 31         | 0 → 0         | -                                                                                                                                               | 未改动      |
| `engine-core/r9-deliberation-hook.spec.ts`                             | 单元 | 35 → 35         | 1 → 1         | -                                                                                                                                               | 未改动      |
| `engine-core/s1-open-depth-threshold.spec.ts`                          | 单元 | 8 → 8           | 1 → 1         | -                                                                                                                                               | 未改动      |
| `engine-core/wp1-bdi.spec.ts`                                          | 单元 | 35 → 35         | 1 → 1         | -                                                                                                                                               | 未改动      |
| `engine-core/wp15-delta-cap.spec.ts`                                   | 单元 | 31 → 31         | 0 → 0         | -                                                                                                                                               | 未改动      |
| `engine-core/wp2-memory.spec.ts`                                       | 单元 | 35 → 35         | 1 → 1         | -                                                                                                                                               | 未改动      |
| `engine-core/wp26-delta-cap-injection.spec.ts`                         | 单元 | 35 → 35         | 1 → 1         | -                                                                                                                                               | 未改动      |
| `engine-core/wp3-trajectory.spec.ts`                                   | 单元 | 35 → 35         | 1 → 1         | -                                                                                                                                               | 未改动      |
| `engine-core/wp34-personality-modulator.spec.ts`                       | 单元 | 35 → 35         | 1 → 1         | -                                                                                                                                               | 未改动      |
| `engine-core/wp36-session-decay.spec.ts`                               | 单元 | 35 → 35         | 1 → 1         | -                                                                                                                                               | 未改动      |
| `engine-core/wp37-rolling-summary-hook.spec.ts`                        | 单元 | 35 → 35         | 1 → 1         | -                                                                                                                                               | 未改动      |
| `engine-core/wp4-safety.spec.ts`                                       | 单元 | 35 → 35         | 1 → 1         | -                                                                                                                                               | 未改动      |
| `engine-core/wp42-alliance-three-dimensions.spec.ts`                   | 单元 | 35 → 29         | 1 → 1         | -                                                                                                                                               | T-3         |
| `engine-core/wp5-rendering.spec.ts`                                    | 单元 | 35 → 35         | 1 → 1         | -                                                                                                                                               | 未改动      |
| `engine-core/wp51-character-seed-alliance-baseline.spec.ts`            | 单元 | 5 → 5           | 0 → 0         | -                                                                                                                                               | 未改动      |
| `engine-core/wp53-personality-alliance-extension.spec.ts`              | 单元 | 35 → 35         | 1 → 1         | -                                                                                                                                               | 未改动      |
| `engine-core/wp57-belief-layer.spec.ts`                                | 单元 | 35 → 35         | 1 → 1         | -                                                                                                                                               | 未改动      |
| `engine-core/wp60-delta-table-config.spec.ts`                          | 单元 | 35 → 35         | 1 → 1         | -                                                                                                                                               | 未改动      |
| `llm/llm-retry.spec.ts`                                                | 单元 | 2 → 2           | 1 → 1         | -                                                                                                                                               | 未改动      |
| `llm/minimax-provider.spec.ts`                                         | 单元 | 13 → 13         | 4 → 4         | @langchain/core,@langchain/openai → @langchain/core,@langchain/openai                                                                           | 例外        |
| `llm/wp9c-token-fields.spec.ts`                                        | 单元 | 6 → 6           | 3 → 3         | @langchain/core,@langchain/openai → @langchain/core,@langchain/openai                                                                           | 例外        |
| `quality/d1-event-classifier-evidence.spec.ts`                         | 单元 | 33 → 5          | 1 → 1         | -                                                                                                                                               | T-3         |
| `quality/p1d-visitor-quality-lexicon.spec.ts`                          | 单元 | 2 → 2           | 1 → 1         | -                                                                                                                                               | 未改动      |
| `quality/phase3-disfluency-d7-baseline.spec.ts`                        | 单元 | 5 → 5           | 1 → 1         | -                                                                                                                                               | 未改动      |
| `quality/quality-annotation-auto.spec.ts`                              | 单元 | 3 → 3           | 1 → 1         | -                                                                                                                                               | 未改动      |
| `quality/quality-annotation-batch-contract.spec.ts`                    | 单元 | 96 → 96         | 12 → 11       | ioredis,typeorm → typeorm                                                                                                                       | T-2+T-3     |
| `quality/quality-annotation-batch.spec.ts`                             | 单元 | 3 → 3           | 1 → 1         | -                                                                                                                                               | 未改动      |
| `quality/quality-annotation-consistency.spec.ts`                       | 单元 | 2 → 2           | 1 → 1         | -                                                                                                                                               | 未改动      |
| `quality/quality-annotation-contract.spec.ts`                          | 单元 | 142 → 142       | 17 → 15       | @node-rs/argon2,bullmq,ioredis,nodemailer,typeorm → @node-rs/argon2,nodemailer,typeorm                                                          | T-2+T-3     |
| `quality/quality-annotation-seed.spec.ts`                              | 单元 | 3 → 3           | 2 → 2         | typeorm → typeorm                                                                                                                               | 未改动      |
| `shared/p1d-log-redaction.spec.ts`                                     | 单元 | 2 → 2           | 3 → 3         | -                                                                                                                                               | 未改动      |
| `shared/sentry-redaction.spec.ts`                                      | 单元 | 3 → 3           | 3 → 2         | -                                                                                                                                               | T-2+T-3     |
| `shared/shanghai-date.spec.ts`                                         | 单元 | 2 → 2           | 1 → 1         | -                                                                                                                                               | 未改动      |
| `shared/wp18-llm-json-payload.spec.ts`                                 | 单元 | 2 → 2           | 0 → 0         | -                                                                                                                                               | 未改动      |
| `shared/wp26-biz-exception-log.spec.ts`                                | 单元 | 8 → 8           | 3 → 3         | -                                                                                                                                               | 未改动      |
| `shared/wp26-metrics-auth.spec.ts`                                     | 单元 | 5 → 5           | 3 → 3         | -                                                                                                                                               | 未改动      |
| `user/set-password-first-set.spec.ts`                                  | 集成 | 62 → 63         | 18 → 17       | @node-rs/argon2,bullmq,ioredis,nodemailer,typeorm → @node-rs/argon2,nodemailer,typeorm                                                          | T-1+T-2+T-3 |
| `voice/voice-protocol.spec.ts`                                         | 单元 | 5 → 5           | 0 → 0         | -                                                                                                                                               | 未改动      |
| `voice/vpt-session.spec.ts`                                            | 单元 | 4 → 4           | 1 → 1         | -                                                                                                                                               | 未改动      |
| `voice/wp14-pre-check-gate.spec.ts`                                    | 单元 | 74 → 74         | 5 → 4         | bullmq,ioredis,ws → ws                                                                                                                          | T-2+T-3     |
| `voice/wp16-turn-incomplete.spec.ts`                                   | 单元 | 31 → 31         | 5 → 4         | bullmq,ioredis,ws → ws                                                                                                                          | T-2+T-3     |
| `voice/wp22-voice-concurrency-budget.spec.ts`                          | 集成 | 124 → 124       | 12 → 10       | bullmq,ioredis,ws → ws                                                                                                                          | T-1+T-2+T-3 |
| `voice/wp23-gateway-reconnect.spec.ts`                                 | 单元 | 52 → 52         | 10 → 9        | bullmq,ioredis,ws → ws                                                                                                                          | T-2+T-3     |
| `voice/wp23-ws-disconnect-grace.spec.ts`                               | 单元 | 32 → 32         | 5 → 4         | bullmq,ioredis,ws → ws                                                                                                                          | T-2+T-3     |
| `voice/wp25-ws-session-ownership.spec.ts`                              | 单元 | 52 → 52         | 10 → 9        | bullmq,ioredis,ws → ws                                                                                                                          | T-2+T-3     |
| `voice/wp26-voice-gateway-hardening.spec.ts`                           | 单元 | 52 → 52         | 11 → 10       | bullmq,ioredis,socket.io,ws → socket.io,ws                                                                                                      | T-2+T-3     |
| `voice/wp8b-grayscale.spec.ts`                                         | 单元 | 31 → 31         | 5 → 4         | bullmq,ioredis,ws → ws                                                                                                                          | T-2+T-3     |

---

## 五、闸门表（真实数字 + 取证方法）

| 闸门         | 命令                                                                    | exit | 真实数字                                                                                                                                                     |
| ------------ | ----------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 根类型       | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` | 0    | **0 error**                                                                                                                                                  |
| 构建类型     | `pnpm exec tsc -p tsconfig.build.json --noEmit`                         | 0    | **0 error**                                                                                                                                                  |
| Lint（权威） | `pnpm lint`                                                             | 0    | **0 error / 1 warning**                                                                                                                                      |
| oxlint fast  | `pnpm lint:fast`                                                        | 0    | **0 warning / 0 error**                                                                                                                                      |
| oxlint deep  | `pnpm lint:deep`                                                        | 0    | **0 warning / 0 error**                                                                                                                                      |
| 测试         | `pnpm test`                                                             | 0    | **194 文件 / 3252 例 = 3248 passed + 4 skipped**（与基线逐字一致）；Duration **61.80 s**（import 81% / tests 15% / transform 3% / worker 2%）；总墙钟 63.5 s |
| engine-core  | `git diff --stat HEAD -- src/engine-core`                               | 0    | **空**                                                                                                                                                       |
| 生产 src     | `git diff --name-only HEAD -- src`                                      | 0    | **空**                                                                                                                                                       |
| 边界         | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                | 0    | **12 passed**                                                                                                                                                |
| 盘读前置     | `pnpm doctor:fs`                                                        | 0    | 合格（均值 **0.13 ms/文件**、slow=0）                                                                                                                        |

- **唯一 warning 详情**：`test/e2e/v2-user-flow.spec.ts:1` Unused eslint-disable directive —— 基线既有、在 e2e 范围外于本单授权范围、任务单未授权修；`pnpm lint:fix` 的越界改动已 `git checkout` 回退。
- **机器状态（实测记录，§3.1 不作验收指标）**：`nest start --watch`（PID 14612，68.6 s CPU / 845 MB）、`dist/app`（PID 16608）、`admin-dashboard` vite dev（PID 7860）三个长驻进程在跑；**未擅自杀用户进程**。因此 61.80 s 与基线 132 s **不可直接比较**。
- **命令边界**：全部闸门用 pnpm（`pnpm <script>` / `pnpm exec <bin>`），**未用裸 npx**。

---

## 六、风险与回归

1. **被重构的既有 spec**：90 个（T-2 加包级 mock 82 个 + T-3 拆 barrel 12 个 + T-1 收敛审计 4 个，重叠处合并计）。重构理由逐条见 §四。
2. **断言期望**：全量 3252 例与基线逐字一致（3248 passed + 4 skipped）。唯一写法变化是 8 处 `toBe(x.length)` → `toHaveLength(x)`，**期望值逐字未变**（见 D-7）。
3. **用例数**：未增未删（基线 3252 例 = 改后 3252 例；文件数 194 = 194）。
4. **mock 语义**：适配层 / service / controller 全部仍是真实现；本单只在 SDK **包边界**换掉「加载真实 SDK」这一件事。
5. **替身失败语义**：替身数据面方法一律 throw。全量 3252 例全绿 → 没有 spec 在 mock 后仍触碰真实 SDK 数据面（若有，用例会当场炸而不是假绿）。
6. **engine-core**：`git diff --stat HEAD -- src/engine-core` 空；`test/engine-core/boundary.spec.ts` 未改；12 passed。
7. **生产 `src/`**：零改动（`git diff --name-only HEAD -- src` 空）；未加端口、未加 module 装配、未改 entity / DTO / 映射函数。
8. **配置与隔离语义**：`vitest.config.mts` / `vitest.fast.config.mts` / `package.json`（scripts 与依赖）/ tsconfig / Dockerfile / CI workflow **均未改**；`isolate` 未动；`test:fast` 未提升为权威闸门。
9. **新增第三方依赖**：0。
10. **`test/helpers/` 纪律**：`sdk-stubs.ts` 与 `user-stub.ts` 均为纯工厂 —— 不持模块级可变状态、不 import Nest 容器、不做 module 装配注册、不硬编码业务阈值。
11. **副作用登记**：`test/helpers/index.ts` 新增 `sdk-stubs` 导出 → 引用 helpers barrel 的 3 个 spec 各多 1 个本地测试模块（+3，量级可忽略），换来 82 个 spec 的重型 SDK 出图。
12. **过程中自行发现并已修复的自身事故**（留档便于复盘）：(a) 批量脚本把 8 个「只有 node: 内建导入」文件的 `import { vi }` 插到文件头注释之前 → 已用脚本修复；(b) `test/helpers/index.ts` 曾误导出 `user-stub.js`，导致 5 个 spec 被拖进 typeorm（模块数 +200）→ 已移除该导出；(c) 误删 `set-password-first-set.spec.ts` 的 `fakeExecutionContext` → 已补回；(d) 未使用的 `User` / `DB_UID` 导入 → 已删；(e) `pnpm lint:fix` 越界改了 `test/e2e/v2-user-flow.spec.ts` → 已 `git checkout` 回退。

---

## 七、遗留项与另案登记

| 编号 | 遗留                                                                                                        | 阻塞原因                                                                                   | 另案建议                                                                                                                                                                   |
| ---- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L-1  | **typeorm / `@nestjs/typeorm` 仍是最大残留**：改后仍有 45 个 spec 触达 typeorm、43 个触达 `@nestjs/typeorm` | 根因在**生产 src 侧**：entity 装饰器 + `import { Repository } from 'typeorm'` 的值导入形态 | 治本路径 = 生产 src 侧把 `Repository` 改 `import type`、entity 装饰器依赖改端口注入。**这要改生产代码，超出本单授权**（§2 明令「测试缺端口只登记另案」），建议主控单独立项 |
| L-2  | 3 个 spec 保留真实 SDK：`minimax-provider` / `wp9c-token-fields` / `wp45-qdrant-sdk-contract`               | 断言对象即真 SDK 行为（见 §四 4.3）                                                        | 若后续要收，需先引入可注入端口（属 src 侧改动）                                                                                                                            |
| L-3  | `test/e2e/v2-user-flow.spec.ts:1` 既有 unused eslint-disable warning                                        | e2e 范围外于本单授权                                                                       | 随 e2e 专项一并清理                                                                                                                                                        |
| L-4  | 墙钟 61.80 s 与基线 132 s 不可直接比较                                                                      | 机器不干净（3 个长驻进程）+ 闸门性能 §1.5 已记录同一份代码 80 s ↔ 1100 s 的波动            | 待 P-DEBT-7 隔离环境就绪后重测                                                                                                                                             |
| L-5  | 断言 Module 元数据（`Reflect.getMetadata('imports', ...)`）的 spec 无法收窄 Module 类加载                   | Module 类被静态引用，import 图必然带上                                                     | 需 src 侧提供更细的装配粒度（另案）                                                                                                                                        |
| L-6  | Nest 框架触达 spec **118 → 118 未变**                                                                       | `@nestjs/testing` / `@nestjs/common` 是 TestingModule 与 DI 冒烟用例的必需依赖             | 下一轮方向：把 DI 冒烟用例与纯单元用例分离（纯单元 spec 可完全不引 Nest）；本轮不做，避免改动面外溢                                                                        |

---

_本单无新增第三方依赖；无 schema / migration 变更；无 CI 变更；未自动 commit / push。_
