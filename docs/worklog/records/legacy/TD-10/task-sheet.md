# TD-10 · 测试结构减重专项（集成 spec 收敛 · SDK 端口层 mock · barrel 瘦身）

> 状态：✅ **已交付**（2026-11-13，MiniMax Code）→ [交付记录](td10-test-structure-debt-reduction-implementation-2026-11-13.md)
> 执行方：MiniMax Code（主控派单 · 纯测试结构重构，不依赖批次样本 / 临床拍板 / 外部资质 / core 改动）
> 仓库：E:\Work\Project\backend\mofang-nestjs，分支 `integrate`，上游 `origin/integrate`
> 唯一事实源：[闸门性能 remediation](../../../team/gate-performance-remediation-2026-11-11.md) §3.2 L5（测试结构减重）+ §9 P-DEBT-6 + 主控 2026-11-13 HEAD `997c6f9` 现场复核（扫描备查 `data/quality/td10-*.txt`，gitignore 不入库）
> 任务性质：既有测试结构债重构（只调整测试组织与 mock 位置）；**不改变生产业务行为、不改测试期望数值、不增减用例**；改动落在 `test/`，复用替身 / helper 放 `test/helpers/`；`src/` 生产代码零改动。
> 上一单：[TD-9 交付记录](td9-test-isolation-and-lint-hygiene-implementation-2026-11-13.md)（隔离残留 + lint 卫生 + 缓存口径已闭环，HEAD `997c6f9`）。

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `E:\Work\Project\backend\mofang-nestjs\AGENTS.md` —— 仓库入口与 engine-core 红线
2. `E:\Work\Project\backend\mofang-nestjs\docs\team\conventions.md` —— 代码红线、16 条硬约束、交付格式（§命令边界：`packageManager=pnpm`，禁止裸 npx）
3. `E:\Work\Project\backend\mofang-nestjs\docs\team\wp-task-template.md` —— 任务单结构与交付回写清单
4. 阶段入口：`docs/worklog/pending/phase2.5-README.md` §3.0 工程工具链技术债 与 `phase2.5-wp-list-2026-11-08.md` §四 TD 行
5. 本单事实源：闸门性能文档 §3.2 L5 三条方向与边界、§9 P-DEBT-6；`test/helpers/`（TD-9 产物：`isolation.ts` / `git-probe.ts` / `index.ts`）；`vitest.config.mts`、`vitest.fast.config.mts`、`package.json` scripts
6. 本任务单（你在读的这份）

---

## 1. 背景（方向别错）

### 1.1 来源

闸门性能 remediation §1 实测：全量 vitest 耗时构成 **import 74% / tests 14% / transform 10% / worker 1%**。每个 spec 独立 fork 重载整张 NestJS DI + langchain + typeorm + qdrant 依赖图，是 import 占比高的结构性根因。TD-9 已清掉 spec 间 mock/env/单例残留与 lint 告警；本单承接 L5（P-DEBT-6），做**测试结构层面**的减重：把重型依赖图挡在单元 spec 的 import 阶段之外。

L5 台账边界（§3.2 原文口径）：**只调整测试组织与 mock 位置，不改业务行为、不动 engine-core 分层归属。**

### 1.2 主控现场复核基线（2026-11-13，HEAD `997c6f9`；行号 / 文件数以现场 Grep 为准，可能漂移）

| 项                                                                                                                       | 实测基线                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| spec 总数                                                                                                                | **189**（非 e2e **183** + e2e **6**）                                                                                                                                                             |
| 非 e2e 集成 spec（起 `TestingModule` / `NestFactory`）                                                                   | **4**：`test/base/auth-reset-password.spec.ts`、`test/counselor/wp21-report-sse-endpoint.spec.ts`、`test/user/set-password-first-set.spec.ts`、`test/voice/wp22-voice-concurrency-budget.spec.ts` |
| 重型依赖 token 命中（spec 文本计数，**含替身类名 / 字符串字面量**，执行方须区分"import 阶段真实加载"与"运行时注入替身"） | typeorm 42、redis 39、minimax 25、qdrant 16、openai 9、bullmq 8、langchain 5、axios 3、ioredis 2                                                                                                  |
| 使用 `vi.mock(` 的 spec                                                                                                  | 仅 **7** 个                                                                                                                                                                                       |
| spec 规模（非 e2e，行数 top）                                                                                            | 最大 817（`admin-debug/deliberation-stats.spec.ts`）；15 个 spec > 575 行                                                                                                                         |
| src barrel                                                                                                               | **48** 个 `index.ts`；`src/engine-core/index.ts` 229 行（内核唯一公开 barrel）                                                                                                                    |
| 既有 `test/helpers/`                                                                                                     | `isolation.ts`、`git-probe.ts`、`index.ts`（TD-9 产物，纯函数 / 无模块级可变状态）                                                                                                                |

### 1.3 改动面预判（执行时以实际 diff 为准）

- **`src/engine-core/**`：0 改动**（diff 必须为空）；`boundary.spec.ts` 不动。
- **`src/` 生产代码：0 改动**。本单是测试结构重构；若发现测试无法在端口层 mock 而必须拉真实 SDK（即 src 侧缺端口 / 接口），**登记另案**，不在本单补 src 业务逻辑、不加端口、不加 module 装配注册。
- **`test/`**：T-1 集成 spec 收窄 / 场景聚焦；T-2 SDK 在端口 / 适配层 mock；T-3 spec import 从 barrel 改深路径拆分；跨 spec 复用的替身 / 工厂抽进 `test/helpers/`。
- **配置**：不改 `vitest.config.mts` / `vitest.fast.config.mts`、不改 `package.json` scripts 与依赖、不新增第三方依赖、不改 tsconfig、不改 Dockerfile / CI workflow。
- **docs**：交付记录、任务单归档、wp-list §四 与 README §3.0 索引回写；闸门性能 §9 P-DEBT-6 行标注处置结论。

---

## 2. 范围（严格遵守，不越权）

**在范围内：**

- **T-1 · 集成 spec 收敛审计**：逐一定性上述 4 个非 e2e 集成 spec —— 哪些断言真的需要全量 Nest 模块装配，哪些可以收窄为端口级替身 / 单服务实例；确需保留全模块装配的，聚焦为最小必要场景。每个文件在交付记录写明：原形态 → 收窄后形态 → 保留全模块装配的理由。e2e 6 个 spec 本就是集成形态，**不在本单收窄**。
- **T-2 · SDK 端口层 mock**：审计单元 spec 中重型 SDK（langchain / qdrant / redis / bullmq / openai / minimax 等）的引用方式；**import 阶段真实加载**真实 SDK 的，在端口 / 适配层 mock 掉，缩小该文件 import 加载图；**运行时才注入替身**（构造参数传 fake / stub）的文件不动。重复出现的 SDK 替身 / 工厂抽进 `test/helpers/` 复用，不各抄一份。
- **T-3 · barrel 瘦身**：spec 中从目录 barrel（`*/index`）或引擎根 barrel 整树导入的，按实际用到的模块改深路径拆分 import，避免 barrel 把整棵模块树拉进单个 spec。**src 侧 barrel 只观察、不删既有导出、不扩新出口**（删 barrel 导出会波及生产消费方，不在测试重构范围）。
- **复用件纪律**：`test/helpers/` 内工具为纯函数 / 无状态替身工厂；不持有模块级可变状态；不 import NestJS 容器、不做 module 装配注册；不硬编码本批夹具或业务阈值。
- **审计台账**：交付记录内给逐 spec 定性表（集成 / 单元、import 加载图定性、处置动作、改前 / 改后加载图对比），作为后续结构演进的基线。
- docs 回写：交付记录、任务单归档、wp-list §四 与 README §3.0；闸门性能 §9 P-DEBT-6 行回填结论。

**明确不在范围内（禁止顺手做）：**

- **core 结构债一律不碰**：`src/engine-core/**` diff 必须为空；`boundary.spec.ts` 禁止动。I-01~I-24 的批次复验、幅度标定、结构改造、门槛 / 阈值拍板均不在本单。
- **隔离语义不动**：不改 `vitest.config.mts` 的 `test.isolate`、不改 `vitest.fast.config.mts`、不把 `test:fast` 提升为权威闸门、不做 `projects` 分层隔离改造。
- **P-DEBT-5 分片（shard 矩阵）不做**：会改变测试执行拓扑与跨分片顺序依赖，需独立评估；CI 不加分片矩阵。
- **决策项另案**：`package-lock.json` 双锁去留、coverage 采集与阈值门禁、audit registry 容错开关 —— 均待主控拍板，本单不实现、不替决。
- **生产 src 业务逻辑不动**：不改服务类 / DTO / entity / resolver / module 装配 / 映射函数；测试缺端口时只登记另案。
- **Phase3 台账不碰**：L-2~L-6 / P1-N1/N2（待批次）、P1-N3~N7（待拍板）、L-7 / L-8 / L-9（P2/P3）。
- **Phase4 五条不碰**：WP27 / WP29 / WP33 / WP39 / WP40 卡外部商户号 / 档位定稿 / 留存年限 / 真机校准。
- **断言与用例冻结**：不改任何 `expect` 期望值、不新增 / 删除测试用例、不改 mock 语义；测试形态（纯静态投影 / 单元 / 集成 / 黄金样本）不变。

---

## 3. 目标架构 / 交付物

> 设计原则固定四条：单一真相源 / 内容与逻辑分离 / 出错当场炸不进库 / 幂等。本单无指标阈值类口径，不涉及新真相源；测试口径以既有断言为准。

- **交付物 1 · 逐 spec 结构审计表**（交付记录 §三）：逐文件列 形态（集成 / 单元）、import 加载图定性、重型 SDK 引用方式（真实 import / 替身注入）、处置动作、改前 / 改后对比；无法收窄 / 无法 mock 的项写明阻塞原因与另案建议。
- **交付物 2 · 瘦身后的 spec import 结构**：T-1 收窄后的集成 spec；T-2 端口层 mock 的单元 spec；T-3 深路径拆分 import 的 spec；复用替身 / 工厂落在 `test/helpers/`（既有 `isolation.ts` / `git-probe.ts` 旁扩展，集中经 `test/helpers/index.ts` 出口）。
- **交付物 3 · 测试**：覆盖路径与基线一致；不新增 / 删减用例；闸门全绿，用例总数与基线逐字一致（基线 **3248 passed + 4 skipped（3252 例，194 文件）**，HEAD `997c6f9` 实测）。

### 3.1 减重收益度量口径（避免误判）

- 本单收益以**结构定性**为准：哪些重型 SDK 不再在 spec 的 import 阶段被加载、哪些集成 spec 不再拉起全量 Nest 模块；交付记录抽代表性 spec 写改前 / 改后加载图对比。
- **不强制墙钟指标**：全量 vitest 墙钟受机器并行进程、盘读延迟、worker 核数影响（闸门性能 §1.5 已记录同一份代码 80 s ↔ 1100 s 的波动）；墙钟只记录实测值与机器状态，不作为本单验收硬指标。

---

## 4. 红线（违反即返工）

- **分层归属**：纯决策计算 / 纯出口字段 / 纯类型该进 `engine-core/` 就进；`engine-core/` 内禁止任何 NestJS / IO / 网络 / prompt / 模型名 / 心理原文 console；`boundary.spec.ts` 是机器护栏，不许自己改。本单结论：core 零改动。
- **生产行为零变化**：本单只动测试组织与 mock 位置；不改任何运行时代码路径、装配链、阈值、口径。
- **断言 / 用例冻结**：不改 `expect` 期望、不增减用例、不改 mock 语义；重构后同一 spec 的测试形态与覆盖意图保持不变。
- **复用件无副作用**：`test/helpers/` 不持模块级可变状态、不进装配、不 import 生产容器；跨 spec 替身统一从 helper 出口取，不复制粘贴。
- 心理对话原文禁止进日志 / console / crash report（只出码和计数）。
- 不新增第三方依赖；不改 schema / migration / 映射函数；不越权加需求外功能。
- 不自动 git commit / push（写完给 commit 草稿，等用户指令）。

---

## 5. 闸门（分层执行，填真实数字，禁止留空）

### 5.0 命令规范（强制，禁止裸 npx）

- 一律 pnpm：跑脚本 `pnpm <script>`，跑二进制 `pnpm exec <bin> <args>`；禁止裸 `npx`。
- 跑闸门前确认机器干净：无 `nest start --watch` / 后台 `vite dev` / `dist/app` 长驻进程。
- 跑闸门前 `pnpm doctor:fs` 确认盘读延迟合格（均值 < 1 ms/文件、慢文件 < 5%）。
- 取证会话先补 PATH：本机 git 在 `D:\Apps\Git\cmd`；依赖外部命令的 spec 不补齐 PATH 不报回归。

### 5.1 日常内循环（高频，定向）

| 目的                    | 命令                                                      |
| ----------------------- | --------------------------------------------------------- |
| 语法 / 明显缺陷（全仓） | `pnpm lint:fast`                                          |
| 类型感知快速一遍        | `pnpm lint:deep`                                          |
| 类型（增量缓存）        | `pnpm typecheck`                                          |
| 单个测试文件            | `pnpm exec vitest run <file.spec.ts>`                     |
| 受影响测试              | `pnpm test:changed` / `pnpm test:related -- <src/xxx.ts>` |

### 5.2 收尾全量闸门（交付前后台跑一次，记录机器状态）

| 闸门         | 命令                                                                    | 要求                                                                                       |
| ------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 根类型       | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` | 0 error                                                                                    |
| 构建类型     | `pnpm exec tsc -p tsconfig.build.json --noEmit`                         | 0 error                                                                                    |
| Lint（权威） | `pnpm lint`                                                             | 0 error，记 warning 数                                                                     |
| oxlint       | `pnpm lint:fast` / `pnpm lint:deep`                                     | 0 warning / 0 error                                                                        |
| 测试         | `pnpm test`                                                             | 全绿；记用例总数 / 文件数 / 墙钟与机器状态（是否干净、盘读延迟）；用例数与基线 3252 例一致 |
| engine-core  | `git diff --stat HEAD -- src/engine-core`                               | 空                                                                                         |
| 边界         | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                | 12 passed                                                                                  |

### 5.3 验收闸门（回收方：定向 + 范围核对，不重跑全量）

1. 相关测试：`pnpm test:related` / `pnpm test:changed` 覆盖改动面；
2. 关键路径抽跑：1–2 条重构后 spec 单文件复现，核对用例数与断言；
3. 触碰文件快速复查：`pnpm lint:fast` + `pnpm typecheck`；
4. 边界核对：`git diff --stat HEAD -- src/engine-core` 为空；
5. 范围核对：`git diff --name-only HEAD` 对照 §2 授权范围，确认无生产 src 改动、无并行产物混入。

---

## 6. 交付记录（完成后写到固定路径）

`docs/worklog/completed/phase2.5/td10-test-structure-debt-reduction-implementation-2026-11-13.md`

内容必须含：

1. 本单做了什么（一句话总结）；
2. 方案设计：实际实现 vs 任务单方案，有偏差写清原方案 / 实际方案 / 理由（conventions §2.5）；
3. 改动文件清单（新建 / 修改 / 删除，逐个一句用途）；
4. §3.1 要求的逐 spec 结构审计表（形态 / 加载图 / 处置 / 改前改后对比）；
5. 闸门表：命令 / exit code / 真实数字（error、warning、用例数、文件数、墙钟、机器状态）；
6. 风险与回归：哪些既有 spec 被重构、为什么；确认未碰 engine-core / schema / 生产 src / 断言期望；
7. 遗留项与另案登记（无法收窄的集成 spec、src 侧缺端口项、待拍板决策项）。

---

## 7. 【交付回写清单】做完逐项勾选（不许跳）

- [x] 交付记录已写到 §6 固定路径
- [x] 本任务单从 `pending/` 移到 `completed/phase2.5/`，顶部状态行改成 ✅ 并链接交付记录
- [x] 回写 WP 登记表：`phase2.5-wp-list-2026-11-08.md` §四 TD-10 行状态改完成、补交付记录链接
- [x] 回写阶段入口：`phase2.5-README.md` §3.0 TD-10 行改完成
- [x] 回写 backlog：闸门性能 §9 P-DEBT-6 行回填处置结论
- [x] `git diff --stat HEAD -- src/engine-core` 为空；生产 `src/` 非 spec 零改动
- [x] 提交分组已核对：本单文件与并行进程产物分开；若授权代提交，stage 只含本单文件
- [x] 给一行 commit message 草稿（**不自己 commit/push**，等用户指令）

---

## 8. 回复输出约定

完成后在对话里：

1. 说一句"已写入交付记录"并附文件路径，不重复贴全文；
2. 报告闸门真实数字（tsc / eslint / oxlint / vitest）；
3. 报告 §7 回写清单哪几项已做、有没有遗留；
4. 不贴代码 diff 全文，让用户自己 `git diff`。

【回复输出约定】完整回复内容原样写入：
`E:\Work\Project\backend\mofang-nestjs\docs\worklog\pending\relay-response-20261113-HHMM.md`（HHMM 用实际完成时间，24 小时制）；写完在对话说一句"已写入文件"即可。
