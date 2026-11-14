# TD-18 · C2 第二批仓储端口化（good_state_diary 域 · P-DEBT-11 / L-1 · TD-14 推荐路线第三段 C2 第二批）

> 状态：✅ **已交付**（2026-11-14，MiniMax Code）→ 交付记录：`docs/worklog/completed/phase2.5/td18-good-state-diary-port-c2-batch2-implementation-2026-11-14.md`
> 仓库：E:\Work\Project\backend\mofang-nestjs，分支 integrate，基线 HEAD `aef8b26`（TD-17 交付后，与 `origin/integrate` 一致）
> 唯一事实源：`docs/team/gate-performance-remediation-2026-11-11.md` §9 **P-DEBT-11**（L-1）+ `docs/architecture/entity-typeorm-decoupling-assessment-2026-11-14.md`（TD-14 备忘）§5.3 / §6.1 / §6.2 + TD-13 / TD-16 / TD-17 交付记录（四件套模板与先例）
> 任务性质：**实现单（C2 推广第二批）** —— 在 TD-13（analytics）、TD-16（life-map）、TD-17（consent）三个先例验证过的「仓储端口」模式上，选第四个业务域 **good_state_diary** 按 TD-13 四件套完整复制一遍；本域是 C2 批次里方法面最宽的一个（CRUD + 软删 / 恢复 + 双游标分页 + LIKE 检索 + 物理擦除 + 草稿上限），用于把模板压到「宽方法面 + 软删生命周期」域上
> 改动范围：`src/good_state_diary/` + `test/good_state_diary/`（新建）+ 既有两处测试最小适配 + 交付文档；`engine-core/`、`src/migration/`、配置、CI、其他业务域、前端不碰

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `E:\Work\Project\backend\mofang-nestjs\README.md` —— 仓库总览
2. `E:\Work\Project\backend\mofang-nestjs\docs\README.md` —— 文档导航
3. `E:\Work\Project\backend\mofang-nestjs\docs\team\conventions.md` —— 代码红线 + 交付格式（§1.1 engine-core 分层、§1.3 pnpm 命令规范、§三 16 条硬约束、§2.5 偏差登记）
4. 阶段工作入口：`docs/worklog/pending/phase2.5-README.md` 与 `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md`
5. 根因与既往结论：
   - TD-14 备忘 `docs/architecture/entity-typeorm-decoupling-assessment-2026-11-14.md` §5.3（G 收益口径）、§6.1（C+ / C1 / C2 三段）、§6.2（试点域选择标准与候选排序）
   - TD-17 交付记录 `docs/worklog/completed/phase2.5/td17-consent-port-c2-batch1-implementation-2026-11-14.md`（最近一个四件套先例：单端口粒度、Row 出参、工厂下沉实现层、替身 spec 结构、typeorm 符号外泄复核、行为对照表、偏差登记）
   - TD-16 交付记录 `docs/worklog/completed/phase2.5/td16-life-map-port-pilot-c1-implementation-2026-11-14.md`（软删生命周期口径、多端口划分判定、Row 取舍先例）
   - TD-13 交付记录 `docs/worklog/completed/phase2.5/td13-repository-port-analytics-pilot-implementation-2026-11-14.md`（四件套结构、端口方法面口径、typeorm 符号外泄复核、偏差登记 D-1 ~ D-7）
   - 端口样板：`src/consent/domain/repositories/consent.repository.ts` + `src/consent/data/consent.repository.typeorm.ts`（单端口 + 工厂在实现层）；`src/life-map/domain/repositories/`（4 端口）；`src/analytics/domain/repositories/analytics-event.repository.ts`
6. 本任务单（就是你在读的这份）

---

## 1. 背景（先读，方向别错）

TD-14 备忘 §6.1 推荐路线分三段：**C+（枚举外移，TD-15 已交付）→ C1（试点域端口化，TD-13 analytics + TD-16 life-map 已交付）→ C2（按域推广，TD-17 consent 第一批已交付，本单为第二批）**。C2 的任务是把已成型的域级模板逐域复制；每批验收口径按 TD-14 §5.3 修正版执行，**不再以加载图减重为 KPI**。

**模式定义**（沿用 TD-13 四件套）：

1. **端口**：`src/good_state_diary/domain/repositories/diary-entry.repository.ts` —— interface + Symbol DI token + 入参 / Row 类型；零 typeorm 值符号。
2. **TypeORM 实现**：`src/good_state_diary/data/diary-entry.repository.typeorm.ts` —— `@InjectRepository` + `Repository` + QueryBuilder 等查询操作符全部收在此文件；域内唯一允许出现 typeorm 值符号的业务文件（module 装配层除外）。
3. **module 接线**：provider `{ provide: DIARY_ENTRY_REPOSITORY, useClass: DiaryEntryRepositoryTypeorm }`；**保留** `TypeOrmModule.forFeature([GoodStateDiaryEntry])`；exports 口径按现状（本域无跨模块仓储消费，仓储 token 不 export，对齐 TD-13 D-4 / TD-16 / TD-17）。
4. **端口替身 spec**：`test/good_state_diary/td18-good-state-diary-port-c2-batch2.spec.ts` —— 替身只记调用参数 + 返回预设行；不起真 TypeORM、不连 DB、不 `vi.mock('typeorm')`。

### 1.1 域选定：good_state_diary（主控取证锚点，HEAD `aef8b26`；执行方复核并登记偏差）

| TD-14 §6.2 选择标准                      | good_state_diary 实测                                                                                                                                                      | 判定 |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1. 扁平表优先（无关系装饰器）            | `GoodStateDiaryEntry` 关系装饰器 **0**（@ManyToOne / @OneToMany / @ManyToMany / @OneToOne / @JoinColumn / @JoinTable 全 0）                                                | ✅   |
| 2. entity 文件内无枚举                   | 0 内联 `enum`；4 个枚举已外移 `enums/` 纯文件（status / mood-level / tag / ai-feedback-source，零 typeorm 依赖）；entity 有 `@DeleteDateColumn` 软删列                     | ✅   |
| 3. 无跨模块仓储消费                      | `src/` 其他目录仅 `app.module.ts` 装配 `GoodStateDiaryModule`；life-map / practice / pii-redactor / migration 均为注释或路由字符串；无其他 service / entity 值位置引用本域 | ✅   |
| 4. 引用面小 + module forFeature 单点注册 | 仓储仅被本域 `GoodStateDiaryService` 使用；`good_state_diary.module.ts` 单点 `forFeature`；两个 controller 只注入 service / AI service，无仓储旁路                         | ✅   |
| 5. 已有等价端口先例可抄                  | TD-13 analytics + TD-16 life-map + TD-17 consent 四件套均在仓内                                                                                                            | ✅   |

**域内构成**：1 张表（`good_state_diary_entries`）/ 1 个直连仓储的 `GoodStateDiaryService`；另有 `GoodStateDiaryAiService`（仅注入主 service，无仓储）+ `good-state-diary-ai.integration.ts`（纯 LLM 客户端抽象 + 启发式 stub，无仓储），两侧**均不进端口范围**。

### 1.2 good_state_diary 现状清单（主控实测，14 个 `.ts`，含 1 个既有 src spec）

| 文件                                                                                                                       | 现状                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entities/good-state-diary-entry.entity.ts`（`GoodStateDiaryEntry`，表 `good_state_diary_entries`）                        | 扁平：UUID PK + `authorId`(char36) / `status`(varchar32, default Draft) / `title`(varchar200 null) / `body`(text) / `moodLevel`(varchar32 null) / `moodSnapshottedAt`(datetime6 null) / `moodNote`(varchar500 null) / `sourceEmotionLogId`(char36 null) / `tags`(varchar64 null, CSV) / `linkedPracticeId`(varchar64 null) / `aiFeedback`(json null) / `aiFeedbackGeneratedAt`(datetime6 null) / `isPrivate`(boolean default true) / `createdAt` / `updatedAt` / `deletedAt`(`@DeleteDateColumn`, datetime6 null)；索引 `idx_gsde_author_status_time`(authorId, status, createdAt) + `idx_gsde_author_deleted`(authorId, deletedAt)；**本单不改 entity 文件** |
| `providers/good-state-diary.service.ts`                                                                                    | **直连 1 个 Repository**：`@InjectRepository(GoodStateDiaryEntry) private readonly entryRepo: Repository<GoodStateDiaryEntry>`；值位置 import entity 类；私有方法签名（`applyMoodSnapshot` / `applyAiFeedback` / `toDto`）参数类型为 entity；纯函数 `encodeCursor` / `decodeCursor` / `escapeLikePattern` / `parseStatusFilter` / `parseTagFilters` 不依赖仓储                                                                                                                                                                                                                                                                                                |
| `providers/good-state-diary-ai.service.ts`                                                                                 | 构造仅注入 `GoodStateDiaryService`，调 `diaryService.findOwnedOrThrow`；无仓储 / entity / typeorm；**不改**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `providers/good-state-diary-ai.integration.ts`                                                                             | `DIARY_LLM_CLIENT` Symbol + `DiaryLlmClient` interface + `HeuristicDiaryLlmClient` stub + provider；纯 LLM 客户端抽象，无仓储；**不改**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `controllers/good-state-diary.controller.ts`                                                                               | 只注入 `GoodStateDiaryService`；无 Repository / entity 旁路；**不改**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `controllers/good-state-diary-ai.controller.ts`                                                                            | 只注入 `GoodStateDiaryAiService`；**不改**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `dto/good-state-diary.dto.ts`                                                                                              | DTO，不 import entity；**不改**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `enums/diary-entry-status.enum.ts` / `diary-mood-level.enum.ts` / `diary-tag.enum.ts` / `diary-ai-feedback-source.enum.ts` | 纯枚举 + 解析 / 编解码辅助函数，零 typeorm 依赖；**不改**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `good_state_diary.module.ts`                                                                                               | `forFeature([GoodStateDiaryEntry])` + imports `UserModule`；providers `GoodStateDiaryService` / `GoodStateDiaryAiService`；exports `GoodStateDiaryService`；controllers 两个                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `providers/good-state-diary.service.spec.ts`                                                                               | **既有 src 内单测，15 例**（create 3 / update 4 / softDelete+restore 3 / getRecent 3 / purgeAll 1 / 错误码 1）；`Test.createTestingModule` + `{ provide: getRepositoryToken(GoodStateDiaryEntry), useValue: repo }`；mock 方法 create / save / findOne / softDelete / restore / delete / find / `createQueryBuilder`（QB 独立 `setupQueryBuilderMock`）；`MockEntry extends GoodStateDiaryEntry`；值位置 import entity 类。本单做**最小适配**（§2.5）                                                                                                                                                                                                         |

**test/ 现状**：`test/good-state-diary/` 目录不存在（本单新建）；`test/good-state-diary.e2e-spec.ts`（**10 例**，见 §1.5 遗留观察）；其他域 spec 不引用本域。

### 1.3 仓储调用面（端口方法面只收这些现有调用，不泛化）

`GoodStateDiaryService` 现有 **13 处**仓储调用形态（端口方法签名由实现单按 TD-13 D-2 口径设计，出参用 Row / 窄领域类型，登记偏差）：

1. `entryRepo.create({ ... })`（L109）—— 新建行实体工厂；端口化后**工厂下沉实现层**（对齐 TD-17 D-6：service 只构造纯对象入参，不依赖仓储工厂方法）
2. `entryRepo.save(entity)`（L122）—— create 保存
3. `entryRepo.save(entity)`（L148）—— update 保存
4. `entryRepo.softDelete({ id, authorId })`（L155）→ `{ affected }`；service 据 `affected === 0` 抛 `BizException(ResourceNotFound)`
5. `entryRepo.restore({ id, authorId })`（L163）→ `{ affected }`；同上 404 判定
6. `entryRepo.findOne({ where: { id, authorId } })`（L177）—— getById，默认过滤软删
7. `entryRepo.findOne({ where: { id, authorId }, withDeleted: true })`（L183）—— getByIdIncludingDeleted
8. QB `createQueryBuilder('e')` → author_id + status IN(:...statuses) + createdAt DESC + id DESC + limit(limit+1) + 可选 cursor（`created_at < cursorT OR (= AND id < cursorI)`）+ `getMany()`（L195–214）—— getRecent
9. `entryRepo.find({ where: { authorId, status: Draft }, order: { createdAt DESC, id DESC }, take: DRAFTS_LIMIT=200 })`（L227）—— getDrafts
10. QB `createQueryBuilder('e')` → author_id + (title LIKE OR body LIKE) + orderBy/limit + 可选 cursor + tagFilters 动态 andWhere（`CONCAT(',', IFNULL(e.tags, ''), ',') LIKE`）+ `getMany()`（L240–266）—— search
11. QB `createQueryBuilder().delete().where('deleted_at IS NOT NULL').andWhere('deleted_at < :cutoff').execute()` → affected（L285–290）—— purgeExpiredSoftDeletes
12. `entryRepo.delete({ authorId })` → affected（L299）—— purgeAll
13. `entryRepo.findOne({ where: { id, authorId }, withDeleted: opts.includeDeleted === true })`（L316）—— findOwnedOrThrow（service 内部复用，返回行供 update / restore）

**端口方法面建议**（实现单可调整，须在交付记录写明偏差与理由）：

- `create(input: CreateDiaryEntryInput): Promise<DiaryRow>` —— 新建；行由实现层 `repo.create(input)` + `repo.save(...)` 落库（工厂在实现层）
- `save(row: DiaryRow): Promise<DiaryRow>` —— 更新既有行（update 路径：service 先 `findById` 取 Row、改字段、再 `save`）
- `findById(uid: string, entryId: string, opts?: { includeDeleted?: boolean }): Promise<DiaryRow | null>` —— 合并调用 #6 / #7 / #13 三处 findOne；`includeDeleted` 口径与现状逐字一致
- `findDrafts(uid: string): Promise<DiaryRow[]>` —— 调用 #9；status=Draft、createdAt/id DESC、take 200 口径下沉实现
- `listRecent(query: ListRecentEntriesQuery): Promise<DiaryRow[]>` —— 调用 #8；QB 分页口径下沉实现；返回 `limit + 1` 行；**hasMore / 切片 / nextCursor 留 service**（游标编解码是 service 纯函数）
- `searchEntries(query: SearchEntriesQuery): Promise<DiaryRow[]>` —— 调用 #10；QB 检索口径下沉实现；**LIKE 转义 `escapeLikePattern` 与 tagFilters 解析留 service**；`hasMore / 切片 / nextCursor` 留 service
- `softDelete(uid: string, entryId: string): Promise<{ affected: number }>` —— 调用 #4
- `restore(uid: string, entryId: string): Promise<{ affected: number }>` —— 调用 #5
- `deleteByAuthor(uid: string): Promise<{ affected: number }>` —— 调用 #12（purgeAll）
- `purgeExpiredSoftDeletes(cutoff: Date): Promise<{ affected: number }>` —— 调用 #11；cutoff 缺省 30 天计算留 service，端口只收算好的 `cutoff`

**Row 类型 `DiaryRow` 字段**（entity → Row 映射，窄领域类型，不含 entity 类）：

```
id: string
authorId: string
status: DiaryEntryStatus            // 引用 enums/ 纯枚举，非 typeorm 值符号
title: string | null
body: string
moodLevel: DiaryMoodLevel | null
moodSnapshottedAt: Date | null
moodNote: string | null
sourceEmotionLogId: string | null
tags: string | null                 // CSV 字符串，不做枚举数组转换
linkedPracticeId: string | null
aiFeedback: Record<string, unknown> | null
aiFeedbackGeneratedAt: Date | null
isPrivate: boolean
createdAt: Date
updatedAt: Date
deletedAt: Date | null              // 本域 Row 必须保留（见 §1.4 差异点 1）
```

**入参类型**（service 构造，纯对象，不依赖仓储工厂）：

- `CreateDiaryEntryInput`：`authorId` / `status` / `body` / `title: string|null` / `moodLevel: DiaryMoodLevel|null` / `moodSnapshottedAt: Date|null` / `moodNote: string|null` / `sourceEmotionLogId: string|null` / `tags: string|null` / `linkedPracticeId: string|null` / `isPrivate`
- `ListRecentEntriesQuery`：`uid` / `statuses: DiaryEntryStatus[]` / `limit: number` / `cursor?: { t: string; i: string }`
- `SearchEntriesQuery`：`uid` / `keyword: string` / `limit: number` / `cursor?: { t: string; i: string }` / `tagFilters: DiaryTag[]`

### 1.4 与 TD-17 / life-map 先例的关键差异（任务单固化，不可照抄先例）

1. **Row 必须保留 `deletedAt` 列**。life-map 三个端口的 Row 均不含 `deletedAt`（查询口径已过滤软删，字段对业务层无用）；但本域 `DiaryEntryDto` 输出 `deletedAt`（`toDto` L413）、restore 后既有 spec 断言 `deletedAt === null`（src spec L301、e2e L401）、`getByIdIncludingDeleted` 需读软删行。**本域 Row 保留 `deletedAt`**，实现层 `toRow` 映射该列。
2. **实体工厂从 service 移到实现层**。现状 `repo.create({...})` 在 service（L109）；对齐 TD-17 D-6 与 consent 实现层口径（`this.repo.save(this.repo.create(input))`），工厂收进 `data/` 实现，service 侧零工厂依赖。
3. **既有 src spec 直连 Repository，需最小适配**（consent 先例无既有 src spec；life-map 无既有 spec）。适配口径见 §2.5：token 换端口 Symbol、行类型换 Row、QB 链式替身移除改端口内存方法；**断言逐字不改**。
4. **端口方法面比 consent 宽**（10 vs 4），含两个 QB 分页读 + 一个 QB 物理删；QB 的 where / orderBy / cursor / limit / tag AND 条件全部下沉 `data/` 实现，service 只保留游标编解码、LIKE 转义、状态 / tag 解析、分页切片与 hasMore 判定。

### 1.5 遗留观察（不进本单范围，交付记录登记）

`test/good-state-diary.e2e-spec.ts`（10 例）位于 `test/` 根目录：默认 vitest config 无 include 限制、`test/vitest.e2e.mts` 的 include 为 `**/e2e/**/*.{spec,test}.ts`，**两套入口都不收集该文件**（CI `pnpm test:e2e` 同样不收）——属既有组织现状，非本单引入。本单仍对该文件做最小适配（保持源码与端口化后的 service / module 一致，避免将来入口收回时变红），**但该文件不计入基线用例数与全量收集口径**；"根目录 e2e 遗留 spec 未被任何 config 收集"作为观察项登记另案（测试入口收纳评估），本单不清理、不移动文件位置。

### 1.6 基线闸门（HEAD `aef8b26`，TD-17 交付后）

全量 **3298 passed + 4 skipped（3302 例 / 197 文件）**；lint **0 error / 1 warning**（`test/e2e/v2-user-flow.spec.ts:1` 既有 unused eslint-disable，范围外不修）；lint:fast / lint:deep **0 / 0**；boundary **12 passed**；根 tsc / build tsc **0 error**；`git diff --stat HEAD -- src/engine-core` 为空。

本域定向实测（取证会话）：src spec `good-state-diary.service.spec.ts` **15 passed**（18.55 s，exit 0）；§1.5 的根目录 e2e 文件不被收集（既有现状）。

---

## 2. 范围（严格遵守，不越权）

### 在范围内

1. **端口文件**：`src/good_state_diary/domain/repositories/diary-entry.repository.ts`（interface + Symbol token + 入参 / Row 类型）。
2. **TypeORM 实现**：`src/good_state_diary/data/diary-entry.repository.typeorm.ts`；`@InjectRepository` / `Repository` / QueryBuilder 等 typeorm 值符号只允许出现在实现文件与 module 装配层。
3. **GoodStateDiaryService** 改依赖端口（直连 Repository 抽出）；移除对 `Repository.create` 的依赖（工厂下沉实现层，行纯对象由 service 构造后交端口落库）；私有方法 `applyMoodSnapshot` / `applyAiFeedback` / `toDto` 的 entity 类型签名替换为 `DiaryRow`。
4. **module 接线**：新增端口 provider；保留 `forFeature([GoodStateDiaryEntry])`；exports 保持现状（无跨域仓储消费，仓储 token 不 export）。
5. **service 内部类型替换**：entity 类型签名替换为端口 Row / 领域类型；service 不再值位置 import entity 类。controller 调用的公共方法签名（`create` / `update` / `softDelete` / `restore` / `getById` / `getByIdIncludingDeleted` / `getRecent` / `getDrafts` / `search` / `purgeExpiredSoftDeletes` / `purgeAll`）保持不变。
6. **端口替身 spec**：`test/good_state_diary/` 新增（工作项前缀 + 端口语义，对齐 TD-13 D-1 / TD-16 / TD-17 命名）；替身记调用参数 + 返回预设行；**spec 零 entity import**；不起真 TypeORM、不连 DB、不 `vi.mock('typeorm')`。
7. **既有两处测试最小适配**（§2.5）。
8. **文档与索引回写**（§7 清单）。

### 2.5 既有测试适配口径（断言 / mock 语义逐字不改）

- **src spec** `src/good_state_diary/providers/good-state-diary.service.spec.ts`（15 例）：
  - `getRepositoryToken(GoodStateDiaryEntry)` → `DIARY_ENTRY_REPOSITORY` Symbol；
  - `MockEntry extends GoodStateDiaryEntry` → `DiaryRow` 纯类型；移除 entity 值位置 import；
  - mock 方法对齐 §1.3 端口方法面（`create` / `save` / `findById` / `findDrafts` / `listRecent` / `searchEntries` / `softDelete` / `restore` / `deleteByAuthor` / `purgeExpiredSoftDeletes`）；QB 链式替身（`setupQueryBuilderMock`）整段移除，分页 / 检索改走端口内存替身方法；
  - 替身内部内存过滤口径与现状等价（authorId 隔离、status 过滤、软删过滤、createdAt/id DESC、take 上限），以保住既有 15 例断言；
  - **15 例断言逐字不改**（含 `restored.deletedAt` 为 null、跨用户 404、草稿 / finalized 计数、purgeAll 跨用户隔离等）。
- **遗留 e2e 文件** `test/good-state-diary.e2e-spec.ts`（10 例，§1.5）：`overrideProvider(getRepositoryToken(...))` → override 端口 Symbol；`StoredEntry extends GoodStateDiaryEntry` → `DiaryRow`；`InMemoryEntryRepository` 方法对齐端口方法面；QB 链式替身移除；entity import 移除；**10 例 HTTP 断言逐字不改**。该文件仍不被任何 vitest config 收集（既有现状），适配只为源码一致。
- **新增端口替身 spec** `test/good_state_diary/td18-good-state-diary-port-c2-batch2.spec.ts`：对齐 TD-17 口径，显式断言端口方法调用次数与参数（§3.2 方法面不泛化证据）；与适配后的 src spec 分工：新 spec 锁端口契约（调用面 / 参数 / 出参形状），src spec 锁业务行为（游标分页 / 状态解析 / 越权 404 / 软删生命周期）。

### 明确不在范围内（禁止顺手做）

- **entity 文件一字不改**：字段、装饰器、列、索引、关系、软删口径全部保留；DTO、controller、路由、业务语义不动；AI service / AI integration 零改动。
- 本域无 `index.ts` barrel；顶层 `src/index.ts` barrel 的 entity 类值导出边归另案 **M**，本单不删导出、不改对外面。
- 不做 Row 纯类型持久化分层映射的其他推广；不做 EntitySchema / 纯类改造；不补端口内存实现（另案 **I**）。
- 端口方法面只收 §1.3 现有调用形态；**不扩通用仓储代理**、不暴露 typeorm 管理句柄 / 查询选项 / 操作符；端口不写 SQL（QB 只下沉在 `data/` 实现）；端口 / service / spec 不暴露 entity 类名。
- 其他业务域零改动；`src/migration/` 零改动；不改 package.json / tsconfig / `vitest.config.mts` / `test/vitest.e2e.mts` / CI / Dockerfile；不新增第三方依赖；不碰 `admin-dashboard/` 与 Flutter。
- 既有 spec 断言 / mock 语义零改动；其他域 spec 不新增、不修改。
- 不移动 §1.5 遗留 e2e 文件位置；不调整 vitest include / exclude 让它进入收集口径。
- 不自动 git commit / push（写完给 commit 草稿，等用户指令）。

### 另案登记（本单不做，写入交付记录遗留段）

- **C2 / G**：其余域仓储端口化分批推广；每批验收口径 = 「service 源码层 typeorm 值符号 0 命中」+「该批 spec 值位置 entity import = 0」（TD-14 备忘 §5.3，不再以加载图减重为 KPI）。后续批次候选：emergency → home / inner_world / ai-engine → companion → profile / user / counselor。
- **I**：端口内存实现是否补（本单不补；spec 替身已覆盖替身需求）。
- **J**：混合形态 typeorm import 统一形态（可读性向、零运行时收益，另案批量处理）。
- **K**：`bin/ormconfig.ts` 的 `entities` glob 口径脱节（独立既有债，沿用 TD-14 登记）。
- **M**：entity 类值位置边 —— 本域 service 值位置 entity import 归零；顶层 barrel `export *` 残留的 entity 类导出边归 C2/G 推广时闭合。
- **N**："枚举 / 端口文件零 typeorm 依赖"静态守护 spec（本单不新增；守护证据走 grep 复核 + lint）。
- **P**：consent 失败容忍语义未落地（TD-17 另案，沿用登记，与本域无关）。
- **观察（新）**：`test/good-state-diary.e2e-spec.ts` 位于 test 根目录、两套 vitest config 均不收集；测试入口收纳（根目录 e2e 文件归位 `test/e2e/` 或调整 include）另案评估，本单不清理、不移动。

---

## 3. 目标交付物

### 3.1 代码改动

- 端口文件 + TypeORM 实现文件（`domain/repositories/` + `data/`）；`good_state_diary.module.ts` provider 接线；`GoodStateDiaryService` 依赖改端口；既有 src spec + 遗留 e2e 文件最小适配；新增端口替身 spec。
- 业务行为零漂移：authorId 越权隔离（所有读写显式带 author_id）；软删默认过滤 + `withDeleted` 口径；status 默认 `Finalized`（`parseStatusFilter`）；双游标分页（createdAt + id DESC，`limit + 1` 检测 hasMore）；LIKE 通配转义；tag AND 的 comma-padding LIKE；草稿 take 200 上限；purge 30 天 cutoff；purgeAll 按 authorId 物理擦除；`affected === 0` 与未命中均抛 `ResourceNotFound` 404；DTO 转换（含 `deletedAt` ISO、moodSnapshot / aiFeedback 归一）逐字不变。

### 3.2 静态复核证据（grep 复核，结果落交付记录）

1. **typeorm 符号外泄**：端口文件、service、新 spec、适配后 src spec、适配后 e2e 文件五个受检面，`Repository` / `Between` / `FindOptions` / `EntityManager` / `from 'typeorm'` / `from '@nestjs/typeorm'` 值符号 **0 命中**（注释文案也避开 typeorm 字面量，对齐 TD-13 D-5）；命中只允许在 `data/` 实现文件与 module 装配层。
2. **spec 零 entity import**：新 spec + 适配后两处测试对 `entities/` 路径的 entity 类 import = **0**。
3. **service 值位置 entity import = 0**：`good-state-diary.service.ts` 不再值位置 import entity 类（枚举 import 保留，枚举是纯文件、非 typeorm 值符号）。
4. **方法面不泛化**：端口方法与 §1.3 调用面一一对应；新 spec 用例显式断言调用次数与参数；无新增通用 `findAll` / `updateById` 之类代理方法。

### 3.3 交付记录（§6 固定路径）

含改动清单、端口方法面清单、typeorm 符号外泄复核表、service 行为与改前对照表（隔离口径 / 软删过滤 / 排序 / 游标 / 检索条件 / tag 过滤 / 草稿上限 / 擦除口径 / 404 判定 / DTO 转换）、偏差登记（conventions §2.5）、边界确认、遗留另案。

> **口径真相源**：调用面与出参形状以仓内实测为准；若与 §1.2 / §1.3 锚点不一致，以实测为准并在偏差表写清原锚点 / 实测值 / 理由。

---

## 4. 红线（违反即返工）

- **engine-core 零改动**：`git diff --stat HEAD -- src/engine-core` 为空；`boundary.spec.ts` 不改。
- **entity 文件零改动**：装饰器 / 列 / 索引 / 关系 / 软删口径保留；migration DDL 不动。
- **方法面纪律**：端口只收现有调用，不扩通用代理；不暴露 typeorm 句柄 / 查询选项 / 操作符；业务层不出现 entity 类名。
- **业务语义冻结**：service 公共签名不变；DTO / controller 路由不变；软删 / 恢复 / 擦除 / 游标分页 / 检索语义不变。
- 隐私：心理对话原文禁止进文档 / 日志 / console / crash report（只出码与计数）；本域日志只打 id / 计数 / 错误名。
- pnpm 命令规范：一律 `pnpm` / `pnpm exec`，禁止裸 `npx`。
- 不新增依赖；不越权加需求外功能；不自动 commit / push。

---

## 5. 闸门（填真实数字，禁止留空）

### 5.0 前置（命令规范，强制）

- 跑闸门前确认机器状态：记录是否有 `nest start --watch` / `vite dev` / `node dist/app` 常驻进程（墙钟可比性以用例数 / 文件数为准，不杀用户进程）；跑 `pnpm doctor:fs` 记录结果。
- 取证会话 PATH 先补 `D:\Apps\Git\cmd`（依赖外部命令的 spec 才不会假失败）。

### 5.1 收尾闸门（本单跑一次，记录真实命令 / exit / 数字）

| 闸门         | 命令                                                                                                                                                                       | 要求                                                                                                                                                                                |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 盘读前置     | `pnpm doctor:fs`                                                                                                                                                           | exit 0，记录均值 ms/文件与 slow 占比                                                                                                                                                |
| 根类型       | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`                                                                                                    | 0 error                                                                                                                                                                             |
| 构建类型     | `pnpm exec tsc -p tsconfig.build.json --noEmit`                                                                                                                            | 0 error                                                                                                                                                                             |
| Lint（权威） | `pnpm lint`                                                                                                                                                                | 0 error，记录 warning 数（基线既有 1 条 e2e warning，范围外不修）                                                                                                                   |
| oxlint fast  | `pnpm lint:fast`                                                                                                                                                           | 0 warning / 0 error                                                                                                                                                                 |
| 定向 spec    | `pnpm exec vitest run src/good_state_diary/providers/good-state-diary.service.spec.ts test/good_state_diary/`（适配后 src spec + 新端口替身 spec；位置参数按实际文件调整） | 全绿，记录用例数 / 文件数                                                                                                                                                           |
| 全量测试     | `pnpm test`                                                                                                                                                                | exit 0；既有 **3302 例 / 197 文件**集合不减少、既有断言不改；记录总用例数、文件数、墙钟与机器状态；增量 = 本单新增 spec 用例数（§1.5 遗留 e2e 文件不计入收集口径）                  |
| engine-core  | `git diff --stat HEAD -- src/engine-core`                                                                                                                                  | 空                                                                                                                                                                                  |
| 范围隔离     | `git diff --name-only HEAD`                                                                                                                                                | 改动仅限 `src/good_state_diary/`、`test/good_state_diary/`、适配后的 `test/good-state-diary.e2e-spec.ts` 与交付文档；无 package.json / tsconfig / vitest 配置 / CI / 其他业务域改动 |
| 边界         | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                                                                                                                   | 12 passed                                                                                                                                                                           |
| 静态复核     | §3.2 四项 grep 证据                                                                                                                                                        | 逐条结果落交付记录                                                                                                                                                                  |

> 验收侧不重跑全量；执行方交付记录里的闸门数字 + CI 结果作为合并底线。

---

## 6. 交付记录（完成后写，路径固定）

`docs/worklog/completed/phase2.5/td18-good-state-diary-port-c2-batch2-implementation-2026-11-14.md`

内容必须含：

1. 本单做了什么（一句话：good_state_diary 域按 TD-13 四件套落地仓储端口，C2 推广第二批）；
2. 改动文件清单（新建 / 修改，逐个一句用途；端口粒度与理由）；
3. 端口方法面清单（接口 / token / 入参 / Row 类型 / 唯一调用方）；
4. 闸门表：命令 / exit code / 真实数字（error、warning、用例总数、文件数、墙钟与机器状态）；
5. typeorm 符号外泄复核表（受检文件逐个命中数）；
6. service 行为与改前对照表（authorId 隔离 / 软删默认过滤与 withDeleted / status 默认 finalized / 双游标排序 / limit+1 hasMore / LIKE 转义 / tag AND comma-padding LIKE / 草稿 take 200 / purge cutoff 30 天 / purgeAll 按 authorId / 404 判定 / DTO 转换含 deletedAt）；
7. 边界确认：entity 文件零改动、DTO / controller / AI service / AI integration / barrel 导出面 / 其他业务域 / migration / 配置未动；既有两处测试断言与 mock 语义未改；
8. 遗留项：§2 另案 C2/G / I / J / K / M / N / P + 新增观察（根目录 e2e 遗留文件未被收集）逐条登记；Actions 侧待复核点（若有）；
9. 一行 commit message 草稿（**不自己 commit / push**，等用户指令）。

---

## 7. 【交付回写清单】做完逐项勾选（硬清单，不许跳）

- [ ] 交付记录已写到 §6 固定路径
- [ ] 本任务单从 `pending/` 移到 `completed/phase2.5/`，顶部状态行改 ✅ 并链交付记录
- [ ] 回写 WP 登记表：`docs/worklog/pending/phase2.5-wp-list-2026-11-08.md` §四 TD-18 行改完成态、补交付记录链接
- [ ] 回写阶段入口：`docs/worklog/pending/phase2.5-README.md` §3 TD-18 bullet 改完成态
- [ ] 回写台账：`docs/team/gate-performance-remediation-2026-11-11.md` §9 P-DEBT-11 行追加 C2 第二批落地结论 + 链接；更新记录补一条；另案 C2/G/I/J/K/M/N/P + 新增观察登记口径更新
- [ ] `git diff --stat HEAD -- src/engine-core` 为空；`src/migration/` 零改动
- [ ] 提交分组核对：本单文件与并行进程产物分开；若授权代提交，stage 只含本单文件
- [ ] 给一行 commit message 草稿（**不自己 commit / push**，等用户指令）

---

## 8. 回复输出约定

完成后在对话里：

1. 说一句"已写入交付记录"并附文件路径，不重复贴全文；
2. 报告闸门真实数字（tsc / eslint / vitest 用例数 / boundary）；
3. 报告本单结论一句话（good_state_diary 端口化完成、spec 零 entity import）+ §7 回写清单哪几项已做、有没有遗留；
4. 不把代码 diff 全文贴进对话，让用户自己 `git diff` / 打开交付记录。

---

_本单不新增第三方依赖；不改 schema / migration；仅 good_state_diary 域仓储端口化 + 既有两处测试最小适配 + 新增端口替身 spec；engine-core 零 diff；未自动 commit / push。_
