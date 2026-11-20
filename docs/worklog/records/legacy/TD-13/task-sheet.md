# TD-13 · 仓储端口抽象试点（analytics 域 · L-1b 首个业务域落地）

> 状态：✅ **已交付**（2026-11-14，MiniMax Code）→ [交付记录](td13-repository-port-analytics-pilot-implementation-2026-11-14.md)
> 执行方：MiniMax Code
> 仓库：E:\Work\Project\backend\mofang-nestjs，分支 integrate
> 唯一事实源：`docs/worklog/completed/phase2.5/td11-ci-tooling-and-typeorm-type-import-implementation-2026-11-14.md` §五 / §7.3（L-1b 定性）+ `docs/team/gate-performance-remediation-2026-11-11.md` §9 P-DEBT-11
> 任务性质：结构重构（service 层仓储端口化试点；零业务行为变化）
> 改动范围：仅后端 `src/analytics/` + 新增 `test/analytics/` + 本任务文档与索引回写；不碰 `engine-core/`、不碰其他业务域、不碰前端

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `E:\Work\Project\backend\mofang-nestjs\README.md` —— 仓库总览
2. `E:\Work\Project\backend\mofang-nestjs\docs\README.md` —— 文档导航
3. `E:\Work\Project\backend\mofang-nestjs\docs\team\conventions.md` —— 代码红线 + 交付格式（§1.1 engine-core 分层、§1.3 pnpm 命令规范、§三 16 条硬约束）
4. 阶段工作入口：`docs/worklog/pending/phase2.5-README.md` 与 `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md`
5. 端口先例（本单模板，逐字对齐其结构与注释风格）：
   - `src/agent/supervisor/domain/repositories/supervision-report.repository.ts`（interface + Symbol token）
   - `src/agent/supervisor/data/supervision-report.repository.typeorm.ts`（TypeORM 实现）
   - `src/agent/supervisor/supervisor.module.ts`（provider 注册与 exports）
   - `test/agent/wp18-supervisor-report.spec.ts`（端口替身 spec 写法）
6. 本任务单（就是你在读的这份）

---

## 1. 背景（先读，方向别错）

P-DEBT-11 / L-1b：src 侧 service 直接 `@InjectRepository(Entity)` 依赖 typeorm `Repository`，仓储实现与业务 service 耦在一起。TD-11（L-1a）已把 **48 个**文件的 `Repository` 值导入收窄为 `import type`，但实测 **import 加载图收益为 0** —— 同域 entity 装饰器仍把 typeorm 拉进 spec 闭包；service 层对 `Repository` 的运行时依赖没有解除。

仓内已有成熟端口先例（agent/supervisor、agent/persona、engine-core、auto-practice）：service 只依赖仓储 **interface + DI token**，TypeORM 实现藏在 `data/` 目录，spec 用端口替身、不连真库。本单把这套模式在 **analytics 域**做首个业务域试点，固化可复制的端口化模板；其余域登记另案分批推广，本单不铺开。

### 关键现状（已由主控核对，别当新问题）

- **analytics 目录树**（`src/analytics/`）：
  - `analytics.module.ts` —— `imports: [TypeOrmModule.forFeature([AnalyticsEvent])]`；`providers: [AnalyticsService, AnalyticsEventTrackerService]`；`exports: [AnalyticsService, AnalyticsEventTrackerService]`。
  - `controllers/analytics.controller.ts` —— 只注入 `AnalyticsService`，**不直接碰 Repository**（本单不改 controller）。
  - `dto/analytics.dto.ts` —— `AnalyticsOverviewDto` / `TimeRange`（本单不改）。
  - `entities/analytics-event.entity.ts` —— `AnalyticsEvent` entity + `AnalyticsEventType` enum（本单不改字段 / 装饰器 / 表结构）。
  - `providers/analytics-event-tracker.service.ts`（58 行）—— 注入 `Repository<AnalyticsEvent>`；`record(...)` 仅 `events.save(events.create({...}))`，**静默 catch + warn**（写失败不影响主流程、不 throw）。
  - `providers/analytics.service.ts`（154 行）—— 注入 `Repository<AnalyticsEvent>`；`getOverview(tenantId, range)` 内：`events.count({ where: { tenantId, eventType, createdAt: Between(start, end) } })` ×2（KPI 1 发布量、KPI 2 分母）、`events.find({ where, select: { createdAt: true } })` ×1（trend 分桶）；`Between` 是 typeorm 值符号。`timeRangeWindow` / `bucketCount` / `buildTrend` 是**纯计算**，留在 service。
- **测试侧现状**：analytics 无专属 spec；仓内 44 个 spec 用 Repository token / `getRepositoryToken` mock。本单新增端口替身 spec（见 §3 交付物 3）。
- **基线闸门**（HEAD `d718904`，TD-12 交付后）：全量 **3248 passed + 4 skipped（3252 例 / 194 文件）**；lint 0 error / 1 warning（`test/e2e/v2-user-flow.spec.ts:1` 既有 unused eslint-disable，范围外不修）；boundary **12 passed**。
- **端口先例要点**（照 supervisor 对齐）：
  - 端口文件 = `interface XxxRepository` + `export const XXX_REPOSITORY = Symbol('XXX_REPOSITORY')`；方法按业务面命名，**不用泛型 `Repository<T>`**；不暴露 `EntityManager`；不在接口写 SQL。
  - TypeORM 实现 = `@Injectable() class XxxRepositoryTypeorm implements XxxRepository`，构造 `@InjectRepository(Entity) repo: Repository<Entity>`；`Between` / `In` / `FindOptions` 等 typeorm 值符号**只出现在实现内**。
  - module：保留 `TypeOrmModule.forFeature([Entity])`，新增 provider `{ provide: TOKEN, useClass: XxxRepositoryTypeorm }`；需要跨模块消费时才 export token（analytics 当前不跨模块消费仓储，按现状判断是否 export）。
  - spec：`import type { XxxRepository }`，返回 `{...} as unknown as XxxRepository` 替身；全 mock，不起真 TypeORM、不连 DB。

---

## 2. 范围（严格遵守，不越权）

### 在范围内

1. **新增端口** `src/analytics/domain/repositories/analytics-event.repository.ts`：
   - `interface AnalyticsEventRepository` + Symbol token `ANALYTICS_EVENT_REPOSITORY`。
   - 方法面**只收现有两个 service 实际用到的查询**（命名 / 入参类型可按 supervisor 先例微调，但不得泛化成 `Repository<T>` 代理）：
     - `record(input: AnalyticsEventRecordInput): Promise<void>` —— tracker 写一行；
     - `countByType(tenantId: string, eventType: AnalyticsEventType, start: Date, end: Date): Promise<number>` —— KPI count ×2 复用；
     - `findCreatedAtBetween(tenantId: string, eventType: AnalyticsEventType, start: Date, end: Date): Promise<readonly Date[]>` —— trend 分桶只需 `createdAt`（若实现上返回行类型更顺，可返回只读行数组，但端口不得暴露 entity 类名以外的 typeorm 类型）。
   - 端口文件**不 import** typeorm 的任何值符号（`Repository` / `Between` / `FindOptions` / `EntityManager` 等）；入参 / 返回类型用 domain 类型或原始类型。
   - 记录输入类型（`AnalyticsEventRecordInput` 或等价命名）放端口文件或 `analytics.types.ts`，字段 = tracker 现有 `create({...})` 的五个业务字段（tenantId / eventType / itemId / userId / metadata），不含 `id` / `createdAt`（后者由 DB / `CreateDateColumn` 填）。

2. **新增 TypeORM 实现** `src/analytics/data/analytics-event.repository.typeorm.ts`：
   - `@Injectable() class AnalyticsEventRepositoryTypeorm implements AnalyticsEventRepository`；构造注入 `@InjectRepository(AnalyticsEvent)`。
   - `Between` / `select` / `create` / `save` / `count` / `find` 全部收在本实现内；service 不再直接调用这些 Repository API。
   - 实现内不新增查询口径、不改过滤条件（tenantId 隔离、eventType、时间窗与改前逐字一致）。

3. **改 `analytics.module.ts`**：保留 `TypeOrmModule.forFeature([AnalyticsEvent])`；providers 注册 `{ provide: ANALYTICS_EVENT_REPOSITORY, useClass: AnalyticsEventRepositoryTypeorm }`；两个 service 改由 token 注入端口。

4. **改两个 service**：
   - 移除 `@InjectRepository`、`Repository`、`Between` 的 typeorm 值导入；构造参数改为 `@Inject(ANALYTICS_EVENT_REPOSITORY) private readonly events: AnalyticsEventRepository`（字段名可沿用 `events` / `repo`）。
   - `AnalyticsEventTrackerService.record` 静默 catch + warn 语义逐字保留；`AnalyticsService.getOverview` 的 KPI 计算、分母为 0 的转化率保护、trend 分桶逻辑**原样保留在 service**，只把仓储调用换成端口方法。
   - 纯计算（`timeRangeWindow` / `bucketCount` / `buildTrend`）不搬进仓储。

5. **新增端口替身 spec** `test/analytics/` 下（文件名按仓内命名惯例，如 `analytics-overview.service.spec.ts` + `analytics-event-tracker.service.spec.ts`，或合一文件）：
   - 端口替身驱动两个 service；不起 TestingModule 真装配、不连 DB、不 `vi.mock('typeorm')`。
   - 覆盖：tracker 成功记录路径 + 仓储 reject 时**静默 catch 不 throw**；service KPI 计数、分母为 0 时转化率返 0、trend 按桶计数；断言端口替身方法被以正确参数调用。

6. **文档与索引回写**（§7 清单）：交付记录、任务单归档、wp-list / README / 台账 / toolchain 四处索引改完成态并链交付记录。

### 明确不在范围内（禁止顺手做）

- **不推广到其他域**：其余 **117 个**直接注入 `Repository` 的 service（counselor 33 文件 / 63 处为最大域）一律另案分批；本单只动 analytics 域。
- **不做 entity 运行时依赖消除**（L-1b 的第②步）：`@Entity` / `@Column` 装饰器的 typeorm 运行时求值解耦（纯类 + 外部 schema 映射）是独立大改，本单不碰；entity 文件一字不改。
- **不补内存仓储实现**：supervisor 的 memory 实现服务 V0 调试 / 进程内替身；analytics 无此需求，本单只交付 TypeORM 实现 + spec 端口替身；是否补 memory impl 另案评估。
- 不改表结构 / migration / entity 字段 / DTO / controller 路由 / 枚举值；不改 `engine-core/`，`boundary.spec.ts` 不许改。
- 不新增第三方依赖；不改 `package.json`（scripts 与依赖）、tsconfig、Dockerfile / Dockerfile.prod、`.nvmrc`、CI `node-version`、`.github/workflows/`。
- 不改既有 spec / 夹具 / helper 的断言期望与 mock 语义；不为其他模块补测试。
- 不碰 `admin-dashboard/` 与 Flutter；不自动 git commit / push（写完给 commit 草稿，等用户指令）。

### 另案登记（本单不做，写入交付记录遗留段）

- G. 其余 service 仓储端口化分批推广 —— 按域分批，counselor（33 文件 / 63 处）优先排期评估；每批沿用本单端口模板。
- H. entity 装饰器运行时依赖消除（纯类 + schema 映射）—— 测试侧 typeorm 闭包解耦的根因项，需独立方案评估。
- I. 端口内存实现是否补 —— 视调试 / 进程内替身需求评估。
- J. 混合形态 typeorm import 文件统一形态（`import { Between, Repository } from 'typeorm'` → inline `type Repository`）—— 可读性向，零运行时收益，另案批量处理。

---

## 3. 目标架构 / 交付物

- **交付物 1：仓储端口** —— `src/analytics/domain/repositories/analytics-event.repository.ts`：interface + Symbol token + 记录输入类型；typeorm 值符号零外泄。
- **交付物 2：TypeORM 仓储实现** —— `src/analytics/data/analytics-event.repository.typeorm.ts`：实现端口接口，封装全部 typeorm 查询条件；module provider 接线。
- **交付物 3：service 改造 + 端口替身 spec** —— 两个 service 改依赖端口；新增 `test/analytics/` spec，端口替身驱动，覆盖成功 / 静默失败 / KPI 分母保护 / 分桶。
- **交付物 4：交付记录** —— §6 固定路径，含改动清单、闸门真实数字、端口方法面与先例对照、偏差登记。

> **口径真相源**：`AnalyticsEventRepository` interface 是 analytics 仓储契约的唯一真相源；service 与 spec 只读取端口类型，不在 service / spec 复算仓储查询口径或另抄查询条件。端口方法签名若与 §2.1 建议有出入，在交付记录 §二 偏差表写清原方案 / 实际方案 / 理由（conventions §2.5）。

---

## 4. 红线（违反即返工）

- 分层归属：本单不触碰 engine-core；`git diff --stat HEAD -- src/engine-core` 必须为空，`boundary.spec.ts` 不改。
- **typeorm 类型不外泄**：端口 interface、两个 service、新 spec 中不得出现 `Repository<...>` / `FindOptions` / `Between` / `EntityManager` 等 typeorm 值类型；这些只允许出现在 TypeORM 实现文件内。
- **业务语义零漂移**：tracker 静默失败（catch + warn、不 throw）不变；service 的 tenantId 隔离、eventType 过滤、时间窗、分母为 0 保护、分桶口径与改前逐字一致；spec 对照确认 KPI 数值与分桶结果不变。
- 端口不泛化成通用 `Repository<T>` 代理，不暴露 EntityManager，不在接口 / service 写 SQL。
- 若发现现有调用面超出 §2.1 三条方法（如出现新的查询形态），**停下回报主控**，不自行扩接口塞通用代理，也不改查询口径。
- 心理对话原文禁止进日志 / console / crash report（只出码和计数）。
- pnpm 命令规范：一律 `pnpm` / `pnpm exec`，禁止裸 `npx`。
- schema / migration / entity 字段 / 映射函数 / controller 路由不碰；不越权加需求外功能。
- 不自动 commit / push。

---

## 5. 闸门（分层执行，填真实数字，禁止留空）

### 5.0 前置（命令规范，强制）

- 跑闸门前确认机器干净：无 `nest start --watch` / `vite dev` / `node dist/app` 常驻；跑 `pnpm doctor:fs` 记录结果（读税体检）。
- 取证会话 PATH 先补 git：`D:\Apps\Git\cmd`（依赖外部命令的 spec 才不会假失败）。

### 5.1 收尾闸门（本单跑一次，记录真实命令 / exit / 数字）

| 闸门         | 命令                                                                    | 要求                                                                                                                       |
| ------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 盘读前置     | `pnpm doctor:fs`                                                        | exit 0，记录均值 ms/文件与 slow 占比                                                                                       |
| 根类型       | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` | 0 error                                                                                                                    |
| 构建类型     | `pnpm exec tsc -p tsconfig.build.json --noEmit`                         | 0 error                                                                                                                    |
| Lint（权威） | `pnpm lint`                                                             | 0 error，记录 warning 数（基线既有 1 条 e2e warning，范围外不修）                                                          |
| oxlint fast  | `pnpm lint:fast`                                                        | 0 warning / 0 error                                                                                                        |
| 全量测试     | `pnpm test`                                                             | exit 0；既有 **3252 例 / 194 文件**集合不减少、既有断言不改；记录本单新增 spec 文件数与新增例数、总用例数、墙钟与机器状态  |
| engine-core  | `git diff --stat HEAD -- src/engine-core`                               | 空                                                                                                                         |
| 范围隔离     | `git diff --name-only HEAD`                                             | 改动仅落在 `src/analytics/`、`test/analytics/`、本单文档；无 `package.json` / tsconfig / CI / entity 字段 / 其他业务域改动 |
| 边界         | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                | 12 passed                                                                                                                  |
| 端口隔离复核 | grep 端口文件 / 两个 service / 新 spec                                  | 无 `Repository` / `Between` / `FindOptions` / `EntityManager` typeorm 值符号（仅 TypeORM 实现文件除外）                    |

> 验收侧不重跑全量；执行方交付记录里的闸门数字 + CI 结果作为合并底线。定向核对见模板 §5.4。

---

## 6. 交付记录（完成后写，路径固定）

`docs/worklog/completed/phase2.5/td13-repository-port-analytics-pilot-implementation-2026-11-14.md`

内容必须含：

1. 本单做了什么（一句话总结）；
2. 方案设计：实际实现 vs 任务单方案；偏差逐条写清原方案 / 实际方案 / 理由（conventions §2.5）；
3. 改动文件清单（新建 / 修改 / 删除，逐个一句用途）；
4. 闸门表：命令 / exit code / 真实数字（error、warning、用例总数与新增例数、文件数）；
5. 任务特有结果：端口方法面清单、typeorm 符号外泄复核结果（grep 证据）、service 行为与改前对照（KPI / 分桶 / 静默失败）；
6. 风险与回归：确认未碰 engine-core / schema / entity 字段 / DTO / controller / 其他业务域；既有 spec 断言与 mock 语义未改；
7. 遗留项：§2 另案 G–J 逐条登记 + Actions 侧待复核点（若有）。

---

## 7. 【交付回写清单】做完逐项勾选（硬清单，不许跳）

- [ ] 交付记录已写到 §6 固定路径
- [ ] 本任务单从 `pending/` 移到 `completed/phase2.5/`，顶部状态行改 ✅ 并链交付记录
- [ ] 回写 WP 登记表：`docs/worklog/pending/phase2.5-wp-list-2026-11-08.md` §四 TD-13 行改完成、补交付记录链接
- [ ] 回写阶段入口：`docs/worklog/pending/phase2.5-README.md` §3.0 TD-13 bullet 改完成态
- [ ] 回写台账：`docs/team/gate-performance-remediation-2026-11-11.md` §9 P-DEBT-11 行追加 L-1b 试点落地结论 + 链接；更新记录补一条；另案 G–J 登记到该行遗留段（`phase2.5-toolchain-tech-debt-2026-11-11.md` 仅覆盖 TD-1~4 工具链债，无 L-1b 段落，不另加）
- [ ] `git diff --stat HEAD -- src/engine-core` 为空
- [ ] 提交分组核对：本单文件与并行进程产物分开；若授权代提交，stage 只含本单文件
- [ ] 给一行 commit message 草稿（**不自己 commit / push**，等用户指令）

---

## 8. 回复输出约定

完成后在对话里：

1. 说一句"已写入交付记录"并附文件路径，不重复贴全文；
2. 报告闸门真实数字（tsc / eslint / vitest 用例数 / boundary）；
3. 报告 §7 回写清单哪几项已做、有没有遗留；
4. 不把代码 diff 全文贴进对话，让用户自己 `git diff`。

---

_本单无新增第三方依赖；无 schema / migration 变更；仅 analytics 域 service 层端口化 + 新增端口替身 spec；未自动 commit / push。_
