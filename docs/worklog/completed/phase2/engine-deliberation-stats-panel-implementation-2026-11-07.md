
# 影子模式数据统计面板 · 后端接口 交付记录

> 状态: ✅ 已交付
> 任务单: [`deliberation-stats-panel-2026-11-07.md`](deliberation-stats-panel-2026-11-07.md)
> 日期: 2026-11-07
> 红线: ✅ **engine-core 零改动** —— `git diff --stat HEAD -- src/engine-core` = **空**（纯适配层实现）
> 边界断言: ✅ `boundary.spec.ts` 全绿（12 例，零改动即零影响）
> 北极星: [`../../../architecture/hybrid-bdi-agent-blueprint-v1.0.md`](../../../architecture/hybrid-bdi-agent-blueprint-v1.0.md) §2.3 切灰度前置安全网
> 承接: 约束校验层（delta cap）/ 过期判定与丢弃 / cap 配置统一 / 临床合理性校验（观测版）
> ⚠️ **影子模式不变** —— 审议结果照旧**不写** BDI 快照；本单只**读**已经从 trace 派生出来的计数器
> ⚠️ **两侧的失败方向不一样** —— 统计**写**失败只打 warn（观察面挂了不影响审议）；统计**读**失败直接抛错（看板宁可报错，也不装作一切正常）

---

## 1. 实际改了哪些文件

### 1.1 生产代码: 1 增 2 改

| 文件 | 改了什么 |
|---|---|
| `src/engine-adapters/deliberation/deliberation-stats.ts` | **新增**（335 行 · 本单主模块）: ① 导出 `DELIBERATION_STATS_KEY_PREFIX`（`deliberation_stats`）+ `buildDeliberationStatsKey()`（`deliberation_stats:global`）—— 与 `DELIBERATION_TRACE_KEY_PREFIX` **同款范式**（任务单 §十一 注意点 3）；② 导出 `DELIBERATION_LATENCY_BUCKET_BOUNDS`（13 个桶上界）+ `DELIBERATION_STATS_LUA_SCRIPT`（一次原子累加脚本）; ③ 导出纯函数 `buildDeliberationStatsDeltas(record)` → `{ counters, maxima }`; ④ 导出 `applyDeliberationStats(redis, record)`（一次 `getClient().eval()`）; ⑤ 导出 `buildDeliberationStatsResponse(hash)`（聚合纯函数）+ `DeliberationStatsResponse`（18 字段）; ⑥ 文件头补本单说明块（为什么不用扫 trace / 为什么用一次 Lua / 统计写失败不影响审议 / 延迟直方图） |
| `src/engine-adapters/deliberation/llm-deliberation.service.ts` | **改**（+17 / -1）: `writeTrace()` 内加统计累加（**独立 try/catch**，见 §2.5 D5）; 文件头补本单说明块; import 加 `applyDeliberationStats` |
| `src/admin-debug/admin-debug.controller.ts` | **改**（+37 / -0）: ① 构造器加**第 4 个必填依赖** `RedisService`（`RedisModule` 是 `@Global()`，DI 能解析）; ② 新增 `@Get('deliberation/stats')` → `GET /admin/api/deliberation/stats`; ③ 文件头补本单说明块 + 端点清单 |

### 1.2 测试: 1 增 13 改

| 文件 | 改了什么 |
|---|---|
| `test/admin-debug/deliberation-stats.spec.ts` | **新增 22 例**（本单主测试 · 582 行）: ① 写入侧 7 例（成功轮次各字段累加 / 失败轮次只累该累的 / 取大字段不被小值覆盖 / Lua 参数编排 / 脚本形状与假实现同源 / key 命名 / 纯函数确定性）② 读取侧 9 例（字段形状 18 个不多不少 / 成功率 / 平均耗时 / 空数据不崩（纯函数 + 端点两例）/ 延迟分位数 / 失败原因分布 / 砍幅与临床分布 / 分母口径）③ 端点接线 4 例（路径 + method / 继承 class 级 `AdminRoleGuard` / 读的就是计数器那个 key / Redis 读失败不兜底成 0）④ 写入侧接线 2 例（审议写 trace 时同步累加 / 统计写失败不炸审议） |
| `test/admin-debug/wp19r-trace-wiring.spec.ts` / `wp30-admin-real-api.spec.ts` / `wp31-cost-board.spec.ts` | **改**（各 +17 / -1）: `new AdminDebugController(...)` 补**第 4 参**（Redis 桩）—— 构造器加了必填依赖，这 3 个直接 new 的地方必须同步 |
| `test/admin-debug/wp26-admin-role-guard.spec.ts` | **改**（+2 / -0）: 端点清单加 `deliberation/stats`（这条用例是**硬编码端点列表** —— 新增端点不登记，"忘了挂 guard"就没人发现） |
| 9 个审议 spec（wp64 / wp65 ×2 / wp66 / wp68 / delta-cap / cap-config / clinical-sanity / stale-check） | **改**（各 +7 / -1，wp68 +3 / -0）: Redis 桩补 `getClient()` —— service 写 trace 时现在会走 `getClient().eval()` 累加统计，桩不补就会每次都走"失败兜底"分支（warn 噪声 + 覆盖不到真实路径） |

### 1.3 配置: 零改动

本单**不新增任何 env 键** —— 统计计数器恒开（它不是开关，是观察面），照任务单 §4.4「统计计数器永久保留」。

### 1.4 文档: 3 改

| 文件 | 改了什么 |
|---|---|
| `docs/worklog/pending/deliberation-stats-panel-2026-11-07.md` | 状态行改 ✅ + 指向交付记录; 追加「§十二 交付后补记」偏差表 → 移入 `completed/phase2/` |
| `docs/worklog/completed/phase2/engine-deliberation-stats-panel-implementation-2026-11-07.md` | **新增**（本文件） |
| `docs/worklog/README.md` | Phase2 已开工列表加一条（影子模式数据统计面板 · 后端接口） |

### 1.5 **零改动**（逐条核实过）

- `src/engine-core/**` —— **一行未动**（`git diff --stat HEAD -- src/engine-core` = 空）
- `src/engine-adapters/deliberation/deliberation-types.ts` —— **零改动**（契约层只管 LLM 输出形状，统计字段不进契约）
- `src/engine-adapters/wiring/**` —— **零改动**（不新增 provider / token; `RedisModule` 是 `@Global()`，`RedisService` 全局可注入）
- `src/shared/infra/redis/redis.service.ts` —— **零改动**（**不为引擎加专用方法** —— 那是层次倒置，见 §2.2 D3）
- `src/admin-debug/admin-debug.module.ts` —— **零改动**（providers 不用动）
- 无 migration / 无 entity / 无新表 / 无新列
- `admin-dashboard/` —— 零改动（前端另一个 AI 的活; 本单只出后端接口）
- **不改任何审议结果** —— 审议 delta 一个字不动，本单只读已写好的 trace 派生出来的数字

---

## 2. 关键设计决策（与任务单有出入的地方 + 为什么）

### 2.1 决策 D1（核实清单第 1 条不准确）: trace key 实际**带长度前缀**，不是任务单写的三段式

- **任务单 §二 第 1 条**写: `deliberation_trace:{tenantId}:{sessionId}:{turnIndex}`
- **代码实际**（`llm-deliberation.service.ts:835-836`）: `buildDeliberationTraceKey()` 返回 `deliberation_trace:{租户长度}:{租户}:{会话长度}:{会话}:{轮次}`
- **为什么**: 加长度前缀是仓库既有纪律（与 `RedisBdiStateRepository` 同款）—— 直接用 `:` 拼的话，`(租户="a:b", 会话="c")` 与 `(租户="a", 会话="b:c")` 会**撞键**，撞键的后果是**跨租户串数据**（静默的隐私事故）。
- **对本单的影响**: **无** —— 本单**不扫 trace**，不按 key 找记录。但这条必须登记: 后人照任务单的描述去实现"扫 trace"会踩撞键坑。
- **统计 key 反而是三段式的**（`deliberation_stats:global`）—— 因为它是**全局一份、不含任何用户标识**，不存在歧义空间。

### 2.2 决策 D2（核实清单第 5 条不准确）: Redis 范式是 `set(key, value, ttlSec?)`，不是 `set(key, value, 'EX', ttl)`

- **任务单 §二 第 5 条**写: `this.redis.set(key, value, 'EX', ttl)`
- **代码实际**（`redis.service.ts:114-116`）: `set(key: string, value: string, ttlSec?: number)` —— `'EX'` 在实现**内部**，调用方传的是秒数。
- **对本单的影响**: **无** —— 统计侧不走 `set`，走 `getClient().eval()`。登记在案是因为照任务单写会传错参数类型。

### 2.3 决策 D3: 用**一次 Lua 脚本**完成所有累加，而不是逐条 `hset` / `incrby`

- **任务单 §四**只说"累加统计计数器"，没规定怎么写。
- **为什么必须上脚本**: 计数用 `HINCRBYFLOAT`（Redis 侧原子）没问题，但"取大"字段（`max_duration_ms` / `max_delta_diff_abs`）**必须读-改-写** —— 两个审议并发收尾时，后写的会把先写的覆盖掉（**max 少算**，而且**不报错**）。仓库纪律明令 disfavor 读-改-写（`RedisService.incrby` 的注释就是范例：「计数会少算，而少算等于没算」）。
- **为什么不加 `hincrby` 到 `RedisService`**: `RedisService` 是全仓共用基础设施，为引擎加专用方法 = 让基础设施认识业务（层次倒置）。仓库**已有 EVAL 先例** —— `src/engine-adapters/persistence/redis-bdi-state.repository.ts:133` 用 `this.redis.getClient().eval(...)`，那个文件头明确论证了为什么走 `getClient()`（它本来就是为 multi / pipeline / SCAN MATCH / EVAL 开的口子），且 ioredis 会给 EVAL 的 key 自动拼 keyPrefix（已实测）。
- **代价**: 脚本本身**没有 CI 测试**（仓库无真 Redis 基础设施），见 §5 残留风险。

### 2.4 决策 D4: 任务单 §一 的 6 个决策问题有 **2 个计数器答不了** → 加延迟直方图 + 错误码分布

任务单 §一 列了 6 个切灰度要回答的问题。纯计数器（累加器 + 取大）能答 4 个，**答不了 2 个**:

| 问题 | 纯计数器能答吗 | 本单怎么答 |
|---|---|---|
| 成功率多少? | ✅ 能 | `successTurns / totalTurns` |
| 失败的主要原因是什么? | ❌ **不能** —— 任务单 §4.1 的字段表里**没有**错误码维度 | 加 `error_<errorCode>` 分布 → `failureByErrorCode` |
| P95 耗时多少? | ❌ **不能** —— 累加器只能算均值和极值，分位数必须靠分布 | 加**延迟直方图**（13 个桶）→ `p50DurationMs` / `p95DurationMs` |
| deltaDiff 均值多少? | ✅ 能 | `sumDeltaDiffAbs / successTurns` |
| 过期率多少? | ✅ 能 | `staleTurns / successTurns` |
| 被砍维度 / 临床 flagged 率? | ✅ 能 | `cap_<dim>` / `clinical_<rule>` 分布 |

- **P95 怎么算**: 按桶分布取分位数，返回命中桶的**上界**。桶内均匀分布假设下偏保守（报出来的数 ≥ 真实分位数）—— 对"会不会太慢"这类问题，**不把慢轮次报快**比精确更重要。
- **桶上界**: `[50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000, 30000]` —— 审议默认超时 3s，超过 30s 已经是异常，不再细分。
- **桶上界数组与桶字段名在同一个文件里定义**（写入侧与读取侧共用），避免两份真相。

### 2.5 决策 D5: 任务单 §4.3 的失败轮次清单**漏了 2 项** → 成功/失败走**同一套**累加规则

- **任务单 §4.3** 的失败轮次清单只列了 3 项（`total_turns` / `failure_turns` / `total_duration_ms`），并写明"其他字段不累加"。
- **代码实际**: 失败记录里 `retryCount` 与 `tokenUsage` **同样有值**（`buildFailureRecord` 里 `retryCount` 是实参、`tokenUsage` 来自上游报没报用量）。
- **照抄的后果**: "平均重试次数"和"平均 token"的**分子累了失败轮次、分母却是总轮次** —— 或者反过来只累成功轮次、却用总轮次做分母。两边都错。
- **本单口径**: 成功与失败轮次**同一套**规则 —— `durationMs` / `retryCount` / `tokenUsage` / 延迟桶**所有轮次都记**（分母 = 总轮次，口径一致）; `deltaDiff` / `capEntries` / `clinicalFlags` / `stale` **只在 ok=true 时累加**（失败轮次里它们是空壳，累加没有语义; 分母 = 成功轮次）。
- **失败轮次额外记 `error_<errorCode>`** —— 答"失败的主要原因是什么"。

### 2.6 决策 D6: 聚合纯函数放 `deliberation-stats.ts`（与写入侧**同文件**），不放任务单建议的 `insights-view.ts` / `deliberation-stats-view.ts`

- **任务单 §5.2** 写: "纯函数，放在 `insights-view.ts` 或新建一个 `deliberation-stats-view.ts`"。
- **本单改法**: 读写两侧放**同一个文件** `src/engine-adapters/deliberation/deliberation-stats.ts`。
- **为什么**: **存储格式的解读方必须与写入方同源**。计数器字段名（`total_turns` / `latency_b7` / `cap_<dim>`）是**存储格式的一部分** —— 拆两个文件就变成两份真相，迟早漂。
- **位置也顺带对了**: admin-debug 跨目录 import engine-adapters **有先例**（`debug-session.controller.ts` 已经 import `turn-delta-audit.port.js`），所以"纯适配层模块被 admin 端点读"不是破层。

### 2.7 决策 D7: 写入侧用**独立 try/catch**，不与 trace 写入共用一个

- **任务单 §4.2** 的理由写: "与 trace 写入同一次 Redis 操作，一致性最好"。
- **本单改法**: trace 写入（一次 `set`）与统计累加（一次 `eval`）是**两次独立的往返**，各有各的 try/catch。
- **为什么**:
  1. **共用一个 try 会把故障归错类** —— 统计写失败会被 catch 成"trace 写失败"，排查现场直接跑偏。
  2. **合并进一次 Lua 会让统计失败连坐 trace** —— trace 是主产物（失败记录不能丢，是 PoC 统计的原料），统计只是辅助。分离后"trace 写成功、统计写失败"还能从 trace 里手工补算; 合并后两者一起丢。
  3. **改写 trace 写路径不值** —— trace 写入是有 TTL、有降级口径的既有稳定路径，为省一次异步 side-channel 的往返去重写它，收益不抵风险。审议跑在 BullMQ worker 里，多一次 RTT 无所谓。
- **一致性的实际口径**: 计数器与 trace 的轮次数**允许差几条**（Redis 中途失败时）。看板要的是趋势，不是逐条对账; 真要精确对账，仍可以扫 trace。

### 2.8 决策 D8: controller 加**必填**第 4 参 `RedisService`，不做"可选依赖 + 运行时兜底"

- **为什么必填**: 可选依赖在 Nest DI 里会**静默注入 undefined** —— 端点一调就炸，而且报错现场离根因很远（上一单 B1 认定的最危险模式）。必填 = **编译器逼着每个构造点补上**，本单因此顺手把 3 个直接 `new AdminDebugController(...)` 的测试文件都改了。
- **`admin-debug.module.ts` 不用改**: `RedisModule` 是 `@Global()`（`redis.module.ts:26`），`RedisService` 全局可注入。

### 2.9 决策 D9: 读侧返回**裸对象**，且 **Redis 读失败直接抛错**（不兜底成 0）

- **返回裸对象**: admin-debug 既有惯例（WP58 的 `{code:0,data}` 是全仓唯一例外，前端对接别处勿套）。
- **读失败不兜底成 0**: 兜底成 0 会让看板显示"零失败零耗时" —— 那是**误导**（看板分不清"真的没数据"和"Redis 挂了"）。看板**宁可报错**，也不能装出一份看起来正常、其实是空的数据。这与写侧"统计写失败不影响审议"**方向相反但同源**: 写侧失败不影响**用户**，读侧失败不能欺骗**决策者**。

### 2.10 决策 D10: 熔断跳过的轮次**计入失败轮次**（`errorCode=circuit_open`）

- `recordCircuitOpen()` 也走 `writeTrace()` → 也会累加统计。口径上它是"**根本没跑**"（熔断器有意省钱），不是"跑了没成"。
- **为什么不把它排除**: 排除就要在写侧加一个特判分支，且读侧要额外区分"熔断跳过"与"真失败"—— 但任务单 §一 问的正是"失败的主要原因是什么"，`circuit_open` 占比高恰恰是**熔断器在起作用**的信号，混在失败分布里一眼可见。

### 2.11 决策 D11: 计数器**不设 TTL**、**不做 tenant 隔离**（照任务单 §4.4 / §七 4）

- 照任务单执行，无偏差。登记在此以便切灰度时清空: 统计 key 是 `deliberation_stats:global` 一份，`DEL` 掉即可重置（任务单 §七 3 明令本期**不做**重置接口）。

---

## 3. 闸门数字（本单实跑）

| 类型 | 命令 | 结果 |
|---|---|---|
| ESLint | `npx eslint "{src,test,bin}/**/*.ts"` | **0 error / 0 warning** ✅ |
| TypeScript | `npx tsc -p tsconfig.build.json --noEmit` | **0 error** ✅ |
| 本单新增单测 | `npx vitest run test/admin-debug/deliberation-stats.spec.ts` | **22 例全绿** ✅ |
| 全量单测 | `npx vitest run --exclude "**/e2e/**/*.ts"` | **129 文件 / 2208 例全绿** ✅ |
| 边界断言 | `npx vitest run test/engine-core/boundary.spec.ts` | **12 例全绿** ✅ |
| **engine-core 红线** | `git diff --stat HEAD -- src/engine-core` | **空**（零改动） ✅ |

**全量单测对比**: 改动前 **128 文件 / 2186 例**，改动后 **129 文件 / 2208 例**（+1 文件 = 本单新测试; +22 例 = 本单新增用例; **既有 2186 例零失败**）。

---

## 4. 验收逐条（任务单 §八）

| # | 闸门 | 要求 | 结果 |
|---|---|---|---|
| 1 | ESLint | 0 problem | ✅ **0 error / 0 warning** |
| 2 | TypeScript | 0 error | ✅ **0 error** |
| 3 | 单测 | 全量跑通，不新增失败 | ✅ **129 文件 / 2208 例全绿** |
| 4 | engine-core | 零改动 | ✅ **`git diff --stat HEAD -- src/engine-core` = 空** |
| 5 | 写入侧 | 成功轮次跑一次，计数器各字段累加正确 | ✅ 用例 ①-1（12 个计数器字段 + 2 个取大字段逐个断言） |
| 6 | 写入侧 | 失败轮次跑一次，total_turns / failure_turns 累加，其他字段不累加 | ✅ 用例 ①-2（**逐个断言"不该记的没记"**）+ §2.5 D5 的口径说明 |
| 7 | 读取侧 | 接口返回的字段形状与 §5.1 一致 | ✅ 用例 ②-1（18 个 key 逐字比对，**多一个少一个都红**） |
| 8 | 读取侧 | 成功率 = success_turns / total_turns，计算正确 | ✅ 用例 ②-2（3 成功 + 1 失败 → 0.75） |
| 9 | 读取侧 | 平均耗时 = total_duration_ms / total_turns，计算正确 | ✅ 用例 ②-3（100+200+300+400 → 250） |
| 10 | 边界 | 空数据（计数器全是 0）时，接口不崩，返回 0 而不是 NaN | ✅ 用例 ②-4（纯函数）+ ②-5（端点），逐字段断言"不是 NaN" |

---

## 5. 残留风险（本单**没有**解决的，登记在案）

### 5.1 ⚠️ Lua 脚本没有真 Redis 验证（**部署前建议跑一轮**）

- 本仓库**没有真 Redis 测试基础设施**（无 ioredis-mock / 无 testcontainers; BDI 的 CAS 脚本同样未测）→ 脚本**语法**在 CI 里跑不了。
- 本单的单测覆盖的是 **TS 侧的参数编排 + 聚合口径**（假 Redis 按脚本文档化的语义实现）; 另有 1 条用例**盯着脚本形状**（`HINCRBYFLOAT` / `HGET` / `HSET` 三个命令 + 两段 `i = i + 2` + 命令先后顺序）—— 改了 Lua 的 ARGV 布局它会红。
- **建议**: 部署前在 dev 环境跑一轮真 Redis 验证（写一个脚本、读一个脚本、确认 HINCRBYFLOAT 的整数形态与取大逻辑）。

### 5.2 ⚠️ 统计与 trace 的轮次数**允许差几条**

Redis 中途失败时，计数器和 trace 可能对不上（§2.7 D7 的取舍）。看板看趋势没问题; 要逐条对账仍可扫 trace。**真要对账**时以 trace 为准。

### 5.3 ⚠️ 统计**不区分 tenant**、**不区分模式**（考核 / 自由练习）

照任务单 §七 2 / §七 4（本期只做全局累计）。将来要多租户或分模式看板时，得改成**按维度分 key**（`deliberation_stats:{tenant}` / `deliberation_stats:{tenant}:{mode}`）—— 那是**另一个 key 命名方案**，本单没有预留。

### 5.4 ⚠️ 桶上界是**工程种子值**，不是实测分布

13 个桶是按"审议默认超时 3s"拍的。跑一段时间后如果绝大多数轮次都落在同一个桶里，桶要重划（**改桶要同时改读写两侧** —— 所以桶上界数组与桶字段名放在**同一个文件**里，见 §2.6）。

### 5.5 ⚠️ 前端面板**未做**

任务单 §七 5 明令本单不做（前端另一个 AI 的活）。本单只出后端接口。

---

## 6. 接口契约

```http
GET /admin/api/deliberation/stats
```

- **鉴权**: class 级 `AdminRoleGuard`（非 admin → 403）—— 新端点**自动继承**，用例 ③-2 钉死。
- **返回**: **裸对象**（admin-debug 既有惯例; WP58 的 `{code:0,data}` 是全仓唯一例外）。
- **失败**: Redis 读失败 → 直接抛错（全局过滤器 → 500），**不兜底成 0**。

| 字段 | 类型 | 口径 |
|---|---|---|
| `totalTurns` | number | 总轮次（成功 + 失败） |
| `successTurns` | number | 成功轮次 |
| `failureTurns` | number | 失败轮次（含熔断跳过） |
| `successRate` | number | `successTurns / totalTurns`（0-1） |
| `failureByErrorCode` | Record<string, number> | 失败原因分布（错误码 → 次数） |
| `avgDurationMs` | number | `totalDurationMs / totalTurns`（**含失败轮次**） |
| `maxDurationMs` | number | 最大耗时（精确值） |
| `p50DurationMs` | number | P50 耗时（**桶上界估计**） |
| `p95DurationMs` | number | P95 耗时（**桶上界估计**） |
| `avgRetryCount` | number | `totalRetryCount / totalTurns` |
| `avgPromptTokens` | number | `totalPromptTokens / totalTurns` |
| `avgCompletionTokens` | number | `totalCompletionTokens / totalTurns` |
| `avgDeltaDiffAbs` | number | `sumDeltaDiffAbs / **successTurns**` |
| `maxDeltaDiffAbs` | number | deltaDiff 最大绝对值（精确值） |
| `staleRate` | number | `staleTurns / **successTurns**`（0-1） |
| `capByDimension` | Record<string, number> | 被砍维度分布 |
| `clinicalByRule` | Record<string, number> | 临床 flagged 分布 |
| `flaggedTurnRate` | number | `flaggedTurns / **successTurns**`（0-1） |

**分母为什么有两种**: `durationMs` / `retryCount` / `tokenUsage` —— 失败轮次**也有**这些值 → 分母用**总轮次**; `deltaDiff` / `stale` / `clinical` —— 只有成功轮次才有意义 → 分母用**成功轮次**。

---

## 7. 隐私与安全（任务单 §六 逐条）

| 要求 | 落实 |
|---|---|
| 统计接口只出聚合数字，不含心理内容 | ✅ 计数器里只有计数 / 耗时 / token 数 / **维度名** / **规则名** —— 没有一句原话（trace 里的 `reason` / `summary` **不进**统计）。用例逐字段断言（②-1） |
| 鉴权: class 级已有 `AdminRoleGuard`，非 admin → 403 | ✅ 新端点继承 class 级 guard（用例 ③-2）; wp26 的硬编码端点清单同步登记 |
| 日志只出定位信息，不打对话原文 | ✅ 统计写失败只打 `[deliberation_shadow] 统计计数写入失败 (session=... turn=...)` —— 只有 id 与错误消息，**不含任何对话内容** |

---

## 8. 切灰度时必须知道的一件事（本单**不写进代码**，留给 Phase3A）

**统计计数器是"累计值"，不是"当前值"** —— 切灰度前要看的是**一段时间内的增量**，不是绝对值。任务单 §七 2 明令本期不做时间窗口统计（"不做时间窗口统计——本期只做累计"），所以现在的口径是:

- 想看"最近一周的 P95" → 要么手工 `DEL deliberation_stats:global` 重置后再跑一周，要么**加一个窗口维度**（那是后续单）。
- 建议 Phase3A 开工前先决定: 统计要不要**按天分桶**（`deliberation_stats:global:2026-11-07` 这样的日 key），那样"最近 7 天 P95"就是读 7 个 key。
