# TD-15 · C+ 枚举外移最小切口（P-DEBT-11 / L-1 · TD-14 推荐路线第一段）

> 状态：✅ **已交付**（2026-11-14，MiniMax Code）→ [交付记录](td15-enum-extraction-cplus-implementation-2026-11-14.md) · [上游备忘](../../../architecture/entity-typeorm-decoupling-assessment-2026-11-14.md)
> 仓库：E:\Work\Project\backend\mofang-nestjs，分支 integrate
> 唯一事实源：`docs/team/gate-performance-remediation-2026-11-11.md` §9 **P-DEBT-11**（L-1）+ `docs/architecture/entity-typeorm-decoupling-assessment-2026-11-14.md`（TD-14 备忘）+ `docs/worklog/completed/phase2.5/td14-entity-typeorm-decoupling-assessment-implementation-2026-11-14.md` §七（另案 G–L）
> 任务性质：**实现单（最小切口 C+）** —— 3 个定义在 entity 文件内的枚举外移到独立纯枚举文件，同步改引用点；解除"枚举值 → entity 文件 → typeorm 装饰器求值"这条传递边
> 改动范围：`src/analytics/`、`src/user/`、`src/shared/infra/queue/` 与对应 `test/` 引用点 + 交付文档；`engine-core/`、`src/migration/`、配置、CI、前端不碰

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `E:\Work\Project\backend\mofang-nestjs\README.md` —— 仓库总览
2. `E:\Work\Project\backend\mofang-nestjs\docs\README.md` —— 文档导航
3. `E:\Work\Project\backend\mofang-nestjs\docs\team\conventions.md` —— 代码红线 + 交付格式（§1.1 engine-core 分层、§1.3 pnpm 命令规范、§三 16 条硬约束、§2.5 偏差登记）
4. 阶段工作入口：`docs/worklog/pending/phase2.5-README.md` 与 `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md`
5. 根因与既往结论：
   - `docs/architecture/entity-typeorm-decoupling-assessment-2026-11-14.md` §1.3（决定性事实）、§5（推荐路径 C + C+）、§6.1（C+ 行：规模与产出）
   - `docs/worklog/completed/phase2.5/td14-entity-typeorm-decoupling-assessment-implementation-2026-11-14.md` §2.4（口径偏差表）、§七（另案 G–L）
   - `docs/worklog/completed/phase2.5/td13-repository-port-analytics-pilot-implementation-2026-11-14.md` §5.4（TD-13 实测边界：service 直接边已解、测试闭包未解）
   - `docs/adr/0003-typeorm-migration-replace-synchronize.md`（手写 DDL、禁用 synchronize 的既有纪律）
6. 本任务单（就是你在读的这份）

---

## 1. 背景（先读，方向别错）

TD-14 评估结论：推荐**路径 C（Row 纯类型 + 持久化分层映射）+ 配套 C+（枚举外移）**；C+ 是推荐路线第一段，也是 C1 域级试点的前置样板。

**机制**：entity 文件在模块加载期由 TypeORM 装饰器求值（`@Entity` / `@Column` / 关系装饰器），把 `typeorm` 运行时拉进传递闭包。业务代码或 spec 只要**值位置**导入定义在 entity 文件里的枚举，entity 文件即被加载、顶层装饰器随之求值，typeorm 经传递闭包进入。把枚举移到**零 typeorm 依赖**的独立文件后，只需枚举值的引用方不再加载 entity 文件，这条边即解除。

### 1.1 三个枚举与落点（主控取证锚点，HEAD `36b3bb8`；执行方复核并登记偏差）

| 枚举                 | 源 entity 文件:行                                     | 新枚举文件                                         | entity 装饰器是否引用枚举值                                   |
| -------------------- | ----------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------- |
| `AnalyticsEventType` | `src/analytics/entities/analytics-event.entity.ts:30` | `src/analytics/enums/analytics-event-type.enum.ts` | **是**：`@Column({ type: 'enum', enum: AnalyticsEventType })` |
| `OAuthProvider`      | `src/user/entities/oauth-identity.entity.ts:9`        | `src/user/enums/oauth-provider.enum.ts`            | 否：`provider` 列为 `varchar`，枚举仅作字段 TS 类型           |
| `AuditEvent`         | `src/user/entities/audit-log.entity.ts:21`            | `src/user/enums/audit-event.enum.ts`               | 否：`event` 列为 `varchar`，枚举仅作字段 TS 类型              |

落点目录沿用仓内主流先例（各业务域根级 `enums/` 目录，如 `src/counselor/enums/`、`src/inner_world/enums/`、`src/knowledge-base/enums/`、`src/life-map/enums/`）；文件名 `kebab-case.enum.ts`。

### 1.2 引用文件清单（主控实测；执行方逐个复核值位置 / 类型位置并登记偏差）

**`AnalyticsEventType`**

| 文件                                                              | import 行 | 形态                                                                                |
| ----------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------- |
| `src/analytics/providers/analytics.service.ts`                    | L28       | 值位置                                                                              |
| `src/analytics/providers/analytics-event-tracker.service.ts`      | L26       | 值位置                                                                              |
| `src/analytics/domain/repositories/analytics-event.repository.ts` | L29       | `import type`（类型位置）                                                           |
| `src/analytics/data/analytics-event.repository.typeorm.ts`        | L30       | **混 import**：`AnalyticsEvent`（entity 类，值）+ `type AnalyticsEventType`（类型） |
| `src/knowledge-base/providers/knowledge.service.ts`               | L42       | 值位置（跨域引用 analytics 枚举）                                                   |
| `test/analytics/td13-analytics-repository-port.spec.ts`           | L28       | 值位置（**另案 L：TD-13 残留测试闭包**，本单直接解除）                              |

**`OAuthProvider`**

| 文件                                 | import 行 | 形态                                                                         |
| ------------------------------------ | --------- | ---------------------------------------------------------------------------- |
| `src/user/oauth/oauth.service.ts`    | L17       | **混 import**：`OAuthIdentity`（entity 类，值）+ `OAuthProvider`（枚举，值） |
| `src/user/oauth/oauth.controller.ts` | L11       | 值位置                                                                       |

**`AuditEvent`**

| 文件                                            | import 行 | 形态                                                                 |
| ----------------------------------------------- | --------- | -------------------------------------------------------------------- |
| `src/user/providers/user.service.ts`            | L18       | 值位置                                                               |
| `src/user/providers/audit-log.service.ts`       | L5        | 值位置                                                               |
| `src/user/cron/soft-delete.cron.ts`             | L8        | 值位置                                                               |
| `src/shared/infra/queue/audit-log.processor.ts` | L6        | **混 import**：`AuditLog`（entity 类，值）+ `AuditEvent`（枚举，值） |
| `test/user/set-password-first-set.spec.ts`      | L54       | 值位置                                                               |
| `test/helpers/user-stub.ts`                     | L19       | 值位置（共享夹具 helper）                                            |
| `test/base/auth-reset-password.spec.ts`         | L38       | 值位置                                                               |

合计：src **11** 文件 + test **4** 文件 + **3** 个 entity 文件本身。混 import 共 **3** 条（repository.typeorm / oauth.service / audit-log.processor），需拆为两条：entity 类仍走 `entities/` 路径，枚举走新 `enums/` 路径。

### 1.3 barrel 导出

- `src/user/index.ts` L14–17 re-export `audit-log.entity.js` 与 `oauth-identity.entity.js`（值 + type）。枚举移出 entity 文件后，在该 barrel **补枚举的 `export *` 与 `export type *`**（从新 `enums/` 文件），保持对外导出面不缩窄；执行方需 grep 复核是否有消费方经 barrel（目录路径）导入这两个枚举，有则一并兼容。
- `src/analytics/` 无 barrel（无 `index.ts`），无需处理。
- `src/shared/infra/queue/index.ts` 仅 re-export processor，不直接导出枚举。

### 1.4 基线闸门（HEAD `36b3bb8`，TD-14 交付后）

全量 **3259 passed + 4 skipped（3263 例 / 195 文件）**；lint **0 error / 1 warning**（`test/e2e/v2-user-flow.spec.ts:1` 既有 unused eslint-disable，范围外不修）；lint:fast / deep **0 / 0**；boundary **12 passed**；根 tsc / build tsc **0 error**；`git diff --stat HEAD -- src/engine-core` 为空。

---

## 2. 范围（严格遵守，不越权）

### 在范围内

1. **新增 3 个枚举文件**（路径见 §1.1）：枚举成员名与字符串值**逐字不变**；文件内**零** `typeorm` / `@nestjs/typeorm` import，不引用任何 entity 类，保持纯枚举定义（无装饰器、无 Nest、无 `process.env`、无网络）。
2. **3 个 entity 文件**改为从新 `enums/` 文件 import 枚举：
   - `AnalyticsEventType`：装饰器 `@Column({ enum: ... })` 需要枚举值，走值 import；
   - `OAuthProvider` / `AuditEvent`：仅字段 TS 类型位置，优先 `import type`，按编译与运行时需要最小化值 import。
3. **引用点改 import 路径**（§1.2 清单）；3 条混 import 拆为 entity 类（`entities/` 路径）+ 枚举（`enums/` 路径）两条。
4. **barrel 兼容**：`src/user/index.ts` 补枚举 re-export，导出面不缩窄（§1.3）。
5. **解除另案 L**：`test/analytics/td13-analytics-repository-port.spec.ts` 改从新枚举路径导入 `AnalyticsEventType`，不再 import `analytics-event.entity.js`。
6. **文档与索引回写**（§7 清单）：交付记录、任务单归档、wp-list / README / 台账完成态回写。

### 明确不在范围内（禁止顺手做）

- **entity 类的值位置边不在本单**：`AnalyticsEvent` / `OAuthIdentity` / `AuditLog` 作为 DI token / 值对象被 service、processor、spec 值位置引用的边，属 C1 / C2（路径 C 域级落地），本单一律不动。
- 不做仓储端口化、Row 分层映射、纯类 / EntitySchema 改造；不改装饰器、列定义、索引、关系映射。
- 不改 migration DDL、不改枚举字符串值、不改 DTO、controller 路由、业务语义；不新增 / 调整 DB 列。
- `src/engine-core/` 一行不动；`test/engine-core/boundary.spec.ts` 不改。
- 不新增第三方依赖；不改 `package.json`（scripts 与依赖）、tsconfig、`vitest.config.mts`、Dockerfile、CI `.github/workflows/`。
- 不改既有 spec / 夹具 / helper 的断言期望与 mock 语义；不为其他模块补测试。若执行方判定需要补一条"枚举文件零 typeorm import"静态守护 spec，必须在交付记录写明增量用例数与文件，不得静默新增。
- 不碰 `admin-dashboard/` 与 Flutter；不自动 git commit / push（写完给 commit 草稿，等用户指令）。

### 另案登记（本单不做，写入交付记录遗留段）

- **C1 试点域**：选 1 个扁平、无跨模块仓储消费、entity 无枚举的域，按 TD-13 四件套落地；候选排序 life-map → quality → home / inner_world / ai-engine（TD-14 备忘 §6.2）。前置 = 本单 C+ 验收通过。
- **C2 / G 推广**：其余 service 端口化分批推广，每批带"spec 零 entity 值位置 import"验收；收益口径以 TD-14 备忘 §5.3 为准（不再以加载图减重为 KPI）。
- **I** 端口内存实现是否补；**J** 混合形态 typeorm import 统一形态；**K** CLI `entities` glob 口径脱节 —— 沿用 TD-14 交付记录 §七登记，本单不清理。

---

## 3. 目标交付物

### 3.1 代码改动（src + test 引用点）

- 3 个新枚举文件；3 个 entity 文件 import 调整；§1.2 清单 15 个引用文件改路径（含 3 条混 import 拆分）；`user/index.ts` barrel 补导出。
- 改动保持业务语义零漂移：KPI 事件串、审计事件串、provider 串与成员名逐字不变。

### 3.2 静态复核证据（grep 复核，结果落交付记录）

1. 3 个枚举文件内 `typeorm` / `@nestjs/typeorm` import = **0**；不引用 entity 类。
2. `test/analytics/td13-analytics-repository-port.spec.ts` 不再 import `analytics-event.entity.js`（另案 L 实测解除）。
3. 按枚举名 grep，原 `entities/` 路径下的枚举 import 残留 = **0**（entity 文件自身除外）。
4. barrel 导出面复核：`user/index.ts` 导出的枚举在新路径可见；无断链。

### 3.3 交付记录（§6 固定路径）

含改动清单、闸门真实数字、引用点值 / 类型位置定性表、偏差登记（conventions §2.5）、边界确认（未动 entity 类值位置边）、遗留另案。

> **口径真相源**：引用位置定性以仓内实测为准；若与 §1.2 锚点不一致，以实测为准并在交付记录偏差表写清原锚点 / 实测值 / 理由。

---

## 4. 红线（违反即返工）

- **engine-core 零改动**：`git diff --stat HEAD -- src/engine-core` 为空；`boundary.spec.ts` 不改。
- **枚举值冻结**：成员名、字符串值逐字不变；业务语义零漂移。
- **枚举文件保持纯定义**：无装饰器、无 Nest 依赖、无 `process.env`、无网络、无 entity 类引用。
- 隐私：心理对话原文禁止进文档 / 日志 / console / crash report（只出码和计数）。
- pnpm 命令规范：一律 `pnpm` / `pnpm exec`，禁止裸 `npx`。
- 不新增依赖；不越权加需求外功能；不自动 commit / push。

---

## 5. 闸门（填真实数字，禁止留空）

### 5.0 前置（命令规范，强制）

- 跑闸门前确认机器状态：记录是否有 `nest start --watch` / `vite dev` / `node dist/app` 常驻进程（墙钟可比性以用例数 / 文件数为准，不杀用户进程）；跑 `pnpm doctor:fs` 记录结果。
- 取证会话 PATH 先补 git：`D:\Apps\Git\cmd`（依赖外部命令的 spec 才不会假失败）。

### 5.1 收尾闸门（本单跑一次，记录真实命令 / exit / 数字）

| 闸门         | 命令                                                                    | 要求                                                                                                                                   |
| ------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 盘读前置     | `pnpm doctor:fs`                                                        | exit 0，记录均值 ms/文件与 slow 占比                                                                                                   |
| 根类型       | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` | 0 error                                                                                                                                |
| 构建类型     | `pnpm exec tsc -p tsconfig.build.json --noEmit`                         | 0 error                                                                                                                                |
| Lint（权威） | `pnpm lint`                                                             | 0 error，记录 warning 数（基线既有 1 条 e2e warning，范围外不修）                                                                      |
| oxlint fast  | `pnpm lint:fast`                                                        | 0 warning / 0 error                                                                                                                    |
| 全量测试     | `pnpm test`                                                             | exit 0；既有 **3263 例 / 195 文件**集合不减少、既有断言不改；记录总用例数、文件数、墙钟与机器状态；若新增静态守护 spec，写明增量用例数 |
| engine-core  | `git diff --stat HEAD -- src/engine-core`                               | 空                                                                                                                                     |
| 范围隔离     | `git diff --name-only HEAD`                                             | 改动仅限 §1.1 / §1.2 / §1.3 列文件 + 交付文档；无 `package.json` / tsconfig / vitest 配置 / CI / 其他业务域改动                        |
| 边界         | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                | 12 passed                                                                                                                              |
| 静态复核     | §3.2 四项 grep 证据                                                     | 逐条结果落交付记录                                                                                                                     |

> 验收侧不重跑全量；执行方交付记录里的闸门数字 + CI 结果作为合并底线。

---

## 6. 交付记录（完成后写，路径固定）

`docs/worklog/completed/phase2.5/td15-enum-extraction-cplus-implementation-2026-11-14.md`

内容必须含：

1. 本单做了什么（一句话：C+ 枚举外移，3 枚举文件 + 引用点改路径，解除枚举经 entity 文件的传递边）；
2. 改动文件清单（新建 / 修改，逐个一句用途；含 3 条混 import 拆分说明）；
3. 引用点复核表：§1.2 清单逐文件值位置 / 类型位置定性，与锚点偏差写清；
4. 闸门表：命令 / exit code / 真实数字（error、warning、用例总数、文件数、墙钟与机器状态）；
5. 边界确认：未动 entity 类值位置边、未动装饰器 / 列 / DDL / DTO / 路由；既有 spec 断言与 mock 语义未改；
6. 静态复核 §3.2 四项证据；
7. 遗留项：§2 另案 C1 / C2 / G / I / J / K 逐条登记；另案 L（TD-13 spec 残留闭包）本单是否实测解除；Actions 侧待复核点（若有）；
8. 一行 commit message 草稿（**不自己 commit / push**，等用户指令）。

---

## 7. 【交付回写清单】做完逐项勾选（硬清单，不许跳）

- [x] 交付记录已写到 §6 固定路径
- [x] 本任务单从 `pending/` 移到 `completed/phase2.5/`，顶部状态行改 ✅ 并链交付记录
- [x] 回写 WP 登记表：`docs/worklog/pending/phase2.5-wp-list-2026-11-08.md` §四 TD-15 行改完成态、补交付记录链接
- [x] 回写阶段入口：`docs/worklog/pending/phase2.5-README.md` §3.0 TD-15 bullet 改完成态
- [x] 回写台账：`docs/team/gate-performance-remediation-2026-11-11.md` §9 P-DEBT-11 行追加 C+ 落地结论 + 链接；更新记录补一条；另案 C1 / C2 / G / I / J / K 登记；另案 L 若实测解除则标注关闭
- [x] `git diff --stat HEAD -- src/engine-core` 为空；`src/migration/` 零改动
- [x] 提交分组核对：本单文件与并行进程产物分开；若授权代提交，stage 只含本单文件
- [x] 给一行 commit message 草稿（**不自己 commit / push**，等用户指令）

> **执行方确认（2026-11-14，MiniMax Code）**：八项全部完成 —— 交付记录 `docs/worklog/completed/phase2.5/td15-enum-extraction-cplus-implementation-2026-11-14.md`、本任务单已归档且状态行改 ✅、wp-list §四 / phase2.5-README §3.0 / 台账 §9 三处回写完成（台账更新记录另补一条「TD-15 落地」，另案 C1 / C2 / G / I / J / K 登记，**L 标注关闭**，新增 **M**（entity 类值位置边）/ **N**（枚举零依赖静态守护））。闸门：根 tsc / build tsc **0 error**、lint **0 error 1 warning**（`test/e2e/v2-user-flow.spec.ts:1` 既有 unused eslint-disable，范围外未修）、lint:fast **0/0**、boundary **12 绿**、全量 **3259 passed + 4 skipped（3263 例 / 195 文件）**（与基线逐字一致，**未新增 spec**）、`git diff --stat HEAD -- src/engine-core` **空**、`src/migration/` **零 diff**、改动仅落 22 个代码文件 + docs。commit message 草稿见交付记录 §八（**未提交**）。

---

## 8. 回复输出约定

完成后在对话里：

1. 说一句"已写入交付记录"并附文件路径，不重复贴全文；
2. 报告闸门真实数字（tsc / eslint / vitest 用例数 / boundary）；
3. 报告本单结论一句话（3 枚举外移完成、另案 L 是否解除）+ §7 回写清单哪几项已做、有没有遗留；
4. 不把代码 diff 全文贴进对话，让用户自己 `git diff` / 打开交付记录。

---

_本单不新增第三方依赖；不改 schema / migration；仅枚举外移 + 引用点 import 路径调整 + 交付文档；未自动 commit / push。_
