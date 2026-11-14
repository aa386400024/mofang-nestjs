# TD-19 · C2 第三批仓储端口化（emergency 域）— 交付记录

- **状态**：✅ 已交付（2026-11-15）
- **基线 HEAD**：`bedd702`（TD-18 交付后，与 `origin/integrate` 一致）
- **任务单**：`docs/worklog/pending/td19-emergency-port-c2-batch3-task-2026-11-15.md` → 归档至 `docs/worklog/completed/phase2.5/`
- **债务条目**：P-DEBT-11 / L-1（技术债台账 §9）
- **路线**：TD-14 备忘推荐路线 C 三段之第三段 **C2（按域推广）第三批** —— C+（TD-15）→ C1（TD-13 analytics + TD-16 life-map）→ C2 第一批（TD-17 consent）→ C2 第二批（TD-18 good_state_diary）→ **C2 本单：emergency 域（第五个业务域，把域级模板压到「raw SQL 读写 + 聚合统计出参」形态）**

---

## 一、本单做了什么（一句话）

emergency 域按 TD-13 四件套落地仓储端口 —— **1 个端口**（interface + Symbol token + `EmergencySessionRow` 出参 + `EmergencyToolStatRow` 聚合统计行 + 写入 / 查询入参类型，方法面 **4** 个）+ **1 个 TypeORM 实现**（收进 `src/emergency/data/`，**两条原生 SQL 与全部查询口径下沉**）+ **module 接线** + **端口替身 spec（16 例，零 entity import）**，且**零既有测试适配面**（本域及他域 spec 均零改动）。

---

## 二、改动文件清单

### 2.1 新增（3 个文件）

| 文件                                                                | 用途                                                                                                                                                                                                                   |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/emergency/domain/repositories/emergency-session.repository.ts` | `EmergencySessionRepository` interface + `EmergencySessionRow` / `EmergencyToolStatRow` / `UpsertEmergencySessionInput` / `EmergencySessionListQuery` + DI token `EMERGENCY_SESSION_REPOSITORY`；**零 typeorm 值符号** |
| `src/emergency/data/emergency-session.repository.typeorm.ts`        | `EmergencySessionRepositoryTypeorm` —— emergency 域**唯一**允许出现 typeorm 值符号的业务文件（module 装配层除外）；**两条原生 SQL + QB 列表口径全部下沉**                                                              |
| `test/emergency/td19-emergency-port-c2-batch3.spec.ts`              | 端口替身 spec，**16 例**（A1-A16），零 entity import、零 typeorm 值符号、不起真 TypeORM / 不连 DB / 不 `vi.mock('typeorm')`                                                                                            |

### 2.2 修改（2 个文件）

| 文件                                           | 改动                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/emergency/providers/emergency.service.ts` | 构造参数由 `@InjectRepository(EmergencySessionEntity) repo: Repository<EmergencySessionEntity>` 改为 `@Inject(EMERGENCY_SESSION_REPOSITORY) repo: EmergencySessionRepository`；typeorm 值导入与 entity 值位置 import 全撤；**两条原生 SQL 从 service 移出**；私有 `toDto` 的 entity 类型签名换 `EmergencySessionRow`；**4 个公共方法签名与返回 DTO 形状逐字不变** |
| `src/emergency/emergency.module.ts`            | 新增 `{ provide: EMERGENCY_SESSION_REPOSITORY, useClass: EmergencySessionRepositoryTypeorm }` provider；**保留** `TypeOrmModule.forFeature([EmergencySessionEntity])` 与 `UserModule` import；`exports: [EmergencyService]` **不变**（仓储 token 不 export）                                                                                                      |

### 2.3 删除

无。

### 2.4 零改动确认

- `src/emergency/entities/emergency-session.entity.ts` —— **一字未改**（12 字段 / 3 索引 / 枚举列引用 / 无软删口径全保留）
- `src/emergency/dto/emergency.dto.ts`、`src/emergency/controllers/emergency.controller.ts`、`src/emergency/enums/emergency.enums.ts`（含 `isTerminalPhase` 死函数）—— 零改动
- `src/migration/`（含 `1714900000001-AddEmergencySessions.ts`，已在 `migration/index.ts` 注册）—— 零改动
- `src/engine-core/` —— 零改动（boundary 12 绿，`git diff --stat HEAD -- src/engine-core` 为空）
- **既有测试零改动**：域内无 src spec；`test/` 下 4 个他域 spec 仅字符串断言（DTO 字段名 / toolId 字面量），grep 核实**无 entity / service / module 值位置引用** → 本单**未动任何既有测试文件**
- 其他业务域 / `package.json` / `tsconfig*.json` / `vitest.config.mts` / `test/vitest.e2e.mts` / CI / Dockerfile / `admin-dashboard/` / Flutter —— 零改动
- 未新增第三方依赖

---

## 三、端口方法面清单

### 3.1 端口划分粒度判定：**单端口**（1 张表 / 1 个 service / 5 处调用同表）

emergency 域只有 1 张表（`emergency_sessions`）、1 个直连仓储的 service（`EmergencyService`），5 处仓储调用全部落在同一张表上；拆成多端口只会把同一张表的查询口径切碎、面反而变宽（对齐 TD-13 D-2「面窄才守得住」）。与 TD-16 life-map 的 4 端口判定不冲突 —— 那里是 4 张表、4 套互不相同的口径；与 TD-17 consent / TD-18 good_state_diary 同为单端口。

### 3.2 5 处既有调用 → 4 个端口方法（任务单 §1.3 锚点，逐条对齐）

| 改前调用（HEAD `bedd702`）                                                       | 改后端口方法                                                  | 口径                                                                  |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------- |
| ① `repo.query(INSERT ... ON DUPLICATE KEY UPDATE ...)`（L37-63，raw upsert）     | `upsert(input: UpsertEmergencySessionInput)`                  | SQL **全文逐字**下沉实现层；入参由 service 以纯对象构造               |
| ② `repo.findOne({ where: { id: dto.id } })`（L64，upsert 后回读，**id 单条件**） | ↑ 同一 `upsert` 方法内的回读（实现层调 `findById(input.id)`） | 回读未命中**返 null**，抛错判定留 service                             |
| ③ QB `createQueryBuilder('e')`（L76-81，list）                                   | `list(uid, query?: EmergencySessionListQuery)`                | uid / sinceMs 过滤 / `started_at_ms DESC` / limit（默认 100）口径下沉 |
| ④ `repo.findOne({ where: { id, uid } })`（L92，getOne，**id + uid 双条件**）     | `findById(id: string, uid?: string)`                          | 传 uid → 双条件（越权隔离）；不传 → id 单条件                         |
| ⑤ `repo.query(SELECT ... GROUP BY tool_kind ...)`（L129-140，raw 聚合）          | `aggregateToolStats(uid: string, sinceMs: number)`            | 聚合 SQL 全文下沉 + snake_case→camelCase + 数值化映射下沉实现层       |

> 5 处调用 → 4 个方法：① 与 ② 合并为 `upsert`（写 + 回读同一次业务动作），③ / ④ / ⑤ 一一对应。**未新增任何通用代理方法**（无 `findAll` / `updateById` 之类）。

### 3.3 类型清单

| 类型                           | 角色           | 说明                                                                                            |
| ------------------------------ | -------------- | ----------------------------------------------------------------------------------------------- |
| `EmergencySessionRepository`   | 端口 interface | 4 个方法，唯一调用方 `EmergencyService`                                                         |
| `EMERGENCY_SESSION_REPOSITORY` | DI token       | `Symbol('EMERGENCY_SESSION_REPOSITORY')`；module provider 绑定，**不 export**                   |
| `EmergencySessionRow`          | 出参           | 12 字段窄领域类型；**不含 `deletedAt`**（本域无软删列，对齐 life-map 口径，区别于 TD-18 diary） |
| `EmergencyToolStatRow`         | 第二出参       | 聚合统计行（4 字段）：`toolKind` / `sampleCount` / `avgIntensityDelta` / `completionRate`       |
| `UpsertEmergencySessionInput`  | 写入入参       | 11 字段；`startedAtMs` / `completedAtMs` 在入参里是 **number**，bigint 字符串化在实现层完成     |
| `EmergencySessionListQuery`    | 查询入参       | `sinceMs?: number` / `limit?: number`（缺省 = 不过滤 / 实现层默认 100）                         |

---

## 四、闸门表（真实数字，exit code 实测）

**机器状态（闸门前后各查一次，5 个 node 常驻进程，未杀用户进程）**：PID 12992 `pnpm start:dev` · PID 14612 `nest start --watch` · PID 20740 `pnpm dev`（admin-dashboard）· PID 7860 `vite`（admin-dashboard）· PID 7264 `node --enable-source-maps dist/app`。全程有 watch / vite / dist 常驻进程占用 CPU，墙钟可比性以**用例数 / 文件数**为准。

| 闸门         | 命令                                                                     | exit | 实测数字                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 盘读前置     | `pnpm doctor:fs`                                                         | 0    | walk 39 ms · cold 33 ms slow 0 · warm 27 ms slow 0 · **per-file 均值 0.13 ms/文件** · 判定「合格（读取延迟正常，闸门数字可信）」                              |
| 根类型       | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`  | 0    | **0 error**                                                                                                                                                   |
| 构建类型     | `pnpm exec tsc -p tsconfig.build.json --noEmit`                          | 0    | **0 error**                                                                                                                                                   |
| Lint（权威） | `pnpm lint`                                                              | 0    | **0 error / 1 warning**（`test/e2e/v2-user-flow.spec.ts:1` 既有 unused eslint-disable，基线既有、范围外未修）                                                 |
| oxlint fast  | `pnpm lint:fast`                                                         | 0    | **0 warning / 0 error**                                                                                                                                       |
| 定向 spec    | `pnpm exec vitest run test/emergency/`                                   | 0    | **1 文件 / 16 例全绿**，772 ms                                                                                                                                |
| 全量测试     | `pnpm test`                                                              | 0    | **198 passed + 1 skipped（199 文件）· 3334 passed + 4 skipped（3338 例）**，Start 02:18:32，**Duration 94.13 s**                                              |
| engine-core  | `git diff --stat HEAD -- src/engine-core`                                | 0    | **空**（零 diff）                                                                                                                                             |
| migration    | `git diff --stat HEAD -- src/migration/`                                 | 0    | **空**（零 diff）                                                                                                                                             |
| 范围隔离     | `git diff --name-only HEAD` + `git ls-files --others --exclude-standard` | 0    | 本单改动 = 3 新增（端口 / 实现 / 新 spec）+ 2 修改（service / module）+ 交付文档；另有主控 / TD-18 遗留产物（3 归档 relay ?? + 3 索引文档 M），**不纳入本单** |
| 边界         | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                 | 0    | **12 passed**                                                                                                                                                 |

**全量口径对比**：基线 **3318 passed + 4 skipped（3322 例 / 198 文件）** → 本单 **3334 passed + 4 skipped（3338 例 / 199 文件）**，净增 **+16 例 / +1 文件**，**增量 = 本单新增 spec 的 16 例**，既有 3322 例**一条不减**。

---

## 五、typeorm 符号外泄复核表（§3.2 静态复核四项）

**受检面 3 个文件**（端口 / service / 新 spec），grep 模式：`Repository<` · `Between` · `FindOptions` · `EntityManager` · `from 'typeorm'` · `from '@nestjs/typeorm'` · `@InjectRepository` · `getRepositoryToken` · `createQueryBuilder` · `SelectQueryBuilder` · `repo.query`。

| 受检文件                                                            | 命中数 |
| ------------------------------------------------------------------- | ------ |
| `src/emergency/domain/repositories/emergency-session.repository.ts` | **0**  |
| `src/emergency/providers/emergency.service.ts`                      | **0**  |
| `test/emergency/td19-emergency-port-c2-batch3.spec.ts`              | **0**  |

> **宽模式 `Repository` 的命中归因**（避免误读）：命中项全部是自研命名 —— 端口 interface 名 `EmergencySessionRepository`（service + 替身 spec 各 1 处）。**typeorm 的 `Repository` 类符号（`Repository<...>` 泛型标注 / `import { Repository } from 'typeorm'` / `@InjectRepository` / `getRepositoryToken` / 原生查询句柄）0 命中**。typeorm 值符号只落 2 处：`src/emergency/data/emergency-session.repository.typeorm.ts`（实现层）+ `emergency.module.ts`（装配层 `forFeature`）。

**四项静态复核结论**：

1. **typeorm 符号外泄** = 上表 3 个受检面**全部 0 命中** ✅
2. **spec 零 entity import** = 新 spec 对 `entities/` 路径 / 实体类名的引用 **0** ✅
3. **service 值位置 entity import = 0** = `emergency.service.ts` 内实体类名与 `entities/` 路径引用 **0**（含注释：原 TS2345 说明里的实体类名已改为 `_QueryDeepPartialEntity<…>`，语义不变）✅
4. **方法面不泛化** = 端口恰 **4** 个方法，与 §1.3 调用面一一对应；新 spec **A15** 显式断言 `Object.keys(double.repo).sort()` 恰为那 4 个名字 ✅

**另两项开工取证**（任务单 §1.2 / §1.5 锚点复核）：

- `isTerminalPhase` 全仓 grep = **1 处命中（仅自身定义）** → 确认 **0 调用方**（死代码观察项成立）
- `test/` 下 4 个他域 spec 提到 emergency，但 grep `EmergencySessionEntity` / `EmergencyService` / 本域路径 import = **0** → 确认**零既有测试适配面**

---

## 六、service 行为与改前对照表（业务语义零漂移）

| 行为点                     | 改前（HEAD `bedd702`）                                                                                                                                   | 改后                                                             | 判定               |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------ |
| getOne uid 越权隔离        | `repo.findOne({ where: { id, uid } })`                                                                                                                   | 端口 `findById(id, uid)` → 实现层同一 id+uid 双条件              | 逐字一致           |
| upsert 回读口径            | `repo.findOne({ where: { id: dto.id } })`（**id 单条件，不带 uid**）                                                                                     | 实现层 `upsert` 内部 `findById(input.id)`（uid 不传）→ id 单条件 | 逐字一致           |
| upsert SQL 字段集          | INSERT 11 列（id / uid / tool_kind / phase / intensity_before / intensity_after / stages_completed / started_at_ms / completed_at_ms / notes / context） | 同 11 列，全文逐字搬到实现层                                     | 逐字一致           |
| ON DUPLICATE KEY 刷新集    | 7 列（phase / intensity_before / intensity_after / stages_completed / completed_at_ms / notes / context）                                                | 同 7 列、全文逐字                                                | 逐字一致           |
| bigint 字符串化            | `startedAtMs.toString()` / `completedAtMs?.toString() ?? null`                                                                                           | 同（实现层；入参为 number，端口不承载 DB 类型）                  | 逐字一致           |
| context 序列化与 null 兜底 | `context === null ? null : JSON.stringify(context)`                                                                                                      | 同（实现层；入参透传，序列化语义未变）                           | 逐字一致           |
| list uid 过滤              | QB `where e.uid = :uid`                                                                                                                                  | 实现层同一 where                                                 | 逐字一致           |
| list sinceMs 过滤          | 可选 `andWhere e.started_at_ms >= :since`（`since.toString()`）                                                                                          | 实现层同一（`query.sinceMs.toString()`，仅 when defined 才加）   | 逐字一致           |
| list 排序                  | `orderBy e.started_at_ms DESC`                                                                                                                           | 实现层同一                                                       | 逐字一致           |
| list 条数上限              | `limit(options?.limit ?? 100)`                                                                                                                           | 实现层 `limit(query?.limit ?? 100)`（常量随口径下沉）            | 逐字一致           |
| items + total 组装         | service 组装（`total = rows.length`）                                                                                                                    | 留 service（total 属 DTO 层语义）                                | 逐字一致           |
| stats 窗口换算             | service 算 `sinceMs = Date.now() - windowDays * 86400000`（默认 30 天）                                                                                  | 留 service（口径不动）                                           | 逐字一致           |
| stats 聚合 SQL             | SELECT tool_kind / COUNT(*) / AVG(...) / SUM(CASE ...)_1.0/COUNT(_) ... GROUP BY tool_kind ORDER BY tool_kind ASC                                        | 全文搬到实现层                                                   | 逐字一致           |
| stats 参数                 | `[uid, sinceMs.toString()]`                                                                                                                              | 同                                                               | 逐字一致           |
| 聚合行映射                 | service 侧 snake_case→camelCase + `Number(...)` + null 评分兜底                                                                                          | **下沉实现层**（语义逐字不变）                                   | 位置变更，语义一致 |
| upsert 回读未命中          | service 抛 `Error('Emergency session upsert failed id=...')`                                                                                             | 端口返 null → service 抛**同一** Error（判定留 service）         | 逐字一致           |
| DTO 转换                   | `toDto(entity)`：`Number(startedAtMs)` / completedAtMs null 判定 / createdAt 直传                                                                        | `toDto(row)` 字段与转换逻辑逐字相同                              | 逐字一致           |
| 日志口径                   | `logger.debug('upsert emergency uid=... id=... phase=...')`（回读成功之后、DTO 转换之前）                                                                | 同（位置与文案不变）                                             | 逐字一致           |

**两条原生 SQL 的「逐字」审计锚点**（改前 service L37-63 / L129-140 → 改后实现层，SQL 文本与参数逐字一致）：

```
INSERT INTO emergency_sessions
  (id, uid, tool_kind, phase, intensity_before, intensity_after,
   stages_completed, started_at_ms, completed_at_ms, notes, context)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
  phase = VALUES(phase),
  intensity_before = VALUES(intensity_before),
  intensity_after = VALUES(intensity_after),
  stages_completed = VALUES(stages_completed),
  completed_at_ms = VALUES(completed_at_ms),
  notes = VALUES(notes),
  context = VALUES(context)
```

```
SELECT
  tool_kind,
  COUNT(*) AS sample_count,
  AVG(intensity_after - intensity_before) AS avg_intensity_delta,
  SUM(CASE WHEN phase = 'completed' THEN 1 ELSE 0 END) * 1.0 / COUNT(*) AS completion_rate
FROM emergency_sessions
WHERE uid = ? AND started_at_ms >= ?
GROUP BY tool_kind
ORDER BY tool_kind ASC
```

---

## 七、边界确认

- **engine-core 零改动**：`git diff --stat HEAD -- src/engine-core` 为空；`boundary.spec.ts` 零改动，**12 绿**。
- **entity 文件零改动**：`emergency-session.entity.ts` 12 字段 / 3 索引 / 枚举列引用 / 无软删口径全保留；migration DDL 不动。
- **DTO / controller / enums / UserModule import / barrel 导出面**：零改动；4 个端点（POST /emergency/sessions · GET /emergency/sessions · GET /emergency/sessions/:id · GET /emergency/stats）路由与限流不变；`enums/emergency.enums.ts`（含 `isTerminalPhase`）零改动。
- **其他业务域**：零改动；`src/migration/` 零改动；配置 / CI / Dockerfile / 前端零改动；未新增第三方依赖。
- **既有测试零改动**：本域无 src spec；他域 4 个提及 emergency 的 spec 仅字符串断言、无本域 import → **本单未动任何既有测试文件**（区别于 TD-17 的 1 处、TD-18 的 2 处适配）。
- **零压红线**：本单不涉及自由练习（practice）评分口径。
- **隐私红线**：交付记录与 spec 内**无任何用户急救会话原文 / notes 原文**，一律用占位字面量（`notes: 'note'` / `context: { client: 'android' }` 等合成串）；本域日志仍只打 uid / id / phase（debug 级），未新增日志。
- **命令边界**：一律 `pnpm` / `pnpm exec`，未用裸 `npx`；未新增依赖；未改 `package.json` / `tsconfig` / vitest 配置 / CI。
- **提交边界**：**未自动 commit / push**，只给 commit message 草稿（§十）。

---

## 八、偏差登记（conventions §2.5）

| 编号 | 原锚点（任务单 / 仓内）                                                       | 实测 / 处置                                                                                                                 | 理由                                                                         |
| ---- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| D-1  | 任务单 §1.3：`upsert(input): Promise<EmergencySessionRow>`（非空）            | 端口出参取 **`Promise<EmergencySessionRow                                                                                   | null>`**                                                                     | 任务单「待决策点」明确「端口返 null 由 service 抛错（**优先**，对齐 TD-18 口径）」；抛点与错误文案留在 service，实现层不构造错误 → 业务语义位置不变 |
| D-2  | 任务单 §1.3：`findById(id, uid?)` 合并调用 #2 / #4                            | **按原锚点实现**：upsert 回读走「id 单条件」（uid 不传）、getOne 走「id + uid 双条件」，一个方法两种读法；对外仍是 4 个方法 | 与改前两处 findOne 的条件差异逐字对应，不新增第三个读法                      |
| D-3  | 任务单待决策点：聚合行 snake_case→camelCase + Number 转换**二选一**           | **下沉实现层**（端口出参 `EmergencyToolStatRow` 已是 camelCase + number）                                                   | 对齐 TD-18 先例的「entity→Row 映射在实现层」总体口径；service 保持零映射职责 |
| D-4  | 改前 service 注释含实体类名 `_QueryDeepPartialEntity<EmergencySessionEntity>` | 注释内实体类名改为 `_QueryDeepPartialEntity<…>`（TS2345 历史说明语义保留）                                                  | §3.2 / 红线要求「业务层不出现 entity 类名」；注释文案亦受该约束              |
| D-5  | 改前 service 内字面量 `options?.limit ?? 100`                                 | 默认上限常量随口径下沉为实现层 `DEFAULT_LIST_LIMIT = 100`                                                                   | limit 上限属查询口径（与 QB 一同下沉），对齐 TD-18 D-4 同款处置              |
| D-6  | 任务单 §1.3 建议把 #2 单独列为一个端口方法                                    | **未单列**：回读并入 `upsert`（写 + 回读是一次业务动作）；对外方法面仍 4 个                                                 | 单端口粒度下拆开会得到「只回读不写」的窄代理方法，反而泛化口径               |

---

## 九、遗留项

### 9.1 另案（沿用）

- **C2 / G**：其余域仓储端口化分批推广；每批验收口径 = 「service 源码层 typeorm 值符号 0 命中」+「该批 spec 值位置 entity import = 0」（TD-14 备忘 §5.3，**不再以加载图减重为 KPI**）。后续批次候选：**home / inner_world / ai-engine → companion → profile / user / counselor**。**C2 第三批（本单）已完成**。
- **I**：端口内存实现是否补（本单不补；spec 替身已覆盖替身需求）。
- **J**：混合形态 typeorm import 统一形态（可读性向、零运行时收益，另案批量处理）。
- **K**：`bin/ormconfig.ts` 的 `entities` glob 口径脱节（独立既有债，沿用 TD-14 登记）。
- **M**：entity 类值位置边 —— 本域 service 值位置 entity import 已归零；顶层 barrel `export *` 残留的 entity 类导出边归 C2/G 推广时闭合。
- **N**：「枚举 / 端口文件零 typeorm 依赖」静态守护 spec（本单不新增；守护证据走 grep 复核 + lint）。
- **P**：consent 失败容忍语义未落地（TD-17 另案，沿用登记，与本域无关）。

### 9.2 本单新观察（登记另案，不在本单处理）

- **观察（新）**：`src/emergency/enums/emergency.enums.ts` 的 `isTerminalPhase(phase)` **实测全仓 0 调用方**（grep 仅命中其自身定义）—— 死代码，另案评估是否删除；本单**不动 enums 文件**。
- **观察（沿用 TD-18）**：根目录 e2e 遗留 spec 未被任何 vitest config 收集的测试入口收纳问题，另案评估，本单不清理、不移动、不改 include。

### 9.3 Actions 侧待复核点

- CI 结果待主控 push 后在 Actions 复核（本机闸门已全绿）。
- 本单**未自动 commit / push**；commit 分组见 §十。

### 9.4 提交分组核对

本单文件与并行进程产物**分离**：5 个 node 常驻进程（`nest start --watch` / `vite` / `node dist/app`）不产生 git 改动；`admin-dashboard/` 未触碰；工作区里主控归档的 `docs/worklog/pending/archive/relay-response-20261114-*.md` 三份与 TD-18 遗留的 3 份索引文档改动**不纳入本单 stage**。

---

## 十、commit message 草稿（不自己 commit / push）

```
feat(emergency): TD-19 C2 第三批仓储端口化 —— 1 端口 + TypeORM 实现 + 端口替身 spec
```

建议拆 2 个 commit：

1. `feat(emergency): TD-19 C2 第三批仓储端口化 —— 1 端口 + TypeORM 实现 + 端口替身 spec`
2. `docs(worklog): TD-19 交付记录 + 索引回写（P-DEBT-11 / L-1 · C2 第三批）`

---

_记录时间：2026-11-15 GMT+8 · 基线 HEAD `bedd702` · 未自动提交_
