# 闸门 trace 查询接口 · 第二意见（评审）

> 评审对象：口头方案「admin 端闸门 trace 查询接口」（GET /admin/api/gate/traces 列表 + /:id 详情，源为 WP-C 已写入 Redis 的闸门 trace key）
> 评审时间：2026-11-09 14:59 GMT+8
> 评审方式：读真实代码 + grep 核实，未改任何生产代码（本轮只出意见）

---

## 0. 总体结论

**方向完全对，接口路径前缀（`/admin/api/gate/traces`）、"复用 WP-C 数据结构不另造表"、"engine-core 零改动" 这三条硬约束我全部认同。**

但**已决方案里有 4 处字段/路由与真实数据结构对不上，会让接口直接跑不通或返回错误口径**；另外 **Redis 侧有 3 个坑**比"TTL 过期"更值得先处理。按下面的清单改完，这个需求两天内能落地且不破任何红线。

- **P0-1**：方案里的 `id` 字段在真实数据里**不存在**，且 `GET /traces/:id` 在纯 Redis 上**无法定位**——Redis key 已被 `(sessionId, turnIndex, mode)` 占满，没有自增 id。
- **P0-2**：`gateType` / `triggerReason` / `createdAt` 三个字段**全部不存在**。真实维度是 `mode`（shadow/effect）+ `reason`（枚举），时间字段叫 `recordedAt`（毫秒 number，不是 ISO 字符串）。`gateType=trigger` 在数据里**没有任何对应值**。
- **P0-3**：Redis 里的闸门 trace 是**"每轮一个 key"**，不是 append-only 列表，**没有索引 / 列表 / ZSET**。方案里"按时间排序 + 分页"在当前数据结构下**不可实现**。
- **P0-4（最危险）**：Redis 配的是 `--maxmemory 256mb --maxmemory-policy allkeys-lru`。**LRU 驱逐下 trace key 可能在 7 天 TTL 到期前就被提前淘汰**——这比 TTL 过期更致命，因为它**静默、无痕迹**，看板看不出来。

三个待决策点的答案先给：

| 待决策点 | 结论 |
|---|---|
| ① Redis TTL / 查不查得到历史 / 要不要落 MySQL | **7 天 TTL 是硬上限**，且 LRU 会提前淘汰；首版**不落 MySQL**（不新造表），但**必须在响应里带窗口/覆盖率口径**；"要不要落 MySQL"列为待大炮拍板的开放项 |
| ② 闸门 trace 是否含对话内容、怎么脱敏 | **闸门 trace 本身零心理内容**（文件头明确写了"零对话原文，连心理画像都没有"），**不需要脱敏**；但方案详情端点要的"建议内容"落在**另一个含心理内容的 Redis key** 上，那部分**必须截断**——见 §2.3 |
| ③ 按天聚合统计要不要一起做 | **要，但换个做法**：不新建索引，改成**复用 `deliberation-stats.ts` 已有的"写时同步累加 hash 计数器"范式**，和列表接口同批交付 |

三个"更优雅的查询方式"的答案：**别新写 Redis 客户端封装**，复用 `RedisService.getClient()` + 导出复用 `buildGateTraceKey` + 复用 `shared/time/shanghai-date.ts` 时区口径；但**读侧范式要从"扫 key 翻页"换成"按会话精确取 + 按天聚合计数"**。

---

## 1. P0 · 方案与真实数据结构的四处偏差

### 1.1 事实核对：真实 `GateTraceRecord`

源码 `src/engine-adapters/deliberation-gate/deliberation-gate.trace.ts`：

```ts
export const GATE_TRACE_KEY_PREFIX = 'deliberation:gate:trace';
export const GATE_TRACE_TTL_SECONDS = 604_800;   // 7 天

export function buildGateTraceKey(sessionId, turnIndex, mode): string {
  return `${GATE_TRACE_KEY_PREFIX}:${sessionId.length}:${sessionId}:${turnIndex}:${mode}`;
}

interface GateTraceRecord {
  sessionId: string;
  turnIndex: number;
  mode: 'shadow' | 'effect';
  decision: 'run' | 'skip';
  reason: GateReason;
  deltaSummary: ...;
  thresholdUsed: { alliance, resistance, calm };
  elapsedMs: number;
  recordedAt: number;   // 毫秒
}
```

方案字段 ↔ 真实字段对照：

| 方案字段 | 真实情况 | 处置建议 |
|---|---|---|
| `id` | **不存在**。Redis 无自增 id；key 已含 `sessionId + turnIndex + mode` | 用**合成 id** 或改路径参数（见 §2.1） |
| `sessionId` | ✅ 存在 | 直接用 |
| `turnIndex` | ✅ 存在 | 直接用 |
| `gateType` | **不存在**。真实维度是 `mode`（shadow/effect），且**没有 "trigger" 这个值** | 改为 `mode`；筛选参数改 `mode=shadow|effect` |
| `triggerReason` | **不存在**，真实字段名是 `reason` | 重命名 `reason` |
| `decision` | ✅ 存在，取值 `run | skip` | 直接用 |
| `createdAt` | **不存在**，真实字段名 `recordedAt`（毫秒 number） | 重命名 `recordedAt`，或响应里转 ISO + `+08:00` |

**为什么这个必须改而不是"映射一层"**：`gateType=trigger` 这种筛选值在数据里查不到任何东西。用户点一下筛选器就返回空列表，看起来像"闸门没触发过"，实际上是**筛选值本身不存在**——这是最难排查的一类假空。

### 1.2 `reason` 是枚举，不是自由文本

真实 `GateReason` 取值（来自 `deliberation-gate.types.ts` + `evaluator.ts` 判定顺序）：

```
crisis_skip / first_turn_baseline / key_event / cooldown / quota_exceeded /
circuit_open / unknown_event_type / alliance_delta_high / resistance_delta_high /
calm_turn / rule_confident / gate_error
```

这直接决定了筛选参数的正确形态：**`reason` 应按枚举多值筛选**（`reason=key_event,cooldown`），而不是自由文本模糊匹配。同时前端下拉框应该直接渲染这份枚举——**枚举只有一份**，前端不要另抄一份常量。

### 1.3 前端 mock 与真实契约已经对不上（不止字段名）

`admin-dashboard/src/views/GateDecisions.vue` 里 mock 的类型是：

```ts
thresholdUsed: number   // 前端还用了 .toFixed(3)
timestamp: ...           // 真实是 recordedAt
```

而真实 `thresholdUsed` 是**对象** `{ alliance, resistance, calm }`，不是 number——前端 mock 里那句 `.toFixed(3)` 会直接崩。这不是本次接口引入的问题，但**这次接口是第一次让它变成真问题**，必须一并修掉。

前端 `admin-dashboard/src/api/types.ts` 里已有 `TurnTrace.gateDecision?: { decision, reason, thresholdUsed }`，注释标着 "WP-C 做完后接入"——**这正是本接口该填的洞**，但字段名和类型要按真实契约校准。

---

## 2. P0 · 路由与详情端点的两个硬伤

### 2.1 `GET /traces/:id` 在纯 Redis 上无法定位

`id` 拿不到单条记录，除非你**自己定义一套合成 id 规则**（例如 `{sessionId}:{turnIndex}:{mode}` 编码），再在查询时反解回 key——但 `sessionId` 里含 `:` 的话解析有歧义，得再 Base64。

三个可选处置，按推荐度排序：

1. **（推荐）改路径参数为复合语义**：
   `GET /admin/api/gate/traces/:sessionId/:turnIndex/:mode`
   —— 不需要合成 id，`buildGateTraceKey(sessionId, turnIndex, mode)` 直接拼 key，零歧义、零解析。
2. **合成 id + 编码**：`id = base64url(sessionId) + "." + turnIndex + "." + mode`，响应里同时返回原始三字段。前端只需要把三字段当真相，id 当句柄用。
3. **保持 `/:id` 但 id 就是三字段的 JSON/base64**：本质是方案 2 的变体，收益是路由形状不变。

无论选哪个，**响应里都要同时返回 `sessionId / turnIndex / mode` 三个原始字段**——前端排错、跳转会话详情都靠它们，不能只给一个 opaque id。

### 2.2 列表端点的"按时间排序 + 分页"当前不可实现

Redis 里是**每轮一个 key**：

```
deliberation:gate:trace:{sessionId.len}:{sessionId}:{turnIndex}:{mode}
```

**没有列表、没有 ZSET、没有二级索引**。要列全部只有两条路：

- `SCAN MATCH 'deliberation:gate:trace:*'` —— 全库扫描，生产环境危险；
- `KEYS` —— 仓库明确反对。

即使 SCAN，**排序也做不了**：SCAN 返回顺序是哈希槽顺序，不是时间顺序。要真按时间排序，只能把所有 key 捞出来、逐个 GET、再本地排序——这是 O(N) 全量拉取，N 大了会把 Redis 拖垮，同时**逐条 GET 的开销远大于 pipeline HGETALL 那种批量读**。

**更致命的是 sessionId 口径问题**（见 §4.4）：前端传的会话 id 和 trace 里的 sessionId **可能不是同一个口径**，按 sessionId 筛选这个需求本身就可能筛不出东西。

### 2.3 详情端点要的"审议耗时 / 建议内容"跨到了另一个 key

真实闸门 trace 里有 `elapsedMs`（闸门判定耗时，毫秒），但**没有"审议耗时"，也没有"建议内容"**。这两项在另一处 Redis：

```
deliberation_trace:{tenant.len}:{tenant}:{session.len}:{session}:{turn}
TTL 30 天（DEFAULT_DELIBERATION_TRACE_TTL_SECONDS = 2_592_000）
```
来源 `src/engine-adapters/deliberation/llm-deliberation.service.ts`。**这条记录的 `reason` / `summary` / `entries` 里含心理内容**。

所以方案的详情端点有两条红线要守：

- **"建议内容"绝不能进 admin 响应**——它落在含心理内容的审议 trace 上，一进响应就越过隐私红线（心理内容不进普通日志/网络响应）。
- **"审议耗时"如果确实要拿**，只能取审议 trace 里的**非心理字段**（如 `durationMs` / `ok` / token 用量 / `errorCode` 这类），并且要明确写进响应文档：它来自另一个 key、另一个 TTL（30 天）、只在审议真的跑了的时候才有。

**建议**：详情端点第一版**只返回闸门 trace 自身字段 + 明确标注"审议侧信息不在本接口范围"**。宁可少给，不要在隐私边界上做模糊处理。真要加审议耗时，走单独字段、单独开关、大炮拍板。

---

## 3. Redis 过期与丢失：三个坑，TTL 只是最轻的那个

### 3.1 TTL：7 天硬上限

`GATE_TRACE_TTL_SECONDS = 604_800`（7 天），写入时 `redis.set(key, json, ttl)`。**7 天前的闸门决策，在 Redis 里查不到，也查不出来"它曾经存在过"**。

### 3.2 LRU 驱逐：这才是更危险的那个

`docker-compose.yml` 里 redis 服务：

```
--appendonly yes --appendfsync everysec
--maxmemory 256mb --maxmemory-policy allkeys-lru
```

`allkeys-lru` 意味着**任何 key 都可能被淘汰**，包括 gate trace key。256MB 的内存里还塞着用户会话、JWT blacklist、审议 trace（30 天 TTL，体量比闸门 trace 大得多）、BDI 状态……

结果是：**gate trace 可能在 7 天 TTL 到期前就被静默淘汰**。没有报错、没有日志、看板不会显示"数据缺失"，只会显示"这段时间没有闸门决策"——**这就是"看板宁可报错也不能装作一切正常"那条纪律的直接反例**。

AOF 已开（`--appendfsync everysec`），**进程重启不丢已落盘数据**，但内存淘汰照样丢。所以：

- **不能承诺"7 天内可查"**。实际可查窗口 = `min(7 天, LRU 淘汰发生时间)`。
- **看板必须显式暴露口径**，而不是假装完整。

### 3.3 覆盖率的诚实表达：响应里带窗口与降级标记

建议列表响应顶层加一个口径字段，比如：

```json
{
  "window": { "ttlDays": 7, "source": "redis-ephemeral", "degradable": true },
  "items": [ ... ]
}
```

并在页面上标注"数据源为 Redis 短期留存，仅覆盖最近 N 天"。这比"第 8 天突然查不到历史"要诚实得多——**用户能提前知道有窗口，而不是在需要复盘的时候才发现数据没了**。

### 3.4 要不要落 MySQL：建议第一版不落，但把选项摆清楚

**"不另造表"这个硬约束下，落库只有一条现成通道**：`training_sessions.turn_debug_trace`（WP19 建的 JSON 列，`src/counselor/entities/training-session.entity.ts:241`，写入方 `src/admin-debug/trace-recorder.service.ts`）。admin 端 `GET /admin/api/sessions/:id` 已经在读它。

但这条路有三个问题：

1. **它要求 `ENGINE_DEBUG_TRACE_ENABLED`**，**生产缺省是关的**。灰度验证期生产环境大概不会开——那就等于没落。
2. **双源口径分叉**：Redis 一份、MySQL 一份，两份 TTL 不同、写入时机不同、字段口径不同。**仓库纪律是"判定/口径只有一份"**，双源要额外做一致性对齐，成本高。
3. **它是 JSON 列塞进 session 行**，按闸门维度筛选没法直接 SQL 查，仍要全表扫 + 应用层过滤——**分页还是假的**。

我的建议：**Phase2.5 灰度验证期不落 MySQL**。理由是灰度验证要的就是"**最近几天**引擎行为对不对"，7 天窗口够用；落库的复杂度（双源、开关、迁移）在灰度期性价比低。

但这一条**属于需要大炮拍板的开放项**（见 §7），因为它取决于灰度验证要持续多长、要不要做跨会话的长期复盘。

如果决定落：**优先落 MySQL、Redis 只做热读**（MySQL 才是真相源），并**明确废弃 Redis 列表分页**（MySQL 侧才有真分页）；如果决定不落：**必须在响应和 UI 上把 7 天窗口和 LRU 降级风险讲清楚**。

---

## 4. 另外四个"数据不完整"的坑（不改代码也必须知道，否则看板会骗人）

这四条不是接口能修的，是**口径必须写进文档和 UI** 的既成事实。

### 4.1 首轮不写闸门 trace

`turn-render-orchestrator.deliberationRound()` 里，**没有 baseSnapshot（本轮不是首轮）就直接 return**，闸门根本不问。所以 `first_turn_baseline` 这个 reason 在数据里**几乎不会自然出现**——它出现在判定函数里，但写入路径首轮就短路了。列表里看到 `turnIndex=1` 的记录要当成异常看待。

### 4.2 同会话同轮最多两条 trace，靠 `mode` 区分

`runGatedDeliberation` 对 shadow 和 effect **各问一次闸门**。所以一个会话同一轮可能有 `mode=shadow` 和 `mode=effect` 两条记录。**统计"闸门触发次数"时必须去重口径写清楚**（按轮次去重还是按 trace 条数），否则同一个行为会被数成两次。

### 4.3 `gate_error` 在 Redis 里查不到

`DeliberationGateService.evaluate` 的 catch 分支返回 `{decision:'run', reason:'gate_error'}`（**放行**，语义正确），但 **trace 只在 try 分支写**——所以闸门自己故障时，**Redis 里没有这条记录**。

结论：**"闸门报错次数"不能从 trace 统计**。要么另找埋点，要么在看板上明确写"本表不含闸门异常"。这是"看板宁可报错也不能装作一切正常"的又一个点。

### 4.4 sessionId 口径可能对不上（这是筛选能不能落地的关键）

- 闸门 trace 里的 `sessionId` 是**引擎侧 session id**（`deliberation-gate.types.ts` 的 `GateInput.sessionId`，来自 `round.context.sessionId`）。
- admin 面板会话列表用的是 **MySQL `training_sessions.id`**（落库 id，即 `dbSessionId`）。

两者**不是同一个 id**。仓库里已有映射机制：`src/engine-adapters/wiring/engine-stream-backend.adapter.ts` 维护 `dbSessionIds`（voice sessionId ↔ training_sessions.id），`src/counselor/providers/vpt-session-bridge.service.ts` open 时生成落库 id 并 log `ws_session=... db_session=...`。

**所以前端传"会话列表里那个 id"去筛 trace，很可能筛出空列表。**

处置：接口**同时接受两种口径**（一个 `sessionId` 参数 + 一个 `dbSessionId` 参数，或参数带前缀区分如 `ws:xxx` / `db:xxx`），服务端按映射表翻译；**并且必须补一条集成测试验证映射真的生效**。这一条比 TTL 更影响"能不能用"。

---

## 5. 模块归属：口径留引擎侧，HTTP 端点留 admin 侧

### 5.1 结论

**纯口径 / 读侧纯函数放 `src/engine-adapters/deliberation-gate/`，HTTP 端点放 `src/admin-debug/`。**

理由是仓库**已有这个方向的先例**，不是新架构：

- `src/admin-debug/admin-debug.controller.ts` 现在就 `import { ... } from '../engine-adapters/deliberation/deliberation-stats.js'`——**admin 层反向 import engine-adapters 的纯口径模块，是仓库既有可行范式**。
- gate 侧现有代码全在 `src/engine-adapters/deliberation-gate/`（trace / quotas / service / evaluator / config / types / module），属**适配层**（可触 Redis），engine-core 零改动天然满足。

具体落点建议：

```
src/engine-adapters/deliberation-gate/deliberation-gate.trace-query.ts   // 读侧纯逻辑 + 口径
src/engine-adapters/deliberation-gate/deliberation-gate.stats.ts       // 按天聚合（若做）
src/admin-debug/admin-gate.controller.ts                              // HTTP 端点（新增独立 controller）
```

### 5.2 三个必须避开的坑

**① 模块循环依赖。** `AdminDebugModule` 被 `EngineWiringModule` import（为了 `TraceRecorder`），所以 **admin-debug 不能再 import 引擎装配层**。仓库已有 `admin-debug-chat.module.ts` 专门为此拆分——**新增 gate controller 时沿用同样的拆分手法**，或把 controller 挂进现有的 admin-debug 模块、只 import `engine-adapters/deliberation-gate/` 的**纯逻辑文件**（不 import 其 `module.ts`）。

**② admin 鉴权装配不能漏。** 仓库既有范式：`admin-debug.module.ts` 按控制器挂 `AdminBasicAuthMiddleware`，controller 上 class 级 `@UseGuards(AdminRoleGuard)`。新 controller **必须同时具备这两个**，不能只挂一个。

**③ 学员隔离。** admin 端点已有 `src/admin-debug/admin-scope.ts` 的 `buildOwnerFilter`，用来区分管理员看全部 / 学员只看自己的会话。**闸门 trace 查询同样涉及学员数据**，必须走 `buildOwnerFilter` 同样的口径，不能因为"只读"就绕过隔离。

### 5.3 ⚠️ 一个会让 CI 变红的硬性联动

`test/admin-debug/wp26-admin-role-guard.spec.ts` **断言了 AdminDebugController 的精确路由清单（11 条）和 AdminInsightsController 的 5 条**。

**新增任何端点，都必须同步改这个 spec 的清单**，否则**测试直接红**。

而且这个 spec 的存在本身就是**双重保险**：它会强制你把新路由写进清单——**绕不过去**。这是好事，说明鉴权覆盖有回归保护。但要提前和大炮打招呼：**这属于要改已封版 WP26 的测试文件**，不是纯新增。

（如果新端点挂在**独立的新 controller** 上，则需确认该 spec 是否覆盖到新 controller 的路由——从名字看是按 controller 断言的，**新 controller 可能需要新增一条断言**，这一点要读 spec 原文确认。）

---

## 6. 更优雅的查询方式：三个"复用"，加一个"降级"

### 6.1 复用清单（别新写一套）

| 要复用的 | 位置 | 怎么用 |
|---|---|---|
| Redis 客户端 / pipeline / SCAN / EVAL | `src/shared/infra/redis/redis.service.ts` 的 `getClient()` | **不要新写 Redis 客户端封装**。`RedisService` 本身没有 scan 方法，仓库先例是直接 `getClient().scanStream({ match })` |
| key 前缀 | `getKeyPrefix()` | **SCAN MATCH 不会自动带 keyPrefix**（`ioredis` 只在发命令时拼前缀，`node_modules/ioredis/built/Command.js:66`）。先例见 `src/user/providers/jwt-blacklist.service.ts:79-82`，**必须手工拼前缀** |
| 时区口径 | `src/shared/time/shanghai-date.ts`（`shanghaiDateKey` / `shanghaiDayStartUtc`） | **时区口径只有一份**，别在 controller 里手写 `+8` |
| key 构造 | `buildGateTraceKey()` | 需要导出（现在是模块内函数），查询侧复用，**别把 key 规则抄第二遍** |
| 读侧仓储范式 | `src/engine-adapters/persistence/redis-bdi-state.repository.ts` | engine-adapters 侧既有 Redis 仓储先例（带 Lua CAS），可参照其风格 |
| 学员隔离 | `src/admin-debug/admin-scope.ts` 的 `buildOwnerFilter` | 见 §5.2③ |

### 6.2 按天聚合：复用 `deliberation-stats.ts` 的"写时累加"范式

这是仓库里**最贴近你需求、且已经跑在生产形态上的范式**（对应已有端点 `GET /admin/api/deliberation/stats`）：

- key：`deliberation_stats:global` + 日 key `deliberation_stats:global:YYYY-MM-DD`（**日 key 带上海时区日期**）
- 写入：`DELIBERATION_STATS_LUA_SCRIPT` **Lua 原子累加**
- 读取：**pipeline 批量 HGETALL**，不逐条 GET
- TTL 90 天

**建议给闸门 trace 也加一套同构的写时计数器**（`gate_stats:global:{YYYY-MM-DD}` 之类），维度按 `decision / reason / mode` 分桶。

这么做的价值：

1. **"按天聚合统计"直接落地**，不用扫 trace；
2. **给列表分页提供"总页数/近似总数"的真实来源**，不用全量扫描；
3. **顺带缓解"Redis 里没有 trace key"的问题**——计数器 key 比 trace key 小得多、TTL 90 天，**在 LRU 驱逐下存活率高得多**，能保住一条"历史发生过什么"的粗粒度账。

**代价**：计数器是**写时累加**，改口径就得清历史（计数无法回溯重算）。所以**桶维度必须在 WP-C 侧就定死**——这意味着**这不是纯查询层的事**，会碰 `deliberation-gate.trace.ts` 的写入路径。

**这是本方案唯一一处需要动 WP-C 既有代码的地方，需要大炮明确批准**（触碰的是 engine-adapters，不是 engine-core，红线不破）。如果大炮希望**本轮完全不动 WP-C**，那就退而求其次：列表端点**不做全局时间分页**，只做"按会话精确取 + 最近 N 轮"。

### 6.3 首版查询能力降级建议（强烈推荐）

在当前数据结构下，我认为**首版应该是**：

| 能力 | 首版 | 理由 |
|---|---|---|
| 按会话查全部闸门记录 | ✅ 做 | sessionId 口径对齐后，`turnIndex × mode` 可枚举，**key 直接拼、精确命中、不扫库** |
| 单条详情 | ✅ 做 | key 精确命中 |
| 按天聚合计数 | ✅ 做 | 走 §6.2 计数器 |
| **全局按时间排序 + 分页** | ❌ **降级为"最近 N 轮"** | 需要全量 SCAN + 本地排序，**生产不可接受** |
| 按 reason / mode 筛选 | ✅ 做（**在会话维度内**） | 枚举值筛选，无需索引 |

也就是：**先做"会话内查 + 按天计数"，把"全局翻页"作为 Phase3 的事**。等有计数器或 MySQL 索引了再上真分页。

---

## 7. 前端契约需要同步修正的清单

`admin-dashboard/src/views/GateDecisions.vue` + `admin-dashboard/src/api/types.ts` + `admin-dashboard/src/api/client.ts`（目前**没有任何 gate 相关 API 方法**）需要一起改：

1. `thresholdUsed: number` → `{ alliance: number; resistance: number; calm: number }`，删掉 `.toFixed(3)`（**现在就会崩**）。
2. `timestamp` → `recordedAt`（毫秒 number）。若要 ISO 字符串，服务端统一转 `Asia/Shanghai`，**前端不再自己算时区**。
3. `gateType` → `mode`（`shadow | effect`）；`triggerReason` → `reason`（12 值枚举）。
4. `id` → 按 §2.1 选定的方案：**响应里保留 `sessionId / turnIndex / mode` 三个原始字段**，`id` 仅作句柄。
5. 筛选参数改为 `sessionId`（或 `dbSessionId`，见 §4.4）+ `mode` + `reason`（多值枚举）+ `turnIndex`。
6. **mock 数据删除时机**：真实接口通了以后**必须删掉 mock**，否则"接口挂了但页面还有假数据"会掩盖故障——**这正是"看板宁可报错也不能装作一切正常"**。建议 mock 用一个显眼的开关（如 `VITE_USE_GATE_MOCK`），灰度期开着观察，正式切真实接口时关掉。
7. **枚举只有一份**：reason 枚举建议由后端在某个只读端点暴露（或复用现有配置端点），前端不要硬编码第二份。

---

## 8. 待大炮拍板的开放问题

| # | 问题 | 我的建议 |
|---|---|---|
| 1 | **接受 7 天 TTL + LRU 驱逐下不落 MySQL** 吗？ | 建议**接受**，但响应/UI 必须显式声明窗口与降级风险；若灰度期要长期复盘，再考虑落 `turn_debug_trace` |
| 2 | **列表端点不做全局时间分页**（降级为"会话内查 + 按天计数"）可以吗？ | 建议**接受**；真分页留到有索引（计数器或 MySQL）之后 |
| 3 | **要不要为闸门加写时计数器**（动 `deliberation-gate.trace.ts` 写入路径，engine-adapters 层）？ | 建议**加**——这是"优雅查询方式"里收益最大的一步，但**需要你明确批准碰 WP-C 写入代码** |
| 4 | **详情端点要不要跨到审议 trace 取"审议耗时"？** | 建议**第一版不取**；"建议内容"明确**拒绝**（含心理内容，越红线） |
| 5 | **改 `wp26-admin-role-guard.spec.ts` 路由清单**（新增端点必然要改）——是否批准改这个已封版测试文件？ | 需要你点头，这是唯一的"改旧文件"动作 |
| 6 | **sessionId 双口径**：接口同时接受引擎侧 id 和 `training_sessions.id`？ | 建议**同时接受**，并补集成测试验证映射 |

---

## 9. 最小落地路径（如果按我建议走）

1. **先修口径**：`GateTraceRecord` 字段映射定稿（`mode / reason / decision / recordedAt / deltaSummary / thresholdUsed / elapsedMs`），前端 mock 契约同步。
2. **读侧纯逻辑**：`src/engine-adapters/deliberation-gate/deliberation-gate.trace-query.ts`——按 `(sessionId, turnIndex, mode)` 精确取、按会话枚举、`buildGateTraceKey` 导出复用、时区用 `shared/time/shanghai-date.ts`。
3. **HTTP 端点**：`src/admin-debug/admin-gate.controller.ts`——挂 `AdminBasicAuthMiddleware` + class 级 `AdminRoleGuard`，走 `buildOwnerFilter`。
4. **聚合**：若批准动 WP-C，则加 `gate_stats` 写时计数器 + `GET /admin/api/gate/stats`；否则本步跳过。
5. **测试**：新增集成 spec（真 Redis，参照 `test/admin-debug/deliberation-stats-redis.integration.spec.ts` 的 db15 + 随机前缀 + 自动删模式）；同步更新 `wp26-admin-role-guard.spec.ts` 路由清单。
6. **口径文档**：把 §4 的四条（首轮不写 / 双 mode / gate_error 不写 / sessionId 双口径）写进接口文档和页面提示——**看板的诚实性靠口径，不靠 UI 美化**。

---

## 10. 一句话总结

**方案方向对，三个待决策点的答案分别是：TTL 是 7 天且 LRU 会提前淘汰、首版不落 MySQL 但必须暴露窗口口径；闸门 trace 本身零心理内容不需要脱敏，但"建议内容"必须拒绝；按天聚合要做、但要复用 `deliberation-stats` 的写时计数器范式而不是扫 key。** 落地前必须先改的是：删掉不存在的 `id / gateType / triggerReason / createdAt` 四个字段、`/:id` 路由改成复合定位、列表端点不做全局时间分页、sessionId 双口径对齐，以及——**新增端点后记得改 `wp26-admin-role-guard.spec.ts` 的路由清单，否则测试会红。**
