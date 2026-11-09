# GateDecisions · 闸门 trace 查询接口 —— 实现完成（relay 回复存档）

> 日期：2026-11-09
> 任务单：[`phase2.5-gate-decisions-trace-api.md`](../completed/phase2.5/phase2.5-gate-decisions-trace-api.md)
> 交付记录：[`phase2.5-gate-decisions-trace-api-implementation-2026-11-09.md`](../completed/phase2.5/phase2.5-gate-decisions-trace-api-implementation-2026-11-09.md)

---

## 一、结论

按最终版任务单**一步到位**做完，没有降级版：

- **数据层**：新建 `gate_decisions` 表（手写 DDL migration `1714900000038`），闸门决策落库当**真相源**；Redis 保留每轮一个 key 的热读（7 天 TTL，逻辑逐字不变），另加一个**写时按天计数器**（`gate_stats:global:{YYYY-MM-DD}`，Lua 原子累加，TTL 90 天）。
- **接口**：三个只读端点 —— `GET /admin/api/gate/traces`（全维度筛选 + 分页）、`GET /admin/api/gate/traces/:id`（单条详情）、`GET /admin/api/gate/stats?days=N`（按天聚合计数）。
- **sessionId 双口径**：`sessionId` 参数同时接受引擎侧 id 与落库 `dbSessionId`（命中任一列）；`dbSessionId` 参数只认落库 id。
- **学员隔离**：走 `buildOwnerFilter` 同款口径（列表 / 详情按 `user_id`）。
- **鉴权**：`AdminBasicAuthMiddleware` + class 级 `AdminRoleGuard`。
- **时区**：按天口径全走 `shared/time/shanghai-date.ts`（Asia/Shanghai）。
- **engine-core 零改动**：`git diff --stat HEAD -- src/engine-core` 输出为空。

---

## 二、改动清单

**新增**

| 文件 | 职责 |
|---|---|
| `src/migration/1714900000038-CreateGateDecisions.ts` | 手写幂等 DDL 建表（表不存在才建，已存在则补列） |
| `src/engine-adapters/deliberation-gate/gate-decision/gate-decision.entity.ts` | TypeORM 实体（6 个索引） |
| `src/engine-adapters/deliberation-gate/gate-decision/gate-decision.store.ts` | MySQL 落库器（写失败只 warn，绝不抛） |
| `src/engine-adapters/deliberation-gate/gate-decision/gate-decision-stats.ts` | 写时日计数器（Lua）+ 读侧聚合纯函数 |
| `src/engine-adapters/deliberation-gate/gate-decision/gate-decision-view.ts` | query 解析 / 校验 + 行→视图映射 + 上海 ISO |
| `src/admin-debug/gate-trace.controller.ts` | 三个只读端点 |
| `src/admin-debug/gate-trace.module.ts` | admin 端点模块（中间件 + guard + 实体注册） |
| `test/admin-debug/gate-decisions.spec.ts` | 新单测（口径 / 三写 / 查询装配） |

**改动**

`deliberation-gate.types.ts`（枚举改清单推导 + `GateInput` 加两个口径）· `deliberation-gate.trace.ts`（记录器三写）· `deliberation-gate.service.ts`（透传口径）· `deliberation-gate.module.ts`（装配落库器）· `turn-render-orchestrator.ts`（`TurnSessionContext` 加 `dbSessionId` + 闸门入参）· `engine-turn.service.ts`（`open()` 选项 + 归属登记）· `engine-stream-backend.adapter.ts`（透传 `opts.dbSessionId`）· `src/app.module.ts`（注册 `GateTraceModule`）· `src/migration/index.ts` + `bin/ormconfig.ts`（migration 双注册点）· `test/admin-debug/wp26-admin-role-guard.spec.ts`（**同步路由清单**）· `test/engine-adapters/deliberation-gate/quotas.spec.ts`（假 Redis 补 `eval`/`getClient`）

---

## 三、接口契约（前端照这个接）

### `GET /admin/api/gate/traces`

`page` / `pageSize`（默认 1 / 20，上限 100）· `sessionId`（双口径）· `dbSessionId`（只认落库 id）· `mode`（多选逗号分隔）· `reason`（多选逗号分隔）· `decision` · `startDate` / `endDate`（`YYYY-MM-DD` 闭区间）。
**非法参数一律 400，不静默兜底**（`mode=xxx` 静默忽略会让看板显示"全部模式"）。

返回 `{ total, page, pageSize, items }`，`items[]` 元素：

```ts
{
  id: number;                 // MySQL 自增
  sessionId: string;          // 引擎侧
  dbSessionId: string | null; // 落库 id（uuid 字符串，见偏差 B1）
  turnIndex: number;
  mode: 'shadow' | 'effect';
  decision: 'run' | 'skip';
  reason: GateReason;         // 12 个枚举
  thresholdUsed: { alliance: number; resistance: number; calm: number };  // 对象，不是 number
  deltaSummary: Record<string, number>;
  elapsedMs: number;
  recordedAt: string;         // ISO 带 +08:00 偏移（如 2026-11-09T15:04:05.123+08:00）
}
```

### `GET /admin/api/gate/traces/:id`

按自增 id 查单条；不存在 / 不属于该学员 → **404**；id 非法 → 400。**不跨到审议 trace**（不返回含心理内容的建议）。

### `GET /admin/api/gate/stats?days=N`

`days` 默认 7、上限 90（超了截断，实际窗口在 `dates` 长度里看得见）；非法 → 400。
返回 `{ dates, totalDecisions, skipDecisions, runDecisions, byReason, byMode }` —— **所有数组与 `dates` 等长对齐**，`byReason` 恒含全部 12 个 reason（缺的补 0）。

---

## 四、偏差登记（10 条，含任务单 §7 五条）

1. **B1 · `db_session_id` 由 BIGINT 改 VARCHAR(36)**：`training_sessions.id` 实为 uuid char(36)（grep 核实），塞进 BIGINT 会**静默丢精度** → 列用 `VARCHAR(36)`，接口出 `dbSessionId: string | null`。⚠️ **前端 mock 的 `dbSessionId: number | null` 要改成 `string | null`**（前端另一个 AI 的活）。
2. **B2 · 新增 `user_id` 列**：任务单 DDL 没有，但硬约束要求学员隔离 —— 没有归属列就只能 join `training_sessions`（另一套口径，自动对练还 join 不上）。写侧取 `TurnSessionContext.userId`（与 `training_sessions.user_id` 同一个 uid 口径）。自动对练走 `debug-admin` 假身份 → 学员看不到这些行。
3. **B3 · 新增 `recorded_day`（上海日键）**：`DATETIME` 无时区、mysql2 按进程本地时区序列化 → 同一批数据在不同环境会落进不同的天。把日键**写进数据里**（仓库纪律："口径要写在数据里"），筛选就与环境无关，且与统计日 key 完全对齐。
4. **B4 · `sessionId` 参数双口径命中**：前端手上往往只有一种 id，把"我拿到的是哪种"的责任推给前端没意义 → `sessionId` 命中 `session_id` 或 `db_session_id`；`dbSessionId` 仍只认落库 id。
5. **B5 · 统计端点全局、列表/详情隔离**：写时计数器无归属维度，与仓库既有 `GET /admin/api/deliberation/stats` 同款；列表/详情按 `user_id` 过滤。
6. **B6 · Redis trace JSON 增两个可选字段**：key 构造与 TTL 逐字不变，多两个 id 字段便于"Redis↔MySQL 抽查对账"，旧记录无这两个键（向后兼容）。
7. **B7 · `days` 超 90 截断、非法 400**：日 key TTL 就是 90 天，再长必然没数据；实际生效窗口在 `dates` 长度里可见（不静默兜底成别的口径）。
8. **B8 · 详情端点不跨到审议 trace**（按任务单执行，隐私红线）。
9. **B9 · 闸门模块可以碰 ORM（护栏不破）**：WP8-A §8-9 只扫 `src/engine-adapters/wiring` **顶层**的**非相对 import 包名**；ORM 依赖收在 `deliberation-gate/gate-decision/` 子目录（与 `engine-adapters/eval/` 落库同款先例），`wiring/` 顶层本次只改相对路径内的代码。
10. **B10 · 三处写失败互不影响**：Redis 热读 / 日计数器 / MySQL 各自 try/catch —— 观察面不绑架主流程。

**任务单 §7 五条现状复核**：① 首轮无 `baseSnapshot` 直接 return → 三处都不写（`first_turn_baseline` 实际不出现）；② 同轮最多两条（shadow+effect）→ 统计口径是"**决策条数**"，要"审议轮次数"请按 `mode=effect` 过滤或按 `(session_id, turn_index)` 去重；③ `gate_error` **Redis 与 MySQL 都查不到**（catch 分支不写）—— 这是"闸门自身故障"的信号，不是丢数据；④ 双口径映射规则见 B4；⑤ 列表/详情查 MySQL（永久）、统计查 Redis 日计数器（90 天），两者不是同一份数据的两个视图。

---

## 五、闸门

按 `AGENTS.md` §2.3「只跑后端的 `npx eslint` / `npx tsc` / `npx vitest`，且由大炮在终端执行，不要替他跑」，**本单未代跑闸门命令**，交付记录里留空待大炮执行后回填：

| 闸门 | 命令 | 结果 |
|---|---|---|
| ESLint | `npx eslint "src/**/*.ts"` | 待大炮执行 |
| 类型 | `npx tsc -p tsconfig.build.json --noEmit` | 待大炮执行 |
| 单测 | `npx vitest run` | 待大炮执行 |
| 内核零改动 | `git diff --stat HEAD -- src/engine-core` | **空** ✅（已核实） |

代码已按 `strict + noUnusedLocals + noPropertyAccessFromIndexSignature` 人工逐文件复核，但**未经验证**，以大炮跑出来的数字为准。

---

## 六、部署顺序（⚠️ 有先后）

1. **先** `pnpm migration:run`（建 `gate_decisions` 表）
2. **再**起服务

漏跑 migration 的表现极具迷惑性：服务能起、闸门照跑、Redis 有 trace，**只有 MySQL 是空的**（落库失败只 warn 不炸）。

---

## 七、commit 文案

```text
feat(gate): 闸门决策落 MySQL 真相源 + Redis 热缓存与写时计数, admin 三端点(列表/详情/按天统计)
```

（不自动 commit / push，等大炮指令。）
