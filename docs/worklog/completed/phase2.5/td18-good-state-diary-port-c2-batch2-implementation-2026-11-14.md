# TD-18 · C2 第二批仓储端口化（good_state_diary 域）— 交付记录

- **状态**：✅ 已交付（2026-11-14）
- **基线 HEAD**：`aef8b26`（TD-17 交付后，与 `origin/integrate` 一致）
- **任务单**：`docs/worklog/pending/td18-good-state-diary-port-c2-batch2-task-2026-11-14.md` → 归档至 `docs/worklog/completed/phase2.5/`
- **债务条目**：P-DEBT-11 / L-1（技术债台账 §9）
- **路线**：TD-14 备忘推荐路线 C 三段之第三段 **C2（按域推广）第二批** —— C+（TD-15）→ C1（TD-13 analytics + TD-16 life-map）→ C2 第一批（TD-17 consent）→ **C2 本单：good_state_diary 域（第四个业务域，把域级模板压到「宽方法面 + 软删生命周期」形态）**

---

## 一、本单做了什么（一句话）

good_state_diary 域按 TD-13 四件套落地仓储端口 —— **1 个端口**（interface + Symbol token + `DiaryRow` 出参 + 写入 / 查询入参类型，方法面 **10** 个）+ **1 个 TypeORM 实现**（收进 `src/good_state_diary/data/`，查询口径全部下沉，**实体工厂一并下沉**）+ **module 接线** + **端口替身 spec（20 例，零 entity import）**，并对既有两处测试做**最小适配**（src spec 15 例 + 遗留 e2e 10 例，**断言逐字未改**）。

---

## 二、改动文件清单

### 2.1 新增（3 个文件）

| 文件                                                                 | 用途                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/good_state_diary/domain/repositories/diary-entry.repository.ts` | `DiaryEntryRepository` interface + `DiaryRow` 出参（**保留 `deletedAt` 列**）+ `CreateDiaryEntryInput` / `ListRecentEntriesQuery` / `SearchEntriesQuery` 入参 + DI token `DIARY_ENTRY_REPOSITORY`；**零 typeorm 值符号**                                             |
| `src/good_state_diary/data/diary-entry.repository.typeorm.ts`        | `DiaryEntryRepositoryTypeorm` —— good_state_diary 域**唯一**允许出现 typeorm 值符号的业务文件（module 装配层除外）；双游标分页 / limit+1 取行 / LIKE 检索 / tag AND / 草稿 take 200 / 软删与 withDeleted / 到期软删物理擦除 七处口径全部下沉，**实体工厂在本实现内** |
| `test/good_state_diary/td18-good-state-diary-port-c2-batch2.spec.ts` | 端口替身 spec，**20 例**（A1-A20），零 entity import、零 typeorm 值符号、不起真 TypeORM / 不连 DB / 不 `vi.mock('typeorm')`                                                                                                                                          |

### 2.2 修改（4 个文件）

| 文件                                                              | 改动                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/good_state_diary/providers/good-state-diary.service.ts`      | 构造参数由 `@InjectRepository(GoodStateDiaryEntry) entryRepo: Repository<GoodStateDiaryEntry>` 改为 `@Inject(DIARY_ENTRY_REPOSITORY) entryRepo: DiaryEntryRepository`；typeorm 值导入与 entity 值位置 import 全撤；私有方法 `applyMoodSnapshot` / `applyAiFeedback` / `toDto` / `findOwnedOrThrow` 的 entity 类型签名换 `DiaryRow`；QB 三处改调端口方法；**公共方法签名逐字不变** |
| `src/good_state_diary/good_state_diary.module.ts`                 | 新增 `{ provide: DIARY_ENTRY_REPOSITORY, useClass: DiaryEntryRepositoryTypeorm }` provider；**保留** `TypeOrmModule.forFeature([GoodStateDiaryEntry])`；`exports: [GoodStateDiaryService]` **不变**（仓储 token 不 export）                                                                                                                                                       |
| `src/good_state_diary/providers/good-state-diary.service.spec.ts` | **既有 src spec 最小适配**：token 换 `DIARY_ENTRY_REPOSITORY`；`MockEntry extends GoodStateDiaryEntry` → `DiaryRow`；移除 entity 值位置 import；QB 链式替身（`setupQueryBuilderMock`）整段移除，改端口内存替身；**15 例断言逐字未改**                                                                                                                                             |
| `test/good-state-diary.e2e-spec.ts`                               | **遗留 e2e 最小适配**：`overrideProvider` 换端口 Symbol；`StoredEntry extends GoodStateDiaryEntry` → `DiaryRow`；内存替身方法对齐端口方法面；QB 替身移除；entity import 移除；**10 例 HTTP 断言逐字未改**（文件本身不被任何 vitest config 收集，见 §八 新观察）                                                                                                                   |

### 2.3 删除

无。

### 2.4 零改动确认

- `src/good_state_diary/entities/good-state-diary-entry.entity.ts` —— **一字未改**（17 字段 / `@DeleteDateColumn` 软删口径 / 2 个索引全保留）
- `src/good_state_diary/dto/good-state-diary.dto.ts`、两个 controller、`good-state-diary-ai.service.ts`、`good-state-diary-ai.integration.ts`、`enums/` 4 个纯枚举文件 —— 零改动
- `src/migration/**`（含 `1714900000003-AddGoodStateDiary.ts`）—— 零改动
- `src/engine-core/**` —— 零改动（boundary 12 绿，`git diff --stat HEAD -- src/engine-core` 为空）
- 其他业务域 / `package.json` / `tsconfig*.json` / `vitest.config.mts` / `test/vitest.e2e.mts` / CI / Dockerfile / `admin-dashboard/` / Flutter —— 零改动
- 未新增第三方依赖

---

## 三、端口方法面清单

### 3.1 端口划分粒度判定：**单端口**（1 张表 / 1 个直连仓储的 service / 13 处调用同表）

good_state_diary 域只有 1 张表（`good_state_diary_entries`）、1 个直连仓储的 service（`GoodStateDiaryService`），13 处仓储调用全部落在同一张表上；方法面虽宽（10 个），但拆成多端口只会把同一张表的查询口径切碎、面反而更宽（对齐 TD-13 D-2「面窄才守得住」）。与 TD-16 life-map 的 4 端口判定不冲突 —— 那里是 4 张表、4 套互不相同的口径；与 TD-17 consent 同为单端口。

### 3.2 13 处既有调用 → 10 个端口方法（任务单 §1.3 锚点，逐条对齐）

| 改前调用（HEAD `aef8b26`）                                                                       | 改后端口方法                                              | 口径                                                                                     |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| ① `repo.create({ ... })`（L109，新建行工厂）                                                     | —— （**工厂下沉实现层**，service 只构造纯对象入参）       | 字段集逐字不变；落库在实现层 `repo.save(this.repo.create(input))`                        |
| ② `repo.save(entity)`（L122，create 保存）                                                       | `create(input: CreateDiaryEntryInput): Promise<DiaryRow>` | 一次调用完成「造行 + 落库」，返回落库后的行                                              |
| ③ `repo.save(entity)`（L148，update 保存）                                                       | `save(row: DiaryRow): Promise<DiaryRow>`                  | 整行回存（含 id / createdAt / updatedAt / deletedAt）                                    |
| ④ `repo.softDelete({ id, authorId })`（L155）                                                    | `softDelete(uid, entryId): Promise<{ affected }>`         | criteria 口径逐字不变（id + author_id）                                                  |
| ⑤ `repo.restore({ id, authorId })`（L163）                                                       | `restore(uid, entryId): Promise<{ affected }>`            | criteria 口径逐字不变                                                                    |
| ⑥ `repo.findOne({ where: { id, authorId } })`（L177）                                            | `findById(uid, entryId, opts?)`                           | 默认排除软删（`withDeleted: opts?.includeDeleted === true` → false）                     |
| ⑦ `repo.findOne({ where, withDeleted: true })`（L183）                                           | `findById(uid, entryId, { includeDeleted: true })`        | 含软删口径                                                                               |
| ⑧ QB `createQueryBuilder('e')`（L195-214，getRecent）                                            | `listRecent(query: ListRecentEntriesQuery)`               | author_id + status IN + created_at DESC + id DESC + limit+1 + 游标条件全部下沉           |
| ⑨ `repo.find({ where: { authorId, status: Draft }, order, take: 200 })`（L227）                  | `findDrafts(uid): Promise<DiaryRow[]>`                    | status=Draft + createdAt/id DESC + take 200（常量随之下沉）                              |
| ⑩ QB `createQueryBuilder('e')`（L240-266，search）                                               | `searchEntries(query: SearchEntriesQuery)`                | author_id + (title LIKE OR body LIKE) + 游标 + tag AND，全部下沉                         |
| ⑪ QB `createQueryBuilder().delete()`（L285-290，purgeExpiredSoftDeletes）                        | `purgeExpiredSoftDeletes(cutoff: Date)`                   | `deleted_at IS NOT NULL AND deleted_at < :cutoff` 逐字不变；30 天 cutoff 仍由 service 算 |
| ⑫ `repo.delete({ authorId })`（L299，purgeAll）                                                  | `deleteByAuthor(uid): Promise<{ affected }>`              | 硬删（软删列不影响 delete 语义）                                                         |
| ⑬ `repo.findOne({ where, withDeleted: opts.includeDeleted === true })`（L316，findOwnedOrThrow） | `findById(uid, entryId, { includeDeleted: ... })`         | 与 ⑥⑦ 合并为**同一个**端口方法                                                           |

> 13 处调用 → 10 个方法：① 与 ② 合并为 `create`（工厂下沉后不再有「中间态行」），⑥⑦⑬ 合并为 `findById`，其余一一对应。**未新增任何通用代理方法**（无 `findAll` / `updateById` 之类）。

### 3.3 类型清单

| 类型                     | 角色           | 说明                                                                              |
| ------------------------ | -------------- | --------------------------------------------------------------------------------- |
| `DiaryEntryRepository`   | 端口 interface | 10 个方法，唯一调用方 `GoodStateDiaryService`                                     |
| `DIARY_ENTRY_REPOSITORY` | DI token       | `Symbol('DIARY_ENTRY_REPOSITORY')`；module provider 绑定，**不 export**           |
| `DiaryRow`               | 出参           | 17 字段窄领域类型；**保留 `deletedAt: Date                                        | null`**（与 life-map 先例不同，见 §六 D-1 说明） |
| `CreateDiaryEntryInput`  | 写入入参       | 11 字段（service 侧纯对象构造，时间戳与软删列由落库层生成）                       |
| `ListRecentEntriesQuery` | 查询入参       | `uid` / `statuses`（已解析）/ `limit`（页面条数）/ `cursor?: { t, i }`（已解码）  |
| `SearchEntriesQuery`     | 查询入参       | `uid` / `likePattern`（**已转义**）/ `limit` / `cursor?` / `tagFilters`（已解析） |

---

## 四、闸门表（真实数字，exit code 实测）

**机器状态（闸门前后各查一次，5 个 node 常驻进程，未杀用户进程）**：PID 12992 `pnpm start:dev` · PID 14612 `nest start --watch` · PID 20740 `pnpm dev`（admin-dashboard）· PID 7860 `vite`（admin-dashboard）· PID 17496 `node --enable-source-maps dist/app`。全程有 watch / vite / dist 常驻进程占用 CPU，墙钟可比性以**用例数 / 文件数**为准。

| 闸门         | 命令                                                                                                          | exit | 实测数字                                                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 盘读前置     | `pnpm doctor:fs`                                                                                              | 0    | walk 41 ms · cold 32 ms slow 0 · warm 30 ms slow 0 · **per-file 均值 0.15 ms/文件** · 判定「合格（读取延迟正常，闸门数字可信）」                                                    |
| 根类型       | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`                                       | 0    | **0 error**                                                                                                                                                                         |
| 构建类型     | `pnpm exec tsc -p tsconfig.build.json --noEmit`                                                               | 0    | **0 error**                                                                                                                                                                         |
| Lint（权威） | `pnpm lint`                                                                                                   | 0    | **0 error / 1 warning**（`test/e2e/v2-user-flow.spec.ts:1` 既有 unused eslint-disable，基线既有、范围外未修）                                                                       |
| oxlint fast  | `pnpm lint:fast`                                                                                              | 0    | **0 warning / 0 error**                                                                                                                                                             |
| 定向 spec    | `pnpm exec vitest run src/good_state_diary/providers/good-state-diary.service.spec.ts test/good_state_diary/` | 0    | **2 文件 / 35 例全绿**（既有 src spec 15 + 新端口替身 spec 20），Duration 1.43 s                                                                                                    |
| 全量测试     | `pnpm test`                                                                                                   | 0    | **197 passed + 1 skipped（198 文件）· 3318 passed + 4 skipped（3322 例）**，Start 18:13:45，**Duration 69.57 s**                                                                    |
| engine-core  | `git diff --stat HEAD -- src/engine-core`                                                                     | 0    | **空**（零 diff）                                                                                                                                                                   |
| migration    | `git diff --stat HEAD -- src/migration/`                                                                      | 0    | **空**（零 diff）                                                                                                                                                                   |
| 范围隔离     | `git diff --name-only HEAD` + `git ls-files --others --exclude-standard`                                      | 0    | 本单改动 = 3 新增（端口 / 实现 / 新 spec）+ 3 修改（service / module / src spec）+ 1 修改（遗留 e2e）；另有主控立项改动（2 文档 M + 任务单 ?? + 2 个归档 relay ??），**不纳入本单** |
| 边界         | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                                                      | 0    | **12 passed**                                                                                                                                                                       |

**全量口径对比**：基线 **3298 passed + 4 skipped（3302 例 / 197 文件）** → 本单 **3318 passed + 4 skipped（3322 例 / 198 文件）**，净增 **+20 例 / +1 文件**，**增量 = 本单新增 spec 的 20 例**，既有 3302 例**一条不减**。

---

## 五、typeorm 符号外泄复核表（§3.2 静态复核四项）

**受检面 5 个文件**（端口 / service / 新 spec / 适配后 src spec / 适配后遗留 e2e），grep 模式：`Repository<` · `Between` · `FindOptions` · `EntityManager` · `from 'typeorm'` · `from '@nestjs/typeorm'` · `@InjectRepository` · `getRepositoryToken` · `createQueryBuilder` · `SelectQueryBuilder`。

| 受检文件                                                             | 命中数 |
| -------------------------------------------------------------------- | ------ |
| `src/good_state_diary/domain/repositories/diary-entry.repository.ts` | **0**  |
| `src/good_state_diary/providers/good-state-diary.service.ts`         | **0**  |
| `test/good_state_diary/td18-good-state-diary-port-c2-batch2.spec.ts` | **0**  |
| `src/good_state_diary/providers/good-state-diary.service.spec.ts`    | **0**  |
| `test/good-state-diary.e2e-spec.ts`                                  | **0**  |

> **宽模式 `Repository` 的命中归因**（避免误读）：命中的 12 处**全部**是自研命名 —— 端口 interface 名 `DiaryEntryRepository`（6 处）、替身类名 `InMemoryEntryRepository`（3 处）、DI token 字符串 `'GoodStateDiaryEntryRepository'`（1 处）、既有注释文案（已改中文「仓储方法」）。**typeorm 的 `Repository` 类符号（`Repository<...>` 泛型标注 / `import { Repository } from 'typeorm'` / `@InjectRepository` / `getRepositoryToken`）0 命中**。typeorm 值符号只落 2 处：`src/good_state_diary/data/diary-entry.repository.typeorm.ts`（实现层）+ `good_state_diary.module.ts`（装配层 `forFeature`）。

**四项静态复核结论**：

1. **typeorm 符号外泄** = 上表 5 个受检面**全部 0 命中** ✅
2. **spec 零 entity import** = 新 spec **0**；适配后 src spec **0**；适配后遗留 e2e **0**（e2e 内 `'GoodStateDiaryEntryRepository'` 是 **DI token 字符串**，非 entity 类 import）✅
3. **service 值位置 entity import** = **0**（`good-state-diary.service.ts` 内 `GoodStateDiaryEntry` / `entities/` 路径 **0 命中**）✅
4. **方法面不泛化** = 端口恰 **10** 个方法，与 §1.3 调用面一一对应；新 spec **A19** 显式断言 `Object.keys(double.repo).sort()` 恰为那 10 个名字（无 `findAll` / `updateById` 之类）✅

---

## 六、service 行为与改前对照表（业务语义零漂移）

| 行为点                      | 改前（HEAD `aef8b26`）                                                                            | 改后                                                                                                | 判定               |
| --------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------ |
| authorId 越权隔离           | 每条读 / 写路径显式带 `author_id`（`findOne` / `softDelete` / `restore` / `delete` / QB `where`） | 端口方法以 uid 为第一参，实现层落到同一 `author_id` 条件                                            | 逐字一致           |
| 软删默认过滤                | `findOne` 默认排除软删（`@DeleteDateColumn`）                                                     | `findById` 默认 `withDeleted: opts?.includeDeleted === true` → false                                | 逐字一致           |
| 含软删口径                  | `findOne({ ..., withDeleted: true })`                                                             | `findById(uid, id, { includeDeleted: true })`                                                       | 逐字一致           |
| status 默认 finalized       | `parseStatusFilter` 空 → `[Finalized]`                                                            | 解析留 service，端口收 `statuses` 数组                                                              | 逐字一致           |
| 双游标排序                  | `orderBy('e.created_at','DESC').addOrderBy('e.id','DESC')`                                        | 实现层同一对 `orderBy`                                                                              | 逐字一致           |
| limit + 1 检测 hasMore      | QB `.limit(limit + 1)`；service `rows.length > limit` 切片                                        | 实现层 `.limit(query.limit + 1)`（端口 `limit` = 页面条数）；hasMore / 切片 / nextCursor 留 service | 逐字一致           |
| 游标条件                    | `(e.created_at < :cursorT OR (e.created_at = :cursorT AND e.id < :cursorI))`                      | 实现层同一条件；service 只传解码后的 `{ t, i }`                                                     | 逐字一致           |
| LIKE 通配转义               | `escapeLikePattern` → `%...%`                                                                     | 转义留 service，端口收已转义的 `likePattern`                                                        | 逐字一致           |
| tag AND comma-padding LIKE  | `CONCAT(',', IFNULL(e.tags,''), ',') LIKE CONCAT('%,', :tagFilterN, ',%')`                        | 实现层同一条件；service 只解析出 `tagFilters`                                                       | 逐字一致           |
| 草稿 take 200               | `find({ where: { authorId, status: Draft }, order: { createdAt DESC, id DESC }, take: 200 })`     | 实现层同一条件（`DRAFTS_LIMIT = 200` 常量随口径下沉）                                               | 逐字一致           |
| purge 30 天 cutoff          | service 算 30 天 → QB `deleted_at IS NOT NULL AND deleted_at < :cutoff`                           | 30 天仍由 service 算 → 端口收 `cutoff` → 实现层同一条件                                             | 逐字一致           |
| purgeAll 按 authorId        | `repo.delete({ authorId })`（硬删）                                                               | `deleteByAuthor(uid)` → `repo.delete({ authorId: uid })`                                            | 逐字一致           |
| 404 判定                    | `affected === 0` 或未命中 → `BizException(BizCode.ResourceNotFound)`                              | 同一判定，仍在 service 侧                                                                           | 逐字一致           |
| DTO 转换                    | `toDto(entity)`：`deletedAt` ISO / moodSnapshot 归一 / aiFeedback 归一 / tags 解码                | `toDto(row)` 字段集与转换逻辑逐字相同                                                               | 逐字一致           |
| 实体工厂位置                | service 调 `repo.create({...})`                                                                   | **下沉实现层** `repo.save(this.repo.create(input))`；service 侧零工厂依赖                           | 位置变更，语义不变 |
| 落库字段集                  | `repo.save(entity)`（entity 实例）                                                                | `repo.save(repo.create(row))`（整行纯对象，createdAt / updatedAt / deletedAt 全带）                 | 一致               |
| `findOwnedOrThrow` 返回类型 | `Promise<GoodStateDiaryEntry>`                                                                    | `Promise<DiaryRow>`（唯一调用方 AI service 只 `await` 不消费字段，**AI service 文件零改动**）       | 类型替换，行为不变 |

---

## 七、边界确认

- **engine-core 零改动**：`git diff --stat HEAD -- src/engine-core` 为空；`boundary.spec.ts` 零改动，**12 绿**。
- **entity 文件零改动**：`good-state-diary-entry.entity.ts` 字段 / 装饰器 / 列 / 索引 / `@DeleteDateColumn` 软删口径全保留；migration DDL 不动。
- **DTO / controller / AI service / AI integration / enums / barrel 导出面**：零改动；两个 controller 的 9 个 REST 端点 + 1 个 AI 端点路由与限流不变。
- **其他业务域**：零改动；`src/migration/` 零改动；配置 / CI / Dockerfile / 前端零改动；未新增第三方依赖。
- **既有两处测试**：src spec **15 例断言逐字未改**（含 `restored.deletedAt` 为 null、跨用户 404、草稿 / finalized 计数、purgeAll 跨用户隔离）；遗留 e2e **10 例 HTTP 断言逐字未改**；mock 语义等价替换（QB 链式替身 → 端口内存替身）。
- **零压红线**：本单不涉及自由练习（practice）评分口径。
- **隐私红线**：交付记录与 spec 内**无任何用户日记原文 / 情绪快照原文 / 标签原文**，全部用占位字面量（`body: 'x'` / `'今天状态一般'` 等合成串，非真实用户内容）；本域无新增日志。
- **命令边界**：一律 `pnpm` / `pnpm exec`，未用裸 `npx`；未新增依赖；未改 `package.json` / `tsconfig` / vitest 配置 / CI。
- **提交边界**：**未自动 commit / push**，只给 commit message 草稿（§十）。

---

## 八、偏差登记（conventions §2.5）

| 编号 | 原锚点（任务单 / 仓内）                                                 | 实测 / 处置                                                                                                                                                                                                                                     | 理由                                                                                                                                                                                                                                                                                                       |
| ---- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1  | 任务单 §1.3：`SearchEntriesQuery` 含 `keyword`                          | 实端口字段取名 **`likePattern`**（值为 service 已转义的 `%...%` 模式）                                                                                                                                                                          | LIKE 转义必须留 service（任务单 §1.3 明文）。若端口收原始 `keyword`，转义要么落到实现层（口径搬家），要么不做（`%` / `_` 通配符注入语义漂移）—— 字段名必须反映「已转义」语义                                                                                                                               |
| D-2  | 任务单 §1.3：① `repo.create` + ② `repo.save` 两处调用                   | service 侧由两处调用合并为**一处 `create(input)`**（工厂下沉后不再有可交给 `save` 的中间态行）                                                                                                                                                  | 与任务单给出的签名 `create(input): Promise<DiaryRow>` 一致；不产生「造好但未落库」的中间态                                                                                                                                                                                                                 |
| D-3  | 任务单 §1.3：`save(row: DiaryRow)`                                      | **按原锚点实现**（未改成独立的 `SaveDiaryEntryInput`）                                                                                                                                                                                          | 整行回存保证 `updatedAt` 由落库层维护、`createdAt` 不被覆盖、`deletedAt` 保持 null；与任务单建议签名一致，无需偏差                                                                                                                                                                                         |
| D-4  | 仓内：service 有 `private static readonly DRAFTS_LIMIT = 200`           | 常量**随口径下沉到实现层**，service 侧该私有静态成员移除                                                                                                                                                                                        | 任务单 §1.3：`findDrafts —— status=Draft、createdAt/id DESC、take 200 口径下沉实现`；take 上限属查询口径，不属业务层                                                                                                                                                                                       |
| D-5  | 遗留 e2e：`overrideProvider(getRepositoryToken(GoodStateDiaryEntry))`   | 改为覆盖**端口 Symbol** + 追加一条 **字符串 token** 覆盖 `'GoodStateDiaryEntryRepository'`                                                                                                                                                      | `forFeature` 注册的实体仓储 provider 在模块编译期会被实例化、其工厂需要 DataSource token；本单要求零 typeorm 值符号 + 零 entity import，故按 token 字符串覆盖（端口已被覆盖，该 provider 的产物不会被使用）。token 口径实测：`getRepositoryToken(GoodStateDiaryEntry) === 'GoodStateDiaryEntryRepository'` |
| D-6  | 遗留 e2e + src spec：`getRepositoryToken` / entity import / QB 链式替身 | src spec：token 换 `DIARY_ENTRY_REPOSITORY`、`MockEntry extends entity` → `DiaryRow`、QB 替身整段移除改端口内存替身、移除随之未使用的 `store` 局部变量（否则 TS6133）；e2e：`StoredEntry extends entity` → `DiaryRow`、替身改实现端口 interface | 最小适配口径：只换替身形状，**断言逐字不动**                                                                                                                                                                                                                                                               |
| D-7  | 任务单 §1.5：遗留 e2e「两套 config 均不收集」                           | **实测确认**：`pnpm exec vitest run test/good-state-diary.e2e-spec.ts --exclude '**/e2e/**/*.ts'` → exit 1，输出 `No test files found`（include `**/*.{test,spec}.?(c                                                                           | m)[jt]s?(x)`下不匹配）→ 该文件**不计入**基线与全量收集口径；但根 tsc 的`include`含`test/**/\*` → 该文件**仍被类型检查**，本单适配保证其 tsc **0 错**                                                                                                                                                       | 以实测为准（任务单锚点属实），并补齐「tsc 仍检查」这一未被任务单点明的连带影响 |

---

## 九、遗留项

### 9.1 另案（沿用 + 本单新增）

- **C2 / G**：其余域仓储端口化分批推广；每批验收口径 = 「service 源码层 typeorm 值符号 0 命中」+「该批 spec 值位置 entity import = 0」（TD-14 备忘 §5.3，**不再以加载图减重为 KPI**）。后续批次候选：**emergency → home / inner_world / ai-engine → companion → profile / user / counselor**。**C2 第二批（本单）已完成**。
- **I**：端口内存实现是否补（本单不补；spec 替身已覆盖替身需求）。
- **J**：混合形态 typeorm import 统一形态（可读性向、零运行时收益，另案批量处理）。
- **K**：`bin/ormconfig.ts` 的 `entities` glob 口径脱节（独立既有债，沿用 TD-14 登记）。
- **M**：entity 类值位置边 —— 本域 service 值位置 entity import 已归零；顶层 barrel `export *` 残留的 entity 类导出边归 C2/G 推广时闭合。
- **N**：「枚举 / 端口文件零 typeorm 依赖」静态守护 spec（本单不新增；守护证据走 grep 复核 + lint）。
- **P**：consent 失败容忍语义未落地（TD-17 另案，沿用登记，与本域无关）。

### 9.2 本单新观察（登记另案，不在本单处理）

- **观察（新）**：`test/good-state-diary.e2e-spec.ts` 位于 `test/` 根目录，**两套 vitest 入口（默认 config / `test/vitest.e2e.mts`）均不收集**（实测 `No test files found`）—— 该文件 10 例 e2e **长期不在任何门禁口径内**；而根 tsc 仍会检查它。测试入口收纳（根目录 e2e 文件归位 `test/e2e/` 或调整 include）另案评估，本单**不清理、不移动、不改 vitest include / exclude**。

### 9.3 Actions 侧待复核点

- CI 结果待主控 push 后在 Actions 复核（本机闸门已全绿）。
- 本单**未自动 commit / push**；commit 分组见 §十。

### 9.4 提交分组核对

本单文件与并行进程产物**分离**：5 个 node 常驻进程（`nest start --watch` / `vite` / `node dist/app`）不产生 git 改动；`admin-dashboard/` 未触碰；工作区里主控归档的 `docs/worklog/pending/archive/relay-response-20261114-1524.md` 与 `-1719.md` 及 TD-18 任务单立项改动**不纳入本单 stage**。

---

## 十、commit message 草稿（不自己 commit / push）

```
feat(good_state_diary): TD-18 C2 第二批仓储端口化 —— 1 端口 + TypeORM 实现 + 端口替身 spec
```

建议拆 2 个 commit：

1. `feat(good_state_diary): TD-18 C2 第二批仓储端口化 —— 1 端口 + TypeORM 实现 + 端口替身 spec`
2. `docs(worklog): TD-18 交付记录 + 索引回写（P-DEBT-11 / L-1 · C2 第二批）`

---

_记录时间：2026-11-14 GMT+8 · 基线 HEAD `aef8b26` · 未自动提交_
