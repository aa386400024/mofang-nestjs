# TD-20 · C2 第四批仓储端口化（home 域 · 干净切片：home_messages + mood_logs · P-DEBT-11 / L-1 · TD-14 推荐路线第三段 C2 第四批）

> 状态：✅ **已交付**（2026-11-15，MiniMax Code）→ 交付记录：`docs/worklog/completed/phase2.5/td20-home-messages-moodlog-port-c2-batch4-implementation-2026-11-15.md`
> 仓库：E:\Work\Project\backend\mofang-nestjs，分支 integrate，基线 HEAD `6d3b457`（TD-19 交付后，与 `origin/integrate` 一致）
> 唯一事实源：`docs/team/gate-performance-remediation-2026-11-11.md` §9 **P-DEBT-11**（L-1）+ `docs/architecture/entity-typeorm-decoupling-assessment-2026-11-14.md`（TD-14 备忘）§5.3 / §6.1 / §6.2 + TD-13 / TD-16 / TD-17 / TD-18 / TD-19 交付记录（四件套模板与先例）
> 任务性质：**实现单（C2 推广第四批）** —— 在 TD-13（analytics）、TD-16（life-map）、TD-17（consent）、TD-18（good_state_diary）、TD-19（emergency）五个先例验证过的「仓储端口」模式上，选 **home 域的两张干净子表**（`home_messages` / `mood_logs`）按 TD-13 四件套复制；本批是 C2 首个「域内切片 + 双端口」批次（同域内排除跨域消费 service 与微干预一族，留后续批）
> 改动范围：`src/home/`（仅两个目标 service + `domain/` + `data/` + module 接线）+ `test/home/`（新建）+ 交付文档；`engine-core/`、`src/migration/`、配置、CI、其他业务域、前端不碰

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `E:\Work\Project\backend\mofang-nestjs\README.md` —— 仓库总览
2. `E:\Work\Project\backend\mofang-nestjs\docs\README.md` —— 文档导航
3. `E:\Work\Project\backend\mofang-nestjs\docs\team\conventions.md` —— 代码红线 + 交付格式（§1.1 engine-core 分层、§1.3 pnpm 命令规范、§三 16 条硬约束、§2.5 偏差登记）
4. 阶段工作入口：`docs/worklog/pending/phase2.5-README.md` 与 `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md`
5. 根因与既往结论：
   - TD-14 备忘 `docs/architecture/entity-typeorm-decoupling-assessment-2026-11-14.md` §5.3（G 收益口径）、§6.1（C+ / C1 / C2 三段）、§6.2（试点域选择标准与候选排序）
   - TD-19 交付记录 `docs/worklog/completed/phase2.5/td19-emergency-port-c2-batch3-implementation-2026-11-15.md`（最近一个四件套先例：单端口粒度、Row 出参、替身 spec 结构、typeorm 符号外泄复核、行为对照表、偏差登记）
   - TD-16 交付记录 `docs/worklog/completed/phase2.5/td16-life-map-port-pilot-c1-implementation-2026-11-14.md`（**同域多端口**划分先例：按实体分端口的判定口径）
   - TD-17 交付记录 `docs/worklog/completed/phase2.5/td17-consent-port-c2-batch1-implementation-2026-11-14.md`（最小单端口 + 工厂在实现层先例）
   - TD-13 交付记录 `docs/worklog/completed/phase2.5/td13-repository-port-analytics-pilot-implementation-2026-11-14.md`（四件套结构、端口方法面口径、typeorm 符号外泄复核、偏差登记）
   - 端口样板：`src/emergency/domain/repositories/emergency-session.repository.ts` + `src/emergency/data/emergency-session.repository.typeorm.ts`；`src/consent/domain/repositories/consent.repository.ts` + `src/consent/data/consent.repository.typeorm.ts`；`src/life-map/domain/repositories/`（4 端口）
6. 本任务单（就是你在读的这份）

---

## 1. 背景（先读，方向别错）

TD-14 备忘 §6.1 推荐路线分三段：**C+（枚举外移，TD-15 已交付）→ C1（试点域端口化，TD-13 analytics + TD-16 life-map 已交付）→ C2（按域推广，TD-17 consent 第一批、TD-18 good_state_diary 第二批、TD-19 emergency 第三批已交付，本单为第四批）**。C2 的任务是把已成型的域级模板逐域复制；每批验收口径按 TD-14 §5.3 修正版执行，**不再以加载图减重为 KPI**。

**模式定义**（沿用 TD-13 四件套，本批双端口）：

1. **端口**：`src/home/domain/repositories/` 下两个文件 —— `home-message.repository.ts`（`HomeMessageRepository` + `HOME_MESSAGE_REPOSITORY` token）与 `mood-log.repository.ts`（`MoodLogRepository` + `MOOD_LOG_REPOSITORY` token + `MoodLogRow` / `NewMoodLogInput`）；零 typeorm 值符号。
2. **TypeORM 实现**：`src/home/data/` 下两个文件 —— `home-message.repository.typeorm.ts` 与 `mood-log.repository.typeorm.ts`；`@InjectRepository` + `Repository` + 查询操作符全部收在这两个文件；域内本批端口对应的 typeorm 值符号只允许落在实现文件与 module 装配层。
3. **module 接线**：两组 provider `{ provide: HOME_MESSAGE_REPOSITORY, useClass: HomeMessageRepositoryTypeorm }` / `{ provide: MOOD_LOG_REPOSITORY, useClass: MoodLogRepositoryTypeorm }`；**保留** `TypeOrmModule.forFeature([...])` 现有全部 entity 注册；exports 口径按现状（仓储 token 不 export，对齐 TD-13 D-4 / TD-16 ~ TD-19）。
4. **端口替身 spec**：`test/home/td20-home-messages-moodlog-port-c2-batch4.spec.ts` —— 替身只记调用参数 + 返回预设行；不起真 TypeORM、不连 DB、不 `vi.mock('typeorm')`。

### 1.1 切片选定：home 域两张干净子表（主控取证锚点，HEAD `6d3b457`；执行方复核并登记偏差）

| TD-14 §6.2 选择标准                      | home_messages / mood_logs 实测                                                                                                                                                                                                                              | 判定 |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1. 扁平表优先（无关系装饰器）            | `HomeMessage` / `MoodLog` 关系装饰器 **0**（@ManyToOne / @OneToMany / @ManyToMany / @OneToOne / @JoinColumn / @JoinTable 全 0）                                                                                                                             | ✅   |
| 2. entity 文件内无枚举                   | 0 内联 `enum`；`level` 类型 `HomeEmotionLevel` 来自 `home.constants.ts`（`as const` 派生 type，纯类型、零 typeorm）；`type` 为字符串联合字面量；无软删列（mood_logs）/ `readAt` 为已读标记列（home_messages，非 `@DeleteDateColumn`）                       | ✅   |
| 3. 无跨模块仓储消费                      | src 他域 grep `HomeMessagesService` / `HomeMoodLogService` = **0**；`HomeMessage` 仅命中 migration DDL；`MoodLog` 仅命中 migration + `profile/growth-report.service.ts` 注释文本（非 import）；`HomeModule` 仅 `app.module.ts` 装配                         | ✅   |
| 4. 引用面小 + module forFeature 单点注册 | 两个目标仓储仅被本批两个 service 使用；`home.module.ts` 单点 `forFeature`；`home-messages.controller` 只注入 `HomeMessagesService`；`HomeMoodLogService` 被同域 `HomeOverviewService` 构造注入（service-to-service 调用，不碰仓储，端口化不改变这条 DI 边） | ✅   |
| 5. 已有等价端口先例可抄                  | TD-13 / TD-16 / TD-17 / TD-18 / TD-19 五套四件套均在仓内                                                                                                                                                                                                    | ✅   |

**本批排除（明确不在范围，见 §2）**：

- `HomeCompanionService` —— 注入 `CompanionBinding` / `UserProfile`（profile 域跨模块 entity）；
- `HomeOverviewService` —— 注入 `CompanionBinding` / `UserProfile` / `User` / `HomeMessage`（跨域 + 聚合 service）；
- 微干预一族：`HomeMicroInterventionService`（Config + History）/ `HomeMicroInterventionStatsService`（History + QB）/ `HomeMicroInterventionScenarioService`（Scenario，entity 内含 2 个内联枚举）；
- `HomeRecommendationEngine`（无仓储）。

### 1.2 本批现状清单（主控实测；`test/` 下 **0** 既有 spec 引用本批 entity / service）

| 文件                                                                   | 现状                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entities/home-message.entity.ts`（`HomeMessage`，表 `home_messages`） | 扁平：`id`(uuid PK) / `uid`(char36) / `type`(varchar32 联合字面量 system/companion/companion_request/micro_intervention_nudge) / `title`(varchar64 null) / `preview`(varchar280 null) / `refId`(varchar64 null, 列 `ref_id`) / `readAt`(datetime null, 列 `read_at`) / `updatedAt`(`@UpdateDateColumn`, 列 `updated_at`)；索引 `idx_home_messages_uid_read`(uid, readAt)；**无 `@DeleteDateColumn`**（readAt 是已读标记，不是软删列）；**本单不改 entity 文件** |
| `entities/mood-log.entity.ts`（`MoodLog`，表 `mood_logs`）             | 扁平：`id`(uuid PK) / `uid`(char36) / `level`(varchar16, `HomeEmotionLevel`) / `note`(varchar280 null) / `triggeredMicroInterventionId`(varchar64 null, 列 `triggered_micro_intervention_id`) / `createdAt`(`@CreateDateColumn`, 列 `created_at`)；索引 `idx_mood_logs_uid_created_at`(uid, createdAt)；真删、无软删路径；**本单不改 entity 文件**                                                                                                              |
| `providers/home-messages.service.ts`（`HomeMessagesService`）          | **直连 1 个 Repository**：`@InjectRepository(HomeMessage) private readonly repo: Repository<HomeMessage>`；值位置 import entity 类；2 个公共方法 `getUnreadCount(uid)` / `markRead(uid, messageIds?)`；无私有仓储方法；`Logger` 只打 uid / marked / remaining（隐私口径不变）                                                                                                                                                                                   |
| `providers/home-mood-log.service.ts`（`HomeMoodLogService`）           | **直连 1 个 Repository**：`@InjectRepository(MoodLog) private readonly repo: Repository<MoodLog>`；值位置 import entity 类；4 个公共方法 `logMood(uid, level, note, triggeredMicroInterventionId)` / `getTodayLatest(uid, now?)` / `getRecentTrend(uid, days?)` / `clearForUser(uid)`；私有 `toOverviewFields(log)`（纯函数，不碰仓储）；`Logger` 只打 uid / level / intervention（隐私口径不变）                                                               |
| `controllers/home-messages.controller.ts`                              | 只注入 `HomeMessagesService`；无 Repository / entity 旁路；**不改**                                                                                                                                                                                                                                                                                                                                                                                             |
| `dto/home-overview.dto.ts`                                             | `UnreadMessageCountDto { count }` / `MarkMessagesReadResponseDto { count, markedCount }`；不 import 本批 entity；**不改**                                                                                                                                                                                                                                                                                                                                       |
| `home.constants.ts`                                                    | `HOME_EMOTION_LEVELS` + `type HomeEmotionLevel`（`as const` 派生）；纯常量与类型、零 typeorm；**不改**                                                                                                                                                                                                                                                                                                                                                          |
| `home.module.ts`                                                       | `forFeature([MoodLog, MicroInterventionConfig, MicroInterventionHistory, MicroInterventionScenario, HomeMessage, CompanionBinding, UserProfile, User])` + imports `UserModule` / `ProfileModule`；providers 8 项；exports 与 providers 同清单；controllers 5 个                                                                                                                                                                                                 |

**test/ 现状**：`test/home/` 目录不存在（本单新建）；grep `HomeMessage` / `MoodLog` / `HomeMessagesService` / `HomeMoodLogService` / `home-messages` / `home-mood-log` / `mood-log` 全部 **0 命中** → 本批**零既有测试适配面**（与 TD-19 同口径）。

### 1.3 仓储调用面（端口方法面只收这些现有调用，不泛化）

**A. `HomeMessagesService` 现有 3 处**仓储调用形态：

1. `repo.count({ where: { uid, readAt: IsNull() } })`（L33–35）—— getUnreadCount 未读计数
2. `repo.update(where, { readAt: now })`（L60）—— markRead；`where = { uid, readAt: IsNull() }`，`messageIds` 非空且长度 > 0 时追加 `where.id = In(messageIds)`；返回 `result.affected ?? 0`
3. `repo.count({ where: { uid, readAt: IsNull() } })`（L63–65）—— markRead 写完后重算剩余未读

**端口方法建议（HomeMessageRepository）**（实现单可调整，须在交付记录写明偏差与理由）：

- `countUnread(uid: string): Promise<number>` —— 合并调用 #1 / #3（同口径两处 count）；`uid` + `readAt IS NULL` 条件下沉实现层
- `markRead(uid: string, messageIds: string[] | null): Promise<number>` —— 调用 #2；update 的 where 口径（uid + readAt IS NULL；messageIds 非空非空数组时 `id In(...)`）与 `readAt = now` 写入下沉实现层；**返回 affected 行数**（即 markedCount）；**剩余未读计数留 service**（写完再调 `countUnread(uid)`，对应 #3）
- **本端口无 Row 出参**：该 service 无 entity 回读路径（只计数 + 更新），不定义 `HomeMessageRow`；此为与 TD-17 ~ TD-19 先例的结构差异，登记偏差。

**B. `HomeMoodLogService` 现有 5 处**仓储调用形态：

1. `repo.create({ uid, level, note, triggeredMicroInterventionId })` + `repo.save(entity)`（L44–51）—— logMood；实体工厂 + 保存
2. `repo.findOne({ where: { uid, createdAt: MoreThanOrEqual(startOfDay) }, order: { createdAt: 'DESC' } })`（L66–69）—— getTodayLatest；未命中返 null
3. `repo.find({ where: { uid, createdAt: MoreThanOrEqual(start) }, order: { createdAt: 'ASC' } })`（L79–82）—— getRecentTrend；service 侧 `rows.map((r) => r.level)`
4. `repo.delete({ uid })`（L111）—— clearForUser；返回 `result.affected ?? 0`

**端口方法建议（MoodLogRepository）**：

- `create(input: NewMoodLogInput): Promise<MoodLogRow>` —— 调用 #1；实体工厂 + save 下沉实现层（对齐 TD-18 实体工厂下沉实现层先例）
- `findLatestSince(uid: string, since: Date): Promise<MoodLogRow | null>` —— 调用 #2；`uid` + `createdAt >= since` + `createdAt DESC` + 取一条，下沉实现层；**`startOfDay` 日期计算留 service**（纯日期口径，非仓储条件）
- `findRecentSince(uid: string, since: Date): Promise<MoodLogRow[]>` —— 调用 #3；`uid` + `createdAt >= since` + `createdAt ASC`，下沉实现层；**`days` 起点日期计算留 service**；`rows.map(level)` 映射留 service
- `deleteByUser(uid: string): Promise<number>` —— 调用 #4；`where uid` 物理删除，返回 affected 行数

**Row 类型 `MoodLogRow` 字段**（entity → Row 映射，窄领域类型，不含 entity 类；本域真删、无软删列）：

```
id: string
uid: string
level: HomeEmotionLevel                       // 引用 home.constants 纯类型，非 typeorm 值符号
note: string | null
triggeredMicroInterventionId: string | null
createdAt: Date
```

**入参类型**（service 构造，纯对象，不依赖仓储工厂）：

- `NewMoodLogInput`：`uid` / `level: HomeEmotionLevel` / `note: string | null` / `triggeredMicroInterventionId: string | null`

### 1.4 与先例的关键差异（任务单固化，不可照抄先例）

1. **同域双端口切片**。home 域 5 表 7 service，本批只做 `home_messages` / `mood_logs` 两张干净子表 + 两个 service；微干预一族（含内联枚举的 Scenario）与跨域注入的 companion / overview service **留后续批**。端口文件按实体分两个（对齐 TD-16 life-map 按实体分端口先例）。
2. **`HomeMessageRepository` 无 Row 出参**。纯计数 + 更新端口，无回读 entity 路径；不硬造 `HomeMessageRow`。
3. **`readAt` 不是软删列**。home_messages 用 `readAt` 标记已读（按已读隐藏、保留审计），不是 `@DeleteDateColumn`，没有恢复 / 擦除路径；Row（本端口无）与口径描述都不得写成软删。
4. **零既有测试适配面**。test/ 下 0 引用本批 entity / service；本单**不改动任何既有测试**。
5. **module imports `UserModule` / `ProfileModule`**（跨域模块依赖）；这两个 import 与 `forFeature` 现有全部 8 个 entity 注册**原样保留**；现状 exports 清单保持不变，**仓储 token 仍不 export**。
6. **`HomeMoodLogService` 被同域 `HomeOverviewService` 构造注入**。端口化只替换 service 内部仓储依赖，service 类名 / 构造签名（对外 DI 形态）不变；`HomeOverviewService` 本批不动。

### 1.5 遗留观察（不进本单范围，交付记录登记）

- **观察（沿用 TD-19）**：`src/emergency/enums/emergency.enums.ts` 的 `isTerminalPhase(phase)` 全仓 0 调用方（死代码），另案评估是否删除；本单不动 enums。
- **观察（沿用 TD-18）**：根目录 e2e 遗留 spec 未被任何 vitest config 收集的测试入口收纳问题，另案评估，本单不清理、不移动、不改 include。
- **观察（本域新登记，可选）**：`HomeMoodLogService.getRecentTrend` / `getTodayLatest` 的「今天 / 近 N 天」日期边界按服务端本地时区计算（service 注释已注明 V3 计划接 timezone 入参）；本批不改该口径，仅在交付记录备注。

### 1.6 基线闸门（HEAD `6d3b457`，TD-19 交付后）

全量 **3334 passed + 4 skipped（3338 例 / 199 文件）**；lint **0 error / 1 warning**（`test/e2e/v2-user-flow.spec.ts:1` 既有 unused eslint-disable，范围外不修）；lint:fast **0 / 0**；boundary **12 passed**；根 tsc / build tsc **0 error**；`git diff --stat HEAD -- src/engine-core` 为空。

本域定向实测（取证会话）：`test/home/` 目录不存在；新端口替身 spec 为本批唯一新增测试文件。

---

## 2. 范围（严格遵守，不越权）

### 在范围内

1. **端口文件**：`src/home/domain/repositories/home-message.repository.ts` + `src/home/domain/repositories/mood-log.repository.ts`（interface + Symbol token + `MoodLogRow` / `NewMoodLogInput`；消息端口无 Row）。
2. **TypeORM 实现**：`src/home/data/home-message.repository.typeorm.ts` + `src/home/data/mood-log.repository.typeorm.ts`；`@InjectRepository` / `Repository` / 查询操作符（`IsNull` / `In` / `MoreThanOrEqual` 等）只允许出现在这两个实现文件与 module 装配层。
3. **两个目标 service** 改依赖端口（直连 Repository 抽出）：`home-messages.service.ts` / `home-mood-log.service.ts`；service 不再值位置 import entity 类（`HomeEmotionLevel` 来自 constants 的 type import 保留，纯类型、非 typeorm 值符号）；`toOverviewFields(log)` 的 entity 类型签名替换为 `MoodLogRow`。
4. **module 接线**：新增两组端口 provider；保留 `forFeature` 现有全部 entity 与 `UserModule` / `ProfileModule` import；exports 保持现状（仓储 token 不 export）。
5. **service 公共签名不变**：`getUnreadCount(uid)` / `markRead(uid, messageIds?)` / `logMood(uid, level, note, triggeredMicroInterventionId)` / `getTodayLatest(uid, now?)` / `getRecentTrend(uid, days?)` / `clearForUser(uid)` 六个方法签名、返回 DTO / 返回形状逐字保持。
6. **端口替身 spec**：`test/home/` 新增（工作项前缀 + 端口语义，对齐 TD-13 D-1 / TD-16 ~ TD-19 命名）；替身记调用参数 + 返回预设行；**spec 零 entity import**；不起真 TypeORM、不连 DB、不 `vi.mock('typeorm')`。
7. **文档与索引回写**（§7 清单）。

### 明确不在范围内（禁止顺手做）

- **entity 文件一字不改**：字段、装饰器、列、索引、类型引用、无软删口径全部保留；DTO、controller、路由、业务语义不动；`home.constants.ts` 不动。
- **排除 service 一律不动**：`HomeCompanionService` / `HomeOverviewService` / `HomeMicroInterventionService` / `HomeMicroInterventionStatsService` / `HomeMicroInterventionScenarioService` / `HomeRecommendationEngine` 的仓储依赖、import、逻辑本批不碰。
- 本域无 `index.ts` barrel；顶层 `src/index.ts` barrel 的 entity 类值导出边归另案 **M**，本单不删导出、不改对外面。
- 不做 Row 纯类型持久化分层映射的其他推广；不做 EntitySchema / 纯类改造；不补端口内存实现（另案 **I**）。
- 端口方法面只收 §1.3 现有调用；**不扩通用仓储代理**、不暴露 typeorm 管理句柄 / 查询选项 / 操作符；端口不写 SQL；端口 / service / spec 不暴露 entity 类名。
- 其他业务域零改动；`src/migration/` 零改动（`1700000008003-AddHomeMessages.ts` / `1700000008000-AddMoodLogs.ts` 已在 `migration/index.ts` 注册）；不改 package.json / tsconfig / `vitest.config.mts` / `test/vitest.e2e.mts` / CI / Dockerfile；不新增第三方依赖；不碰 `admin-dashboard/` 与 Flutter。
- 既有 spec 断言 / mock 语义零改动；其他域 spec 不新增、不修改。
- 不自动 git commit / push（写完给 commit 草稿，等用户指令）。

### 另案登记（本单不做，写入交付记录遗留段）

- **C2 / G**：其余域仓储端口化分批推广；每批验收口径 = 「service 源码层 typeorm 值符号 0 命中」+「该批 spec 值位置 entity import = 0」（TD-14 备忘 §5.3，不再以加载图减重为 KPI）。后续批次候选：home 微干预一族 + companion / overview 切片 → inner_world → ai-engine → companion → profile / user / counselor。
- **I**：端口内存实现是否补（本单不补；spec 替身已覆盖替身需求）。
- **J**：混合形态 typeorm import 统一形态（可读性向、零运行时收益，另案批量处理）。
- **K**：`bin/ormconfig.ts` 的 `entities` glob 口径脱节（独立既有债，沿用 TD-14 登记）。
- **M**：entity 类值位置边 —— 本批两个 service 值位置 entity import 归零；顶层 barrel `export *` 残留的 entity 类导出边归 C2/G 推广时闭合。
- **N**："枚举 / 端口文件零 typeorm 依赖"静态守护 spec（本单不新增；守护证据走 grep 复核 + lint）。
- **P**：consent 失败容忍语义未落地（TD-17 另案，沿用登记，与本域无关）。
- **观察（沿用）**：`isTerminalPhase` 0 调用方死代码；根目录 e2e 遗留 spec 未被任何 config 收集。

---

## 3. 目标交付物

### 3.1 代码改动

- 两个端口文件 + 两个 TypeORM 实现文件（`domain/repositories/` + `data/`）；`home.module.ts` 两组 provider 接线；两个目标 service 依赖改端口；新增端口替身 spec。
- 业务行为零漂移：
  - 消息：未读计数口径（uid + readAt IS NULL）；markRead 的 where（uid + readAt IS NULL；可选 id In(messageIds)）+ `readAt = now` 单次 update；affected = markedCount；写完重算剩余未读；日志 `markRead uid=... marked=... remaining=...` 逐字不变。
  - 打卡：`logMood` 档位校验（`['great','okay','low','crisis'].includes(level)` 否则抛 `BizException(InvalidParameter, ...)`）保留在 service；工厂 + 保存；`getTodayLatest` 的 `startOfDay`（本地时区 0 点）计算留 service、`createdAt >= since` + DESC 取一条留实现层；`getRecentTrend` 的 `start = now - days` 计算留 service、`createdAt >= since` + ASC 留实现层、level 映射留 service；`clearForUser` 按 uid 物理删除、affected = deletedCount；`toOverviewFields` 三态（null / 字段 + ISO 时间戳）逐字不变。

### 3.2 静态复核证据（grep 复核，结果落交付记录）

1. **typeorm 符号外泄**：两个端口文件、两个 service、新 spec 共 6 个受检面，`Repository` / `IsNull` / `In` / `MoreThanOrEqual` / `FindOptionsWhere` / `EntityManager` / `from 'typeorm'` / `from '@nestjs/typeorm'` 值符号 **0 命中**（注释文案也避开 typeorm 字面量，对齐 TD-13 D-5）；命中只允许在两个 `data/` 实现文件与 module 装配层。
2. **spec 零 entity import**：新 spec 对 `entities/` 路径的 entity 类 import = **0**。
3. **service 值位置 entity import = 0**：两个 service 不再值位置 import entity 类（constants 的 type import 保留）。
4. **方法面不泛化**：两个端口方法与 §1.3 调用面一一对应（消息 2 方法 / 3 处调用；打卡 4 方法 / 5 处调用）；新 spec 用例显式断言调用次数与参数；无新增通用 `findAll` / `updateById` 之类代理方法。

### 3.3 交付记录（§6 固定路径）

含改动清单、两端口方法面清单、typeorm 符号外泄复核表、service 行为与改前对照表（未读计数 / markRead where 与 affected / 档位校验 / 工厂保存 / 两个时间窗查询条件与排序 / 物理删除 / DTO 与 toOverviewFields 转换）、偏差登记（conventions §2.5）、边界确认、遗留另案。

> **口径真相源**：调用面与出参形状以仓内实测为准；若与 §1.2 / §1.3 锚点不一致，以实测为准并在偏差表写清原锚点 / 实测值 / 理由。

---

## 4. 红线（违反即返工）

- **engine-core 零改动**：`git diff --stat HEAD -- src/engine-core` 为空；`boundary.spec.ts` 不改。
- **entity 文件零改动**：装饰器 / 列 / 索引 / 类型引用 / 无软删口径保留；migration DDL 不动。
- **方法面纪律**：端口只收现有调用，不扩通用代理；不暴露 typeorm 句柄 / 查询选项 / 操作符；业务层不出现 entity 类名。
- **业务语义冻结**：service 公共签名不变；DTO / controller 路由不变；消息计数 / 已读标记 / 打卡写入 / 今日最新 / 近 N 天曲线 / 物理删除语义不变。
- 隐私：心理对话原文禁止进文档 / 日志 / console / crash report（只出码与计数）；本批日志只打 uid / level / intervention / marked / remaining / 错误名。
- pnpm 命令规范：一律 `pnpm` / `pnpm exec`，禁止裸 `npx`。
- 不新增依赖；不越权加需求外功能；不自动 commit / push。

---

## 5. 闸门（填真实数字，禁止留空）

### 5.0 前置（命令规范，强制）

- 跑闸门前确认机器状态：记录是否有 `nest start --watch` / `vite dev` / `node dist/app` 常驻进程（墙钟可比性以用例数 / 文件数为准，不杀用户进程）；跑 `pnpm doctor:fs` 记录结果。
- 取证会话 PATH 先补 `D:\Apps\Git\cmd`（依赖外部命令的 spec 才不会假失败）。

### 5.1 收尾闸门（本单跑一次，记录真实命令 / exit / 数字）

| 闸门         | 命令                                                                         | 要求                                                                                                                                                       |
| ------------ | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 盘读前置     | `pnpm doctor:fs`                                                             | exit 0，记录均值 ms/文件与 slow 占比                                                                                                                       |
| 根类型       | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`      | 0 error                                                                                                                                                    |
| 构建类型     | `pnpm exec tsc -p tsconfig.build.json --noEmit`                              | 0 error                                                                                                                                                    |
| Lint（权威） | `pnpm lint`                                                                  | 0 error，记录 warning 数（基线既有 1 条 e2e warning，范围外不修）                                                                                          |
| oxlint fast  | `pnpm lint:fast`                                                             | 0 warning / 0 error                                                                                                                                        |
| 定向 spec    | `pnpm exec vitest run test/home/`（新端口替身 spec；位置参数按实际文件调整） | 全绿，记录用例数 / 文件数                                                                                                                                  |
| 全量测试     | `pnpm test`                                                                  | exit 0；既有 **3338 例 / 199 文件**集合不减少、既有断言不改；记录总用例数、文件数、墙钟与机器状态；增量 = 本批新增 spec 用例数                             |
| engine-core  | `git diff --stat HEAD -- src/engine-core`                                    | 空                                                                                                                                                         |
| 范围隔离     | `git diff --name-only HEAD`                                                  | 改动仅限 `src/home/`（本批两个 service + domain + data + module）、`test/home/` 与交付文档；无 package.json / tsconfig / vitest 配置 / CI / 其他业务域改动 |
| 边界         | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                     | 12 passed                                                                                                                                                  |
| 静态复核     | §3.2 四项 grep 证据                                                          | 逐条结果落交付记录                                                                                                                                         |

> 验收侧不重跑全量；执行方交付记录里的闸门数字 + CI 结果作为合并底线。

---

## 6. 交付记录（完成后写，路径固定）

`docs/worklog/completed/phase2.5/td20-home-messages-moodlog-port-c2-batch4-implementation-2026-11-15.md`

内容必须含：

1. 本单做了什么（一句话：home 域两张干净子表按 TD-13 四件套落地双端口，C2 推广第四批）；
2. 改动文件清单（新建 / 修改，逐个一句用途；两端口粒度与排除理由）；
3. 端口方法面清单（接口 / token / 入参 / Row 类型 / 唯一调用方；消息端口无 Row 的偏差说明）；
4. 闸门表：命令 / exit code / 真实数字（error、warning、用例总数、文件数、墙钟与机器状态）；
5. typeorm 符号外泄复核表（受检文件逐个命中数）；
6. service 行为与改前对照表（未读计数 / markRead where 与 affected / 档位校验 / 工厂保存 / 两个时间窗查询条件与排序 / 物理删除 / toOverviewFields 转换）；
7. 边界确认：entity 文件零改动、DTO / controller / constants / 排除 service / 跨域 module import / barrel 导出面 / 其他业务域 / migration / 配置未动；既有测试零改动；
8. 遗留项：§2 另案 C2/G / I / J / K / M / N / P + 观察（`isTerminalPhase` 死代码、根目录 e2e 未收集、本域日期时区口径备注）逐条登记；Actions 侧待复核点（若有）；
9. 一行 commit message 草稿（**不自己 commit / push**，等用户指令）。

---

## 7. 【交付回写清单】做完逐项勾选（硬清单，不许跳）

- [x] 交付记录已写到 §6 固定路径
- [x] 本任务单从 `pending/` 移到 `completed/phase2.5/`，顶部状态行改 ✅ 并链交付记录
- [x] 回写 WP 登记表：`docs/worklog/pending/phase2.5-wp-list-2026-11-08.md` §四 TD-20 行改完成态、补交付记录链接
- [x] 回写阶段入口：`docs/worklog/pending/phase2.5-README.md` §3 TD-20 bullet 改完成态
- [x] 回写台账：`docs/team/gate-performance-remediation-2026-11-11.md` §9 P-DEBT-11 行追加 C2 第四批落地结论 + 链接；更新记录补一条；另案 C2/G/I/J/K/M/N/P + 观察登记口径更新
- [x] `git diff --stat HEAD -- src/engine-core` 为空；`src/migration/` 零改动
- [x] 提交分组核对：本单文件与并行进程产物分开；若授权代提交，stage 只含本单文件
- [x] 给一行 commit message 草稿（**不自己 commit / push**，等用户指令）

---

## 8. 回复输出约定

完成后在对话里：

1. 说一句"已写入交付记录"并附文件路径，不重复贴全文；
2. 报告闸门真实数字（tsc / eslint / vitest 用例数 / boundary）；
3. 报告本单结论一句话（home 双端口完成、spec 零 entity import）+ §7 回写清单哪几项已做、有没有遗留；
4. 不把代码 diff 全文贴进对话，让用户自己 `git diff` / 打开交付记录。

---

_本单不新增第三方依赖；不改 schema / migration；仅 home 域 home_messages + mood_logs 两张子表仓储端口化 + 新增端口替身 spec；engine-core 零 diff；未自动 commit / push。_
