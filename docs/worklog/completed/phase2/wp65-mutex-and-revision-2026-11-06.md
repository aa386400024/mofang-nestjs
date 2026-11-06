# WP65 后半段 · per-session mutex + 快照版本号

> **状态**：✅ 已交付（2026-11-06）→ [`engine-wp65-deliberation-mutex-revision-implementation-2026-11-06.md`](engine-wp65-deliberation-mutex-revision-implementation-2026-11-06.md)
> **路径**：`docs/worklog/completed/phase2/wp65-mutex-and-revision-2026-11-06.md`
> **优先级**：🔴 P0（切灰度前置硬约束）
> **引擎内核**：⚠️ **改 2 个文件**（任务单 §4.1 明确授权 —— 纯加可选只读字段 `revision` + 3 行填充，**决策逻辑与数值逐字不变**；`git diff --stat HEAD -- src/engine-core` = 2 文件 / +23 行 / -0 行）
> **前置依赖**：WP65 前半段（BullMQ 队列化，已交付）

## 一、为什么做这个（问题与目标）

### 现状背景

WP65 前半段（队列化）已完成：审议走 BullMQ 异步队列，Worker 并发 3。

**现在是影子模式**——审议结果不写 BDI 快照，只写 trace。所以并发问题现在不存在。

但**切灰度（审议结果开始生效）之前必须补这两个机制**：

1. **快照版本号（baseRevision）**——审议是异步的，第 N 轮的审议结果回来时，可能第 N+1 轮、N+2 轮都已经跑完了。审议 delta 是基于第 N 轮开始时的快照算的，如果直接 apply 到现在的快照上，就错了。必须带上版本号，回来时校验是否过期。

2. **per-session mutex**——同一会话同时只能有一个审议在跑。现在 Worker 并发 3，同一会话可能同时跑多个审议。影子模式下没事（结果不生效），但切灰度后会浪费 LLM 调用（并发的审议回来时早就过期了）。

### 目标

为切灰度做好准备：
- 审议入队时带上当前快照的版本号（baseRevision），trace 里记录
- 同一会话串行审议（per-session mutex），不并发跑
- 现在还是影子模式，审议结果仍然不生效，只记观测

---

## 二、开工前核实清单（7 条，开工前逐条确认）

> ⚠️ 这 7 条是大炮扫完代码后整理的，后端开工前必须自己再 grep 一遍核实，不能只凭这份清单。

| # | 核实项 | 确认方式 |
|---|---|---|
| 1 | `BdiStateRepository` 端口已有乐观锁（revision 单调递增，冲突抛 STATE_CONFLICT） | ✅ 已确认（`src/engine-core/domain/ports/bdi-state.repository.ts`） |
| 2 | `EngineTurnOutput` 里**没有** revision 字段 | ✅ 已确认（`engine-session.types.ts` 全文 grep 0 匹配；`in-memory-engine-session.ts:441` 只返回了 `saved.snapshot`，没返回 `saved.revision`） |
| 3 | `DeliberationShadowInput` 里**没有** baseRevision 字段 | ✅ 已确认（`llm-deliberation.service.ts:163` 接口定义） |
| 4 | `DeliberationTraceRecord` 里**没有** baseRevision 字段 | ✅ 已确认（`llm-deliberation.service.ts:547` 接口定义） |
| 5 | `DeliberationProcessor` 里**没有** per-session mutex | ✅ 已确认（`deliberation.processor.ts` grep mutex 0 匹配；只有 Worker 并发 3） |
| 6 | 编排门面 `turn-render-orchestrator.ts` 调 runShadowMode 时拿不到 revision | ✅ 已确认（`shadowDeliberation()` 方法里只有 output.snapshot / output.turnIndex） |
| 7 | Redis 已有 `RedisService` 可直接用（SET / DEL / SETNX） | ✅ 已确认（熔断状态已经在用 Redis 存了） |

---

## 三、技术方案

### 核心思路

**两个机制，都是为切灰度做准备：**

1. **快照版本号传递（baseRevision）**——EngineTurnOutput 加可选字段 revision，编排门面传给审议端口，trace 里记录。切灰度时再做过期校验和丢弃。

2. **per-session mutex**——Redis 里存 mutex key，入队前 SETNX，失败就不入队。Worker 跑完后删 key，TTL 兜底防进程崩溃死锁。

### 为什么是 adapter 层改，不是内核大改

- EngineTurnOutput 加可选字段 `revision?: number`——纯观测字段，不参与内核决策，与 events / safety / intention 同一范式
- 编排门面在 adapter 层，传参也是 adapter 层的事
- mutex 在 processor 里，也是 adapter 层
- **内核逻辑零改动**——只是把 saved.revision 挂到输出里，不改任何决策逻辑

---

## 四、写入侧（详细设计）

### 4.1 EngineTurnOutput 加可选字段 revision

**位置**：`src/engine-core/domain/engine-session.types.ts`

**改动**：
```typescript
export interface EngineTurnOutput {
  // ... 现有字段 ...

  /**
   * 本轮落库后的 BDI 快照版本号 (WP65).
   *
   * 为什么加这个字段:
   *   影子审议是异步的——第 N 轮入队后, 第 N+1 轮可能已经跑完了.
   *   审议结果回来时, 要知道自己基于的是哪个版本的快照, 才能判断有没有过期.
   *   切灰度后, 过期的审议结果直接丢弃, 不写回快照.
   *
   * 边界:
   *   - 纯观测字段, **不参与任何决策**;
   *   - 可选 = 向后兼容: 不传 = 行为与本字段引入前**逐字一致** (零回归).
   */
  readonly revision?: number;
}
```

**内核填充点**：`src/engine-core/in-memory/in-memory-engine-session.ts` 第 439 行 return 的地方，加上 `revision: saved.revision`。

### 4.2 DeliberationShadowInput 加 baseRevision

**位置**：`src/engine-adapters/deliberation/llm-deliberation.service.ts`

**改动**：
```typescript
export interface DeliberationShadowInput {
  // ... 现有字段 ...

  /**
   * 本轮开始时的 BDI 快照版本号 (WP65).
   *
   * 审议是异步的——入队后可能隔了几十秒才跑完.
   * 回来时拿这个版本号跟当前快照版本号比:
   *   · 相等 = 中间没跑新的, 审议结果有效 (切灰度后才写回);
   *   · 当前 > base = 中间跑了新的, 审议结果过期了, 丢弃.
   */
  readonly baseRevision: number;
}
```

### 4.3 编排门面传 baseRevision

**位置**：`src/engine-adapters/rendering/turn-render-orchestrator.ts` 的 `shadowDeliberation()` 方法

**改动**：在调 `runShadowMode` 的对象里，加上 `baseRevision: output.revision ?? 0`。

- `output.revision` 是内核新加的可选字段
- `?? 0` 兜底：如果内核没填（比如老版本或测试 mock），就当 0 处理——trace 里记 0，切灰度时自然会被判定为过期（因为真实 revision 都是 >=1 的）

### 4.4 trace 里记 baseRevision

**位置**：`DeliberationTraceRecord` 接口 + `buildSuccessRecord` / `buildFailureRecord` 方法

**改动**：
- `DeliberationTraceRecord` 加字段 `readonly baseRevision: number;`
- 成功 / 失败的 trace 都带上 baseRevision（从 input 里取）

### 4.5 per-session mutex（Redis SETNX）

**位置**：`src/engine-adapters/deliberation/deliberation.processor.ts`

**实现**：
```typescript
/**
 * per-session mutex 的 Redis key 前缀 (WP65).
 *
 * 语义: 同一会话同时只能有一个审议在跑.
 * 入队前 SETNX, 失败就不入队; Worker 跑完后删 key.
 */
export const DELIBERATION_MUTEX_KEY_PREFIX = 'deliberation_mutex';

/**
 * mutex 的 TTL (秒) = 30 秒.
 *
 * 为什么是 30 秒:
 *   审议单次 3-8 秒 (推理模型 thinking + 输出), 加上重试也就 20 秒顶天.
 *   30 秒是兜底——进程崩溃后 mutex 不会永不释放, 30 秒后自动过期.
 */
const DELIBERATION_MUTEX_TTL_SEC = 30;

/**
 * 构造 mutex key (与熔断 key / trace key 同构, 带租户 + 会话长度前缀).
 */
export function buildDeliberationMutexKey(tenantId: string, sessionId: string): string {
  return `${DELIBERATION_MUTEX_KEY_PREFIX}:${tenantId.length}:${tenantId}:${sessionId.length}:${sessionId}`;
}
```

**入队流程改动**（`enqueue()` 方法里）：
1. 开关先判（现有逻辑）
2. 熔断状态判断（现有逻辑）
3. **新增：mutex 判断**——
   - `SETNX key turnIndex`，成功 = 拿到锁，继续入队
   - 失败 = 已有审议在跑，不入队，打一条 warn 日志（sessionId / turnIndex）
4. 入队（现有逻辑）

**Worker 跑完后释放锁**（`processJob()` 方法里）：
- 不管成功 / 失败 / 异常，最后都 `DEL key`
- 用 `try { ... } finally { ... }` 保证一定释放

**⚠️ 注意**：
- mutex 是**优化**，不是正确性保证——正确性靠切灰度时的版本号校验
- 读失败按"没有锁"处理（放行），与熔断状态同一纪律：Redis 抖动不该让审议全停
- 释放锁失败只 warn，不抛——反正有 30 秒 TTL 兜底

---

## 五、读取侧（详细设计）

本期**不新增 admin 查询接口**——trace 已经在 Redis 里了，现有的 debug 面板查 trace 的接口已经能看到。baseRevision 只是 trace 里多了一个字段，前端面板后续单再做。

---

## 六、开关与配置

### 6.1 现有开关复用

- `ENGINE_DELIBERATION_ENABLED`——审议总开关，关着就啥都不跑（包括 mutex 判断）
- 不需要新增 env 开关——mutex 是审议的内部机制，审议开了就该有 mutex

---

## 七、隐私与安全

1. **mutex key 里不带对话原文**——只有 tenantId / sessionId / turnIndex，定位信息
2. **baseRevision 是数字**——不是心理内容，不进日志
3. **日志只出定位信息**——mutex 失败时打 sessionId / turnIndex，不打任何对话内容
4. **租户隔离**——mutex key 带租户前缀，不会串号

---

## 八、反双胞胎（刻意不做的事）

1. **不做过期校验和丢弃**——本期只是把 baseRevision 传进去、记在 trace 里。切灰度时再做"回来时 load 当前 revision，不匹配就丢弃"的逻辑。现在做了也没用（结果不生效）。
2. **不做审议结果写回快照**——那是切灰度的事，本期不做。
3. **不做 admin 前端面板**——本期只做后端机制，前端后续单。
4. **不做 mutex 的可观测接口**——trace 里已经有了，debug 面板能查。
5. **不改内核决策逻辑**——只是把 saved.revision 挂到输出里，纯观测字段。

---

## 九、闸门（验收标准）

| # | 闸门 | 要求 |
|---|---|---|
| 1 | ESLint | 0 problem |
| 2 | TypeScript | 0 error |
| 3 | 单测 | 全量跑通，不新增失败 |
| 4 | engine-core | 逻辑零改动（只加 1 个可选输出字段，与 events / safety 同一范式） |
| 5 | mutex | 同一会话并发入队时，只有第一个能进去，后面的被拦下 |
| 6 | mutex 释放 | Worker 跑完后（不管成功失败）锁一定释放，不残留 |
| 7 | TTL 兜底 | 进程崩溃后，mutex 30 秒后自动过期，不会永久锁死 |
| 8 | baseRevision 传递 | 入队时的 baseRevision 与 trace 里记的一致 |

---

## 十、交付物清单

1. **engine-core 输出字段**：`engine-session.types.ts` 加 `revision?: number` 可选字段；`in-memory-engine-session.ts` save 后填充
2. **DeliberationShadowInput 加 baseRevision**：`llm-deliberation.service.ts`
3. **编排门面传 baseRevision**：`turn-render-orchestrator.ts` 的 `shadowDeliberation()` 方法
4. **trace 记 baseRevision**：`DeliberationTraceRecord` 接口 + 成功/失败 record 构造方法
5. **per-session mutex**：`deliberation.processor.ts` 加 SETNX / DEL 逻辑 + mutex key 构造函数
6. **单测**：`test/engine-adapters/wp65-deliberation-mutex-revision.spec.ts`

---

## 十一、commit message 草稿

```
feat(wp65): per-session mutex + 快照版本号传递

EngineTurnOutput 加可选字段 revision (纯观测), 审议入队时带 baseRevision 进 trace.
同一会话串行审议 (Redis SETNX mutex), 切灰度前的准备工作.
影子模式下结果仍不生效, 只记观测.
```

---

## 十二、交付后补记（2026-11-06）

> 交付记录：[`engine-wp65-deliberation-mutex-revision-implementation-2026-11-06.md`](engine-wp65-deliberation-mutex-revision-implementation-2026-11-06.md)
> 下表逐条登记**与任务单原文的偏差**，每条都能自圆其说。

| # | 任务单原文 | 实际落地 | 为什么 |
|---|---|---|---|
| 1 | §4.2「本轮**开始时**的 BDI 快照版本号」 | 锚 **R1（本轮落库后）** —— 字段文档已改成"本轮落库后" | 任务单 §4.2 与 §4.3 **自相矛盾**：§4.3 的实现写 `output.revision`，那是**落库后**的版本。推演：审议在本轮落库**之后**才入队，回来时当前版本必然 ≥ R1；切灰度的判定是"当前 == base"，锚 R0 的话**永远不成立** → 判定恒为"过期" → **机制作废且无报错**。详见交付记录 §2.1 |
| 2 | §4.2 未规定 `baseRevision` 可选 / 必填 | **必填** | 这是切灰度时"过期判定"的唯一依据。忘传 = 恒 `undefined` → 判定恒走过期分支 → 结果全被丢弃、**机制静默失效**。必填 = 编译器逼每个构造点想一遍。代价：5 个既有审议 spec + 1 个 admin spec 同步。详见交付记录 §2.2 |
| 3 | §二 核实清单第 7 条「Redis 已有 `RedisService` 可直接用（SET / DEL / **SETNX**）」 | **不成立** —— `RedisService` **没有** `setnx`（只有 `getClient()` 返回裸 ioredis client）；本单在 infra 层**新增** `RedisService.setnx(key, value, ttlSec?)`（发 `SET ... EX ... NX`） | grep 核实：`RedisService` 有 `set`/`get`/`del`/`exists`/`incr`/`incrby`/`expire`/`ttl`，**无 `setnx`**。SETNX 是标准 KV 命令，与 `set`/`get`/`del` 同级，封装进 infra 层最贴合（`getClient()` 的既定定位是 multi/pipeline 等特殊场景）。**必须用 SET NX 而不是"先 GET 再 SET"** —— 后者是读-改-写，并发下两个持有者，mutex 静默失效。详见交付记录 §2.3 |
| 4 | §4.5「入队流程……**SETNX key turnIndex**，成功 = 拿到锁，继续入队；失败 = 已有审议在跑，不入队」 | 拿锁结果**三态**（`acquired` / `busy` / `unavailable`）：`busy` 拦下，`unavailable`（Redis 挂）**放行** | "被占用"与"Redis 挂了"的处置**完全不同**：前者拦下（省 LLM），后者放行（Redis 抖一下不该让**所有**会话的审议全停 —— 那是更大的事故）。合成一个 boolean = 必须二选一，**无论选哪个都会错一半**。与 WP67 熔断器"读失败按没有熔断处理"同纪律。详见交付记录 §2.4 |
| 5 | §4.5「Worker 跑完后释放锁：不管成功 / 失败 / 异常，最后都 `DEL key`」 | 释放改成 **只删自己的**（先 `GET` 比对 `turnIndex` 再 `DEL`）；且**跨 BullMQ 重试持有**（还会重试 → 不释放） | ① 无脑 `DEL` 可能删掉**别人**的锁（自己的 TTL 过期后被别的轮次重拿）→ mutex 静默失效；② WP66 的重试会抛回 BullMQ 退避再跑，若首次失败就释放，**退避窗口里同一会话能再进一个审议** → mutex 失效。读-改-写非原子的代价只是"偶尔提前释放"（多烧一次 LLM），不是正确性问题。详见交付记录 §2.5 / §2.6 |
| 6 | §4.5 草稿 `const DELIBERATION_MUTEX_TTL_SEC = 30;`（不导出） | `export const DELIBERATION_MUTEX_TTL_SECONDS = 30;` | 单测要直接断言 TTL（闸门 ⑦），且常量名与既有 `DEFAULT_DELIBERATION_*` 风格统一 |
| 7 | §4.5 入队流程 4 步（开关 → 熔断 → mutex → 入队） | **照办**，但 mutex 取锁位置在**熔断判断之后** | 熔断 `open` 时本轮根本不入队，没必要占一把锁（占了就得到 job 开跑才释放，白白拦掉这场会话后面 30 秒的每一轮） |
| 8 | §九 闸门 4「engine-core 逻辑零改动（只加 1 个可选输出字段）」 | 实际改 **2 个文件**（类型定义 + 填充点），与 §4.1 / §十 一致 | §四 说清了"内核填充点：在 `in-memory-engine-session.ts` 第 439 行 return 的地方加上 `revision: saved.revision`" —— 那是**必做**的第 2 个文件。闸门 4 的"逻辑零改动"仍然成立：diff = 2 文件 / **+23 行 / -0 行**，全是新增 |
| 9 | §4.5「入队失败 → 不入队」（任务单未提释放锁） | 入队失败**立即释放锁** | 一次入队失败不该连累这场会话**后面 30 秒的每一轮**（否则只能等 TTL 到期才能再观测）。详见交付记录 §2.7 |
| 10 | §4.5 未提 `job.opts` 的防御 | `hasAttemptsLeft()` 对 `job.opts` / `job.attemptsMade` 做**防御** | 实测触发：既有 3 个审议 spec 的 job 桩没有 `opts`，`job.opts.attempts` 抛 TypeError 且**顶掉**了原本要抛的 `DeliberationRetryableError` → WP66 的重试语义失效、BullMQ 看不到真正的失败原因。详见交付记录 §2.8 |

**闸门**：eslint **0 problem**（`npx eslint "{src,test,bin}/**/*.ts"` exit 0）/ tsc **0 error**（`npx tsc -p tsconfig.build.json --noEmit` exit 0）/ vitest **124 文件 2114 例全绿**（基线 123 文件 / 2092 例 → 本单 **+1 文件 / +22 例**，既有 2092 例零回归）/ `git diff --stat HEAD -- src/engine-core` = **2 文件 / +23 行 / -0 行**（任务单 §4.1 授权的纯加只读字段）/ `boundary.spec.ts` 全绿 / **不新增 env 开关**（复用 `ENGINE_DELIBERATION_ENABLED`）。
