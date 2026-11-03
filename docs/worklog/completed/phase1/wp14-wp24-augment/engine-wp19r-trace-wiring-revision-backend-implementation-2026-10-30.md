# WP19-R · 留痕链接通修订（traceRecorder 接线 + AdminDebug 收口）· 交付记录

> **日期**：2026-10-30（实跑取证日 2026-11-02）
> **仓库**：`E:\Work\Project\backend\mofang-nestjs`
> **任务单**：[engine-wp19r-trace-wiring-revision-backend-2026-10-30.md](engine-wp19r-trace-wiring-revision-backend-2026-10-30.md)
> **原单**：[engine-wp19-admin-debug-module-trace-2026-10-29.md](engine-wp19-admin-debug-module-trace-2026-10-29.md)（§1.1 快照契约 / §1.2 端点契约，本单**逐字沿用**，不重新设计）
> **性质**：WP19 **修订单** —— 把"已声明交付但实际没接线"的留痕链真正接通 + admin/api 收口 6 个审计点
> **状态**：✅ 代码已交付，实跑取证通过，**未 commit**（按任务单要求不自动提交）

---

## 0. 一句话

`traceRecorder` 真正注入 `EngineStreamBackend` 的 DI 装配，每轮 turn 结束**即刻**落 `training_sessions.turn_debug_trace`（契约逐字沿用 WP19 §1.1）；同时 `/admin/api/*` 补上 basic auth + 学员用户隔离 + `not_found` 改 404 + `characters` 改查 `character_profiles`。

**闸门**：`npx eslint "src/**/*.ts"` **0 error 0 warning** / `npx tsc -p tsconfig.build.json --noEmit` **0 错** / 新增套件 **18 例全绿** / 全量 **61 套件 954 例全通过（零回归）** / `git diff --stat HEAD -- src/engine-core` **为空**。

**实跑取证**：真实 DI 装配 + 真实 MySQL + 真实上游模型，2 场对练 × 2 轮 → 两场 `turn_debug_trace` **各 2 行（= 轮次数）**，`bdiSnapshot` 四值非空，`llmUsage.completionTokens` **556 / 588 / 585（> 0）**。详见 §5。

---

## 1. 任务单 6 件事逐条落地

### 1.1 ✅ 核心：`traceRecorder` 真正注入 DI 装配（§1.1）

**原状**（代码级对账 `code-vs-blueprint-audit-2026-10-30.md` §4.1 D1/D2）：`createEngineStreamBackend` 工厂第 6 位**恒传 `undefined`**，`recordTrace()` 首行守卫 `if (!recorder) return;` 直接 return —— "每轮 BDI 快照落库"**一次都没发生过**，`turn_debug_trace` 恒空。

**落法**（三处，缺一不可）：

| 文件 | 改动 |
|---|---|
| `src/engine-adapters/wiring/engine.providers.ts` | `EngineStreamBackendDeps` 新增 `readonly traceRecorder?: TraceRecorder`；`createEngineStreamBackend` 第 6 位由 `undefined` 改为真传 `deps.traceRecorder`（位置参数不能跳着传，WP24 的 `pricing` 在它后面） |
| `src/engine-adapters/wiring/engine.module.ts` | `EngineStreamBackend` 的 `useFactory` 注入 `TraceRecorder`（`AdminDebugModule` 已 import 且导出），并加进 `inject` 数组 |
| `src/engine-adapters/wiring/engine-stream-backend.adapter.ts` | `recordTrace()` 真正建快照并交给 recorder；构造失败 / 记录失败各打一条 error 日志，**永不冒泡到对练链路** |

**落库策略改了**：原单设想"内存缓冲 + `closeSession` 时一次 flush"，实际后果是**中途断线 / 进程重启时缓冲全丢** —— 调试数据的作用就是"出事那一刻能看见"，留到关会话才写恰恰写不到最需要它的那一次。改成 **每轮 turn 结束即刻落库**（1 轮 1 次 UPDATE，不新增表不新增列），`closeSession` 时再 `flush()` 一次收尾（同一写路径，不做两套口径）。

**写库失败不炸链**（任务单 §1.1 明写）：`TraceRecorder.persist()` 内部 try/catch，失败只 `logger.error('[trace_persist_failed] ...')`；`record()` 返回的 promise **永不 reject**；adapter 侧再兜一层 `.catch()`。

**同场多次写串行化**：每轮写的是"累积数组"，若两次写并发，先发起的写可能后落地 → **轮次少的旧数组覆盖轮次多的新数组**（库里少几轮快照，日志里两次都写着"已落库"）。`TraceRecorder.enqueueWrite()` 按 `dbSessionId` 串行排队，这是这条链路唯一的顺序保证。

**开关**：`ENGINE_DEBUG_TRACE_ENABLED` —— 显式配了按配的来（`true/1/yes/on` 开）；没配则 **dev 开 / prod 关**。`resolveTraceEnabled(config)` 导出为纯函数，便于单测。

### 1.2 ✅ `GET /admin/api/characters` 改查 `character_profiles`（§1.2）

原端点查 `visitor_pool_templates`（**速查卡表**，对外人设简介），而引擎 `openSession` 实际注入的基线来自 `character_profiles` —— 调试器看到的角色与引擎注入的**不是同一份**（audit D3）。

改后查 `CharacterProfileEntity`（未软删），返回：

- `slug`（`template_id`，即 `vpt_*`）/ `codename`（`display_name`）/ `attachmentStyle`
- `baseline{trust, resist, valence, arousal}`（四个基线值）
- `resistance{verbal, depth, style}`
- `enabled` + `auditStatus`（调试器要能看出"这个角色引擎现在根本命中不了"）

**同源验证**（真跑探针实测，§5）：端点口径的 `character_profiles` 行基线 = `trust 0.2 / valence -0.55 / arousal 0.18 / resist 0.62`，与引擎 `resolver.resolve()` 注入的 `characterProfile.baseline` **逐值一致**，且留痕快照里的 `characterSlug` = `vpt_grief_avoidance_l1` = DB 的 `template_id`。

### 1.3 ✅ `/admin/api/*` basic auth middleware（§1.3）

新增 `src/admin-debug/admin-basic-auth.middleware.ts`（Nest `NestMiddleware`，经 `NestModule.configure` 用 `forRoutes(AdminDebugController)` 挂载 —— 避开 Express 5 的通配符语法坑）。

**两种访问身份（互斥，不叠加）**：

| 身份 | 凭据 | 会话列表 |
|---|---|---|
| 管理员 | `Authorization: Basic base64(user:pass)`，env `ADMIN_BASIC_AUTH_USER` / `ADMIN_BASIC_AUTH_PASS` | **不过滤**（调试器要看全场） |
| 学员 | 产品自己的 access token（HttpOnly cookie 或 Bearer） | 只看**自己**的 |
| 匿名 | 无 | 不过滤（dev 裸奔口径，且打一次 warn） |

**两个 env 都配才生效**（任务单原话）：只配一个 → 按"未开启鉴权"处理并 warn 一次。理由：配一半 = 运营以为开了鉴权、实际没开 —— 那比明确没开更危险。

**学员身份复用仓库既有 `JwtAuthGuard`**（cookie / Bearer + 黑名单），不新造第 4 套鉴权体系。带 token 但验不过 → **401**（不把"看起来已登录"的请求当匿名放行）。

401 响应体沿用仓库统一格式 `{ code: BizCode.Unauthorized, message, data: null }`。

凭据比较走 `safeEquals()`（SHA-256 后 `timingSafeEqual`）—— 先哈希是为等长，`timingSafeEqual` 对不等长串会抛。

### 1.4 ✅ sessions 列表按请求用户隔离（§1.4）

`AdminDebugController.ownerFilter(req)` 统一出 where 片段：

- 带正确 basic 凭据（`req.adminBasicAuth === true`）→ `{}`（不过滤）
- 学员（`req.user.userId` 非空）→ `{ userId }`
- 匿名 → `{}`

**详情端点也按归属过滤**（超出任务单字面要求）：`GET /admin/api/sessions/:id` 对"不是你的会话"同样返 **404** 而不是 403 —— 返 403 等于告诉对方"这个 id 存在"，那就是泄露会话是否存在。统一 404，调试器侧无差别。此为同口径的安全收敛，在此显式登记。

列表同时补齐 WP19 原单 §1.2 的 `characterSlug` 与 `totalTokens`（audit D28：原来 `totalTokens` 恒 0、且缺 `characterSlug`）。`totalTokens` 由该场 trace 的 `promptTokens + completionTokens` 汇总得出；没留痕的会话就是 0，**不编**。

### 1.5 ✅ `GET /admin/api/sessions/:id` 不存在 → 404（§1.5）

原来返 `200 + {error:'not_found'}`。现在抛 `BizException(BizCode.ResourceNotFound, '会话不存在')` → 经仓库既有 `BizExceptionFilter` → **HTTP 404**，响应体 `{code, message, data:null}`。

会话**存在**时返回内容沿用原单 §1.2（元信息 + trace 数组 + 逐字稿 + 报告，报告四态对齐 WP18）。

### 1.6 ✅ `docs/README.md` 索引补行（§1.6）

`docs/README.md` 的 `progress/` 表新增 **3 行**：WP19（原单，标注其"已交付"被对账证伪 + 已由 WP19-R 收口）、**WP19-R**（本单，含交付记录链接）、WP20（前端 SPA 任务单 + 状态 + 交付记录暂无的说明）。

WP20 行里同时写明一条**已知失配**：前端 `admin-dashboard/src/api/types.ts` 的旧 `TurnTrace` 类型字段名是 `bdi` / `usage`，与 WP19 §1.1 新契约 `bdiSnapshot` / `llmUsage` **不一致** —— 切真接口时需对齐。本单按红线**不动前端**（WP20 才是那一轮）。

---

## 2. 顺手治本的一个真病：TypeORM `save()` 会把留痕覆盖掉

**这是本单最花时间、也最有价值的一段**：把 `traceRecorder` 接上之后，第一轮实跑仍然**丢轮次** —— 第 2 场 2 轮只剩 1 轮 trace。

**根因**：TypeORM 的 `Repository.save(entity)` 是**整行 upsert**，diff 时 JSON 列按**引用**比较（加载出来的对象 ≠ 新对象）→ 判定为"变了"→ 把**加载时的旧副本**写回去。`training_sessions.turn_debug_trace` 正好是 JSON 列，于是：

> 任何"加载整行 → 改一列 → `save(row)`"的写手，都会把**它加载那一刻**的 `turn_debug_trace` 旧副本一并写回 —— 覆盖掉并发落库的留痕。

真跑探针日志里的实证（`UPDATE training_sessions SET transcript = ?, status = ?` 之后紧跟一次 `UPDATE ... SET turn_debug_trace = ?` 写的还是**只含第 1 轮**的数组）—— 落库顺序与丢轮次是同一件事的两面。

**修法：只写自己管的列**（定向 `update`），而不是把 trace 改存别处 —— 保持原单的存储位置与 entity 映射，也不必动 schema：

| 文件 | 位置 | 改前 | 改后 |
|---|---|---|---|
| `src/counselor/providers/vpt-session-bridge.service.ts` | `doAppendTurn` | `save(row)` | `update({id}, {transcript, status})` |
| `src/counselor/providers/vpt-session-bridge.service.ts` | `doReplaceTranscript` | `save(row)` | `update({id}, {transcript, status})` |
| `src/counselor/providers/vpt-session-bridge.service.ts` | `doClose` | `save(row)` | `update({id}, {status, endedAt})` |
| `src/counselor/providers/supervision.service.ts` | `writeTechStats` | `save(row)` | `update({id}, {techStats})` |
| `src/counselor/providers/supervision.service.ts` | `linkReportToSession` | `save(row)` | `update({id}, {supervisionReportId})` |
| `src/counselor/providers/informed-consent.service.ts` | `judge` | `save(session)` | `update({id}, {informedConsentTranscript, informedConsentPassed})` |

**为什么这 6 处必须改、别的可以不改**：`vpt-session-bridge` 的三个方法在**真实对练链路上**（逐字稿增量写 + 关会话收尾），与留痕写**同一行** → 必然互相覆盖。`supervision.writeTechStats`（BullMQ 收尾时写 tech_stats）与 `linkReportToSession`（报告 ↔ 会话链接）、`informed-consent.judge`（知情同意判定）虽然触发频率低，但写的是**同一张表的同一行**，只要撞上就会覆盖 —— 属于"迟早会踩"，一并治本。

**没改的**：`training-session.service.ts` 的 3 处 `save(row)`（单次训练流的建会话 / 更新状态 / 逐字稿追加 / 收尾）。那几条链路**不产生 WP19 留痕**（留痕只由 `EngineStreamBackend` 写 vpt 语音对练的行），改它们属于动旧链路、且对留痕零收益 —— 按任务单"`ENGINE_VOICE_ENABLED=false` 旧链路行为逐字不变"的红线**保持原样**。

**影响面**：这是行为层面的等价收敛（同样的列、同样的值，只是不再顺带覆盖别人的列），不改变任何接口契约与返回值。

---

## 3. 与任务单的差异（显式说明）

| # | 任务单 | 实际 | 原因 |
|---|---|---|---|
| 1 | §1.1「若原单设想的存储位置实际未建表/未加列，在适配层用现有 turn-analysis 存储承接，并在交付记录里写明最终落点」 | **不需要承接** —— `training_sessions.turn_debug_trace`（JSON，nullable）**已存在**，沿用原单存储位置 | 实测 `DESCRIBE` 确认列在，无需新建存储 |
| 2 | §1.1「每轮 turn 结束后 `recordTrace()` 真正执行落库」 | 落库时机由 adapter 决定，但**每轮即刻落库**（不是"关会话时 flush"） | 原单的"关会话才写"在断线/重启时全丢，达不到"出事那一刻能看见"的目的 |
| 3 | §1.4 只要求「sessions **列表**按请求用户隔离」 | **详情端点也按归属过滤**（越权详情返 404） | 列表隔离 + 详情不隔离 = 学员照样能按 id 拉到别人的逐字稿；返 404 而非 403 是为不泄露 id 存在性 |
| 4 | §1.3「无凭据或凭据错误 → 401」 | 另加一条：**带 JWT 但 token 无效 → 401** | 不把"看起来已登录"的请求当匿名放行 |
| 5 | §1.1 快照契约 | `renderSpec.taskKind` 实测值是 `chat`（原单示例写的是 `voice_render`） | `taskKind` 是**渲染规格里的真实值**，不是手写常量；引擎走 chat 渲染任务就落 `chat`。字段名与结构逐字沿用，只是取值来自真实链路 |
| 6 | §2 红线「不改 `src/engine-core/**`」 | 未改（`git diff --stat HEAD -- src/engine-core` **为空**） | — |
| 7 | §2 红线「不动旧 visitor 链路」 | 未改 `src/voice/**`、未改 `VisitorService` | — |
| 8 | §2 红线「不做 admin-dashboard 前端切真 API」 | 未动 `admin-dashboard/` | 前端 `TurnTrace` 类型失配已写进 README 与本记录 §9 |

---

## 4. 闸门实测结果（全部本轮复跑）

| 闸门 | 命令 | 结果 |
|---|---|---|
| ESLint | `npx eslint "src/**/*.ts"` | ✅ **0 error 0 warning**（exit 0） |
| TypeScript | `npx tsc -p tsconfig.build.json --noEmit` | ✅ **0 错** |
| 新增套件 | `npx vitest run test/admin-debug/wp19r-trace-wiring.spec.ts` | ✅ **18 例全绿** |
| 全量套件 | `npx vitest run --exclude '**/e2e/**/*.ts'` | ✅ **61 文件 / 954 例全通过**（零回归） |
| 内核零改动 | `git diff --stat HEAD -- src/engine-core` | ✅ **为空** |
| 编译产物 | `npx tsc -p tsconfig.build.json` | ✅ BUILD_OK |

> 注：中途修完并发写手后，既有套件 `test/engine-adapters/wp12-memory-closeout.spec.ts` 有 1 例失败 —— 该用例的 `sessionRepo` stub 只实现了 `save`，新代码走 `update`。**已按新写机制更新 stub**（断言的仍是"逐字稿表拿到引擎副本的全量"，业务断言逐字未变），复跑全绿。

### 4.1 新增单测覆盖的 5 个验收场景（`test/admin-debug/wp19r-trace-wiring.spec.ts`，18 例）

| # | 验收场景 | 覆盖用例 |
|---|---|---|
| 1 | **trace 成功落库** | 落库调用 + 快照形状逐字对齐 §1.1（`turnIndex`/`characterSlug`/`bdiSnapshot` 五值/`renderSpec` 四字段/`llmUsage` 五字段/`crisis`/`ts`）+ 多轮累积成数组 + 同场写入串行 |
| 2 | **写库失败不炸链** | 写库抛错 → 只 error 日志、promise 不 reject、turn 仍正常返回 reply；`ENGINE_DEBUG_TRACE_ENABLED` 关闭时不落库 |
| 3 | **401 与 200** | 无凭据 → 401；错误 basic 凭据 → 401；正确 basic 凭据 → 200；两个 env 只配一个 → 按未开启处理 |
| 4 | **characters 查 character_profiles** | 端点确实查 `character_profiles` 仓储并返回 slug / codename / baseline 四值 / 上下架 |
| 5 | **not_found 404** | 不存在的 `sessions/:id` → HTTP 404 |
| +4 | **用户隔离**（§1.4 追加） | 学员只看自己的 / basic 管理员不过滤 / 匿名不过滤 / 学员看别人的详情 → 404 |

---

## 5. DB 实测证据（脱敏）

### 5.1 探针跑法（`scripts/probe-wp19r-trace.mjs`）

走**产品真实链路**，不手工构造快照 —— 因为本单的核心缺陷正是"代码看起来接上了，但那根线从没通电"，手工造快照只能证明"JSON 能写进去"，证明不了"真的写了"：

```
NestFactory.createApplicationContext(AppModule)   // 真实 DI 装配
  → app.get(EngineStreamBackend)                  // 真实装配出来的实例（含注入的 TraceRecorder）
  → openSession / streamTurn                      // 真实引擎 + 真实渲染 + 真实上游模型
  → sessionRepo.query(SELECT ... JSON_EXTRACT(turn_debug_trace, ...))   // 真实 MySQL
```

**2 场对练 × 每场 2 轮**，角色取 DB 里 `approved + enabled` 的真实 `vpt_*` slug。

**为什么跑编译产物 `dist/` 而不是 tsx 直跑源码**：仓库是 ESM（`type: module`），tsx 直跑源码时的模块求值顺序与编译产物不同 —— 直跑会撞上 `AuditLogProcessor` 的循环依赖。**基线代码同样炸**（已用 `git stash push --include-untracked -- src/` 在基线上复现同样失败，确认**与本单无关**），编译产物 `node dist/app.js` 可正常启动。探针因此跑编译产物 —— 那也是**服务真实启动的那一份**。

### 5.2 脱敏查询结果

```sql
SELECT LEFT(id,8) AS session_id, user_id,
       JSON_LENGTH(turn_debug_trace) AS trace_rows,
       JSON_UNQUOTE(JSON_EXTRACT(turn_debug_trace,'$[0].turnIndex')) AS t0_index,
       JSON_UNQUOTE(JSON_EXTRACT(turn_debug_trace,'$[0].characterSlug')) AS t0_slug,
       JSON_EXTRACT(turn_debug_trace,'$[0].bdiSnapshot.trust')      AS t0_trust,
       JSON_EXTRACT(turn_debug_trace,'$[0].bdiSnapshot.valence')    AS t0_valence,
       JSON_EXTRACT(turn_debug_trace,'$[0].bdiSnapshot.arousal')    AS t0_arousal,
       JSON_EXTRACT(turn_debug_trace,'$[0].bdiSnapshot.resistance') AS t0_resistance,
       JSON_UNQUOTE(JSON_EXTRACT(turn_debug_trace,'$[0].bdiSnapshot.anxiousSecure')) AS t0_anxious_secure,
       JSON_UNQUOTE(JSON_EXTRACT(turn_debug_trace,'$[0].renderSpec.taskKind'))         AS t0_task_kind,
       JSON_EXTRACT(turn_debug_trace,'$[0].renderSpec.maxCompletionTokens')           AS t0_max_tokens,
       JSON_UNQUOTE(JSON_EXTRACT(turn_debug_trace,'$[0].renderSpec.reasoningEffort'))  AS t0_effort,
       CHAR_LENGTH(JSON_UNQUOTE(JSON_EXTRACT(turn_debug_trace,'$[0].renderSpec.promptPreview'))) AS t0_prompt_len,
       JSON_EXTRACT(turn_debug_trace,'$[0].llmUsage.promptTokens')     AS t0_prompt_tokens,
       JSON_EXTRACT(turn_debug_trace,'$[0].llmUsage.completionTokens') AS t0_completion_tokens,
       JSON_EXTRACT(turn_debug_trace,'$[0].llmUsage.reasoningTokens') AS t0_reasoning_tokens,
       JSON_EXTRACT(turn_debug_trace,'$[0].llmUsage.ttftMs')           AS t0_ttft_ms,
       JSON_UNQUOTE(JSON_EXTRACT(turn_debug_trace,'$[0].llmUsage.finishReason')) AS t0_finish_reason,
       JSON_EXTRACT(turn_debug_trace,'$[0].crisis.detected') AS t0_crisis,
       JSON_UNQUOTE(JSON_EXTRACT(turn_debug_trace,'$[0].ts')) AS t0_ts,
       JSON_UNQUOTE(JSON_EXTRACT(turn_debug_trace,'$[1].turnIndex'))  AS t1_index,
       JSON_EXTRACT(turn_debug_trace,'$[1].bdiSnapshot.trust')      AS t1_trust,
       JSON_EXTRACT(turn_debug_trace,'$[1].llmUsage.completionTokens') AS t1_completion_tokens,
       JSON_UNQUOTE(JSON_EXTRACT(turn_debug_trace,'$[1].ts')) AS t1_ts
  FROM training_sessions WHERE id IN (?)
 ORDER BY started_at;
```

实测输出（脱敏：只打 BDI / 用量 / 参数 / 长度，**不打 promptPreview 全文、不打逐字稿、不打完整 id**）：

| session_id | user_id | trace_rows | t0_index | t0_slug | t0_trust | t0_valence | t0_arousal | t0_resistance | t0_anxious_secure | t0_task_kind | t0_max_tokens | t0_effort | t0_prompt_len |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `feb7af6f` | probe-student-a | **2** | 1 | `vpt_grief_avoidance_l1` | 0.2 | -0.55 | 0.18 | 0.62 | `empty` | `chat` | 1500 | `low` | 500 |
| `752ceb4f` | probe-student-b | **2** | 1 | `vpt_grief_avoidance_l1` | 0.2 | -0.55 | 0.18 | 0.62 | `empty` | `chat` | 1500 | `low` | 500 |

| session_id | t0_prompt_tokens | t0_completion_tokens | t0_reasoning_tokens | t0_ttft_ms | t0_finish_reason | t0_crisis | t0_ts | t1_index | t1_trust | t1_completion_tokens | t1_ts |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `feb7af6f` | 0 | **556** | 0 | 1426 | `stop` | false | 2026-11-02T04:16:33.153Z | 2 | 0.2 | **588** | 2026-11-02T04:16:34.015Z |
| `752ceb4f` | 0 | **556** | 0 | 1080 | `stop` | false | 2026-11-02T04:16:35.680Z | 2 | 0.2 | **585** | 2026-11-02T04:16:36.836Z |

**逐条对验收标准**：

- ✅ **trace 行数 = 轮次数** —— 两场都是 2 轮 / 2 行（`JSON_LENGTH` = 2），第 1 轮 `turnIndex=1`、第 2 轮 `turnIndex=2`
- ✅ **bdiSnapshot 四值非空** —— trust 0.2 / valence -0.55 / arousal 0.18 / resistance 0.62（非 0 非 null），另有 `anxiousSecure='empty'`（内核按 valence×arousal 象限重算的离散标签）
- ✅ **llmUsage.completionTokens > 0** —— 556 / 588 / 585 / 585
- ✅ **`characterSlug` 与角色池同源** —— `vpt_grief_avoidance_l1` = `character_profiles.template_id`
- ✅ **基线同源** —— 探针同时打了 DB 行基线与引擎注入基线：`trust=0.2 / valence=-0.55 / arousal=0.18 / resist=0.62`，**逐值一致**
- ✅ **`promptPreview` 截断到 500 字** —— `CHAR_LENGTH` = 500（上限生效）
- ✅ **`maxCompletionTokens` = 1500 / `reasoningEffort` = `low`** —— 引擎真实解析值（WP9-C 定的 1500 / low）

### 5.3 `promptTokens = 0` 的口径（**不代表输入侧没花钱**）

上游**流式**接口只给累计 `tokenCount`，**没有 prompt / completion 拆分**（voice 端到端走的正是流式），所以输入侧 token 在这条链路上**不可得**。契约字段是数字，落 **0**，并在此显式声明：

> **`llmUsage.promptTokens = 0` 的含义是"输入侧用量不可得"，不是"输入侧没花钱"。**

这与 WP24 的 `costBasis: "output_only"` 同款纪律 —— **不拿 0 冒充「没有」**。

### 5.4 顺带观察到的既存现象（**不属于本单，也未修**）

探针收尾时打了两条 warn：

```
[SessionCloseoutService] [closeout] 摘要生成失败, 本场不晋升长时记忆: Default chat provider deepseek not registered
```

这是 WP12 的**长时记忆摘要生成器**在本机 `.env` 里默认厂商是 `deepseek`、而该厂商未注册所致 —— 与本单的留痕 / admin-api 无关（摘要失败按 WP12 口径只 warn、不阻断收尾）。**本单不修，留给知情人决策**。

---

## 6. 改动面清单（照实写）

### 6.1 新增（4 个）

| 文件 | 作用 |
|---|---|
| `src/admin-debug/admin-basic-auth.middleware.ts` | `/admin/api/*` 访问控制中间件：basic auth / 学员 JWT / 匿名三态 + 身份标记 + 401 响应 |
| `test/admin-debug/wp19r-trace-wiring.spec.ts` | 新增单测 18 例（5 验收场景 + 用户隔离 4 例 + 落库/失败/开关等） |
| `scripts/probe-wp19r-trace.mjs` | 真跑验收探针（真实 DI + 真实 MySQL + 真实上游模型 → 脱敏查询结果） |
| `docs/worklog/engine-wp19r-trace-wiring-revision-backend-implementation-2026-10-30.md` | 本交付记录 |

### 6.2 修改（14 个文件，+766 / -138）

| 文件 | 改动摘要 |
|---|---|
| `src/admin-debug/trace-recorder.service.ts` | 重写：`TurnTrace` 改成 §1.1 契约；每轮即刻落库；串行写链；失败只 error；`resolveTraceEnabled` 开关 |
| `src/admin-debug/admin-debug.controller.ts` | 重写：`characters` 改查 `character_profiles`；列表/详情按用户隔离；详情 404；列表补 `characterSlug` / `totalTokens` |
| `src/admin-debug/admin-debug.module.ts` | 重写：注册 `CharacterProfileEntity`、import `UserModule`（复用 `JwtAuthGuard`）、注册中间件、`configure()` 挂载 |
| `src/engine-adapters/wiring/engine.providers.ts` | `EngineStreamBackendDeps` 加 `traceRecorder`；工厂第 6 位真传（不再是恒 `undefined` 占位） |
| `src/engine-adapters/wiring/engine.module.ts` | `useFactory` 注入 `TraceRecorder` |
| `src/engine-adapters/wiring/engine-stream-backend.adapter.ts` | `characterSlugs` 映射（`openSession` 记 / `closeSession` 清）；`recordTrace` 构造 §1.1 形状 + 双层兜底；抽出 `buildTurnTrace` / `buildBdiSnapshot` / `buildRenderSpecSummary` / `buildLlmUsage` / `buildCrisisSummary`（拆复杂度） |
| `src/engine-adapters/rendering/streaming-render.port.ts` | `StreamRenderOutcome` 新增可选 `maxCompletionTokens` / `reasoningEffort` / `promptPreview` / `finishReason` / `ttftMs` |
| `src/engine-adapters/rendering/llm-render.adapter.ts` | 流式路径测 TTFT（发起调用 → 首 delta）；带出 resolved `maxCompletionTokens` / `reasoningEffort`；抓 `finishReason`；新增导出 `buildPromptPreview(messages)`（system 消息前 500 字，多模态只取 text 片段）；`streamViaAggregate` 也带 promptPreview；抽出 `buildStreamOutcome` 降复杂度 |
| `src/engine-adapters/rendering/turn-render-orchestrator.ts` | 新增 `RenderSpecSummary`；`TurnRenderResult.render` 增加可选 `spec` / `finishReason` / `ttftMs`；`NormalizedRender` 同步；`turn()` / `turnStream()` 透传；新增 `buildSpecSummary()`（有真值用真值，没真值记 `unknown`/空串，**不编**） |
| `src/counselor/providers/vpt-session-bridge.service.ts` | 3 处 `save(row)` → 定向 `update`（只写 transcript / status / endedAt）—— §2 治本 |
| `src/counselor/providers/supervision.service.ts` | 2 处 `save(row)` → 定向 `update`（只写 techStats / supervisionReportId）—— §2 治本 |
| `src/counselor/providers/informed-consent.service.ts` | 1 处 `save(session)` → 定向 `update`（只写知情同意两列）—— §2 治本 |
| `test/engine-adapters/wp12-memory-closeout.spec.ts` | stub 随新写机制改为 `update`（**业务断言逐字未变**） |
| `docs/README.md` | 索引补 WP19 / WP19-R / WP20 三行 |

### 6.3 红线核对

| 红线 | 结果 |
|---|---|
| `src/engine-core/**` 零改动 | ✅ `git diff --stat HEAD -- src/engine-core` **为空** |
| 不加新表 / 新列 | ✅ 沿用 `training_sessions.turn_debug_trace`（已存在的 JSON 列），**零 DDL** |
| 留痕写库失败不炸对练主链路 | ✅ 三层兜底：`TraceRecorder.persist` try/catch + `record()` 永不 reject + adapter 侧 `.catch()` |
| `ENGINE_VOICE_ENABLED=false` 旧链路逐字不变 | ✅ 未改 `src/voice/**`、未改 `VisitorService`、未改单次训练流写手 |
| 不做 admin-dashboard 前端切真 API | ✅ `admin-dashboard/` **零改动**（前端类型失配已登记） |
| 不做 CRUD / 权限系统 / 实时大盘 | ✅ 只读 GET 端点 + 一个访问控制中间件，无写操作、无角色表 |
| 引擎装配层零 ORM / SDK 包名（wp8-wiring §8-9 护栏） | ✅ 装配层只加 `import type { TraceRecorder }`（类型 import），`TraceRecorder` 实例由 Nest 注入 —— 护栏套件 **34 例全绿** |
| eslint complexity ≤ 20 / sonarjs cognitive ≤ 25 | ✅ 0 error 0 warning（为此把 `recordTrace` / `buildStreamOutcome` 等拆成模块级纯函数） |
| **不自动 commit** | ✅ 工作区改动全部未提交，等用户指令 |

---

## 7. commit 文案（**未提交，等用户拍板**）

```
fix(engine): WP19-R 留痕链真正接线——traceRecorder 注入 EngineStreamBackend 落 turn_debug_trace，admin/api 补 basic auth + 用户隔离 + characters 改查 character_profiles + 404 口径

fix(counselor): training_sessions 写手改定向 update——TypeORM save 整行回写会覆盖 turn_debug_trace 留痕
```

> 本单**未自动 commit**（任务单明写"不要自动 commit"）。工作区当前：**14 个修改文件 + 4 个新增文件**（见 §6）。
>
> ⚠️ 工作区另有两个**与本单无关**的未跟踪文件（`docs/worklog/engine-wp14-student-risk-disposal-backend-2026-11-02.md`、`docs/worklog/change-password-first-set-backend-2026-11-02.md`）—— 不是本单产出，**本单没碰它们**，提交时请自行甄别。

---

## 8. 用户验收（怎么自己复跑）

```bash
cd E:\Work\Project\backend\mofang-nestjs

# ① 闸门
npx eslint "src/**/*.ts"                                        # 期望 0 error 0 warning
npx tsc -p tsconfig.build.json --noEmit                          # 期望 0 错
npx vitest run test/admin-debug/wp19r-trace-wiring.spec.ts        # 期望 18 passed
npx vitest run --exclude '**/e2e/**/*.ts'                        # 期望 61 files / 954 tests passed
git diff --stat HEAD -- src/engine-core                          # 期望空输出

# ② 真跑取证（真实 DI + 真实 MySQL + 真实上游模型）
npx tsc -p tsconfig.build.json
node scripts/probe-wp19r-trace.mjs
```

**需要的环境**（本机已具备）：MySQL `mofang_dev`、Redis、`.env` 里的模型凭据、`character_profiles` 里有 `approved + enabled` 的 `vpt_*` 角色。

**admin/api 手工验**：

```bash
# 两个 env 都配后:
curl -i http://localhost:<port>/admin/api/sessions                              # 无凭据 → 401
curl -i -u "$ADMIN_BASIC_AUTH_USER:$ADMIN_BASIC_AUTH_PASS" http://localhost:<port>/admin/api/sessions   # → 200
curl -i http://localhost:<port>/admin/api/sessions/does-not-exist              # → 404
```

---

## 9. 已知边界 / 留给下一轮

| # | 事项 | 说明 |
|---|---|---|
| 1 | **前端 `TurnTrace` 类型失配** | `admin-dashboard/src/api/types.ts` 用的是旧字段名 `bdi` / `usage`，与 WP19 §1.1 的 `bdiSnapshot` / `llmUsage` 不一致。本单按红线不动前端，**WP20 切真接口时必须对齐**（否则前端读到 undefined） |
| 2 | `llmUsage.promptTokens` 恒 0 | 输入侧 token 在流式链路上不可得（§5.3），不是"没花钱" |
| 3 | `renderSpec.taskKind` 实测为 `chat` | 原单示例写 `voice_render`；实际落的是渲染规格里的**真实** taskKind（引擎走 chat 渲染任务） |
| 4 | `anxiousSecure` 取内核 `snapshot.emotion.label` | 内核按 valence×arousal 象限重算的**离散标签**（本次实测 `empty`），不是连续值 |
| 5 | **两个 env 都配才生效** | 只配一个 → 按"未开启"处理并 warn 一次。**生产部署务必两个都配**，否则 `/admin/api/*` 在 dev 口径下是裸奔的（会打 warn） |
| 6 | 匿名请求不过滤会话列表 | 无 basic 凭据**且**无 JWT 时按 dev 裸奔口径放行并不过滤。若生产环境不配 basic auth，学员会话对匿名可见 —— 部署时务必配齐两个 env |
| 7 | 单次训练流写手未改 | `training-session.service.ts` 的 3 处 `save(row)` 保持原样（该链路不产生留痕，且按红线不动旧链路） |
| 8 | WP12 摘要生成器在本机报 deepseek 未注册 | §5.4，与本单无关，未修 |
| 9 | `tsx` 直跑源码有**既存**循环依赖缺陷 | `AuditLogProcessor` 的 ESM 循环依赖，基线代码同样炸（已 stash 复现确认），编译产物正常。与本单无关 |

---

## 10. 交叉链接

- 任务单：[engine-wp19r-trace-wiring-revision-backend-2026-10-30.md](engine-wp19r-trace-wiring-revision-backend-2026-10-30.md)
- 原单（契约来源）：[engine-wp19-admin-debug-module-trace-2026-10-29.md](engine-wp19-admin-debug-module-trace-2026-10-29.md)
- 代码级对账（缺陷来源）：[code-vs-blueprint-audit-2026-10-30.md](../../code-vs-blueprint-audit-2026-10-30.md) §4.1 D1/D2/D3/D27/D28/D29
- 前端后续轮： [engine-wp20-admin-dashboard-vue3-spa-2026-10-29.md](engine-wp20-admin-dashboard-vue3-spa-2026-10-29.md)
- 文档索引：[../README.md](../../../README.md)
