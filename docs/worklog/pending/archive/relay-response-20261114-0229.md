# TD-13 交付回复 · 仓储端口抽象试点（analytics 域 · L-1b 首个业务域落地）

> 时间：2026-11-14 02:29 GMT+8
> 仓库：E:\Work\Project\backend\mofang-nestjs，分支 integrate（基线 HEAD `d718904`）
> 交付记录：`docs/worklog/completed/phase2.5/td13-repository-port-analytics-pilot-implementation-2026-11-14.md`

---

## 一、结论

TD-13 已按任务单完成：**analytics 域成为仓内首个业务域仓储端口化试点**，supervisor 的「interface + Symbol DI token / TypeORM 实现收进 data/ / spec 端口替身」四件套模板已固化并可复制到其余域。**业务行为零漂移**，engine-core 零 diff，全量 3252 → 3263 例（净增 +11 / +1 文件，全部来自本单新增 spec，既有集合零减少）。

### 交付物（6 个代码文件 + 2 份文档）

| 类型 | 文件                                                                                                | 说明                                                                                                                                                                         |
| ---- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 新建 | `src/analytics/domain/repositories/analytics-event.repository.ts`                                   | 端口：`AnalyticsEventRepository` interface（3 方法）+ `AnalyticsEventRecordInput` + `ANALYTICS_EVENT_REPOSITORY` Symbol token；**零 typeorm 值符号**（枚举走 `import type`） |
| 新建 | `src/analytics/data/analytics-event.repository.typeorm.ts`                                          | TypeORM 实现：`@InjectRepository` / `Between` / `count` / `find(select createdAt)` / `create+save` 全收在此文件 —— analytics 域**唯一**允许出现 typeorm 值符号的文件         |
| 新建 | `test/analytics/td13-analytics-repository-port.spec.ts`                                             | 端口替身 spec（**11 例**）：替身只记调用参数，不起真 TypeORM、不连 DB、不 `vi.mock('typeorm')`                                                                               |
| 修改 | `src/analytics/providers/analytics.service.ts`                                                      | 依赖改端口；2 次 `count({where})` → `countByType(...)`；1 次 `find({select})` → `findCreatedAtBetween(...)`；纯计算（timeRangeWindow / bucketCount / 分桶）原样保留          |
| 修改 | `src/analytics/providers/analytics-event-tracker.service.ts`                                        | 依赖改端口；`save(create({...}))` → `record({...})`；**静默 catch + warn 文案逐字未变**；**公共签名未变**（knowledge-base 跨模块调用面零影响）                               |
| 修改 | `src/analytics/analytics.module.ts`                                                                 | 新增 provider `{ provide: ANALYTICS_EVENT_REPOSITORY, useClass: AnalyticsEventRepositoryTypeorm }`；**保留** `TypeOrmModule.forFeature([AnalyticsEvent])`；`exports` 未变    |
| 文档 | `docs/worklog/completed/phase2.5/td13-repository-port-analytics-pilot-implementation-2026-11-14.md` | 交付记录（§1~§7 全七节，数字均为实测）                                                                                                                                       |
| 文档 | `docs/worklog/completed/phase2.5/td13-repository-port-analytics-pilot-task-2026-11-14.md`           | 任务单已归档 + 状态行改 ✅                                                                                                                                                   |

---

## 二、闸门真实数字（全部本机实测，命令 / exit / 数字照录）

| 闸门                   | 命令                                                                         | exit  | 真实数字                                                                                                                                                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 盘读前置               | `pnpm doctor:fs`                                                             | 0     | **合格**：per-file 均值 **0.09 ms/文件**、slow=**0**、walk 23 ms / cold 25 ms / warm 18 ms                                                                                                                                                               |
| 根类型                 | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`      | 0     | **0 error**                                                                                                                                                                                                                                              |
| 构建类型               | `pnpm exec tsc -p tsconfig.build.json --noEmit`                              | 0     | **0 error**                                                                                                                                                                                                                                              |
| Lint（权威）           | `pnpm lint`                                                                  | 0     | **0 error / 1 warning**（`test/e2e/v2-user-flow.spec.ts:1` unused eslint-disable —— 基线既有、e2e 范围外，**未修**）                                                                                                                                     |
| oxlint fast            | `pnpm lint:fast`                                                             | 0     | **0 warning / 0 error**                                                                                                                                                                                                                                  |
| oxlint deep（额外）    | `pnpm lint:deep`                                                             | 0     | **0 warning / 0 error**                                                                                                                                                                                                                                  |
| 定向 spec              | `pnpm exec vitest run test/analytics/td13-analytics-repository-port.spec.ts` | 0     | **1 文件 / 11 例全过**                                                                                                                                                                                                                                   |
| **全量测试**           | `pnpm test`                                                                  | **0** | **194 passed                                                                                                                                                                                                                                             | 1 skipped（195 文件）**、**3259 passed | 4 skipped（3263 例）**；Duration **66.04 s** |
| 边界                   | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                     | 0     | **12 passed**                                                                                                                                                                                                                                            |
| engine-core            | `git diff --stat HEAD -- src/engine-core`                                    | 0     | **空（0 行）**                                                                                                                                                                                                                                           |
| 范围隔离               | `git diff --name-only HEAD` + `git status --short`                           | 0     | tracked **6 个**（3 文档 + 3 个 `src/analytics/`）+ untracked **4 个**（任务单 + 交付记录 + `src/analytics/data/` + `src/analytics/domain/` + `test/analytics/`）；**src / test 改动 100% 落在 `src/analytics/` 与 `test/analytics/`**，其余业务域 **0** |
| 端口隔离复核           | 见 §三                                                                       | 0     | 受检 4 文件 **0 命中**                                                                                                                                                                                                                                   |
| 运行时 DI 验证（额外） | `Invoke-WebRequest http://localhost:3000/health`                             | 0     | **HTTP 200**（DB / Redis 均 up），运行中的 `node dist/app` 即含本单产物的 build（`dist/analytics/analytics.module.js` 含 `provide: ANALYTICS_EVENT_REPOSITORY` + `useClass: AnalyticsEventRepositoryTypeorm`）                                           |

**用例数对照**：基线 **3248 passed + 4 skipped（3252 例 / 194 文件）** → 本单 **3259 passed + 4 skipped（3263 例 / 195 文件）**，差值 **+11 例 / +1 文件**，与本单新增 spec 的 **11 例 / 1 文件** **逐项吻合** ⇒ 既有集合**零减少**、既有断言与 mock 语义**未改**。

**机器状态（实测，不干净）**：5 个 node 常驻进程（`pnpm start:dev` / `nest start --watch` / `pnpm dev` / admin-dashboard vite / `node dist/app`）—— **未擅自杀用户进程**；墙钟 66.04 s 与历史基线**不作直接比较**（同一台机器同一负载），盘读延迟经 `pnpm doctor:fs` 判定合格。取证会话已补 `D:\Apps\Git\cmd`。

---

## 三、端口方法面 + typeorm 符号外泄复核（grep 证据）

**端口方法面**（只收现有三条调用，未扩通用代理）：

| 方法                                                                              | 唯一调用方                                                   |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `record(input: AnalyticsEventRecordInput): Promise<void>`                         | tracker（写一行）                                            |
| `countByType(tenantId, eventType, start, end): Promise<number>`                   | AnalyticsService（KPI 1 分子 + KPI 2 分母**共用 1 个方法**） |
| `findCreatedAtBetween(tenantId, eventType, start, end): Promise<readonly Date[]>` | AnalyticsService.buildTrend（只出 createdAt，不漏整行）      |

**grep 逐文件命中数**（pattern：`\bRepository\b|\bBetween\b|\bFindOptions\b|\bEntityManager\b|from 'typeorm'|from '@nestjs/typeorm'`）：

| 文件                                                              | 命中  | 判定                                                                                                                          |
| ----------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------- |
| `src/analytics/domain/repositories/analytics-event.repository.ts` | **0** | 受检：端口零 typeorm 值符号                                                                                                   |
| `src/analytics/providers/analytics.service.ts`                    | **0** | 受检：service 零 typeorm 值符号（改前有 `import { Between, Repository } from 'typeorm'`）                                     |
| `src/analytics/providers/analytics-event-tracker.service.ts`      | **0** | 受检：tracker 零 typeorm 值符号（改前有 `InjectRepository` + `import type { Repository }`）                                   |
| `test/analytics/td13-analytics-repository-port.spec.ts`           | **0** | 受检：新 spec 零 typeorm 值符号                                                                                               |
| `src/analytics/data/analytics-event.repository.typeorm.ts`        | 14    | **唯一允许**的实现文件落点                                                                                                    |
| `src/analytics/analytics.module.ts`                               | 1     | 装配层 `TypeOrmModule from '@nestjs/typeorm'`（任务单 §2.3 要求保留 `forFeature`；它是 NestJS 装配 API，不是 typeorm 值符号） |
| `src/analytics/entities/analytics-event.entity.ts`                | 1     | entity 装饰器 —— 任务单明确「entity 文件一字不改」，归属另案 H                                                                |

---

## 四、业务语义零漂移对照（改前 HEAD `d718904` → 改后）

| 行为点                    | 对照结论                                                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| KPI 1 发布量 / KPI 2 分母 | 改前 2 次 `count({where:{tenantId, eventType, createdAt: Between(start,end)}})` → 改后 2 次 `countByType(...)`，实现内条件**逐字一致**          |
| 分母为 0 保护             | `submitted > 0 ? kbPublished / submitted : 0` —— **一字未改**（0 时返 0，非 NaN / 非 Infinity）                                                 |
| trend 分桶                | `idx = min(floor((createdAt-start)/bucketMs), bucketCount-1)` —— **一字未改**；week 7 桶口径一致（spec 断言 [1,0,1,0,0,0,1]），末端夹桶行为一致 |
| KPI 3 / KPI 4 占位 0      | 一字未改                                                                                                                                        |
| tracker 静默失败          | catch + warn **文案逐字相同**（`record analytics event failed: type=... itemId=... err=...`）；不 throw；成功路径不打 warn                      |
| tracker 公共签名          | 一字未改（knowledge-base 跨模块调用面零影响）                                                                                                   |
| 租户隔离                  | 端口方法首参即 tenantId，实现内 where 含 tenantId；spec 断言 tenantId 透传                                                                      |
| 查询次数                  | 2 × countByType + 1 × findCreatedAtBetween（spec 显式断言次数）—— 不多不少、无 N+1                                                              |

---

## 五、偏差登记（conventions §2.5，完整表见交付记录 §二）

| 编号 | 偏差                                                                          | 理由                                                                                                                                           |
| ---- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1  | spec 改为**合一文件** `test/analytics/td13-analytics-repository-port.spec.ts` | 仓内 `test/` 文件普遍带工作项前缀；合一文件可复用同一套替身工厂，避免两份替身漂移                                                              |
| D-2  | `findCreatedAtBetween` 只返 `readonly Date[]`（不返整行）                     | 返整行会把 `metadata` 等无关字段与 entity 行形状漏进业务层                                                                                     |
| D-3  | tracker 公共签名**保持 5 个位置参数**                                         | 跨模块消费方 `src/knowledge-base/providers/knowledge.service.ts` 按位置参数调用，改签名 = 越权改别的业务域                                     |
| D-4  | 仓储 token **不 export**                                                      | analytics 仓储无跨模块消费方（跨模块只消费 tracker service）；supervisor export 是因为 counselor 侧要读同一份报告，analytics 无此需求          |
| D-5  | 端口 / service 的**注释文案也刻意不含** typeorm 值符号字面量                  | 否则 §5.1 的 grep 会把注释散文计入命中数，闸门数字失真（改词前端口命中 4 处、service 命中 1 处，全在注释里）；改词后受检 4 文件实测 **0 命中** |
| D-6  | 枚举 `AnalyticsEventType` **仍留在 entity 文件**                              | 任务单明确「entity 文件一字不改」；entity 运行时解耦是另案 H                                                                                   |
| D-7  | 额外跑 `pnpm lint:deep`                                                       | 成本极低，与 TD-9 的 deep 0/0 基线对照，防 type-aware 告警                                                                                     |

---

## 六、§7 回写清单（逐项）

- [x] 交付记录已写到 §6 固定路径 → `docs/worklog/completed/phase2.5/td13-repository-port-analytics-pilot-implementation-2026-11-14.md`
- [x] 任务单已从 `pending/` 移到 `completed/phase2.5/`，顶部状态行改 ✅ 并链交付记录
- [x] 回写 WP 登记表：`docs/worklog/pending/phase2.5-wp-list-2026-11-08.md` §四 TD-13 行改 ✅ + 交付记录链接
- [x] 回写阶段入口：`docs/worklog/pending/phase2.5-README.md` §3.0 TD-13 bullet 改 ✅ + 交付记录链接
- [x] 回写台账：`docs/team/gate-performance-remediation-2026-11-11.md` §9 P-DEBT-11 行追加 L-1b 试点落地结论 + 链接；更新记录补一条；另案 G–J 登记到该行遗留段（未动 `phase2.5-toolchain-tech-debt-2026-11-11.md`，按任务单说明该文件无 L-1b 段落）
- [x] `git diff --stat HEAD -- src/engine-core` 为空
- [x] 提交分组核对：本单文件 = 6 个代码文件 + 2 份本单文档 + 3 个索引文档回写；**未 stage、未 commit、未 push**
- [x] commit message 草稿已给（见下）

**链接复核**：本单新增/修改的全部相对链接目标经 `Test-Path` 校验**均真实存在**；旧路径 `worklog/pending/td13-...` **零残留**。

---

## 七、commit message 草稿（**未提交，等你指令**）

`feat(td13): analytics 域仓储端口化试点 — 端口 interface + Symbol token、TypeORM 实现收进 data/、service 改依赖端口、端口替身 spec 11 例（typeorm 值符号 0 外泄，业务语义零漂移）`

---

## 八、遗留项（已登记，未做）

| 编号 | 遗留项                                                                              | 状态                                                |
| ---- | ----------------------------------------------------------------------------------- | --------------------------------------------------- |
| G    | 其余 **117** 个 service 仓储端口化分批推广（counselor **33 文件 / 63 处**为最大域） | 🟠 待排期 —— 每批沿用本单四件套模板                 |
| H    | entity 装饰器运行时依赖消除（纯类 + 外部 schema 映射）                              | 🟠 待方案评估 —— **本单实测已定位这就是加载图根因** |
| I    | 端口内存实现是否补（进程内替身 / V0 调试）                                          | 🟢 暂不补 —— analytics 无此需求                     |
| J    | 混合形态 typeorm import 统一形态（可读性向）                                        | 🟢 另案批量处理（本单未动其他域 import 形态）       |

**Actions 侧待复核点**：CI 侧结果待你 push 后在 Actions 复核（沿用 TD-11 / TD-12 口径）；G 的排期、H 的方案需你拍板。

---

## 九、需要你知道的一个诚实边界

本单**不承诺 import 加载图收益**：两个 service 对 typeorm 的**直接**导入边确实归零了，但枚举 `AnalyticsEventType` 仍定义在 entity 文件里（任务单明确「entity 文件一字不改」），service 值导入该枚举 → entity 装饰器求值把 typeorm 拉进**传递**闭包。这与 TD-11 实测「type-only 收窄收益为 0」是同一个根因，属另案 H。本单的真实交付是**契约边界**（service 与 spec 不再依赖 TypeORM API 面）+ **可复制模板**；加载图收益要等 H 落地后才可能显现。已如实写进交付记录 §5.4 与台账 P-DEBT-11 行。

---

_未自动 commit / push；未改 entity / DTO / controller / 其他业务域 / package.json / tsconfig / CI / Dockerfile。_
