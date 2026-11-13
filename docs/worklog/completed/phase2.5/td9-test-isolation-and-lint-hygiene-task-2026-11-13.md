# TD-9 · 测试隔离残留清理 · lint 告警清零 · ESLint 缓存稳定性 · git 环境前置（工程卫生清理）

> 状态：✅ **已交付**（2026-11-13，MiniMax Code）→ [交付记录](td9-test-isolation-and-lint-hygiene-implementation-2026-11-13.md)
> 执行方：MiniMax Code（主控派单 · 纯工程卫生，不依赖批次样本 / 临床拍板 / 外部资质 / core 改动）
> 仓库：E:\Work\Project\backend\mofang-nestjs，分支 `integrate`，上游 `origin/integrate`
> 唯一事实源：[工程工具链技术债清单](../../pending/phase2.5-toolchain-tech-debt-2026-11-11.md) + [闸门性能 remediation](../../../team/gate-performance-remediation-2026-11-11.md) §9 P-DEBT-1 / 2 / 3 / 9 + 主控 2026-11-13 HEAD `4424092` 现场复核（扫描备查 `data/quality/td9-*.txt`，gitignore 不入库）
> 任务性质：既有工程卫生债清理（测试间 mock/env/单例残留 + lint 告警 + 缓存失效定位 + spec 环境前置）；**不改变生产业务行为、不改测试期望数值**；改动落在 `test/`、少量 `src/` 告警点、eslint / CI 缓存配置与 docs 索引回写。
> 上一单：[TD-8 交付记录](td8-ci-pnpm-parity-and-caching-implementation-2026-11-13.md)（CI pnpm 对齐 + 缓存已闭环，HEAD `4424092`）。

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `E:\Work\Project\backend\mofang-nestjs\AGENTS.md` —— 仓库入口与 engine-core 红线
2. `E:\Work\Project\backend\mofang-nestjs\docs\team\conventions.md` —— 代码红线、16 条硬约束、交付格式（§命令边界：`packageManager=pnpm`，禁止裸 npx）
3. `E:\Work\Project\backend\mofang-nestjs\docs\team\wp-task-template.md` —— 任务单结构与交付回写清单
4. 阶段入口：`docs/worklog/pending/phase2.5-README.md` §3.0 工程工具链技术债 与 `phase2.5-wp-list-2026-11-08.md` §四 TD-9 行
5. 本单事实源：闸门性能文档 §9（P-DEBT-1 ~ P-DEBT-10 全表）、§1.5.3（`isolate:false` 证伪 A/B 表）、工具链清单 §2 与 TD-8 小节；`eslint.config.mjs`、`vitest.config.mts`、`.github/workflows/ci.yml`、`package.json` scripts
6. 本任务单（你在读的这份）

---

## 1. 背景（方向别错）

### 1.1 来源

TD-8 闭环后，主控对六本台账全量复核剩余技术债。A 组（工具链 / 闸门性能）中，P-DEBT-4（版本升级纪律，已立规则）、P-DEBT-7（长驻进程污染，已写进模板纪律）、P-DEBT-8（读税，已解除）、P-DEBT-10（hardlink 复发，已落地 `doctor:fs`）均无代码动作；**P-DEBT-1 / 2 / 3 / 9 四条为纯工程卫生项**，归入本单。其余 core 结构债、Phase3 台账、Phase4 阻塞项均卡在批次样本 / 人工拍板 / 外部资质 / core 红线例外，不在本单范围（§2 逐条列明排除理由）。

> **P-DEBT-1 口径说明（主控已拍板纳入）**：旧结论是"`isolate:false` 已证伪为提速手段、env 泄漏清理优先级降 P2"。本单**只清理 spec 之间的 mock 替身 / Redis·DB 假状态 / 模块级单例残留，补统一 reset**，让测试在隔离语义下更干净；**不把 `isolate:false` 提升为权威闸门、不改隔离配置**。清理本身对 `isolate:true` 权威闸门也是正向卫生。

### 1.2 主控现场复核结论（2026-11-13，HEAD `4424092`；行号以现场 Grep 为准，可能漂移）

| #               | 遗留项                                               | 现状（已核实）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 处置归类                                                                                                                                                               | 边界归属                                                                  |
| --------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| T-1（P-DEBT-1） | spec 间 `process.env` / mock 单例 / 假状态跨文件残留 | 台账 §1.5.3 旧口径列 5 文件；**权威 `pnpm test` 集合内现存 4 个非 e2e spec**：① `test/engine-adapters/wp65-deliberation-mutex-revision.spec.ts` —— `vi.mock('bullmq')` L90，`beforeEach` L399 仅 mockClear 6 个 mock，**无顶层 `vi.restoreAllMocks()`**（restore 在 L513 嵌套作用域）；② `test/engine-adapters/wp67-deliberation-circuit-breaker.spec.ts` —— `vi.mock('bullmq')` L64，`beforeEach` L201 mockClear + `vi.restoreAllMocks()` L208；③ `test/engine-adapters/wp12-memory-closeout.spec.ts` —— **无 `vi.mock`、无 `beforeEach/afterEach`**；模块级仅不可变字面量常量（`TENANT` / `USER` / `PERSONA` / `CLOCK`），残留风险集中在 import 的 stub 与 InMemory store 实例是否跨用例累积，需审计；registry 在各 `it` 内局部 new；④ `test/engine-core/i12-session-alliance-config.spec.ts` —— `vi.mock` planner L21，mockClear 在 `it` 内 L100/110，**无统一 reset 钩子**。旧台账所指 `good-state-diary.service.spec` 在权威集合内已不存在（仅存被 `pnpm test` 排除的 e2e 文件 `test/good-state-diary.e2e-spec.ts`），复核结论写入交付记录。 | 审计 4 文件的模块级可变状态 / mock 替身 / env 读写，补 `beforeEach`/`afterEach` 统一重置与还原；隔离配置不动                                                           | `test/`；**`src/engine-core` 零 diff**；core 测试文件除 §3.1 注明处外不动 |
| T-2（P-DEBT-2） | `.eslintcache` 存在却大面积失效                      | 根目录 `.eslintcache` 612 136 B；`eslint.config.mjs` 未自定义 `cacheLocation`；`lint`/`lint:fix` 脚本带 `--cache`；`projectService.allowDefaultProject=['*.mjs']`；CI `lint-and-typecheck` job 跑 `pnpm lint`，**无 ESLint cache 持久化步骤**（仅缓存 pnpm store）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 定位触发缓存失效的变量（config / tsconfig 变更、`projectService` 程序重建、多工作树）；统一本机与 CI 缓存 key 口径                                                     | `eslint.config.mjs` / `ci.yml` 缓存步骤；不改 lint 规则语义               |
| T-3（P-DEBT-3） | oxlint 既有告警（fast 4 条 + type-aware 额外条目）   | `pnpm lint:fast`（oxlint 93 rules）：**4 warning / 0 error** —— `wp68-deliberation-intention-lock.spec.ts:284`、`wp64-deliberation-shadow.spec.ts:623`（`no-unsafe-optional-chaining`）、`wp3-trajectory.spec.ts:242/244`（`oxc/erasing-op`，`0.4 * 0` 恒等零项）；`pnpm lint:deep`（type-aware，108 rules）：**57 warning / 0 error**，约 src 25 条 / test 32 条（含 e2e 2 条）；执行方现场复跑填真实分布                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 逐条定性：真问题改最小代码；误报优先规则层豁免（`eslint.config.mjs`，带理由注释）或局部 `eslint-disable-next-line`；**不得为消告警改变业务行为 / 类型契约 / 断言期望** | 少量 `src/` + `test/` 告警点 + eslint 配置；不改业务逻辑                  |
| T-4（P-DEBT-9） | 依赖外部命令的 spec 无环境前置                       | `test/auto-practice/wp-h-wave2-3-batch-observability.spec.ts`：L17 `import { execFileSync } from 'node:child_process'`；L177 / L180 / L182 三处 `execFileSync('git', ...)`。取证会话 PATH 不继承系统 PATH 时（本机 git 在 `D:\Apps\Git\cmd`）报 `spawnSync git ENOENT`，会被误判成回归                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | spec 内探测 git 可用性，不可用时 `skip`；或支持 `GIT_BIN` 注入；保持 git 可用时断言不变                                                                                | `test/` 单文件                                                            |

### 1.3 改动面预判（执行时以实际 diff 为准）

- **`src/engine-core/**`：0 改动**（diff 必须为空）。
- **`src/` 其他目录**：仅限 T-3 告警点的最小修正（约 25 处，分布在 engine-adapters / admin-debug / counselor / guide / knowledge-base / practice / voice / companion / life-map / inner_world / auto-practice 等）；不动装配、映射、resolver、module 注册。
- **`test/`**：T-1 四文件 reset 钩子；T-3 测试告警写法修正；T-4 git 前置；重复的 reset / env / git 探测逻辑抽共享测试 helper（新建 `test/helpers/` 或 `test/shared/helpers/`）。
- **`src/shared/infra/`**：仅新增纯函数工具（如 `safeString`），供多处 `no-base-to-string` 调用复用；不改既有服务类、不加 module 装配注册。
- **配置 / CI**：`eslint.config.mjs`（缓存 key / 误报豁免规则）、`ci.yml`（ESLint cache 持久化步骤，仅限缓存）。
- **docs**：交付记录、任务单归档、wp-list §四 与 README §3.0 索引回写；工具链清单 / 闸门性能 §9 对应遗留项状态回写。
- 不改 `package.json` scripts 与依赖、不新增第三方依赖、不改 `Dockerfile`、不改 tsconfig、不改 `vitest.config.mts` 隔离与缓存语义。

---

## 2. 范围（严格遵守，不越权）

**在范围内：**

- **T-1**：审计并清理 4 个现存非 e2e spec 的跨文件残留 —— `bullmq` mock 替身、Redis / DB 假状态、模块级可变 stub 单例、`process.env` 读写；补统一 `beforeEach` 重置 / `afterEach` 还原（env 备份还原、mock `mockClear`/`restoreAllMocks`、模块级 stub 状态复位）。
- **T-2**：定位 `.eslintcache` 失效触发变量；给出本机与 CI 一致的缓存 key 口径（含 eslint config / tsconfig 指纹）；如需 CI 持久化 ESLint cache，在 `ci.yml` 加独立 `actions/cache` 步骤（key 构成与 pnpm store / vitest transform 缓存区分）。
- **T-3**：清零 `lint:fast` 4 条告警；处理 `lint:deep` 全部告警（src / test 分开记账）；每条在交付记录写明定性（真问题修正 / 规则豁免 / 局部 disable 及理由）。
- **T-4**：`wp-h-wave2-3-batch-observability.spec.ts` 三处 git 调用加环境前置（探测可用否则 skip，或 `GIT_BIN` 注入）。
- **共享工具**：T-1 重置 / env 快照、T-3 安全字符串、T-4 git 探测，重复逻辑抽共享 helper / 纯函数，集中导出、供后续 spec 与服务复用。
- docs 回写：交付记录、任务单归档、wp-list §四 与 README §3.0；工具链清单 / 闸门性能文档 §9 对应条目标注处置结论。

**明确不在范围内（禁止顺手做）：**

- **core 结构债一律不碰**：`src/engine-core/**` diff 必须为空；`boundary.spec.ts` 禁止动。I-01~I-24 各项的批次复验、幅度标定、结构改造、门槛 / 阈值拍板均不在本单。`test/engine-core/` 下除 `wp3-trajectory.spec.ts` 两处恒等零项断言化简外，其余文件不动。
- **隔离语义不动**：不改 `vitest.config.mts` 的 `test.isolate`、不改 `vitest.fast.config.mts`、不把 `test:fast` 提升为权威闸门、不做 `projects` 分层隔离改造（属 P-DEBT-6 / 另案）。
- **P-DEBT-5 分片（shard 矩阵）不做**：会改变测试执行拓扑与跨分片顺序依赖，需独立评估；CI 不加分片矩阵。
- **P-DEBT-6 测试结构减重不做**：集成 spec 收敛、外部 SDK 端口层 mock、barrel 瘦身属跨模块重构，独立专项单；本单不收敛集成 spec、不动 SDK 端口层与 barrel 导出。新增共享工具仅限纯函数 / 无装配注册；不改既有服务类、DTO 层、entity 层。
- **Phase3 台账不碰**：L-2~L-6 / P1-N1/N2（待批次）、P1-N3~N7（待拍板）、L-7 / L-8 / L-9（P2/P3，L-9 含实体列与 migration）均不在本单。
- **Phase4 五条不碰**：WP27 / WP29 / WP33 / WP39 / WP40 卡外部商户号 / 档位定稿 / 留存年限 / 真机校准。
- **决策项不替主控拍板**：不删 `package-lock.json`（D-a）；不开启覆盖率采集与阈值门禁（D-b）；不给 `pnpm audit` 加 registry 容错开关；不调整 `engines.node`、CI `node-version` 或 `.nvmrc`。
- **不改表结构 / 不加 migration / 不加列**；不改映射函数、resolver、module 装配；不碰角色 `enabled` / `audit_status` / `version` / 内容字段。
- **前端边界**：不写 `admin-dashboard/` 前端代码；Flutter 客户端一律不碰。
- 不改 e2e 用例逻辑（T-3 若触及 e2e 文件告警，仅做与非 e2e 一致的最小写法修正，断言期望不变）；不跑 e2e（依赖 DB / Qdrant，不在默认全量内）。
- 提交分组隔离：工作区若有并行进程未提交产物，只暂存本单文件，不混入并行产物。
- 不自动 git commit / push（写完给 commit 草稿，等用户指令）。

---

## 3. 逐项处置（先复核定性，再最小改动）

> 通用纪律：每项动手前先读对应文件现状；先复跑 §5 基线闸门记下改动前数字；改动后复跑同一命令对比。命令一律 pnpm，禁止裸 npx；跑闸门前确认无 `nest start --watch` / `vite dev` 长驻进程，并先跑 `pnpm doctor:fs` 确认盘读取正常。

### 3.1 T-1 · spec 间 mock / env / 单例残留清理

**复核点（动手前先核）**：

1. 4 文件各自的 `vi.mock`、模块级 `let` / 常量 stub、Redis / DB 假替身、`process.env` 读写位置逐条列出。
2. 现有 `beforeEach` / `afterEach` / `beforeAll` / `afterAll` 钩子覆盖了什么、漏了什么。
3. 残留是「mock 调用计数未清」「mock 实现被前序用例改写未还原」「模块级 stub 状态跨用例累积」「env 被改写未还原」中的哪一类，分别定性。

**处置**：

1. **重置钩子统一**：每个 describe 块在 `beforeEach` 集中重置 mock（`mockClear` / 必要时 `mockReset`）与模块级 stub 状态；需要还原 mock 实现的用 `vi.restoreAllMocks()`（参照 wp67 L201-208 既有写法）；`process.env` 改写一律备份原值、`afterEach` 还原（删除项恢复 `delete`，赋值项恢复原值）。
2. **模块级 stub 单例**：若 stub 持有可变状态（计数器 / 缓存 / 注册表），把状态复位放进 `beforeEach`；无法在钩子复位的，评估改为 `it` 内局部构造（参照 wp12 现有 `registry` 在 `it` 内 new 的写法），但不改变用例覆盖路径。
3. **wp65 补顶层 `vi.restoreAllMocks()`**：现状 `beforeEach` 只 `mockClear`，确认嵌套作用域内的 restore 是否覆盖全部用例；缺口补到顶层 `beforeEach`。
4. **wp12 审计**：无显式 `vi.mock`，重点查模块级 import 的 stub / InMemory store 是否存在跨用例累积状态；有则复位，无则在交付记录写明「复核无模块级可变残留」。
5. **复用与封装（企业级标准）**：重置逻辑若在 2 个及以上 spec 重复，抽共享测试工具（新建 `test/helpers/` 或 `test/shared/helpers/`，集中导出如 `resetTestDoubles()`、`withEnvSnapshot()` 纯函数）；env 备份还原封装为可复用 helper；不允许 4 个 spec 各抄一份相同重置代码。单 spec 专属逻辑不强行抽象；helper 只做通用复位，不硬编码本批夹具。
6. **不动断言期望与用例数量**：本单只补重置，不改任何 `expect(...)` 的期望值、不合并 / 删除用例。
7. **`test/engine-core/i12-session-alliance-config.spec.ts`**：补统一 reset 钩子（mock 清计数 / 还原）；该文件在 core 测试目录，但属测试文件、非 `src/engine-core`；改动仅限钩子，不碰被测源码。
8. **good-state-diary 复核结论**：在交付记录写明旧台账所指 service spec 已不在权威 `pnpm test` 集合（仅 e2e 文件，已被排除），无需清理。

**不改**：`vitest.config.mts` 隔离配置；`test:fast`；被测 `src` 源码行为。

### 3.2 T-2 · ESLint 缓存失效定位与 key 统一

**复核点**：

1. 现状 `.eslintcache` 内容口径（ESLint flat config 默认缓存键构成：文件 mtime + 配置）；`projectService` 类型程序重建是否导致缓存键失真。
2. 触发失效的候选变量：eslint config 文件变更、tsconfig 变更、`projectService` 重建、多工作树 / 文件位置移动。
3. CI lint job 现状：无 ESLint cache 持久化，每次冷跑；本机 `.eslintcache` 跨运行复用。

**处置**：

1. **定位**：通过对照实验（改动 / 不改动 config 与 tsconfig，对比缓存命中前后 `pnpm lint` 墙钟与缓存文件变化）确定实际触发失效的变量；结论写入交付记录。
2. **key 口径**：本机与 CI 统一缓存键，纳入 eslint config 与 tsconfig 指纹（配置 / 配置引用的 tsconfig 变化即失效）；不把运行产物混入缓存键。
3. **CI 持久化（如实验证实收益成立）**：在 `lint-and-typecheck` job 加独立 `actions/cache`，路径与 key 不含 `node_modules` 本体；与既有 pnpm store、vitest transform 缓存步骤并列、不复用 key。若定位结论为「缓存失效源于本机环境抖动、CI 冷跑无可优化空间」，则**不加 CI 缓存步骤**，仅在交付记录写明结论与本机 key 口径。
4. **不放宽 / 不新增 lint 规则**；缓存位置若调整，写明理由；不把磁盘与安装耗时代价写进仓库 `.npmrc`（沿用 P-DEBT-10 口径）。

### 3.3 T-3 · oxlint 告警清理

**复核点**：

1. 改动前复跑 `pnpm lint:fast` 与 `pnpm lint:deep`，记录 warning / error 总数、逐条文件:行:规则。
2. 每条告警区分：`eslint/*`（可选链 / 类方法等）、`oxc/*`（恒等运算）、`typescript/*`（spread 实例、base-to-string 等）。

**处置（逐条定性，三选一）**：

1. **真问题 → 最小代码修正**：如 `0.4 * 0` 恒等零项直接化简表达式；不安全可选链改为先判空再取值；spread 类实例改为显式字段拷贝。修正不得改变运行时行为与类型契约。
2. **误报 → 规则层豁免**：确认为误报的，优先在 `eslint.config.mjs` 对应文件 / 目录段关闭该规则（带注释说明理由与对应告警编号）；规则层不适合的，用局部 `// eslint-disable-next-line <rule>`（oxlint 对应 `// eslint-disable-next-line` 兼容注释或 oxlint 忽略语法，以 oxlint 1.93 支持为准）并写明理由。
3. **规则专项口径（按现场 57 条分布分类）**：
   - **`unbound-method`（约 16 条，测试侧）**：`Reflect.getMetadata(..., Controller.prototype.method)`、`Logger.prototype.error` spy 等只引用原型方法取元数据 / 挂 spy，不调用、不依赖 `this`，属路由元数据测试标准写法 = 误报；在 `eslint.config.mjs` test 段统一豁免该规则，不逐处局部 disable。
   - **`no-misused-spread`（约 27 条）**：逐处确认被 spread 对象是 DTO / row / 普通字段对象（刻意字段拷贝、不依赖原型方法）；确认属字段拷贝的走规则豁免或改显式字段列表。若发现被 spread 的是带方法且后续会调用方法的类实例，归另案登记，不在本单重构 DTO / entity 层。
   - **`no-base-to-string`（约 10 条）**：抽共享安全字符串纯函数（归 `src/shared/infra/` 现有工具目录），签名形如 `safeString(value: unknown, fallback?: string): string`（string 直返、number / boolean 转字符串、其他对象走 `JSON.stringify` 或 fallback）；controller / service 多处调用统一走该工具，测试侧复用同一工具或等价 test helper，不在各处重复内联判断。
   - **e2e 3 条**（`await-thenable` ×2、`restrict-template-expressions` ×1）：最小写法修正（去多余 `await`、类型窄化），不改 e2e 断言口径；e2e 不在权威 `pnpm test` 集合，改动仅作卫生收敛。
4. **需要更大重构才能根治的**：不在本单硬改；保留告警并在交付记录登记 backlog（如 barrel 瘦身、类型收窄），归 P-DEBT-6 另案。
5. **src 与 test 分开记账**：交付记录分别列 src 修正条目数、test 写法修正条目数、规则豁免条目数、局部 disable 条目数、新增共享工具条目数；改动文件清单区分新增 / 修改。
6. 测试文件中的浮点比较 / 类型不安全写法已在 `eslint.config.mjs` 测试段放宽，本单不重复放宽。

### 3.4 T-4 · git 依赖 spec 环境前置

**复核点**：`wp-h-wave2-3-batch-observability.spec.ts` 三处 `execFileSync('git', ...)` 的用途（L177 `init -q`、L180 `add .`、L182 commit）与所在 `it`/`beforeEach` 位置。

**处置**：

1. spec 顶部探测 git 可用性：优先读 `GIT_BIN` 环境变量，未设置时回退 `'git'`；不可用（`spawnSync` 失败 / 非可执行）时对相关用例 `ctx.skip()`（vitest 跳过）并在交付记录写明跳过条件。探测与路径解析抽为可复用 helper（与 §3.1 共享测试工具同目录），后续其他依赖外部命令的 spec 可复用。
2. 三处调用统一走解析后的 git 可执行路径；git 可用时断言与现状逐字一致。
3. 不修改该 spec 的业务断言与批次观测口径。

### 3.5 静态自检

1. 改后 `pnpm lint:fast` / `pnpm lint:deep` 复跑：error 保持 0；warning 数相对基线下降，剩余条目逐条有定性记录。
2. `pnpm lint`（ESLint type-aware，权威）保持 0 error / 0 warning。
3. 核对 `ci.yml` 若改动：每个 `run:` 脚本名在 `package.json` scripts 存在；YAML 键 / 缩进合法；job 依赖、env、service 未误删；未引入对 `admin-dashboard/` 或 Flutter 的引用。

---

## 4. 红线（违反即返工）

1. **engine-core 零 diff**：`git diff --stat HEAD -- src/engine-core` 为空；`boundary.spec.ts` 禁止动。`test/engine-core/` 仅允许 `wp3-trajectory.spec.ts` 两处恒等零项化简。
2. **不改业务行为**：T-3 的 src 修正仅限告警消除；不改装配、映射、resolver、module 注册、阈值、枚举、口径真相源；消费端不另抄判定口径。
3. **不改测试期望**：T-1 / T-3 / T-4 均不改 `expect(...)` 期望值、不增减用例；全量用例数与基准一致（3252 例 / 194 文件，e2e 除外）。
4. **隔离语义冻结**：不动 `vitest.config.mts` 的 `isolate`、不碰 `vitest.fast.config.mts`、不做 projects 分层、不加分片矩阵。
5. **配置纪律**：不新增第三方依赖；不改 `package.json` scripts / 依赖、`Dockerfile`、tsconfig；eslint 规则豁免必须带理由注释；不删断言、不注释报错行消错。
6. **共享工具标准**：新增 helper / 工具函数必须纯函数、无副作用、可独立复用；不在工具内硬编码本批 spec 专属夹具或业务阈值；导出集中、命名与 `src/shared/` 既有风格一致；不借工具改动既有服务类与装配。
7. **命令规范**：本地复核一律 pnpm，禁止裸 npx；跑闸门前确认无长驻 dev 进程；先 `pnpm doctor:fs`；Windows 本机 git 在 `D:\Apps\Git\cmd`，T-4 之外若遇 git ENOENT 先补 PATH 再判定。
8. **既有债与新增分开**：交付记录写清本单改动文件清单；core / Phase3 / Phase4 / 分片 / 结构减重遗留不混入本单；复核中发现新缺陷另开 backlog 登记。
9. **事实纪律**：本机跑不了 GitHub CI，交付记录不得写「CI 已通过」；CI 侧结果留待主控 push 后在 Actions 复核。

---

## 5. 闸门（真实命令 / exit code / 数字写进交付记录）

| #   | 命令                                                                    | 通过标准                                                                                                                        |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` | **0 error、exit 0**                                                                                                             |
| 2   | `pnpm exec tsc -p tsconfig.build.json --noEmit`                         | 保持 0 error（生产口径不退化）                                                                                                  |
| 3   | `pnpm lint`（ESLint type-aware，权威）                                  | 0 error / 0 warning                                                                                                             |
| 4   | `pnpm lint:fast`（oxlint）                                              | 0 error；warning 数相对 §1.2 基线（4）下降，剩余逐条定性                                                                        |
| 5   | `pnpm lint:deep`（oxlint type-aware）                                   | 0 error；warning 数相对基线（57）下降，src / test 分布逐条记录                                                                  |
| 6   | `pnpm exec vitest run test/engine-core`                                 | boundary 12 例全绿（形式核对）                                                                                                  |
| 7   | 收尾 `pnpm test` 一次（仅交付前；`pnpm test:fast` 冒烟不作证据）        | 0 failed；记录测试文件数 / 用例数 / skipped / 墙钟与机器状态（Node 版本、长驻进程、盘读取状态），数字可复现；用例总数与基准一致 |
| 8   | `git diff --stat HEAD -- src/engine-core`                               | 为空                                                                                                                            |
| 9   | `git diff --name-only HEAD`                                             | 逐条对照 §2 范围；无越界 src（除 T-3 告警点）、无 admin-dashboard / Flutter、无并行产物                                         |

**既有基准（HEAD `4424092`，TD-8 回执口径）**：根 tsc 0 error、build tsc 0 error、ESLint 0 error / 0 warning、boundary 12 绿；oxlint fast 4 warning / deep 57 warning；全量 **3248 passed + 4 skipped（3252 例，194 文件）**。改动前先复跑 §1.2 对应命令核对基线，改动后复跑对比；机器状态（Node 版本、长驻进程、盘读取）须在交付记录闸门表注明。

---

## 6. 交付物与固定路径

1. 交付记录：`docs/worklog/completed/phase2.5/td9-test-isolation-and-lint-hygiene-implementation-2026-11-13.md`，含：
   - T-1：4 文件残留定性表（残留类型 / 复位方式 / 钩子位置）；共享 reset / env 快照 helper 清单与复用点；good-state-diary 复核结论；未改断言与用例数量的声明；
   - T-2：缓存失效触发变量定位结论；本机 / CI key 口径；CI 是否加缓存步骤及理由；
   - T-3：告警逐条定性表（文件:行:规则 / 真问题修正 / 规则豁免 / 局部 disable / 另案 backlog）；src 与 test 分项计数；`safeString` 等新增共享工具及其复用点；
   - T-4：git 探测 / skip / `GIT_BIN` 注入实现与跳过条件；探测 helper 复用点；
   - 改动文件清单（新建 / 修改 / 删除，逐个一句用途）；
   - 闸门表：实际命令、exit code、error / warning 数、测试文件 / 用例数、墙钟与机器状态；改动前后 oxlint warning 对比；
   - 风险与回归：哪些既有测试被改、为什么；确认未碰 engine-core / schema / 内容 / 状态字段；
   - 遗留项：P-DEBT-5 分片、P-DEBT-6 结构减重、D-a 双锁、D-b 覆盖率采集、audit registry 容错、需更大重构的告警条目。
2. 任务单归档：验收通过后本单从 `pending/` 移到 `completed/phase2.5/`，顶部状态行改 ✅ 并链接交付记录。
3. 索引回写：
   - `phase2.5-wp-list-2026-11-08.md` §四 TD-9 行（待开工 → 完成态 + 交付记录链接，3 列形态）；
   - `phase2.5-README.md` §3.0 工具链段同步完成态；
   - 工具链清单 `phase2.5-toolchain-tech-debt-2026-11-11.md` 与闸门性能文档 §9：P-DEBT-1 / 2 / 3 / 9 标注处置结论；未闭环条目（分片 / 结构减重等）保留原状态。
4. commit 草稿（一个提交一个意图；不跳过 `--no-verify`）：
   - `refactor(test): TD-9 清理 spec 间 mock/env/单例残留 · 补统一重置钩子（隔离语义不变）`
   - `chore(lint): TD-9 清零 oxlint 告警 · 统一 ESLint 缓存口径 · git 依赖 spec 环境前置`
   - `docs(worklog): TD-9 任务单 / 交付记录与索引回写`

---

## 7. DoD 核对清单

- [x] T-1：4 文件残留逐条定性并复位；env 备份还原；mock / stub 状态钩子齐全；断言期望与用例数量未变
- [x] T-2：缓存失效变量已定位；本机 / CI key 口径统一（或写明 CI 无可优化结论）；未放宽 lint 规则
- [x] T-3：fast 4 条清零；deep 告警逐条定性并记账；误报豁免带理由；无业务行为 / 契约变化
- [x] T-4：git 不可用时 skip 或 `GIT_BIN` 注入；git 可用时断言不变
- [x] 共享工具：重复逻辑已抽 helper / 纯函数并集中导出；工具无副作用、无专属夹具 / 业务阈值；未借工具改动既有服务类、DTO / entity 层与装配
- [x] 根 tsc 0 error；build tsc 0 error；ESLint 0/0；oxlint 0 error、warning 下降且剩余有条目记录；boundary 12 绿；`pnpm test` 全绿；engine-core diff 为空
- [x] `git diff --name-only HEAD` 仅含 §2 范围文件；无 admin-dashboard / Flutter；无并行产物混入
- [x] 交付记录、任务单归档、wp-list / README / 工具链清单 / 闸门性能索引一致，无断链；排除项与遗留已写明

---

## 附录 A · 锚点清单（主控扫描备查，行号现场复核）

| #    | 锚点                                                                                                                                                                                                                                                                                                                                                                 | 说明                |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| T-1  | `test/engine-adapters/wp65-deliberation-mutex-revision.spec.ts`（mock L90 / beforeEach L399 / restore L513）；`test/engine-adapters/wp67-deliberation-circuit-breaker.spec.ts`（mock L64 / beforeEach L201-208）；`test/engine-adapters/wp12-memory-closeout.spec.ts`（无钩子）；`test/engine-core/i12-session-alliance-config.spec.ts`（mock L21 / clear L100,110） | 残留审计与复位位置  |
| T-2  | `.eslintcache`；`eslint.config.mjs`（projectService / 规则段）；`ci.yml` `lint-and-typecheck` job；`package.json` `lint` / `lint:fix`                                                                                                                                                                                                                                | 缓存定位与 key 口径 |
| T-3  | `test/engine-adapters/wp68-deliberation-intention-lock.spec.ts:284`；`test/engine-adapters/wp64-deliberation-shadow.spec.ts:623`；`test/engine-core/wp3-trajectory.spec.ts:242,244`；`data/quality/td9-lintdeep.txt`（57 条文件:行备查）                                                                                                                             | 告警逐条定性        |
| T-4  | `test/auto-practice/wp-h-wave2-3-batch-observability.spec.ts:17,177,180,182`                                                                                                                                                                                                                                                                                         | git 环境前置        |
| 排除 | `src/engine-core/**`；`vitest.config.mts` 隔离段；`vitest.fast.config.mts`；P-DEBT-5 分片；P-DEBT-6 结构减重；Phase3 `phase3-disfluency-backlog-2026-11-13.md`；Phase4 `phase4-backlog-2026-11-08.md`                                                                                                                                                                | §2 排除项，本单不碰 |

## 附录 B · 既有基准数字（HEAD `4424092`）

- 根 tsc：0 error；build tsc：0 error；ESLint：0 error / 0 warning；oxlint fast：4 warning / 0 error；oxlint deep：57 warning / 0 error；boundary：12 绿；全量：3248 passed + 4 skipped（3252 例，194 文件）。
- 闸门命令与复跑方式见 §5；机器状态（Node 版本、长驻进程、盘读取）须在交付记录闸门表注明。
