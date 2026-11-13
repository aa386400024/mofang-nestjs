# TD-13 · 仓储端口抽象试点（analytics 域 · L-1b 首个业务域落地）交付记录

| 项        | 值                                                                                                                                                       |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 任务单    | `docs/worklog/completed/phase2.5/td13-repository-port-analytics-pilot-task-2026-11-14.md`（交付时由 `pending/` 归档至本目录）                            |
| 事实源    | `docs/team/gate-performance-remediation-2026-11-11.md` §9 P-DEBT-11（L-1b）+ TD-11 交付记录 §五 / §7.3                                                   |
| 基线 HEAD | `d718904`（TD-12 已交付）                                                                                                                                |
| 执行      | MiniMax Code，2026-11-14                                                                                                                                 |
| 闸门      | 全绿；全量 **3259 passed + 4 skipped（3263 例 / 195 文件）**，基线 3252 例 / 194 文件 → 净增 **+11 例 / +1 文件**（= 本单新增 spec），既有集合**零减少** |
| 改动面    | `src/analytics/`（3 改 + 2 新）+ `test/analytics/`（1 新）+ 本单文档；**engine-core 0 行**、entity / DTO / controller / 其他业务域 **0 改动**            |

---

## 一、本单做了什么

把仓内成熟的「仓储端口」模式（**interface + Symbol DI token**，TypeORM 实现收进 `data/`，spec 用端口替身）首次落到业务域：`src/analytics/` 新增 `AnalyticsEventRepository` 端口与 `AnalyticsEventRepositoryTypeorm` 实现，两个 analytics service 从 `@InjectRepository(AnalyticsEvent)` 改依赖 `@Inject(ANALYTICS_EVENT_REPOSITORY)`，module 增加 provider 接线，新增 `test/analytics/` 端口替身 spec（11 例）。**业务行为零漂移**：KPI 数值、分母为 0 保护、trend 分桶口径、tracker 静默 catch + warn 语义逐字未变。

本单同时**固化可复制模板**（端口文件 / 实现文件 / module 接线 / spec 替身四件套），其余域分批推广登记为另案 G。

---

## 二、方案设计：实际实现 vs 任务单方案（偏差登记，conventions §2.5）

| 编号 | 任务单原方案                                                                                                        | 实际方案                                                                                                          | 理由                                                                                                                                                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1  | §2.5 spec 文件名建议 `analytics-overview.service.spec.ts` + `analytics-event-tracker.service.spec.ts`（或合一文件） | **合一文件** `test/analytics/td13-analytics-repository-port.spec.ts`（工作项前缀 + 端口语义）                     | 仓内 `test/` 文件普遍带工作项前缀（`test/quality/d1-event-classifier-evidence.spec.ts`、`test/engine-core/i20-...spec.ts`），比裸业务名更贴惯例；合一文件可复用同一套端口替身工厂，避免两份替身漂移                                                  |
| D-2  | §2.1 `findCreatedAtBetween` 返回 `readonly Date[]`「或返回只读行数组」                                              | 返 `readonly Date[]`（**只出 createdAt，不返整行**）                                                              | 端口出参若返整行，service 会拿到 `metadata` 等与分桶无关的字段，并把 entity 行形状漏进业务层；trend 分桶只需时间戳。返 Date 序列同时满足「端口不得暴露 entity 类名以外的 typeorm 类型」                                                              |
| D-3  | 未要求改 tracker 公共签名                                                                                           | **保持** `record(tenantId, eventType, itemId, userId, metadata)` 5 个位置参数不变                                 | 跨模块消费方 `src/knowledge-base/providers/knowledge.service.ts`（5 workflow action + 1 schedule action）按位置参数调用；改签名 = 越权改别的业务域（§2「不推广到其他域」）。端口的 `record(input)` 只在 tracker **内部**使用                         |
| D-4  | §1「需要跨模块消费时才 export token（按现状判断是否 export）」                                                      | **不 export** 仓储 token（`exports` 仍只含两个 service）                                                          | analytics 仓储无跨模块消费方（跨模块只消费 `AnalyticsEventTrackerService` 这个 service）。supervisor 先例 export token 是因为 counselor 侧要读同一份报告，analytics 无此需求 —— 照抄会凭空开第二个入口                                               |
| D-5  | §5.1「端口隔离复核 grep … 无 typeorm 值符号」                                                                       | 端口 / 两个 service 的**注释文案也刻意不含** typeorm 值符号字面量（改用「泛型仓储代理」「区间操作符」等中文描述） | 否则 §5.1 的 grep 会把注释里的散文计入命中数，闸门数字失真（实测：改词前端口文件命中 4 处、service 命中 1 处，**全部在注释里**）。改词后四个受检文件实测 **0 命中**，闸门数字可直接复核                                                              |
| D-6  | §2 明确「entity 文件一字不改」                                                                                      | 枚举 `AnalyticsEventType` **仍留在 entity 文件**，service 值导入该枚举                                            | 任务单把「entity 装饰器运行时依赖消除」列为 L-1b 第②步并明确排除在本单外（另案 H）。因此 service 的**传递**闭包里仍有 typeorm 一条边（entity 装饰器求值）—— 事实登记在 §5.4，**本单不承诺 import 加载图收益**（TD-11 已实测 type-only 收窄收益为 0） |
| D-7  | §5.1 只列 `pnpm lint:fast`                                                                                          | 额外跑 `pnpm lint:deep`（type-aware）                                                                             | 成本极低（与 fast 同一次编译缓存），与 TD-9 记录的 deep 0/0 基线对照，防止本单引入 type-aware 告警                                                                                                                                                   |

---

## 三、改动文件清单

### 3.1 新建（3 个）

| 文件                                                              | 用途                                                                                                                                                                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/analytics/domain/repositories/analytics-event.repository.ts` | **端口**（唯一真相源）：`AnalyticsEventRepository` interface（3 个方法）+ `AnalyticsEventRecordInput` 记录入参类型 + `ANALYTICS_EVENT_REPOSITORY` Symbol token。零 typeorm 值符号（type-only 引入枚举） |
| `src/analytics/data/analytics-event.repository.typeorm.ts`        | **TypeORM 实现**：`@InjectRepository(AnalyticsEvent)` + `Between` / `count` / `find(select createdAt)` / `create+save` 全部收在本文件；analytics 域**唯一**允许出现 typeorm 值符号的文件                |
| `test/analytics/td13-analytics-repository-port.spec.ts`           | **端口替身 spec**（11 例）：替身只记调用参数 + 返回预设计数 / 时间戳序列；不起真 TypeORM、不连 DB、不 `vi.mock('typeorm')`；含 fake timers 钉住时间窗                                                   |

### 3.2 修改（3 个）

| 文件                                                         | 改动                                                                                                                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/analytics/providers/analytics.service.ts`               | 依赖改端口；2 次 `count({where})` → `countByType(...)`；1 次 `find({select})` → `findCreatedAtBetween(...)`；纯计算（timeRangeWindow / bucketCount / 分桶）**原样保留**   |
| `src/analytics/providers/analytics-event-tracker.service.ts` | 依赖改端口；`events.save(events.create({...}))` → `events.record({...})`；**静默 catch + warn 文案逐字未变**；公共方法签名未变                                            |
| `src/analytics/analytics.module.ts`                          | 新增 provider `{ provide: ANALYTICS_EVENT_REPOSITORY, useClass: AnalyticsEventRepositoryTypeorm }`；**保留** `TypeOrmModule.forFeature([AnalyticsEvent])`；`exports` 未变 |

### 3.3 删除（0 个）

### 3.4 范围核对（实测）

| 项                        | 命令                                      | 结果                                                                                                                           |
| ------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| engine-core               | `git diff --stat HEAD -- src/engine-core` | **空（0 行 0 文件）**                                                                                                          |
| 业务域代码                | `git diff --name-only HEAD -- src`        | **3 个文件，全部在 `src/analytics/`**：analytics.module.ts / analytics.service.ts / analytics-event-tracker.service.ts         |
| 其他业务域                | 同上                                      | **0 个**（counselor / practice / knowledge-base / agent / engine-adapters 等均未触碰）                                         |
| entity / DTO / controller | `git status --short`（未跟踪清单）        | **未改**：`entities/analytics-event.entity.ts`、`dto/analytics.dto.ts`、`controllers/analytics.controller.ts` 均不在改动清单内 |
| 测试目录                  | `git status --short`                      | **仅新增 `test/analytics/`**（1 文件）；既有 spec **0 改动**（断言 / mock 语义未动）                                           |
| 配置 / 依赖               | 同上                                      | **0 改动**：无 package.json / tsconfig / vitest.config / CI / Dockerfile 变更；无新增第三方依赖                                |
| 本单文档                  | 同上                                      | 3 个索引文档（台账 / phase2.5-README / wp-list）+ 任务单归档 + 交付记录                                                        |

---

## 四、闸门表（真实命令 / exit code / 真实数字）

| 闸门                   | 命令                                                                         | exit        | 真实数字                                                                                                                                                                                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 盘读前置               | `pnpm doctor:fs`                                                             | 0           | **合格**：per-file 均值 **0.09 ms/文件**、slow=**0**、walk 23 ms / cold 25 ms / warm 18 ms                                                                                                                                                                                |
| 根类型                 | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`      | 0           | **0 error**                                                                                                                                                                                                                                                               |
| 构建类型               | `pnpm exec tsc -p tsconfig.build.json --noEmit`                              | 0           | **0 error**                                                                                                                                                                                                                                                               |
| Lint（权威）           | `pnpm lint`                                                                  | 0           | **0 error / 1 warning**（`test/e2e/v2-user-flow.spec.ts:1` unused eslint-disable —— 基线既有、e2e 范围外，**未修**）                                                                                                                                                      |
| oxlint fast            | `pnpm lint:fast`                                                             | 0           | **0 warning / 0 error**                                                                                                                                                                                                                                                   |
| oxlint deep（额外）    | `pnpm lint:deep`                                                             | 0           | **0 warning / 0 error**                                                                                                                                                                                                                                                   |
| 定向 spec              | `pnpm exec vitest run test/analytics/td13-analytics-repository-port.spec.ts` | 0           | **1 文件 / 11 例全过**                                                                                                                                                                                                                                                    |
| **全量测试**           | `pnpm test`                                                                  | **0**       | **194 passed                                                                                                                                                                                                                                                              | 1 skipped（195 文件）**、**3259 passed | 4 skipped（3263 例）**；Duration **66.04 s**（import 82% / tests 14% / worker 2% / transform 2%） |
| 边界                   | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                     | 0           | **12 passed**                                                                                                                                                                                                                                                             |
| engine-core            | `git diff --stat HEAD -- src/engine-core`                                    | 0           | **空**                                                                                                                                                                                                                                                                    |
| 范围隔离               | `git diff --name-only HEAD` + `git status --short`                           | 0           | tracked **6 个**（3 文档 + 3 个 `src/analytics/`）+ untracked **4 个**（任务单 + `src/analytics/data/` + `src/analytics/domain/` + `test/analytics/`）                                                                                                                    |
| 端口隔离复核           | `grep -nE "\bRepository\b                                                    | \bBetween\b | \bFindOptions\b                                                                                                                                                                                                                                                           | \bEntityManager\b                      | from 'typeorm'                                                                                    | from '@nestjs/typeorm'" <file>` | 0   | 受检 4 文件 **0 命中**；逐文件明细见 §5.2 |
| 运行时 DI 验证（额外） | `Invoke-WebRequest http://localhost:3000/health`                             | 0           | **HTTP 200**（`database: up` / `redis: up`）；`dist/analytics/analytics.module.js` 含 `provide: ANALYTICS_EVENT_REPOSITORY` + `useClass: AnalyticsEventRepositoryTypeorm`（build 02:22:10 晚于 src 02:22:01），运行中的 `node dist/app`（PID 12632，02:22:11 起）即该产物 |

**用例数对照（基线 vs 本单）**：基线 **3248 passed + 4 skipped（3252 例 / 194 文件）** → 本单 **3259 passed + 4 skipped（3263 例 / 195 文件）**，差值 **+11 例 / +1 文件**，与本单新增 spec 的 **11 例 / 1 文件** **逐项吻合** ⇒ 既有 3252 例集合**零减少**、既有断言与 mock 语义**未改**。

**机器状态（实测，不干净）**：5 个 node 常驻进程 —— `pnpm start:dev`（PID 12992）、`nest start --watch`（PID 14612）、`pnpm dev`（PID 20740）、`admin-dashboard` vite dev（PID 7860）、`node dist/app`（PID 12632）。**未擅自杀用户进程**；墙钟 66.04 s 与历史基线**不作直接比较**（同一台机器同一负载），盘读延迟经 `pnpm doctor:fs` 判定合格。

**取证会话 PATH**：跑闸门前补 `D:\Apps\Git\cmd`（依赖外部命令的 spec 才不会假失败）。

---

## 五、任务特有结果

### 5.1 端口方法面清单（AnalyticsEventRepository，3 个方法，与 §2.1 建议逐条对齐）

| 方法                                                                              | 入参                                                            | 出参           | 唯一调用方                                                             |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------- |
| `record(input: AnalyticsEventRecordInput): Promise<void>`                         | 5 业务字段（tenantId / eventType / itemId / userId / metadata） | 无             | `AnalyticsEventTrackerService.record`（写一行）                        |
| `countByType(tenantId, eventType, start, end): Promise<number>`                   | 租户 + 类型 + 时间窗                                            | 命中条数       | `AnalyticsService.getOverview`（KPI 1 分子 + KPI 2 分母共用 1 个方法） |
| `findCreatedAtBetween(tenantId, eventType, start, end): Promise<readonly Date[]>` | 租户 + 类型 + 时间窗                                            | createdAt 序列 | `AnalyticsService.buildTrend`（trend 分桶数据源）                      |

**方法面守住了**：未发现超出 §2.1 的调用形态（改前共 3 处仓储调用 —— count ×2 + find ×1 → 端口化后仍是 **2 次 countByType + 1 次 findCreatedAtBetween**，spec 用例显式断言了调用次数）；**未扩通用仓储代理**、未暴露 typeorm 管理句柄、端口未写 SQL。

### 5.2 typeorm 符号外泄复核（grep 证据）

命令：`grep -nE "\bRepository\b|\bBetween\b|\bFindOptions\b|\bEntityManager\b|from 'typeorm'|from '@nestjs/typeorm'" <file>`（ripgrep，逐文件）

| 受检 / 参照文件                                                   | 命中  | 说明                                                                                                                                                               |
| ----------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/analytics/domain/repositories/analytics-event.repository.ts` | **0** | 受检文件：端口零 typeorm 值符号（枚举走 `import type`）                                                                                                            |
| `src/analytics/providers/analytics.service.ts`                    | **0** | 受检文件：service 零 typeorm 值符号（改前有 `import { Between, Repository } from 'typeorm'`）                                                                      |
| `src/analytics/providers/analytics-event-tracker.service.ts`      | **0** | 受检文件：tracker 零 typeorm 值符号（改前有 `InjectRepository` + `import type { Repository }`）                                                                    |
| `test/analytics/td13-analytics-repository-port.spec.ts`           | **0** | 受检文件：新 spec 零 typeorm 值符号（无 `vi.mock('typeorm')`、无 typeorm 导入）                                                                                    |
| `src/analytics/data/analytics-event.repository.typeorm.ts`        | 14    | **唯一允许**的 typeorm 值符号落点（实现文件）                                                                                                                      |
| `src/analytics/analytics.module.ts`                               | 1     | 装配层：`TypeOrmModule from '@nestjs/typeorm'` —— 任务单 §2.3 明确要求保留 `forFeature([AnalyticsEvent])`；`TypeOrmModule` 是 NestJS 装配 API，不是 typeorm 值符号 |
| `src/analytics/entities/analytics-event.entity.ts`                | 1     | entity 装饰器（`from 'typeorm'`）—— 任务单明确「entity 文件一字不改」，归属另案 H                                                                                  |

### 5.3 service 行为与改前对照（KPI / 分桶 / 静默失败）

| 行为点             | 改前（HEAD `d718904`）                                                                                                | 改后                                                                             | 对照结论                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| KPI 1 发布量       | `events.count({ where: { tenantId, eventType: KbPublished, createdAt: Between(start, end) } })`                       | `events.countByType(tenantId, KbPublished, start, end)` → 实现内条件**逐字一致** | 数值口径不变（spec 断言 = 3）                                    |
| KPI 2 分母         | `events.count({ ... DraftSubmitted ... })`                                                                            | `events.countByType(tenantId, DraftSubmitted, start, end)`                       | 同上（spec 断言 = 6）                                            |
| 分母为 0 保护      | `submitted > 0 ? kbPublished / submitted : 0`                                                                         | **一字未改**（仍在 service）                                                     | 0 时转化率返 0（非 NaN / 非 Infinity）                           |
| trend 分桶         | `events.find({ where, select: { createdAt: true } })` + `idx = min(floor((createdAt-start)/bucketMs), bucketCount-1)` | `events.findCreatedAtBetween(...)` → 返 Date 序列 + **分桶公式一字未改**         | week 7 桶口径一致（spec 断言 [1,0,1,0,0,0,1]），末端夹桶行为一致 |
| KPI 3 / KPI 4 占位 | 恒 0                                                                                                                  | **一字未改**                                                                     | 占位口径不动                                                     |
| tracker 静默失败   | `try { save(create({...})) } catch { logger.warn('record analytics event failed: type=... itemId=... err=...') }`     | catch + **warn 文案逐字相同**；写库动作下沉到端口实现                            | 不 throw、不影响主流程；成功路径不打 warn                        |
| tracker 公共签名   | `record(tenantId, eventType, itemId, userId, metadata = null)`                                                        | **一字未改**（knowledge-base 跨模块调用面零影响）                                | 跨模块消费方无需改动                                             |
| 租户隔离           | where 条件含 `tenantId`                                                                                               | 端口方法首参即 tenantId，实现内 where **含 tenantId**                            | 隔离口径不变（spec 断言 tenantId 透传）                          |
| 查询次数           | 2 × count + 1 × find                                                                                                  | **2 × countByType + 1 × findCreatedAtBetween**（spec 显式断言次数）              | 不多不少、无 N+1、无新查询                                       |

### 5.4 端口化后的 import 事实（诚实登记，不夸大收益）

- **直接边**：两个 service 对 typeorm / @nestjs/typeorm 的**直接导入边归零**（改前 analytics.service.ts 有 `import { Between, Repository } from 'typeorm'` + `InjectRepository`；tracker 有 `InjectRepository` + `import type { Repository }`）。
- **剩余传递边**：`AnalyticsEventType` 枚举仍定义在 entity 文件（任务单 §2 明确「entity 文件一字不改」），service **值导入**该枚举 → entity 装饰器求值把 typeorm 拉进 service 的传递闭包。**这条边是另案 H（entity 装饰器运行时依赖消除 / 纯类 + schema 映射）的范围，本单不碰**。
- **本单不承诺 import 加载图收益**：TD-11 已实测 type-only 收窄的加载图收益为 0（entity 装饰器是根因）。本单的可交付成果是**契约边界**（service 与 spec 不再依赖 TypeORM API 面）+ **可复制模板**；加载图收益要等另案 H 落地后才可能显现。

---

## 六、风险与回归

1. **engine-core 零改动**：`git diff --stat HEAD -- src/engine-core` **空**；`boundary.spec.ts` **未改**且 **12 passed**。
2. **schema / migration / entity 字段 / DTO / controller 路由 / 枚举值**：**0 改动**（未出现在改动清单内）。
3. **其他业务域**：**0 改动** —— 尤其 `src/knowledge-base/`（跨模块消费 tracker）**未动**，公共签名保持 ⇒ 跨模块行为零漂移。
4. **既有 spec**：**0 改动** —— 断言期望 / mock 语义 / 用例数量全部冻结；全量用例数只增不减（3252 → 3263，增量 = 本单新增）。
5. **依赖与配置**：无新增第三方依赖；`package.json` / tsconfig / `vitest.config.mts` / CI / Dockerfile 均未动。
6. **回归面**：module provider 接线是本单唯一的**运行时**风险点（单元测试直接 new service，不覆盖 DI 解析）—— 已用**运行时验证**兜住：运行中的 `node dist/app`（含本单产物的 build）`/health` 返回 **200**（DB / Redis 均 up），说明 Nest DI 图成功解析 `ANALYTICS_EVENT_REPOSITORY` token provider。
7. **隐私红线**：warn 文案只出 eventType / itemId / 错误信息，**不含心理对话原文**；spec 对该口径有断言。
8. **命令规范**：全程 `pnpm` / `pnpm exec`，**未用裸 npx**；**未自动 commit / push**。

---

## 七、遗留项

### 7.1 另案登记（任务单 §2 已列，本单不做）

| 编号 | 遗留项                                                                                  | 状态                                                                                    |
| ---- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| G    | 其余 service 仓储端口化分批推广（counselor **33 文件 / 63 处**为最大域）                | 🟠 **待排期** —— 每批沿用本单四件套模板（端口 / 实现 / module 接线 / spec 替身）        |
| H    | entity 装饰器运行时依赖消除（纯类 + 外部 schema 映射）                                  | 🟠 **待方案评估** —— 本单实测已定位：这是 analytics 域 typeorm 传递边的**根因**（§5.4） |
| I    | 端口内存实现是否补（进程内替身 / V0 调试用）                                            | 🟢 **暂不补** —— analytics 无该需求；本单 spec 已用端口替身覆盖替身需求                 |
| J    | 混合形态 typeorm import 统一形态（`import { Between, Repository }` → inline type 形式） | 🟢 **可读性向、零运行时收益** —— 另案批量处理（本单未动其他域的 import 形态）           |

### 7.2 Actions 侧待复核点

- **CI 侧结果待主控 push 后在 Actions 复核**（沿用 TD-11 / TD-12 口径）：本单闸门为本机实测（`pnpm test` exit 0、3263 例 / 195 文件）。
- **G 的排期**需主控拍板（按域分批 vs 按最大域优先）。
- **H 方案**需独立评估（涉及 entity 文件大改，会撞「entity 文件一字不改」的既有纪律，须先立单）。

---

_本单无新增第三方依赖；无 schema / migration 变更；仅 analytics 域 service 层端口化 + 新增端口替身 spec（11 例）；engine-core 零 diff；未自动 commit / push。_
