# TD-21 · C2 第五批仓储端口化（counselor 域 · 金句子族：quotes + user_quote_favorites）— 交付记录

- **状态**：✅ 已交付（2026-11-15）
- **基线 HEAD**：`2b03756`（TD-20 交付后，与 `origin/integrate` 一致）
- **任务单**：`docs/worklog/pending/td21-counselor-quote-port-c2-batch5-task-2026-11-15.md` → 归档至 `docs/worklog/completed/phase2.5/`
- **债务条目**：P-DEBT-11 / L-1（技术债台账 §9）
- **路线**：TD-14 备忘推荐路线 C 三段之第三段 **C2（按域推广）第五批** —— C+（TD-15）→ C1（TD-13 analytics + TD-16 life-map）→ C2 第一批（TD-17 consent）→ 第二批（TD-18 good_state_diary）→ 第三批（TD-19 emergency）→ 第四批（TD-20 home 干净切片）→ **C2 本单：counselor 域金句子族（首个进入 counselor 重型域的切片）**

---

## 一、本单做了什么（一句话）

counselor 域的 **金句子族**（`quotes` + `user_quote_favorites` 两张扁平子表 + 唯一消费 service `QuoteService`）按 TD-13 四件套落地**双端口** —— **2 个端口**（各含 interface + Symbol token；金句端口带 `QuoteRow` 13 字段**含软删列 `deletedAt`**，收藏端口带 `FavoriteRow` 5 字段**硬删无 `deletedAt`**）+ **2 个 TypeORM 实现**（收进 `src/counselor/data/`，两处可见性查询构造与全部查询口径下沉）+ **module 两组 token 接线** + **端口替身 spec（21 例，零 entity import）**，且**零既有测试适配面**。

---

## 二、改动文件清单

### 2.1 新增（5 个文件）

| 文件                                                             | 用途                                                                                                                                                                                                  |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/counselor/domain/repositories/quote.repository.ts`          | `QuoteRepository` interface（方法面 **5** 个）+ DI token `QUOTE_REPOSITORY` + `QuoteRow`（13 字段，**保留 `deletedAt` 软删列**）+ 游标入参 `QuoteCursorAnchor`；**零 typeorm 值符号**                 |
| `src/counselor/domain/repositories/quote-favorite.repository.ts` | `QuoteFavoriteRepository` interface（方法面 **4** 个）+ DI token `QUOTE_FAVORITE_REPOSITORY` + `FavoriteRow`（5 字段，**硬删、无软删列**）；**零 typeorm 值符号**                                     |
| `src/counselor/data/quote.repository.typeorm.ts`                 | `QuoteRepositoryTypeorm` —— 金句内容库端口的 TypeORM 实现；**可见性查询构造（今日池 + feed 共用同一份）+ keyset 推进条件 + entity→Row 映射**全部下沉                                                  |
| `src/counselor/data/quote-favorite.repository.typeorm.ts`        | `QuoteFavoriteRepositoryTypeorm` —— 收藏关系端口的 TypeORM 实现；**幂等 upsert 冲突键 + 硬删 + 行为序列排序 + 已收藏 id 查询**全部下沉                                                                |
| `test/counselor/td21-counselor-quote-port-c2-batch5.spec.ts`     | 端口替身 spec，**21 例**（A1-A4 今日金句 / B1-B6 金句流 / C1-C4 收藏 / D1-D3 我的收藏 / E1-E4 DTO 与行为锁），零 entity import、零 typeorm 值符号、不起真 TypeORM / 不连 DB / 不 `vi.mock('typeorm')` |

### 2.2 修改（2 个文件）

| 文件                                       | 改动                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/counselor/providers/quote.service.ts` | 构造参数由两个 `@InjectRepository` 直连改为 `@Inject(QUOTE_REPOSITORY)` / `@Inject(QUOTE_FAVORITE_REPOSITORY)`；typeorm 值导入与 entity 值位置 import 全撤；**两处可见性 QB + 全部查询口径移出**；私有 `toDto` / `assertQuoteExists` 的 entity 类型签名换窄 Row 类型；**5 个公共方法签名与返回 DTO 形状逐字不变**                                                    |
| `src/counselor/counselor.module.ts`        | 新增 **2 组** provider（`{ provide: QUOTE_REPOSITORY, useClass: QuoteRepositoryTypeorm }` / `{ provide: QUOTE_FAVORITE_REPOSITORY, useClass: QuoteFavoriteRepositoryTypeorm }`）；**保留** `TypeOrmModule.forFeature([...])` 现有全部 **25** 个 entity 注册与 `UserModule` / `AuthModule` / `AgentModule` import；`exports` 清单**不变**（仓储 token **不 export**） |

### 2.3 删除

无。

### 2.4 零改动确认

- `src/counselor/entities/quote.entity.ts`（13 列 / 2 索引 / **列级** `deletedAt` 软删标记）、`src/counselor/entities/user-quote-favorite.entity.ts`（5 列 / 3 索引 / **硬删、无软删列**）—— **一字未改**
- `src/counselor/dto/quote.dto.ts`、`src/counselor/controllers/quote.controller.ts`、`src/counselor/config/quote-seeds.ts`（`QUOTE_SEEDS` / `quoteDayIndexOf` / `validateQuoteSeeds` / 分页常量）—— 零改动
- **排除 service / entity 零改动**：counselor 域内其余 24 entity 与 30+ service（含枢纽仓 `TrainingSession` 消费方 10 个 service、关系仓 `LongTermCase` / `LongTermCaseSession`、visitor-pool / visitor-persona / ability / training-exercise / supervision / practice-* 子族、`HomeCompanion` 类单仓 service）；`src/counselor/seeds/` 目录（4 个 seed 脚本经 `dataSource.getRepository(...)` 装配种子层）—— 零改动
- `src/migration/` —— 零改动
- `src/engine-core/` —— 零改动（boundary 12 绿，`git diff --stat HEAD -- src/engine-core` 为空）
- **既有测试零改动**：`test/counselor/quote-engine.spec.ts` 只测 `config/quote-seeds.ts` 纯函数与 DTO 结构（不 import service / entity / Repository）→ 本单**未动任何既有测试文件**
- 其他业务域 / `package.json` / `tsconfig*.json` / `vitest.config.mts` / `test/vitest.e2e.mts` / CI / Dockerfile / `admin-dashboard/` / Flutter —— 零改动
- 未新增第三方依赖

---

## 三、端口方法面清单

### 3.1 端口划分粒度判定：**按实体分 2 个端口**（对齐 TD-16 life-map / TD-20 home 同域多端口先例）

counselor 域 26 entity / 60+ 处仓储注入，本批只切金句子族两张表。内容库表与收藏关系表的口径完全不同 —— 内容库是「可见性谓词 + keyset 游标 + 上下架 / 软删判定」，收藏关系表是「幂等 upsert + 硬删 + 行为序列排序」；合成一个端口会把两套不相干的语义切碎，对齐 TD-16 的判定（表不同 / 口径不同 → 分端口），同时避免 TD-16 的 4 端口粒度（本批只有 2 张表 → 2 个端口）。

### 3.2 9 处既有调用形态 → 9 个端口方法（任务单 §1.3 锚点，逐条对齐）

**金句内容库端口（5 方法 / 5 处调用形态）**

| 改前调用（HEAD `2b03756`）                           | 改后端口方法                              | 口径                                                                           |
| ---------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------ |
| ① 今日池 QB（`findVisibleQuotes` L258-272）          | `findVisiblePool(userId)`                 | 可见性谓词 + `publishedAt DESC, id DESC` 下沉实现层                            |
| ② feed QB + 游标 keyset（L117-126 + L131）           | `listVisibleKeyset(userId, anchor, take)` | 可见性谓词 + 排序 + keyset 推进条件下沉；**limit+1 与 hasMore 切片留 service** |
| ③ 游标锚点 `findOne({ where: { id: cursor } })`      | `findAnchorById(id)`                      | 取行（未命中返 null）                                                          |
| ④ 存在性校验 `findOne({ where: { id: quoteId } })`   | `findById(quoteId)`                       | 取行；**`enabled` / `deletedAt` 判定留 service**                               |
| ⑤ 按 id 集合 `find({ where: { id: In(quoteIds) } })` | `findManyByIds(quoteIds)`                 | 按 id 集合取行                                                                 |

**收藏关系端口（4 方法 / 4 处调用形态）**

| 改前调用                                                                        | 改后端口方法                             | 口径                                      |
| ------------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------- |
| ⑥ `upsert({ tenantId, userId, quoteId }, { conflictPaths })`                    | `upsert(userId, quoteId, tenantId)`      | 幂等冲突键 `[userId, quoteId]` 下沉实现层 |
| ⑦ `delete({ userId, quoteId })`（硬删）                                         | `deleteByUserAndQuote(userId, quoteId)`  | 硬删（**刻意不校验金句存在**）            |
| ⑧ `find({ where: { userId }, order: { createdAt: 'DESC' } })`                   | `findFavoritesByUser(userId)`            | 收藏关系列表 + 行为序列排序下沉           |
| ⑨ `find({ where: { userId, quoteId: In(quoteIds) }, select: { id, quoteId } })` | `findFavoriteQuoteIds(userId, quoteIds)` | 取已收藏 id（`Set` 聚合留 service）       |

> **未新增任何通用代理方法**（无 `findAll` / `updateById` / `deleteAll` 之类）。

### 3.3 端口 interface 摘要

```
export interface QuoteRepository {
  findVisiblePool(userId: string): Promise<QuoteRow[]>;
  listVisibleKeyset(userId: string, anchor: QuoteCursorAnchor | null, take: number): Promise<QuoteRow[]>;
  findAnchorById(id: string): Promise<QuoteRow | null>;
  findById(quoteId: string): Promise<QuoteRow | null>;
  findManyByIds(quoteIds: string[]): Promise<QuoteRow[]>;
}

export interface QuoteFavoriteRepository {
  upsert(userId: string, quoteId: string, tenantId: string): Promise<void>;
  deleteByUserAndQuote(userId: string, quoteId: string): Promise<void>;
  findFavoritesByUser(userId: string): Promise<FavoriteRow[]>;
  findFavoriteQuoteIds(userId: string, quoteIds: string[]): Promise<string[]>;
}
```

### 3.4 类型清单

| 类型                        | 角色           | 说明                                                                                         |
| --------------------------- | -------------- | -------------------------------------------------------------------------------------------- |
| `QuoteRepository`           | 端口 interface | 5 个方法，唯一调用方 `QuoteService`                                                          |
| `QUOTE_REPOSITORY`          | DI token       | `Symbol('QUOTE_REPOSITORY')`；module provider 绑定，**不 export**                            |
| `QuoteRow`                  | 出参           | 13 字段窄领域类型；**保留 `deletedAt`**（列级软删标记，非 `@DeleteDateColumn`）              |
| `QuoteCursorAnchor`         | 查询入参       | 游标锚点（`publishedAt` + `id`），由 service 从锚点行构造                                    |
| `QuoteFavoriteRepository`   | 端口 interface | 4 个方法，唯一调用方 `QuoteService`                                                          |
| `QUOTE_FAVORITE_REPOSITORY` | DI token       | `Symbol('QUOTE_FAVORITE_REPOSITORY')`；module provider 绑定，**不 export**                   |
| `FavoriteRow`               | 出参           | 5 字段窄领域类型（id / tenantId / userId / quoteId / createdAt）；**不含软删列**（本表硬删） |

---

## 四、闸门表（真实数字，exit code 实测）

**机器状态（闸门前后各查一次，2 个 node 常驻进程，未杀用户进程）**：PID 7860 `vite`（admin-dashboard）· PID 20740 `pnpm dev`（admin-dashboard）。本次会话期间 `nest start --watch` / `pnpm start:dev` / `node dist/app` **未运行**（较 TD-19 / TD-20 会话少 3 个常驻进程），故本次墙钟不代表最坏工况；墙钟可比性以**用例数 / 文件数**为准。

| 闸门         | 命令                                                                     | exit | 实测数字                                                                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------ | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 盘读前置     | `pnpm doctor:fs`                                                         | 0    | walk 45 ms · cold 142 ms slow 7 · warm 25 ms slow 0 · **per-file 均值 0.12 ms/文件** · 判定「合格（读取延迟正常，闸门数字可信）」                                                        |
| 根类型       | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`  | 0    | **0 error**                                                                                                                                                                              |
| 构建类型     | `pnpm exec tsc -p tsconfig.build.json --noEmit`                          | 0    | **0 error**                                                                                                                                                                              |
| Lint（权威） | `pnpm lint`                                                              | 0    | **0 error / 1 warning**（`test/e2e/v2-user-flow.spec.ts:1` 既有 unused eslint-disable，基线既有、范围外未修）                                                                            |
| oxlint fast  | `pnpm lint:fast`                                                         | 0    | **0 warning / 0 error**                                                                                                                                                                  |
| 定向 spec    | `pnpm exec vitest run test/counselor/`                                   | 0    | **19 文件 / 287 例全绿**，23.24 s（本批新增 1 文件 / 21 例 + 既有 18 文件 / 266 例）                                                                                                     |
| 全量测试     | `pnpm test`                                                              | 0    | **200 passed + 1 skipped（201 文件）· 3377 passed + 4 skipped（3381 例）**，Start 12:06:39，**Duration 102.14 s**                                                                        |
| engine-core  | `git diff --stat HEAD -- src/engine-core`                                | 0    | **空**（零 diff）                                                                                                                                                                        |
| migration    | `git diff --stat HEAD -- src/migration/`                                 | 0    | **空**（零 diff）                                                                                                                                                                        |
| 范围隔离     | `git diff --name-only HEAD` + `git ls-files --others --exclude-standard` | 0    | 本单 = 5 新增（2 端口 / 2 实现 / 1 新 spec）+ 2 修改（service / module）+ 交付文档；另有主控产物（phase3 设计文档 ?? + 5 份归档 relay ??）与 TD-20 遗留的 3 份索引文档 M，**不纳入本单** |
| 边界         | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                 | 0    | **12 passed**（1.93 s）                                                                                                                                                                  |

**全量口径对比**：基线 **3356 passed + 4 skipped（3360 例 / 200 文件）** → 本单 **3377 passed + 4 skipped（3381 例 / 201 文件）**，净增 **+21 例 / +1 文件**，**增量 = 本单新增 spec 的 21 例**，既有 3360 例**一条不减**。

---

## 五、typeorm 符号外泄复核表（§3.2 静态复核四项）

**受检面 4 个文件**（2 端口 + 目标 service + 新 spec），grep 模式：`Repository<` · `Between` · `FindOptions` · `EntityManager` · `from 'typeorm'` · `from '@nestjs/typeorm'` · `@InjectRepository` · `getRepositoryToken` · `createQueryBuilder` · `SelectQueryBuilder` · `repo.query` · `MoreThanOrEqual` · `IsNull` · `In(`。

| 受检文件                                                         | typeorm 值符号命中 | entity 类名命中 | `entities/` 路径命中 |
| ---------------------------------------------------------------- | ------------------ | --------------- | -------------------- |
| `src/counselor/domain/repositories/quote.repository.ts`          | **0**              | **0**           | **0**                |
| `src/counselor/domain/repositories/quote-favorite.repository.ts` | **0**              | **0**           | **0**                |
| `src/counselor/providers/quote.service.ts`                       | **0**              | **0**           | **0**                |
| `test/counselor/td21-counselor-quote-port-c2-batch5.spec.ts`     | **0**              | **0**           | **0**                |

> **entity 类名复核口径**：用**词边界**正则（`\bQuote\b` / `\bUserQuoteFavorite\b`）—— 自研命名（`QuoteRepository` / `QuoteRow` / `QuoteService` / `QuoteDto` / `QuoteCursorAnchor`）均不误判。
> **宽模式 `Repository` 的命中归因**：命中项全部是自研命名（端口 interface `QuoteRepository` / `QuoteFavoriteRepository`），typeorm 的 `Repository` 类符号 0 命中。

**对照（允许落点）**：`src/counselor/data/quote.repository.typeorm.ts` 命中 **8** 处、`src/counselor/data/quote-favorite.repository.typeorm.ts` 命中 **5** 处 —— 均在实现文件内。typeorm 值符号只落 3 处：两个 `data/` 实现文件 + `counselor.module.ts`（装配层 `forFeature`）。

**可见性谓词全仓唯一一处**（任务单 §1.4 差异 2 的硬要求）：全仓 grep `q.userId IS NULL OR q.userId = :userId` = **1 处命中** —— `src/counselor/data/quote.repository.typeorm.ts` L124（今日池与 feed 共用同一份构造）。改前该谓词在 service 内**写了两遍**（今日池 + feed），本单收敛为**唯一一处**，文本逐字未变。

**四项静态复核结论**：

1. **typeorm 符号外泄** = 上表 4 个受检面**全部 0 命中** ✅
2. **spec 零 entity import** = 新 spec 对 `entities/` 路径的引用 **0** ✅
3. **service 值位置 entity import = 0** = 两个端口文件 + service 内实体类名（词边界）命中 **0** ✅
4. **方法面不泛化** = 金句端口恰 **5** 个方法、收藏端口恰 **4** 个方法，与 9 处调用形态一一对应；新 spec **E2** 显式断言两个方法名集合，无 `findAll` / `updateById` 之类通用代理 ✅

**另两项开工取证**（任务单 §1.1 / §1.2 锚点复核）：

- src 他域 grep `UserQuoteFavorite` / `QuoteService` / 两个 entity 类名 = **0 命中** → 确认**零跨模块仓储消费**（`src/counselor/seeds/quotes.seed.ts` 经 `dataSource.getRepository(...)` 装配种子层，**按任务单 §1.4 差异 5 不纳入端口化**）
- `test/` 下 grep 本批 entity / service / 路径 = **0 命中** → 确认**零既有测试适配面**（`test/counselor/quote-engine.spec.ts` 只 import `config/quote-seeds.js` 与 `dto/quote.dto.js`）

---

## 六、service 行为与改前对照表（业务语义零漂移）

| 行为点            | 改前（HEAD `2b03756`）                                                                                        | 改后                                                            | 判定                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------ |
| 可见性谓词        | service 内 QB **写了两遍**（今日池 + feed）                                                                   | 实现层**唯一一处**（`visibleQueryBuilder`），文本逐字未变       | 语义一致（收敛）                           |
| 今日池 where      | `deletedAt IS NULL` + `enabled = true` + 可见性谓词                                                           | 实现层同一                                                      | 逐字一致                                   |
| 今日池排序        | `publishedAt DESC, id DESC`                                                                                   | 实现层同一                                                      | 逐字一致                                   |
| 今日取模定位      | `quoteDayIndexOf(new Date()) % pool.length`                                                                   | **留 service**，同表达式                                        | 逐字一致                                   |
| 库为空            | warn 日志 + 抛 `QuoteLibraryEmpty`                                                                            | 留 service，同文案同错误码                                      | 逐字一致                                   |
| 今日兜底          | `pool[index] ?? pool[0]`，仍无则抛 `QuoteLibraryEmpty`                                                        | 留 service                                                      | 逐字一致                                   |
| feed where / 排序 | 与今日池同一套                                                                                                | 实现层同一构造                                                  | 逐字一致                                   |
| 游标锚点取行      | `findOne({ where: { id: query.cursor } })`                                                                    | 端口 `findAnchorById`（实现层同一查询）                         | 语义一致                                   |
| 游标未命中        | 抛 `QuoteCursorInvalid`（400，客户端重置分页，不静默从头返回）                                                | 留 service，同错误码                                            | 逐字一致                                   |
| keyset 推进条件   | `(q.publishedAt < :anchorPublishedAt OR (q.publishedAt = :anchorPublishedAt AND q.id < :anchorId))`           | 实现层**同一段 SQL 文本**                                       | 逐字一致                                   |
| limit + 1         | `qb.take(limit + 1)`                                                                                          | service 算 `limit + 1` 传给端口 `take`                          | 语义一致                                   |
| 默认条数          | `query.limit ?? QUOTE_LIST_DEFAULT_LIMIT`                                                                     | 留 service                                                      | 逐字一致                                   |
| hasMore 切片      | `rows.length > limit` → `rows.slice(0, limit)`                                                                | 留 service                                                      | 逐字一致                                   |
| nextCursor 组装   | `hasMore && last ? last.id : null`                                                                            | 留 service                                                      | 逐字一致                                   |
| 返回形状          | `{ items, nextCursor }`                                                                                       | 同字段同顺序                                                    | 逐字一致                                   |
| 收藏前存在性校验  | `findOne({ id })` → `!quote.enabled                                                                           |                                                                 | quote.deletedAt !== null`抛`QuoteNotFound` | 端口 `findById` → **判定留 service**，同条件同错误码 | 逐字一致 |
| 收藏 upsert       | `upsert({ tenantId: userId, userId, quoteId }, { conflictPaths: ['userId','quoteId'] })`                      | 端口 `upsert(userId, quoteId, tenantId)` → 实现层**同一冲突键** | 语义一致                                   |
| 取消收藏          | `delete({ userId, quoteId })`，**刻意不校验金句存在**                                                         | 端口 `deleteByUserAndQuote`（硬删）                             | 逐字一致                                   |
| 收藏列表排序      | `order: { createdAt: 'DESC' }`（行为序列）                                                                    | 实现层同一                                                      | 逐字一致                                   |
| 按 id 集合取金句  | `find({ where: { id: In(quoteIds) } })`                                                                       | 实现层同一                                                      | 逐字一致                                   |
| 已收藏 id 查询    | `find({ where: { userId, quoteId: In(quoteIds) }, select: { id: true, quoteId: true } })`                     | 实现层同一 select                                               | 逐字一致                                   |
| 空 id 集合短路    | `quoteIds.length === 0` → 返空 Set，**不查库**                                                                | 留 service                                                      | 逐字一致                                   |
| 收藏顺序输出      | 按 relations 顺序遍历，金句缺失的**跳过**                                                                     | 留 service                                                      | 逐字一致                                   |
| 收藏态回填        | `toDto(quote, new Set([quote.id]))` → `favorited: true`                                                       | 同                                                              | 逐字一致                                   |
| DTO 转换          | `id / text / author / category / backgroundUrl / publishedAt(ISO) / sourceWork / favorited`                   | 同（`QuoteRow` 字段名逐字相同）                                 | 逐字一致                                   |
| 日志口径          | `[quote_today_empty] ...` / `[quote_favorited] user=... quote=...` / `[quote_unfavorited] user=... quote=...` | 同文案、同位置                                                  | 逐字一致                                   |

---

## 七、边界确认

- **engine-core 零改动**：`git diff --stat HEAD -- src/engine-core` 为空；`boundary.spec.ts` 零改动，**12 绿**。
- **entity 文件零改动**：两个 entity 的字段 / 装饰器 / 列 / 索引 / 类型引用 / **软删（列级 datetime）· 硬删（收藏表）口径**全部保留；migration DDL 不动。
- **DTO / controller / config 不动**：`quote.dto.ts` / `quote.controller.ts`（5 端点：today / list / favorites / favorite / unfavorite）/ `config/quote-seeds.ts` —— 零改动；路由与限流不变。
- **排除 service / entity 不动**：counselor 域其余 24 entity 与 30+ service 的仓储依赖、import、逻辑零改动；枢纽仓 `TrainingSession` 与关系仓 `LongTermCase` / `LongTermCaseSession` 未纳入；`seeds/` 目录零改动。
- **module 装配面**：`forFeature([...])` 现有全部 **25** 个 entity 注册保留；`UserModule` / `AuthModule` / `AgentModule` import 保留；`exports` 清单不变，**仓储 token 不 export**。
- **其他业务域 / migration / 配置 / CI / 前端**：零改动；未新增第三方依赖。
- **既有测试零改动**：本域既有 18 个 spec 均零改动 → **本单未动任何既有测试文件**。
- **零压红线**：本单不下发任何计数（`QuoteDto` 出参本就无 `likeCount` / `favoriteCount` / `viewCount`），spec **E1** 显式断言出参不含计数字段。
- **隐私红线**：交付记录与 spec 内**无任何金句正文原文 / 他人信息**，一律用占位字面量；本域日志仍只打 user / quote（debug 级），未新增日志。
- **命令边界**：一律 `pnpm` / `pnpm exec`，未用裸 `npx`；未新增依赖；未改 `package.json` / `tsconfig` / vitest 配置 / CI。
- **提交边界**：**未自动 commit / push**，只给 commit message 草稿（§十）。

---

## 八、偏差登记（conventions §2.5）

| 编号 | 原锚点（任务单 / 仓内）                                                                        | 实测 / 处置                                                                                           | 理由                                                                                                           |
| ---- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| D-1  | 任务单 §1.3：`findAnchorById(id)` 与 `findById(quoteId)` 两个方法                              | **按锚点保留两个方法**（实现层各自一行，查询形态相同但语义不同）                                      | 一个是「游标锚点解析」、一个是「存在性校验」；合并会让两个意图挤进一个名字（对齐 TD-13 D-2「面窄才守得住」）   |
| D-2  | 任务单 §1.3：`findVisiblePool` 与 `listVisibleKeyset` 各自带可见性口径                         | 实现层把两处 QB **收敛成一个私有构造** `visibleQueryBuilder`（今日池与 feed 共用）                    | 两处 where / order 本来逐字相同；任务单 §1.4 差异 2 要求可见性谓词全仓唯一一处，分头写两份就是「改一处漏一处」 |
| D-3  | 任务单 §1.2：service 私有方法 `findVisibleQuotes`                                              | **随 QB 下沉一并移除**（service 侧直接调端口 `findVisiblePool`）                                      | 该私有方法的唯一职责就是持有那段 QB；留一个 1 行私有包装是纯噪声。公共方法签名零变化                           |
| D-4  | 改前 `assertQuoteExists` / `toDto` 的 entity 类型签名                                          | 类型签名换窄 Row 类型（`QuoteRow` 13 字段，**含 `deletedAt`**）                                       | 任务单 §2 第 3 项明示；运行时字段集逐字相同                                                                    |
| D-5  | 改前 `loadFavoritedIds` 返回关系行数组                                                         | 查询下沉实现层后返回**已收藏 id 数组**，`Set` 聚合留 service                                          | 任务单 §1.3 建议口径（`findFavoriteQuoteIds` 返回 quoteId 数组）；语义一致                                     |
| D-6  | 任务单 §3.2：受检面「共 **5** 个」                                                             | 实测受检面 = **4** 个（2 端口 + 1 service + 1 新 spec）                                               | **任务单计数错配**（非本单回归）；受检面清单以仓内实测为准                                                     |
| D-7  | 任务单 §1.6：本域定向「既有 spec **16** 个」                                                   | 实测本域既有 spec **18** 个文件 / 266 例（另有 WP43 / WP44 新增的 spec 未计入任务单基线）             | **任务单计数错配**（非本单回归）；本单新增后定向总数 = **19 文件 / 287 例**                                    |
| D-8  | `Quote.deletedAt` 是**列级** nullable datetime（entity 用 `@Column` 而非 `@DeleteDateColumn`） | Row **保留** `deletedAt` 列（存在性校验要看它），但注释标明「列级软删标记（非 `@DeleteDateColumn`）」 | 任务单 §1.2 已注明；与 TD-18 diary 的 `@DeleteDateColumn` 软删**字段名相同、机制不同**，口径不得混写           |

---

## 九、遗留项

### 9.1 另案（沿用）

- **C2 / G**：其余域仓储端口化分批推广；每批验收口径 = 「service 源码层 typeorm 值符号 0 命中」+「该批 spec 值位置 entity import = 0」（TD-14 备忘 §5.3，**不再以加载图减重为 KPI**）。后续批次候选：**counselor 其余子族（枢纽仓 `TrainingSession` / 关系仓 `LongTermCase*` / ability / training-exercise / visitor-pool / supervision / practice-\*）→ home 微干预一族 + companion / overview 切片 → inner_world → ai-engine → companion → profile / user**。**C2 第五批（本单）已完成**。
- **I**：端口内存实现是否补（本单不补；spec 替身已覆盖替身需求）。
- **J**：混合形态 typeorm import 统一形态（可读性向、零运行时收益，另案批量处理）。
- **K**：`bin/ormconfig.ts` 的 `entities` glob 口径脱节（独立既有债，沿用 TD-14 登记）。
- **M**：entity 类值位置边 —— 本批 service 值位置 entity import 已归零；顶层 barrel `export *` 残留的 entity 类导出边归 C2/G 推广时闭合。
- **N**：「枚举 / 端口文件零 typeorm 依赖」静态守护 spec（本单不新增；守护证据走 grep 复核 + lint）。
- **P**：consent 失败容忍语义未落地（TD-17 另案，沿用登记，与本域无关）。

### 9.2 本单新观察（登记另案，不在本单处理）

- **观察（新，本批取证）**：`src/counselor/entities/user-quote-favorite.entity.ts` 头部注释 L13 写「created_at / deleted_at (软删)」，但类内**实际无 `deletedAt` 列** —— 注释与实现脱节（该表按下方理由走硬删）。entity 文件本单「一字不改」红线内**不改**，注释修正另案登记，不与本端口化混做。
- **观察（新，本批取证）**：改前可见性谓词在 service 内**写了两遍**（今日池 + feed）；本单顺带收敛为全仓唯一一处 —— 属**结构重构的附带收益**，未改变任何谓词文本。
- **观察（沿用 TD-19）**：`src/emergency/enums/emergency.enums.ts` 的 `isTerminalPhase(phase)` 全仓 0 调用方（死代码），另案评估是否删除；本单不动 enums。
- **观察（沿用 TD-18）**：根目录 e2e 遗留 spec 未被任何 vitest config 收集的测试入口收纳问题，另案评估，本单不清理、不移动、不改 include。
- **观察（沿用 TD-20）**：home 域 `HomeMoodLogService.logMood` 全仓 0 调用方；`getRecentTrend` / `getTodayLatest` 日期边界按服务端本地时区计算（V3 计划接 timezone 入参）；均与本批无关，沿用登记。

### 9.3 Actions 侧待复核点

- CI 结果待主控 push 后在 Actions 复核（本机闸门已全绿）。
- 本单**未自动 commit / push**；commit 分组见 §十。

### 9.4 提交分组核对

本单文件与并行进程产物**分离**：2 个 node 常驻进程（`vite` / `pnpm dev`）不产生 git 改动；`admin-dashboard/` 未触碰；工作区里主控的 `docs/architecture/phase3-judge-layer-ai-review-design-2026-11-15.md` 与 5 份归档 relay（`docs/worklog/pending/archive/relay-response-*.md`）以及 TD-20 遗留的 3 份索引文档改动**不纳入本单 stage**。

---

## 十、commit message 草稿（不自己 commit / push）

```
feat(counselor): TD-21 C2 第五批仓储端口化 —— 双端口 + TypeORM 实现 + 端口替身 spec
```

建议拆 2 个 commit：

1. `feat(counselor): TD-21 C2 第五批仓储端口化 —— 双端口 + TypeORM 实现 + 端口替身 spec`
2. `docs(worklog): TD-21 交付记录 + 索引回写（P-DEBT-11 / L-1 · C2 第五批）`

---

_记录时间：2026-11-15 GMT+8 · 基线 HEAD `2b03756` · 未自动提交_
