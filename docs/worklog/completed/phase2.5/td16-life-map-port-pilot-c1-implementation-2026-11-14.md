# TD-16 · C1 试点域仓储端口化（life-map 域）— 交付记录

- **状态**：✅ 已交付（2026-11-14）
- **基线 HEAD**：`0b5cf55`（TD-15 枚举外移 C+ 已闭环）
- **任务单**：`docs/worklog/pending/td16-life-map-port-pilot-c1-task-2026-11-14.md` → 归档至 `docs/worklog/completed/phase2.5/`
- **债务条目**：P-DEBT-11 / L-1（技术债台账 §9）
- **路线**：TD-14 备忘推荐路线 C（Row 纯类型 + 持久化分层映射）三段之第二段 —— C+（TD-15 已交付）→ **C1（本单：第二个业务域完整复制四件套）** → C2（按域推广）

---

## 一、改动清单

### 1.1 新增（9 个文件 / 1964 行）

**端口层 `src/life-map/domain/repositories/`（4 个）**

| 文件                                | 行数 | 内容                                                                                                                                                                                       |
| ----------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `life-stage-progress.repository.ts` | 88   | `LifeStageProgressRepository` interface + `LifeStageProgressRow` / `SaveStageProgressInput` + token `LIFE_STAGE_PROGRESS_REPOSITORY`                                                       |
| `key-event.repository.ts`           | 99   | `KeyEventRepository` interface + `KeyEventRow` / `CreateKeyEventInput` / `SaveKeyEventInput` + 重导出 `KeyEventType` + token `KEY_EVENT_REPOSITORY`                                        |
| `genome-dimension.repository.ts`    | 74   | `GenomeDimensionRepository` interface + `GenomeDimensionRow` / `SaveGenomeDimensionInput` + 重导出 `GenomeDimensionKey` + 新增 `GenomeDimensionTier` + token `GENOME_DIMENSION_REPOSITORY` |
| `drift-bottle.repository.ts`        | 120  | `DriftBottleRepository` interface + `DriftBottleRow` / `DriftBottleStats` / 3 个写入入参 + 重导出 `DriftBottleStatus` + token `DRIFT_BOTTLE_REPOSITORY`                                    |

**实现层 `src/life-map/data/`（4 个）**

| 文件                                        | 行数 | 内容                                                                 |
| ------------------------------------------- | ---- | -------------------------------------------------------------------- |
| `life-stage-progress.repository.typeorm.ts` | 104  | `LifeStageProgressRepositoryTypeorm`（唯一 typeorm 值符号落点之一）  |
| `key-event.repository.typeorm.ts`           | 161  | `KeyEventRepositoryTypeorm`                                          |
| `genome-dimension.repository.typeorm.ts`    | 114  | `GenomeDimensionRepositoryTypeorm`                                   |
| `drift-bottle.repository.typeorm.ts`        | 273  | `DriftBottleRepositoryTypeorm`（由改前手写仓储类迁入并提为端口实现） |

**测试（1 个）**

| 文件                                             | 行数 | 内容                                                                                                               |
| ------------------------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------ |
| `test/life-map/td16-life-map-port-pilot.spec.ts` | 909  | 端口替身 spec，**26 例**（A1-A16 LifeMapService + B1-B10 DriftBottleService），零 entity import、零 typeorm 值符号 |

### 1.2 修改（3 个文件）

| 文件                                             | 改动                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/life-map/providers/life-map.service.ts`     | 构造参数由 3 个 `@InjectRepository(Entity)` 改为 3 个 `@Inject(TOKEN)`；entity import 全撤；6 个私有/公开 helper 签名由 entity 换 Row；`saveStageProgress` / `saveGenomeDimension` 改调 `saveProgress` / `saveDimension`；`deleteKeyEvent` 改调 `softDeleteEvent(eventId, new Date())`；类注释补端口说明 |
| `src/life-map/providers/drift-bottle.service.ts` | 构造参数改为 `@Inject(DRIFT_BOTTLE_REPOSITORY)`；entity import 撤销；`update(id, patch)` 两处调用改 `markPicked` / `markResponded`；`toDto` 参数类型换 `DriftBottleRow`                                                                                                                                  |
| `src/life-map/life-map.module.ts`                | 新增 4 组 `{ provide: TOKEN, useClass: …Typeorm }` provider；`exports` 由 `[LifeMapService, DriftBottleService, DriftBottleRepository]` 改为 `[LifeMapService, DriftBottleService]`（仓储 token 不 export）                                                                                              |

### 1.3 删除（1 个文件）

- `src/life-map/providers/drift-bottle.repository.ts`（163 行）—— 迁移到 `data/drift-bottle.repository.typeorm.ts`，旧文件用独立顶层 `rm` 移入 mavis-trash（可恢复）。

### 1.4 零改动确认

- `src/life-map/entities/**`（4 个 entity）—— **一字未改**（字段 / 装饰器 / 列 / 索引 / 关系 / 软删口径全部保留）
- `src/life-map/dto/**`（5 个 DTO）、`src/life-map/controllers/**`、`src/life-map/enums/**`、`src/life-map/entities/index.ts` —— 零改动
- `src/migration/**` —— 零改动（`git diff --stat HEAD -- src/migration/` 为空）
- `src/engine-core/**` —— 零改动（`git diff --stat HEAD -- src/engine-core` 为空，boundary 12 绿）
- `package.json` / `tsconfig*.json` / `vitest` 配置 / CI —— 零改动
- 其他业务域 —— 零改动

---

## 二、端口方法面清单

### 2.1 端口划分粒度判定：**按实体分 4 个端口**（V3.0 三张表各一 + V6.0 漂流瓶独立）

任务单允许「V3.0 三实体合一」或「保留类形态」两种方案，本单判定为**按实体分 4 个端口**，理由：

1. **方法面最窄**（对齐 TD-13 D-2「方法按业务面命名，面窄才守得住」）。三张表的查询口径不同：阶段表的 upsert 命中判定**不带** `deletedAt` 过滤（改前口径），事件表 / 维度表的列表与计数**带** `deletedAt: IsNull()` 过滤。合一后同一 interface 里会并存两种例外口径，C2 推广时容易被照抄成通用代理。
2. **漂流瓶天然独立** —— V6.0 的独立业务域：自己的三态状态机（drift → picked → responded）、自己的实体、自己的 4 个 counter 口径，与 V3.0 三张表无共享查询口径。
3. **实体数 = 端口数** 的映射在本域是 1:1 的，不存在「一个端口覆盖多实体」的模糊地带。

### 2.2 四个端口的方法面（**只收 service 现有调用，不扩通用仓储代理**）

**`LifeStageProgressRepository`（2 个方法）**

| 方法                       | 入参                                                     | 出参                     | 取代改前的                                                   |
| -------------------------- | -------------------------------------------------------- | ------------------------ | ------------------------------------------------------------ |
| `listActiveByUser(userId)` | userId                                                   | `LifeStageProgressRow[]` | `stageRepo.find({ where: { userId, deletedAt: IsNull() } })` |
| `saveProgress(input)`      | `{ userId, stage, completionPct, stuckPoints?, gains? }` | `LifeStageProgressRow`   | findOne + create/save 三口子                                 |

**`KeyEventRepository`（6 个方法）**

| 方法                                  | 入参                  | 出参                       | 取代改前的                                                                          |
| ------------------------------------- | --------------------- | -------------------------- | ----------------------------------------------------------------------------------- |
| `listActiveByUser(userId)`            | userId                | `KeyEventRow[]`（age ASC） | `eventRepo.find({ where: { userId, deletedAt: IsNull() }, order: { age: 'ASC' } })` |
| `countActiveByUser(userId)`           | userId                | `number`                   | `eventRepo.count({ where: { userId, deletedAt: IsNull() } })`                       |
| `findActiveById(userId, eventId)`     | userId + eventId      | `KeyEventRow \| null`      | `eventRepo.findOne({ where: { id, userId, deletedAt: IsNull() } })`                 |
| `createEvent(input)`                  | 8 业务字段            | `KeyEventRow`              | `eventRepo.create(...) + save`                                                      |
| `saveEvent(input)`                    | id + 8 业务字段最终值 | `KeyEventRow`              | `Object.assign(entity, ...) + save`                                                 |
| `softDeleteEvent(eventId, deletedAt)` | eventId + 删除时刻    | `void`                     | `entity.deletedAt = new Date() + save(entity)`                                      |

**`GenomeDimensionRepository`（3 个方法）**

| 方法                        | 入参                                                  | 出参                   | 取代改前的                                                        |
| --------------------------- | ----------------------------------------------------- | ---------------------- | ----------------------------------------------------------------- |
| `listActiveByUser(userId)`  | userId                                                | `GenomeDimensionRow[]` | `dimensionRepo.find({ where: { userId, deletedAt: IsNull() } })`  |
| `countActiveByUser(userId)` | userId                                                | `number`               | `dimensionRepo.count({ where: { userId, deletedAt: IsNull() } })` |
| `saveDimension(input)`      | `{ userId, key, score, tier, source?, improvement? }` | `GenomeDimensionRow`   | findOne + create/save 三口子                                      |

**`DriftBottleRepository`（9 个方法）**

| 方法                                             | 入参                                                       | 出参                                 | 取代改前的                                          |
| ------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------ | --------------------------------------------------- |
| `create(input)`                                  | 3 业务字段                                                 | `DriftBottleRow`                     | 同名仓储方法（查询逐字一致）                        |
| `findById(id)`                                   | id                                                         | `DriftBottleRow \| null`             | 同名仓储方法                                        |
| `pickRandomExcluding(currentUserId, excludeIds)` | 2 参                                                       | `DriftBottleRow \| null`             | 同名仓储方法（QueryBuilder 口径逐字一致）           |
| `findSea(currentUserId)`                         | userId                                                     | `DriftBottleRow[]`                   | 同名仓储方法                                        |
| `findMine(currentUserId)`                        | userId                                                     | `DriftBottleRow[]`                   | 同名仓储方法                                        |
| `findInbox(currentUserId)`                       | userId                                                     | `DriftBottleRow[]`                   | 同名仓储方法                                        |
| `getStats(currentUserId)`                        | userId                                                     | `DriftBottleStats`（端口本地窄类型） | 同名仓储方法（原出参是 DTO 类）                     |
| `markPicked(id, input)`                          | id + `{ pickedByUserId, pickedByAnonymousName, pickedAt }` | `DriftBottleRow`                     | `update(id, patch: Partial<DriftBottleEntry>)` 之一 |
| `markResponded(id, input)`                       | id + `{ respondedText, respondedAt }`                      | `DriftBottleRow`                     | `update(id, patch: Partial<DriftBottleEntry>)` 之二 |

**端口合计 20 个方法**，全部有改前调用点对应，无一个泛化代理。

### 2.3 端口出参（Row）形状要点

- **不含 `deletedAt`**：列表口径已过滤软删，该字段对业务层无用，不进 Row。
- **nullable 字段一律归一为 `string | null`**（entity 里是 `string | null | undefined`），消除「undefined / null 两种空值」的二义；DTO 侧仍是 `?? undefined` 的既有口径。
- **写入入参侧可选字段用 `?`**（`stuckPoints?: string | null`），保留改前「缺省 = 保留原值」的口径，缺省语义下沉到实现内的 `input.x ?? existing.x ?? null`。
- **不暴露 entity 类**：出参全部是端口本地 interface（`LifeStageProgressRow` / `KeyEventRow` / `GenomeDimensionRow` / `DriftBottleRow`）。
- **枚举真相源不动**：`KeyEventType` / `GenomeDimensionKey` 的真相源在 entity 文件内（`KEY_EVENT_TYPES` / `GENOME_DIMENSION_KEYS` const array），因「entity 文件一字不改」不可外移，故端口用 `import type` + `export type` 重导出（**编译期擦除，零运行时依赖**）。

---

## 三、typeorm 符号外泄复核表（静态复核四项）

复核口径对齐 TD-13 D-5：正则 `\bRepository\b | \bBetween\b | \bFindOptions\b | \bEntityManager\b | from 'typeorm' | from '@nestjs/typeorm'`。

### 3.1 受检文件（端口 4 + service 2 + 新 spec 1 = **7 个**）

| 文件                                                                 | typeorm 值符号命中 |
| -------------------------------------------------------------------- | ------------------ |
| `src/life-map/domain/repositories/life-stage-progress.repository.ts` | 0                  |
| `src/life-map/domain/repositories/key-event.repository.ts`           | 0                  |
| `src/life-map/domain/repositories/genome-dimension.repository.ts`    | 0                  |
| `src/life-map/domain/repositories/drift-bottle.repository.ts`        | 0                  |
| `src/life-map/providers/life-map.service.ts`                         | 0                  |
| `src/life-map/providers/drift-bottle.service.ts`                     | 0                  |
| `test/life-map/td16-life-map-port-pilot.spec.ts`                     | 0                  |

**合计 0 命中**（注释里出现的「entity 类名」等说明性字样不构成值符号命中，口径与 TD-13 一致）。

### 3.2 允许落点（实现层 4 + 装配层 1 = **5 个**）

| 文件                                                          | typeorm 值符号命中 | 落点性质                                     |
| ------------------------------------------------------------- | ------------------ | -------------------------------------------- |
| `src/life-map/data/life-stage-progress.repository.typeorm.ts` | 7                  | TypeORM 实现                                 |
| `src/life-map/data/key-event.repository.typeorm.ts`           | 6                  | TypeORM 实现                                 |
| `src/life-map/data/genome-dimension.repository.typeorm.ts`    | 6                  | TypeORM 实现                                 |
| `src/life-map/data/drift-bottle.repository.typeorm.ts`        | 5                  | TypeORM 实现                                 |
| `src/life-map/life-map.module.ts`                             | （装配层）         | `TypeOrmModule.forFeature` + 4 组 token 接线 |

### 3.3 spec 零 entity import

- `test/life-map/` 下 `entities/|\.entity\.js` 命中 **1 处**，是文件头注释里的说明性字面量 `src/life-map/entities/**`（**非 import 语句**）。
- **实际 entity import 语句 = 0**。spec 里的 `DriftBottleStatus` 按 TD-13 同款口径从**纯枚举文件** `src/life-map/enums/drift-bottle-status.enum.js` 值位置 import（该文件零 typeorm 依赖，是 TD-15 的外移产物，不是 entity）。

### 3.4 service 值位置 entity import = 0

- `src/life-map/providers/` 下 `entities/|\.entity\.js` 命中 **0**。
- 两个 service 均不再 import 任何 entity 类。

### 3.5 方法面不泛化

- 端口目录内 `findAll | findOne | updateById | deleteById | save( | remove( | createQueryBuilder | getRepository | .where | QueryBuilder | FindOptions | EntityManager` 命中 **0**。
- 无泛型仓储代理、无 `Repository` / `EntityManager` / `FindOptions` / 查询选项 / 操作符外泄。

---

## 四、service 行为对照表（业务语义零漂移）

### 4.1 `LifeMapService`

| 公开方法               | 改前（HEAD）                                                                                                       | 改后（端口）                                                | 口径                                                                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getOverview`          | `loadAllStages` + `countActiveEvents` + `countActiveDimensions`                                                    | 同三步，仅换端口                                            | 逐字一致                                                                                                                                                                                       |
| `getTimeline`          | 同上                                                                                                               | 同上                                                        | 逐字一致（`completionPct ?? 0`、`filled: pct > 0`）                                                                                                                                            |
| `listStageProgress`    | 同上                                                                                                               | 同上                                                        | 逐字一致（4 阶段全返回 + 未填 `updatedAt = epoch`）                                                                                                                                            |
| `saveStageProgress`    | findOne(`{ userId, stage }`) → 命中改 3 字段 / 未命中 create → save                                                | 端口 `saveProgress` 内部**同一段逻辑**                      | **命中判定仍不带 `deletedAt` 过滤**（与改前逐字一致，本单不改）                                                                                                                                |
| `listKeyEvents`        | find(`{ userId, deletedAt: IsNull() }`, order age ASC)                                                             | `listActiveByUser`                                          | 逐字一致（含 age ASC 排序）                                                                                                                                                                    |
| `createKeyEvent`       | create(8 字段, `?? null` 归一) + save                                                                              | `createEvent`                                               | 逐字一致（缺省字段仍归一为 `null`）                                                                                                                                                            |
| `updateKeyEvent`       | requireActiveEvent → `Object.assign(entity, 7 字段)` → save                                                        | requireActiveEvent → `saveEvent(id + 9 字段最终值)`         | 逐字一致（缺省字段仍保留原值；`age` 始终取原行值）                                                                                                                                             |
| `deleteKeyEvent`       | requireActiveEvent → `entity.deletedAt = new Date()` → save(entity)                                                | requireActiveEvent → `softDeleteEvent(eventId, new Date())` | **删除时刻仍由 service 生成**；实现用 `repo.update({ id }, { deletedAt })`，DB 终态相同；查询数不变（1 SELECT + 1 UPDATE）；全仓无订阅器，`@UpdateDateColumn` 由 update query builder 自动刷新 |
| `listGenomeDimensions` | find(`{ userId, deletedAt: IsNull() }`)                                                                            | `listActiveByUser`                                          | 逐字一致                                                                                                                                                                                       |
| `saveGenomeDimension`  | findOne(`{ userId, key }`) → 命中改 score/tier/source/improvement / 未命中 create → save；`tier = calcTier(score)` | 端口 `saveDimension`，**tier 由 service 算好传进去**        | 逐字一致（命中判定同样不带 `deletedAt` 过滤；tier 仍是业务规则不落持久化层）                                                                                                                   |
| `listForecasts`        | loadAllStages + countActiveEvents                                                                                  | 同两步换端口                                                | 逐字一致（locked / locking / unlocked 三态与文案均未改）                                                                                                                                       |
| `runForecast`          | dimensionRepo.find + eventRepo.find                                                                                | `listActiveByUser` × 2                                      | 逐字一致（风险 / 机会 / 准备三维度的推导逻辑一行未改）                                                                                                                                         |
| `getGrowthReport`      | loadAllStages + dimensionRepo.find + countActiveEvents                                                             | 同三步换端口                                                | 逐字一致（未解锁占位、卡点、行动建议、推荐训练、summary 文案均未改）                                                                                                                           |
| 私有 helper 6 个       | 收 entity                                                                                                          | 收 Row                                                      | 字段逐字一一对应，仅类型位置换名                                                                                                                                                               |

### 4.2 `DriftBottleService`

| 公开方法                                             | 改前（HEAD）                                                                                                    | 改后（端口）                                                                                  | 口径                                                                                           |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `postBottle`                                         | 30 秒冷却 + 字符长度 + 匿名名 → `repository.create`                                                             | `repository.create`                                                                           | 逐字一致（冷却 / 长度文案 / 匿名名池未改）                                                     |
| `pickRandomBottle`                                   | `pickRandomExcluding` → `update(id, { status: PICKED, pickedByUserId, pickedByAnonymousName: '你', pickedAt })` | `pickRandomExcluding` → `markPicked(id, { pickedByUserId, pickedByAnonymousName, pickedAt })` | 落库字段集完全相同，**状态目标态下沉到实现**                                                   |
| `respondToBottle`                                    | `findById` → 3 道校验 → `update(id, { status: RESPONDED, respondedText, respondedAt })`                         | 同上 → `markResponded(id, { respondedText, respondedAt })`                                    | 落库字段集完全相同，校验文案未改                                                               |
| `listMyBottles` / `listRespondedBottles` / `listSea` | `findMine` / `findInbox` / `findSea`                                                                            | 同名端口方法                                                                                  | 查询逐字一致（排序方向未改）                                                                   |
| `getStats`                                           | 返回仓储的 `DriftBottleStatsDto`                                                                                | 返回端口本地 `DriftBottleStats`（结构同构）                                                   | 4 个 counter 的计数口径逐字一致；出参类型从 DTO 类改为端口本地窄类型（data 层不再 import DTO） |

---

## 五、闸门真实数字（同机实测，2026-11-14 15:07-15:21）

| 闸门                    | 命令                                                                    | 基线（TD-15 同机）                                                                    | 本单实测                                                                                                                                        | 结论                                                                          |
| ----------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 文件系统延迟            | `pnpm doctor:fs`                                                        | per-file 均值 0.15 ms                                                                 | per-file 均值 **0.18 ms**（walk 57ms / cold 41ms / warm 36ms / slow 0）                                                                         | 判定「合格（读取延迟正常，闸门数字可信）」，exit 0                            |
| 根类型检查              | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` | 0 error                                                                               | **0 error**，exit 0                                                                                                                             | ✅                                                                            |
| 构建类型检查            | `pnpm exec tsc -p tsconfig.build.json --noEmit`                         | 0 error                                                                               | **0 error**，exit 0                                                                                                                             | ✅                                                                            |
| ESLint                  | `pnpm lint`                                                             | 0 error / 1 warning                                                                   | **0 error / 1 warning**（唯一 warning：`test/e2e/v2-user-flow.spec.ts:1` unused eslint-disable —— **既有基线，范围外不修**），exit 0            | ✅                                                                            |
| oxlint                  | `pnpm lint:fast`                                                        | 0 / 0                                                                                 | **0 error / 0 warning**（输出为空），exit 0                                                                                                     | ✅                                                                            |
| 定向测试（本单新 spec） | `pnpm exec vitest run test/life-map/`                                   | —                                                                                     | **1 文件 / 26 例全过**，exit 0                                                                                                                  | ✅                                                                            |
| 全量测试                | `pnpm test`                                                             | 194 passed \| 1 skipped（195 文件）/ 3259 passed \| 4 skipped（**3263 例**）/ 112.31s | **195 passed \| 1 skipped（196 文件）/ 3285 passed \| 4 skipped（3289 例）/ 89.41s**，exit 0                                                    | ✅ 增量 = **+1 文件 / +26 例**，全部来自本单新 spec，**既有 3263 例一条不减** |
| engine-core 边界        | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                | 12 passed                                                                             | **12 passed**，1.59s，exit 0                                                                                                                    | ✅                                                                            |
| engine-core 零改动      | `git diff --stat HEAD -- src/engine-core`                               | 空                                                                                    | **空**                                                                                                                                          | ✅                                                                            |
| migration 零改动        | `git diff --stat HEAD -- src/migration/`                                | 空                                                                                    | **空**                                                                                                                                          | ✅                                                                            |
| 改动范围                | `git diff --name-only HEAD` + `git status --short`                      | —                                                                                     | 已跟踪改动 7 个（3 文档 + 3 源文件 + 1 删除）+ 新增 3 个目录（`src/life-map/data/`、`src/life-map/domain/`、`test/life-map/`）+ 新增任务单 1 个 | ✅ 仅 life-map 域 + test/life-map + 文档                                      |

**机器状态**：5 个 node 常驻进程（`pnpm start:dev` / `nest start --watch` / `pnpm dev` / admin-dashboard vite / `node dist/app`），与 TD-15 同机同状态。墙钟时长不可跨单比较，**闸门以用例数为准**。

---

## 六、偏差登记

| #   | 偏差                                                                                                                | 理由                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | **端口划分粒度**：任务单允许「V3.0 三实体合一」或「保留类形态」；本单判定为**按实体分 4 个端口**                    | 三张表查询口径不同（阶段表 upsert 命中判定不带 `deletedAt` 过滤 vs 事件 / 维度表列表带软删过滤），合一会让例外口径混进同一 interface 并在 C2 被照抄；漂流瓶是独立状态机 + 独立实体。详见 §2.1                                   |
| D-2 | **`update(id, patch: Partial<Entity>)` 拆为 `markPicked` / `markResponded`**                                        | 改前那个泛型 patch 接口把 entity 类型漏进业务层；端口化时收成两段具名状态迁移，状态机写死在端口上，面更窄。落库字段集与改前**完全相同**                                                                                         |
| D-3 | **`getStats` 出参类型由 `DriftBottleStatsDto`（DTO 类）改为端口本地 `DriftBottleStats`（窄 interface）**            | 端口出参不应依赖 DTO；结构同构（4 个 number），service 直接返回，data 层不再 import DTO。对外 HTTP 响应体不变                                                                                                                   |
| D-4 | **module `exports` 去掉 `DriftBottleRepository`**                                                                   | 端口化后仓储由 token 注入，不存在「注入仓储类」的跨模块用法；全仓复核**无任何跨域消费方**，去掉后不给外部开第二个入口（对齐 TD-13 D-4）                                                                                         |
| D-5 | **upsert 语义下沉到数据层**（端口给 `saveProgress` / `saveDimension` 一个方法，不给 find + insert + save 三个口子） | 「命中则更新、未命中则插入」是持久化语义（DB 侧有唯一索引兜底），下沉后服务层方法面更窄。实现内 findOne **刻意不带 `deletedAt` 过滤**，逐字保留改前口径                                                                         |
| D-6 | **软删收成 `softDeleteEvent(eventId, deletedAt)`**                                                                  | 删除时刻由 service 生成（端口不自己取「现在」），实现只落库。改前是 `entity.deletedAt = new Date() + save(entity)`，改后是 `repo.update({ id }, { deletedAt })` —— DB 终态相同、查询数相同（1 SELECT + 1 UPDATE）、全仓无订阅器 |
| D-7 | **端口类型别名用 `import type` 从 entity 文件取**（`KeyEventType` / `GenomeDimensionKey`）并 `export type` 重导出   | 真相源在 entity 文件内的 const array 里，因「entity 文件一字不改」不可外移；`import type` **编译期擦除**，端口零运行时依赖，不触发 TD-15 关注的「枚举 → entity → typeorm 装饰器求值」传递闭包                                   |
| D-8 | **本单不新增静态守护 spec**                                                                                         | 守住「用例数 3263 不减、增量只有本单新 spec」的口径；守护证据走 §三 四项 grep 复核 + lint 闸门。登记为另案 N                                                                                                                    |
| D-9 | **端口内存实现不补**                                                                                                | 任务单默认不补（另案 I）；spec 端口替身已覆盖                                                                                                                                                                                   |

**任务单与实测锚点的一致性**：§1.1 / §1.2 / §1.3 的锚点与实测**一致** —— `DriftBottleRepository` 仅域内消费（无跨模块）、全仓无订阅器（`EventSubscriber` / `AfterUpdate` / `AfterInsert` / `BeforeUpdate` 命中 0）、`stageToDto` / `eventToDto` / `dimToDto` / `requireActiveEvent` / `recommendTools` / `buildReportSummary` / `evaluateForecastUnlock` / `evaluateReportUnlock` / `calcTier` 全部只在 `life-map.service.ts` 内被调用（无外部调用方、无测试引用）。

---

## 七、边界确认

- **engine-core 纯层**：`git diff --stat HEAD -- src/engine-core` 为**空**；`boundary.spec.ts` 未改；12 条断言全绿。
- **零压红线**：本单不涉及自由练习（practice）评分口径，未触碰 MCQ 备考频道，两套 DTO 未混算。
- **隐私红线**：交付记录与 spec 内**无任何心理对话原文**，只出码与计数；端口出参为结构字段（标题 / 描述 / 感受 / 影响 / 解读）而非内容样本。
- **前端边界**：未碰 `admin-dashboard/` 与 Flutter。
- **命令边界**：一律 `pnpm` / `pnpm exec`，未用裸 `npx`；未新增依赖；未改 package.json / tsconfig / vitest / CI。
- **提交边界**：**未自动 commit / push**，只给 commit message 草稿（§九）。

---

## 八、遗留另案

| 编号   | 内容                     | 说明                                                                                                                                                                                                           |
| ------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C2** | 仓储端口按域推广         | 本单是 C1（试点域），C2 按域复制四件套。life-map 四件套已成可复制模板：端口（interface + Symbol token + Row）／实现（`data/*.typeorm.ts`）／装配（module token 接线）／测试（端口替身 spec，零 entity import） |
| **G**  | 静态守护 spec            | 建议把「端口 / service / spec 三处 typeorm 值符号 0 命中」「spec 零 entity import」做成常驻守护 spec（另案 N 同源）                                                                                            |
| **I**  | 端口内存实现             | 给端口补一套内存实现（便于单测与本地开发），本单不补                                                                                                                                                           |
| **J**  | Row 类型的域内收编       | 本单 Row 落在 `domain/repositories/`；后续若要形成域级「领域模型」目录，可把 Row 单独归位                                                                                                                      |
| **K**  | 装配层收口               | `life-map.module.ts` 仍直接 import 4 个 entity（`TypeOrmModule.forFeature` 的必要参数）；若要进一步隔离，可在 domain 层加一个「表清单」常量                                                                    |
| **M**  | 端口类型别名的真相源外移 | `KeyEventType` / `GenomeDimensionKey` 仍在 entity 文件内（因 entity 一字不改）；若后续允许改 entity，可把 const array 外移到 `enums/`（TD-15 同款做法）                                                        |
| **N**  | 静态守护 spec（新增）    | 同 G                                                                                                                                                                                                           |

---

## 九、commit message 草稿

```
feat(life-map): TD-16 C1 试点域仓储端口化 —— 4 端口 + TypeORM 实现 + 端口替身 spec
```

建议拆 2 个 commit：

1. `feat(life-map): TD-16 C1 试点域仓储端口化 —— 4 端口 + TypeORM 实现 + 端口替身 spec`
2. `docs(worklog): TD-16 交付记录 + 索引回写（P-DEBT-11 / L-1）`

---

_记录时间：2026-11-14 GMT+8 · 基线 HEAD `0b5cf55` · 未自动提交_
