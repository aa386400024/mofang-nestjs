# WP58 后半段 交付记录 — 事件 + delta 审计观测

> 状态: ✅ 已交付（2026-11-06）
> 任务单: [wp58-turn-delta-audit-2026-11-06.md](wp58-turn-delta-audit-2026-11-06.md)
> 日期: 2026-11-06
> 红线: **engine-core 改 1 个文件**（`src/engine-core/index.ts` —— 仅 barrel 导出 `RuleBasedClassifier` + 文件头注释同步；任务单 §三 明确授权，边界断言 ⑥ 白名单同步更新；**内核逻辑零改动**）
> 大炮拍板: 无（本单全部按任务单 §三 方案落地；两处与任务单字面不符的地方按仓库既有范式落地并记录在 §2.1 / §2.2）

---

## 1. 开工前核实清单（任务单 §二，6 条全部核实）

| # | 任务单核实项 | 核实结果 | 证据 |
|---|---|---|---|
| 1 | `aggregateTurnDelta` 是 engine-core 公开 API | ✅ 确认 | `src/engine-core/index.ts:161` 在 `export { addDeltaVectors, aggregateTurnDelta, ... }` 里 |
| 2 | `RuleBasedClassifier` **不是** barrel 导出（需加一行） | ✅ 确认 | `src/engine-core/index.ts:10-12` 注释明写"为什么不导出规则实现（RuleBasedClassifier / 算子纯函数 / 默认常量）… 对外只暴露 EventClassifier 接口"；类型 `SessionEvent / ClassifyContext / EventClassifier` 已导出，**类未导出** |
| 3 | `EngineSessionRegistry` 可注入，能拿 sessionId / tenantId | ✅ 确认 | `engine-turn.service.ts` 里 `EngineSessionRegistry` 已是门面的构造依赖（`resolve(handleId) → TurnSessionContext`） |
| 4 | `TurnSessionContext` 里没有 sensitiveTopics | ✅ 确认 | 归属上下文只有 tenantId / sessionId / visitorId / 角色四字段；内核分类时用的 sensitiveTopics 来自 `runtime.characterProfile?.sensitiveTopics`（内核内部），适配层拿不到 |
| 5 | 现有 TypeORM entity 模式 | ✅ 已读 | 样板 = `supervision-report.entity.ts` + `session-evaluation.entity.ts`（JSON 列 / CreateDateColumn / 唯一索引注解） |
| 6 | `TypeOrmModule.forFeature` 要加在 `engine.module.ts` 里 | ⚠️ **与既有护栏冲突** | 见 §2.1 —— 任务单的这条会撞上 WP8-A §8-9 护栏，已按仓库既有范式落到独立模块 |

**核实过程中撞出 3 个任务单没写、但必须处理的问题**（§2.1 装配位置 / §2.3 delta 口径 / §2.4 内核才看得见的事件）。

---

## 2. 关键设计决策

### 2.1 ⚠️ 偏差 D1：`TypeOrmModule.forFeature` **不在** `engine.module.ts` —— 拆成独立模块

任务单 §十 交付物清单第 7 条写"`engine.module.ts` 加 `TypeOrmModule.forFeature([TurnDeltaAuditEntity])`"。**照做会撞红一条既有硬护栏**：

- 护栏在 `test/engine-adapters/wp8-wiring.spec.ts:543`（§8-9）：扫 `src/engine-adapters/wiring/` **顶层的 .ts**（`readdirSync(dir).filter(name => name.endsWith('.ts'))` —— **非递归**），命中 `typeorm` / `@nestjs/typeorm` 即红。
- `src/engine-adapters/wiring/engine.module.ts` 文件头把这条写成了硬约束："引擎装配层有一条硬约束 —— **不得直接依赖 ORM / 向量库 / 厂商 SDK**（WP8-A §8-9 单测按包名判定）。角色池必须连库，若把它的 provider 直接写在这里，本文件就得 import '@nestjs/typeorm' —— 护栏会红。"

**按仓库既有范式落地**（与 `CharacterPoolModule` **完全同款** —— 它当初也是为同一条护栏拆出来的）：

    src/engine-adapters/wiring/turn-delta-audit/     ← 子目录: 护栏扫描**非递归**, 子目录豁免
      turn-delta-audit.entity.ts      (TypeORM 实体)
      turn-delta-audit.service.ts     (观测服务)
      turn-delta-audit.config.ts      (env 开关装配)
      turn-delta-audit.port.ts        (窄接口 + DI token)
      turn-delta-audit.module.ts      (TypeOrmModule.forFeature + 端口绑定)

    engine.module.ts  →  imports: [ ..., TurnDeltaAuditModule ]   ← 只 import 模块 (相对路径), 零 SDK 包名
    admin-debug-chat.module.ts  →  imports: [ ..., TurnDeltaAuditModule ]   ← 读侧共用同一个模块

模块依赖方向单向、无环：`AppModule → AdminDebugChatModule → EngineWiringModule → TurnDeltaAuditModule`，`TurnDeltaAuditModule` 不 import 任何引擎/调试模块。

单测里专门加了一条回归断言钉死这一点（"装配层零 ORM 包名"：`engine.module.ts` 源码里不得出现 typeorm 的 import）。

### 2.2 ⚠️ 偏差 D2：engine-core 改 1 个文件（任务单 §九 写"零改动"，§三 写"加一行导出"）

任务单内部有一处自相矛盾：§九 闸门第 4 条写"engine-core 零改动（0 文件 0 行）"，而 §三 与 §十 明确要求"在 `engine-core/index.ts` barrel 里加一行导出 `RuleBasedClassifier`"。

按 §三 / §十 执行（那是**大炮明确授权的例外**，AGENTS.md §2.1 "例外必须由大炮在任务单里明确批准"）。实际改动：

- `src/engine-core/index.ts`：加 1 行 `export { RuleBasedClassifier } from './cognition/rule-based-classifier.js';` + 文件头"为什么不导出规则实现"那段注释同步改写（否则注释与代码自相矛盾）。
- `test/engine-core/boundary.spec.ts`：断言 ⑥ 的公开面白名单加 `'RuleBasedClassifier'`（该断言的注释明写"后续 WP 若要往 barrel 加公开导出, 必须**显式**更新这份白名单 —— 这是刻意的摩擦"）。

**内核逻辑零改动**：分类器本身一个字没动，决策与数值逐字不变。`git diff --stat HEAD -- src/engine-core` = 1 个文件 / +12 / -3（全是注释与 1 行导出）。

### 2.3 ⚠️ 偏差 D3：`aggregateTurnDelta(events)` → `aggregateTurnDelta(events, allianceConfig)`

任务单 §4.3 第 4 步写的是不带 alliance 参数的调用。但内核管线里事件的原始 delta 是 `aggregateTurnDelta(events, allianceConfig)`（`in-memory-engine-session.ts` 注入的 alliance 端口），**alliance 覆写会改 safety / bond 两维的系数**（25 个 `ENGINE_ALLIANCE_*` env 键）。

不带 alliance → 记下来的 safety / bond 与内核实际施加的**对不上**（差的就是 env 覆写的那部分）。观测一旦与内核漂移，它记的数就是**骗人的数** —— 那就白做了。

所以观测侧用**同一份 env 口径**解析 alliance（`resolveAllianceConfig(config)`，与 `engine.module.ts` 里喂内核的那份同源同值），聚合时一并传入。

### 2.4 ⚠️ 补齐：内核认得、本地分类器看不见的 `sensitive_touch`

内核分类时带了**角色的敏感议题词表**（`sensitiveTopics`，来自 characterProfile），适配层观测时拿不到（归属上下文里没这个字段）。后果：内核判出的 `sensitive_touch` 在本地分类里不会出现 → §2.3 的 delta 会**少一维贡献**。

处理：按内核给的**事件类型**补一条 `strength=1` 的事件（`matchedTerms` 留空 —— 命中词确实拿不到，本期只记类型不记词）。于是：

- `event_kinds` 与内核一致（含 sensitive_touch）；
- `raw_delta` 与内核实际施加的**逐字一致**；
- 静态词典事件**不会**漂移 —— 同一个分类器 + 同一段文本，本地与内核同源。

单测里钉死了这条：empathy + sensitive_touch 的 safety = 0.02 + (-0.01) = 0.01、arousal = -0.05 + 0.15 = 0.1。

### 2.5 写库走 `create + save`，**不用** `upsert`（typeorm 1.x 的 json 列坑）

本表三列都是 json。仓库里已有明确记录（`src/ai-engine/providers/ai-profile.service.ts` 文件头）：**typeorm 1.1.1 的 `repo.upsert` / `createQueryBuilder().insert()` 在 json / enum 列上会丢字段**（`extractUpsertSet` 严格按 metadata 取值 → json 列取到 undefined → 报 `ER_NO_DEFAULT_FOR_FIELD`）。

所以走仓库既有的那条路：`findOne`（按 tenant+session+turn 查）→ 有则复用那行、没有则 `create` → 赋值 → `save`（与 `supervision-report.repository.typeorm.ts` 同款）。副产品：**幂等天然成立** —— 重试覆盖同一行，不会堆行。

### 2.6 观测端口用**显式 token**（interface 当 token 会静默注入 undefined）

`TurnDeltaAuditPort` 是 interface —— 编译后没有运行时值，`emitDecoratorMetadata` 只能把它降级成 `Object`。不给显式 token 的话，Nest 会去容器里找一个叫 `Object` 的 provider，找不到就**静默注入 undefined**（症状：观测静默失效但接口照常 200 —— 与 `engine.tokens.ts` 里记的同一类坑）。

所以 `engine.tokens.ts` 的同款做法：`export const TURN_DELTA_AUDIT = Symbol('TURN_DELTA_AUDIT');`，门面用 `@Optional() @Inject(TURN_DELTA_AUDIT)` 注入。`@Optional()` 是因为观测是**增强**，装配缺席时只是"不记审计"，不能让整个引擎门面开不起来。

### 2.7 归属与轮次由**门面**传进观测端口（不是观测服务自己去查）

任务单 §4.3 写的是 `record(handleId, userText, output)`，让观测服务自己从 `EngineSessionRegistry` 拿归属。本单改成：

    record({ tenantId, sessionId, turnIndex, userText, kernelEventKinds })

理由：**模块依赖方向**。观测服务住在独立模块里（§2.1），若它自己依赖 `EngineSessionRegistry`，就得让审计模块 import 引擎装配模块 → `EngineWiringModule → TurnDeltaAuditModule → EngineWiringModule` 循环依赖（仓库 `forwardRef` 使用次数为 0，且 WP58 调试面板已经因为循环依赖拆过一次模块）。

改由门面传：门面的构造参数里**本来就有** `registry`（归属就在它旁边），turnIndex 直接取门面出参 `result.turnIndex`（与内核 `EngineTurnOutput.turnIndex` 同口径，从 1 起），`kernelEventKinds` 取 `result.events`（内核判出的事件种类，含 sensitive_touch —— §2.4 补齐要用）。

### 2.8 读端点：路径按任务单 §5.1，返回体外壳**只有这一个端点**带

- 路径：`GET /admin/api/debug/sessions/:sessionId/delta-audit`（**逐字按任务单 §5.1**）→ 落在 `DebugSessionController`（`@Controller('admin/api/debug')`）。
- 鉴权：class 级 `AdminRoleGuard` + `AdminBasicAuthMiddleware`（按控制器挂载）→ **新增端点自动继承**，不会漏。
- 返回：`{ code: 0, data: { sessionId, turns } }`（任务单 §5.1 的形状；`code=0` 正是 `BizCode.Success` 的口径，与全局错误体 `{ code, message, data: null }` 同族）。

⚠️ **本仓成功响应没有统一外壳**（`admin-dashboard/src/api/client.ts` 直接透传 `r.json()`，不取 `.data`），所以**这个端点是唯一要取 `.data` 的** —— 前端对接时别把外壳套到别的端点上。

### 2.9 租户：写侧带 `tenant_id`，读侧按 `session_id` 查

写侧的归属三元组里 `tenantId` 照记（唯一键含它：`(tenant_id, session_id, turn_index)`）。读侧只按 `session_id` 查 —— 与 admin 面的既有口径一致（`buildOwnerFilter`：管理员 basic 凭据 → **不过滤**，运维要看全场；学员身份才按 user_id 过滤）。本端点只有 admin 身份能进（class 级守卫），且审计行不带 `user_id`，学员级隔离在审计表上无处落地。

### 2.10 隐私：三类"不落"

- **不落咨询师原话** —— `userText` 只在内存里过一遍分类器，落库的只有命中词；
- **不落完整 BDI 快照** —— 只有 11 维 delta 向量，信念层 / 愿望层 / 记忆层一律不落；
- **心理内容不进日志** —— 本服务的日志只出定位信息（sessionId / turnIndex / 失败原因），**不打事件详情、不打 delta 数值**。

---

## 3. 实际改了哪些文件

### 3.1 新增（8）

| 文件 | 职责 |
|---|---|
| `src/engine-adapters/wiring/turn-delta-audit/turn-delta-audit.port.ts` | 窄接口 `TurnDeltaAuditPort` + DI token `TURN_DELTA_AUDIT` + 写侧/读侧载荷形状 |
| `src/engine-adapters/wiring/turn-delta-audit/turn-delta-audit.entity.ts` | `turn_delta_audits` 表实体（8 列 + 2 个索引注解） |
| `src/engine-adapters/wiring/turn-delta-audit/turn-delta-audit.config.ts` | env 开关装配（`TURN_DELTA_AUDIT_ENABLED` → `{ enabled }`） |
| `src/engine-adapters/wiring/turn-delta-audit/turn-delta-audit.service.ts` | 观测服务（跑分类器 → 聚合 delta → fire-and-forget 落库；+ 按会话读） |
| `src/engine-adapters/wiring/turn-delta-audit/turn-delta-audit.module.ts` | Nest 模块（`TypeOrmModule.forFeature` + 端口绑定 + 导出） |
| `src/migration/1714900000031-AddTurnDeltaAudits.ts` | 手写 DDL 建表（INFORMATION_SCHEMA 幂等守卫） |
| `test/engine-adapters/wp58-turn-delta-audit.spec.ts` | 单测 30 例（见 §5） |
| `docs/worklog/completed/phase2/engine-wp58-turn-delta-audit-implementation-2026-11-06.md` | 本交付记录 |

### 3.2 修改（10）

| 文件 | 改了什么 |
|---|---|
| `src/engine-core/index.ts` | **barrel 导出 `RuleBasedClassifier`**（1 行）+ 文件头注释同步（§2.2） |
| `test/engine-core/boundary.spec.ts` | 断言 ⑥ 公开面白名单加 `RuleBasedClassifier`（§2.2） |
| `src/engine-adapters/wiring/engine-turn.service.ts` | 两处观测点（`turn` / `turnStream`）+ 窄端口注入 + 私有 `auditTurn()` |
| `src/engine-adapters/wiring/engine.module.ts` | `imports` 加 `TurnDeltaAuditModule`（§2.1） |
| `src/admin-debug/debug-session.controller.ts` | 读端点 `GET sessions/:sessionId/delta-audit` + 返回体类型 + 注入观测服务 |
| `src/admin-debug/admin-debug-chat.module.ts` | `imports` 加 `TurnDeltaAuditModule`（读侧共用同一模块） |
| `src/migration/index.ts` | migration 登记（与 `bin/ormconfig.ts` 严格 1:1） |
| `bin/ormconfig.ts` | migration import + `migrations[]` 数组登记 |
| `.env.example` | 生效区加 `TURN_DELTA_AUDIT_ENABLED=false` |
| `typings/global.d.ts` | `ProcessEnv` 加 `TURN_DELTA_AUDIT_ENABLED?: string` 声明 |

### 3.3 移动（1）

`docs/worklog/pending/wp58-turn-delta-audit-2026-11-06.md` → `docs/worklog/completed/phase2/wp58-turn-delta-audit-2026-11-06.md`（状态行改为 ✅ 并指向本记录）

---

## 4. 数据表结构

`turn_delta_audits`（8 列 + 3 索引，手写 DDL，ADR-0003 禁 synchronize）：

| 列 | 类型 | 说明 |
|---|---|---|
| id | VARCHAR(36) PK | uuid |
| tenant_id | VARCHAR(64) NOT NULL DEFAULT 'default' | 租户隔离 |
| session_id | VARCHAR(128) NOT NULL | 业务会话 id |
| turn_index | INT NOT NULL | 轮次（从 1 起） |
| event_kinds | JSON NOT NULL | 本轮命中的事件类型（去重保序） |
| event_details | JSON NOT NULL | 每个事件的 kind / matchedTerms / strength |
| raw_delta | JSON NOT NULL | 聚合后的原始 delta（11 维） |
| created_at | DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP | 落库时刻 |

索引：`PRIMARY (id)` + `UNIQUE idx_turn_delta_audit_turn (tenant_id, session_id, turn_index)`（一场会话一轮一条）+ `KEY idx_turn_delta_audit_session (tenant_id, session_id)`。

**部署顺序：必须先 `migration:run` 再起服务** —— 否则运行时写入报 `Table 'turn_delta_audits' doesn't exist`。

---

## 5. 单测（新增 30 例，全绿）

`test/engine-adapters/wp58-turn-delta-audit.spec.ts` 覆盖五组：

1. **开关装配**（5 例）：缺省关 / true·1·yes·on·TRUE·空格归一 → 开 / 非法值回退关 / 读的是**字面量** env 键（env 覆盖断言的 AST 抽取看得到）。
2. **观测服务**（8 例）：开关关着**连分类器都不跑**（`findOne` / `save` 一次没调）/ 落库一行（类型 + 命中词 + 归属 + 轮次）/ **raw_delta 与内核 `DELTA_TABLE` 逐字一致**（11 维）/ 没命中记 neutral 且 delta 全零 / **sensitive_touch 按类型补齐**（类型有、命中词空、delta 是两份之和）/ 重试覆盖同一行（id 不变）/ 写库失败静默（不抛错）/ 排序交给 DB（`order: { turnIndex: 'ASC' }`）/ 无数据 → 空数组。
3. **装配**（4 例）：模块注册实体 + 端口绑定 `useExisting` + exports / 引擎装配模块引入它 / 调试面板模块引入它 / **engine.module.ts 零 ORM 包名**（护栏回归）。
4. **门面观测点**（5 例）：`turn()` 之后记一行（归属 + 轮次 + 原话 + 内核事件类型）/ `turnStream()` 之后也记 / 归属查不到静默跳过 / 观测端口抛错 turn() 照常返回 / 没装配端口照常跑。
5. **admin 读端点**（3 例）：路径 + 方法（前端契约）/ 返回体形状 / 无数据 → 空数组。

---

## 6. 闸门数字

| # | 闸门 | 要求 | 实测 |
|---|---|---|---|
| 1 | ESLint | 0 problem | ✅ **0 problem**（`npx eslint "{src,test,bin}/**/*.ts"`，全仓） |
| 2 | TypeScript | 0 error | ✅ **0 error**（`npx tsc -p tsconfig.build.json --noEmit`） |
| 3 | 单测 | 全量跑通，不新增失败 | ✅ **123 文件 / 2092 例全绿**（`npx vitest run --exclude "**/e2e/**/*.ts"`；其中本单新增 1 文件 / 30 例） |
| 4 | engine-core | 零逻辑改动 | ⚠️ **1 个文件**（`src/engine-core/index.ts`，+12 / -3）：1 行 barrel 导出 + 文件头注释同步（§2.2，任务单 §三 明确授权）。**内核逻辑零改动**，`boundary.spec.ts` 11 条断言全绿 |
| 5 | 开关 | 关着时零开销 | ✅ 关着时 `record()` **在跑分类器之前就 return**（单测断言 `findOne` / `save` 零调用） |
| 6 | 失败静默 | 写库失败不影响主链路 | ✅ 服务层 catch + 门面层再兜一层 try/catch（单测：`save` reject 时 `record()` 不抛、`turn()` 照常返回） |

---

## 7. 缺口与后续（别把这一单当成"观测全有了"）

| # | 缺口 | 说明 | 归属 |
|---|---|---|---|
| G1 | **生产缺省关** | `TURN_DELTA_AUDIT_ENABLED` 缺省 false → 生产环境**没有任何审计数据**。要排障必须先开这个 env | 运维 |
| G2 | **必须先跑 migration** | 部署顺序：`migration:run` → 再起服务 | 运维 |
| G3 | **前端面板未做** | 本期只做后端接口（任务单 §八 明确"不做前端面板"）。前端面板另开单 | 前端 AI |
| G4 | **sensitive_touch 的命中词拿不到** | 本期只记类型不记词（角色敏感议题词表不在适配层） | 后续单 |
| G5 | **读侧不按租户过滤** | 写侧带 `tenant_id`，读侧按 `session_id` 查（admin 内部运维口径，§2.9） | 后续单（多租户隔离要求更高时） |
| G6 | **delta cap 砍幅明细仍未落库** | 本单只记事件 + **原始** delta；砍幅明细仍只有 `DeltaCapLogger` 的日志（任务单 §八 明确"不存 cap_entries"） | 后续单 |
| G7 | **没存 final_delta（快照前后差值）** | 任务单 §八 明确不存（可由 BDI 状态表前后快照算） | 无 |
| G8 | **调试会话的观测与训练会话同表** | 调试会话的 tenantId 是 `debug`（`DEBUG_CHAT_TENANT_ID`），与训练会话不同租户但同表同索引 | 无（设计如此） |

---

## 8. 与任务单的对照（逐条）

| 任务单 §十 交付物 | 落地 | 偏差 |
|---|---|---|
| 1. engine-core barrel 导出 `RuleBasedClassifier` | ✅ `src/engine-core/index.ts` | 无（§2.2 解释了与 §九"零改动"的表述冲突） |
| 2. migration `1714900000031-AddTurnDeltaAudits.ts` | ✅ | 无（手写 DDL + INFORMATION_SCHEMA 幂等守卫） |
| 3. entity | ✅ | 位置落到 §2.1 的独立子目录 |
| 4. service | ✅ | 接口签名改了（§2.7） |
| 5. 配置 | ✅ | 无 |
| 6. 观测点挂载（turn + turnStream 两处） | ✅ | 无 |
| 7. module 注册：`engine.module.ts` 加 `TypeOrmModule.forFeature` | ⚠️ **落到独立模块** | **有**（§2.1 —— 照做会撞 WP8-A §8-9 护栏） |
| 8. admin 端点 | ✅ | 无（路径逐字按 §5.1；返回体外壳见 §2.8） |
| 9. 单测 | ✅ 30 例 | 无（任务单只写了文件名） |

---

## 9. 给大炮的 commit message 草稿

    feat(wp58): 事件 + delta 审计观测

    新增 turn_delta_audits 表, 存每轮事件类型 + matchedTerms + raw delta。
    adapter 层自观测 (复用内核公开 API), engine-core 仅 barrel 导出 RuleBasedClassifier。
    env 开关 TURN_DELTA_AUDIT_ENABLED 控制, 默认关闭。
    admin 接口: GET /admin/api/debug/sessions/:sessionId/delta-audit
