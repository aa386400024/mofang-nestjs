# GateDecisions · 闸门 trace 查询接口 —— 实现交付记录

> 任务单：[`phase2.5-gate-decisions-trace-api.md`](./phase2.5-gate-decisions-trace-api.md)
> 日期：2026-11-09
> 状态：✅ 已交付（前端契约已出，GateDecisions.vue 由前端另一个 AI 接）

---

## 一、改了哪些文件

### 新增（后端代码）

| 文件 | 职责 |
|---|---|
| `src/migration/1714900000038-CreateGateDecisions.ts` | 手写 DDL 建 `gate_decisions` 表（幂等：表不存在才建，已存在则补列） |
| `src/engine-adapters/deliberation-gate/gate-decision/gate-decision.entity.ts` | TypeORM 实体（`@Entity('gate_decisions')`，6 个索引） |
| `src/engine-adapters/deliberation-gate/gate-decision/gate-decision.store.ts` | MySQL 落库器（唯一写这张表的实现；写失败只 warn，绝不抛） |
| `src/engine-adapters/deliberation-gate/gate-decision/gate-decision-stats.ts` | 写时日计数器（Lua 原子累加，TTL 90 天）+ 读侧聚合（纯函数） |
| `src/engine-adapters/deliberation-gate/gate-decision/gate-decision-view.ts` | 查询口径纯函数：query 解析 / 校验 + 行 → 视图映射 + 上海时区 ISO |
| `src/admin-debug/gate-trace.controller.ts` | 3 个只读端点（列表 / 详情 / 按天统计） |
| `src/admin-debug/gate-trace.module.ts` | admin 端点模块（中间件 + class 级 guard + 实体注册） |

### 改动

| 文件 | 改了什么 |
|---|---|
| `src/engine-adapters/deliberation-gate/deliberation-gate.types.ts` | ① `GateMode` / `GateDecision` / `GateReason` 改为**清单推导**（新增 `GATE_MODE_VALUES` / `GATE_DECISION_VALUES` / `GATE_REASON_VALUES`，类型由清单推导，值域逐字不变）；② `GateInput` 增加 `dbSessionId` / `userId` 两个可选字段 |
| `src/engine-adapters/deliberation-gate/deliberation-gate.trace.ts` | ① `GateTraceRecord` 增加 `dbSessionId` / `userId`；② 新增窄端口 `GateDecisionPersistencePort`；③ `record()` 由"写 Redis"改为**三写**（Redis 热读 + Redis 日计数器 + MySQL 真相源），每处各自 try/catch |
| `src/engine-adapters/deliberation-gate/deliberation-gate.service.ts` | 透传两个会话口径到 trace（缺省写 NULL） |
| `src/engine-adapters/deliberation-gate/deliberation-gate.module.ts` | 装配 `GateDecisionStore`（`TypeOrmModule.forFeature([GateDecisionEntity])` + useFactory 注入） |
| `src/engine-adapters/rendering/turn-render-orchestrator.ts` | ① `TurnSessionContext` 增加 `dbSessionId?`；② 闸门入参带上 `dbSessionId` / `userId` |
| `src/engine-adapters/wiring/engine-turn.service.ts` | `open()` 选项增加 `dbSessionId?` → 登记进归属（条件展开） |
| `src/engine-adapters/wiring/engine-stream-backend.adapter.ts` | `openKernelSession` 透传 `opts.dbSessionId`（与既有 `dbSessionIds` 映射表**同源同口径**） |
| `src/app.module.ts` | 注册 `GateTraceModule` |
| `src/migration/index.ts` | 导出 `CreateGateDecisions1714900000038` |
| `bin/ormconfig.ts` | `import` + `migrations[]` 两处登记 0038（真注册点，漏登记会静默不建表） |

### 测试

| 文件 | 改了什么 |
|---|---|
| `test/admin-debug/gate-decisions.spec.ts`（新增） | 参数解析 / 视图映射 / 统计聚合 / 写侧三写 / 查询装配（双口径 + 学员隔离 + 分页） |
| `test/admin-debug/wp26-admin-role-guard.spec.ts` | **同步路由清单**：新增 `GateTraceController` 的 3 个端点断言 + `GateTraceModule` 的 guard / User 仓储断言 |
| `test/engine-adapters/deliberation-gate/quotas.spec.ts` | 假 Redis 补 `eval` / `getClient`（让"写侧三写"在既有单测里可跑，不断言口径） |

### 文档

- 本交付记录（`docs/worklog/completed/phase2.5/phase2.5-gate-decisions-trace-api-implementation-2026-11-09.md`）
- 任务单状态行改为 ✅ 并移到 `completed/phase2.5/`
- 回写 backlog 母版：`docs/worklog/pending/phase2.5-wp-list-2026-11-08.md`

---

## 二、关键设计决策（与任务单有出入的地方）

### B1 · `db_session_id` 由 BIGINT 改 **VARCHAR(36)**

- **任务单怎么写的**：`db_session_id BIGINT NULL COMMENT 'training_sessions.id（映射后）'`，响应 `dbSessionId: number | null`。
- **代码实际是什么**（grep 核实）：`src/counselor/entities/training-session.entity.ts` 的主键是 `@PrimaryGeneratedColumn('uuid') id!: string` → `training_sessions.id` 是 **uuid char(36)**，不是自增数字。
- **怎么改的**：列用 `VARCHAR(36)`，接口出 `dbSessionId: string | null`。
- **为什么**：把 uuid 塞进 BIGINT 列会**静默丢精度**（MySQL 会把非数字串截断成 0，或在严格模式下直接报错）—— 那会让 `dbSessionId` 变成一个**看起来有值、其实是垃圾**的 id，比 NULL 更危险。
- **⚠️ 前端契约影响**：`admin-dashboard/src/api/types.ts` 里 mock 的 `GateTraceRecord.dbSessionId: number | null` 与真实返回（`string | null`）冲突，前端要改成 `string | null`。**本单不写前端代码**（另一个 AI 的活）。

### B2 · 新增 `user_id` 列（任务单 DDL 没有）

- **任务单怎么写的**：`gate_decisions` DDL 里没有归属列，但硬约束要求"学员隔离走 `buildOwnerFilter` 同款口径"。
- **代码实际是什么**：`buildOwnerFilter(req)` 返回 `{ userId }` / `{}`，读侧要靠**本表自己的归属列**才能等值过滤。
- **怎么改的**：加 `user_id VARCHAR(36) NULL`，写侧取 `TurnSessionContext.userId`（voice 层带来的学员 uid，与 `training_sessions.user_id` 同一个口径）。
- **为什么**：不落归属列的话，隔离只有两条路 —— ① `join training_sessions` 反查（那是**另一套口径**，且自动对练根本没有落库会话，join 不上）；② 把闸门决策表按"无归属"处理（等于没有隔离）。硬约束要求"不能因为只读就绕过"，落一列是最直接、零歧义的做法。
- **自动对练的归属**：自动对练走 `debug-admin` 这个假身份（`admin-debug/debug-session.service.ts`），不是真实 uid → 这些行学员身份**看不到**（filter 是等值匹配，NULL / 非本人都被排除）。

### B3 · 新增 `recorded_day` 列（上海日键）

- **任务单怎么写的**：只有 `recorded_at DATETIME(3)`，按天筛选靠时间范围换算。
- **代码实际是什么**：`DATETIME` **没有时区**，而 mysql2 按**进程本地时区**序列化 Date 参数 —— 于是"上海日界"换算出来的边界在不同环境（dev 机器 UTC+8 / 生产容器 UTC）会落在**不同的墙上时间**上，同一批数据在不同环境落进不同的天（不可比）。
- **怎么改的**：写时把上海日键算好落进 `recorded_day VARCHAR(10)`，读侧按它做区间过滤（与统计侧日 key `gate_stats:global:YYYY-MM-DD` **完全对齐**）。
- **为什么**：仓库纪律是"**口径要写在数据里**，不能只靠看文档的人记得"。把日键落库，筛选就与环境时区无关，且列表和趋势图的分桶天然一致。

### B4 · `sessionId` 参数**双口径命中**，`dbSessionId` 参数只认落库 id

- **任务单怎么写的**：两个参数二选一（`sessionId` = 引擎侧，`dbSessionId` = 落库 id）。
- **代码实际是什么**：前端手上往往只有其中一种 id（甚至分不清是哪种）。
- **怎么改的**：`sessionId` 参数命中 `session_id` **或** `db_session_id` 任一列（`Brackets` OR 条件）；`dbSessionId` 参数仍**只**认 `db_session_id`（要精确查时用它）。
- **为什么**：把"我拿到的是哪种 id"的判断责任推给前端没有意义（前端也得靠猜）；后端认两种更稳，且不影响精确查询。

### B5 · 统计端点是**全局口径**，列表 / 详情按 `user_id` 隔离

- **任务单怎么写的**：没写统计的隔离口径。
- **代码实际是什么**：写时计数器是**全局**的（`gate_stats:global:{date}`，无归属维度）。
- **怎么改的**：列表 / 详情走 `buildOwnerFilter`（与 `/admin/api/sessions` 同款）；`/gate/stats` 全局。
- **为什么**：与仓库既有的 `GET /admin/api/deliberation/stats` **同款**（那边也是全局统计 + 过滤列表并存）。若统计按归属过滤，就得在写时计数器里再加一个归属维度 —— 那会让"每轮一次累加"变成"每轮 N 次"，且自动对练（无归属）的行无处安放。

### B6 · Redis trace 的 JSON 多了两个**可选**字段

- **怎么改的**：`DeliberationGateTrace.record()` 的 Redis 写入逻辑（key 构造 / 7 天 TTL）**逐字不变**，只是 JSON 里多了 `dbSessionId` / `userId`。
- **为什么**：双写要能对账（验收标准 ③"抽查 10 条对比"）—— 两个 id 都带上才好对。旧记录没有这两个键（读侧按缺省处理），**向后兼容**。

### B7 · `days` 超 90 天**截断**而不是报错

- **怎么改的**：`days > 90` → 截到 90；`days` 非法（非正整数）→ 400。
- **为什么**：日 key TTL 就是 90 天，再长的窗口**必然**没有数据 —— 截断即可，实际生效的窗口在响应 `dates` 的长度里**看得见**（不做静默兜底：非法值直接报错，不静默退回"全局累计"）。

### B8 · 详情端点**不跨到审议 trace**

- **按任务单要求执行**：不返回审议建议内容（含心理内容，越隐私红线）。详情只返回闸门自身字段（枚举 / 数值 / 阈值 / 耗时 / 时间戳）。

### B9 · 闸门模块可以碰 ORM（护栏不破）

- **任务单怎么写的**：`engine-core` 零改动；改动落在 `engine-adapters` + `admin-debug`。
- **代码实际是什么**：WP8-A §8-9 护栏只扫 `src/engine-adapters/wiring` **顶层** `.ts` 文件的**非相对 import 包名**（禁 `typeorm` / `@nestjs/typeorm` / 向量库 / 厂商 SDK）。
- **怎么改的**：ORM 依赖收在 `src/engine-adapters/deliberation-gate/gate-decision/`（子目录，**不在 wiring/**），与 `engine-adapters/eval/`（eval_reports 落库）**同款先例**；`wiring/` 顶层文件本次只改了相对路径内的代码，import 仍是相对路径。
- **为什么**：护栏的意图是"引擎装配层不许直接依赖 ORM"，而不是"整个 engine-adapters 不许落库"。闸门决策的真相源本就该在写侧那一层。

### B10 · 写侧三处的失败**互不影响**

- 怎么改的：`record()` 内部拆成三个私有方法，各自 try/catch（Redis 热读 / 日计数器 / MySQL）。
- 为什么：MySQL 挂了不该影响 Redis 热读；计数挂了不该影响落库。**观察面不许绑架主流程**（写不进去只是"少几行 / 少几个计数"，不是会话失败）。

---

## 三、任务单 §7 必登记的五条偏差（现状复核）

| # | 偏差 | 本单现状 |
|---|---|---|
| 1 | 首轮不写闸门 trace | **未改变**。首轮没有 `baseSnapshot`（跨会话接续），编排器直接 return，不进闸门 → 既不写 Redis 也不写 MySQL，`first_turn_baseline` 实际不会自然出现 |
| 2 | 同会话同轮最多两条 trace（shadow + effect） | **未改变**。统计口径因此是"闸门**决策条数**"，不是"审议轮次数"；要"触发了多少轮审议"请按 `mode=effect` 过滤，或按 `(session_id, turn_index)` 去重 |
| 3 | `gate_error` 在 Redis 里查不到 | **未改变，且 MySQL 侧同样查不到** —— catch 分支不调 `trace.record()`，三处都不写。排障时"Redis 与 MySQL 都查不到 gate_error"是**闸门自身故障**的信号，不是丢数据 |
| 4 | sessionId 双口径映射规则 | 写侧：`TurnSessionContext.dbSessionId` ← voice 层 `opts.dbSessionId`（与既有 `dbSessionIds` 映射表同源同口径，有值才登记）；读侧：`sessionId` 参数命中 `session_id` 或 `db_session_id`，`dbSessionId` 参数只认 `db_session_id` |
| 5 | Redis 7 天 / MySQL 持久化 —— 双源口径 | 列表 / 详情查 **MySQL**（真相源，永久）；按天统计查 **Redis 日计数器**（90 天）。两者**不是同一份数据的两个视图**：计数器是写时预聚合的"决策条数"，列表是逐行的"记录" —— 数字对得上，但不是同一口径的两种读法 |

---

## 四、接口契约（前端照这个接）

### `GET /admin/api/gate/traces`

| query | 说明 |
|---|---|
| `page` / `pageSize` | 页码（默认 1）/ 每页（默认 20，上限 100）；非法 → 400 |
| `sessionId` | **双口径**：引擎侧 session id **或** 落库 dbSessionId 命中即算 |
| `dbSessionId` | 只认 `training_sessions.id`（uuid 字符串） |
| `mode` | 多选，逗号分隔（`shadow` / `effect`）；非法值 → 400 |
| `reason` | 多选，逗号分隔（12 个枚举）；非法值 → 400 |
| `decision` | `run` / `skip`；非法 → 400 |
| `startDate` / `endDate` | `YYYY-MM-DD`（Asia/Shanghai，闭区间）；非法 / 倒挂 → 400 |

返回：`{ total, page, pageSize, items: GateTraceRecord[] }`，
其中 `GateTraceRecord = { id: number; sessionId: string; dbSessionId: string | null; turnIndex: number; mode: 'shadow'|'effect'; decision: 'run'|'skip'; reason: GateReason; thresholdUsed: {alliance,resistance,calm}; deltaSummary: Record<string, number>; elapsedMs: number; recordedAt: string }`。

⚠️ `thresholdUsed` 是**对象**（前端 mock 曾写成 number，`.toFixed(3)` 会崩）；`recordedAt` 是 **ISO 字符串带 `+08:00` 偏移**（不是 UTC 的 Z）；`dbSessionId` 是 **string**（见 B1）。

### `GET /admin/api/gate/traces/:id`

按 MySQL 自增 id 查单条；不存在 / 不属于该学员 → 404（`BizCode.ResourceNotFound`）；id 非法 → 400。

### `GET /admin/api/gate/stats?days=N`

`days` 默认 7，上限 90（超了截断，实际窗口在 `dates` 长度里可见）；非法 → 400。
返回：`{ dates: string[]; totalDecisions: number[]; skipDecisions: number[]; runDecisions: number[]; byReason: Record<string, number[]>; byMode: { shadow: number[]; effect: number[] } }` —— **所有数组与 `dates` 等长对齐**，`byReason` 恒含全部 12 个 reason（缺的补 0）。

鉴权：`AdminBasicAuthMiddleware`（身份）+ class 级 `AdminRoleGuard`（角色，非 admin → 403）。

---

## 五、闸门

> ⚠️ **本单未代跑闸门命令** —— 按 `AGENTS.md` §2.3「只跑后端的 `npx eslint` / `npx tsc` / `npx vitest`，且由大炮在终端执行，不要替他跑」，
> 下表留空待大炮在终端执行后回填。**代码已按 `strict + noUnusedLocals + noPropertyAccessFromIndexSignature` 人工复核过一遍**，
> 但**未经验证**，请以大炮跑出来的数字为准。

| 闸门 | 命令 | 结果 |
|---|---|---|
| ESLint | `npx eslint "src/**/*.ts"` | 待大炮执行 |
| 类型 | `npx tsc -p tsconfig.build.json --noEmit` | 待大炮执行 |
| 单测 | `npx vitest run` | 待大炮执行 |
| 内核零改动 | `git diff --stat HEAD -- src/engine-core` | **空**（本单未碰 `src/engine-core` 任何文件） |

---

## 六、部署顺序（⚠️ 有先后）

1. **先** `pnpm migration:run`（建 `gate_decisions` 表；漏跑 → 闸门每轮落库失败，只打 warn 不炸，但看板没数据）
2. **再**起服务（`GateTraceModule` / `DeliberationGateModule` 都要这张表）

> 忘记跑 migration 的表现极具迷惑性：服务能起、闸门照跑、Redis 有 trace，**只有 MySQL 是空的**。

---

## 七、还没做的（不在本单范围）

- 前端 `GateDecisions.vue` 接真接口（另一个 AI 的活；契约见 §四）
- 审议 trace 的详情端点（含心理内容，另开）
- 闸门 trace 的编辑 / 删除
- 真 Redis 集成测试（仓库无 Redis 测试基础设施；Lua 脚本写得极简，dev 环境手工核对一次）

---

_创建：2026-11-09。commit 文案：`
feat(gate): 闸门决策落 MySQL 真相源 + Redis 热缓存与写时计数, admin 三端点(列表/详情/按天统计)_
