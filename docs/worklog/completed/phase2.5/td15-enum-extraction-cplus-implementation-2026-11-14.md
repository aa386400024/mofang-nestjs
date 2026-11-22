# TD-15 · C+ 枚举外移最小切口 —— 交付记录

> 任务性质：**实现单（最小切口 C+）** —— 3 个定义在 entity 文件内的枚举外移到独立纯枚举文件，同步改引用点
> 仓库：E:\Work\Project\backend\mofang-nestjs，分支 integrate，基线 HEAD `36b3bb8`（TD-14 交付后）
> 任务单：[td15-enum-extraction-cplus-task-2026-11-14.md](td15-enum-extraction-cplus-task-2026-11-14.md)（已归档至本目录）
> 上游事实源：`docs/architecture/entity-typeorm-decoupling-assessment-2026-11-14.md`（TD-14 备忘）§1.3 / §5 / §6.1
> 执行方：MiniMax Code ｜ 交付日期：2026-11-14

---

## 一、本单做了什么

**一句话**：把定义在 3 个 entity 文件里的枚举（`AnalyticsEventType` / `OAuthProvider` / `AuditEvent`）外移到零 typeorm 依赖的独立纯枚举文件，15 个引用点改 import 路径（3 条混 import 拆两条）、`src/user/index.ts` barrel 补导出，**解除"枚举值 → entity 文件 → typeorm 装饰器求值"这条传递闭包边**，并顺带关闭 TD-14 登记的另案 L。

**另案 L 实测解除**：`test/analytics/td13-analytics-repository-port.spec.ts` 不再 import `analytics-event.entity.js`（grep 命中 = 0）⇒ **TD-13 只解除了 service 源码层的直接边、没解除测试闭包**这一状态，本单把它闭合。

**枚举值冻结实测**：三个枚举的成员名与字符串值逐字未变 —— `AnalyticsEventType` **7 条**、`OAuthProvider` **3 条**、`AuditEvent` **23 条**，HEAD 与工作区**逐字节一致**。

---

## 二、改动文件清单

### 2.1 新建（3 个，纯枚举定义）

| 文件                                               | 用途                                                                                                             |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `src/analytics/enums/analytics-event-type.enum.ts` | `AnalyticsEventType` 独立枚举（7 成员，成员名与字符串值逐字不变）                                                |
| `src/user/enums/oauth-provider.enum.ts`            | `OAuthProvider` 独立枚举（3 成员）                                                                               |
| `src/user/enums/audit-event.enum.ts`               | `AuditEvent` 独立枚举（23 成员，含原 4 条 `eslint-disable-next-line @typescript-eslint/naming-convention` 注释） |

> 三个文件均为**纯定义**：零 import 语句、零 typeorm / `@nestjs/typeorm` 依赖、不引用任何 entity 类、无装饰器 / 无 Nest / 无 `process.env` / 无网络。沿用仓内主流先例（`src/counselor/enums/`、`src/knowledge-base/enums/`、`src/life-map/enums/` 的 `kebab-case.enum.ts` 命名与域级根 `enums/` 落点）。

### 2.2 修改 —— 3 个 entity 文件（摘枚举 + 改 import，**装饰器 / 列 / 索引 / 关系一律未动**）

| 文件                                               | 改动                                                                                                                                                                                                                                           |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/analytics/entities/analytics-event.entity.ts` | 摘除 `AnalyticsEventType` 定义块（连同原 doc 注释一并迁到新文件），改 `import { AnalyticsEventType } from '../enums/analytics-event-type.enum.js'`（**值 import** —— 装饰器 `@Column({ type: 'enum', enum: AnalyticsEventType })` 需要枚举值） |
| `src/user/entities/oauth-identity.entity.ts`       | 摘除 `OAuthProvider` 定义块，改 `import type { OAuthProvider } from '../enums/oauth-provider.enum.js'`（**类型位置** —— `provider` 列是 varchar，枚举只作字段 TS 类型）                                                                        |
| `src/user/entities/audit-log.entity.ts`            | 摘除 `AuditEvent` 定义块，改 `import type { AuditEvent } from '../enums/audit-event.enum.js'`（**类型位置** —— `event` 列是 varchar）                                                                                                          |

### 2.3 修改 —— 15 个引用点（§1.2 清单，逐一改 import 路径）

| #   | 枚举                 | 文件                                                              | 形态                       |
| --- | -------------------- | ----------------------------------------------------------------- | -------------------------- |
| 1   | `AnalyticsEventType` | `src/analytics/providers/analytics.service.ts`                    | 值位置                     |
| 2   | `AnalyticsEventType` | `src/analytics/providers/analytics-event-tracker.service.ts`      | 值位置                     |
| 3   | `AnalyticsEventType` | `src/analytics/domain/repositories/analytics-event.repository.ts` | 类型位置（`import type`）  |
| 4   | `AnalyticsEventType` | `src/analytics/data/analytics-event.repository.typeorm.ts`        | **混 import → 拆两条**     |
| 5   | `AnalyticsEventType` | `src/knowledge-base/providers/knowledge.service.ts`               | 值位置（跨域引用）         |
| 6   | `AnalyticsEventType` | `test/analytics/td13-analytics-repository-port.spec.ts`           | 值位置（另案 L，本单解除） |
| 7   | `OAuthProvider`      | `src/user/oauth/oauth.service.ts`                                 | **混 import → 拆两条**     |
| 8   | `OAuthProvider`      | `src/user/oauth/oauth.controller.ts`                              | 值位置                     |
| 9   | `AuditEvent`         | `src/user/providers/user.service.ts`                              | 值位置                     |
| 10  | `AuditEvent`         | `src/user/providers/audit-log.service.ts`                         | 值位置                     |
| 11  | `AuditEvent`         | `src/user/cron/soft-delete.cron.ts`                               | 值位置                     |
| 12  | `AuditEvent`         | `src/shared/infra/queue/audit-log.processor.ts`                   | **混 import → 拆两条**     |
| 13  | `AuditEvent`         | `test/user/set-password-first-set.spec.ts`                        | 值位置                     |
| 14  | `AuditEvent`         | `test/helpers/user-stub.ts`                                       | 值位置                     |
| 15  | `AuditEvent`         | `test/base/auth-reset-password.spec.ts`                           | 值位置                     |

**3 条混 import 的拆分口径**（entity 类留在 `entities/` 路径，枚举走新 `enums/` 路径）：

| 文件                                                       | 改前                                                                                               | 改后                                                                                                                                                            |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/analytics/data/analytics-event.repository.typeorm.ts` | `import { AnalyticsEvent, type AnalyticsEventType } from '../entities/analytics-event.entity.js';` | `import { AnalyticsEvent } from '../entities/analytics-event.entity.js';`<br>`import type { AnalyticsEventType } from '../enums/analytics-event-type.enum.js';` |
| `src/user/oauth/oauth.service.ts`                          | `import { OAuthIdentity, OAuthProvider } from '../entities/oauth-identity.entity.js';`             | `import { OAuthIdentity } from '../entities/oauth-identity.entity.js';`<br>`import { OAuthProvider } from '../enums/oauth-provider.enum.js';`                   |
| `src/shared/infra/queue/audit-log.processor.ts`            | `import { AuditEvent, AuditLog } from '../../../user/entities/audit-log.entity.js';`               | `import { AuditLog } from '../../../user/entities/audit-log.entity.js';`<br>`import { AuditEvent } from '../../../user/enums/audit-event.enum.js';`             |

> import 位置的调整遵循仓内 ESLint `import/order`（`groups: [[builtin, external], [internal, parent, sibling, index]]` + `alphabetize: asc`）：相对路径按 `/` 分段比较（`./` < `../` < 同级字母序），故 `entities/` → `enums/` 的迁移在每个文件里的落点均已按分段序重排，`pnpm lint` 实测 **0 error / 1 warning**（warning 为既有基线，见 §四）。

### 2.4 修改 —— barrel（1 个）

| 文件                | 改动                                                                                                                                                                                                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/user/index.ts` | 在既有 entity re-export 之后**追加** 4 行：`export type * from './enums/audit-event.enum.js';` + `export * from './enums/audit-event.enum.js';` + `export type * from './enums/oauth-provider.enum.js';` + `export * from './enums/oauth-provider.enum.js';` ⇒ 枚举移出 entity 文件后，**对外导出面不缩窄**（沿用文件既有的 `export type *` + `export *` 成对写法） |

### 2.5 变更面统计

- **代码文件 22 个**：新建 3 + 修改 19（3 entity + 15 引用点 + 1 barrel）。
- **文档**：交付记录 + 归档任务单 + 3 处索引回写。
- **零改动**：`src/engine-core/`、`src/migration/`、`package.json`、`tsconfig*.json`、`vitest.config.mts`、CI、前端、`admin-dashboard/`。

---

## 三、引用点复核表（§1.2 锚点 vs 实测）

> 口径：值位置 = 非 `import type` 的导入；类型位置 = `import type`。判定按 import 语句本身，不按被引用符号的用法。

| 枚举                 | 文件                                                              | 锚点行 | 实测行  | 锚点形态        | 实测形态                           | 偏差          |
| -------------------- | ----------------------------------------------------------------- | ------ | ------- | --------------- | ---------------------------------- | ------------- |
| `AnalyticsEventType` | `src/analytics/providers/analytics.service.ts`                    | L28    | **L28** | 值位置          | 值位置                             | ✅ 0          |
| `AnalyticsEventType` | `src/analytics/providers/analytics-event-tracker.service.ts`      | L26    | **L26** | 值位置          | 值位置                             | ✅ 0          |
| `AnalyticsEventType` | `src/analytics/domain/repositories/analytics-event.repository.ts` | L29    | **L29** | `import type`   | `import type`                      | ✅ 0          |
| `AnalyticsEventType` | `src/analytics/data/analytics-event.repository.typeorm.ts`        | L30    | **L30** | 混 import       | 混 import（entity 值 + 枚举 type） | ✅ 0          |
| `AnalyticsEventType` | `src/knowledge-base/providers/knowledge.service.ts`               | L42    | **L42** | 值位置          | 值位置                             | ✅ 0          |
| `AnalyticsEventType` | `test/analytics/td13-analytics-repository-port.spec.ts`           | L28    | **L28** | 值位置          | 值位置                             | ✅ 0          |
| `OAuthProvider`      | `src/user/oauth/oauth.service.ts`                                 | L17    | **L17** | 混 import       | 混 import（两个都值位置）          | ✅ 0          |
| `OAuthProvider`      | `src/user/oauth/oauth.controller.ts`                              | L11    | **L11** | 值位置          | 值位置                             | ✅ 0          |
| `AuditEvent`         | `src/user/providers/user.service.ts`                              | L18    | **L18** | 值位置          | 值位置                             | ✅ 0          |
| `AuditEvent`         | `src/user/providers/audit-log.service.ts`                         | L5     | **L5**  | 值位置          | 值位置                             | ✅ 0          |
| `AuditEvent`         | `src/user/cron/soft-delete.cron.ts`                               | L8     | **L8**  | 值位置          | 值位置                             | ✅ 0          |
| `AuditEvent`         | `src/shared/infra/queue/audit-log.processor.ts`                   | L6     | **L6**  | 混 import       | 混 import（两个都值位置）          | ✅ 0          |
| `AuditEvent`         | `test/user/set-password-first-set.spec.ts`                        | L54    | **L54** | 值位置          | 值位置                             | ✅ 0          |
| `AuditEvent`         | `test/helpers/user-stub.ts`                                       | L19    | **L19** | 值位置          | 值位置                             | ✅ 0          |
| `AuditEvent`         | `test/base/auth-reset-password.spec.ts`                           | L38    | **L38** | 值位置          | 值位置                             | ✅ 0          |
| **合计**             | src **11** + test **4**                                           | ——     | ——      | 混 import **3** | 混 import **3**                    | **偏差 0 处** |

### 3.1 偏差登记（conventions §2.5）

**本单与 §1.2 主控锚点的偏差 = 0 处**：15 个引用点的文件清单、import 行号、值 / 类型位置定性、3 条混 import 的构成全部**逐字一致**。

| 锚点项                            | 锚点值                                                | 实测值                   | 判定 |
| --------------------------------- | ----------------------------------------------------- | ------------------------ | ---- |
| `AnalyticsEventType` 源位置       | `src/analytics/entities/analytics-event.entity.ts:30` | **同**                   | ✅   |
| `OAuthProvider` 源位置            | `src/user/entities/oauth-identity.entity.ts:9`        | **同**                   | ✅   |
| `AuditEvent` 源位置               | `src/user/entities/audit-log.entity.ts:21`            | **同**                   | ✅   |
| 引用文件数                        | src 11 + test 4 = 15                                  | **src 11 + test 4 = 15** | ✅   |
| 混 import 条数                    | 3                                                     | **3**                    | ✅   |
| barrel 落点                       | `src/user/index.ts` L14–17 补导出                     | **同**                   | ✅   |
| `src/analytics/` 有无 barrel      | 无 `index.ts`                                         | **确认无**               | ✅   |
| `src/shared/infra/queue/index.ts` | 仅 re-export processor                                | **确认不导出枚举**       | ✅   |

**唯一与任务单表述有出入的一处（已在 §五 登记）**：§3.2 静态复核第 1 条要求"枚举文件内 typeorm / `@nestjs/typeorm` import = 0"，实测 **import 语句 = 0**；但三个枚举文件的**文件头注释**里各出现 5 处 "typeorm" 字样、2 处 "entities/" 字样 —— 那是"为什么必须零 typeorm 依赖"的规则说明文案（仓内 `// V<date> 治本` + 反双胞胎 / 如何验证三段式注释风格要求），**不是依赖**。复核口径按 import 语句计，见 §六 第 1 条。

---

## 四、闸门表（真实数字）

| 闸门         | 命令                                                                    | exit  | 真实数字                                                                                                                                                                                |
| ------------ | ----------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 盘读前置     | `pnpm doctor:fs`                                                        | **0** | per-file 均值 **0.15 ms/文件**；warm 29 ms / 200 文件 / slow **0**；cold 147 ms / slow 6；判定「**合格**（读取延迟正常，闸门数字可信）」                                                |
| 根类型       | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` | **0** | **0 error**                                                                                                                                                                             |
| 构建类型     | `pnpm exec tsc -p tsconfig.build.json --noEmit`                         | **0** | **0 error**                                                                                                                                                                             |
| Lint（权威） | `pnpm lint`                                                             | **0** | **0 error / 1 warning**（`test/e2e/v2-user-flow.spec.ts:1` unused eslint-disable —— **HEAD 既有基线**，范围外未修）                                                                     |
| oxlint fast  | `pnpm lint:fast`                                                        | **0** | **0 warning / 0 error**                                                                                                                                                                 |
| 全量测试     | `pnpm test`                                                             | **0** | **194 passed / 1 skipped（195 文件）**、**3259 passed / 4 skipped（3263 例）**、Duration **112.31 s**；与基线 **3263 例 / 195 文件逐字一致**；**本单未新增 spec（增量 0 例 / 0 文件）** |
| engine-core  | `git diff --stat HEAD -- src/engine-core`                               | **0** | **空**                                                                                                                                                                                  |
| migration    | `git diff --stat HEAD -- src/migration/`                                | **0** | **空**                                                                                                                                                                                  |
| 范围隔离     | `git diff --name-only HEAD`                                             | **0** | **22 个文件** = 3 个 docs（台账 / phase2.5-README / wp-list，**主控 TD-15 立项回写**）+ 19 个代码文件；**无** `package.json` / tsconfig / vitest 配置 / CI / 其他业务域改动             |
| 边界         | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                | **0** | **12 passed**（1 文件 / 1.51 s）                                                                                                                                                        |
| 静态复核     | §3.2 四项 grep 证据                                                     | ——    | 逐条结果见 §六                                                                                                                                                                          |

### 4.1 机器状态（墙钟可比性）

- 跑闸门时本机有 **5 个 node 常驻进程**（`pnpm start:dev` / `nest start --watch` / `pnpm dev` / `admin-dashboard` 的 vite / `node dist/app`）。**未擅自终止用户进程**。
- 因此全量 **112.31 s** 与历史基线（TD-14 实测 95.06 s、TD-11 约 66 s）**不可直接比较**（机器不干净，见 P-DEBT-7）；**可比口径是用例数与文件数** —— 本单 **3263 例 / 195 文件**，与基线**逐字一致**。
- 取证会话 PATH 已补 `D:\Apps\Git\cmd`（依赖外部命令的 spec 才不会假失败）。

---

## 五、边界确认（任务单 §2 明确不在范围内的，逐条确认未越权）

| 边界项                               | 确认结果                                                                                                                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **entity 类的值位置边**              | ✅ **未动** —— `AnalyticsEvent` / `OAuthIdentity` / `AuditLog` 三个实体类仍被 service / processor / spec **值位置** import（`@InjectRepository` token 边依旧），属 C1 / C2 |
| 装饰器 / 列定义 / 索引 / 关系映射    | ✅ **未动** —— 三个 entity 文件的装饰器计数 HEAD 与工作区**完全相同**（10 / 15 / 12）；diff 只见"枚举块删除 + import 增行"                                                 |
| 枚举成员名与字符串值                 | ✅ **逐字未变** —— 7 / 3 / 23 条成员逐字节比对一致                                                                                                                         |
| migration DDL / DB 列                | ✅ 未动（`src/migration/` diff 空）                                                                                                                                        |
| DTO / controller 路由 / 业务语义     | ✅ 未动                                                                                                                                                                    |
| 仓储端口化 / Row 分层 / EntitySchema | ✅ **未做** —— 那是 C1 / C2 / 路径 B 的事                                                                                                                                  |
| 既有 spec 断言与 mock 语义           | ✅ **未改** —— 用例数 3263 逐字不变、断言期望 0 处修改、**未新增 spec**                                                                                                    |
| `src/engine-core/`                   | ✅ **零 diff**，`boundary.spec.ts` 未改                                                                                                                                    |
| 依赖 / 配置 / CI / 前端              | ✅ 未新增依赖、未改 package.json / tsconfig / vitest 配置 / CI、未碰前端                                                                                                   |

---

## 六、静态复核证据（任务单 §3.2 四项）

**① 三个枚举文件零 typeorm 依赖、不引用 entity 类**

| 文件                                               | import 语句数 | `typeorm` import | `@nestjs/typeorm` import | entity 类 import |
| -------------------------------------------------- | ------------- | ---------------- | ------------------------ | ---------------- |
| `src/analytics/enums/analytics-event-type.enum.ts` | **0**         | **0**            | **0**                    | **0**            |
| `src/user/enums/oauth-provider.enum.ts`            | **0**         | **0**            | **0**                    | **0**            |
| `src/user/enums/audit-event.enum.ts`               | **0**         | **0**            | **0**                    | **0**            |

> 口径说明：按 **import 语句**计。三个文件的文件头注释里各有 5 处 "typeorm"、2 处 "entities/" 字样，属"为什么必须零依赖"的规则说明文案，不是 import。

**② TD-13 spec 不再 import entity（另案 L 实测解除）**

- `test/analytics/td13-analytics-repository-port.spec.ts` 中 `analytics-event.entity` 命中 = **0**（改前为 1 处值位置 import）。
- 该 spec 改从 `../../src/analytics/enums/analytics-event-type.enum.js` 导入 ⇒ **import 闭包不再经 entity 文件触达 typeorm**，另案 L **关闭**。

**③ 原 `entities/` 路径下的枚举 import 残留 = 0**

- 扫 `src/` + `test/` 全量 `.ts`：**RESIDUAL_COUNT = 0**（判据：同一 import 行同时命中 `entities/` 路径段与 `AnalyticsEventType` / `AuditEvent` / `OAuthProvider` 三个枚举名之一）。
- 三个 entity 文件自身已不再 `export` 任何枚举（原 `export enum` 已摘除），所以**连 entity 自身也没有残留导出**。

**④ barrel 导出面不缩窄、无断链**

- `src/user/index.ts` 中：`audit-event.enum` **2** 行（`export type *` + `export *`）、`oauth-provider.enum` **2** 行、`audit-log.entity` **2** 行（保留）、`oauth-identity.entity` **2** 行（保留）⇒ **枚举的对外可见性与改动前逐字等价**。
- 全仓复核：**无消费方经 `src/user/index.ts` 导入这两个枚举**（该 barrel 的消费方只取 `UserModule`），故导出面调整**不影响任何既有调用链**；`src/shared/user/index.ts` 是另一个模块，不涉及本单枚举。

---

## 七、遗留项与另案登记（本单不做）

| 编号        | 项                                                                                                                | 状态 / 口径                                                                                                                                                                           |
| ----------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C1**      | 试点域落地（扁平、无跨模块仓储消费、entity 无枚举；候选排序 life-map → quality → home / inner_world / ai-engine） | 🟠 **前置已满足** —— C+ 本单验收通过，C1 可启动（TD-14 备忘 §6.2）                                                                                                                    |
| **C2 / G**  | 其余 service 端口化分批推广，每批带"spec 零 entity 值位置 import"验收                                             | 🟠 待排期 —— 收益口径按 TD-14 备忘 §5.3（**不以加载图减重为 KPI**）                                                                                                                   |
| **I**       | 端口内存实现是否补                                                                                                | 🟢 暂不补 —— analytics 域无此需求                                                                                                                                                     |
| **J**       | 混合形态 typeorm import 文件统一形态                                                                              | 🟢 可读性向、零运行时收益 —— 另案批量处理                                                                                                                                             |
| **K**       | `bin/ormconfig.ts` 的 `entities` glob 口径脱节（CLI 看不到 99 个业务 entity）                                     | 🟠 独立既有债 —— 本单不清理                                                                                                                                                           |
| **L**       | TD-13 analytics spec 的残留测试闭包                                                                               | ✅ **本单实测解除并关闭** —— 静态复核第 2 条：不再 import entity 文件                                                                                                                 |
| **M（新）** | entity 类值位置边（`AnalyticsEvent` / `OAuthIdentity` / `AuditLog` 作为 DI token 被值位置引用）                   | 🟠 **归 C1 / C2** —— 本单明确不动；本单只切断"枚举 → entity"这一条边，entity 类本身的边要靠路径 C 的仓储下沉解除                                                                      |
| **N（新）** | "枚举文件零 typeorm 依赖"的**静态守护**                                                                           | 🟢 **本单未新增守护 spec**（守住"用例数 3263 逐字不变"这条闸门口径，守护证据走 §六 grep 四项 + lint）；建议在后续单里并入架构测试或 lint 规则，避免枚举文件将来被重新塞回 entity 目录 |

---

## 八、commit message 草稿（未提交，等指令）

```
feat(td15): C+ 枚举外移（3 个 entity 内枚举移到纯枚举文件 + 15 个引用点改路径，解除枚举经 entity 的 typeorm 传递边）
```

> 提交分组建议：本单**代码改动与交付文档可分两个 commit** —— 先 `feat(td15)` 提交 22 个代码文件，再 `docs(td15)` 提交交付记录 + 归档任务单 + 3 处索引回写；主控的 TD-15 立项回写（3 个已修改 docs 文件）建议**单独或与 docs 段合并**提交。**不自动 commit / push**。
