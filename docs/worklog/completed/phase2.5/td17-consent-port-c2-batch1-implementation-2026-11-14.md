# TD-17 · C2 第一批仓储端口化（consent 域）— 交付记录

- **状态**：✅ 已交付（2026-11-14）
- **基线 HEAD**：`bc7d0db`（TD-16 交付后，与 `origin/integrate` 一致）
- **任务单**：`docs/worklog/pending/td17-consent-port-c2-batch1-task-2026-11-14.md` → 归档至 `docs/worklog/completed/phase2.5/`
- **债务条目**：P-DEBT-11 / L-1（技术债台账 §9）
- **路线**：TD-14 备忘推荐路线 C 三段之第三段 **C2（按域推广）第一批** —— C+（TD-15）→ C1（TD-13 analytics + TD-16 life-map）→ **C2（本单：consent 域，第三个业务域完整复制四件套）**

---

## 一、本单做了什么（一句话）

consent 域按 TD-13 四件套落地仓储端口 —— **1 个端口**（interface + Symbol token + Row / 写入入参类型）+ **1 个 TypeORM 实现**（收进 `src/consent/data/`）+ **module 接线** + **端口替身 spec（13 例，零 entity import）**，验证域级模板在「单 entity / 单 service / 无既有 spec」形态下的可复制性。

---

## 二、改动文件清单

### 2.1 新增（3 个文件）

| 文件                                                    | 行数 | 用途                                                                                                                                          |
| ------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/consent/domain/repositories/consent.repository.ts` | 134  | `ConsentRepository` interface + `ConsentRow` / `ConsentIdempotentKey` / `SaveConsentInput` + DI token `CONSENT_REPOSITORY`；零 typeorm 值符号 |
| `src/consent/data/consent.repository.typeorm.ts`        | 122  | `ConsentRepositoryTypeorm` —— consent 域唯一允许出现 typeorm 值符号的业务文件（module 装配层除外）                                            |
| `test/consent/td17-consent-port-c2-batch1.spec.ts`      | 363  | 端口替身 spec，**13 例**（A1-A13），零 entity import、零 typeorm 值符号、不起真 TypeORM / 不连 DB / 不 `vi.mock('typeorm')`                   |

### 2.2 修改（3 个文件）

| 文件                                                     | 改动                                                                                                                                                                                                                                          |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/consent/providers/consent.service.ts`               | 构造参数由 `@InjectRepository(UserConsent) repo: Repository<UserConsent>` 改为 `@Inject(CONSENT_REPOSITORY) repo: ConsentRepository`；entity 值位置 import 与 typeorm 值导入全撤；**行的构造移到 service 侧**（纯对象）；3 个公共方法签名不变 |
| `src/consent/consent.module.ts`                          | 新增 `{ provide: CONSENT_REPOSITORY, useClass: ConsentRepositoryTypeorm }` provider；**保留** `TypeOrmModule.forFeature([UserConsent])`；`exports: [ConsentService]` **不变**（仓储 token 不 export）                                         |
| `test/admin-debug/wp69-debug-panel-improvements.spec.ts` | **既有 spec 替身形状适配**（3 处）：构造参数类型随端口化变化，`{ findOne: async () => null } as never` → `{ findLatestByDevice: async () => null } as never`；**断言逐字未改**；另加 1 行说明注释                                             |

### 2.3 删除

无。

### 2.4 零改动确认

- `src/consent/entities/user-consent.entity.ts` —— **一字未改**（字段 / 装饰器 / 列 / 索引 / 关系全保留；本 entity 本身无软删列）
- `src/consent/dto/**`（3 个 DTO）、`src/consent/controllers/consent.controller.ts`（3 个端点 + 限流 + 鉴权）、`src/consent/index.ts`（barrel 导出面，含 entity 类值导出 —— 归另案 M）—— 零改动
- `src/migration/**`（含 `1700000006000-AddUserConsent.ts`）—— 零改动
- `src/engine-core/**` —— 零改动（boundary 12 绿）
- 其他业务域 / `package.json` / `tsconfig*.json` / `vitest.config.mts` / CI / `admin-dashboard/` / Flutter —— 零改动
- 未新增第三方依赖

---

## 三、端口方法面清单

### 3.1 端口划分粒度判定：**单端口**（1 张表 / 1 个 service / 4 个方法）

consent 域只有 1 张表、1 个 service，5 处仓储调用全部落在同一张表上；拆成多端口只会把同一张表的查询口径切碎、面反而变宽（对齐 TD-13 D-2「面窄才守得住」）。与 TD-16 life-map 的 4 端口判定**不冲突** —— 那里是 4 张表、4 套互不相同的查询口径。

### 3.2 5 处既有调用 → 4 个端口方法（任务单 §1.3 锚点，逐条对齐）

| 改前调用（HEAD `bc7d0db`）                                                                                                                   | 改后端口方法                                       | 口径                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------ |
| ① `repo.findOne({ where: { deviceId, consentVersion, consentType, appId } })`                                                                | `findByIdempotentKey(key)`                         | 幂等四元组查重，与唯一索引 `uq_user_consents_device_version_type` 同口径 |
| ② `repo.save(existing)`（幂等命中，刷新 IP/UA/metadata）                                                                                     | `save(input)`（带 `id`）                           | 落库字段集与改前逐字相同                                                 |
| ③ `repo.save(repo.create({ ... }))`（首次写入）                                                                                              | `save(input)`（无 `id`）                           | 行由 service 以纯对象构造，落库字段集与改前逐字相同                      |
| ④ `repo.findOne({ where: { deviceId, consentType, appId }, order: { acceptedAt: 'DESC' } })`                                                 | `findLatestByDevice(deviceId, consentType, appId)` | 任意版本最新一条，排序方向不变                                           |
| ⑤ `repo.createQueryBuilder().update(UserConsent).set({ userId }).where('device_id = :deviceId AND user_id IS NULL', { deviceId }).execute()` | `bindDeviceToUser(deviceId, userId)`               | QB update 只存在于实现层；端口只收「受影响行数」                         |

**端口方法面共 4 个方法**（`save` 复用两路写入），全部有改前调用点对应，**无一个泛化代理**；不暴露 `Repository` / `EntityManager` / `FindOptions` / 查询选项 / 操作符；端口不写 SQL。

### 3.3 端口类型

- **`ConsentRow`（出参）**：12 个字段的窄领域类型 —— id / userId / deviceId / consentVersion / consentType / platform / appId / acceptedAt / updatedAt / ipAddress / userAgent / metadata；**不含 entity 类**。本 entity 无软删列，故不涉及「软删过滤后剔除字段」的取舍。
- **`ConsentIdempotentKey`（查重入参）**：deviceId + consentVersion + consentType + appId 四元组。
- **`SaveConsentInput`（写入入参）**：11 个业务字段 + **`id` / `acceptedAt` / `updatedAt` 三个可选字段**：
  - `id` 缺省 = 新增行（首次写入），带 `id` = 更新既有行（幂等命中）；
  - `acceptedAt` / `updatedAt` 缺省 = 由落库时生成（CreateDateColumn / UpdateDateColumn），幂等更新时 service 带原值 → 「首写 acceptedAt 保留」语义与改前逐字一致；
  - `metadata` 的「缺省 = 保留原值」用**显式 undefined 判定**表达（原因见偏差 D-4）。
- **DI token**：`CONSENT_REPOSITORY`。

---

## 四、typeorm 符号外泄复核表（静态复核四项）

复核口径对齐 TD-13 D-5：正则 `\bRepository\b | \bBetween\b | \bFindOptions\b | \bEntityManager\b | from 'typeorm' | from '@nestjs/typeorm'`。

### 4.1 受检文件（端口 1 + service 1 + 新 spec 1 = **3 个**）

| 文件                                                    | typeorm 值符号命中 |
| ------------------------------------------------------- | ------------------ |
| `src/consent/domain/repositories/consent.repository.ts` | **0**              |
| `src/consent/providers/consent.service.ts`              | **0**              |
| `test/consent/td17-consent-port-c2-batch1.spec.ts`      | **0**              |

### 4.2 允许落点（实现层 1 + 装配层 1 = **2 个**）

| 文件                                             | typeorm 值符号命中 | 落点性质                                     |
| ------------------------------------------------ | ------------------ | -------------------------------------------- |
| `src/consent/data/consent.repository.typeorm.ts` | 6                  | TypeORM 实现                                 |
| `src/consent/consent.module.ts`                  | （装配层）         | `TypeOrmModule.forFeature` + 1 组 token 接线 |

### 4.3 spec 零 entity import

- `test/consent/` 下 `entities/|\.entity\.js|UserConsent` 命中 **0**。
- spec 只 import 端口类型（`ConsentRepository` / `ConsentRow` / `ConsentIdempotentKey` / `SaveConsentInput`）与 service 类；连 DTO 类都不 import（按结构传参）。

### 4.4 service 值位置 entity import = 0

- `src/consent/providers/` 下 `entities/|\.entity\.js|UserConsent` 命中 **0**。

### 4.5 方法面不泛化

- 端口目录内 `findAll|findOne|updateById|deleteById|.save(|.remove(|createQueryBuilder|getRepository|QueryBuilder|FindOptions|EntityManager|.create(` 命中 **0**。

---

## 五、service 行为与改前对照表

| 维度                 | 改前（HEAD `bc7d0db`）                                                                                                                                     | 改后（端口）                                                                                                                                     | 判定                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| 幂等查重字段         | `findOne({ where: { deviceId, consentVersion, consentType, appId } })`                                                                                     | `findByIdempotentKey({ 同四元组 })`                                                                                                              | 逐字一致                                                                   |
| 幂等命中写入         | `existing.ipAddress = ctx.ipAddress; existing.userAgent = ctx.userAgent; if (dto.metadata !== undefined) existing.metadata = dto.metadata; save(existing)` | service 构造纯对象：原 id / userId / deviceId / consentVersion / consentType / platform / appId / acceptedAt / updatedAt + 新 IP / UA / metadata | 落库字段集与改前**逐字一致**（原 userId 不被覆盖、原 acceptedAt 不被改写） |
| metadata 缺省语义    | `undefined` → 保留原值；显式 `null` → 写 null                                                                                                              | 显式 `let metadata` + `if (dto.metadata !== undefined)`                                                                                          | 逐字一致（**未用 `??`**，理由见偏差 D-4）                                  |
| 首次写入             | `repo.create({ userId: null, deviceId, consentVersion, consentType, platform, appId, ipAddress, userAgent, metadata: dto.metadata ?? null })`              | service 构造同字段纯对象（**不含 id / acceptedAt / updatedAt**）                                                                                 | 逐字一致（新行不写首写时间，由 CreateDateColumn 生成）                     |
| 首写 acceptedAt 保留 | 更新行时 `acceptedAt` 是库中原值（CreateDateColumn 更新不改）                                                                                              | 更新行时 service 显式带原 `acceptedAt`                                                                                                           | 逐字一致（双保险）                                                         |
| checkStatus 取最新   | `findOne({ where: { deviceId, consentType, appId }, order: { acceptedAt: 'DESC' } })`                                                                      | `findLatestByDevice(deviceId, consentType, appId)`                                                                                               | 逐字一致（排序方向不变）                                                   |
| 版本匹配判定         | `accepted.consentVersion === this.currentVersion` → `needReaccept: !matched`                                                                               | 同                                                                                                                                               | 逐字一致                                                                   |
| 版本来源             | `config.get<{ currentVersion?: string }>('consent')?.currentVersion ?? 'v1.0'`                                                                             | 同（**该行逐字保留** —— 见 §六 偏差 D-2）                                                                                                        | 逐字一致                                                                   |
| 无记录分支           | `{ hasAccepted: false, needReaccept: true, currentVersion }`                                                                                               | 同                                                                                                                                               | 逐字一致                                                                   |
| 回填条件             | `update(UserConsent).set({ userId }).where('device_id = :deviceId AND user_id IS NULL')`                                                                   | 实现层同一条 QB                                                                                                                                  | 逐字一致（只回填尚未绑定用户的设备行）                                     |
| 回填返回值           | `result.affected ?? 0`                                                                                                                                     | 端口返回 `number`（实现层 `?? 0`），service 直接返回                                                                                             | 逐字一致                                                                   |
| 失败容忍             | `record` **无 try/catch**（写入失败抛异常），类注释声称「不抛异常 / 返回 lastError」—— 注释与实现不一致                                                    | **未加 try/catch**（不改行为），并在新 spec A13 锁住「写入失败会抛」的现状                                                                       | 逐字一致（不一致项登记为偏差 D-3 + 另案 P）                                |
| 日志                 | `[record] idempotent update: deviceId=…` / `[record] new consent: id=…` / `[bindToUser] migrated N consents to user=…`                                     | 同（文案逐字不变，仍只出 id / 设备前缀 / 计数 / 用户前缀）                                                                                       | 逐字一致                                                                   |
| 公共签名             | `record(dto, ctx)` / `checkStatus(deviceId, consentType, appId)` / `bindToUser(deviceId, userId)`                                                          | 同                                                                                                                                               | 逐字不变                                                                   |
| DTO 转换             | controller 内 `acceptedAt.toISOString()`                                                                                                                   | 未动 controller                                                                                                                                  | 逐字不变                                                                   |

---

## 六、偏差登记（conventions §2.5）

| #       | 原锚点                                                                                          | 实测值                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 理由 / 处置                                                                                                                                                                                           |
| ------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D-1** | 任务单 §1.3 建议 `save(row: ConsentRow): ConsentRow`（两路 save 复用，行在 service / 工厂构造） | 改为 `save(input: SaveConsentInput): Promise<ConsentRow>`，`id` / `acceptedAt` / `updatedAt` 可选                                                                                                                                                                                                                                                                                                                                                                                      | **新增行没有 id**，用 Row 表达不了「新增」与「更新」两条路径；拆成两个方法会让方法面变宽。写入入参 = 行纯对象（service 构造），与任务单「行纯对象构造在 service」的意图一致                           |
| **D-2** | 任务单 §1.2 / §2 称「`test/` 下**零** consent 既有 spec」「其他域 spec 不新增、不修改」         | 实测**有 2 处既有 spec 引用本域 service**：① `test/admin-debug/wp69-debug-panel-improvements.spec.ts` 直接 `new ConsentService({ findOne: async () => null } as never, stubConfig(...))` —— 构造参数类型随端口化变化，替身**形状必须改**（`findOne` → `findLatestByDevice`，3 处），**断言逐字未改**；② `test/config/wp69-env-blindspot-expansion.spec.ts` 以**源码文本**断言 `get<{ currentVersion?: string }>('consent')` 仍在 —— 本单保留该行**逐字不变**，该 spec **零改动**且全绿 | ①是构造参数类型变化的**必然连带**，不改则该 spec 3 例直接报错；处置为**最小适配**（只换替身方法名，断言不动）。②无需改动                                                                              |
| **D-3** | 任务单 §3.1 称「fire-and-forget 写入失败容忍语义（不抛异常，返回 lastError）」逐字不变          | 实测 `ConsentService.record` **无 try/catch、无 lastError 字段**，写入失败**会抛异常**；类头注释「不抛异常的原则」与实现**不一致**                                                                                                                                                                                                                                                                                                                                                     | 本单是结构重构，**不新增 try/catch**（那是行为变更，超出「零漂移」范围）；改用**新 spec A13 行为锁**把现状锁住，并把注释/实现不一致登记为**另案 P**。任务单该条锚点按「口径真相源以仓内实测为准」处理 |
| **D-4** | —                                                                                               | metadata 缺省判定若用 `??`，在 `dto.metadata` 显式为 `null` 时会**保留原值**，而改前是**写 null**（DTO 的 `@IsOptional()` 让 null 也能过校验）                                                                                                                                                                                                                                                                                                                                         | **不用 `??`**：改用显式 `let metadata` + `if (dto.metadata !== undefined)` 保留原语义；同时绕开 `@typescript-eslint/prefer-nullish-coalescing` 规则                                                   |
| **D-5** | 任务单 §1.1 模式定义示例写 `useClass: ConsentRepositoryTypeOrm`                                 | 本单类名取 `ConsentRepositoryTypeorm`                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 沿用 TD-16 域级模板命名（`DriftBottleRepositoryTypeorm` 等），仅命名，不影响行为                                                                                                                      |
| **D-6** | 任务单 §1.3「移除 `Repository.create` 依赖（行纯对象构造在 service）」                          | service 侧**零仓储工厂依赖**（行纯对象在 service 内构造）；实现层落库仍走实体工厂调用                                                                                                                                                                                                                                                                                                                                                                                                  | 符合任务单意图（业务层不碰持久化工厂）；实现层属落库细节，不外泄到端口                                                                                                                                |
| **D-7** | 任务单 §1.3 建议端口 4 个方法                                                                   | 实测落地 **4 个方法**（`findByIdempotentKey` / `findLatestByDevice` / `save` / `bindDeviceToUser`）                                                                                                                                                                                                                                                                                                                                                                                    | **与锚点一致**，无偏差；仅参数类型按 D-1 调整                                                                                                                                                         |

**任务单其余锚点与实测一致**：域选定标准 5 条（0 关系装饰器 / 0 内联枚举 / 无跨域仓储消费 / forFeature 单点 / 有等价先例）；现状清单 8 个 `.ts`；5 处仓储调用形态；entity 索引口径（1 唯一 + 3 普通）；`forFeature([UserConsent])` 保留；exports 不变；`DriftBottle` 无关项。

---

## 七、闸门真实数字（同机实测，2026-11-14 17:06-17:14）

| 闸门                     | 命令                                                                    | 基线（HEAD `bc7d0db`）                                                       | 本单实测                                                                                                                                                              | 结论                                                                        |
| ------------------------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 盘读前置                 | `pnpm doctor:fs`                                                        | per-file 均值 0.15 ms                                                        | per-file 均值 **0.31 ms**（walk 90ms / cold 381ms slow 13 / warm 61ms slow 2）                                                                                        | 判定「合格（读取延迟正常，闸门数字可信）」，exit 0                          |
| 根类型                   | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` | 0 error                                                                      | **0 error**，exit 0                                                                                                                                                   | ✅                                                                          |
| 构建类型                 | `pnpm exec tsc -p tsconfig.build.json --noEmit`                         | 0 error                                                                      | **0 error**，exit 0                                                                                                                                                   | ✅                                                                          |
| ESLint                   | `pnpm lint`                                                             | 0 error / 1 warning                                                          | **0 error / 1 warning**（唯一 warning：`test/e2e/v2-user-flow.spec.ts:1` unused eslint-disable —— 既有基线，范围外未修），exit 0                                      | ✅                                                                          |
| oxlint fast              | `pnpm lint:fast`                                                        | 0 / 0                                                                        | **0 error / 0 warning**（输出为空），exit 0                                                                                                                           | ✅                                                                          |
| 定向 spec（本单新 spec） | `pnpm exec vitest run test/consent/`                                    | —                                                                            | **1 文件 / 13 例全过**，exit 0                                                                                                                                        | ✅                                                                          |
| 既有 spec 连带           | `pnpm exec vitest run test/consent/ test/admin-debug/ test/config/`     | —                                                                            | **19 文件**（18 passed + 1 skipped）/ **286 例**（282 passed + 4 skipped），exit 0                                                                                    | ✅                                                                          |
| 全量测试                 | `pnpm test`                                                             | 195 passed \| 1 skipped（196 文件）/ 3285 passed \| 4 skipped（**3289 例**） | **196 passed \| 1 skipped（197 文件）/ 3298 passed \| 4 skipped（3302 例）/ 85.10s**，exit 0                                                                          | ✅ 净增 **+1 文件 / +13 例**（全部为本单新 spec），**既有 3289 例一条不减** |
| engine-core 边界         | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                | 12 passed                                                                    | **12 passed**，2.49s，exit 0                                                                                                                                          | ✅                                                                          |
| engine-core 零改动       | `git diff --stat HEAD -- src/engine-core`                               | 空                                                                           | **空**                                                                                                                                                                | ✅                                                                          |
| migration 零改动         | `git diff --stat HEAD -- src/migration/`                                | 空                                                                           | **空**                                                                                                                                                                | ✅                                                                          |
| 范围隔离                 | `git diff --name-only HEAD` + `git status --short`                      | —                                                                            | 已跟踪改动 5 个（2 文档 + 2 源文件 + 1 既有 spec）+ 新增 3 个目录（`src/consent/data/`、`src/consent/domain/`、`test/consent/`）+ 任务单 1 个 + 主控归档的 relay 1 个 | ✅ 仅 consent 域 + 1 处既有 spec 替身 + 交付文档                            |

**机器状态**：**5 个 node 常驻进程**（`pnpm start:dev` / `nest start --watch` / `pnpm dev` / admin-dashboard vite / `node dist/app`），与 TD-15 / TD-16 同机同状态，未杀用户进程；墙钟时长不可跨单比较，**闸门以用例数为准**。

---

## 八、边界确认 + 遗留另案

### 8.1 边界确认

- **engine-core 纯层**：`git diff --stat HEAD -- src/engine-core` 为**空**；`boundary.spec.ts` 未改；12 条断言全绿。
- **entity 零改动**：`user-consent.entity.ts` 一字未改；migration DDL 不动。
- **barrel 导出面**：`src/consent/index.ts` 未改（entity 类值导出边归另案 M）。
- **既有 spec**：`test/admin-debug/wp69-debug-panel-improvements.spec.ts` 仅替身方法名适配 + 1 行注释，**断言逐字未改**；`test/config/wp69-env-blindspot-expansion.spec.ts` **零改动**且全绿；其他域 spec 零改动。
- **零压红线**：本单不涉及自由练习（practice）评分口径。
- **隐私红线**：交付记录与 spec 内**无任何用户同意原文 / 设备指纹真实值 / UA 原文**，审计字段一律用占位字面量（`ip-old` / `ip-new` / `ua-old` / `ua-new`）；service 日志仍只出 id / 设备前缀 / 计数 / 用户前缀。
- **命令边界**：一律 `pnpm` / `pnpm exec`，未用裸 `npx`；未新增依赖；未改 package.json / tsconfig / vitest / CI。
- **提交边界**：**未自动 commit / push**，只给 commit message 草稿（§十）。

### 8.2 遗留另案

| 编号          | 内容                                                                                                                                                                    | 状态                                                                                                                                                                                                                                                                                                                                                |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C2**        | 仓储端口按域推广                                                                                                                                                        | 本单 = **C2 第一批**（consent 域）。域级模板已成型：端口（interface + Symbol token + Row / 写入入参）／实现（`data/*.typeorm.ts`）／装配（module token 接线）／测试（端口替身 spec，零 entity import）。后续批次候选（任务单 §1.1）：**emergency** → **good_state_diary** → home / inner_world / ai-engine → companion → profile / user / counselor |
| **G**         | 其余 service 分批推广                                                                                                                                                   | 收益口径按 TD-14 §5.3 修正版：「service 源码层 typeorm 值符号 0 命中」+「该批 spec 值位置 entity import = 0」，**不再以加载图减重为 KPI**                                                                                                                                                                                                           |
| **I**         | 端口内存实现是否补                                                                                                                                                      | 🟢 暂不补（spec 替身已覆盖替身需求）                                                                                                                                                                                                                                                                                                                |
| **J**         | 混合形态 typeorm import 统一形态                                                                                                                                        | 可读性向、零运行时收益，另案批量处理                                                                                                                                                                                                                                                                                                                |
| **K**         | `bin/ormconfig.ts` 的 `entities` glob 口径脱节                                                                                                                          | 独立既有债，沿用 TD-14 登记                                                                                                                                                                                                                                                                                                                         |
| **M**         | entity 类值位置边                                                                                                                                                       | 本域 **service 值位置 entity import 归零**；barrel `export *` 残留的 entity 类导出边归 C2/G 推广时闭合                                                                                                                                                                                                                                              |
| **N**         | 「枚举 / 端口文件零 typeorm 依赖」静态守护 spec                                                                                                                         | 本单**未新增**守护 spec（守住用例数基线）；守护证据走 §四 四项 grep 复核 + lint 闸门                                                                                                                                                                                                                                                                |
| **P**（新增） | **consent 失败容忍语义未落地** —— `ConsentService` 类头注释承诺「写入失败 → 返回 lastError，不 throw」，但实现**无 try/catch、无 lastError 字段**，写入失败实际会抛异常 | 本单是结构重构，**不改行为**；新 spec A13 已把「写入失败会抛」锁成行为锁。该注释/实现不一致登记为另案，**建议单独一单**统一（要么补 try/catch + lastError，要么改注释）                                                                                                                                                                             |

---

## 九、提交分组核对

本单文件清单（12 项）：

```
新增  src/consent/domain/repositories/consent.repository.ts
新增  src/consent/data/consent.repository.typeorm.ts
新增  test/consent/td17-consent-port-c2-batch1.spec.ts
修改  src/consent/providers/consent.service.ts
修改  src/consent/consent.module.ts
修改  test/admin-debug/wp69-debug-panel-improvements.spec.ts   ← 既有 spec 替身形状适配（断言未改）
归档  docs/worklog/pending/td17-...-task-2026-11-14.md → docs/worklog/completed/phase2.5/
新增  docs/worklog/completed/phase2.5/td17-...-implementation-2026-11-14.md
修改  docs/worklog/pending/phase2.5-wp-list-2026-11-08.md
修改  docs/worklog/pending/phase2.5-README.md
修改  docs/team/gate-performance-remediation-2026-11-11.md
```

与并行进程产物**分离**：5 个 node 常驻进程不产生 git 改动；`admin-dashboard/` 未触碰；工作区里主控归档的 `docs/worklog/pending/archive/relay-response-20261114-1524.md`（TD-16 的 relay 归档）与本单无关，**不纳入本单 stage**。

---

## 十、commit message 草稿（不自己 commit / push）

```
feat(consent): TD-17 C2 第一批仓储端口化 —— 1 端口 + TypeORM 实现 + 端口替身 spec
```

建议拆 2 个 commit：

1. `feat(consent): TD-17 C2 第一批仓储端口化 —— 1 端口 + TypeORM 实现 + 端口替身 spec`
2. `docs(worklog): TD-17 交付记录 + 索引回写（P-DEBT-11 / L-1 · C2 第一批）`

---

_记录时间：2026-11-14 GMT+8 · 基线 HEAD `bc7d0db` · 未自动提交_
