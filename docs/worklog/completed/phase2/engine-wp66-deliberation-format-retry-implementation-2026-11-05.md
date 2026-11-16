# WP66 交付记录 — 审议输出格式校验与重试

> 任务单：[`../../pending/wp66-deliberation-format-retry-2026-11-05.md`](../../pending/wp66-deliberation-format-retry-2026-11-05.md)
> 日期：2026-11-05
> 红线：**engine-core 零改动**（`git diff --stat HEAD -- src/engine-core` 为空）

---

## 1. 实际改了哪些文件

### 1.1 适配层：改 2 个（任务单 §3.1 —— 文件数对得上）

| 文件 | 改什么 |
|---|---|
| `src/engine-adapters/deliberation/llm-deliberation.service.ts` | ① 新增 `DeliberationRetryableError` + `DELIBERATION_RETRYABLE_ERROR_CODES` + `isRetryableDeliberationError()`（类型守卫）；② `executeShadowMode(input, retryCount = 0)`：**先写 trace 再抛**值得重试的失败；③ 拆出私有方法 `runDeliberation()`（把"跑"与"判"分开，抛异常的语句永远在 try 之外）；④ `DeliberationTraceRecord` 加 `retryCount` 字段 |
| `src/engine-adapters/deliberation/deliberation.processor.ts` | ① `enqueue()` 用 **job 级** `attempts = maxRetries + 1` 覆盖默认的 3（全项目 `defaultJobOptions` 一个字不动）；② `processJob()` 把 `job.attemptsMade` 当 `retryCount` 传下去；③ job handler **故意不 catch**；④ 新增 `resolveMaxRetries()`（env `ENGINE_DELIBERATION_MAX_RETRIES`，默认 1） |

### 1.2 配置：2 改

| 文件 | 改什么 |
|---|---|
| `.env.example` | 加 `ENGINE_DELIBERATION_MAX_RETRIES=`（生效行 + 注释块） |
| `typings/global.d.ts` | 加 `ENGINE_DELIBERATION_MAX_RETRIES?: string` |

### 1.3 测试：1 增 2 改

| 文件 | 改什么 | 用例数 |
|---|---|---|
| `test/engine-adapters/wp66-deliberation-retry.spec.ts` | **新增**。覆盖任务单 §5 的 13 条 + 8 条防漂移 | **21** |
| `test/engine-adapters/wp64-deliberation-shadow.spec.ts` | 2 条用例的**语义**随 WP66 变（json_parse_failed 现在会抛；错误码换成真实码）—— 用例数不变 | 33（原样） |
| `test/engine-adapters/wp65-deliberation-queue.spec.ts` | 3 处同步（`executeShadowMode` 多收 `attemptsMade`；json_parse_failed 现在会抛；错误码换成真实码）—— 用例数不变 | 21（原样） |

### 1.4 零改动（逐条核实过）

- ✅ `src/engine-core/**` —— **一行不动**（`git diff --stat HEAD -- src/engine-core` 输出为空）
- ✅ `src/engine-adapters/rendering/turn-render-orchestrator.ts` —— **一行不动**。门面只认 `DeliberationShadowPort`，对"内部有重试"**完全无感**
- ✅ `validateDeliberationOutput`（WP64 的校验逻辑）—— **一行不动**。本单只加"该不该重试"的判定，不动"合不合法"的判定
- ✅ 全项目统一的 `defaultJobOptions` —— **一个字不动**（`attempts: 3` 仍在队列默认里，只在本 job 上覆盖）
- ✅ `src/engine-adapters/wiring/engine.module.ts` / `engine.providers.ts` / `redis.constants.ts` —— 一行不动（本单不新增 provider、不新增队列）

---

## 2. 关键设计决策（与任务单有出入的地方 + 为什么）

### 2.1 决策 D1：**错误码词表按真实实现修正**，重试集合 = 形状类 + 限流/5xx

任务单 §2 D1 的码表与代码里的**真实错误码词表对不上**（grep 核实）：

| 任务单写的 | 实际情况 |
|---|---|
| `timeout` | **根本不存在** —— `LlmService` 的 catch-all 产出的是 `fetch_error`（超时也落这里） |
| `llm_error` | **从不作为 errorCode 产生** —— `CounselorLlmJsonClient` 直接透传 `chunk.error.code`，client 自己只产 `json_not_found` / `json_parse_failed` / `schema_validation_failed` |
| （没提）`json_not_found` | **真实存在**，且是最典型的"模型抽风"（压根没吐 JSON）—— 被任务单漏掉了 |

真实词表（`llm-json.client.ts` + `llm.service.ts`）：
`json_not_found` / `json_parse_failed` / `schema_validation_failed` / `http_401` / `http_429` / `http_500`… / `no_body` / `parse_error` / `fetch_error` / `unknown`。

**落法**（与大炮确认过的方案 A）：值得重试的 = **形状类**（`json_not_found` / `json_parse_failed` / `schema_validation_failed` / `parse_error`）+ **限流与 5xx**（`http_429` / `http_5*`）；不值得重试的 = 鉴权 4xx / `fetch_error`（网络与超时）/ `no_body` / `unknown` / `shadow_exception`（代码 bug）。

**与仓库既有口径一致**：`src/counselor/providers/supervision-failure.ts` 的 `mapLlmErrorCodeToFailureCode` 也是把 429 / 5xx / JSON+schema 归为"可重试"，把鉴权与素材类归为"永久性"。本次是**同一个判据的第二次落地**，不是新发明一套。

### 2.2 决策 D2：**5xx 用前缀匹配**（`http_5*`），不只列 `http_500`

上游的 5xx 不止一种（`http_500` / `http_502` / `http_503`…），逐个列永远列不全；而 4xx（除 429）是**请求本身有问题**，重试无意义 —— 所以按"`http_5` 开头"一刀切。

### 2.3 决策 D3：**"跑"与"判"拆成两个方法**，抛异常的语句永远在 try 之外

WP64 的 `executeShadowMode` 是一条大 `try { … } catch { 吞掉 }`。WP66 要在里面**抛** `DeliberationRetryableError` —— 如果抛在 try 块里，会被**自己写的 catch 吞掉**，重试永远不发生（这正是任务单 §1.1 想解决的那个"重试形同虚设"）。

**落法**：把 LLM 调用抽到私有方法 `runDeliberation()`，它自己 catch 住代码异常并返回**结构化结局**（`ok` / `failed` / `exception`）；`executeShadowMode()` 只做"写 trace → 要不要抛"的编排，全程不在 try 里。这样"抛异常的语句被自己吞掉"这个坑**结构性地踩不到**，而不是靠注释提醒。

### 2.4 决策 D4：`isRetryableDeliberationError()` 做成**类型守卫**

返回 `errorCode is string` 而不是 `boolean`：判定为 true 时，调用方手里的 `string | null` 自动收窄成 `string`，构造 `DeliberationRetryableError(errorCode, …)` 不用再补一次空值判断（否则 TS2345）。

### 2.5 决策 D5：重试次数在**入队时**读（不是执行时读）—— job 选项的物理限制

仓库硬约束 12 是"异步任务的偏好在**执行时**读"。但 `attempts` 是 **BullMQ 的 job 选项**，入队后就固定了，改 env 对已经在队列里的 job 无效。

- **开关**（`ENGINE_DELIBERATION_ENABLED`）仍然**入队前 + 执行时各判一次** —— 那一条不受影响；
- **重试次数**只能在入队时读 —— 这是 job 选项的物理限制，不是偷懒，已在代码注释与 `.env.example` 里写明。

### 2.6 决策 D6：**本单推翻了 WP65 的"job handler 永不抛"**（而且推得有理）

WP65 §2.7 写的是「Worker 的 job handler 永不抛：审议失败不该把 job 打成 failed（那会触发无意义的重试，再烧三次 LLM）」。

WP66 把这条**故意推翻**，因为它把范围收窄了：
- WP65 拒绝抛，是因为"**任何**失败都重试 = 白烧三次 LLM"；
- WP66 只让"**值得重试的那几种**"抛出去 —— 这时抛才有意义。

不改的话，BullMQ 的重试机制对审议**永远是死的**（任务单 §1.1 的核心痛点）。

### 2.7 决策 D7：`retryCount` 的语义 = **已重试次数**（0 = 第一次跑）

从 BullMQ 的 `job.attemptsMade` 来。仓库自己的注释已经确认了这个口径（`counselor-supervision.processor.ts:166`）：「worker 回调里 `attemptsMade` 是"已经尝试过几次"，**首次执行时为 0**」→ 正好等于"已重试次数"。任务单 §2 D4 的说法与此一致，**无偏差**。

### 2.8 决策 D8：**既有测试必然要改**（任务单 §6.2 要求"既有用例零回归"，做不到）

`executeShadowMode` 从"永不抛"变成"只抛一种异常"，凡是断言"json_parse_failed 不抛"的用例**必然**要改：

- `wp64-deliberation-shadow.spec.ts`：1 条（json_parse_failed 那条改成"抛 + trace 已写"）+ 1 条错误码换成真实码（`llm_error` → `no_body`）；
- `wp65-deliberation-queue.spec.ts`：3 处（②-5 多收 `attemptsMade`；②-7 改成"抛"；②-6 / ②-8 错误码换成真实码 `fetch_error`）。

**用例数一条没减，断言只按新语义改**。这是语义变更的必然结果，不是"降级交付"。

### 2.9 决策 D9：错误码也顺手纠偏了**既有两个 spec**（不是本单引入的问题）

`llm_error` 这个码在 client 里**根本不会被产生**，但 WP64 / WP65 的用例一直在用它 —— 属于此前就存在的"对着不存在的码写断言"。本单把它们换成真实码（`no_body` / `fetch_error`），顺手让测试回到真实世界。

### 2.10 决策 D10：`trace` 仍是**覆盖写**（任务单 §3 D3）

同一个 trace key（`deliberation_trace:{租户长度}:…:{轮次}`）第二次写覆盖第一次。所以：第一次失败写 `ok=false`，重试成功写 `ok=true` **覆盖掉**它 —— 最后留的就是最终结果，PoC 统计直接数 `ok=true` 的条数，不用去重。`retryCount` 字段记的是**最后一次尝试**的重试次数。

---

## 3. 验收对照（任务单 §6）

### 3.1 功能验收（§6.1）

| 条目 | 要求 | 结果 |
|---|---|---|
| 值得重试的错误码触发 BullMQ 重试 | ✅ 形状类 + 429/5xx 抛 `DeliberationRetryableError` | ✅ |
| 不值得重试的错误码不触发重试 | ✅ 鉴权 / `fetch_error` / `no_body` / 代码 bug 正常完成 | ✅ |
| 重试次数 env 可配，默认 1 次 | ✅ `ENGINE_DELIBERATION_MAX_RETRIES` | ✅ |
| trace 里带 `retryCount` | ✅ 从 `job.attemptsMade` 拿 | ✅ |
| 失败记录不丢 —— 先写 trace 再抛 | ✅ | ✅ |

### 3.2 闸门验收（§6.2）

| 闸门 | 要求 | 实测 |
|---|---|---|
| `npx eslint "src/**/*.ts" "test/**/*.ts"` | 0 error | **0 error**（exit 0） |
| `npx tsc -p tsconfig.build.json --noEmit` | 0 error | **0 error**（exit 0） |
| `npx vitest run --exclude '**/e2e/**/*.ts'` | 全绿，既有零回归 | **104 文件 / 1738 例全绿**（WP65 基线 103 文件 / 1717 例 → 本单 **+1 文件 / +21 例**） |
| `git diff --stat HEAD -- src/engine-core` | 为空 | **空** |

> `npx vitest run`（**不带** `--exclude`）会把 e2e 拉进来报 DI 装配失败 —— e2e 要真 DB / Redis，与本单无关。仓库口径一直是带 `--exclude` 跑。

### 3.3 测试用例要求（§5 的 13 条 → 实际 21 条）

| 任务单 §5 | 用例 | 本单 spec 对应 |
|---|---|---|
| 5.1-1 `json_parse_failed` → 抛 `DeliberationRetryableError` | ✅ | ①-1 |
| 5.1-2 `schema_validation_failed` → 抛 | ✅ | ①-2 |
| 5.1-3 `timeout` → 不抛 | ✅ | ①-3（**换成真实码 `fetch_error`** —— `timeout` 这个码不存在，超时的真实落点就是它） |
| 5.1-4 `llm_error` → 不抛 | ✅ | ①-4（**换成真实码 `http_401`** —— `llm_error` 不会被 client 产生） |
| 5.2-5 失败时 trace 里 `retryCount` = 传入的值 | ✅ | ②-5 |
| 5.2-6 成功时 trace 里 `retryCount` = 传入的值 | ✅ | ②-6 |
| 5.2-7 写 trace 在抛异常之前 | ✅ | ②-7 |
| 5.3-8 默认 1 次重试（总共跑 2 次） | ✅ | ③-8 |
| 5.3-9 非法值回退默认 1，不抛错 | ✅ | ③-9 |
| 5.3-10 job 级 `attempts` = `maxRetries + 1` | ✅ | ③-10 |
| 5.4-11 开关关闭 → 不跑 LLM / 不抛 / 不重试 | ✅ | ④-11 |
| 5.4-12 Worker handler 不 catch | ✅ | ④-12 |
| 5.4-13 内核零改动 | ✅ | ④-13 + `boundary.spec.ts` 全绿 |

**额外 8 条防漂移**（⑤-a ~ ⑤-h）：值得重试的码表驱动判定 / 不值得重试的码表驱动判定 / 大小写不敏感 + 常量集合是唯一真相源 / 代码异常不抛不重试 / **重试成功后覆盖之前的失败 trace**（任务单 D3）/ `processJob` 把 `attemptsMade` 传下去 / **编排门面零改动** / 队列名与 job 名不变。

---

## 4. 留给后续 WP 的接口（本单刻意没做）

1. **WP67（三级降级）**：降级 1「超时 → 跳过审议」在本单的口径下**天然成立** —— 超时是 `fetch_error`，不重试、记一条失败 trace 就结束。降级 2「连续失败 → 切回纯规则」需要**会话级**的失败计数与 `degraded` 标记，那是 WP67 的活（队列层是跨会话跑的，别把降级状态放队列层）。
2. **WP68（意图锁定）**：与本单无耦合。
3. **`response_format: json_object`（任务单 §6.1 的 WP66 目标之一）**：本单**没做** —— 仓库的结构化输出只有一条链（`CounselorLlmJsonClient`），它**不下发** `response_format`（上游 MiniMax 也不支持 provider 级 `response_format`，见 `llm-json.client.ts` 文件头）。要强制 JSON 得改 client（那是结构化出口的改动，影响 6 个既有调用方），建议**单独一单**，不在本单夹带。
4. **zod schema 校验**：本单**没引** —— 仓库红线禁自动装依赖，且 WP64 的 `validateDeliberationOutput` 已经够用（任务单 §3.4 明确"校验逻辑一行不动"）。
5. **BullMQ 队列指标采集**：队列自带长度 / 成功率 / 失败原因，但仓库的 metrics 目前只覆盖 HTTP / LLM。要做是独立一单。

---

## 5. 运维须知（跑 PoC 前必读）

1. **开关默认关**：`ENGINE_DELIBERATION_ENABLED=false`。
2. **重试次数**：`ENGINE_DELIBERATION_MAX_RETRIES`（留空 = **1**，即总共跑 2 次；非法值回退 1，**不抛错**）。
   - 只对"值得重试"的失败生效 —— 模型输出形状不对（JSON 没吐出来 / 形状不符 / SSE 解析失败）或上游限流与 5xx；
   - **不生效**于：鉴权错（401/403）、网络与超时（`fetch_error`）、空响应（`no_body`）、代码 bug。
3. **重试会让 PoC 的 LLM 账单最多翻倍**（默认 1 次重试 → 每轮最多 2 次调用）。盯 token 账单。
4. **重试次数在入队时固定**：改了 env 之后，**已经在队列里的 job 仍按旧的重试次数跑**（BullMQ job 选项的物理限制）。
5. **失败记录不丢**：值得重试的失败也会写 trace（`ok=false` + `errorCode`），重试成功后会**覆盖**那条失败记录 —— 最后留的是最终结果。

---

## 6. commit message（**未自动提交**，等大炮手动提交）

```
feat(wp66): 审议输出格式校验与重试 —— 按错误类型分流，形状类与 429/5xx 走 BullMQ 重试，先写 trace 再抛
```

---

_交付：2026-11-05 · engine-core 零改动 · 闸门 0 error / 1738 例全绿_
