# TD-17 · C2 第一批仓储端口化（consent 域 · P-DEBT-11 / L-1 · TD-14 推荐路线第三段 C2 首批）

> 状态：✅ **已交付**（2026-11-14，MiniMax Code）→ 交付记录：`docs/worklog/completed/phase2.5/td17-consent-port-c2-batch1-implementation-2026-11-14.md`
> 仓库：E:\Work\Project\backend\mofang-nestjs，分支 integrate，基线 HEAD `bc7d0db`（TD-16 交付后，与 `origin/integrate` 一致）
> 唯一事实源：`docs/team/gate-performance-remediation-2026-11-11.md` §9 **P-DEBT-11**（L-1）+ `docs/architecture/entity-typeorm-decoupling-assessment-2026-11-14.md`（TD-14 备忘）§5.3 / §6.1 / §6.2 + TD-13 / TD-16 交付记录（四件套模板与先例）
> 任务性质：**实现单（C2 推广第一批）** —— 在 TD-13（analytics）、TD-16（life-map）两个试点域验证过的「仓储端口」模式上，选第三个业务域 **consent** 按 TD-13 四件套完整复制一遍，验证域级模板在「单 entity / 单 service / 无既有 spec」形态下的可复制性
> 改动范围：`src/consent/` + `test/consent/` + 交付文档；`engine-core/`、`src/migration/`、配置、CI、其他业务域、前端不碰

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `E:\Work\Project\backend\mofang-nestjs\README.md` —— 仓库总览
2. `E:\Work\Project\backend\mofang-nestjs\docs\README.md` —— 文档导航
3. `E:\Work\Project\backend\mofang-nestjs\docs\team\conventions.md` —— 代码红线 + 交付格式（§1.1 engine-core 分层、§1.3 pnpm 命令规范、§三 16 条硬约束、§2.5 偏差登记）
4. 阶段工作入口：`docs/worklog/pending/phase2.5-README.md` 与 `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md`
5. 根因与既往结论：
   - TD-14 备忘 `docs/architecture/entity-typeorm-decoupling-assessment-2026-11-14.md` §5.3（G 收益口径）、§6.1（C+ / C1 / C2 三段）、§6.2（试点域选择标准与候选排序）
   - TD-16 交付记录 `docs/worklog/completed/phase2.5/td16-life-map-port-pilot-c1-implementation-2026-11-14.md`（最近一个四件套先例：端口划分粒度、Row 出参、替身 spec 结构、typeorm 符号外泄复核、行为对照表、偏差登记）
   - TD-13 交付记录 `docs/worklog/completed/phase2.5/td13-repository-port-analytics-pilot-implementation-2026-11-14.md`（四件套结构、端口方法面口径、typeorm 符号外泄复核、偏差登记 D-1 ~ D-7）
   - 端口样板：`src/life-map/domain/repositories/`（4 端口）、`src/life-map/data/`（4 TypeORM 实现）；`src/analytics/domain/repositories/analytics-event.repository.ts` + `src/analytics/data/analytics-event.repository.typeorm.ts`
6. 本任务单（就是你在读的这份）

---

## 1. 背景（先读，方向别错）

TD-14 备忘 §6.1 推荐路线分三段：**C+（枚举外移，TD-15 已交付）→ C1（试点域端口化，TD-13 analytics + TD-16 life-map 已交付）→ C2（按域推广，本单）**。C2 的任务是把已成型的域级模板逐域复制；每批验收口径按 TD-14 §5.3 修正版执行，**不再以加载图减重为 KPI**。

**模式定义**（沿用 TD-13 四件套）：

1. **端口**：`src/consent/domain/repositories/consent.repository.ts` —— interface + Symbol DI token + 入参 / Row 类型；零 typeorm 值符号。
2. **TypeORM 实现**：`src/consent/data/consent.repository.typeorm.ts` —— `@InjectRepository` + `Repository` + QueryBuilder 等查询操作符全部收在此文件；域内唯一允许出现 typeorm 值符号的业务文件。
3. **module 接线**：provider `{ provide: TOKEN, useClass: ConsentRepositoryTypeOrm }`；**保留** `TypeOrmModule.forFeature([UserConsent])`；exports 口径按现状（本域无跨模块仓储消费，仓储 token 不 export，对齐 TD-13 D-4 / TD-16）。
4. **端口替身 spec**：`test/consent/td17-consent-port-c2-batch1.spec.ts` —— 替身只记调用参数 + 返回预设行；不起真 TypeORM、不连 DB、不 `vi.mock('typeorm')`。

### 1.1 域选定：consent（主控取证锚点，HEAD `bc7d0db`；执行方复核并登记偏差）

| TD-14 §6.2 选择标准                      | consent 实测                                                                                                        | 判定 |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---- |
| 1. 扁平表优先（无关系装饰器）            | `UserConsent` 关系装饰器 **0**（@ManyToOne / @OneToMany / @ManyToMany / @OneToOne / @JoinColumn / @JoinTable 全 0） | ✅   |
| 2. entity 文件内无枚举                   | 0 内联 `enum`；entity 无软删列（无 `@DeleteDateColumn`）                                                            | ✅   |
| 3. 无跨模块仓储消费                      | `src/` 其他目录仅 `app.module.ts` 装配 `ConsentModule`；无其他 service / repository 值位置引用本域 entity           | ✅   |
| 4. 引用面小 + module forFeature 单点注册 | 仓储仅被本域 `ConsentService` 使用；`consent.module.ts` 单点 `forFeature`；controller 只注入 service，无仓储旁路    | ✅   |
| 5. 已有等价端口先例可抄                  | TD-13 analytics 四件套 + TD-16 life-map 四件套均在仓内                                                              | ✅   |

**候选对照**（本单不做，留 C2 后续批次）：`emergency`（1/1、0 关系 0 枚举、无跨域、零 spec；方法面含 2 条 raw SQL + QB list，第二批）；`good_state_diary`（1/1 + 1 无仓储 AI service；src 内既有 1 个 spec；方法面宽，第三批）；`quality`（batch service 跨域注入 auto-practice / engine-adapters 仓储 + 6 既有 spec，排除）；`ai-companion` / `embodied` / `agent` / `knowledge-base` / `home` / `practice` 等含关系装饰器或内联枚举，按备忘 §357 后置；`profile` / `user` / `counselor` 关系面重，最后。

### 1.2 consent 现状清单（主控实测，8 个 `.ts`）

| 文件                                                                          | 现状                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entities/user-consent.entity.ts`（`UserConsent`，表 `user_consents`）        | 扁平：UUID PK + `userId`(可空) / `deviceId` / `consentVersion` / `consentType` / `platform` / `appId` / `acceptedAt`(CreateDateColumn) / `updatedAt`(UpdateDateColumn) / `ipAddress` / `userAgent` / `metadata`(json)；3 个普通索引 + 1 唯一索引 `(deviceId, consentVersion, consentType)`；**本单不改 entity 文件** |
| `providers/consent.service.ts`                                                | **直连 1 个 Repository**：`@InjectRepository(UserConsent) private readonly repo: Repository<UserConsent>`；值位置 import entity 类；另注入 `ConfigService`。无私有方法签名使用 entity 类型                                                                                                                           |
| `controllers/consent.controller.ts`                                           | 只注入 `ConsentService`；无 Repository / entity 旁路                                                                                                                                                                                                                                                                 |
| `consent.module.ts`                                                           | `forFeature([UserConsent])` + imports `UserModule`；providers `ConsentService`；exports `ConsentService`；controller `ConsentController`                                                                                                                                                                             |
| `index.ts`（barrel）                                                          | 值导出 entity 类（`export * from './entities/user-consent.entity.js'`）+ DTO + service + module；该 barrel 值导出边归另案 **M**（entity 类值位置边，C2/G 批量闭合），本单**不改 barrel 导出面**                                                                                                                      |
| `dto/record-consent.dto.ts` / `consent-status.dto.ts` / `bind-to-user.dto.ts` | DTO，不 import entity                                                                                                                                                                                                                                                                                                |

**test/ 现状**：`test/` 下**零** consent 既有 spec；src 内部亦无 spec（本域首批测试即本单新增的端口替身 spec）；其他域 spec 不引用本域。

### 1.3 仓储调用面（端口方法面只收这些现有调用，不泛化）

`ConsentService` 现有 5 处仓储调用形态（端口方法签名由实现单按 TD-13 D-2 口径设计，出参用 Row / 窄领域类型，登记偏差）：

1. `repo.findOne({ where: { deviceId, consentVersion, consentType, appId } })` —— 幂等查重（record 路径）
2. `repo.save(existing)` —— 命中已有行，刷新 IP / UA / metadata 后保存
3. `repo.save(entity)` —— 首次写入；行由 `repo.create({ ... })` 构造（端口化后移除 `Repository.create` 依赖：行在 service / 工厂内以纯对象构造，由实现层 save 落库）
4. `repo.findOne({ where: { deviceId, consentType, appId }, order: { acceptedAt: 'DESC' } })` —— 状态查询（checkStatus 路径）
5. `repo.createQueryBuilder().update(UserConsent).set({ userId }).where('device_id = :deviceId AND user_id IS NULL', { deviceId }).execute()` —— `bindToUser` 批量回填，返回 `affected`（0/1/n）；QB update 下沉 `data/` 实现，端口暴露窄方法返回受影响行数

**端口方法面建议**（实现单可调整，须在交付记录写明偏差与理由）：

- `findByIdempotentKey(key: { deviceId: string; consentVersion: string; consentType: string; appId: string }): ConsentRow | null`
- `findLatestByDevice(deviceId: string, consentType: string, appId: string): ConsentRow | null`
- `save(row: ConsentRow): ConsentRow`（两路 save 复用；行构造在 service / 工厂，不依赖仓储工厂方法）
- `bindDeviceToUser(deviceId: string, userId: string): number`（返回受影响行数；QB update 仅存在于 `data/` 实现）

### 1.4 基线闸门（HEAD `bc7d0db`，TD-16 交付后）

全量 **3285 passed + 4 skipped（3289 例 / 196 文件）**；lint **0 error / 1 warning**（`test/e2e/v2-user-flow.spec.ts:1` 既有 unused eslint-disable，范围外不修）；lint:fast / lint:deep **0 / 0**；boundary **12 passed**；根 tsc / build tsc **0 error**；`git diff --stat HEAD -- src/engine-core` 为空。

---

## 2. 范围（严格遵守，不越权）

### 在范围内

1. **端口文件**：`src/consent/domain/repositories/consent.repository.ts`（interface + Symbol token + 入参 / Row 类型）。
2. **TypeORM 实现**：`src/consent/data/consent.repository.typeorm.ts`；`@InjectRepository` / `Repository` / QueryBuilder 等 typeorm 值符号只允许出现在实现文件与 module 装配层。
3. **ConsentService** 改依赖端口（直连 Repository 抽出）；移除对 `Repository.create` 的依赖（行纯对象构造在 service 内）。
4. **module 接线**：新增端口 provider；保留 `forFeature([UserConsent])`；exports 保持现状（无跨域仓储消费，仓储 token 不 export）。
5. **service 内部类型替换**：entity 类型签名替换为端口 Row / 领域类型；service 不再值位置 import entity 类。controller 调用的公共方法签名（`record` / `checkStatus` / `bindToUser`）保持不变。
6. **端口替身 spec**：`test/consent/` 新增（工作项前缀 + 端口语义，对齐 TD-13 D-1 / TD-16 命名）；替身记调用参数 + 返回预设行；**spec 零 entity import**；不起真 TypeORM、不连 DB、不 `vi.mock('typeorm')`。
7. **文档与索引回写**（§7 清单）。

### 明确不在范围内（禁止顺手做）

- **entity 文件一字不改**：字段、装饰器、列、索引、关系、软删口径全部保留；DTO、controller、路由、业务语义不动。
- **不改 `index.ts` barrel 导出面**：entity 类经 barrel 的值导出边归另案 M（C2/G 批量闭合），本单不删导出、不改对外面。
- 不做 Row 纯类型持久化分层映射的其他推广；不做 EntitySchema / 纯类改造；不补端口内存实现（另案 I）。
- 端口方法面只收 §1.3 现有调用形态；**不扩通用仓储代理**、不暴露 typeorm 管理句柄 / 查询选项 / 操作符；端口不写 SQL（QB update 仅下沉在 `data/` 实现）；端口 / service / spec 不暴露 entity 类名。
- 其他业务域零改动；`src/migration/` 零改动；不改 package.json / tsconfig / `vitest.config.mts` / CI / Dockerfile；不新增第三方依赖；不碰 `admin-dashboard/` 与 Flutter。
- 既有 spec 断言 / mock 语义零改动；本域无既有 spec，其他域 spec 不新增、不修改。
- 不自动 git commit / push（写完给 commit 草稿，等用户指令）。

### 另案登记（本单不做，写入交付记录遗留段）

- **C2 / G**：其余域仓储端口化分批推广；每批验收口径 = 「service 源码层 typeorm 值符号 0 命中」+「该批 spec 值位置 entity import = 0」（TD-14 备忘 §5.3，不再以加载图减重为 KPI）。后续批次候选：emergency → good_state_diary → home / inner_world / ai-engine → companion → profile / user / counselor。
- **I**：端口内存实现是否补（本单不补；spec 替身已覆盖替身需求）。
- **J**：混合形态 typeorm import 统一形态（可读性向、零运行时收益，另案批量处理）。
- **K**：`bin/ormconfig.ts` 的 `entities` glob 口径脱节（独立既有债，沿用 TD-14 登记）。
- **M**：entity 类值位置边 —— 本域 service 值位置 entity import 归零；barrel `export *` 残留的 entity 类导出边归 C2/G 推广时闭合。
- **N**："枚举 / 端口文件零 typeorm 依赖"静态守护 spec（本单不新增；守护证据走 grep 复核 + lint）。

---

## 3. 目标交付物

### 3.1 代码改动

- 端口文件 + TypeORM 实现文件（`domain/repositories/` + `data/`）；`consent.module.ts` provider 接线；`ConsentService` 依赖改端口；新增端口替身 spec。
- 业务行为零漂移：幂等查重四元组（deviceId / consentVersion / consentType / appId）、首写 `acceptedAt` 保留（更新行不覆写首写时间）、checkStatus 的 `acceptedAt DESC` 取最新一条、版本匹配 `currentVersion` 判定 `needReaccept`、`bindToUser` 仅回填 `user_id IS NULL` 的设备行且返回受影响行数、fire-and-forget 写入失败容忍语义（不抛异常，返回 lastError）逐字不变。

### 3.2 静态复核证据（grep 复核，结果落交付记录）

1. **typeorm 符号外泄**：端口文件、service、新 spec 三个受检面，`Repository` / `Between` / `FindOptions` / `EntityManager` / `from 'typeorm'` / `from '@nestjs/typeorm'` 值符号 **0 命中**（注释文案也避开 typeorm 字面量，对齐 TD-13 D-5）；命中只允许在 `data/` 实现文件与 module 装配层。
2. **spec 零 entity import**：新 spec 文件对 `entities/` 路径的 entity 类 import = **0**。
3. **service 值位置 entity import = 0**：`consent.service.ts` 不再值位置 import entity 类。
4. **方法面不泛化**：端口方法与 §1.3 调用面一一对应；spec 用例显式断言调用次数与参数；无新增通用 `findAll` / `updateById` 之类代理方法。

### 3.3 交付记录（§6 固定路径）

含改动清单、端口方法面清单、typeorm 符号外泄复核表、service 行为与改前对照表（查询口径 / 过滤 / 排序 / 隔离 / 失败容忍 / DTO 转换）、偏差登记（conventions §2.5）、边界确认、遗留另案。

> **口径真相源**：调用面与出参形状以仓内实测为准；若与 §1.2 / §1.3 锚点不一致，以实测为准并在偏差表写清原锚点 / 实测值 / 理由。

---

## 4. 红线（违反即返工）

- **engine-core 零改动**：`git diff --stat HEAD -- src/engine-core` 为空；`boundary.spec.ts` 不改。
- **entity 文件零改动**：装饰器 / 列 / 索引 / 关系 / 软删口径保留；migration DDL 不动。
- **方法面纪律**：端口只收现有调用，不扩通用代理；不暴露 typeorm 句柄 / 查询选项 / 操作符；业务层不出现 entity 类名。
- **业务语义冻结**：service 公共签名不变；DTO / controller 路由不变；幂等与版本升级语义不变。
- 隐私：心理对话原文禁止进文档 / 日志 / console / crash report（只出码与计数）；本域日志只打 id / 计数 / 错误名。
- pnpm 命令规范：一律 `pnpm` / `pnpm exec`，禁止裸 `npx`。
- 不新增依赖；不越权加需求外功能；不自动 commit / push。

---

## 5. 闸门（填真实数字，禁止留空）

### 5.0 前置（命令规范，强制）

- 跑闸门前确认机器状态：记录是否有 `nest start --watch` / `vite dev` / `node dist/app` 常驻进程（墙钟可比性以用例数 / 文件数为准，不杀用户进程）；跑 `pnpm doctor:fs` 记录结果。
- 取证会话 PATH 先补 `D:\Apps\Git\cmd`（依赖外部命令的 spec 才不会假失败）。

### 5.1 收尾闸门（本单跑一次，记录真实命令 / exit / 数字）

| 闸门         | 命令                                                                    | 要求                                                                                                                           |
| ------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 盘读前置     | `pnpm doctor:fs`                                                        | exit 0，记录均值 ms/文件与 slow 占比                                                                                           |
| 根类型       | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` | 0 error                                                                                                                        |
| 构建类型     | `pnpm exec tsc -p tsconfig.build.json --noEmit`                         | 0 error                                                                                                                        |
| Lint（权威） | `pnpm lint`                                                             | 0 error，记录 warning 数（基线既有 1 条 e2e warning，范围外不修）                                                              |
| oxlint fast  | `pnpm lint:fast`                                                        | 0 warning / 0 error                                                                                                            |
| 定向 spec    | `pnpm exec vitest run test/consent/`（新端口替身 spec）                 | 全绿，记录用例数 / 文件数                                                                                                      |
| 全量测试     | `pnpm test`                                                             | exit 0；既有 **3289 例 / 196 文件**集合不减少、既有断言不改；记录总用例数、文件数、墙钟与机器状态；增量 = 本单新增 spec 用例数 |
| engine-core  | `git diff --stat HEAD -- src/engine-core`                               | 空                                                                                                                             |
| 范围隔离     | `git diff --name-only HEAD`                                             | 改动仅限 `src/consent/`、`test/consent/` 与交付文档；无 package.json / tsconfig / vitest 配置 / CI / 其他业务域改动            |
| 边界         | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                | 12 passed                                                                                                                      |
| 静态复核     | §3.2 四项 grep 证据                                                     | 逐条结果落交付记录                                                                                                             |

> 验收侧不重跑全量；执行方交付记录里的闸门数字 + CI 结果作为合并底线。

---

## 6. 交付记录（完成后写，路径固定）

`docs/worklog/completed/phase2.5/td17-consent-port-c2-batch1-implementation-2026-11-14.md`

内容必须含：

1. 本单做了什么（一句话：consent 域按 TD-13 四件套落地仓储端口，C2 推广第一批）；
2. 改动文件清单（新建 / 修改，逐个一句用途；端口粒度与理由）；
3. 端口方法面清单（接口 / token / 入参 / Row 类型 / 唯一调用方）；
4. 闸门表：命令 / exit code / 真实数字（error、warning、用例总数、文件数、墙钟与机器状态）；
5. typeorm 符号外泄复核表（受检文件逐个命中数）；
6. service 行为与改前对照表（幂等查重字段 / 首写时间保留 / 最新一条排序 / 版本匹配判定 / 回填条件 / 失败容忍 / DTO 转换）；
7. 边界确认：entity 文件零改动、DTO / controller / barrel 导出面 / 其他业务域 / migration / 配置未动；既有 spec 断言与 mock 语义未改；
8. 遗留项：§2 另案 C2/G / I / J / K / M / N 逐条登记；Actions 侧待复核点（若有）；
9. 一行 commit message 草稿（**不自己 commit / push**，等用户指令）。

---

## 7. 【交付回写清单】做完逐项勾选（硬清单，不许跳）

- [x] 交付记录已写到 §6 固定路径
- [x] 本任务单从 `pending/` 移到 `completed/phase2.5/`，顶部状态行改 ✅ 并链交付记录
- [x] 回写 WP 登记表：`docs/worklog/pending/phase2.5-wp-list-2026-11-08.md` §四 TD-17 行改完成态、补交付记录链接
- [x] 回写阶段入口：`docs/worklog/pending/phase2.5-README.md` §3 TD-17 bullet 改完成态
- [x] 回写台账：`docs/team/gate-performance-remediation-2026-11-11.md` §9 P-DEBT-11 行追加 C2 第一批落地结论 + 链接；更新记录补一条；另案 C2/G/I/J/K/M/N 登记口径更新
- [x] `git diff --stat HEAD -- src/engine-core` 为空；`src/migration/` 零改动
- [x] 提交分组核对：本单文件与并行进程产物分开；若授权代提交，stage 只含本单文件
- [x] 给一行 commit message 草稿（**不自己 commit / push**，等用户指令）

---

## 8. 回复输出约定

完成后在对话里：

1. 说一句"已写入交付记录"并附文件路径，不重复贴全文；
2. 报告闸门真实数字（tsc / eslint / vitest 用例数 / boundary）；
3. 报告本单结论一句话（consent 端口化完成、spec 零 entity import）+ §7 回写清单哪几项已做、有没有遗留；
4. 不把代码 diff 全文贴进对话，让用户自己 `git diff` / 打开交付记录。

---

_本单不新增第三方依赖；不改 schema / migration；仅 consent 域仓储端口化 + 新增端口替身 spec；engine-core 零 diff；未自动 commit / push。_
