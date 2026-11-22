# TD-16 · C1 试点域仓储端口化（life-map 域 · P-DEBT-11 / L-1 · TD-14 推荐路线第二段）

> 状态：✅ **已交付**（2026-11-14，MiniMax Code）→ 交付记录：`docs/worklog/completed/phase2.5/td16-life-map-port-pilot-c1-implementation-2026-11-14.md`
> 仓库：E:\Work\Project\backend\mofang-nestjs，分支 integrate，基线 HEAD `0b5cf55`（TD-15 交付后）
> 唯一事实源：`docs/team/gate-performance-remediation-2026-11-11.md` §9 **P-DEBT-11**（L-1）+ `docs/architecture/entity-typeorm-decoupling-assessment-2026-11-14.md`（TD-14 备忘）§5.3 / §6.1 / §6.2 + TD-13 交付记录（四件套模板）
> 任务性质：**实现单（C1 试点域）** —— 选定 1 个扁平、无跨模块仓储消费、entity 无枚举的域（**life-map**），按 TD-13 四件套落地仓储端口（端口 interface + Symbol token + `data/` TypeORM 实现 + module 接线 + 端口替身 spec），产出可复制的域级模板与第一个"spec 零 entity import"样板
> 改动范围：`src/life-map/` + `test/life-map/` + 交付文档；`engine-core/`、`src/migration/`、配置、CI、其他业务域、前端不碰

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `E:\Work\Project\backend\mofang-nestjs\README.md` —— 仓库总览
2. `E:\Work\Project\backend\mofang-nestjs\docs\README.md` —— 文档导航
3. `E:\Work\Project\backend\mofang-nestjs\docs\team\conventions.md` —— 代码红线 + 交付格式（§1.1 engine-core 分层、§1.3 pnpm 命令规范、§三 16 条硬约束、§2.5 偏差登记）
4. 阶段工作入口：`docs/worklog/pending/phase2.5-README.md` 与 `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md`
5. 根因与既往结论：
   - TD-14 备忘 `docs/architecture/entity-typeorm-decoupling-assessment-2026-11-14.md` §5.3（G 收益口径）、§6.1（C+ / C1 / C2 三段）、§6.2（试点域选择标准与候选排序）
   - TD-13 交付记录 `docs/worklog/completed/phase2.5/td13-repository-port-analytics-pilot-implementation-2026-11-14.md`（四件套结构、端口方法面口径、typeorm 符号外泄复核、行为对照表、偏差登记 D-1 ~ D-7）
   - TD-13 端口样板：`src/analytics/domain/repositories/analytics-event.repository.ts`（interface + Symbol token + 入参类型）、`src/analytics/data/analytics-event.repository.typeorm.ts`（TypeORM 实现）；更早先例 `src/agent/supervisor/domain/repositories/supervision-report.repository.ts`（Row 形态）
   - TD-15 交付记录 `docs/worklog/completed/phase2.5/td15-enum-extraction-cplus-implementation-2026-11-14.md` §七（另案 M / N 口径）
6. 本任务单（就是你在读的这份）

---

## 1. 背景（先读，方向别错）

TD-14 备忘 §6.1 推荐路线分三段：**C+（枚举外移，TD-15 已交付）→ C1（试点域端口化，本单）→ C2（按域推广）**。C1 的任务是把 TD-13 在 analytics 域验证过的「仓储端口」模式，在第二个业务域完整复制一遍，固化为可推广模板，并作为**第一个 spec 零 entity import** 的样板域。

**模式定义**（沿用 TD-13 四件套）：

1. **端口**：`src/<域>/domain/repositories/<name>.repository.ts` —— interface + Symbol DI token + 入参 / Row 类型；零 typeorm 值符号。
2. **TypeORM 实现**：`src/<域>/data/<name>.repository.typeorm.ts` —— `@InjectRepository` + `Repository` + 查询操作符全部收在此文件；域内唯一允许出现 typeorm 值符号的业务文件。
3. **module 接线**：provider `{ provide: TOKEN, useClass: <TypeORM 实现> }`；**保留** `TypeOrmModule.forFeature([...])`；exports 口径按现状（本域无跨模块消费，token 不 export，对齐 TD-13 D-4）。
4. **端口替身 spec**：`test/<域>/td16-*.repository-port.spec.ts` —— 替身只记调用参数 + 返回预设行 / 序列；不起真 TypeORM、不连 DB、不 `vi.mock('typeorm')`。

### 1.1 域选定：life-map（主控取证锚点，HEAD `0b5cf55`；执行方复核并登记偏差）

| TD-14 §6.2 选择标准                      | life-map 实测                                                                                                  | 判定 |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---- |
| 1. 扁平表优先（无关系装饰器）            | 4 entity 关系装饰器 **0**（@ManyToOne / @OneToMany / @ManyToMany / @OneToOne / @JoinColumn / @JoinTable 全 0） | ✅   |
| 2. entity 文件内无枚举                   | 0 内联 `enum`；域内枚举 `DriftBottleStatus` 已在独立文件 `src/life-map/enums/drift-bottle-status.enum.ts`      | ✅   |
| 3. 无跨模块仓储消费                      | `src/` 其他目录仅 `app.module.ts` 装配 `LifeMapModule`；无 service / repository / entity 值位置跨域引用        | ✅   |
| 4. 引用面小 + module forFeature 单点注册 | 仓储仅被本域 2 个 service 使用；`life-map.module.ts` 单点 `forFeature`                                         | ✅   |
| 5. 已有等价端口先例可抄                  | TD-13 analytics 四件套 + supervisor Row 端口先例均在仓内                                                       | ✅   |

**候选对照**（本单不做，留 C2 / 后置）：`quality`（1 entity、0 关系、0 枚举，次之）；`home`（`micro-intervention-scenario.entity.ts` 内联枚举 2）、`inner_world`（`game-unlock-progress.entity.ts` 内联枚举 2）、`ai-engine`（`ai-unlock-state` / `crisis-event` 各内联枚举 1）后置；`companion` / `profile` / `user` / `counselor` 关系面重 + 枚举混放，最后。

### 1.2 life-map 现状清单（主控实测）

**目录**：`src/life-map/`（17 个 `.ts`）；无域根 `index.ts` barrel；仅 `entities/index.ts`。

**4 个 entity**（全扁平；软删为手写 `deletedAt` 查询过滤，非 `@DeleteDateColumn`；本单不改 entity 文件）：

| entity 文件                                                           | 列装饰器 | PK  | deletedAt 引用 | 归属              |
| --------------------------------------------------------------------- | -------- | --- | -------------- | ----------------- |
| `entities/life-stage-progress.entity.ts`（`LifeStageProgressEntity`） | 6        | 1   | 1              | V3.0 阶段梳理     |
| `entities/key-event.entity.ts`（`KeyEventEntity`）                    | 10       | 1   | 2              | V3.0 关键事件     |
| `entities/genome-dimension.entity.ts`（`GenomeDimensionEntity`）      | 7        | 1   | 1              | V3.0 心理基因盘点 |
| `entities/drift-bottle-entry.entity.ts`（`DriftBottleEntry`）         | 9        | 1   | 0              | V6.0 漂流瓶       |

**service 与仓储现状**：

| 文件                                                                  | 现状                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `providers/life-map.service.ts`                                       | **直连 3 个 Repository**（`stageRepo: Repository<LifeStageProgressEntity>`、`eventRepo: Repository<KeyEventEntity>`、`dimensionRepo: Repository<GenomeDimensionEntity>`）；typeorm 值符号：`@InjectRepository` ×3、`IsNull`、`Repository` ×3；L27 值位置 import 3 个 entity 类（另含 `GenomeDimensionKey` type） |
| `providers/drift-bottle.service.ts`                                   | 注入手写仓储类 `DriftBottleRepository`；L6 值位置 import `DriftBottleEntry`                                                                                                                                                                                                                                      |
| `providers/drift-bottle.repository.ts`                                | 现有手写 `@Injectable()` 仓储类（typeorm 已收在类内），8 个方法：`create` / `findById` / `pickRandomExcluding` / `findSea` / `findMine` / `findInbox` / `getStats` / `update`；返 entity 行给 service                                                                                                            |
| `life-map.module.ts`                                                  | `forFeature([GenomeDimensionEntity, KeyEventEntity, LifeStageProgressEntity, DriftBottleEntry])`；providers：`LifeMapService` / `DriftBottleService` / `DriftBottleRepository`；exports：同上三者；imports：`UserModule`                                                                                         |
| `controllers/`（2）、`dto/`（5）、`enums/drift-bottle-status.enum.ts` | controller / DTO 不直连 Repository；DTO 文件仅注释提及 entity，无 entity import                                                                                                                                                                                                                                  |

**test/ 现状**：`test/` 下**零** life-map 既有 spec（本域首批测试即本单新增的端口替身 spec）；其他域 spec 不引用本域。

### 1.3 仓储调用面（端口方法面只收这些现有调用，不泛化）

**LifeMapService 三个直连仓储的现有调用形态**（端口方法签名由实现单按 TD-13 D-2 口径设计，出参用 Row / 窄领域类型，登记偏差）：

- `stageRepo`：`find({ where: { userId, deletedAt: IsNull() } })`、`findOne({ where: { userId, stage } })`、`create({...})`、`save(entity)`
- `eventRepo`：`find({ where: { userId, deletedAt: IsNull() }, order: { age: 'ASC' } })`、`create({...})`、`save(entity)`、`findOne({ where: { id, userId, deletedAt: IsNull() } })`、`count({ where: { userId, deletedAt: IsNull() } })`
- `dimensionRepo`：`find({ where: { userId, deletedAt: IsNull() } })`、`findOne({ where: { userId, key } })`、`create({...})`、`save(entity)`、`count({ where: { userId, deletedAt: IsNull() } })`

**DriftBottleRepository 现有 8 方法**：见 §1.2 表；调用面与前端 `DriftBottleRepository` 接口 1:1，不增不减。

**service 内部 entity 类型引用（端口化时需替换为端口 Row / 领域类型，公共方法签名不变）**：`stageToDto(e: LifeStageProgressEntity)`、`eventToDto(e: KeyEventEntity)`、`dimToDto(d: GenomeDimensionEntity)`、`requireActiveEvent(): KeyEventEntity`、`recommendTools(dims: GenomeDimensionEntity[])`、`buildReportSummary(..., dims: GenomeDimensionEntity[], ...)`。

### 1.4 基线闸门（HEAD `0b5cf55`，TD-15 交付后）

全量 **3259 passed + 4 skipped（3263 例 / 195 文件）**；lint **0 error / 1 warning**（`test/e2e/v2-user-flow.spec.ts:1` 既有 unused eslint-disable，范围外不修）；lint:fast / lint:deep **0 / 0**；boundary **12 passed**；根 tsc / build tsc **0 error**；`git diff --stat HEAD -- src/engine-core` 为空。

---

## 2. 范围（严格遵守，不越权）

### 在范围内

1. **端口文件**：`src/life-map/domain/repositories/` 下新增端口（interface + Symbol token + 入参 / Row 类型）。端口划分粒度由实现单判定（V3.0 三实体合一端口还是按实体分端口；V6.0 漂流瓶独立端口），在交付记录写明理由与偏差。
2. **TypeORM 实现**：`src/life-map/data/` 下对应实现文件；`@InjectRepository` / `Repository` / `Between` / `Not` / QueryBuilder 等 typeorm 值符号只允许出现在实现文件与 module 装配层。
3. **LifeMapService** 改依赖端口（3 个直连 Repository 抽出）；**DriftBottleRepository** 提 interface + token，现有手写类改造为 `data/` 下的 TypeORM 实现（若实现单判定现有类形态已满足隔离口径、改造收益不足，可保留类形态，但**必须**补 interface token 与对应替身 spec，并在交付记录登记偏差）。
4. **module 接线**：新增端口 provider；保留 `forFeature`；exports 保持现状（无跨域消费，仓储 token 不 export）。
5. **service 内部类型替换**：§1.3 列出的 entity 类型签名替换为端口 Row / 领域类型；service 不再值位置 import entity 类。controller 调用的公共方法签名保持不变。
6. **端口替身 spec**：`test/life-map/` 新增（工作项前缀 + 端口语义，对齐 TD-13 D-1 命名）；替身记调用参数 + 返回预设行 / 序列；**spec 零 entity import**（本单样板目标）；不起真 TypeORM、不连 DB、不 `vi.mock('typeorm')`；需要时间窗断言时用 fake timers。
7. **文档与索引回写**（§7 清单）。

### 明确不在范围内（禁止顺手做）

- **entity 文件一字不改**：字段、装饰器、列、索引、关系、软删口径全部保留；DTO、controller、路由、业务语义不动。
- 不做 Row 纯类型持久化分层映射的 C2 推广；不做 EntitySchema / 纯类改造；不补端口内存实现（另案 I）。
- 端口方法面只收 §1.3 现有调用形态；**不扩通用仓储代理**、不暴露 typeorm 管理句柄 / 查询选项 / 操作符；端口不写 SQL；端口 / service / spec 不暴露 entity 类名。
- 其他业务域零改动（尤其 `src/knowledge-base/` 等跨模块只消费 service 的域，本单不碰）；`src/migration/` 零改动；不改 package.json / tsconfig / `vitest.config.mts` / CI / Dockerfile；不新增第三方依赖；不碰 `admin-dashboard/` 与 Flutter。
- 既有 spec 断言 / mock 语义零改动；本域无既有 spec，其他域 spec 不新增、不修改。
- 不自动 git commit / push（写完给 commit 草稿，等用户指令）。

### 另案登记（本单不做，写入交付记录遗留段）

- **C2 / G**：其余 service 仓储端口化分批推广；每批验收口径 = 「service 源码层 typeorm 值符号 0 命中」+「该批 spec 值位置 entity import = 0」（TD-14 备忘 §5.3，不再以加载图减重为 KPI）。
- **I**：端口内存实现是否补（本单不补；spec 替身已覆盖替身需求）。
- **J**：混合形态 typeorm import 统一形态（可读性向、零运行时收益，另案批量处理）。
- **K**：`bin/ormconfig.ts` 的 `entities` glob 口径脱节（独立既有债，沿用 TD-14 登记）。
- **M**：entity 类值位置边 —— 本域端口化后，service 值位置 entity import 应归零；剩余 entity 类作为 DI token 的边归 C2/G 推广时闭合。
- **N**："枚举 / 端口文件零 typeorm 依赖"静态守护 spec（本单不新增；守护证据走 grep 复核 + lint，建议后续并入架构测试或 lint 规则）。

---

## 3. 目标交付物

### 3.1 代码改动

- 端口文件 + TypeORM 实现文件（`domain/repositories/` + `data/`）；`life-map.module.ts` provider 接线；`LifeMapService` / `DriftBottleService` 依赖改端口；新增端口替身 spec。
- 业务行为零漂移：解锁口径（`evaluateForecastUnlock` / `evaluateReportUnlock`）、阶段 / 事件 / 维度查询过滤（`userId` + `deletedAt: IsNull()`）、排序（事件按 `age ASC`、漂流瓶按 `createdAt` / `respondedAt` DESC）、租户隔离、静默失败语义、DTO 转换口径逐字不变。

### 3.2 静态复核证据（grep 复核，结果落交付记录）

1. **typeorm 符号外泄**：端口文件、两个 service、新 spec 四个受检面，`Repository` / `Between` / `FindOptions` / `EntityManager` / `from 'typeorm'` / `from '@nestjs/typeorm'` 值符号 **0 命中**（注释文案也避开 typeorm 字面量，对齐 TD-13 D-5）；命中只允许在 `data/` 实现文件与 module 装配层。
2. **spec 零 entity import**：新 spec 文件对 `entities/` 路径的 entity 类 import = **0**（样板目标）。
3. **service 值位置 entity import = 0**：`life-map.service.ts` / `drift-bottle.service.ts` 不再值位置 import entity 类。
4. **方法面不泛化**：端口方法与 §1.3 调用面一一对应；spec 用例显式断言调用次数与参数；无新增通用 `findAll` / `updateById` 之类代理方法。

### 3.3 交付记录（§6 固定路径）

含改动清单、端口方法面清单、typeorm 符号外泄复核表、service 行为与改前对照表（查询口径 / 过滤 / 排序 / 隔离 / 静默失败）、偏差登记（conventions §2.5）、边界确认、遗留另案。

> **口径真相源**：调用面与出参形状以仓内实测为准；若与 §1.2 / §1.3 锚点不一致，以实测为准并在偏差表写清原锚点 / 实测值 / 理由。

---

## 4. 红线（违反即返工）

- **engine-core 零改动**：`git diff --stat HEAD -- src/engine-core` 为空；`boundary.spec.ts` 不改。
- **entity 文件零改动**：装饰器 / 列 / 索引 / 关系 / 软删口径保留；migration DDL 不动。
- **方法面纪律**：端口只收现有调用，不扩通用代理；不暴露 typeorm 句柄 / 查询选项 / 操作符；不写 SQL；业务层不出现 entity 类名。
- **枚举与业务语义冻结**：`DriftBottleStatus` 成员与字符串值不变；service 公共签名不变；DTO / controller 路由不变。
- 隐私：心理对话原文禁止进文档 / 日志 / console / crash report（只出码与计数）。
- pnpm 命令规范：一律 `pnpm` / `pnpm exec`，禁止裸 `npx`。
- 不新增依赖；不越权加需求外功能；不自动 commit / push。

---

## 5. 闸门（填真实数字，禁止留空）

### 5.0 前置（命令规范，强制）

- 跑闸门前确认机器状态：记录是否有 `nest start --watch` / `vite dev` / `node dist/app` 常驻进程（墙钟可比性以用例数 / 文件数为准，不杀用户进程）；跑 `pnpm doctor:fs` 记录结果。
- 取证会话 PATH 先补 `D:\Apps\Git\cmd`（依赖外部命令的 spec 才不会假失败）。

### 5.1 收尾闸门（本单跑一次，记录真实命令 / exit / 数字）

| 闸门         | 命令                                                                    | 要求                                                                                                                           |
| ------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 盘读前置     | `pnpm doctor:fs`                                                        | exit 0，记录均值 ms/文件与 slow 占比                                                                                           |
| 根类型       | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` | 0 error                                                                                                                        |
| 构建类型     | `pnpm exec tsc -p tsconfig.build.json --noEmit`                         | 0 error                                                                                                                        |
| Lint（权威） | `pnpm lint`                                                             | 0 error，记录 warning 数（基线既有 1 条 e2e warning，范围外不修）                                                              |
| oxlint fast  | `pnpm lint:fast`                                                        | 0 warning / 0 error                                                                                                            |
| 定向 spec    | `pnpm exec vitest run test/life-map/`（新端口替身 spec）                | 全绿，记录用例数 / 文件数                                                                                                      |
| 全量测试     | `pnpm test`                                                             | exit 0；既有 **3263 例 / 195 文件**集合不减少、既有断言不改；记录总用例数、文件数、墙钟与机器状态；增量 = 本单新增 spec 用例数 |
| engine-core  | `git diff --stat HEAD -- src/engine-core`                               | 空                                                                                                                             |
| 范围隔离     | `git diff --name-only HEAD`                                             | 改动仅限 `src/life-map/`、`test/life-map/` 与交付文档；无 package.json / tsconfig / vitest 配置 / CI / 其他业务域改动          |
| 边界         | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                | 12 passed                                                                                                                      |
| 静态复核     | §3.2 四项 grep 证据                                                     | 逐条结果落交付记录                                                                                                             |

> 验收侧不重跑全量；执行方交付记录里的闸门数字 + CI 结果作为合并底线。

---

## 6. 交付记录（完成后写，路径固定）

`docs/worklog/completed/phase2.5/td16-life-map-port-pilot-c1-implementation-2026-11-14.md`

内容必须含：

1. 本单做了什么（一句话：life-map 域按 TD-13 四件套落地仓储端口，产出域级模板 + 首个 spec 零 entity import 样板）；
2. 改动文件清单（新建 / 修改，逐个一句用途；端口划分粒度与理由）；
3. 端口方法面清单（接口 / token / 入参 / Row 类型 / 唯一调用方）；
4. 闸门表：命令 / exit code / 真实数字（error、warning、用例总数、文件数、墙钟与机器状态）；
5. typeorm 符号外泄复核表（受检文件逐个命中数）；
6. service 行为与改前对照表（查询口径 / 软删过滤 / 排序 / 隔离 / 静默失败 / DTO 转换）；
7. 边界确认：entity 文件零改动、DTO / controller / 其他业务域 / migration / 配置未动；既有 spec 断言与 mock 语义未改；
8. 遗留项：§2 另案 C2/G / I / J / K / M / N 逐条登记；Actions 侧待复核点（若有）；
9. 一行 commit message 草稿（**不自己 commit / push**，等用户指令）。

---

## 7. 【交付回写清单】做完逐项勾选（硬清单，不许跳）

- [x] 交付记录已写到 §6 固定路径
- [x] 本任务单从 `pending/` 移到 `completed/phase2.5/`，顶部状态行改 ✅ 并链交付记录
- [x] 回写 WP 登记表：`docs/worklog/pending/phase2.5-wp-list-2026-11-08.md` §四 TD-16 行改完成态、补交付记录链接
- [x] 回写阶段入口：`docs/worklog/pending/phase2.5-README.md` §3.0 TD-16 bullet 改完成态
- [x] 回写台账：`docs/team/gate-performance-remediation-2026-11-11.md` §9 P-DEBT-11 行追加 C1 落地结论 + 链接；更新记录补一条；另案 C2/G/I/J/K/M/N 登记口径更新
- [x] `git diff --stat HEAD -- src/engine-core` 为空；`src/migration/` 零改动
- [x] 提交分组核对：本单文件与并行进程产物分开；若授权代提交，stage 只含本单文件
- [x] 给一行 commit message 草稿（**不自己 commit / push**，等用户指令）

---

## 8. 回复输出约定

完成后在对话里：

1. 说一句"已写入交付记录"并附文件路径，不重复贴全文；
2. 报告闸门真实数字（tsc / eslint / vitest 用例数 / boundary）；
3. 报告本单结论一句话（life-map 端口化完成、spec 零 entity import）+ §7 回写清单哪几项已做、有没有遗留；
4. 不把代码 diff 全文贴进对话，让用户自己 `git diff` / 打开交付记录。

---

_本单不新增第三方依赖；不改 schema / migration；仅 life-map 域仓储端口化 + 新增端口替身 spec；engine-core 零 diff；未自动 commit / push。_
