# TD-21 · C2 第五批仓储端口化（counselor 域 · 干净切片：quotes + user_quote_favorites · P-DEBT-11 / L-1 · TD-14 推荐路线第三段 C2 第五批）

> 状态：✅ **已交付**（2026-11-15，MiniMax Code）→ 交付记录：`docs/worklog/completed/phase2.5/td21-counselor-quote-port-c2-batch5-implementation-2026-11-15.md`
> 仓库：E:\Work\Project\backend\mofang-nestjs，分支 integrate，基线 HEAD `2b03756`（local = `origin/integrate`，工作区仅余 6 个显式排除的并行产物）
> 唯一事实源：`docs/team/gate-performance-remediation-2026-11-11.md` §9 **P-DEBT-11**（L-1）+ `docs/architecture/entity-typeorm-decoupling-assessment-2026-11-14.md`（TD-14 备忘）§5.3 / §6.1 / §6.2 + TD-13 / TD-16 / TD-17 / TD-18 / TD-19 / TD-20 交付记录（四件套模板与先例）
> 任务性质：**实现单（C2 推广第五批）** —— 在 TD-13（analytics）、TD-16（life-map）、TD-17（consent）、TD-18（good_state_diary）、TD-19（emergency）、TD-20（home 干净切片）六个先例验证过的「仓储端口」模式上，选 **counselor 域的金句子族**（`quotes` / `user_quote_favorites` 两张扁平子表 + 唯一消费 service `QuoteService`）按 TD-13 四件套复制；本批是 C2 首个进入 **counselor 重型域** 的切片（域内其余 24 entity / 30+ service 留后续批）
> 改动范围：`src/counselor/`（仅目标 service + `domain/` + `data/` + module 接线）+ `test/counselor/`（新建端口替身 spec）+ 交付文档；`engine-core/`、`src/migration/`、配置、CI、其他业务域、前端不碰

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `E:\Work\Project\backend\mofang-nestjs\README.md` —— 仓库总览
2. `E:\Work\Project\backend\mofang-nestjs\docs\README.md` —— 文档导航
3. `E:\Work\Project\backend\mofang-nestjs\docs\team\conventions.md` —— 代码红线 + 交付格式（§1.1 engine-core 分层、§1.3 pnpm 命令规范、§三 16 条硬约束、§2.5 偏差登记）
4. 阶段工作入口：`docs/worklog/pending/phase2.5-README.md` 与 `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md`
5. 根因与既往结论：
   - TD-14 备忘 `docs/architecture/entity-typeorm-decoupling-assessment-2026-11-14.md` §5.3（G 收益口径）、§6.1（C+ / C1 / C2 三段）、§6.2（试点域选择标准与候选排序）
   - TD-20 交付记录 `docs/worklog/completed/phase2.5/td20-home-messages-moodlog-port-c2-batch4-implementation-2026-11-15.md`（最近一个四件套先例：同域双端口切片、Row 出参、替身 spec 结构、typeorm 符号外泄复核、行为对照表、偏差登记）
   - TD-19 交付记录 `docs/worklog/completed/phase2.5/td19-emergency-port-c2-batch3-implementation-2026-11-15.md`（**原生 SQL / QB 下沉实现层**先例）
   - TD-16 交付记录 `docs/worklog/completed/phase2.5/td16-life-map-port-pilot-c1-implementation-2026-11-14.md`（同域多端口划分先例：按实体分端口的判定口径）
   - TD-13 交付记录 `docs/worklog/completed/phase2.5/td13-repository-port-analytics-pilot-implementation-2026-11-14.md`（四件套结构、端口方法面口径、typeorm 符号外泄复核、偏差登记）
   - 端口样板：`src/home/domain/repositories/` + `src/home/data/`；`src/emergency/domain/repositories/emergency-session.repository.ts` + `src/emergency/data/emergency-session.repository.typeorm.ts`
6. 本任务单（就是你在读的这份）

---

## 1. 背景（先读，方向别错）

TD-14 备忘 §6.1 推荐路线分三段：**C+（枚举外移，TD-15 已交付）→ C1（试点域端口化，TD-13 analytics + TD-16 life-map 已交付）→ C2（按域推广，TD-17 consent 第一批、TD-18 good_state_diary 第二批、TD-19 emergency 第三批、TD-20 home 干净切片第四批已交付，本单为第五批）**。C2 的任务是把已成型的域级模板逐域复制；每批验收口径按 TD-14 §5.3 修正版执行，**不再以加载图减重为 KPI**。

**模式定义**（沿用 TD-13 四件套，本批双端口）：

1. **端口**：`src/counselor/domain/repositories/` 下两个文件 —— `quote.repository.ts`（`QuoteRepository` + `QUOTE_REPOSITORY` token + `QuoteRow`）与 `quote-favorite.repository.ts`（`QuoteFavoriteRepository` + `QUOTE_FAVORITE_REPOSITORY` token + `FavoriteRow`）；零 typeorm 值符号。
2. **TypeORM 实现**：`src/counselor/data/` 下两个文件 —— `quote.repository.typeorm.ts` 与 `quote-favorite.repository.typeorm.ts`；`@InjectRepository` + `Repository` + QueryBuilder / 查询操作符全部收在这两个文件；域内本批端口对应的 typeorm 值符号只允许落在实现文件与 module 装配层。
3. **module 接线**：两组 provider `{ provide: QUOTE_REPOSITORY, useClass: QuoteRepositoryTypeorm }` / `{ provide: QUOTE_FAVORITE_REPOSITORY, useClass: QuoteFavoriteRepositoryTypeorm }`；**保留** `TypeOrmModule.forFeature([...])` 现有全部 25 个 entity 注册；exports 口径按现状（仓储 token 不 export，对齐 TD-13 D-4 / TD-16 ~ TD-20）。
4. **端口替身 spec**：`test/counselor/td21-counselor-quote-port-c2-batch5.spec.ts` —— 替身只记调用参数 + 返回预设行；不起真 TypeORM、不连 DB、不 `vi.mock('typeorm')`。

### 1.1 切片选定：counselor 域金句子族（主控取证锚点，HEAD `2b03756`；执行方复核并登记偏差）

| TD-14 §6.2 选择标准                      | quotes / user_quote_favorites 实测                                                                                                              | 判定 |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1. 扁平表优先（无关系装饰器）            | `Quote` / `UserQuoteFavorite` 关系装饰器 **0**（@ManyToOne / @OneToMany / @ManyToMany / @OneToOne / @JoinColumn / @JoinTable 全 0）             | ✅   |
| 2. entity 文件内无枚举                   | 0 内联 `enum`；`category` 为开放 varchar 标签（非 ENUM）；两表均无内联枚举                                                                      | ✅   |
| 3. 无跨模块仓储消费                      | src 他域 grep `UserQuoteFavorite` / `quote.entity` / `Quote`（排除 migration DDL）= **0**；跨模块命中的 counselor entity 属其他子族，与本批无关 | ✅   |
| 4. 引用面小 + module forFeature 单点注册 | 两个目标仓储仅被 `QuoteService` 一个 service 使用；`CounselorQuoteController` 只注入 `QuoteService`；`counselor.module.ts` 单点 `forFeature`    | ✅   |
| 5. 已有等价端口先例可抄                  | TD-13 / TD-16 / TD-17 / TD-18 / TD-19 / TD-20 六套四件套均在仓内                                                                                | ✅   |

**本批排除（明确不在范围，见 §2）**：counselor 域内其余 24 个 entity 与 30+ 个 service，尤其：

- **枢纽仓 `TrainingSession`**：被 10 个 service 共用（character-usage / growth-archive / informed-consent / session-context.builder / session-degraded / supervision / training-session / transcript-bookmark / transference-mark / vpt-session-bridge），跨切片消费最多，留后续单独批次；
- **关系仓 `LongTermCase` / `LongTermCaseSession`**：entity 含关系装饰器（1 / 2 处），属 TD-14 分层里的关系面，留后续批；
- visitor-pool / visitor-persona 子族、ability 子族、training-exercise 子族、supervision 子族、practice-* 各 service、其他单仓 service（counselor-ui-preference / live-hint / student-risk-event / transcript-bookmark / transference-mark 等）；
- `src/counselor/seeds/` 目录（4 个 seed 脚本经 `dataSource.getRepository(...)` 装配种子层，不纳入本批端口化）。

### 1.2 本批现状清单（主控实测；`test/` 下 **0** 既有 spec 引用本批 entity / service）

| 文件                                                                                       | 现状                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entities/quote.entity.ts`（`Quote`，表 `quotes`）                                         | 扁平：`id`(varchar64 PK，稳定 slug，非 UUID) / `tenantId`(char36) / `userId`(char36 nullable) / `text`(text) / `author`(varchar100) / `sourceWork`(varchar200 nullable) / `category`(varchar50) / `backgroundUrl`(varchar500) / `publishedAt`(datetime) / `enabled`(tinyint default 1) / `createdAt`(`@CreateDateColumn`) / `updatedAt`(`@UpdateDateColumn`) / `deletedAt`(datetime nullable，**列级软删标记，非 `@DeleteDateColumn`**)；索引 `idx_q_published`(publishedAt, id)；**本单不改 entity 文件** |
| `entities/user-quote-favorite.entity.ts`（`UserQuoteFavorite`，表 `user_quote_favorites`） | 扁平：`id`(uuid PK) / `tenantId`(char36) / `userId`(char36) / `quoteId`(varchar64) / `createdAt`(`@CreateDateColumn`)；索引 `uniq_uqf_user_quote`(userId, quoteId, unique) + `idx_uqf_user_created`(userId, createdAt)；**无 `deletedAt` 列 —— 收藏关系走硬删**（entity 注释明确：软删 + UNIQUE(user_id, quote_id) 会让"取消后再收藏"撞唯一键）；**本单不改 entity 文件**                                                                                                                                  |
| `providers/quote.service.ts`（`QuoteService`）                                             | **直连 2 个 Repository**：`@InjectRepository(Quote) private readonly quoteRepo` + `@InjectRepository(UserQuoteFavorite) private readonly favoriteRepo`；值位置 import 两个 entity 类；5 个公共方法 `getToday` / `list` / `favorite` / `unfavorite` / `listFavorites`；私有 `findVisibleQuotes` / `loadFavoritedIds` / `assertQuoteExists` / `toDto`；`Logger` 只打 user / quote（隐私口径不变）                                                                                                            |
| `controllers/quote.controller.ts`                                                          | `CounselorQuoteController` 只注入 `QuoteService`；无 Repository / entity 旁路；**不改**                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `dto/quote.dto.ts`                                                                         | `QuoteDto` / `QuoteListDto` / `QuoteQueryDto` / `QuoteFavoriteResultDto`；不 import 本批 entity；**不改**                                                                                                                                                                                                                                                                                                                                                                                                  |
| `counselor.module.ts`                                                                      | `forFeature([...25 entity...])`（含 `Quote` / `UserQuoteFavorite`）；providers 含 `QuoteService`；controllers 含 `CounselorQuoteController`；现状 exports 口径保持不变，仓储 token 仍不 export                                                                                                                                                                                                                                                                                                             |

**test/ 现状**：`test/counselor/quote-engine.spec.ts` 只测 `config/quote-seeds.ts` 纯函数（`QUOTE_SEEDS` / `quoteDayIndexOf` / `validateQuoteSeeds`）与 DTO 结构，**不 import service / entity / Repository** → 本批**零既有测试适配面**（与 TD-19 / TD-20 同口径）；新端口替身 spec 为本批唯一新增测试文件。

### 1.3 仓储调用面（端口方法面只收这些现有调用，不泛化）

**A. `QuoteService` 对 `Quote` 仓储的现有调用形态：**

1. **可见性 QB · 今日池**（私有 `findVisibleQuotes`，L258–272）：`createQueryBuilder('q').where('q.deletedAt IS NULL').andWhere('q.enabled = :enabled', { enabled: true }).andWhere('(q.userId IS NULL OR q.userId = :userId)', { userId }).orderBy('q.publishedAt','DESC').addOrderBy('q.id','DESC').getMany()`。
2. **可见性 QB · feed 游标分页**（`list`，L117–126）：同一套 where / order；可选游标 —— `findOne({ where: { id: query.cursor } })` 取锚点（未命中抛 `BizException(QuoteCursorInvalid)`），anchor 非空时追加 `(q.publishedAt < :anchorPublishedAt OR (q.publishedAt = :anchorPublishedAt AND q.id < :anchorId))`；`qb.take(limit + 1).getMany()`。
3. **`findOne` 取锚点**（`list` L131）：`quoteRepo.findOne({ where: { id: query.cursor } })`。
4. **`findOne` 存在性校验**（私有 `assertQuoteExists` L299）：`quoteRepo.findOne({ where: { id: quoteId } })`；返回行的 `enabled` / `deletedAt` 判定留 service（未命中或下架抛 `BizException(QuoteNotFound)`）。
5. **`find` 按 id 集合**（`listFavorites` L234）：`quoteRepo.find({ where: { id: In(quoteIds) } })`。

**端口方法建议（QuoteRepository）**（实现单可调整，须在交付记录写明偏差与理由）：

- `findVisiblePool(userId: string): Promise<QuoteRow[]>` —— 调用 #1；可见性谓词与排序下沉实现层。
- `listVisibleKeyset(userId: string, anchor: { publishedAt: Date; id: string } | null, take: number): Promise<QuoteRow[]>` —— 调用 #2；可见性谓词、排序、keyset 推进条件下沉实现层；`limit + 1` 多取一条与 `hasMore` 切片留 service。
- `findAnchorById(id: string): Promise<QuoteRow | null>` —— 调用 #3（游标锚点）。
- `findById(quoteId: string): Promise<QuoteRow | null>` —— 调用 #4（存在性校验；`enabled` / `deletedAt` 判定留 service）。
- `findManyByIds(quoteIds: string[]): Promise<QuoteRow[]>` —— 调用 #5。

**B. `QuoteService` 对 `UserQuoteFavorite` 仓储的现有调用形态：**

1. **`upsert`**（`favorite` L176–183）：`favoriteRepo.upsert({ tenantId: userId, userId, quoteId }, { conflictPaths: ['userId', 'quoteId'] })`（幂等，冲突 no-op）。
2. **硬删**（`unfavorite` L205）：`favoriteRepo.delete({ userId, quoteId })`；**刻意不校验金句存在**（取消收藏的终态在金句下架时已成立）。
3. **按用户列收藏关系**（`listFavorites` L225–228）：`favoriteRepo.find({ where: { userId }, order: { createdAt: 'DESC' } })`。
4. **按用户 + id 集合取收藏 quoteId**（私有 `loadFavoritedIds` L285–288）：`favoriteRepo.find({ where: { userId, quoteId: In(quoteIds) }, select: { id: true, quoteId: true } })`。

**端口方法建议（QuoteFavoriteRepository）**：

- `upsert(userId: string, quoteId: string, tenantId: string): Promise<void>` —— 调用 #1；conflictPaths `[userId, quoteId]` 下沉实现层。
- `deleteByUserAndQuote(userId: string, quoteId: string): Promise<void>` —— 调用 #2；硬删。
- `findFavoritesByUser(userId: string): Promise<FavoriteRow[]>` —— 调用 #3；`createdAt DESC` 下沉实现层。
- `findFavoriteQuoteIds(userId: string, quoteIds: string[]): Promise<string[]>` —— 调用 #4；select `quoteId`，返回 quoteId 数组（`Set` 聚合留 service）。

**Row 类型 `QuoteRow` 字段**（entity → Row 映射，窄领域类型，不含 entity 类；含软删列 `deletedAt`）：

```
id: string
tenantId: string
userId: string | null
text: string
author: string
sourceWork: string | null
category: string
backgroundUrl: string
publishedAt: Date
enabled: boolean
createdAt: Date
updatedAt: Date
deletedAt: Date | null
```

**Row 类型 `FavoriteRow` 字段**（无 `deletedAt`；硬删关系表）：

```
id: string
tenantId: string
userId: string
quoteId: string
createdAt: Date
```

### 1.4 与先例的关键差异（任务单固化，不可照抄先例）

1. **counselor 域内切片 + 双端口**。counselor 是重型域（223 个 ts、26 entity、60+ 处仓储注入），本批只做金句子族两张表 + `QuoteService`；端口文件按实体分两个（对齐 TD-16 / TD-20 按实体分端口先例）。域内其余子族与枢纽仓 / 关系仓留后续批。
2. **QueryBuilder 下沉实现层**。Quote 端口承载两处可见性 QB（今日池 + feed keyset 分页）；可见性谓词 `(q.userId IS NULL OR q.userId = :userId)` 是全仓唯一一处，必须逐字保留在实现层（对齐 TD-19 原生 SQL 下沉先例，本单下沉对象为 QB）。
3. **软删 / 硬删口径不得混写**。`Quote.deletedAt` 是列级 nullable datetime（非 `@DeleteDateColumn`），Row 保留 `deletedAt`；`UserQuoteFavorite` **无 `deletedAt` 列、走硬删**（entity 注释明确的刻意选择），`FavoriteRow` 不含该列。交付记录与 Row 类型都不得把收藏表写成软删。
4. **零既有测试适配面**。`quote-engine.spec.ts` 不碰 service / Repository；本单**不改动任何既有测试**。
5. **seed 不纳入端口化**。`src/counselor/seeds/quotes.seed.ts` 经 `dataSource.getRepository(Quote)` 做幂等种子写入（装配数据层），保留现状；本批端口只收 `QuoteService` 的仓储调用面。
6. **module 现状保留**。`forFeature` 现有全部 25 个 entity 注册原样保留；现状 exports 清单不变，**仓储 token 仍不 export**。
7. **service 公共签名不变**：`getToday(userId)` / `list(userId, query)` / `favorite(userId, quoteId)` / `unfavorite(userId, quoteId)` / `listFavorites(userId)` 五个方法签名、返回 DTO / 返回形状逐字保持。

### 1.5 遗留观察（不进本单范围，交付记录登记）

- **观察（沿用 TD-19）**：`src/emergency/enums/emergency.enums.ts` 的 `isTerminalPhase(phase)` 全仓 0 调用方（死代码），另案评估是否删除；本单不动 enums。
- **观察（沿用 TD-18）**：根目录 e2e 遗留 spec 未被任何 vitest config 收集的测试入口收纳问题，另案评估，本单不清理、不移动、不改 include。
- **观察（沿用 TD-20）**：home 域 `HomeMoodLogService.logMood` 0 调用方；日期边界按服务端本地时区计算（V3 计划接 timezone 入参）；均与本批无关，沿用登记。
- **观察（新，本批取证）**：`user-quote-favorite.entity.ts` 头部注释 L13 写「created_at / deleted_at (软删)」，但类内**实际无 `deletedAt` 列**（硬删口径，见 §1.4 差异 3）—— 注释与实现脱节；entity 文件本单一字不改，注释修正另案登记，不与本端口化混做。

### 1.6 基线闸门（HEAD `2b03756`）

参考 TD-20 交付记录基线：全量 **3356 passed + 4 skipped（3360 例 / 200 文件）**；lint **0 error / 1 warning**（`test/e2e/v2-user-flow.spec.ts:1` 既有 unused eslint-disable，范围外不修）；lint:fast **0 / 0**；boundary **12 passed**；根 tsc / build tsc **0 error**；`git diff --stat HEAD -- src/engine-core` 为空。

> 执行方开工时须先复核本机基线（用例数 / 文件数 / warning 数）并在交付记录写实测值；若与上述参考基线不一致，以实测为准并登记偏差。本域定向：`test/counselor/` 既有 spec 16 个（含纯函数 `quote-engine.spec.ts`），新端口替身 spec 为本批唯一新增测试文件。

---

## 2. 范围（严格遵守，不越权）

### 在范围内

1. **端口文件**：`src/counselor/domain/repositories/quote.repository.ts` + `src/counselor/domain/repositories/quote-favorite.repository.ts`（interface + Symbol token + `QuoteRow` / `FavoriteRow`）。
2. **TypeORM 实现**：`src/counselor/data/quote.repository.typeorm.ts` + `src/counselor/data/quote-favorite.repository.typeorm.ts`；`@InjectRepository` / `Repository` / QueryBuilder / 查询操作符（`In` 等）只允许出现在这两个实现文件与 module 装配层。
3. **目标 service** 改依赖端口（直连 Repository 抽出）：`providers/quote.service.ts`；service 不再值位置 import entity 类；私有 `toDto` 的入参类型签名替换为 `QuoteRow`。
4. **module 接线**：新增两组端口 provider；保留 `forFeature` 现有全部 entity 注册；exports 保持现状（仓储 token 不 export）。
5. **service 公共签名不变**：五个方法签名、返回 DTO / 返回形状逐字保持。
6. **端口替身 spec**：`test/counselor/` 新增（工作项前缀 + 端口语义，对齐 TD-13 D-1 / TD-16 ~ TD-20 命名）；替身记调用参数 + 返回预设行；**spec 零 entity import**；不起真 TypeORM、不连 DB、不 `vi.mock('typeorm')`。
7. **文档与索引回写**（§7 清单）。

### 明确不在范围内（禁止顺手做）

- **entity 文件一字不改**：字段、装饰器、列、索引、类型引用、软删 / 硬删口径全部保留；DTO、controller、路由、业务语义不动；`config/quote-seeds.ts` 不动。
- **排除 service / entity 一律不动**：counselor 域内其余 24 entity 与 30+ service 的仓储依赖、import、逻辑本批不碰；枢纽仓 `TrainingSession`、关系仓 `LongTermCase` / `LongTermCaseSession` 不纳入；`seeds/` 目录不动。
- 本域无 `index.ts` barrel；顶层 `src/index.ts` barrel 的 entity 类值导出边归另案 **M**，本单不删导出、不改对外面。
- 不做 Row 纯类型持久化分层映射的其他推广；不做 EntitySchema / 纯类改造；不补端口内存实现（另案 **I**）。
- 端口方法面只收 §1.3 现有调用；**不扩通用仓储代理**、不暴露 typeorm 管理句柄 / 查询选项 / 操作符；端口不写 SQL；端口 / service / spec 不暴露 entity 类名。
- 其他业务域零改动；`src/migration/` 零改动；不改 package.json / tsconfig / `vitest.config.mts` / `test/vitest.e2e.mts` / CI / Dockerfile；不新增第三方依赖；不碰 `admin-dashboard/` 与 Flutter。
- 既有 spec 断言 / mock 语义零改动；其他域 spec 不新增、不修改。
- 不自动 git commit / push（写完给 commit 草稿，等用户指令）。

### 另案登记（本单不做，写入交付记录遗留段）

- **C2 / G**：其余域仓储端口化分批推广；每批验收口径 = 「service 源码层 typeorm 值符号 0 命中」+「该批 spec 值位置 entity import = 0」（TD-14 备忘 §5.3，不再以加载图减重为 KPI）。后续批次候选：counselor 其余子族（ability / training-exercise / visitor-pool / supervision / practice-* 等）→ home 微干预一族 + companion / overview 切片 → inner_world → ai-engine → companion → profile / user。
- **I**：端口内存实现是否补（本单不补；spec 替身已覆盖替身需求）。
- **J**：混合形态 typeorm import 统一形态（可读性向、零运行时收益，另案批量处理）。
- **K**：`bin/ormconfig.ts` 的 `entities` glob 口径脱节（独立既有债，沿用 TD-14 登记）。
- **M**：entity 类值位置边 —— 本批 service 值位置 entity import 归零；顶层 barrel `export *` 残留的 entity 类导出边归 C2/G 推广时闭合。
- **N**："枚举 / 端口文件零 typeorm 依赖"静态守护 spec（本单不新增；守护证据走 grep 复核 + lint）。
- **P**：consent 失败容忍语义未落地（TD-17 另案，沿用登记，与本域无关）。
- **观察（沿用）**：`isTerminalPhase` 0 调用方死代码；根目录 e2e 遗留 spec 未被任何 config 收集；home 域 `logMood` 0 调用方与日期本地时区口径。

---

## 3. 目标交付物

### 3.1 代码改动

- 两个端口文件 + 两个 TypeORM 实现文件（`domain/repositories/` + `data/`）；`counselor.module.ts` 两组 provider 接线；`QuoteService` 依赖改端口；新增端口替身 spec。
- 业务行为零漂移：
  - 今日金句：可见性谓词（共享 `userId IS NULL` + 本人自建）、`deletedAt IS NULL` + `enabled = true`、`publishedAt DESC, id DESC` 排序；空池抛 `QuoteLibraryEmpty`；`quoteDayIndexOf(new Date()) % pool.length` 取模定位留 service；回填本人收藏状态。
  - 金句流：同一可见性谓词与排序；游标锚点未命中抛 `QuoteCursorInvalid`；keyset 推进条件；`limit + 1` 多取一条 + `hasMore` 切片 + `nextCursor` 组装留 service；返回形状 `{ items, nextCursor }` 不变。
  - 收藏：`upsert` 幂等（conflictPaths userId/quoteId）；取消收藏硬删、不校验金句存在；日志 `[quote_favorited] user=... quote=...` / `[quote_unfavorited] user=... quote=...` 逐字不变。
  - 我的收藏：按 `createdAt DESC` 列收藏关系；按收藏顺序输出；金句已下架 / 删除的跳过；`{ items, nextCursor: null }` 形状不变。
  - DTO 转换 `toDto`：`id / text / author / category / backgroundUrl / publishedAt(ISO) / sourceWork / favorited` 字段与形状逐字不变。

### 3.2 静态复核证据（grep 复核，结果落交付记录）

1. **typeorm 符号外泄**：两个端口文件、目标 service、新 spec 共 5 个受检面，`Repository` / `IsNull` / `In` / `MoreThanOrEqual` / `FindOptionsWhere` / `EntityManager` / `createQueryBuilder` / `from 'typeorm'` / `from '@nestjs/typeorm'` 值符号 **0 命中**（注释文案也避开 typeorm 字面量，对齐 TD-13 D-5）；命中只允许在两个 `data/` 实现文件与 module 装配层。
2. **spec 零 entity import**：新 spec 对 `entities/` 路径的 entity 类 import = **0**。
3. **service 值位置 entity import = 0**：`QuoteService` 不再值位置 import entity 类。
4. **方法面不泛化**：两个端口方法与 §1.3 调用面一一对应（Quote 5 方法 / 5 处调用形态；Favorite 4 方法 / 4 处调用形态）；新 spec 用例显式断言调用次数与参数；无新增通用 `findAll` / `updateById` 之类代理方法。

### 3.3 交付记录（§6 固定路径）

含改动清单、两端口方法面清单、typeorm 符号外泄复核表、service 行为与改前对照表（可见性谓词 / 今日池排序与取模 / keyset 游标 / upsert 幂等 / 硬删 / 收藏列序 / 下架跳过 / DTO 转换 / 日志口径）、偏差登记（conventions §2.5）、边界确认、遗留另案。

> **口径真相源**：调用面与出参形状以仓内实测为准；若与 §1.2 / §1.3 锚点不一致，以实测为准并在偏差表写清原锚点 / 实测值 / 理由。

---

## 4. 红线（违反即返工）

- **engine-core 零改动**：`git diff --stat HEAD -- src/engine-core` 为空；`boundary.spec.ts` 不改。
- **entity 文件零改动**：装饰器 / 列 / 索引 / 类型引用 / 软删·硬删口径保留；migration DDL 不动。
- **方法面纪律**：端口只收现有调用，不扩通用代理；不暴露 typeorm 句柄 / 查询选项 / 操作符；业务层不出现 entity 类名。
- **业务语义冻结**：service 公共签名不变；DTO / controller 路由不变；今日轮换 / feed 分页 / 收藏幂等 / 硬删 / 收藏列序 / DTO 转换语义不变。
- 隐私：心理对话原文禁止进文档 / 日志 / console / crash report（只出码与计数）；本批日志只打 user / quote / 错误名。
- pnpm 命令规范：一律 `pnpm` / `pnpm exec`，禁止裸 `npx`。
- 不新增依赖；不越权加需求外功能；不自动 commit / push。

---

## 5. 闸门（填真实数字，禁止留空）

### 5.0 前置（命令规范，强制）

- 跑闸门前确认机器状态：记录是否有 `nest start --watch` / `vite dev` / `node dist/app` 常驻进程（墙钟可比性以用例数 / 文件数为准，不杀用户进程）；跑 `pnpm doctor:fs` 记录结果。
- 取证会话 PATH 先补 `D:\Apps\Git\cmd`（依赖外部命令的 spec 才不会假失败）。

### 5.1 收尾闸门（本单跑一次，记录真实命令 / exit / 数字）

| 闸门         | 命令                                                                              | 要求                                                                                                                                                             |
| ------------ | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 盘读前置     | `pnpm doctor:fs`                                                                  | exit 0，记录均值 ms/文件与 slow 占比                                                                                                                             |
| 根类型       | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`           | 0 error                                                                                                                                                          |
| 构建类型     | `pnpm exec tsc -p tsconfig.build.json --noEmit`                                   | 0 error                                                                                                                                                          |
| Lint（权威） | `pnpm lint`                                                                       | 0 error，记录 warning 数（基线既有 1 条 e2e warning，范围外不修）                                                                                                |
| oxlint fast  | `pnpm lint:fast`                                                                  | 0 warning / 0 error                                                                                                                                              |
| 定向 spec    | `pnpm exec vitest run test/counselor/`（新端口替身 spec；位置参数按实际文件调整） | 全绿，记录用例数 / 文件数                                                                                                                                        |
| 全量测试     | `pnpm test`                                                                       | exit 0；基线 **3360 例 / 200 文件**集合不减少、既有断言不改；记录总用例数、文件数、墙钟与机器状态；增量 = 本批新增 spec 用例数                                   |
| engine-core  | `git diff --stat HEAD -- src/engine-core`                                         | 空                                                                                                                                                               |
| 范围隔离     | `git diff --name-only HEAD`                                                       | 改动仅限 `src/counselor/`（目标 service + domain + data + module）、`test/counselor/` 与交付文档；无 package.json / tsconfig / vitest 配置 / CI / 其他业务域改动 |
| 边界         | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                          | 12 passed                                                                                                                                                        |
| 静态复核     | §3.2 四项 grep 证据                                                               | 逐条结果落交付记录                                                                                                                                               |

> 验收侧不重跑全量；执行方交付记录里的闸门数字 + CI 结果作为合并底线。

---

## 6. 交付记录（完成后写，路径固定）

`docs/worklog/completed/phase2.5/td21-counselor-quote-port-c2-batch5-implementation-2026-11-15.md`

内容必须含：

1. 本单做了什么（一句话：counselor 域金句子族两张表按 TD-13 四件套落地双端口，C2 推广第五批）；
2. 改动文件清单（新建 / 修改，逐个一句用途；两端口粒度与排除理由）；
3. 端口方法面清单（接口 / token / 入参 / Row 类型 / 唯一调用方；Quote 软删列与 Favorite 硬删无 `deletedAt` 的偏差说明）；
4. 闸门表：命令 / exit code / 真实数字（error、warning、用例总数、文件数、墙钟与机器状态）；
5. typeorm 符号外泄复核表（受检文件逐个命中数）；
6. service 行为与改前对照表（可见性谓词 / 今日池排序与取模 / keyset 游标 / upsert 幂等 / 硬删 / 收藏列序 / 下架跳过 / DTO 转换 / 日志口径）；
7. 边界确认：entity 文件零改动、DTO / controller / config / 排除 service / 跨域 module import / barrel 导出面 / 其他业务域 / migration / 配置未动；既有测试零改动；
8. 遗留项：§2 另案 C2/G / I / J / K / M / N / P + 观察（`isTerminalPhase` 死代码、根目录 e2e 未收集、home `logMood` 与日期时区口径）逐条登记；Actions 侧待复核点（若有）；
9. 一行 commit message 草稿（**不自己 commit / push**，等用户指令）。

---

## 7. 【交付回写清单】做完逐项勾选（硬清单，不许跳）

- [x] 交付记录已写到 §6 固定路径
- [x] 本任务单从 `pending/` 移到 `completed/phase2.5/`，顶部状态行改 ✅ 并链交付记录
- [x] 回写 WP 登记表：`docs/worklog/pending/phase2.5-wp-list-2026-11-08.md` §四 TD-21 行改完成态、补交付记录链接
- [x] 回写阶段入口：`docs/worklog/pending/phase2.5-README.md` §3 TD-21 bullet 改完成态
- [x] 回写台账：`docs/team/gate-performance-remediation-2026-11-11.md` §9 P-DEBT-11 行追加 C2 第五批落地结论 + 链接；更新记录补一条；另案 C2/G/I/J/K/M/N/P + 观察登记口径更新
- [x] `git diff --stat HEAD -- src/engine-core` 为空；`src/migration/` 零改动
- [x] 提交分组核对：本单文件与并行进程产物分开；若授权代提交，stage 只含本单文件
- [x] 给一行 commit message 草稿（**不自己 commit / push**，等用户指令）

---

## 8. 回复输出约定

完成后在对话里：

1. 说一句"已写入交付记录"并附文件路径，不重复贴全文；
2. 报告闸门真实数字（tsc / eslint / vitest 用例数 / boundary）；
3. 报告本单结论一句话（counselor 金句双端口完成、spec 零 entity import）+ §7 回写清单哪几项已做、有没有遗留；
4. 不把代码 diff 全文贴进对话，让用户自己 `git diff` / 打开交付记录。

---

_本单不新增第三方依赖；不改 schema / migration；仅 counselor 域 quotes + user_quote_favorites 两张子表仓储端口化 + 新增端口替身 spec；engine-core 零 diff；未自动 commit / push。_
