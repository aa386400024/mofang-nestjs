# TD-14 · entity 装饰器运行时依赖消除 · 只读方案评估（P-DEBT-11 / 另案 H）

> 状态：✅ **已交付**（2026-11-14，MiniMax Code）→ [交付记录](td14-entity-typeorm-decoupling-assessment-implementation-2026-11-14.md) · [评估备忘](../../../architecture/entity-typeorm-decoupling-assessment-2026-11-14.md)
> 仓库：E:\Work\Project\backend\mofang-nestjs，分支 integrate
> 唯一事实源：`docs/team/gate-performance-remediation-2026-11-11.md` §9 **P-DEBT-11**（L-1）+ `docs/worklog/completed/phase2.5/td13-repository-port-analytics-pilot-implementation-2026-11-14.md` §5.4（实测边界）与 §七（另案 G–J）
> 任务性质：**只读方案评估** —— 产出选型备忘 + 影响面清单 + 可行性结论；**零 src / 零 spec / 零 migration 改动**，不出实现代码、不做试点改造
> 改动范围：仅新增评估备忘文档 + 本任务文档与索引回写；不碰 `src/`、`test/`、`bin/`、`src/migration/`、`engine-core/`、配置与 CI、前端

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `E:\Work\Project\backend\mofang-nestjs\README.md` —— 仓库总览
2. `E:\Work\Project\backend\mofang-nestjs\docs\README.md` —— 文档导航
3. `E:\Work\Project\backend\mofang-nestjs\docs\team\conventions.md` —— 代码红线 + 交付格式（§1.1 engine-core 分层、§1.3 pnpm 命令规范、§三 16 条硬约束、§2.5 偏差登记）
4. 阶段工作入口：`docs/worklog/pending/phase2.5-README.md` 与 `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md`
5. 根因定位与既往结论：
   - `docs/worklog/completed/phase2.5/td11-ci-tooling-and-typeorm-type-import-implementation-2026-11-14.md`（L-1a：type-only 收窄实测收益为 0）
   - `docs/worklog/completed/phase2.5/td13-repository-port-analytics-pilot-implementation-2026-11-14.md` §5.4（entity 装饰器为传递闭包根因）、§七（另案 G–J）
   - `docs/adr/0003-typeorm-migration-replace-synchronize.md`（手写 DDL、禁用 synchronize 的既有纪律）
6. 本任务单（就是你在读的这份）

---

## 1. 背景（先读，方向别错）

P-DEBT-11 / L-1：仓内 entity 文件在模块加载期由 TypeORM 装饰器求值（`@Entity` / `@Column` / 关系装饰器等），把 `typeorm` 运行时拉进模块传递闭包。TD-11（L-1a）把 **48** 个文件的 `Repository` 值导入收窄为 `import type`，实测 import 加载图**逐字相同**（本地模块 / 包引用 / 触达重型 SDK 的 spec 差异均为 0）；TD-13（L-1b · analytics 域端口试点）把两个 service 的 typeorm **直接**导入边归零，但枚举 `AnalyticsEventType` 仍定义在 entity 文件 —— service 只要值导入该枚举，entity 文件即被加载，顶层装饰器随之求值，typeorm 仍经**传递**闭包进入。

**本单要回答的核心问题**：在不推翻既有手写 DDL 纪律、不重跑建表流程的前提下，存在哪些可解除该传递闭包的路径（纯类 + 外置 schema 映射为候选之一）；每条路径的改动面、收益、风险、与既有纪律的兼容性；TypeORM 1.1.2 版本对各路径的实际支撑边界；以及推荐路径与分期路线。**结论用于为另案 G（其余 service 端口化推广）的收益口径定调** —— G 的加载图收益天花板取决于本评估结论，本单不落地任何改造。

### 关键现状（主控已核对，作为取证锚点；备忘需复核并登记偏差）

- **规模与装饰器分布**（HEAD `20bbf53`，`src/` 下 `@Entity(` 文件）：
  - **102** 个 entity 文件；装饰器计数：`@Column` **858**、`@Index` **188**、`@Entity` **102**、`@CreateDateColumn` **90**、`@PrimaryGeneratedColumn` **84**、`@UpdateDateColumn` **67**、`@PrimaryColumn` **21**、`@JoinColumn` **14**、`@ManyToOne` **9**、`@OneToOne` **6**、`@OneToMany` **3**、`@DeleteDateColumn` **2**。
  - 带关系字段的 entity **18** 个（关系装饰器合计 32 处）；其余 84 个为扁平字段表。
  - 域分布 Top：counselor **25**、profile **10**、companion **10**、inner_world **7**、engine-adapters **5**、practice **5**、home **5**、user **5**、ai-engine **5**、auto-practice **4**、knowledge-base **4**、life-map **4**；其余 embodied / entity / agent / emergency / quality / good_state_diary / analytics / migration / ai-companion / consent 各 1–2。
- **注册链**：
  - 运行时：65 个 `*.module.ts` 文件、**77** 处 `TypeOrmModule.forFeature([Entity])` 显式注册业务 entity。
  - CLI / DataSource：`bin/ormconfig.ts` 构造 `DataSource`，`entities: [path.join(__dirname, '../src/entity/**/*.{js,ts}')]` glob；`migrations` 为显式数组（`src/migration/` 下 **87** 个 migration 文件）。
  - `src/entity/` 目录下仅 typeorm-model-generator 示例产物 2 个（`sampledb1/sampletable1`、`sampledb2/sampletable2`）；真实业务 entity 全部位于各域 `entities/` 子目录，运行时注册以 module `forFeature` 为准。
  - `bin/entity.ts` 为 `typeorm-model-generator` 反向生成工具（DB → 装饰器 entity）。
- **migration 与建表纪律**：全部手写 DDL；`synchronize: false`（ADR-0003 禁用自动同步）。**装饰器元数据不参与建表**，只服务运行时 ORM 映射（查询 / 写入 / 关系解析）。
- **引用分布**（`entities?/` 路径段命中，按所在区域归类；备忘需进一步区分值位置 vs 类型 / 枚举位置）：service **98**、src-other **67**、test **20**、entity-self **16**、controller **6**、dto **5**、types **2**。20 个 test 文件直接引用 entity（含共享 `test/helpers/user-stub.ts`；其中 `test/analytics/td13-analytics-repository-port.spec.ts` 为 TD-13 端口替身，仅 `import type`）。
- **依赖版本**：`typeorm` **1.1.2**（package.json 声明 `^1.1.1`）、`@nestjs/typeorm` `^12.0.2`；安装版本 `node_modules/typeorm/entity-schema/` 目录存在、`EntitySchema` 在 `index.d.ts` 导出（备忘需核实其在当前版本的完整能力面，而非仅存在性）。
- **仓内纯类先例**：`src/engine-core/domain/` 纯类型 + `src/engine-core/in-memory/` 内存模型；`src/agent/supervisor/` Row 类型 + 仓储 `toRow` 转换；`src/shared/types/` 共享纯类型。
- **基线闸门**（HEAD `20bbf53`，TD-13 交付后）：全量 **3259 passed + 4 skipped（3263 例 / 195 文件）**；lint 0 error / 1 warning（`test/e2e/v2-user-flow.spec.ts:1` 既有 unused eslint-disable，范围外不修）；lint:fast / deep 0 / 0；boundary **12 passed**；根 tsc / build tsc 0 error。

---

## 2. 范围（严格遵守，不越权）

### 在范围内

1. **新增评估备忘** `docs/architecture/entity-typeorm-decoupling-assessment-2026-11-14.md`，章节与结论要求见 §3。
2. **只读取证与分类**（在备忘中给出证据与文件清单，不修改任何源文件）：
   - 102 个 entity 按域、关系面（18 关系 / 84 扁平）、被引用位置分层；
   - 20 个 test 文件逐个定性：值位置引用 entity 类 / 仅类型位置 / 仅枚举位置；98 个 service 引用同类定性（值位置 vs `import type` / 枚举）；
   - 枚举、自定义类型、relation join 条件等"装饰器之外仍需被业务层引用"的符号，在 entity 文件中的分布清单。
3. **候选路径对比评估**（§3.2 四条路径逐条），每条给改动面、收益、风险、纪律兼容、成本量级。
4. **TypeORM 1.1.2 可行性核查**：基于安装版本类型定义（`node_modules/typeorm/`，只读）核实外置 schema 注册、关系映射、复合索引、生命周期列（`@CreateDateColumn` / `@UpdateDateColumn` / `@DeleteDateColumn`）、CLI（`schema:sync` / `migration:generate` / `bin/entity.ts` 生成器）对无装饰器实体的支撑情况；版本能力以仓内安装版本为准，不引未核实的上游版本口径。
5. **推荐结论与分期路线**：首选路径 + 理由；不推荐路径及原因；若推进试点，试点域选择标准（关系面少、扁平表、无跨模块仓储消费优先）与批次顺序建议；若结论为"解耦代价过高 / 不可行"，明确退回口径（维持 TD-13 式契约端口化，不承诺加载图收益）。
6. **文档与索引回写**（§7 清单）：交付记录、任务单归档、wp-list / README / 台账索引改待执行完成态并链备忘与交付记录。

### 明确不在范围内（禁止顺手做）

- **不写实现代码**：不新增 / 修改任何 `src/`、`test/`、`bin/`、`src/migration/` 文件；备忘中的代码示例仅限 API 形态示意，不落源码树。
- **不做试点改造**：本单不挑域落地纯类 / EntitySchema / Row 分层映射；试点是另案实现单的事。
- **不推广另案 G**：其余 117 个 service 端口化分批推广不在本单；备忘只给"评估结论对 G 排期与收益口径的影响"建议。
- 不改表结构 / migration DDL / entity 字段 / DTO / controller 路由 / 枚举值；不改 `engine-core/`，`boundary.spec.ts` 不许改。
- 不新增第三方依赖；不改 `package.json`（scripts 与依赖）、tsconfig、`vitest.config.mts`、Dockerfile、`.nvmrc`、CI `.github/workflows/`。
- 不改既有 spec / 夹具 / helper 的断言期望与 mock 语义；不为其他模块补测试。
- 不碰 `admin-dashboard/` 与 Flutter；不自动 git commit / push（写完给 commit 草稿，等用户指令）。

### 另案登记（本单不做，写入交付记录遗留段）

- **G** 其余 service 仓储端口化分批推广（counselor 33 文件 / 63 处为最大域）—— 排期与收益口径以本单评估结论为准。
- **I** 端口内存实现是否补 —— 视调试 / 进程内替身需求评估。
- **J** 混合形态 typeorm import 文件统一形态 —— 可读性向，零运行时收益，另案批量处理。
- 评估中若发现新的结构债或既有纪律缺口，逐条登记 backlog，不在本单清理。

---

## 3. 目标交付物

### 交付物 1：评估备忘 `docs/architecture/entity-typeorm-decoupling-assessment-2026-11-14.md`

备忘必须含以下章节（可合并小节，结论不可缺）：

1. **现状事实与闭包根因**：复述 TD-11 / TD-13 实测结论；说明"import entity 文件（哪怕仅类型 / 枚举位置）→ 顶层装饰器加载期求值 → typeorm 进入传递闭包"的机制；引用 §1 锚点计数，复核偏差登记。
2. **候选路径对比**，至少覆盖四条：
   - **路径 A · 装饰器保留 + spec 侧隔离**：src 不动；spec 以 `vi.mock('typeorm')` / 端口替身 / 内存替身阻断测试闭包。评估：只解测试侧闭包、运行时 ORM 仍绑 typeorm；成本最低；对既有 entity 零冲击。
   - **路径 B · 纯类 domain model + 外置 schema**：entity 拆为纯类（字段 + 枚举，无装饰器）+ 独立 schema 定义（TypeORM `EntitySchema` / schema builder 形态）；`DataSource` 与 `forFeature` 注册 schema 而非装饰器类。评估：运行时装饰器求值解除；需核实关系映射、复合索引、生命周期列、CLI 工具链支持；改动面最大。
   - **路径 C · domain Row 纯类型 + 持久化 entity 分层映射**：业务层只依赖 Row 纯类型，entity 留在持久化层，`toRow` / `toEntity` 转换（supervisor 局部模式推广）。评估：entity 装饰器仍在，但业务层与 spec 的类型边界切断对 entity 文件的引用；渐进式；闭包解除程度介于 A、B 之间。
   - **路径 D · 维持现状**：接受传递闭包；只做契约端口化（另案 G），不追求加载图减重。评估：成本与收益基线。
   - 对比表维度：改动面（entity / service / repository / spec / module / ormconfig / CLI / migration）、运行时闭包是否解除、测试隔离改善、可测性、风险点、与既有纪律（engine-core 纯层、手写 DDL、`synchronize: false`、entity 纪律、隐私红线）兼容性、成本量级（小 / 中 / 大 + 文件数估算）。
3. **TypeORM 1.1.2 可行性核查**：逐条列 `EntitySchema` 注册、关系（`ManyToOne` / `OneToMany` / `OneToOne`）外置映射、复合 `@Index`、生命周期列、`@PrimaryColumn` / `@PrimaryGeneratedColumn` 在外置 schema 的对应 API；CLI（`migration:generate` / `schema:sync` / `bin/entity.ts`）对无装饰器实体的依赖现状；证据引 `node_modules/typeorm/` 类型定义路径或仓内先例；不确定项明确标注"需实现单验证"，不写确定结论。
4. **影响面清单**：102 entity 分层表（域 / 关系面 / 被引用次数 / 值或类型位置）；20 test 文件定性表；98 service 引用定性表；枚举与自定义类型拆分面。
5. **推荐结论**：首选路径 + 一句话理由；不推荐路径及原因；结论必须明确回答"传递闭包在该路径下是否真正解除"以及"对另案 G 收益口径的影响"。
6. **分期路线与试点标准**：若推荐 B / C，给试点域选择标准与批次顺序（扁平表、无关系、无跨模块仓储消费优先）；若退回 A / D，给 spec 隔离批量口径。
7. **风险与未决项**：TypeORM 版本升级绑定、关系字段后置迁移、migration / CLI 适配、与 G 的先后依赖、未决的实现细节清单。

### 交付物 2：交付记录（§6 固定路径）

含改动清单、闸门真实数字、备忘章节与 §3 要求对照、偏差登记（conventions §2.5）、遗留项。

> **口径真相源**：备忘中所有规模计数以仓内实测为准；若与 §1 主控锚点不一致，以实测为准并在交付记录 §二 偏差表写清原锚点 / 实测值 / 理由。评估结论只陈述可行性与成本量级，不替代未来实现单的设计决策。

---

## 4. 红线（违反即返工）

- **零源码改动**：`git diff --stat HEAD -- src/`、`git diff --stat HEAD -- test/`、`git diff --stat HEAD -- bin/`、`git diff --stat HEAD -- src/migration/` 必须为空；本单改动仅落在备忘、交付记录、任务单与索引文档。
- 分层归属：不触碰 engine-core；`git diff --stat HEAD -- src/engine-core` 为空，`boundary.spec.ts` 不改。
- 评估基于仓内事实与安装版本类型定义；禁止臆造 TypeORM API 能力、禁止引未核实的上游版本行为；不确定项标注"需实现单验证"。
- 备忘代码示例仅示意 API 形态，不得复制进源码树；不在备忘里定实现细节、不写试点改造步骤以外的改造方案。
- 心理对话原文禁止进文档 / 日志 / console / crash report（只出码和计数）。
- pnpm 命令规范：一律 `pnpm` / `pnpm exec`，禁止裸 `npx`。
- 不新增依赖；不越权加需求外功能；不自动 commit / push。

---

## 5. 闸门（只读口径，填真实数字，禁止留空）

### 5.0 前置（命令规范，强制）

- 跑闸门前确认机器干净：无 `nest start --watch` / `vite dev` / `node dist/app` 常驻；跑 `pnpm doctor:fs` 记录结果（读税体检）。
- 取证会话 PATH 先补 git：`D:\Apps\Git\cmd`（依赖外部命令的 spec 才不会假失败）。

### 5.1 收尾闸门（本单跑一次，记录真实命令 / exit / 数字）

| 闸门         | 命令                                                                                       | 要求                                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| 盘读前置     | `pnpm doctor:fs`                                                                           | exit 0，记录均值 ms/文件与 slow 占比                                                                                                |
| 根类型       | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`                    | 0 error（本单零 src 改动，应与基线一致）                                                                                            |
| 构建类型     | `pnpm exec tsc -p tsconfig.build.json --noEmit`                                            | 0 error                                                                                                                             |
| Lint（权威） | `pnpm lint`                                                                                | 0 error，记录 warning 数（基线既有 1 条 e2e warning，范围外不修）                                                                   |
| oxlint fast  | `pnpm lint:fast`                                                                           | 0 warning / 0 error                                                                                                                 |
| 全量测试     | `pnpm test`                                                                                | exit 0；既有 **3263 例 / 195 文件**集合不减少、既有断言不改；本单不新增 spec；记录总用例数、文件数、墙钟与机器状态                  |
| engine-core  | `git diff --stat HEAD -- src/engine-core`                                                  | 空                                                                                                                                  |
| 源码零改动   | `git diff --stat HEAD -- src/ test/ bin/ src/migration/`                                   | 空（备忘示例不进源码树）                                                                                                            |
| 范围隔离     | `git diff --name-only HEAD`                                                                | 改动仅落在备忘 `docs/architecture/`、交付记录、本任务单、索引文档；无 `package.json` / tsconfig / vitest 配置 / CI / 其他业务域改动 |
| 边界         | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                                   | 12 passed                                                                                                                           |
| 备忘一致性   | 复核 §1 锚点计数（102 entity / 18 关系文件 / 20 test 引用 / 77 forFeature / 87 migration） | 与实测一致；不一致项逐条写进交付记录偏差表                                                                                          |

> 验收侧不重跑全量；执行方交付记录里的闸门数字 + CI 结果作为合并底线。

---

## 6. 交付记录（完成后写，路径固定）

`docs/worklog/completed/phase2.5/td14-entity-typeorm-decoupling-assessment-implementation-2026-11-14.md`

内容必须含：

1. 本单做了什么（一句话：只读方案评估，备忘路径 + 推荐结论一句话）；
2. 评估要点：四条路径对比结论、TypeORM 可行性核查结果、推荐路径与退回口径；偏差逐条写清原方案 / 实际方案 / 理由（conventions §2.5）；
3. 改动文件清单（新建 / 修改 / 删除，逐个一句用途）；
4. 闸门表：命令 / exit code / 真实数字（error、warning、用例总数、文件数）；
5. 任务特有结果：影响面清单摘要（entity 分层 / test 定性 / service 定性计数）、备忘与 §3 章节对照、锚点计数复核结果；
6. 风险与回归：确认未碰 engine-core / schema / entity 字段 / DTO / controller / 其他业务域 / 配置 CI；既有 spec 断言与 mock 语义未改；
7. 遗留项：§2 另案 G / I / J 逐条登记；本评估结论对另案 G 排期与收益口径的影响；Actions 侧待复核点（若有）。

---

## 7. 【交付回写清单】做完逐项勾选（硬清单，不许跳）

- [x] 评估备忘已写到 §3 固定路径，七章齐全（§3.1–3.7）
- [x] 交付记录已写到 §6 固定路径
- [x] 本任务单从 `pending/` 移到 `completed/phase2.5/`，顶部状态行改 ✅ 并链交付记录与备忘
- [x] 回写 WP 登记表：`docs/worklog/pending/phase2.5-wp-list-2026-11-08.md` §四 TD-14 行改完成态、补备忘与交付记录链接
- [x] 回写阶段入口：`docs/worklog/pending/phase2.5-README.md` §3.0 TD-14 bullet 改完成态
- [x] 回写台账：`docs/team/gate-performance-remediation-2026-11-11.md` §9 P-DEBT-11 行追加 H 项评估结论 + 链接；更新记录补一条；另案 G / I / J 登记到该行遗留段（`phase2.5-toolchain-tech-debt-2026-11-11.md` 仅覆盖 TD-1~4 工具链债，无 L-1 段落，不另加）
- [x] `git diff --stat HEAD -- src/engine-core` 为空；`src/ test/ bin/ src/migration/` 零改动
- [x] 提交分组核对：本单文件与并行进程产物分开；若授权代提交，stage 只含本单文件
- [x] 给一行 commit message 草稿（**不自己 commit / push**，等用户指令）

> **执行方确认（2026-11-14，MiniMax Code）**：九项全部完成 —— 备忘 `docs/architecture/entity-typeorm-decoupling-assessment-2026-11-14.md`（402 行 / 七章齐全）、交付记录 `docs/worklog/completed/phase2.5/td14-entity-typeorm-decoupling-assessment-implementation-2026-11-14.md`、本任务单已归档且状态行改 ✅、wp-list §四 / phase2.5-README §3.0 / 台账 §9 三处回写完成（台账更新记录另补一条「TD-14 落地」，另案 G / I / J 登记并新增 **K**（CLI `entities` glob 口径脱节）/ **L**（TD-13 analytics spec 残留测试闭包））。闸门：根 tsc / build tsc **0 error**、lint **0 error 1 warning**（`test/e2e/v2-user-flow.spec.ts:1` 既有 unused eslint-disable，范围外未修）、lint:fast **0/0**、boundary **12 绿**、全量 **3259 passed + 4 skipped（3263 例 / 195 文件）**（与基线逐字一致）、`git diff --stat HEAD -- src/engine-core` **空**、`src/ test/ bin/ src/migration/` **零改动**、改动仅落 6 个 docs 文件。commit message 草稿见交付记录 §八（**未提交**）。

---

## 8. 回复输出约定

完成后在对话里：

1. 说一句"已写入交付记录"并附文件路径，不重复贴全文；
2. 报告闸门真实数字（tsc / eslint / vitest 用例数 / boundary）；
3. 报告备忘推荐结论一句话 + §7 回写清单哪几项已做、有没有遗留；
4. 不把备忘全文或代码 diff 贴进对话，让用户自己 `git diff` / 打开备忘。

---

_本单无新增第三方依赖；无 schema / migration / 源码变更；仅一份架构评估备忘 + 交付记录 + 索引回写；未自动 commit / push。_
