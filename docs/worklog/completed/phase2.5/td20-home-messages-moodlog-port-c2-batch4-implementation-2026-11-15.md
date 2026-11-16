# TD-20 · C2 第四批仓储端口化（home 域 · 干净切片：home_messages + mood_logs）— 交付记录

- **状态**：✅ 已交付（2026-11-15）
- **基线 HEAD**：`6d3b457`（TD-19 交付后，与 `origin/integrate` 一致）
- **任务单**：`docs/worklog/pending/td20-home-messages-moodlog-port-c2-batch4-task-2026-11-15.md` → 归档至 `docs/worklog/completed/phase2.5/`
- **债务条目**：P-DEBT-11 / L-1（技术债台账 §9）
- **路线**：TD-14 备忘推荐路线 C 三段之第三段 **C2（按域推广）第四批** —— C+（TD-15）→ C1（TD-13 analytics + TD-16 life-map）→ C2 第一批（TD-17 consent）→ 第二批（TD-18 good_state_diary）→ 第三批（TD-19 emergency）→ **C2 本单：home 域干净切片（两张扁平子表 + 双端口）**

---

## 一、本单做了什么（一句话）

home 域的 **home_messages + mood_logs** 两张扁平子表按 TD-13 四件套落地**双端口** —— **2 个端口**（各含 interface + Symbol token；打卡端口带 `MoodLogRow` / `NewMoodLogInput`，消息端口**无 Row 出参**）+ **2 个 TypeORM 实现**（收进 `src/home/data/`，查询口径与实体工厂全部下沉）+ **module 两组 token 接线** + **端口替身 spec（22 例，零 entity import）**，且**零既有测试适配面**（本域及他域 spec 均零改动）。

---

## 二、改动文件清单

### 2.1 新增（5 个文件）

| 文件                                                          | 用途                                                                                                                                                                    |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/home/domain/repositories/home-message.repository.ts`     | `HomeMessageRepository` interface（方法面 2 个）+ DI token `HOME_MESSAGE_REPOSITORY`；**无 Row 出参**（本 service 无 entity 回读路径）；**零 typeorm 值符号**           |
| `src/home/domain/repositories/mood-log.repository.ts`         | `MoodLogRepository` interface（方法面 4 个）+ DI token `MOOD_LOG_REPOSITORY` + `MoodLogRow`（6 字段，真删无软删列）+ `NewMoodLogInput`（4 字段）；**零 typeorm 值符号** |
| `src/home/data/home-message.repository.typeorm.ts`            | `HomeMessageRepositoryTypeorm` —— 消息端口的 TypeORM 实现；未读计数与已读标记两条查询口径全部下沉                                                                       |
| `src/home/data/mood-log.repository.typeorm.ts`                | `MoodLogRepositoryTypeorm` —— 打卡端口的 TypeORM 实现；**实体工厂下沉** + 两个时间窗查询 + 物理删除 + entity→Row 映射全部下沉                                           |
| `test/home/td20-home-messages-moodlog-port-c2-batch4.spec.ts` | 端口替身 spec，**22 例**（A1-A8 消息 / B1-B14 打卡），零 entity import、零 typeorm 值符号、不起真 TypeORM / 不连 DB / 不 `vi.mock('typeorm')`                           |

### 2.2 修改（3 个文件）

| 文件                                          | 改动                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/home/providers/home-messages.service.ts` | 构造参数由 `@InjectRepository(HomeMessage) repo: Repository<HomeMessage>` 改为 `@Inject(HOME_MESSAGE_REPOSITORY) repo: HomeMessageRepository`；typeorm 值导入与 entity 值位置 import 全撤；**2 个公共方法签名与返回 DTO 形状逐字不变**；注释内 typeorm 字面量与「软删」措辞按红线 scrub                                                                 |
| `src/home/providers/home-mood-log.service.ts` | 构造参数由 `@InjectRepository(MoodLog) repo: Repository<MoodLog>` 改为 `@Inject(MOOD_LOG_REPOSITORY) repo: MoodLogRepository`；typeorm 值导入与 entity 值位置 import 全撤；**实体工厂 + save 移出**；`toOverviewFields` 的 entity 类型签名换 `MoodLogRow`；**4 个公共方法签名不变**；注释内 typeorm 字面量 scrub                                        |
| `src/home/home.module.ts`                     | 新增 **2 组** provider（`{ provide: HOME_MESSAGE_REPOSITORY, useClass: HomeMessageRepositoryTypeorm }` / `{ provide: MOOD_LOG_REPOSITORY, useClass: MoodLogRepositoryTypeorm }`）；**保留** `TypeOrmModule.forFeature([...])` 现有全部 **8** 个 entity 注册与 `UserModule` / `ProfileModule` import；`exports` 清单**不变**（仓储 token **不 export**） |

### 2.3 删除

无。

### 2.4 零改动确认

- `src/home/entities/home-message.entity.ts`（8 列 / 2 索引 / `readAt` 为**已读标记列**非 `@DeleteDateColumn`）、`src/home/entities/mood-log.entity.ts`（6 列 / 2 索引 / 真删）—— **一字未改**
- `src/home/dto/home-overview.dto.ts`、`src/home/controllers/home-messages.controller.ts`、`src/home/home.constants.ts` —— 零改动
- **排除 service 零改动**：`HomeCompanionService` / `HomeOverviewService` / `HomeMicroInterventionService` / `HomeMicroInterventionStatsService` / `HomeMicroInterventionScenarioService` / `HomeRecommendationEngine`
- `src/migration/`（含 `1700000008000-AddMoodLogs.ts` / `1700000008003-AddHomeMessages.ts`，均已在 `migration/index.ts` 注册）—— 零改动
- `src/engine-core/` —— 零改动（boundary 12 绿，`git diff --stat HEAD -- src/engine-core` 为空）
- **既有测试零改动**：`test/` 下 grep 本批 entity / service / 路径 **0 命中** → 本单**未动任何既有测试文件**（与 TD-17 的 1 处、TD-18 的 2 处、TD-19 的 0 处同口径，TD-19 同为 0）
- 其他业务域 / `package.json` / `tsconfig*.json` / `vitest.config.mts` / `test/vitest.e2e.mts` / CI / Dockerfile / `admin-dashboard/` / Flutter —— 零改动
- 未新增第三方依赖

---

## 三、端口方法面清单

### 3.1 端口划分粒度判定：**按实体分 2 个端口**（对齐 TD-16 life-map 同域多端口先例）

home 域 5 表 7 service，本批只切两张干净子表。消息表与打卡表的查询口径完全不同 —— 消息表是「计数 + 单条 update 标记」（无回读），打卡表是「写入 + 两个时间窗查询 + 物理删除」（有回读）；合成一个端口会把两套不相干的 where 条件与排序口径混在一起，对齐 TD-16 的判定（表不同 / 口径不同 → 分端口），同时避免 TD-16 的 4 端口粒度（本批只有 2 张表 → 2 个端口）。

### 3.2 8 处既有调用 → 6 个端口方法（任务单 §1.3 锚点，逐条对齐）

| 改前调用（HEAD `6d3b457`）                                                                                 | 改后端口方法                            | 口径                                                                                    |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------- |
| ① `repo.count({ where: { uid, readAt: IsNull() } })`（未读计数）                                           | `countUnread(uid)`                      | uid + 未读条件下沉实现层                                                                |
| ② `repo.update(where, { readAt: now })`（标记已读，where 含可选 `In(messageIds)`）                         | `markRead(uid, messageIds)`             | where 构造 + `id` 集合条件 + 已读时刻写入下沉实现层；**返回 affected 条数**             |
| ③ `repo.count({ where: { uid, readAt: IsNull() } })`（标记后重算剩余）                                     | ↑ 同一 `countUnread(uid)`（同上同口径） | 写完再调一次，**剩余未读留 service**                                                    |
| ④ `repo.create({...})` + `repo.save(entity)`（写入打卡）                                                   | `create(input)`                         | **实体工厂 + 保存下沉实现层**（对齐 TD-18 先例），入参由 service 纯对象构造             |
| ⑤ `repo.findOne({ where: { uid, createdAt: MoreThanOrEqual(startOfDay) }, order: { createdAt: 'DESC' } })` | `findLatestSince(uid, since)`           | uid + `created_at` 下界 + 倒序取一条下沉；**startOfDay 日期计算留 service**             |
| ⑥ `repo.find({ where: { uid, createdAt: MoreThanOrEqual(start) }, order: { createdAt: 'ASC' } })`          | `findRecentSince(uid, since)`           | uid + `created_at` 下界 + 正序下沉；**days 起点计算留 service**；`level` 映射留 service |
| ⑦ `repo.delete({ uid })`（物理删除）                                                                       | `deleteByUser(uid)`                     | 按 uid 物理删除 + affected 行数回传                                                     |

> 8 处调用（任务单口径 3 + 5）→ 6 个端口方法：① / ③ 同口径合并为一个 `countUnread`；④ 的工厂与保存合并为一个 `create`。**未新增任何通用代理方法**（无 `findAll` / `updateById` 之类）。

### 3.3 端口 interface 摘要

```
export interface HomeMessageRepository {
  countUnread(uid: string): Promise<number>;
  markRead(uid: string, messageIds: string[] | undefined): Promise<number>;
}

export interface MoodLogRepository {
  create(input: NewMoodLogInput): Promise<MoodLogRow>;
  findLatestSince(uid: string, since: Date): Promise<MoodLogRow | null>;
  findRecentSince(uid: string, since: Date): Promise<MoodLogRow[]>;
  deleteByUser(uid: string): Promise<number>;
}
```

### 3.4 类型清单

| 类型                      | 角色           | 说明                                                                                                               |
| ------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------ |
| `HomeMessageRepository`   | 端口 interface | 2 个方法，唯一调用方 `HomeMessagesService`；**无 Row 出参**                                                        |
| `HOME_MESSAGE_REPOSITORY` | DI token       | `Symbol('HOME_MESSAGE_REPOSITORY')`；module provider 绑定，**不 export**                                           |
| `MoodLogRepository`       | 端口 interface | 4 个方法，唯一调用方 `HomeMoodLogService`                                                                          |
| `MOOD_LOG_REPOSITORY`     | DI token       | `Symbol('MOOD_LOG_REPOSITORY')`；module provider 绑定，**不 export**                                               |
| `MoodLogRow`              | 出参           | 6 字段窄领域类型（id / uid / level / note / triggeredMicroInterventionId / createdAt）；**不含软删列**（本表真删） |
| `NewMoodLogInput`         | 写入入参       | 4 字段；`level` 用 `HomeEmotionLevel`（constants 的 `as const` 派生 type，纯类型、非 typeorm 值符号）              |

---

## 四、闸门表（真实数字，exit code 实测）

**机器状态（闸门前后各查一次，5 个 node 常驻进程，未杀用户进程）**：PID 7860 `vite`（admin-dashboard）· PID 12992 `pnpm start:dev` · PID 14612 `nest start --watch` · PID 15832 `node --enable-source-maps dist/app` · PID 20740 `pnpm dev`（admin-dashboard）。全程有 watch / vite / dist 常驻进程占用 CPU，墙钟可比性以**用例数 / 文件数**为准。

| 闸门         | 命令                                                                     | exit | 实测数字                                                                                                                                                                         |
| ------------ | ------------------------------------------------------------------------ | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 盘读前置     | `pnpm doctor:fs`                                                         | 0    | walk 41 ms · cold 39 ms slow 0 · warm 34 ms slow 0 · **per-file 均值 0.17 ms/文件** · 判定「合格（读取延迟正常，闸门数字可信）」                                                 |
| 根类型       | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`  | 0    | **0 error**                                                                                                                                                                      |
| 构建类型     | `pnpm exec tsc -p tsconfig.build.json --noEmit`                          | 0    | **0 error**                                                                                                                                                                      |
| Lint（权威） | `pnpm lint`                                                              | 0    | **0 error / 1 warning**（`test/e2e/v2-user-flow.spec.ts:1` 既有 unused eslint-disable，基线既有、范围外未修）                                                                    |
| oxlint fast  | `pnpm lint:fast`                                                         | 0    | **0 warning / 0 error**                                                                                                                                                          |
| 定向 spec    | `pnpm exec vitest run test/home/`                                        | 0    | **1 文件 / 22 例全绿**，924 ms                                                                                                                                                   |
| 全量测试     | `pnpm test`                                                              | 0    | **199 passed + 1 skipped（200 文件）· 3356 passed + 4 skipped（3360 例）**，Start 03:43:13，**Duration 92.37 s**                                                                 |
| engine-core  | `git diff --stat HEAD -- src/engine-core`                                | 0    | **空**（零 diff）                                                                                                                                                                |
| migration    | `git diff --stat HEAD -- src/migration/`                                 | 0    | **空**（零 diff）                                                                                                                                                                |
| 范围隔离     | `git diff --name-only HEAD` + `git ls-files --others --exclude-standard` | 0    | 本单 = 5 新增（2 端口 / 2 实现 / 1 新 spec）+ 3 修改（2 service / module）；另有主控产物（phase3 设计文档 ?? + 4 份归档 relay ??）与 TD-19 遗留的 3 份索引文档 M，**不纳入本单** |
| 边界         | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                 | 0    | **12 passed**（1.81 s）                                                                                                                                                          |

**全量口径对比**：基线 **3334 passed + 4 skipped（3338 例 / 199 文件）** → 本单 **3356 passed + 4 skipped（3360 例 / 200 文件）**，净增 **+22 例 / +1 文件**，**增量 = 本单新增 spec 的 22 例**，既有 3338 例**一条不减**。

---

## 五、typeorm 符号外泄复核表（§3.2 静态复核四项）

**受检面 5 个文件**（2 端口 + 2 service + 1 新 spec），grep 模式：`Repository<` · `Between` · `FindOptions` · `EntityManager` · `from 'typeorm'` · `from '@nestjs/typeorm'` · `@InjectRepository` · `getRepositoryToken` · `createQueryBuilder` · `SelectQueryBuilder` · `repo.query` · `MoreThanOrEqual` · `IsNull` · `In(`。

| 受检文件                                                      | typeorm 值符号命中 |
| ------------------------------------------------------------- | ------------------ |
| `src/home/domain/repositories/home-message.repository.ts`     | **0**              |
| `src/home/domain/repositories/mood-log.repository.ts`         | **0**              |
| `src/home/providers/home-messages.service.ts`                 | **0**              |
| `src/home/providers/home-mood-log.service.ts`                 | **0**              |
| `test/home/td20-home-messages-moodlog-port-c2-batch4.spec.ts` | **0**              |

**对照（允许落点）**：`src/home/data/home-message.repository.typeorm.ts` 命中 **9** 处、`src/home/data/mood-log.repository.typeorm.ts` 命中 **7** 处 —— 均在实现文件内。typeorm 值符号只落 3 处：两个 `data/` 实现文件 + `home.module.ts`（装配层 `forFeature`）。

> **宽模式 `Repository` 的命中归因**（避免误读）：命中项全部是自研命名 —— 端口 interface 名 `HomeMessageRepository` / `MoodLogRepository`（service + 替身 spec 各 1 处）。**typeorm 的 `Repository` 类符号（泛型标注 / 值导入 / 注入装饰器 / 查询句柄）0 命中**。

**四项静态复核结论**：

1. **typeorm 符号外泄** = 上表 5 个受检面**全部 0 命中** ✅
2. **spec 零 entity import** = 新 spec 对 `entities/` 路径的引用 **0** ✅
3. **service 值位置 entity import = 0** = 两个 service 内实体类名（词边界正则 `\bHomeMessage\b` / `\bMoodLog\b`）命中 **0** ✅ —— 含注释：原注释里的 `FindOptionsWhere<HomeMessage>` / `MoreThanOrEqual` 已改为业务口径描述
4. **方法面不泛化** = 消息端口恰 **2** 个方法、打卡端口恰 **4** 个方法，与 §1.3 调用面一一对应；新 spec **A7 / B13** 显式断言方法名集合，无 `findAll` / `updateById` 之类通用代理 ✅

**实体类名零命中复核**（同一正则跑 5 个受检面）：`\bHomeMessage\b` / `\bMoodLog\b` **0 命中** —— 端口 interface 名（`HomeMessageRepository` / `MoodLogRepository`）、Row 名（`MoodLogRow`）、入参名（`NewMoodLogInput`）均为**自研命名**，词边界正则不误判。

**另两项开工取证**（任务单 §1.1 / §1.2 锚点复核）：

- src 他域 grep `HomeMessagesService` / `HomeMoodLogService` / 两个 entity 类名 = **0 命中**（`MoodLog` 仅命中 `profile/growth-report.service.ts` 的**注释文本**，非 import）→ 确认**零跨域仓储消费**
- `test/` 下 grep 本批 entity / service / 路径 = **0 命中** → 确认**零既有测试适配面**

---

## 六、service 行为与改前对照表（业务语义零漂移）

| 行为点                | 改前（HEAD `6d3b457`）                                                                                   | 改后                                                | 判定                     |
| --------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------ |
| 未读计数口径          | service 内 `repo.count({ where: { uid, readAt: IsNull() } })`                                            | 实现层 `countUnread` 同一 where                     | 逐字一致                 |
| markRead where 构造   | service 内 `FindOptionsWhere<HomeMessage> = { uid, readAt: IsNull() }`                                   | 实现层同一 where 对象构造                           | 逐字一致                 |
| markRead id 集合条件  | `messageIds && messageIds.length > 0` 时 `where.id = In(messageIds)`                                     | 实现层同一判定 + 同一条件                           | 逐字一致                 |
| markRead 写入         | `repo.update(where, { readAt: now })`（`now` 在 service 内构造）                                         | 实现层 `repo.update(where, { readAt: new Date() })` | 语义等价（见 D-4）       |
| markedCount 取值      | `result.affected ?? 0`（service 内）                                                                     | 端口返回 affected 数 → service 直接使用             | 逐字一致                 |
| 标记后重算剩余        | service 再调一次 `repo.count`（同口径）                                                                  | service 再调一次 `countUnread(uid)`（同口径）       | 逐字一致（调用次数 1+1） |
| 消息日志              | `markRead uid=... marked=... remaining=...`                                                              | 同文案、同位置                                      | 逐字一致                 |
| 消息 DTO              | `{ count: remaining, markedCount }`                                                                      | 同字段同顺序                                        | 逐字一致                 |
| 打卡档位校验          | `['great','okay','low','crisis'].includes(level)` 否则抛 `BizException(InvalidParameter)`                | **留 service**，同判定同错误码同文案                | 逐字一致                 |
| 工厂 + 保存           | `repo.save(repo.create({ uid, level, note, triggeredMicroInterventionId }))`                             | 实现层 `create` 内一次完成，字段集不变              | 逐字一致                 |
| 打卡日志              | `logMood uid=... level=... intervention=...`                                                             | 同文案、同位置                                      | 逐字一致                 |
| 今日最新条件          | `repo.findOne({ where: { uid, createdAt: MoreThanOrEqual(startOfDay) }, order: { createdAt: 'DESC' } })` | 实现层 `findLatestSince` 同一条件 + 同一排序        | 逐字一致                 |
| startOfDay 起点       | service 内 `new Date(now.getFullYear(), now.getMonth(), now.getDate())`（本地时区 0 点）                 | **留 service**，同构造                              | 逐字一致                 |
| 近 N 天条件           | `repo.find({ where: { uid, createdAt: MoreThanOrEqual(start) }, order: { createdAt: 'ASC' } })`          | 实现层 `findRecentSince` 同一条件 + 同一排序        | 逐字一致                 |
| days 起点             | service 内 `new Date(); start.setDate(start.getDate() - days)`                                           | **留 service**，同构造                              | 逐字一致                 |
| level 映射            | service 内 `rows.map((r) => r.level)`                                                                    | **留 service**（Row.level）                         | 逐字一致                 |
| 物理删除              | `repo.delete({ uid })` → `result.affected ?? 0`                                                          | 实现层 `deleteByUser` → service 组 DTO              | 逐字一致                 |
| toOverviewFields 三态 | `log.level` / `log.note` / `log.createdAt.toISOString()`；null → 三字段全 null                           | 同（`MoodLogRow` 字段名逐字相同）                   | 逐字一致                 |
| entity → Row 映射     | 无（service 直接拿 entity）                                                                              | 实现层 `toRow` 6 字段逐字映射                       | 新增映射层，字段集相同   |

---

## 七、边界确认

- **engine-core 零改动**：`git diff --stat HEAD -- src/engine-core` 为空；`boundary.spec.ts` 零改动，**12 绿**。
- **entity 文件零改动**：两个 entity 的字段 / 装饰器 / 列 / 索引 / 类型引用 / 真删无软删口径全部保留；migration DDL 不动。
- **DTO / controller / constants 不动**：`home-overview.dto.ts` / `home-messages.controller.ts` / `home.constants.ts` 零改动；消息 2 个端点（GET `/home/messages/unread-count` · POST `/home/messages/mark-read`）路由与限流不变。
- **排除 service 不动**：`HomeCompanionService` / `HomeOverviewService`（仍直连 profile / user entity，本批不动）/ 微干预一族 3 service / `HomeRecommendationEngine` 的仓储依赖、import、逻辑零改动。
- **module 装配面**：`TypeOrmModule.forFeature([...])` 现有全部 **8** 个 entity 注册保留；`UserModule` / `ProfileModule` import 保留；`exports` 清单不变，**仓储 token 不 export**。
- **service-to-service DI 边**：`HomeMoodLogService` 被同域 `HomeOverviewService` 构造注入 —— 端口化只替换 service **内部**仓储依赖，service 类名与对外 DI 形态不变，`HomeOverviewService` 本批不动。
- **其他业务域 / migration / 配置 / CI / 前端**：零改动；未新增第三方依赖。
- **既有测试零改动**：本域无 src spec；他域零引用 → **本单未动任何既有测试文件**。
- **零压红线**：本单不涉及自由练习（practice）评分口径。
- **隐私红线**：交付记录与 spec 内**无任何用户打卡备注原文 / 消息正文**，一律用占位字面量（`note: 'note'` 等合成串）；本域日志仍只打 uid / level / intervention / marked / remaining（debug 级），未新增日志。
- **命令边界**：一律 `pnpm` / `pnpm exec`，未用裸 `npx`；未新增依赖；未改 `package.json` / `tsconfig` / vitest 配置 / CI。
- **提交边界**：**未自动 commit / push**，只给 commit message 草稿（§十）。

---

## 八、偏差登记（conventions §2.5）

| 编号 | 原锚点（任务单 / 仓内）                                                                | 实测 / 处置                                                                  | 理由                                                                                                                                                             |
| ---- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1  | 任务单 §1.3：端口方法建议 `markRead(uid: string, messageIds: string[]                  | null)`                                                                       | 端口签名取 **`string[]                                                                                                                                           | undefined`**（跟 service 形参逐字一致）                      | service 形参实测是 `messageIds: string[] | undefined`（必传、可为 undefined；控制器传 `dto.messageIds`）→ 端口不引入 null↔undefined 转换，service 公共签名零漂移 |
| D-2  | 改前 `logMood(...): Promise<MoodLog>`（出参是 entity 类）                              | 出参类型改为 **`Promise<MoodLogRow>`**（6 字段结构等价，运行时形状不变）     | §3.2 第 3 项 / 红线要求「service 不出现 entity 类名」→ 出参必须是窄领域类型；全仓 grep `logMood` 仅命中 service 自身定义与日志行（**无调用方**），无消费方受影响 |
| D-3  | 改前 `getTodayLatest(): Promise<MoodLog                                                | null>`/`toOverviewFields(log: MoodLog                                        | null)`                                                                                                                                                           | 类型签名换 **`MoodLogRow`**（任务单 §2 第 3 项已明示该处置） | 同上；三态转换与 ISO 时间戳口径逐字不变  |
| D-4  | 改前 `markRead` 内 `const now = new Date()` 后传给 update                              | 已读时刻改由**实现层**在 update 前构造（`{ readAt: new Date() }`）           | 任务单 §1.3 的端口签名不含 now 入参（只收 uid + messageIds）；同一时刻写已读标记，语义等价                                                                       |
| D-5  | 改前 service 注释含 typeorm 字面量 `FindOptionsWhere<HomeMessage>` / `MoreThanOrEqual` | 注释改为业务口径描述（`where 类型显式声明` / `created_at 下界走 SQL 比较`）  | §3.2 第 1 项要求「注释文案也避开 typeorm 字面量」（对齐 TD-13 D-5）                                                                                              |
| D-6  | 改前 `HomeMessagesService` 类头注释写「软删: read_at 不为空 → 不显示」                 | 改为「**已读隐藏**: read_at 不为空 → 不显示 (保留审计; 已读标记不是软删列)」 | 任务单 §1.4 第 3 项：`readAt` **不是软删列**，口径描述不得写成软删（entity 文件一字未改，其自身注释保留原样）                                                    |
| D-7  | 任务单 §1.3：消息端口**无 Row 出参**（与 TD-17 ~ TD-19 先例的结构差异）                | **按锚点实现**：不定义 `HomeMessageRow`                                      | 该 service 无 entity 回读路径（只计数 + 更新），硬造用不到的 Row 会让端口面变宽（对齐 TD-13 D-2「面窄才守得住」）                                                |
| D-8  | 任务单 §3.2：受检面「共 **6** 个」                                                     | 实测受检面 = **5** 个（2 端口 + 2 service + 1 新 spec）                      | **任务单计数错配**（非本单回归）；受检面清单以仓内实测为准                                                                                                       |

---

## 九、遗留项

### 9.1 另案（沿用）

- **C2 / G**：其余域仓储端口化分批推广；每批验收口径 = 「service 源码层 typeorm 值符号 0 命中」+「该批 spec 值位置 entity import = 0」（TD-14 备忘 §5.3，**不再以加载图减重为 KPI**）。后续批次候选：**home 微干预一族 + companion / overview 切片 → inner_world → ai-engine → companion → profile / user / counselor**。**C2 第四批（本单）已完成**。
- **I**：端口内存实现是否补（本单不补；spec 替身已覆盖替身需求）。
- **J**：混合形态 typeorm import 统一形态（可读性向、零运行时收益，另案批量处理）。
- **K**：`bin/ormconfig.ts` 的 `entities` glob 口径脱节（独立既有债，沿用 TD-14 登记）。
- **M**：entity 类值位置边 —— 本批两个 service 值位置 entity import 已归零；顶层 barrel `export *` 残留的 entity 类导出边归 C2/G 推广时闭合。
- **N**：「枚举 / 端口文件零 typeorm 依赖」静态守护 spec（本单不新增；守护证据走 grep 复核 + lint）。
- **P**：consent 失败容忍语义未落地（TD-17 另案，沿用登记，与本域无关）。

### 9.2 本单新观察（登记另案，不在本单处理）

- **观察（新）**：`src/home/entities/mood-log.entity.ts` 的 `level` 列与 `src/home/entities/home-message.entity.ts` 的 `readAt` 列**都不是软删列** —— 任务单 §1.4 第 3 项已固化该口径；**entity 文件自身的注释仍写着「软删用 read_at」**（本单「entity 一字不改」红线内不改），后续若统一口径需另案。
- **观察（新）**：`HomeMoodLogService.logMood` 全仓 grep 仅命中 service 自身定义与日志行 —— **当前无 controller / service 调用方**（公共 API 预留，home 域无 mood-log controller）；本单**不改该方法的存在性**，另案评估。
- **观察（新，TD-20）**：`getRecentTrend` / `getTodayLatest` 的「今天 / 近 N 天」日期边界按**服务端本地时区**计算（service 注释已注明 V3 计划接 timezone 入参）；本批**不改该口径**。
- **观察（沿用 TD-19）**：`src/emergency/enums/emergency.enums.ts` 的 `isTerminalPhase(phase)` 全仓 0 调用方（死代码），另案评估是否删除；本单不动 enums。
- **观察（沿用 TD-18）**：根目录 e2e 遗留 spec 未被任何 vitest config 收集的测试入口收纳问题，另案评估，本单不清理、不移动、不改 include。

### 9.3 Actions 侧待复核点

- CI 结果待主控 push 后在 Actions 复核（本机闸门已全绿）。
- 本单**未自动 commit / push**；commit 分组见 §十。

### 9.4 提交分组核对

本单文件与并行进程产物**分离**：5 个 node 常驻进程（`nest start --watch` / `vite` / `node dist/app`）不产生 git 改动；`admin-dashboard/` 未触碰；工作区里主控的 `docs/architecture/phase3-judge-layer-ai-review-design-2026-11-15.md` 与 4 份归档 relay（`docs/worklog/pending/archive/relay-response-2026111*.md`）以及 TD-19 遗留的 3 份索引文档改动**不纳入本单 stage**。

---

## 十、commit message 草稿（不自己 commit / push）

```
feat(home): TD-20 C2 第四批仓储端口化 —— 双端口 + TypeORM 实现 + 端口替身 spec
```

建议拆 2 个 commit：

1. `feat(home): TD-20 C2 第四批仓储端口化 —— 双端口 + TypeORM 实现 + 端口替身 spec`
2. `docs(worklog): TD-20 交付记录 + 索引回写（P-DEBT-11 / L-1 · C2 第四批）`

---

_记录时间：2026-11-15 GMT+8 · 基线 HEAD `6d3b457` · 未自动提交_
