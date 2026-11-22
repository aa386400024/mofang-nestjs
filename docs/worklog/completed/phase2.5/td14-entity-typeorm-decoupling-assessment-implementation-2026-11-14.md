# TD-14 · entity 装饰器运行时依赖消除 · 只读方案评估 —— 交付记录

> 任务性质：**只读方案评估**（零 `src` / 零 `test` / 零 `bin` / 零 `src/migration` 改动）
> 仓库：E:\Work\Project\backend\mofang-nestjs，分支 integrate，基线 HEAD `20bbf53`（TD-13 交付后）
> 任务单：[td14-entity-typeorm-decoupling-assessment-task-2026-11-14.md](td14-entity-typeorm-decoupling-assessment-task-2026-11-14.md)（已归档至本目录）
> 交付物 1（主）：[entity-typeorm-decoupling-assessment-2026-11-14.md](../../../architecture/entity-typeorm-decoupling-assessment-2026-11-14.md)（402 行 · 七章齐全）
> 执行方：MiniMax Code ｜ 交付日期：2026-11-14

---

## 一、本单做了什么

**一句话**：以只读取证方式评估"解除 entity 装饰器 → typeorm 传递闭包"的四条可选路径，落成一份架构备忘 + 影响面清单 + 推荐结论 + 分期路线，**未落地任何改造**。

**推荐结论**：**路径 C（Row 纯类型 + 持久化分层映射）+ 配套 C+（枚举外移）**；**不推荐路径 B（纯类 + EntitySchema 外置）** —— 技术可行，但成本 / 收益比不成立；路径 A 降级为批次内配套，路径 D 零成本可接受。

**对排期最直接的作用**：修正另案 G（其余 service 端口化推广）的收益口径 —— **不再以"加载图减重"为 KPI**（TD-11 实测该收益为 0），改为「service 源码层 typeorm 值符号 0 命中」+「该批 spec 值位置 entity import = 0」。

---

## 二、评估要点与关键设计决策

### 2.1 四条路径对比结论

| 路径                                | 结论                                         | 关键判别                                                                                                                                                                                                                                   |
| ----------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A · 装饰器保留 + spec 侧隔离**    | ⚠️ **降级为批次内配套**                      | 收益上限 = 20 个触达 entity 的 spec（195 个中的 10%）；15 个是**值位置**使用（mock token / 断言对象），mock typeorm 消不掉"业务代码 import entity 类"这条边                                                                                |
| **B · 纯类 + EntitySchema 外置**    | ❌ **不推荐**（技术可行，成本/收益比不成立） | B 相对 C 的**增量收益只剩 3 个枚举的文件位置**，代价是数百文件 + 18 个关系 entity 映射重写 + token 语义变更 + CLI 生成器不兼容；且 schema 文件**必然** `import { EntitySchema }`（值）⇒ 误引即闭包复活，需自建静态守护 —— **长期**纪律成本 |
| **C · Row 纯类型 + 持久化分层映射** | ✅ **推荐**                                  | 仓内**已有可运行样板**（TD-13 analytics 域即 C 形态，11 例端口替身 spec + 全量绿 + 运行时 DI 验证通过）；零 schema / 零 DDL / 零 CLI 改动；typeorm 天然收敛在 `data/` 目录，无需静态守护                                                   |
| **D · 维持现状**                    | ⚠️ **可接受但非最优**                        | 成本为零，代价是 P-DEBT-11 的 L-1 长期挂着；TD-13 已证"契约端口化"本身有独立价值（可测性 / 可替换性），**不依赖 H**                                                                                                                        |

**成本量级**：A = 小（≤20 spec）／B = 大（数百文件）／C = 中（按域分批，每批 ~10-30 文件）／D = 零。**风险等级**：A 低／B 高／C 中。

### 2.2 TypeORM 1.1.2 可行性核查结论

- **能力面无缺口**：仓内安装版本 `typeorm@1.1.2` 的 `EntitySchemaOptions` / `EntitySchemaColumnOptions` / `EntitySchemaRelationOptions` / `EntitySchemaIndexOptions` **完整覆盖仓内全部在用装饰器**（含 `primary` / `createDate` / `updateDate` / `deleteDate` / `generated: uuid` / `enum` / `enumName` / `transformer` / 复合 `columns` 索引 / `joinColumn` / `inverseSide` / `onDelete` 等）⇒ **TypeORM 不是路径 B 的瓶颈**。
- **Nest 侧装配面已核实**：`@nestjs/typeorm@12.0.2` 的 `EntityClassOrSchema = Function | EntitySchema`、`forFeature(entities?: EntityClassOrSchema[])`、`InjectRepository(entity)`、`getRepositoryToken` 对 EntitySchema 取 `options.target ? target.name : options.name` + `"Repository"` ⇒ **token 形状与同名装饰器类同形**；`EntitiesMetadataStorage.addEntitiesByDataSource` 接受 EntitySchema；三套 env 均 `synchronize:false` + `autoLoadEntities:true`。
- **CLI 现状定性**：`bin/ormconfig.ts` 的 `entities` 只 glob `src/entity/**/*.{js,ts}` ⇒ CLI 看不到 **99 个真实业务 entity**（101 减 2 个生成器样品）；87 个 migration 中 `new Table(` 命中 **0**（全手写 DDL）、`synchronize: true` 代码命中 **0**（5 处全在"不用"的注释）⇒ ADR-0003 纪律严格成立 ⇒ **EntitySchema 化对 CLI 零影响**（CLI 压根不读业务 entity 元数据）；`bin/entity.ts` 是 typeorm-model-generator 反向生成器（DB → 装饰器 entity），与 EntitySchema **不兼容**，但该链路事实上已废弃。
- **3 项标注"需实现单验证"**（本单不写确定结论）：① EntitySchema + 纯类 target 的 `@InjectRepository` token 端到端运行时行为；② EntitySchema 关系映射是否走 `AppNamingStrategy` 的 snake_case join 列名；③ EntitySchema 下生命周期列自动赋值与装饰器版是否**逐字等价**（涉 90 + 67 处）。

### 2.3 推荐路径与退回口径

- **推荐**：C + 配套 C+。**配套必做项（否则闭包不解）**：① **枚举外移**（3 个 entity 内枚举 → 独立纯类型文件，直接修掉 TD-13 analytics spec 的残留闭包）；② **spec 零 entity import** 作为每批验收项。
- **分期路线（三段）**：**C+（最小切口，3 个 entity 文件 + 1 个 spec）** → **C1（试点域：1 域 3-5 个 entity 四件套）** → **C2（按另案 G 分批推广，每批加"spec 零 entity import"验收）**。
- **试点域排序**：life-map（4 entity / 0 关系 / 0 枚举）→ quality（1 / 0 / 0）→ home / inner_world / ai-engine（0 关系、无枚举）→ companion（有 2 关系 + 枚举，后置）→ profile / user / counselor（关系面重 + 枚举混放，最后）。
- **退回口径**：若 C+ 与 C1 被否，则启动路径 B 的分期（B0 修 CLI glob → B1 单 entity 样板 → B2 关系 18 个 → B3 扁平 81 个），**且 B 必须配静态守护**（禁止业务层 import schema 文件）。若整条线被否，则退回 **D + 另案 G 的契约端口化**，并**明确不再承诺加载图收益**。

### 2.4 偏差登记（conventions §2.5 · 主控 §1 锚点 vs 仓内实测）

> 口径真相源 = 仓内实测。本单计数口径统一为「`src/**` 下 `@X(` **装饰器调用**出现次数」（子串口径会把注释计入，故弃用）。

| 指标                                                                        | §1 主控锚点                   | 本单实测                                | 差         | 判定                                                                                                                |
| --------------------------------------------------------------------------- | ----------------------------- | --------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------- |
| `@Entity`                                                                   | 102                           | **102**                                 | 0          | ✅ 一致（101 真实 entity 文件 + 1 处 `src/migration/1700000010005-AddDriftBottles.ts` **注释**）                    |
| `@Column`                                                                   | 858                           | **859**                                 | +1         | ⚠️ 口径差 1 处                                                                                                      |
| `@Index`                                                                    | 188                           | **188**                                 | 0          | ✅ 一致                                                                                                             |
| `@CreateDateColumn`                                                         | 90                            | **90**                                  | 0          | ✅ 一致                                                                                                             |
| `@UpdateDateColumn`                                                         | 67                            | **67**                                  | 0          | ✅ 一致                                                                                                             |
| `@DeleteDateColumn`                                                         | 2                             | **2**                                   | 0          | ✅ 一致（子串口径为 17，其中 15 处是注释 / 字符串提及，真实装饰器调用 2）                                           |
| `@PrimaryGeneratedColumn`                                                   | 84                            | **88**                                  | +4         | ⚠️ 口径差 4 处                                                                                                      |
| `@PrimaryColumn`                                                            | 21                            | **22**                                  | +1         | ⚠️ 口径差 1 处                                                                                                      |
| `@JoinColumn`                                                               | 14                            | **15**                                  | +1         | ⚠️ 口径差 1 处                                                                                                      |
| `@ManyToOne`                                                                | 9                             | **10**                                  | +1         | ⚠️ 口径差 1 处                                                                                                      |
| `@OneToOne` / `@OneToMany`                                                  | 6 / 3                         | **6 / 3**                               | 0          | ✅ 一致                                                                                                             |
| `@ManyToMany` / `@JoinTable` / `@Unique` / `@RelationId` / `@VersionColumn` | 0                             | **0**                                   | 0          | ✅ 一致（无 API 缺口）                                                                                              |
| 关系面 entity 文件                                                          | 18                            | **18**                                  | 0          | ✅ 一致（另剔除 `src/database/naming-strategy.ts` 的**注释示例**误命中）                                            |
| 触达 entity 的 test 文件                                                    | 20                            | **20**                                  | 0          | ✅ 一致                                                                                                             |
| `TypeOrmModule.forFeature`                                                  | 77                            | **40** 代码调用（+39 注释 = 79 总提及） | 锚点含注释 | ⚠️ **代码调用真值 = 40**（分布在 37 个 module 文件）；锚点 77 介于"代码调用 40"与"总提及 79"之间 ⇒ 计入部分注释提及 |
| migration 文件                                                              | 87                            | **87**                                  | 0          | ✅ 一致（全手写 DDL）                                                                                               |
| 引用分布 7 数字                                                             | 98 / 67 / 20 / 16 / 6 / 5 / 2 | **逐字一致**                            | 0          | ✅ 一致（合计 214）                                                                                                 |

**偏差结论**：差异 **≤4 处**、方向一律为"实测 ≥ 锚点"，**未找到可统一解释全部差异的计数口径**（主控未标注计数方式）。本单全部结论只依赖三类事实 —— 「是否值位置引用」「是否含关系」「规模量级」—— **不依赖精确计数**，故**偏差不影响任何结论**。差异来源已作为未决项登记（备忘 §7.2 第 4 条），需一次口径对齐的复算。

### 2.5 任务单与实际的出入（评估中发现的新事实，任务单未覆盖）

| 编号    | 任务单 / 既往结论                               | 实测                                                                                                                                                                                                                       | 处置                                                                                |
| ------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **N-1** | TD-13 交付记录表述为"typeorm 值符号外泄 0 命中" | **TD-13 的 analytics spec 仍值位置 import `AnalyticsEventType`** ⇒ 该 spec 的 import 闭包**仍含 typeorm** ⇒ **TD-13 解除了 service 源码层的直接边，没有解除测试闭包**                                                      | 写入备忘 §1.3 事实 ③，并作为 **C+ 最小切口的直接目标**                              |
| **N-2** | 任务单把"枚举混放"列为可能的闭包主因            | 实测 **102 个 entity 中仅 3 个内含枚举**（其余 82 个在独立 `enums/` 目录）；且 101 个真实 entity 中 **97 个有值位置引用**，**type-only-only 命中 0** ⇒ 闭包主因是"**entity 类被当作 DI token 在值位置使用**"，不是枚举混放 | 写入备忘 §1.3 事实 ① / ②，**直接改变路径排序**（B 的增量收益缩水到 3 个枚举的位置） |
| **N-3** | 任务单假设"CLI 适配"是路径 B 的主要成本         | 实测 CLI 的 `entities` glob **本来就看不到业务 entity**，87 个 migration 全手写 DDL ⇒ CLI 生成链路**事实上已废弃** ⇒ EntitySchema 化对 CLI **零影响**                                                                      | 写入备忘 §1.3 事实 ④；glob 口径脱节另案 **K** 登记                                  |
| **N-4** | 任务单 §1 锚点"102 个 entity 文件"              | 实测 **102 个 `@Entity(` 命中分布在 102 个文件**，其中 1 个是 migration 注释 ⇒ 真实 entity 文件 **101** 个                                                                                                                 | 备忘与本记录统一用「101 个真实 entity 文件」口径                                    |

---

## 三、改动文件清单

| 操作       | 文件                                                                                                                       | 用途                                                                                                                                               |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **新增**   | `docs/architecture/entity-typeorm-decoupling-assessment-2026-11-14.md`                                                     | **主交付物**：七章评估备忘（现状根因 / 四路径对比 / TypeORM 1.1.2 可行性核查 / 影响面清单 / 推荐结论 / 分期路线与试点标准 / 风险与未决项），402 行 |
| **新增**   | `docs/worklog/completed/phase2.5/td14-entity-typeorm-decoupling-assessment-implementation-2026-11-14.md`                   | 本交付记录                                                                                                                                         |
| **移位**   | `docs/worklog/pending/td14-entity-typeorm-decoupling-assessment-task-2026-11-14.md` → `docs/worklog/completed/phase2.5/`   | 任务单归档；顶部状态行改 `✅ 已交付` 并链交付记录与备忘                                                                                            |
| **修改**   | `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md`                                                                      | §四 TD-14 行改完成态，补备忘与交付记录链接                                                                                                         |
| **修改**   | `docs/worklog/pending/phase2.5-README.md`                                                                                  | §3.0 TD-14 bullet 改完成态                                                                                                                         |
| **修改**   | `docs/team/gate-performance-remediation-2026-11-11.md`                                                                     | §9 P-DEBT-11 行追加本单评估结论与链接；更新记录补一条；另案 G / I / J / K 登记                                                                     |
| **零改动** | `src/`、`test/`、`bin/`、`src/migration/`、`engine-core/`、`package.json`、`tsconfig*.json`、`vitest.config.mts`、CI、前端 | 本单为只读评估，全部保持原样                                                                                                                       |

> 移位后已复查指向任务单的相对链接（共 2 处：wp-list §四 TD-14 行、phase2.5-README §3.0 TD-14 bullet），均已按新层级重算为 `../completed/phase2.5/...`；备忘与交付记录内的链接已逐条验证目标文件存在。

---

## 四、闸门表（真实数字）

| 闸门         | 命令                                                                                   | exit  | 真实数字                                                                                                                                                                                                                                                                                                          |
| ------------ | -------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 盘读前置     | `pnpm doctor:fs`                                                                       | **0** | per-file 均值 **0.25 ms/文件**；warm 51 ms / 200 文件 / slow **0**；cold 324 ms / slow 10；判定「**合格**（读取延迟正常，闸门数字可信）」                                                                                                                                                                         |
| 根类型       | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`                | **0** | **0 error**                                                                                                                                                                                                                                                                                                       |
| 构建类型     | `pnpm exec tsc -p tsconfig.build.json --noEmit`                                        | **0** | **0 error**                                                                                                                                                                                                                                                                                                       |
| Lint（权威） | `pnpm lint`                                                                            | **0** | **0 error / 1 warning**（`test/e2e/v2-user-flow.spec.ts:1` unused eslint-disable —— **HEAD 既有基线**，范围外未修）                                                                                                                                                                                               |
| oxlint fast  | `pnpm lint:fast`                                                                       | **0** | **0 warning / 0 error**                                                                                                                                                                                                                                                                                           |
| 全量测试     | `pnpm test`                                                                            | **0** | **194 passed / 1 skipped（195 文件）**、**3259 passed / 4 skipped（3263 例）**、Duration **95.06 s**；与基线 **3263 例 / 195 文件逐字一致**；本单**未新增 spec**                                                                                                                                                  |
| engine-core  | `git diff --stat HEAD -- src/engine-core`                                              | **0** | **空**                                                                                                                                                                                                                                                                                                            |
| 源码零改动   | `git diff --stat HEAD -- src/ test/ bin/ src/migration/`                               | **0** | **空**（备忘示例未进源码树）                                                                                                                                                                                                                                                                                      |
| 范围隔离     | `git diff --name-only HEAD`                                                            | **0** | 仅 **3 个 docs 文件**（`docs/team/gate-performance-remediation-2026-11-11.md`、`docs/worklog/pending/phase2.5-README.md`、`docs/worklog/pending/phase2.5-wp-list-2026-11-08.md`，均为**主控 TD-14 立项回写**）+ 本单 **2 个新增未跟踪文档**；**无** `package.json` / tsconfig / vitest 配置 / CI / 其他业务域改动 |
| 边界         | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                               | **0** | **12 passed**（1 文件 / 2.06 s）                                                                                                                                                                                                                                                                                  |
| 备忘一致性   | 复核 §1 锚点（102 entity / 18 关系文件 / 20 test 引用 / 77 forFeature / 87 migration） | ——    | 逐条复核，差异见 §2.4 偏差表（**≤4 处**，不影响结论）                                                                                                                                                                                                                                                             |

### 4.1 机器状态（墙钟可比性）

- 跑闸门时本机有 **5 个 node 常驻进程**：`pnpm start:dev` / `nest start --watch` / `pnpm dev` / `admin-dashboard` 的 vite / `node dist/app`。**未擅自终止用户进程**。
- 因此全量 **95.06 s** 与历史基线（TD-11 约 66 s）**不可直接比较**（机器不干净，见 P-DEBT-7）；**用例数与文件数才是可比口径**（本次 3263 例 / 195 文件 = 基线逐字一致）。
- 取证会话 PATH 已补 `D:\Apps\Git\cmd`（依赖外部命令的 spec 才不会假失败）。

---

## 五、任务特有结果

### 5.1 影响面清单摘要（备忘 §4 全文）

- **entity 规模**：**101** 个真实 entity 文件（102 个 `@Entity(` 命中中 1 处在 migration 注释）；其中**关系面 18** 个、**扁平 83** 个。
- **域分布 Top**：counselor 25 / profile 10 / companion 10 / inner_world 7 / engine-adapters 5 / ai-engine 5 / home 5 / practice 5 / user 5 / auto-practice 4 / knowledge-base 4 / life-map 4。
- **引用分布（锚点逐字一致）**：service **98** / src-other **67** / test **20** / entity-self **16** / controller **6** / dto **5** / types **2**，合计 **214**。
- **值位置 vs 类型位置**：101 个 entity 中 **97** 个有值位置引用，**type-only-only 命中 0** ⇒ 闭包主因是 entity 类当 DI token 值位置使用。
- **20 个触达 entity 的 test**：**15** 个值位置 / **3** 个仅类型位置 / **2** 个无触达。
- **枚举拆分面**：entity 文件内枚举**仅 3 个** —— `AnalyticsEventType`（analytics）、`OAuthProvider`（user）、`AuditEvent`（user）；其余 **82** 个在独立 `enums/` 目录。
- **引用热度 Top**：`user.entity.ts` 41（值位置 41）、`training-session.entity.ts` 22、`character-profile.entity.ts` 21、`counselor-mode.entity.ts` 13、`practice-session.entity.ts` 11、`audit-log.entity.ts` 9；**零值位置引用的 entity 仅 5 个**（2 样品 + 3 个 life-map）。
- **仓内先例**：supervisor（Row + `toRow`）、TD-13 analytics（端口下沉）—— 两条都是路径 C 的可复制样板。

### 5.2 备忘章节 ↔ 任务单 §3 要求对照

| 任务单 §3 要求                  | 备忘章节                                                                              | 状态 |
| ------------------------------- | ------------------------------------------------------------------------------------- | ---- |
| ① 现状事实与闭包根因            | §1（机制 / 既往实测 / **本次 4 条决定性事实** / 规模实测）                            | ✅   |
| ② 候选路径对比（A / B / C / D） | §2（API 形态示意 + **10 维对比表** + 关键判别）                                       | ✅   |
| ③ TypeORM 1.1.2 可行性核查      | §3（EntitySchema 能力面 / Nest 装配 / CLI / 小结）                                    | ✅   |
| ④ 影响面清单                    | §4（口径声明 / 引用分布 / entity 分层 / 引用热度 / 20 test 定性 / 枚举拆分面 / 先例） | ✅   |
| ⑤ 推荐结论                      | §5（首选 / 不推荐及原因 / **对 G 的收益口径影响** / 闭包逐路径回答）                  | ✅   |
| ⑥ 分期路线与试点标准            | §6（三段路线 / 试点域标准与排序 / B 的分期）                                          | ✅   |
| ⑦ 风险与未决项                  | §7（风险表 / **5 条"需实现单验证"** / 另案登记）                                      | ✅   |

---

## 六、风险与回归

- **回归风险 = 0**：本单零源码改动；全量 3263 例 / 195 文件与基线**逐字一致**，boundary 12 绿，根 tsc / build tsc 0 error，lint 0 error / 1 warning（既有）。
- **评估结论被误当实现决策**：备忘 §7.2 的 5 条已明确标注「**需实现单验证**」，其中第 4 条（装饰器计数口径差异）需一次口径对齐复算；**本单不替代未来实现单的设计决策**。
- **备忘中的 API 示例被误落源码树**：备忘 §2.1 已声明"仅示意，不落源码树"，且闸门确认 `src/` `test/` `bin/` `src/migration/` 零改动。
- **TypeORM 升级绑定**：路径 C 不改 schema 表达 ⇒ 升级只影响持久化层；路径 B 会把 101 个 entity 的 schema 绑死在特定版本 API 上（这是不推荐 B 的理由之一）。
- **隐私**：全部文档只出**码与计数**，无心理对话原文、无样本内容。

---

## 七、遗留项与另案登记（本单不做）

| 编号        | 项                                                                                                                                                | 状态 / 口径                                                                                                                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **G**       | 其余 117 个 service 仓储端口化分批推广（counselor 33 文件 / 63 处为最大域）                                                                       | 🟠 **待排期** —— **收益口径按备忘 §5.3 修正**：不再以"加载图减重"为 KPI（TD-11 实测为 0），改为「service 层 typeorm 值符号 0 命中」+「该批 spec 值位置 entity import = 0」；G **继续推进**（契约边界 + 可测性本身有独立价值） |
| **H**       | entity 装饰器运行时依赖消除（**本单即 H 的评估段**）                                                                                              | ✅ 评估已交付；**实现段另案**，最小切口 = 备忘 §6.1 的 **C+**（3 个 entity 文件 + 1 个 spec）                                                                                                                                 |
| **I**       | 端口内存实现是否补                                                                                                                                | 🟢 **暂不补** —— analytics 域无此需求（端口替身 spec 已够）；待 G 推广时按域评估                                                                                                                                              |
| **J**       | 混合形态 typeorm import 文件统一形态                                                                                                              | 🟢 **可读性向、零运行时收益**（TD-11 已实测）—— 另案批量处理                                                                                                                                                                  |
| **K（新）** | `bin/ormconfig.ts` 的 `entities` glob 口径与真实 entity 位置脱节（CLI 看不到 99 个业务 entity；`bin/entity.ts` 反向生成器与 EntitySchema 不兼容） | 🟠 **独立既有债** —— 只影响"想恢复 `migration:generate`"这一条路；本单不清理，路径 B 若启动则须先做 B0                                                                                                                        |
| **L（新）** | TD-13 analytics spec 的残留测试闭包（仍值位置 import `AnalyticsEventType`）                                                                       | 🟠 **已被 C+ 覆盖** —— 枚举外移后即可实测解除；本单只登记，不改 spec                                                                                                                                                          |

---

## 八、commit message 草稿（未提交，等指令）

```
feat(td14): entity 装饰器运行时依赖消除只读评估（四路径对比 + TypeORM 1.1.2 可行性核查 + 推荐路径 C）
```

> 提交分组建议：本单改动**全部落在 docs/**，可与主控的 TD-14 立项回写（3 个已修改 docs 文件）**合并为一个 commit**；若主控要分开，先提交主控的立项回写再提交本单的备忘 + 交付记录 + 索引回写。**不自动 commit / push**。
