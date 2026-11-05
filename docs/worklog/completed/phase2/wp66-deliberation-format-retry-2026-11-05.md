# WP66 任务单 — 审议输出格式校验与重试

> **状态**：✅ 已交付（2026-11-05）→ [`engine-wp66-deliberation-format-retry-implementation-2026-11-05.md`](engine-wp66-deliberation-format-retry-implementation-2026-11-05.md)
> **路径**：`docs/worklog/completed/phase2/wp66-deliberation-format-retry-2026-11-05.md`
> 优先级: 🟡 P1 (PoC 组基础设施)
> 前置: WP65 (审议影子模式 BullMQ 队列化) 已交付核验
> 红线: engine-core 零改动
> 北极星: [`../../../architecture/hybrid-bdi-agent-blueprint-v1.0.md`](../../../architecture/hybrid-bdi-agent-blueprint-v1.0.md) §2.2 审议引擎层

---

## 1. 背景与目标

### 1.1 为什么要做这个 WP

WP65 把影子模式改成了 BullMQ 队列，但有两个问题：

1. **校验失败后，BullMQ 的重试机制形同虚设**——因为 `executeShadowMode` 内部把所有异常 catch 住了，永不抛，所以 `attempts: 3` 根本没被触发
2. **不是所有错误都值得重试**——JSON 解析失败可能值得重试一次（模型抽风），但超时重试也没用（3s 超时是我们自己设的）

### 1.2 本 WP 要做什么

给影子模式加上**智能重试**：
- 区分错误类型——哪些值得重试，哪些不值得
- 值得重试的错误 → 抛异常让 BullMQ 自动重试
- 不值得重试的错误 → 正常完成，不触发重试
- 重试次数 env 可配，默认 1 次（LLM 调用贵，不能随便重试 3 次）

---

## 2. 设计决策

### D1: 值得重试的错误码只有两个

| 错误码 | 值得重试吗 | 理由 |
|---|---|---|
| `json_parse_failed` | ✅ 值得 | 推理模型偶尔把 JSON 写半截，换一次可能就好了 |
| `schema_validation_failed` | ✅ 值得 | 顶层形状不对，可能是模型没按 schema 来，重试一次试试 |
| `timeout` | ❌ 不值得 | 3s 超时是我们自己设的，重试还是超时 |
| `llm_error` | ❌ 不值得 | 4xx 客户端错误重试也没用，5xx 概率低不单独处理 |
| `shadow_exception` | ❌ 不值得 | 代码 bug 重试也没用 |

> 做成常量数组写死，不做成 env 配置——现在就两种，以后要加改代码就行。

### D2: 重试次数默认 1 次（不是 3 次）

- BullMQ 全项目统一的 `defaultJobOptions.attempts = 3` 是给审计日志那种轻任务用的
- 审议是 LLM 调用，一次几毛钱，重试 3 次就是 3 倍成本
- 本 WP 用 **job 级配置覆盖**：`attempts = ENGINE_DELIBERATION_MAX_RETRIES + 1`（第一次跑 + N 次重试）
- 默认 `ENGINE_DELIBERATION_MAX_RETRIES = 1`，总共跑 2 次

### D3: trace key 是覆盖写，重试过程不额外留痕

trace key = `deliberation_trace:{...}:{turnIndex}`——同一个 key 第二次写会覆盖第一次。

这意味着：
- 第一次失败写一条 ok=false 的 trace
- 重试成功了，写一条 ok=true 的 trace，**覆盖掉之前那条失败的**
- 最后留的就是最终结果，PoC 统计成功率直接数 ok=true 的条数，不用去重

> 过程数据（重试了几次）不重要，重要的是最后成功了还是失败了。

### D4: trace 加 `retryCount` 字段

从 BullMQ 的 `job.attemptsMade` 拿，写进 trace 里。方便统计的时候看"有多少轮是靠重试成功的"。

---

## 3. 改动文件清单

### 3.1 改 2 个文件

| 文件 | 改什么 |
|---|---|
| `src/engine-adapters/deliberation/llm-deliberation.service.ts` | ① `executeShadowMode` 加一个可选参数 `retryCount?: number`，写 trace 的时候带上；② 定义"值得重试的错误码集合"常量；③ 跑完后如果 errorCode 在集合里，**抛 `DeliberationRetryableError`**（先写 trace，再抛） |
| `src/engine-adapters/deliberation/deliberation.processor.ts` | ① `processJob()` 里把 `job.attemptsMade` 传给 `executeShadowMode`；② `enqueue()` 里给 job 配 `attempts: ENGINE_DELIBERATION_MAX_RETRIES + 1`（job 级覆盖）；③ Worker handler **不 catch**——让 `DeliberationRetryableError` 自然抛出来，BullMQ 自动重试 |

### 3.2 配置：2 改

| 文件 | 改什么 |
|---|---|
| `.env.example` | 加 `ENGINE_DELIBERATION_MAX_RETRIES=`（生效行 + 注释块） |
| `typings/global.d.ts` | 加 `ENGINE_DELIBERATION_MAX_RETRIES?: string` |

### 3.3 测试：1 增

| 文件 | 改什么 |
|---|---|
| `test/engine-adapters/wp66-deliberation-retry.spec.ts` | 新增测试用例（详见 §5） |

### 3.4 零改动确认

- ❌ `src/engine-core/**` —— 一行不动
- ❌ `turn-render-orchestrator.ts` —— 一行不动
- ❌ `validateDeliberationOutput` 校验逻辑 —— 一行不动（WP64 已经够了）
- ❌ 全项目统一的 `defaultJobOptions` —— 不动，我们用 job 级覆盖

---

## 4. 关键实现细节

### 4.1 值得重试的错误码集合

```typescript
/** 值得重试的错误码 (模型抽风类, 换一次可能就好了). */
const RETRYABLE_ERROR_CODES = new Set(['json_parse_failed', 'schema_validation_failed']);
```

### 4.2 DeliberationRetryableError

```typescript
/**
 * 值得重试的错误 —— 抛这个异常让 BullMQ 自动重试.
 *
 * ⚠️ 只在"写 trace 之后"抛 —— 失败记录不能丢, PoC 统计要用.
 */
export class DeliberationRetryableError extends Error {
  constructor(
    public readonly errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'DeliberationRetryableError';
  }
}
```

### 4.3 executeShadowMode 的变化

```typescript
async executeShadowMode(input: DeliberationShadowInput, retryCount = 0): Promise<void> {
  // ... 原来的逻辑不变 ...
  
  // 跑完之后, 如果是值得重试的错误, 抛异常让 BullMQ 重试
  if (result.errorCode && RETRYABLE_ERROR_CODES.has(result.errorCode)) {
    // trace 已经写了 (上面写的), 现在抛异常触发重试
    throw new DeliberationRetryableError(result.errorCode, `审议失败, 值得重试: ${result.errorCode}`);
  }
}
```

> ⚠️ 注意：**先写 trace，再抛异常**。失败记录不能丢，PoC 统计要用。

### 4.4 DeliberationProcessor 的变化

```typescript
// enqueue() 里加 job 级配置
async enqueue(input: DeliberationShadowInput): Promise<boolean> {
  try {
    await this.queue.add(DELIBERATION_JOB_NAME, input, {
      jobId: buildDeliberationJobId(input.tenantId, input.sessionId, input.turnIndex),
      // 重试次数: 第一次跑 + N 次重试 (job 级覆盖 defaultJobOptions)
      attempts: this.resolveMaxRetries() + 1,
      backoff: { type: 'exponential', delay: 1000 },
    });
    return true;
  } catch (err) {
    // ... 原来的逻辑 ...
  }
}

// processJob() 里把 attemptsMade 传进去
private async processJob(job: Job<DeliberationShadowInput>): Promise<void> {
  // ⚠️ 不 catch —— 让 DeliberationRetryableError 自然抛出来, BullMQ 自动重试
  await this.llmDeliberation.executeShadowMode(job.data, job.attemptsMade);
}

// 解析最大重试次数
private resolveMaxRetries(): number {
  const raw = (this.config.get<string>('ENGINE_DELIBERATION_MAX_RETRIES') ?? '').trim();
  if (raw.length === 0) return 1; // 默认 1 次重试, 总共跑 2 次
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 1;
  return Math.floor(parsed);
}
```

---

## 5. 测试要求

新增 `test/engine-adapters/wp66-deliberation-retry.spec.ts`，覆盖以下用例：

### 5.1 重试触发逻辑（4 例）

1. ✅ `json_parse_failed` → 抛 `DeliberationRetryableError`，触发重试
2. ✅ `schema_validation_failed` → 抛 `DeliberationRetryableError`，触发重试
3. ✅ `timeout` → 不抛，正常完成，不触发重试
4. ✅ `llm_error` → 不抛，正常完成，不触发重试

### 5.2 trace 记录（3 例）

5. ✅ 失败时 trace 里 `retryCount` = 传入的值
6. ✅ 成功时 trace 里 `retryCount` = 传入的值
7. ✅ 写 trace 的逻辑在抛异常之前——即使抛了，trace 也已经写了

### 5.3 配置（3 例）

8. ✅ `ENGINE_DELIBERATION_MAX_RETRIES` 默认 1（总共跑 2 次）
9. ✅ env 配非法值时回退默认 1，不抛错
10. ✅ enqueue 时 job 级 `attempts` = `maxRetries + 1`

### 5.4 边界（3 例）

11. ✅ 开关关闭时，不跑 LLM，不抛异常，不触发重试
12. ✅ Worker handler 不 catch `DeliberationRetryableError`——让 BullMQ 自动处理
13. ✅ `boundary.spec.ts` 11 条断言全绿（engine-core 零改动）

---

## 6. 验收标准

### 6.1 功能验收

| 条目 | 要求 |
|---|---|
| 值得重试的错误码触发 BullMQ 重试 | ✅ json_parse_failed / schema_validation_failed 抛 DeliberationRetryableError |
| 不值得重试的错误码不触发重试 | ✅ timeout / llm_error 正常完成，不抛 |
| 重试次数 env 可配，默认 1 次 | ✅ ENGINE_DELIBERATION_MAX_RETRIES |
| trace 里带 retryCount | ✅ 从 job.attemptsMade 拿 |
| 失败记录不丢——先写 trace 再抛异常 | ✅ |

### 6.2 闸门验收

| 闸门 | 要求 |
|---|---|
| `npx eslint "src/**/*.ts" "test/**/*.ts"` | 0 error |
| `npx tsc -p tsconfig.build.json --noEmit` | 0 error |
| `npx vitest run --exclude '**/e2e/**/*.ts'` | 全绿，既有用例零回归 |
| `git diff --stat HEAD -- src/engine-core` | 为空 |

---

## 7. 交付后补记要求

交付时请写明：
1. 实际改了哪些文件，和任务单 §3 对不对得上
2. 有没有设计偏差，为什么
3. 测试用例数、全量测试跑下来多少绿
4. env 键全不全（双向覆盖断言过没过）

---

_创建：2026-11-05_
_前置依赖：WP65 已交付核验（98/100）_

---

## 8. 交付后补记（2026-11-05）

> 交付记录：[`engine-wp66-deliberation-format-retry-implementation-2026-11-05.md`](engine-wp66-deliberation-format-retry-implementation-2026-11-05.md)
> 下表逐条登记**与任务单原文的偏差**，每条都能自圆其说。

| # | 任务单原文 | 实际落地 | 为什么 |
|---|---|---|---|
| 1 | §2 D1 码表：`json_parse_failed` / `schema_validation_failed` 值得重试；`timeout` / `llm_error` / `shadow_exception` 不值得 | 重试集合 = **形状类**（`json_not_found` / `json_parse_failed` / `schema_validation_failed` / `parse_error`）+ **限流与 5xx**（`http_429` / `http_5*`）；不重试的 = 鉴权 4xx / `fetch_error`（网络与超时）/ `no_body` / `unknown` / `shadow_exception` | grep 核实：`timeout` **根本不存在**（超时落到 `LlmService` catch-all 的 `fetch_error`），`llm_error` **从不作为 errorCode 产生**（client 直接透传 `chunk.error.code`），而 `json_not_found`（模型压根没吐 JSON）**被漏掉了**。真实词表见 `llm-json.client.ts` + `llm.service.ts`。**范围已与用户确认（方案 A：形状类 + 429/5xx）**，且与仓库既有 `supervision-failure.ts` 的 `mapLlmErrorCodeToFailureCode` 同口径（429/5xx/JSON+schema = 可重试）。见交付记录 §2.1 |
| 2 | §4.1 `const RETRYABLE_ERROR_CODES = new Set(['json_parse_failed', 'schema_validation_failed'])` | 导出为 `DELIBERATION_RETRYABLE_ERROR_CODES`（含 `json_not_found` / `parse_error` / `http_429`）+ 纯函数 `isRetryableDeliberationError()`（**类型守卫**，判定为真时把 `string \| null` 收窄成 `string`） | 见第 1 条；5xx 用**前缀**匹配（`http_5*`）而不是只列 `http_500` —— 上游 5xx 不止一种，逐个列永远列不全。见交付记录 §2.2 / §2.4 |
| 3 | §4.3 `executeShadowMode` 在原 try 块里"跑完之后抛" | **拆成两个方法**：私有 `runDeliberation()` 负责跑（自己 catch 代码异常，返回结构化结局 `ok`/`failed`/`exception`），`executeShadowMode()` 负责判 + 写 trace + 抛 | 抛在 try 块里会被**自己写的 catch 吞掉** → 重试永远不发生 —— 那正是 §1.1 要解决的那个"重试形同虚设"。拆开后"抛异常的语句永远在 try 之外"变成**结构保证**，不靠注释提醒。见交付记录 §2.3 |
| 4 | §3.1 ① `executeShadowMode` 加一个可选参数 `retryCount?: number` | `executeShadowMode(input, retryCount = 0)` —— **默认 0**（WP64/WP65 的既有调用点一个字不改也能跑） | 与任务单一致，只是把"可选参数"落成带默认值的普通参数（TS 里 `retryCount?: number` 与 `retryCount = 0` 对调用方等价，后者少一个 `undefined` 分支）。`retryCount` 的语义 = **已重试次数**（`job.attemptsMade`，首次执行时为 0 —— 仓库 `counselor-supervision.processor.ts:166` 已确认该口径），与 §2 D4 一致，无偏差 |
| 5 | §4.4 `enqueue()` 里 `attempts: this.resolveMaxRetries() + 1` | 照办，另加 job 级 `backoff: { type: 'exponential', delay: 1000 }` | backoff 与队列默认值**逐字相同**，加它是为了让本 job 的重试策略**自包含**（将来调退避不用碰队列默认）。全项目统一的 `defaultJobOptions` 一个字没动（用例 ③-10 钉死） |
| 6 | §4.4 `resolveMaxRetries()` | 照办，另加 `DEFAULT_DELIBERATION_MAX_RETRIES = 1` 常量 | 默认值提成具名常量（与 `DEFAULT_DELIBERATION_WORKER_CONCURRENCY` 同款），测试不用写字面量 |
| 7 | （任务单未提）重试次数在**什么时候**读 | **入队时**读（不是执行时） | `attempts` 是 BullMQ 的 **job 选项**，入队后固定，改 env 对已在队列里的 job 无效。**开关**仍然入队前 + 执行时各判一次（硬约束 12 不受影响）。见交付记录 §2.5 |
| 8 | §3.1 ③「Worker handler **不 catch**——让 `DeliberationRetryableError` 自然抛出来」 | 照办 | 与 WP65 交付记录 §2.7「job handler 永不抛」**故意冲突** —— WP65 拒绝抛是因为"**任何**失败都重试 = 白烧三次 LLM"，WP66 把范围收窄到"值得重试的那几种"，抛才有意义。不改的话 BullMQ 的重试对审议**永远是死的**。见交付记录 §2.6 |
| 9 | §6.2 闸门「既有用例零回归」 | **WP64 / WP65 两个既有 spec 必然要改**（WP64 1 条语义 + 1 处错误码；WP65 3 处） | `executeShadowMode` 从"永不抛"变成"只抛一种异常"，凡是断言"`json_parse_failed` 不抛"的用例必然失效。**用例数一条没减**，断言只按新语义改；入队路径的重试用例全部放 WP66 新 spec。见交付记录 §2.8 |
| 10 | §5.1-3 / §5.1-4 的用例码 `timeout` / `llm_error` | 换成真实码 `fetch_error` / `http_401` | 这两个码 client 根本不会产生，对不存在的码写断言 = 测试看着绿、实际没覆盖任何真实路径。见交付记录 §2.9 |
| 11 | §3.4「`validateDeliberationOutput` 校验逻辑 —— 一行不动」 | **照办**（一行未动） | 本单只加"该不该重试"的判定，不动"合不合法"的判定；两个判定各管一件事 |
| 12 | §3.4「全项目统一的 `defaultJobOptions` —— 不动，我们用 job 级覆盖」 | **照办**（队列默认仍是 `attempts: 3`，用例 ③-10 钉死） | —— 一致，无偏差 |
| 13 | §6.1 的 WP66 目标之一「强制 `response_format: json_object`」 | **本期未做** | 仓库的结构化输出只有一条链（`CounselorLlmJsonClient`），它**不下发** `response_format`（上游 MiniMax 也不支持 provider 级 `response_format`，见 `llm-json.client.ts` 文件头）。要强制 JSON 得改那个 client —— 它有 6 个既有调用方，属于结构化出口的改动，**不该在"加重试"这一单里夹带**。建议单独一单。见交付记录 §4.3 |

**闸门**：eslint **0 error**（`npx eslint "src/**/*.ts" "test/**/*.ts"` exit 0）/ tsc **0 error**（`npx tsc -p tsconfig.build.json --noEmit` exit 0）/ vitest **104 文件 1738 例全绿**（WP65 基线 103 文件 1717 例 → 本轮 **+1 文件 / +21 例**；闸门用 `vitest run --exclude '**/e2e/**/*.ts'`，e2e 要真 DB）/ `git diff --stat HEAD -- src/engine-core` = **空**（内核零改动）/ `boundary.spec.ts` 全绿 / env 覆盖断言双向全绿。

