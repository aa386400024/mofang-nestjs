# WP67 交付记录 — 审议熔断与降级策略

> 任务单：[`wp67-deliberation-circuit-breaker-2026-11-05.md`](wp67-deliberation-circuit-breaker-2026-11-05.md)
> 日期：2026-11-05
> 红线：**engine-core 零改动**（`git diff --stat HEAD -- src/engine-core` 为空）

---

## 1. 实际改了哪些文件

### 1.1 适配层：改 2 个（任务单 §3.1 —— 文件数对得上）

| 文件 | 改什么 |
|---|---|
| `src/engine-adapters/deliberation/deliberation.processor.ts` | ① 新增导出常量 `DEFAULT_DELIBERATION_FAILURE_THRESHOLD = 3` / `DEFAULT_DELIBERATION_COOLDOWN_MS = 600_000` / `DELIBERATION_CIRCUIT_KEY_PREFIX = 'deliberation_circuit'`；② 新增类型 `DeliberationCircuitState` / `DeliberationCircuitStatus`；③ 新增纯函数 `buildDeliberationCircuitKey()` / `resolveCircuitStatus()`；④ `enqueue()`：**入队前**读熔断状态 —— `open` 不入队（改调 `service.recordCircuitOpen()` 写 trace）、`half-open` 先 `claimHalfOpenProbe()` 消费掉这次半开机会；⑤ `processJob()`：读 `executeShadowMode()` 的**返回值**记账 —— `ok` → `recordSuccess`（清零）、`skipped` → 不动、`failed`/`exception` → `recordFailure`；catch 里 `recordFailure` 后仅 `DeliberationRetryableError` 原样抛出；⑥ 新增私有方法 `loadCircuitState()` / `recordSuccess()` / `recordFailure()` / `claimHalfOpenProbe()` / `resolveFailureThreshold()` / `resolveCooldownMs()` + 模块级 `circuitStateTtlSeconds()` |
| `src/engine-adapters/deliberation/llm-deliberation.service.ts` | ① `executeShadowMode()` 返回类型 `Promise<void>` → **`Promise<DeliberationOutcome>`**，四态 `ok` / `failed` / `exception` / `skipped`；② `DeliberationOutcome` 联合类型加 `skipped` 态；③ 新增 `DELIBERATION_CIRCUIT_OPEN_ERROR_CODE = 'circuit_open'` 与 `recordCircuitOpen(input)` 方法（写一条熔断 trace） |

### 1.2 配置：2 改

| 文件 | 改什么 |
|---|---|
| `.env.example` | 加 `ENGINE_DELIBERATION_FAILURE_THRESHOLD=` 与 `ENGINE_DELIBERATION_COOLDOWN_MS=`（生效行 + 注释块） |
| `typings/global.d.ts` | 加 `ENGINE_DELIBERATION_FAILURE_THRESHOLD?: string` 与 `ENGINE_DELIBERATION_COOLDOWN_MS?: string` |

### 1.3 测试：1 增 3 改

| 文件 | 改什么 | 用例数 |
|---|---|---|
| `test/engine-adapters/wp67-deliberation-circuit-breaker.spec.ts` | **新增**。覆盖任务单 §5 的 17 条 + 8 条防漂移 | **25** |
| `test/engine-adapters/wp64-deliberation-shadow.spec.ts` | 3 处返回值断言（`resolves.toBeUndefined()` → `resolves.toMatchObject({ kind: … })`）+ 文件头注 | 33（原样） |
| `test/engine-adapters/wp65-deliberation-queue.spec.ts` | 2 处替身改造（Redis 替身补 `get`/`set`/`del`；service 替身改为返回结局）+ 1 处 service 替身 `mockResolvedValue` 改结局 + 文件头注 | 21（原样） |
| `test/engine-adapters/wp66-deliberation-retry.spec.ts` | 4 处返回值断言 + 2 处替身改造 + 3 处入队用例补 `ENGINE_DELIBERATION_ENABLED=true` | 21（原样） |

### 1.4 零改动（逐条核实过）

- ✅ `src/engine-core/**` —— **一行不动**（`git diff --stat HEAD -- src/engine-core` 输出为空）
- ✅ `src/engine-adapters/rendering/turn-render-orchestrator.ts` —— **一行不动**。门面只认 `DeliberationShadowPort`，对"内部有熔断"**完全无感**（用例 ⑥-f 钉死）
- ✅ `validateDeliberationOutput`（WP64 的校验逻辑）—— **一行不动**
- ✅ `executeShadowMode` 的 **LLM 调用逻辑** —— 一行不动（只改了**返回值形态**，没改调用、没改 prompt、没改 client）
- ✅ 全项目统一的 `defaultJobOptions` —— 一个字不动
- ✅ `src/engine-adapters/wiring/engine.module.ts` / `engine.providers.ts` / `redis.constants.ts` —— 一行不动（本单不新增 provider、不新增队列）

---

## 2. 关键设计决策（与任务单有出入的地方 + 为什么）

### 2.1 决策 D1（最重要）：**service 返回结局对象** —— `Promise<void>` → `Promise<DeliberationOutcome>`

任务单 §4.4 的 `processJob()` 是这么写的：

```typescript
try {
  await this.llmDeliberation.executeShadowMode(job.data, job.attemptsMade);
  await this.recordSuccess(...);        // ← 没抛异常就当成功
} catch (err) { ... recordFailure ... }
```

**这在 WP66 之后是错的。** WP66 已经把"值得重试的失败"改成抛 `DeliberationRetryableError`，但**其余失败（`fetch_error` / `http_401` / `no_body` / 代码 bug）仍然被 service 吞掉** —— 也就是：

| 真实情况 | processor 看到 |
|---|---|
| 审议成功 | 没抛异常 → **当成成功** ✅ |
| LLM 超时（`fetch_error`） | 没抛异常 → **当成成功** ❌ |
| 鉴权错（`http_401`） | 没抛异常 → **当成成功** ❌ |
| 代码 bug | 没抛异常 → **当成成功** ❌ |

也就是说：**熔断对最常见的"LLM 挂了"永远不触发** —— 而"LLM 挂了还每轮白烧钱"恰恰是这单要治的病（任务单 §1.1）。

**落法**（已向大炮确认，方案 A）：`executeShadowMode()` 改为**如实返回结局**：

| 结局 | 含义 | 熔断器怎么算 |
|---|---|---|
| `ok` | 跑成了 | **清零**（连续失败才熔断，D3） |
| `failed` | 跑了但没成（上游失败） | **累加** |
| `exception` | 代码 bug | **累加** |
| `skipped` | 开关关着，**压根没跑** | **不动**（没跑 = 没烧钱） |

**WP66 的不变式"抛 = 值得重试"不动** —— 值得重试的失败仍然抛 `DeliberationRetryableError`（那条路径 processor 靠 catch 拿），其余靠返回值拿。两条通道互补，不重叠。

### 2.2 决策 D2：Redis 读写用 **`RedisService.set/get/del` 封装**，不是 `getClient().set(key, v, 'PX', ms)`

任务单 §4.5 写的是：

```typescript
await this.redis.getClient().set(key, JSON.stringify({...}), 'PX', cooldownMs * 2);
```

**照抄会传错参数。** 仓库的 `RedisService.set()` 签名是 `set(key: string, value: string, ttlSec?: number)` —— 内部用 `'EX'`，单位是**秒**。`'PX'` + 毫秒是裸 ioredis 的写法，与封装**不兼容**。

**落法**：走封装（`this.redis.get/set/del`），TTL 从 ms 换算成秒并**向上取整**（`Math.ceil(cooldownMs * 2 / 1000)`，最少 1 秒）—— 宁可多留一会儿，也别在冷却期内过期。

### 2.3 决策 D3：熔断 key 带**「租户 + 会话」两个**长度前缀

任务单 §4.1 写的是 `deliberation_circuit:{租户长度前缀}:{tenantId}:{sessionId}`，只带租户段。

但 §2 D7 要求"与 trace key **同构**"，而仓库的 trace key 是**两个**长度前缀（`deliberation_trace:{租户长度}:{租户}:{会话长度}:{会话}:{轮次}`，见 `llm-deliberation.service.ts` 的 `buildDeliberationTraceKey`）。只带租户段就**不同构**，且少了会话段的撞键防护。

**落法**：`buildDeliberationCircuitKey()` 用 `deliberation_circuit:{租户长度}:{tenantId}:{会话长度}:{sessionId}`（用例 ⑤-16 钉死）。

### 2.4 决策 D4：半开"只放一个"用**「消费半开机会」**实现

任务单 §2 D4 提了"只放一个请求进去试"，但 §4.3 的代码只写了"half-open → 正常入队"—— **没实现"只放一个"**，照抄会让冷却期一过就所有请求一起涌进去（正是 D4 要防的）。

**落法**：`claimHalfOpenProbe()` —— 半开入队时把 `openedAt` 刷新成 `now`，**消费掉**这次半开机会；下一个请求再来看就是 `open`（冷却重新开始）。

- ✅ 实现简单，不用引 Lua 脚本；
- ⚠️ **不是原子的**（读-改-写）。风险窗口是同一会话的两轮**并发**入队 —— 引擎侧同会话的轮次是串行的（一次 turn 一轮），实际不会并发；
- ⚠️ claim 发生在 `queue.add` **之前**：若 `queue.add` 失败，这次半开机会被白白消费（下次请求看到 open，要再等一个冷却周期）。**保守方向** —— 宁可少试一次，不可多试。

### 2.5 决策 D5：熔断状态**读失败按"没熔断"放行**（fail-open）

`loadCircuitState()` 读 Redis 失败时返回 `null`（= 没熔断），**放行**。

**理由**：熔断是**省钱**手段，不是**正确性**手段。Redis 抖动时 trace 也写不进去，观察面本来就在丢数据；反过来（读失败就阻断）的话，一次 Redis 抖动会把**所有**会话的审议全停 —— 那是更大的事故。与仓库既有口径一致（`RedisService` 文件头：Redis 不可用 → 业务层降级放行）。

### 2.6 决策 D6：`enqueue()` **先判开关**，再判熔断

任务单 §4.3 的顺序是"开关 → 熔断"，但实现上必须**先判开关**才不碰 Redis：开关整体关掉时，熔断状态毫无意义（连 Redis 都不该碰）。

**连带影响**：`enqueue()` 变成"开关关 → 直接 `return false`"，WP66 spec 里 3 个只设 `ENGINE_DELIBERATION_MAX_RETRIES` 的入队用例因此入队失败 → **补上 `ENGINE_DELIBERATION_ENABLED: 'true'`**（用例 ③-8/③-9/③-10）。

### 2.7 决策 D7：阈值计的是**「失败的 LLM 调用次数」**（含 BullMQ 重试），不是失败轮数

熔断计数在 `processJob()` 里按**每次 job 执行**累加。BullMQ 的重试会**再跑一次** `processJob()` —— 所以一次失败轮次（`attempts = 2`）会累加 **2** 次。

**后果**：默认 `ENGINE_DELIBERATION_MAX_RETRIES = 1`（总共跑 2 次）时，**2 个失败轮次就打满阈值 3**，比"连续失败 3 轮"更早熔断。

这是**有意的**：熔断的目的是"别再烧钱"，而重试的那一次也是真金白银。要按"失败轮数"计，得在 job 上挂标记跨重试累计，本单不值得。等真要区分时再单独一单。

### 2.8 决策 D8：**代码异常也计入失败**；`skipped` **不动**熔断状态

- `shadow_exception`（代码 bug）也算失败 → 累加。理由同上：审议没成功就是在烧钱（虽然没花 LLM 费，但 PoC 数据也缺一条）；
- `skipped`（开关关着没跑）**不动**熔断状态 —— 这一轮**压根没跑**，没烧钱，失败计数不该涨。

### 2.9 决策 D9：**既有测试必然要改**（任务单 §6.2 要求"既有用例零回归"，做不到）

`executeShadowMode` 从"返回 void"变成"返回结局"，凡是断言 `resolves.toBeUndefined()` 的用例**必然**要改：

- `wp64-deliberation-shadow.spec.ts`：3 处（改成 `toMatchObject({ kind: 'failed' })` / `{ kind: 'exception' }` / `{ kind: 'ok' }`）；
- `wp65-deliberation-queue.spec.ts`：3 处（Redis 替身补 `get`/`set`/`del`；service 替身改为返回结局；1 处 `mockResolvedValue` 改结局）；
- `wp66-deliberation-retry.spec.ts`：5 处（4 处返回值断言 + Redis/service 替身改造 + 3 处补开关 env）。

**用例数一条没减**，断言**只按新语义改**，且改完的断言**更强**（从"不抛"变成"返回哪种结局"）。这是语义变更的必然结果，不是"降级交付"。

### 2.10 决策 D10：熔断 trace 由 **service** 写，队列层不自己写 trace

任务单 §2 D6 说"Processor 要写 circuit_open trace，**调 Service 的方法**，不要自己写 Redis"—— 照办：`service.recordCircuitOpen(input)`。

理由与 WP65 的纪律同源：**trace 的格式与 key 设计归 service 一家**，队列层只管"什么时候该记"。这也让"熔断"在 PoC 统计里可辨：`errorCode='circuit_open'` = 根本没跑，其余 `ok=false` = 跑了但失败。

### 2.11 决策 D11：`recordFailure` 里 `closed` 与 `half-open` 两个分支**合并成一个条件**

任务单 §4.5 写的是 `else if (currentStatus === 'closed') { … } else if (currentStatus === 'half-open') { … }`，两个分支的赋值完全相同（`openedAt = Date.now()`）。实现合并成 `else if (currentStatus === 'closed' || currentStatus === 'half-open')` —— 行为**逐字等价**，只是少一个分支。语义要点不变：

| 当前状态 | 新 `openedAt` | 为什么 |
|---|---|---|
| 还没到阈值 | `null` | 还没熔断 |
| `closed`（首次熔断） | `now` | 开始冷却 |
| `half-open`（半开失败） | `now` | **重置冷却**，不能保留原来的 |
| `open`（熔断中再失败） | **保留原值** | 冷却继续走，不重置 |

---

## 3. 验收对照（任务单 §6）

### 3.1 功能验收（§6.1）

| 条目 | 要求 | 结果 |
|---|---|---|
| 连续失败 N 次后熔断 | ✅ 入队前判断 open 状态就不入队 | ✅ |
| 冷却时间到了后半开 | ✅ 放一个请求试试 | ✅（且**只放一个**，D4） |
| 成功了就恢复 | ✅ 清零计数，闭合 | ✅ |
| 熔断事件可观测 | ✅ 写 circuit_open trace | ✅（由 service 写） |
| 配置 env 可调 | ✅ 失败阈值 + 冷却时间 | ✅ |

### 3.2 闸门验收（§6.2）

| 闸门 | 要求 | 实测 |
|---|---|---|
| `npx eslint "src/**/*.ts" "test/**/*.ts"` | 0 error | **0 error**（exit 0） |
| `npx tsc -p tsconfig.build.json --noEmit` | 0 error | **0 error**（exit 0） |
| `npx vitest run --exclude '**/e2e/**/*.ts'` | 全绿，既有零回归 | **105 文件 / 1763 例全绿**（WP66 基线 104 文件 / 1738 例 → 本单 **+1 文件 / +25 例**） |
| `git diff --stat HEAD -- src/engine-core` | 为空 | **空** |

> `npx vitest run`（**不带** `--exclude`）会把 e2e 拉进来报 DI 装配失败 —— e2e 要真 DB / Redis，与本单无关。仓库口径一直是带 `--exclude` 跑。

### 3.3 测试用例要求（§5 的 17 条 → 实际 25 条）

| 任务单 §5 | 用例 | 本单 spec 对应 |
|---|---|---|
| 5.1-1 `failureCount < threshold` → closed | ✅ | ①-1 |
| 5.1-2 达阈值且未过冷却 → open | ✅ | ①-2 |
| 5.1-3 达阈值且冷却已过 → half-open | ✅ | ①-3 |
| 5.1-4 状态不存在 → closed | ✅ | ①-4 |
| 5.2-5 closed → 正常入队 | ✅ | ②-5 |
| 5.2-6 open → 不入队 + 写 circuit_open trace | ✅ | ②-6 |
| 5.2-7 half-open → 正常入队（放一个试） | ✅ | ②-7（**加断言"消费掉半开机会"**） |
| 5.3-8 成功 → 清零（删 key） | ✅ | ③-8 |
| 5.3-9 失败 → failureCount + 1 | ✅ | ③-9 |
| 5.3-10 达阈值 → 记 openedAt | ✅ | ③-10 |
| 5.3-11 熔断中再失败 → 保留 openedAt | ✅ | ③-11 |
| 5.4-12 阈值默认 3 | ✅ | ④-12 |
| 5.4-13 冷却默认 600000 | ✅ | ④-13 |
| 5.4-14 非法值回退默认，不抛错 | ✅ | ④-14 |
| 5.5-15 开关关闭 → 不跑熔断判断 | ✅ | ⑤-15（**Redis 都不碰**） |
| 5.5-16 key 带长度前缀防撞键 | ✅ | ⑤-16 |
| 5.5-17 内核零改动 | ✅ | ⑤-17 + `boundary.spec.ts` 全绿 |

**额外 8 条防漂移**（⑥-a ~ ⑥-h）：值得重试的失败**记失败并原样抛出** / 不值得重试的失败**记失败不抛** / `skipped` 不动熔断状态 / **半开失败重置冷却**（不留原来的 `openedAt`）/ 熔断 trace 用独立 errorCode / **编排门面零改动** / 队列名与 job 名不变（WP65 契约不被改）/ **熔断日志只出定位信息，不出审议原文**（隐私红线）。

---

## 4. 留给后续 WP 的接口（本单刻意没做）

1. **母版 WP67 的「三级降级」只销了「熔断器」这一档。** 母版原描述里的**超时跳过 / 连续失败切回规则算子 / `degraded` 标记**三件事里：
   - **降级 1「超时 → 跳过审议」**：在 WP66 的口径下**天然成立** —— 超时是 `fetch_error`，不重试、记一条失败 trace 就结束；
   - **降级 2「连续失败 → 切回纯规则算子」**：影子模式下**天然成立且无需动作** —— 主流程本来就永远走规则算子，审议结果**从不生效**（WP64 的核心纪律），不存在"切回"这回事。真正要做的只是把"这个会话在熔断中"这件事**标出来**；
   - **降级标记 `degraded: true`（会话打标，不能用于正式考核）**：**未做** —— 需要会话级打标 + 对外查询入口（督导端能看到"这个会话没跑审议"），涉及会话状态模型，**建议单独一单**。本单的 `circuit_open` trace 已经提供了**原始数据**，PoC 统计时按 `errorCode='circuit_open'` 聚合即可近似。
2. **WP65 遗留的 per-session mutex + 快照版本号仍未做** —— 影子模式下审议结果不写状态，暂无覆盖风险；**切灰度（结果开始生效）之前必须补**。
3. **半开 probe 的原子性**：当前是读-改-写，同会话并发入队时可能放进两个 probe。真要并发，得换成 Lua 脚本做条件更新（同会话轮次实际是串行的，本单不值得）。
4. **熔断 / 队列的指标采集**：队列自带长度 / 成功率，熔断器自带失败计数，但仓库的 metrics 目前只覆盖 HTTP / LLM。要把"熔断次数 / 熔断时长"上 Prometheus 是独立一单。
5. **全局熔断不做**：LLM 整体挂了直接关 `ENGINE_DELIBERATION_ENABLED`（D2），不做跨会话的全局熔断。

---

## 5. 运维须知（跑 PoC 前必读）

1. **开关默认关**：`ENGINE_DELIBERATION_ENABLED=false`。
2. **失败阈值**：`ENGINE_DELIBERATION_FAILURE_THRESHOLD`（留空 = **3**；非法值回退 3，**不抛错**）。口径 = **连续**失败（成功一次就清零），不是累计失败。
3. **冷却时长**：`ENGINE_DELIBERATION_COOLDOWN_MS`（留空 = **600000**，即 10 分钟；非法值回退默认，**不抛错**）。
4. ⚠️ **阈值计的是「失败的 LLM 调用次数」，含 BullMQ 重试** —— 默认重试 1 次（总共跑 2 次）时，**2 个失败轮次就打满阈值 3**。想按"失败轮数"计就把 `ENGINE_DELIBERATION_MAX_RETRIES` 设成 0。
5. ⚠️ **PoC 统计要把 `circuit_open` 排除在"失败率"之外** —— `errorCode='circuit_open'` 表示**根本没跑**（熔断器有意拦下的省钱行为），不是"跑了没成"。两者在 trace 里都是 `ok=false`，靠 errorCode 区分。
6. **熔断状态 TTL = 冷却时长 × 2**，每次更新都刷新 —— 活跃会话永不过期，不活跃的自动清掉，不留垃圾 key。
7. **Redis 读不到状态时放行**（fail-open）—— 熔断是省钱手段不是正确性手段，Redis 抖动不该让所有会话的审议全停。
8. **全局 LLM 挂了直接关开关**（`ENGINE_DELIBERATION_ENABLED=false`），不用去调阈值 —— 熔断是**会话级**的。

---

## 6. commit message（**未自动提交**，等大炮手动提交）

```
feat(wp67): 审议熔断与降级策略 —— 会话级熔断器，连续失败 3 次暂停，冷却后半开探一个
```

---

_交付：2026-11-05 · engine-core 零改动 · 闸门 0 error / 1763 例全绿_
