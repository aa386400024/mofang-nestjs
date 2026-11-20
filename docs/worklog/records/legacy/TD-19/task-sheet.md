# TD-19 · C2 第三批仓储端口化（emergency 域 · P-DEBT-11 / L-1 · TD-14 推荐路线第三段 C2 第三批）

> 状态：✅ **已交付**（2026-11-15，MiniMax Code）→ 交付记录：`docs/worklog/completed/phase2.5/td19-emergency-port-c2-batch3-implementation-2026-11-15.md`
> 仓库：E:\Work\Project\backend\mofang-nestjs，分支 integrate，基线 HEAD `bedd702`（TD-18 交付后，与 `origin/integrate` 一致）
> 唯一事实源：`docs/team/gate-performance-remediation-2026-11-11.md` §9 **P-DEBT-11**（L-1）+ `docs/architecture/entity-typeorm-decoupling-assessment-2026-11-14.md`（TD-14 备忘）§5.3 / §6.1 / §6.2 + TD-13 / TD-16 / TD-17 / TD-18 交付记录（四件套模板与先例）
> 任务性质：**实现单（C2 推广第三批）** —— 在 TD-13（analytics）、TD-16（life-map）、TD-17（consent）、TD-18（good_state_diary）四个先例验证过的「仓储端口」模式上，选第五个业务域 **emergency** 按 TD-13 四件套完整复制一遍；本域是 C2 批次里体量最小的一个（1 表 / 1 service / 4 公共方法），且**首个含两处原生 `repo.query()` SQL** 的域，用于把模板压到「raw SQL 读写 + 聚合统计出参」形态上
> 改动范围：`src/emergency/` + `test/emergency/`（新建）+ 交付文档；`engine-core/`、`src/migration/`、配置、CI、其他业务域、前端不碰

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `E:\Work\Project\backend\mofang-nestjs\README.md` —— 仓库总览
2. `E:\Work\Project\backend\mofang-nestjs\docs\README.md` —— 文档导航
3. `E:\Work\Project\backend\mofang-nestjs\docs\team\conventions.md` —— 代码红线 + 交付格式（§1.1 engine-core 分层、§1.3 pnpm 命令规范、§三 16 条硬约束、§2.5 偏差登记）
4. 阶段工作入口：`docs/worklog/pending/phase2.5-README.md` 与 `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md`
5. 根因与既往结论：
   - TD-14 备忘 `docs/architecture/entity-typeorm-decoupling-assessment-2026-11-14.md` §5.3（G 收益口径）、§6.1（C+ / C1 / C2 三段）、§6.2（试点域选择标准与候选排序）
   - TD-18 交付记录 `docs/worklog/completed/phase2.5/td18-good-state-diary-port-c2-batch2-implementation-2026-11-14.md`（最近一个四件套先例：单端口粒度、Row 出参、工厂下沉实现层、替身 spec 结构、typeorm 符号外泄复核、行为对照表、偏差登记）
   - TD-17 交付记录 `docs/worklog/completed/phase2.5/td17-consent-port-c2-batch1-implementation-2026-11-14.md`（最小单端口 + 工厂在实现层先例；本域体量与 consent 最接近）
   - TD-16 交付记录 `docs/worklog/completed/phase2.5/td16-life-map-port-pilot-c1-implementation-2026-11-14.md`（无软删 Row 口径、多端口划分判定先例）
   - TD-13 交付记录 `docs/worklog/completed/phase2.5/td13-repository-port-analytics-pilot-implementation-2026-11-14.md`（四件套结构、端口方法面口径、typeorm 符号外泄复核、偏差登记 D-1 ~ D-7）
   - 端口样板：`src/consent/domain/repositories/consent.repository.ts` + `src/consent/data/consent.repository.typeorm.ts`（单端口 + 工厂在实现层）；`src/good_state_diary/domain/repositories/diary-entry.repository.ts` + `src/good_state_diary/data/diary-entry.repository.typeorm.ts`；`src/life-map/domain/repositories/`（4 端口）；`src/analytics/domain/repositories/analytics-event.repository.ts`
6. 本任务单（就是你在读的这份）

---

## 1. 背景（先读，方向别错）

TD-14 备忘 §6.1 推荐路线分三段：**C+（枚举外移，TD-15 已交付）→ C1（试点域端口化，TD-13 analytics + TD-16 life-map 已交付）→ C2（按域推广，TD-17 consent 第一批、TD-18 good_state_diary 第二批已交付，本单为第三批）**。C2 的任务是把已成型的域级模板逐域复制；每批验收口径按 TD-14 §5.3 修正版执行，**不再以加载图减重为 KPI**。

**模式定义**（沿用 TD-13 四件套）：

1. **端口**：`src/emergency/domain/repositories/emergency-session.repository.ts` —— interface + Symbol DI token + 入参 / Row 类型；零 typeorm 值符号。
2. **TypeORM 实现**：`src/emergency/data/emergency-session.repository.typeorm.ts` —— `@InjectRepository` + `Repository` + QueryBuilder + 两处原生 SQL 全部收在此文件；域内唯一允许出现 typeorm 值符号的业务文件（module 装配层除外）。
3. **module 接线**：provider `{ provide: EMERGENCY_SESSION_REPOSITORY, useClass: EmergencySessionRepositoryTypeorm }`；**保留** `TypeOrmModule.forFeature([EmergencySessionEntity])`；exports 口径按现状（仓储 token 不 export，对齐 TD-13 D-4 / TD-16 / TD-17 / TD-18）。
4. **端口替身 spec**：`test/emergency/td19-emergency-port-c2-batch3.spec.ts` —— 替身只记调用参数 + 返回预设行；不起真 TypeORM、不连 DB、不 `vi.mock('typeorm')`。

### 1.1 域选定：emergency（主控取证锚点，HEAD `bedd702`；执行方复核并登记偏差）

| TD-14 §6.2 选择标准                      | emergency 实测                                                                                                                                                                                                                                                         | 判定 |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1. 扁平表优先（无关系装饰器）            | `EmergencySessionEntity` 关系装饰器 **0**（@ManyToOne / @OneToMany / @ManyToMany / @OneToOne / @JoinColumn / @JoinTable 全 0）                                                                                                                                         | ✅   |
| 2. entity 文件内无枚举                   | 0 内联 `enum`；2 个枚举（`EmergencyToolKind` / `SessionPhase`）已在独立 `enums/emergency.enums.ts` 纯文件；entity 以 `@Column({ enum })` 值引用枚举（装饰器需要枚举值，口径同 TD-15）；无软删列                                                                        | ✅   |
| 3. 无跨模块仓储消费                      | `src/` 其他目录仅 `app.module.ts` 装配 `EmergencyModule`；practice / inner_world / life-map / pii-redactor / migration / voice / engine-adapters 均为注释、路由字符串或 toolId 字符串字面量；无其他 service / entity 值位置引用本域；无外部模块注入 `EmergencyService` | ✅   |
| 4. 引用面小 + module forFeature 单点注册 | 仓储仅被本域 `EmergencyService` 使用；`emergency.module.ts` 单点 `forFeature`；controller 只注入 service，无仓储旁路                                                                                                                                                   | ✅   |
| 5. 已有等价端口先例可抄                  | TD-13 analytics + TD-16 life-map + TD-17 consent + TD-18 good_state_diary 四件套均在仓内                                                                                                                                                                               | ✅   |

**域内构成**：1 张表（`emergency_sessions`）/ 1 个直连仓储的 `EmergencyService`；无 AI service、无 integration 客户端、无第二仓储 service。

### 1.2 emergency 现状清单（主控实测，6 个 `.ts`，**域内 0 个既有 spec**）

| 文件                                                                                        | 现状                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `entities/emergency-session.entity.ts`（`EmergencySessionEntity`，表 `emergency_sessions`） | 扁平：`id`(char36 PK，前端 UUID) / `uid`(char36) / `toolKind`(enum EmergencyToolKind) / `phase`(enum SessionPhase, default IDLE) / `intensityBefore`(tinyint null) / `intensityAfter`(tinyint null) / `stagesCompleted`(int default 0) / `startedAtMs`(bigint, **string**) / `completedAtMs`(bigint null, **string \| null**) / `notes`(text null) / `context`(json null) / `createdAt`(`@CreateDateColumn` datetime6)；索引 `idx_emergency_uid_started`(uid, startedAtMs) + `idx_emergency_uid_tool_started`(uid, toolKind, startedAtMs) + `idx_emergency_phase`(phase)；**无 `@DeleteDateColumn`**；**本单不改 entity 文件** |
| `providers/emergency.service.ts`                                                            | **直连 1 个 Repository**：`@InjectRepository(EmergencySessionEntity) private readonly repo: Repository<EmergencySessionEntity>`；值位置 import entity 类；4 个公共方法 `upsert` / `list` / `getOne` / `getToolStats`；私有 `toDto(row)`；无其他私有仓储方法；`Logger` 只打 uid / id / phase（隐私口径不变）                                                                                                                                                                                                                                                                                                                    |
| `controllers/emergency.controller.ts`                                                       | 只注入 `EmergencyService`；4 端点：`POST /emergency/sessions` / `GET /emergency/sessions` / `GET /emergency/sessions/:id` / `GET /emergency/stats`；无 Repository / entity 旁路；**不改**                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `dto/emergency.dto.ts`                                                                      | `UpsertEmergencySessionDto`（body，无 uid 字段，uid 来自 JWT）/ `EmergencySessionDto`（响应，`startedAtMs` / `completedAtMs` 响应层转 Number）/ `EmergencySessionListDto`（items + total）；不 import entity；**不改**                                                                                                                                                                                                                                                                                                                                                                                                         |
| `enums/emergency.enums.ts`                                                                  | 纯枚举 + 辅助函数：`EmergencyToolKind`（5 成员）/ `SessionPhase`（6 成员）/ `isTerminalPhase(phase)`（**实测全仓 0 调用方**，见 §1.5 观察项）；零 typeorm 依赖；**不改**                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `emergency.module.ts`                                                                       | `forFeature([EmergencySessionEntity])` + imports `UserModule`；providers `EmergencyService`；exports `[EmergencyService]`；controllers `EmergencyController`                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

**test/ 现状**：`test/emergency/` 目录不存在（本单新建）；`test/` 下 4 个 spec 文件字符串匹配到 "emergency"（`engine-adapters/wp14-block-no-llm-start.spec.ts` / `engine-adapters/wp14-student-risk-disposal.spec.ts` / `life-map/td16-life-map-port-pilot.spec.ts` / `voice/wp14-pre-check-gate.spec.ts`），逐条核实均为**断言字面量**（DTO 字段名 `emergency: '120'`、toolId 字符串 `'emergency.safe-island'`），**无 entity / service / module 值位置 import** —— 本域**零既有测试适配面**（比 consent 的 1 处适配还干净）。

### 1.3 仓储调用面（端口方法面只收这些现有调用，不泛化）

`EmergencyService` 现有 **5 处**仓储调用形态（端口方法签名由实现单按 TD-13 D-2 口径设计，出参用 Row / 窄领域类型，登记偏差）：

1. `repo.query(INSERT INTO emergency_sessions (...) VALUES (...) ON DUPLICATE KEY UPDATE ...)`（L37–63）—— **原生 SQL upsert**；参数含 `context === null ? null : JSON.stringify(context)`；`startedAtMs` / `completedAtMs` 入 SQL 前 `.toString()`
2. `repo.findOne({ where: { id: dto.id } })`（L64）—— upsert 后按 **id 单条件**回读；未命中 service 抛 `Error('Emergency session upsert failed id=...')`
3. QB `createQueryBuilder('e')` → `where e.uid = :uid` + 可选 `andWhere started_at_ms >= :since`（sinceMs）+ `orderBy started_at_ms DESC` + `limit(options?.limit ?? 100)` + `getMany()`（L76–81）—— list
4. `repo.findOne({ where: { id, uid } })`（L92）—— getOne，**id + uid 双条件**越权隔离
5. `repo.query(SELECT tool_kind, COUNT(*) sample_count, AVG(intensity_after - intensity_before) avg_intensity_delta, SUM(CASE WHEN phase='completed' THEN 1 ELSE 0 END)*1.0/COUNT(*) completion_rate FROM emergency_sessions WHERE uid=? AND started_at_ms>=? GROUP BY tool_kind ORDER BY tool_kind ASC)`（L129–140）—— **原生聚合 SQL**；返回 snake_case 行，service L141–146 映射 camelCase + `Number(...)` + null 评分兜底

**端口方法面建议**（实现单可调整，须在交付记录写明偏差与理由）：

- `upsert(input: UpsertEmergencySessionInput): Promise<EmergencySessionRow>` —— 调用 #1 + #2；raw upsert 与回读口径下沉实现层；**未命中抛错留 service**（端口返 `Row | null` 或在实现层抛同类错误，二选一并登记；对齐 TD-18 404 判定留 service 的口径优先）
- `findById(id: string, uid?: string): Promise<EmergencySessionRow | null>` —— 合并调用 #2 / #4 两处 findOne；`uid` 可选，传入则加 uid 隔离条件（#4 口径），不传则按 id 单条件（#2 口径）
- `list(uid: string, query?: EmergencySessionListQuery): Promise<EmergencySessionRow[]>` —— 调用 #3；QB 的 uid / sinceMs / orderBy / limit（默认 100）口径下沉实现；**items / total 组装留 service**（`total = rows.length` 是 DTO 层语义）
- `aggregateToolStats(uid: string, sinceMs: number): Promise<EmergencyToolStatRow[]>` —— 调用 #5；raw 聚合 SQL 下沉实现；**windowDays → sinceMs 计算**（`Date.now() - windowDays * 86400000`）留 service；聚合行 snake_case → camelCase + `Number(...)` + null 评分兜底的映射口径下沉实现层（或留 service，二选一并登记，对齐先例 Row 映射下沉实现层的总体口径）

**Row 类型 `EmergencySessionRow` 字段**（entity → Row 映射，窄领域类型，不含 entity 类；本域无软删，**不含 `deletedAt`**）：

```
id: string
uid: string
toolKind: EmergencyToolKind            // 引用 enums/ 纯枚举，非 typeorm 值符号
phase: SessionPhase
intensityBefore: number | null
intensityAfter: number | null
stagesCompleted: number
startedAtMs: string                    // bigint 原生类型（entity 即 string）；响应层 Number 转换留 service toDto
completedAtMs: string | null
notes: string | null
context: Record<string, unknown> | null
createdAt: Date
```

**入参类型**（service 构造，纯对象，不依赖仓储工厂）：

- `UpsertEmergencySessionInput`：`id` / `uid` / `toolKind` / `phase` / `intensityBefore: number | null` / `intensityAfter: number | null` / `stagesCompleted: number` / `startedAtMs: number` / `completedAtMs: number | null` / `notes: string | null` / `context: Record<string, unknown> | null`（bigint 字符串化在实现层完成）
- `EmergencySessionListQuery`：`sinceMs?: number` / `limit?: number`

**第二出参类型**（聚合统计行，无对应 entity）：

```
EmergencyToolStatRow {
  toolKind: string
  sampleCount: number
  avgIntensityDelta: number | null
  completionRate: number
}
```

### 1.4 与 TD-17 / TD-18 / life-map 先例的关键差异（任务单固化，不可照抄先例）

1. **两处原生 `repo.query()` SQL 必须下沉 `data/` 实现层**。本域是 C2 批次首个含 raw SQL 的域：upsert 走 `INSERT ... ON DUPLICATE KEY UPDATE`（TS2345 历史口径见 service L25–34 注释），stats 走 `SELECT ... GROUP BY tool_kind` 聚合。**端口不写 SQL、不暴露 `query` 句柄 / `EntityManager` / 查询选项**；两条 SQL 全文、参数占位、`JSON.stringify(context)` 与 null 兜底、`AVG` NULL 处理、`completion_rate` 除法口径全部保留在实现层，逐字不得改变语义。
2. **Row 不含 `deletedAt`**。本域 entity 无 `@DeleteDateColumn`、无软删 / 恢复 / 擦除路径；Row 口径对齐 life-map（不含软删列），**区别于 TD-18 diary 的 `deletedAt` 保留口径**。
3. **零既有测试适配面**。域内无 src spec；test/ 下 4 个他域 spec 仅字符串断言、无 import 本域；本单**不改动任何既有测试**（区别于 TD-17 的 1 处适配、TD-18 的 2 处适配）。
4. **聚合出参非实体 Row**。`aggregateToolStats` 返回 `EmergencyToolStatRow`（统计行，无对应 entity / 表行映射），端口需第二个窄出参类型；`list` 返 `Row[]`，`total` 计数留 service DTO 层。
5. **module imports `UserModule`**（跨域模块依赖，JWT Guard / CurrentUser 装饰器来自 user 域）；该 import 保留不动。现状 `exports: [EmergencyService]` —— 已 grep 核实无外部模块注入该 service，exports 口径保持现状；**仓储 token 仍不 export**。

### 1.5 遗留观察（不进本单范围，交付记录登记）

- **观察（新）**：`enums/emergency.enums.ts` 的 `isTerminalPhase(phase)` 辅助函数**实测全仓 0 调用方**（死代码）；本单**不删除、不改动** enums 文件，作为另案评估项登记（后续统一梳理未用导出）。
- **观察（沿用 TD-18）**：根目录 e2e 遗留 spec 未被任何 vitest config 收集的测试入口收纳问题，另案评估，本单不清理、不移动、不改 include。

### 1.6 基线闸门（HEAD `bedd702`，TD-18 交付后）

全量 **3318 passed + 4 skipped（3322 例 / 198 文件）**；lint **0 error / 1 warning**（`test/e2e/v2-user-flow.spec.ts:1` 既有 unused eslint-disable，范围外不修）；lint:fast **0 / 0**；boundary **12 passed**；根 tsc / build tsc **0 error**；`git diff --stat HEAD -- src/engine-core` 为空。

本域定向实测（取证会话）：域内无既有 spec；`test/emergency/` 目录不存在；新端口替身 spec 为本单唯一新增测试文件。

---

## 2. 范围（严格遵守，不越权）

### 在范围内

1. **端口文件**：`src/emergency/domain/repositories/emergency-session.repository.ts`（interface + Symbol token + 入参 / Row / 统计行类型）。
2. **TypeORM 实现**：`src/emergency/data/emergency-session.repository.typeorm.ts`；`@InjectRepository` / `Repository` / QueryBuilder / 两处 raw SQL 等 typeorm 值符号只允许出现在实现文件与 module 装配层。
3. **EmergencyService** 改依赖端口（直连 Repository 抽出）；私有 `toDto(row)` 的 entity 类型签名替换为 `EmergencySessionRow`；service 不再值位置 import entity 类（枚举 import 保留，枚举是纯文件、非 typeorm 值符号）。
4. **module 接线**：新增端口 provider；保留 `forFeature([EmergencySessionEntity])` 与 `UserModule` import；exports 保持现状（仓储 token 不 export）。
5. **service 公共签名不变**：`upsert(uid, dto)` / `list(uid, options?)` / `getOne(uid, id)` / `getToolStats(uid, windowDays?)` 四个方法签名、返回 DTO 形状逐字保持。
6. **端口替身 spec**：`test/emergency/` 新增（工作项前缀 + 端口语义，对齐 TD-13 D-1 / TD-16 / TD-17 / TD-18 命名）；替身记调用参数 + 返回预设行；**spec 零 entity import**；不起真 TypeORM、不连 DB、不 `vi.mock('typeorm')`。
7. **文档与索引回写**（§7 清单）。

### 明确不在范围内（禁止顺手做）

- **entity 文件一字不改**：字段、装饰器、列、索引、枚举引用、无软删口径全部保留；DTO、controller、路由、业务语义不动；enums 文件不动（含 §1.5 死函数）。
- 本域无 `index.ts` barrel；顶层 `src/index.ts` barrel 的 entity 类值导出边归另案 **M**，本单不删导出、不改对外面。
- 不做 Row 纯类型持久化分层映射的其他推广；不做 EntitySchema / 纯类改造；不补端口内存实现（另案 **I**）。
- 端口方法面只收 §1.3 现有 5 处调用；**不扩通用仓储代理**、不暴露 typeorm 管理句柄 / 查询选项 / 操作符；端口不写 SQL（raw SQL 只下沉在 `data/` 实现）；端口 / service / spec 不暴露 entity 类名。
- 其他业务域零改动；`src/migration/` 零改动（`1714900000001-AddEmergencySessions.ts` 已在 `migration/index.ts` L34 注册）；不改 package.json / tsconfig / `vitest.config.mts` / `test/vitest.e2e.mts` / CI / Dockerfile；不新增第三方依赖；不碰 `admin-dashboard/` 与 Flutter。
- 既有 spec 断言 / mock 语义零改动；其他域 spec 不新增、不修改。
- 不自动 git commit / push（写完给 commit 草稿，等用户指令）。

### 另案登记（本单不做，写入交付记录遗留段）

- **C2 / G**：其余域仓储端口化分批推广；每批验收口径 = 「service 源码层 typeorm 值符号 0 命中」+「该批 spec 值位置 entity import = 0」（TD-14 备忘 §5.3，不再以加载图减重为 KPI）。后续批次候选：home / inner_world / ai-engine → companion → profile / user / counselor。
- **I**：端口内存实现是否补（本单不补；spec 替身已覆盖替身需求）。
- **J**：混合形态 typeorm import 统一形态（可读性向、零运行时收益，另案批量处理）。
- **K**：`bin/ormconfig.ts` 的 `entities` glob 口径脱节（独立既有债，沿用 TD-14 登记）。
- **M**：entity 类值位置边 —— 本域 service 值位置 entity import 归零；顶层 barrel `export *` 残留的 entity 类导出边归 C2/G 推广时闭合。
- **N**："枚举 / 端口文件零 typeorm 依赖"静态守护 spec（本单不新增；守护证据走 grep 复核 + lint）。
- **P**：consent 失败容忍语义未落地（TD-17 另案，沿用登记，与本域无关）。
- **观察（新）**：`isTerminalPhase` 全仓 0 调用方（死代码），另案评估是否删除；本单不动 enums。
- **观察（沿用 TD-18）**：根目录 e2e 遗留 spec 未被任何 config 收集；测试入口收纳另案评估。

---

## 3. 目标交付物

### 3.1 代码改动

- 端口文件 + TypeORM 实现文件（`domain/repositories/` + `data/`）；`emergency.module.ts` provider 接线；`EmergencyService` 依赖改端口；新增端口替身 spec。
- 业务行为零漂移：uid 越权隔离（getOne 读写显式带 uid；upsert 回读按 id 与现状一致）；raw upsert 的 `ON DUPLICATE KEY UPDATE` 刷新字段集（phase / intensity_before / intensity_after / stages_completed / completed_at_ms / notes / context）与现状逐字一致；`context` null → SQL NULL、非 null → `JSON.stringify`；list 的 sinceMs 过滤 / `started_at_ms DESC` / limit 默认 100；stats 的 30 天窗口（windowDays→sinceMs 留 service）/ GROUP BY tool_kind / `AVG` NULL 兜底 / completionRate 分母口径；DTO 转换（响应层 `Number(...)` 时间戳、items + total 组装）逐字不变。

### 3.2 静态复核证据（grep 复核，结果落交付记录）

1. **typeorm 符号外泄**：端口文件、service、新 spec 三个受检面，`Repository` / `Between` / `FindOptions` / `EntityManager` / `from 'typeorm'` / `from '@nestjs/typeorm'` 值符号 **0 命中**（注释文案也避开 typeorm 字面量，对齐 TD-13 D-5）；命中只允许在 `data/` 实现文件与 module 装配层。
2. **spec 零 entity import**：新 spec 对 `entities/` 路径的 entity 类 import = **0**。
3. **service 值位置 entity import = 0**：`emergency.service.ts` 不再值位置 import entity 类（枚举 import 保留，枚举是纯文件、非 typeorm 值符号）。
4. **方法面不泛化**：端口方法与 §1.3 调用面一一对应（4 方法 / 5 处调用）；新 spec 用例显式断言调用次数与参数；无新增通用 `findAll` / `updateById` 之类代理方法。

### 3.3 交付记录（§6 固定路径）

含改动清单、端口方法面清单、typeorm 符号外泄复核表、service 行为与改前对照表（uid 隔离 / upsert 刷新字段集 / context 序列化兜底 / list 过滤排序上限 / stats 窗口与聚合口径 / null 评分兜底 / DTO 转换）、偏差登记（conventions §2.5）、边界确认、遗留另案。

> **口径真相源**：调用面与出参形状以仓内实测为准；若与 §1.2 / §1.3 锚点不一致，以实测为准并在偏差表写清原锚点 / 实测值 / 理由。

---

## 4. 红线（违反即返工）

- **engine-core 零改动**：`git diff --stat HEAD -- src/engine-core` 为空；`boundary.spec.ts` 不改。
- **entity 文件零改动**：装饰器 / 列 / 索引 / 枚举引用 / 无软删口径保留；migration DDL 不动。
- **方法面纪律**：端口只收现有调用，不扩通用代理；不暴露 typeorm 句柄 / 查询选项 / 操作符；业务层不出现 entity 类名。
- **业务语义冻结**：service 公共签名不变；DTO / controller 路由不变；upsert / list / getOne / stats 语义不变。
- 隐私：心理对话原文禁止进文档 / 日志 / console / crash report（只出码与计数）；本域日志只打 id / uid / phase / 计数 / 错误名。
- pnpm 命令规范：一律 `pnpm` / `pnpm exec`，禁止裸 `npx`。
- 不新增依赖；不越权加需求外功能；不自动 commit / push。

---

## 5. 闸门（填真实数字，禁止留空）

### 5.0 前置（命令规范，强制）

- 跑闸门前确认机器状态：记录是否有 `nest start --watch` / `vite dev` / `node dist/app` 常驻进程（墙钟可比性以用例数 / 文件数为准，不杀用户进程）；跑 `pnpm doctor:fs` 记录结果。
- 取证会话 PATH 先补 `D:\Apps\Git\cmd`（依赖外部命令的 spec 才不会假失败）。

### 5.1 收尾闸门（本单跑一次，记录真实命令 / exit / 数字）

| 闸门         | 命令                                                                              | 要求                                                                                                                           |
| ------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 盘读前置     | `pnpm doctor:fs`                                                                  | exit 0，记录均值 ms/文件与 slow 占比                                                                                           |
| 根类型       | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`           | 0 error                                                                                                                        |
| 构建类型     | `pnpm exec tsc -p tsconfig.build.json --noEmit`                                   | 0 error                                                                                                                        |
| Lint（权威） | `pnpm lint`                                                                       | 0 error，记录 warning 数（基线既有 1 条 e2e warning，范围外不修）                                                              |
| oxlint fast  | `pnpm lint:fast`                                                                  | 0 warning / 0 error                                                                                                            |
| 定向 spec    | `pnpm exec vitest run test/emergency/`（新端口替身 spec；位置参数按实际文件调整） | 全绿，记录用例数 / 文件数                                                                                                      |
| 全量测试     | `pnpm test`                                                                       | exit 0；既有 **3322 例 / 198 文件**集合不减少、既有断言不改；记录总用例数、文件数、墙钟与机器状态；增量 = 本单新增 spec 用例数 |
| engine-core  | `git diff --stat HEAD -- src/engine-core`                                         | 空                                                                                                                             |
| 范围隔离     | `git diff --name-only HEAD`                                                       | 改动仅限 `src/emergency/`、`test/emergency/` 与交付文档；无 package.json / tsconfig / vitest 配置 / CI / 其他业务域改动        |
| 边界         | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                          | 12 passed                                                                                                                      |
| 静态复核     | §3.2 四项 grep 证据                                                               | 逐条结果落交付记录                                                                                                             |

> 验收侧不重跑全量；执行方交付记录里的闸门数字 + CI 结果作为合并底线。

---

## 6. 交付记录（完成后写，路径固定）

`docs/worklog/completed/phase2.5/td19-emergency-port-c2-batch3-implementation-2026-11-15.md`

内容必须含：

1. 本单做了什么（一句话：emergency 域按 TD-13 四件套落地仓储端口，C2 推广第三批）；
2. 改动文件清单（新建 / 修改，逐个一句用途；端口粒度与理由）；
3. 端口方法面清单（接口 / token / 入参 / Row 类型 / 统计行类型 / 唯一调用方）；
4. 闸门表：命令 / exit code / 真实数字（error、warning、用例总数、文件数、墙钟与机器状态）；
5. typeorm 符号外泄复核表（受检文件逐个命中数）；
6. service 行为与改前对照表（uid 隔离 / upsert 刷新字段集 / context 序列化与 null 兜底 / list 过滤排序上限 / stats 窗口与 GROUP BY 聚合 / AVG NULL 兜底 / completionRate 分母 / DTO 转换与响应层 Number 转换）；
7. 边界确认：entity 文件零改动、DTO / controller / enums / UserModule import / barrel 导出面 / 其他业务域 / migration / 配置未动；既有测试零改动；
8. 遗留项：§2 另案 C2/G / I / J / K / M / N / P + 观察（`isTerminalPhase` 死函数、根目录 e2e 未收集）逐条登记；Actions 侧待复核点（若有）；
9. 一行 commit message 草稿（**不自己 commit / push**，等用户指令）。

---

## 7. 【交付回写清单】做完逐项勾选（硬清单，不许跳）

- [x] 交付记录已写到 §6 固定路径
- [x] 本任务单从 `pending/` 移到 `completed/phase2.5/`，顶部状态行改 ✅ 并链交付记录
- [x] 回写 WP 登记表：`docs/worklog/pending/phase2.5-wp-list-2026-11-08.md` §四 TD-19 行改完成态、补交付记录链接
- [x] 回写阶段入口：`docs/worklog/pending/phase2.5-README.md` §3 TD-19 bullet 改完成态
- [x] 回写台账：`docs/team/gate-performance-remediation-2026-11-11.md` §9 P-DEBT-11 行追加 C2 第三批落地结论 + 链接；更新记录补一条；另案 C2/G/I/J/K/M/N/P + 观察登记口径更新
- [x] `git diff --stat HEAD -- src/engine-core` 为空；`src/migration/` 零改动
- [x] 提交分组核对：本单文件与并行进程产物分开；若授权代提交，stage 只含本单文件
- [x] 给一行 commit message 草稿（**不自己 commit / push**，等用户指令）

---

## 8. 回复输出约定

完成后在对话里：

1. 说一句"已写入交付记录"并附文件路径，不重复贴全文；
2. 报告闸门真实数字（tsc / eslint / vitest 用例数 / boundary）；
3. 报告本单结论一句话（emergency 端口化完成、spec 零 entity import）+ §7 回写清单哪几项已做、有没有遗留；
4. 不把代码 diff 全文贴进对话，让用户自己 `git diff` / 打开交付记录。

---

_本单不新增第三方依赖；不改 schema / migration；仅 emergency 域仓储端口化 + 新增端口替身 spec；engine-core 零 diff；未自动 commit / push。_
