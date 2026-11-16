# WP67 任务单 — 审议熔断与降级策略

> **状态**：✅ 已交付（2026-11-05）→ [`engine-wp67-deliberation-circuit-breaker-implementation-2026-11-05.md`](engine-wp67-deliberation-circuit-breaker-implementation-2026-11-05.md)
> **路径**：`docs/worklog/completed/phase2/wp67-deliberation-circuit-breaker-2026-11-05.md`
> 优先级: 🟡 P1 (PoC 组基础设施)
> 前置: WP66 (审议输出格式校验与重试) 已交付核验
> 红线: engine-core 零改动
> 北极星: [`../../../architecture/hybrid-bdi-agent-blueprint-v1.0.md`](../../../architecture/hybrid-bdi-agent-blueprint-v1.0.md) §边界 4 降级与故障恢复

---

## 1. 背景与目标

### 1.1 为什么要做这个 WP

现在影子模式下，如果 LLM 服务挂了，每轮对话都跑一次审议，每次都失败，每次都烧一次 LLM 调用的钱。WP66 加了重试，但那是"单次失败重试"——如果 LLM 真的挂了，重试 1 次还是失败，下一轮继续跑，继续失败，继续烧钱。

需要一个**熔断器（Circuit Breaker）**：同一个会话连续失败 N 次后，暂时不再跑影子审议，等冷却时间过了再试。

### 1.2 本 WP 要做什么

给影子审议加会话级熔断器：
- 连续失败 → 熔断（暂停这个会话的影子审议）
- 冷却时间到了 → 半开（放一个请求进去试试）
- 成功了就恢复，失败了就继续熔断
- 熔断状态可观测——督导能看到"这个会话是降级模式跑的"

> ⚠️ 注意：我们是**影子模式**，审议结果不生效，主流程永远走规则算子。所以这个熔断是**旁路任务的熔断**，不是"主流程降级切回规则"。主流程根本没切到 LLM，不存在降级的问题。

---

## 2. 设计决策

### D1: 经典熔断器三态——但状态是计算出来的，不是存出来的

只存两个字段：`failureCount`（连续失败次数）+ `openedAt`（熔断开始时间戳）。

状态是每次请求时算出来的：
```
if (failureCount < threshold) → 闭合（Closed）
if (failureCount >= threshold && now - openedAt < cooldownMs) → 打开（Open）
if (failureCount >= threshold && now - openedAt >= cooldownMs) → 半开（Half-Open）
```

> 为什么不存 state 字段？—— 存出来的 state 容易和计算出来的不一致（比如并发更新的时候）。算出来的永远是准的。

### D2: 会话级熔断，不是全局熔断

每个会话自己的失败计数，自己熔断。全局 LLM 挂了直接关开关（`ENGINE_DELIBERATION_ENABLED=false`）就行，不用熔断。

### D3: 连续失败才熔断，不是累加失败

成功一次就清零。累计失败 3 次就熔断太严格了——可能这个会话对话内容比较特殊，偶尔失败一次，后来又好了。连续失败 3 次才说明真的有问题。

### D4: 半开放一个请求，不是全部放行

冷却时间到了，放一个请求进去试试。成功了就闭合，失败了就重新打开。放多个的话，LLM 还没恢复就烧了好几次钱。

### D5: 入队前判断熔断状态，打开状态就不入队

如果入队前就知道是打开状态，就不入队——省一次入队 + 省一次 LLM 调用。

### D6: 熔断事件写 trace，可观测

熔断的时候写一条 `ok=false, errorCode='circuit_open'` 的 trace——督导能看到"这个会话为什么没跑审议"，PoC 统计的时候也能区分"真的跑了但失败"和"根本没跑"。

> ⚠️ trace 写入逻辑统一在 Service 层（WP65 的纪律："队列层不自己写 trace"）。Processor 要写 circuit_open trace，**调 Service 的方法**，不要自己写 Redis。

### D7: Redis key 与 trace key 同构——带租户长度前缀

熔断状态的 Redis key 要和 trace key 用同样的构造方式（带租户长度前缀），防撞键。不要自己发明一套 key 格式。

---

## 3. 改动文件清单

### 3.1 改 2 个文件

| 文件 | 改什么 |
|---|---|
| `src/engine-adapters/deliberation/deliberation.processor.ts` | ① 加熔断逻辑：入队前查熔断器状态，打开状态就不入队；② 执行后更新熔断状态：成功重置计数，失败累加计数；③ 新增私有方法 `isCircuitOpen()` / `recordSuccess()` / `recordFailure()`；④ 熔断时写一条 `circuit_open` 的 trace |
| `src/engine-adapters/deliberation/llm-deliberation.service.ts` | ① `DeliberationTraceRecord` 加 `errorCode='circuit_open'` 的支持（其实不用改，errorCode 是 string，直接传就行）；② 可能要加一个写熔断 trace 的方法 |

> 等等，再想想——熔断状态存在 Redis 里，那读写 Redis 的逻辑放哪里？
> 应该放 DeliberationProcessor 里，因为入队判断和执行后更新都是 Processor 的职责。
> 不需要改 LlmDeliberationService——它只管跑 LLM + 写 trace，不管熔断。

### 3.2 配置：2 改

| 文件 | 改什么 |
|---|---|
| `.env.example` | 加 `ENGINE_DELIBERATION_FAILURE_THRESHOLD=` 和 `ENGINE_DELIBERATION_COOLDOWN_MS=`（生效行 + 注释块） |
| `typings/global.d.ts` | 加 `ENGINE_DELIBERATION_FAILURE_THRESHOLD?: string` 和 `ENGINE_DELIBERATION_COOLDOWN_MS?: string` |

### 3.3 测试：1 增

| 文件 | 改什么 |
|---|---|
| `test/engine-adapters/wp67-deliberation-circuit-breaker.spec.ts` | 新增测试用例（详见 §5） |

### 3.4 零改动确认

- ❌ `src/engine-core/**` —— 一行不动
- ❌ `turn-render-orchestrator.ts` —— 一行不动
- ❌ `validateDeliberationOutput` 校验逻辑 —— 一行不动
- ❌ `executeShadowMode` 的 LLM 调用逻辑 —— 一行不动（熔断在 Processor 层做，Service 层无感知）

---

## 4. 关键实现细节

### 4.1 Redis Key 设计

```
deliberation_circuit:{租户长度前缀}:{tenantId}:{sessionId}
```

和 trace key 同构（带租户长度前缀），防撞键。

Value 结构：
```json
{
  "failureCount": 2,
  "openedAt": 1730800000000
}
```

TTL = `cooldownMs * 2`，每次更新都刷新 TTL——活跃会话永远不过期，不活跃会话自动清掉。

### 4.2 熔断状态判断（纯函数）

```typescript
interface CircuitState {
  failureCount: number;
  openedAt: number | null;
}

type CircuitStatus = 'closed' | 'open' | 'half-open';

function resolveCircuitStatus(
  state: CircuitState | null,
  threshold: number,
  cooldownMs: number,
  now = Date.now(),
): CircuitStatus {
  if (!state || state.failureCount < threshold) return 'closed';
  if (state.openedAt === null) return 'closed'; // 防御：理论上不会走到这
  const elapsed = now - state.openedAt;
  if (elapsed < cooldownMs) return 'open';
  return 'half-open';
}
```

### 4.3 入队前判断

```typescript
async enqueue(input: DeliberationShadowInput): Promise<boolean> {
  // 开关判断（WP65 已有）
  if (!this.isEnabled()) return false;

  // 熔断判断（WP67 新增）
  const circuitKey = this.buildCircuitKey(input.tenantId, input.sessionId);
  const circuitState = await this.loadCircuitState(circuitKey);
  const status = resolveCircuitStatus(
    circuitState,
    this.resolveFailureThreshold(),
    this.resolveCooldownMs(),
  );
  if (status === 'open') {
    // 熔断中——不入队，写一条 circuit_open 的 trace 标记可观测
    await this.writeCircuitOpenTrace(input);
    this.logger.warn(
      `[deliberation_circuit_open] sessionId=${input.sessionId} ` +
        `failureCount=${circuitState?.failureCount ?? 'n/a'}`,
    );
    return false;
  }

  // 正常入队（WP65 已有）
  await this.queue.add(DELIBERATION_JOB_NAME, input, {
    jobId: buildDeliberationJobId(input.tenantId, input.sessionId, input.turnIndex),
    attempts: this.resolveMaxRetries() + 1,
    backoff: { type: 'exponential', delay: 1000 },
  });
  return true;
}
```

### 4.4 执行后更新熔断状态

```typescript
private async processJob(job: Job<DeliberationShadowInput>): Promise<void> {
  try {
    await this.llmDeliberation.executeShadowMode(job.data, job.attemptsMade);
    // 成功——重置熔断计数
    await this.recordSuccess(job.data.tenantId, job.data.sessionId);
  } catch (err) {
    if (err instanceof DeliberationRetryableError) {
      // 值得重试的失败——累加熔断计数
      await this.recordFailure(job.data.tenantId, job.data.sessionId);
      // 重新抛出去让 BullMQ 重试
      throw err;
    }
    // 不值得重试的失败——也累加熔断计数吗？
    // 应该也累加——不管什么失败，都是审议没跑成功，说明这个会话有问题
    await this.recordFailure(job.data.tenantId, job.data.sessionId);
  }
}
```

> ⚠️ 注意：不管是值得重试还是不值得重试的失败，都要累加熔断计数。因为熔断的目的是"别再烧钱了"——只要审议没成功，就是在烧钱。

### 4.5 recordSuccess / recordFailure

```typescript
private async recordSuccess(tenantId: string, sessionId: string): Promise<void> {
  const key = this.buildCircuitKey(tenantId, sessionId);
  // 成功了就清零——直接删掉这个 key，下次就是 closed 状态
  await this.redis.getClient().del(key);
}

private async recordFailure(tenantId: string, sessionId: string): Promise<void> {
  const key = this.buildCircuitKey(tenantId, sessionId);
  const threshold = this.resolveFailureThreshold();
  const cooldownMs = this.resolveCooldownMs();

  // 读当前状态
  const state = await this.loadCircuitState(key);
  const newCount = (state?.failureCount ?? 0) + 1;

  // ⚠️ 关键：先判断当前状态，再决定 openedAt 怎么更新
  const currentStatus = resolveCircuitStatus(state, threshold, cooldownMs);

  let openedAt: number | null;
  if (newCount < threshold) {
    // 还没达到阈值，不记 openedAt
    openedAt = null;
  } else if (currentStatus === 'closed') {
    // 从 closed 变成 open，第一次熔断
    openedAt = Date.now();
  } else if (currentStatus === 'half-open') {
    // ⚠️ 半开失败了——重新记 openedAt，重新开始冷却
    openedAt = Date.now();
  } else {
    // open 状态，保留原来的 openedAt（还在冷却中，不重置）
    openedAt = state?.openedAt ?? Date.now();
  }

  // 写回 Redis，刷新 TTL
  await this.redis.getClient().set(
    key,
    JSON.stringify({ failureCount: newCount, openedAt }),
    'PX',
    cooldownMs * 2,
  );
}
```

> ⚠️ **半开失败要重置冷却时间**：半开状态放一个请求进去试，失败了说明 LLM 还没恢复——不能接着等原来的冷却时间，要重新记 openedAt，重新等完整的冷却周期。

---

## 5. 测试要求

新增 `test/engine-adapters/wp67-deliberation-circuit-breaker.spec.ts`，覆盖以下用例：

### 5.1 熔断状态判断（4 例）

1. ✅ `failureCount < threshold` → closed
2. ✅ `failureCount >= threshold && elapsed < cooldown` → open
3. ✅ `failureCount >= threshold && elapsed >= cooldown` → half-open
4. ✅ 状态不存在 → closed（默认闭合）

### 5.2 入队判断（3 例）

5. ✅ closed 状态 → 正常入队
6. ✅ open 状态 → 不入队，写 circuit_open trace
7. ✅ half-open 状态 → 正常入队（放一个请求试试）

### 5.3 状态更新（4 例）

8. ✅ 成功 → 清零（删掉 key）
9. ✅ 失败 → failureCount + 1
10. ✅ 连续失败达到阈值 → 记 openedAt
11. ✅ 已经在熔断中再失败 → 保留原来的 openedAt，不重置

### 5.4 配置（3 例）

12. ✅ `ENGINE_DELIBERATION_FAILURE_THRESHOLD` 默认 3
13. ✅ `ENGINE_DELIBERATION_COOLDOWN_MS` 默认 600000（10 分钟）
14. ✅ env 配非法值时回退默认，不抛错

### 5.5 边界（3 例）

15. ✅ 开关关闭时，不跑熔断判断（直接不入队）
16. ✅ Redis key 带租户长度前缀，防撞键
17. ✅ `boundary.spec.ts` 11 条断言全绿（engine-core 零改动）

---

## 6. 验收标准

### 6.1 功能验收

| 条目 | 要求 |
|---|---|
| 连续失败 N 次后熔断 | ✅ 入队前判断 open 状态就不入队 |
| 冷却时间到了后半开 | ✅ 放一个请求试试 |
| 成功了就恢复 | ✅ 清零计数，闭合 |
| 熔断事件可观测 | ✅ 写 circuit_open trace |
| 配置 env 可调 | ✅ 失败阈值 + 冷却时间 |

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
_前置依赖：WP66 已交付核验（98/100）_

---

## 8. 交付后补记（2026-11-05）

> 交付记录：[`engine-wp67-deliberation-circuit-breaker-implementation-2026-11-05.md`](engine-wp67-deliberation-circuit-breaker-implementation-2026-11-05.md)
> 下表逐条登记**与任务单原文的偏差**，每条都能自圆其说。

| # | 任务单原文 | 实际落地 | 为什么 |
|---|---|---|---|
| 1 | §3.1「**不需要改 LlmDeliberationService** —— 它只管跑 LLM + 写 trace，不管熔断」 | **必须改**：① `executeShadowMode()` 返回类型 `Promise<void>` → `Promise<DeliberationOutcome>`（四态 `ok`/`failed`/`exception`/`skipped`）；② 新增 `recordCircuitOpen(input)`（熔断 trace 由 service 写，队列层不自己写 trace —— §2 D6 本来就这么要求的） | 熔断器必须知道"这轮审议成没成"。WP66 之后**非重试类失败（`fetch_error`/`http_401`/`no_body`/代码 bug）被 service 吞掉**，processor 只看到"没抛异常" → 会当成成功去 `recordSuccess` → **熔断对最常见的"LLM 挂了"永远不触发**。service 仍是"不知情"的（不知道熔断器的存在），只是**多返回一个结局**。见交付记录 §2.1 |
| 2 | §4.4 `processJob()` 靠**异常**判断成败（`try { executeShadowMode(...); recordSuccess(...) } catch { recordFailure(...) }`） | 读 `executeShadowMode()` 的**返回值**：`ok` → `recordSuccess`、`skipped` → 不动、`failed`/`exception` → `recordFailure`；catch 里 `recordFailure` 后**仅** `DeliberationRetryableError` 原样抛出 | 同第 1 条：非重试类失败**不抛**，靠返回值拿。WP66 的"抛 = 值得重试"不变式**不动**（那条路径仍靠 catch 拿）—— 两条通道互补。见交付记录 §2.1 |
| 3 | §4.5 `await this.redis.getClient().set(key, JSON.stringify({...}), 'PX', cooldownMs * 2)` | 走封装 `this.redis.set(key, value, ttlSec)`（内部 `'EX'`，单位**秒**），TTL 从 ms 换算成秒并**向上取整** | 仓库 `RedisService.set()` 的签名是 `set(key, value, ttlSec?)` —— **没有** `'PX'` + 毫秒这种形式（那是裸 ioredis 的写法）。照抄会传错参数。见交付记录 §2.2 |
| 4 | §4.1 key = `deliberation_circuit:{租户长度前缀}:{tenantId}:{sessionId}` | `deliberation_circuit:{租户长度}:{tenantId}:{会话长度}:{sessionId}` —— **两个**长度前缀 | §2 D7 要求"与 trace key **同构**"，而仓库的 trace key 是两个长度前缀（`deliberation_trace:{租户长度}:{租户}:{会话长度}:{会话}:{轮次}`）。只带租户段就不同构，且少了会话段的撞键防护。见交付记录 §2.3 |
| 5 | §4.3 half-open 状态 → **正常入队**（放一个请求试试） | 正常入队 **+ 先 `claimHalfOpenProbe()`** —— 把 `openedAt` 刷新成 now，**消费掉**这次半开机会；下一个请求再来看就是 `open` | §2 D4 提了"只放一个"，但 §4.3 的代码**没实现** —— 照抄会让冷却期一过所有请求一起涌进去（正是 D4 要防的）。消费用"刷新 `openedAt`"实现，简单且不用引 Lua；⚠️ 读-改-写**不原子**（同会话并发入队可能放进两个 probe —— 引擎侧同会话轮次串行，实际不会并发）；⚠️ claim 在 `queue.add` **之前**，add 失败会白白消费一次机会（保守方向：宁可少试不可多试）。见交付记录 §2.4 |
| 6 | （任务单未提）熔断状态**读失败**怎么办 | **fail-open** —— 读不到就当"没熔断"，放行 | 熔断是**省钱**手段不是**正确性**手段。反过来（读失败就阻断）的话，一次 Redis 抖动会把**所有**会话的审议全停 —— 那是更大的事故。与仓库既有口径一致（`RedisService` 文件头：Redis 不可用 → 业务层降级放行）。见交付记录 §2.5 |
| 7 | §4.3 顺序：开关判断 → 熔断判断 | 开关**先**判（关着就 `return false`，**连 Redis 都不碰**），再判熔断 | 开关整体关掉时熔断状态毫无意义。**连带影响**：WP66 spec 里 3 个只设 `ENGINE_DELIBERATION_MAX_RETRIES` 的入队用例因此入队失败 → **补上 `ENGINE_DELIBERATION_ENABLED: 'true'`**（用例 ③-8/③-9/③-10）。见交付记录 §2.6 |
| 8 | （任务单未提）阈值计的是**失败轮数**还是**失败调用次数** | 计**失败的 LLM 调用次数**（**含 BullMQ 重试**） | 熔断计数在 `processJob()` 里按**每次 job 执行**累加，而 BullMQ 重试会**再跑一次** `processJob()` → 一次失败轮次（`attempts = 2`）累加 **2** 次。后果：默认重试 1 次时，**2 个失败轮次就打满阈值 3**（比"连续失败 3 轮"更早熔断）。这是**有意的** —— 重试的那一次也是真金白银；想按轮数计就把 `ENGINE_DELIBERATION_MAX_RETRIES` 设 0。见交付记录 §2.7 |
| 9 | §4.4「值得重试的失败 → 累加；不值得重试的失败 → 也累加」 | 两条都累加 ✅；另加两条细则：`shadow_exception`（代码 bug）**也**计失败；`skipped`（开关关着**压根没跑**）**不动**熔断状态 | 审议没成功就是在烧钱 → 计入失败；但 `skipped` 这一轮**没跑**，没烧钱 → 失败计数不该涨。见交付记录 §2.8 |
| 10 | §4.5 `else if (currentStatus === 'closed') { openedAt = now } else if (currentStatus === 'half-open') { openedAt = now }` | 两个分支**合并**成 `else if (currentStatus === 'closed' \|\| currentStatus === 'half-open')` | 两个分支的赋值**逐字相同**（`openedAt = Date.now()`），合并后行为等价。语义要点不变：首次熔断与半开失败都**重置冷却**，熔断中再失败**保留原 `openedAt`**（半开失败必须重置冷却，不能保留原来的 `openedAt` —— 这是任务单明确要求的）。见交付记录 §2.11 |
| 11 | §6.2 闸门「既有用例零回归」 | **三个既有 spec 必然要改**（wp64 3 处 / wp65 3 处 / wp66 5 处） | `executeShadowMode` 从"返回 void"变成"返回结局"，凡是断言 `resolves.toBeUndefined()` 的用例**必然**失效。**用例数一条没减**，断言只按新语义改，且**改完更强**（从"不抛"变成"返回哪种结局"）。见交付记录 §2.9 |
| 12 | §3.1「`executeShadowMode` 的 LLM 调用逻辑 —— 一行不动（熔断在 Processor 层做，Service 层无感知）」 | **LLM 调用逻辑一行未动**（调用、prompt、client、校验全没碰）；只改了**返回值形态** | 与任务单一致 —— "无感知"指 service **不知道熔断器的存在**（熔断状态全在 processor），不是"不能改签名"。见交付记录 §2.1 |
| 13 | §6.1 的母版级目标「三级降级」（超时跳过 / 连续失败切回规则 / `degraded` 标记） | 本单只做了**熔断器**那一档 | ① **超时跳过**天然成立（超时是 `fetch_error`，不重试、记失败 trace 就结束）；② **切回规则算子**天然成立且**无需动作** —— 影子模式审议结果**从不生效**，主流程本来就永远走规则算子；③ **`degraded: true` 会话标记未做** —— 需要会话级打标 + 对外查询入口，涉及会话状态模型，建议单独一单（本单的 `circuit_open` trace 已提供原始数据）。见交付记录 §4 |

**闸门**：eslint **0 error**（`npx eslint "src/**/*.ts" "test/**/*.ts"` exit 0）/ tsc **0 error**（`npx tsc -p tsconfig.build.json --noEmit` exit 0）/ vitest **105 文件 1763 例全绿**（WP66 基线 104 文件 1738 例 → 本轮 **+1 文件 / +25 例**；闸门用 `vitest run --exclude '**/e2e/**/*.ts'`，e2e 要真 DB）/ `git diff --stat HEAD -- src/engine-core` = **空**（内核零改动）/ `boundary.spec.ts` 全绿 / env 双向覆盖断言全绿。
