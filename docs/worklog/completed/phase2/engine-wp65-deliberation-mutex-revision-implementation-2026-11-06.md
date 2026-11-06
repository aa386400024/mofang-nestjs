# WP65 后半段 交付记录 — per-session mutex + 快照版本号传递

> 状态: ✅ 已交付
> 任务单: [`wp65-mutex-and-revision-2026-11-06.md`](wp65-mutex-and-revision-2026-11-06.md)
> 日期: 2026-11-06
> 红线: ⚠️ **engine-core 改了 2 个文件**（任务单 §4.1 明确授权）—— `git diff --stat HEAD -- src/engine-core` = **2 文件 / +23 行 / -0 行**，**纯新增只读字段，决策逻辑与数值逐字不变**
> 边界断言: ✅ `boundary.spec.ts` 全绿（11 条不变量 + 扫描自检，零改动即零影响）
> 承接: WP65 前半段（BullMQ 队列化）→ 本单补齐母版描述里剩下的两件：**per-session mutex + 快照版本号**

---

## 1. 实际改了哪些文件

### 1.1 生产代码：3 改 + 2 改（engine-core 为任务单授权的预批准例外）

| 文件 | 改了什么 |
|---|---|
| `src/engine-core/domain/engine-session.types.ts` | **改**：`EngineTurnOutput` 加 **可选**只读字段 `revision?: number`（本轮落库后的 BDI 快照版本号）。纯加字段，不参与任何决策，与 `events` / `safety` 同一范式 |
| `src/engine-core/in-memory/in-memory-engine-session.ts` | **改**（+3 行）：turn 的 return 里加 `revision: saved.revision` —— 取**仓储返回的**权威版本号，不是本地另算的一个 |
| `src/engine-adapters/deliberation/llm-deliberation.service.ts` | **改**：`DeliberationShadowInput` 加 **必填** `baseRevision: number`；`DeliberationTraceRecord` 加 `baseRevision: number`；`buildSuccessRecord` / `buildFailureRecord` 均带上 `baseRevision: input.baseRevision` |
| `src/engine-adapters/rendering/turn-render-orchestrator.ts` | **改**（+4 行）：`shadowDeliberation()` 调 `runShadowMode` 时传 `baseRevision: output.revision ?? 0` |
| `src/engine-adapters/deliberation/deliberation.processor.ts` | **改**（+166 行）：新增 `DELIBERATION_MUTEX_KEY_PREFIX` / `DELIBERATION_MUTEX_TTL_SECONDS` / `buildDeliberationMutexKey()`；`enqueue()` 入队前拿锁；`processJob()` 的 `finally` 里释放锁；新增私有方法 `acquireMutex()`（三态）/ `releaseMutex()`（只删自己的）/ `hasAttemptsLeft()` |
| `src/shared/infra/redis/redis.service.ts` | **改**（+22 行）：新增 `setnx(key, value, ttlSec?): Promise<boolean>` —— 发 `SET key value EX <ttl> NX`（原子互斥），返回 false = 没拿到锁 |

### 1.2 测试：1 增 7 改

| 文件 | 改了什么 |
|---|---|
| `test/engine-adapters/wp65-deliberation-mutex-revision.spec.ts` | **新增 22 例**（本单主测试）：① baseRevision 传递链 6 例（内核出参 revision 逐轮递增 / 与仓储存的那一版一致 / 门面端到端传递 / 没填时兜底 0 / trace 成功路径 / trace 失败路径）② per-session mutex 10 例（拿锁三要素 / 并发只有第一个进去 / 拦下时只打定位信息 / Redis 挂了就放行 / 入队失败立刻释放 / Worker 跑完三种结局都释放 / 只删自己的锁 / 跨重试持有 / 重试用完释放 / key 撞键防护 + TTL）③ 端到端 baseRevision 与 trace 一致 1 例 ④ `RedisService.setnx` 原子性契约 2 例 ⑤ 隐私边界 1 例 |
| `test/engine-adapters/wp64-deliberation-shadow.spec.ts` | **改**：`buildInput()` 加 `baseRevision: 1`（新字段变必填的连带同步） |
| `test/engine-adapters/wp65-deliberation-queue.spec.ts` | **改**：`buildInput()` 加 `baseRevision: 1`；Redis 替身补 `setnx`（默认拿到锁） |
| `test/engine-adapters/wp66-deliberation-retry.spec.ts` | **改**：`buildInput()` 加 `baseRevision: 1`；Redis 替身补 `setnx` |
| `test/engine-adapters/wp67-deliberation-circuit-breaker.spec.ts` | **改**：`buildInput()` 加 `baseRevision: 1`；Redis 替身补 `setnx` |
| `test/engine-adapters/wp68-deliberation-intention-lock.spec.ts` | **改**：`buildInput()` 加 `baseRevision: 1` |
| `test/admin-debug/wp58-debug-session.spec.ts` | **改**：`makeDeliberationRecord()` 造的 trace 字面量补 `baseRevision` |
| `test/engine-core/wp5-rendering.spec.ts` | **改**：零回归断言的"出参字段清单"补 `revision`（WP38 加 `events` 时已有先例，纯加字段 → 清单 +1） |

### 1.3 文档

| 文件 | 改了什么 |
|---|---|
| `docs/worklog/pending/wp65-mutex-and-revision-2026-11-06.md` | 状态行改 ✅ + 指向交付记录；追加「§十二 交付后补记」偏差表 → 移入 `completed/phase2/` |
| `docs/worklog/pending/phase2-wp-list-2026-11-03.md` | WP65 行补后半段落地口径；⚠️ 条目改成 ✅（两半都销了）；PoC 组小结的"下一站"改为"只剩约束校验层" |
| `docs/worklog/README.md` | Phase2 已开工列表 WP65 条目补后半段；⚠️ 条目改 ✅；目录结构说明同步 |

### 1.4 **零改动**（逐条核实过）

- 无 migration / 无 entity / 无新表 / 无新列（本单不落库，版本号走内存快照 + Redis trace）
- **不新增 env 开关** —— 复用 `ENGINE_DELIBERATION_ENABLED`（任务单 §6.1），`.env.example` 与 `typings/global.d.ts` 零改动
- **不新增 admin 接口**（任务单 §五）—— baseRevision 直接出现在 Redis trace 的 JSON 里，debug 面板原样可见
- 不做过期判定与丢弃 / 不做审议结果写回快照 / 不做前端面板 / 不做 mutex 可观测接口（任务单 §八 反双胞胎全部照办）
- `admin-dashboard/` —— 零改动（前端另一个 AI 的活）
- `src/engine-core/index.ts` 的公开面 —— **零新增导出**（`revision` 是既有接口的字段，不是新导出）

---

## 2. 关键设计决策（与任务单有出入的地方 + 为什么）

> 任务单与代码不符的地方按 `team/conventions.md` §2.5 处理：**先 grep 核实 → 找企业级最佳方案 → 在交付记录里写明偏差**。
> 任务单 §二的 7 条核实清单**逐条自己 grep 核实过**，其中 1 条**不成立**（见 D3）。

### 2.1 决策 D1：`baseRevision` 锚 **R1（本轮落库后）**，不是任务单 §4.2 写的"本轮开始时"

**任务单 §4.2 原文**：「本轮**开始时**的 BDI 快照版本号」；但 §4.3 的实现写的是 `baseRevision: output.revision ?? 0` —— 而 `output.revision` 是**本轮落库后**的版本。**任务单自己的两段自相矛盾。**

**推演**（这是必须钉死的一条，错了整个机制静默失效）：

| 记号 | 含义 |
|---|---|
| R0 | 本轮**开始时**的快照版本（= 门面的 `baseSnapshot` 对应的那一版） |
| R1 | 本轮**落库后**的快照版本（= `output.revision` = R0 + 1） |

审议的入队时机是**本轮落库之后**（门面拿到 `output` 才发起 fire-and-forget）。于是：

- 审议回来时，"当前版本"必然 **≥ R1**（期间可能又跑了几轮）；
- 切灰度时的过期判定是"**当前版本 == base**"；
- 锚 **R1**：当前版本 == R1 时判定为"有效"，> R1 时判定为"过期" —— **能区分**；
- 锚 **R0**：当前版本恒 > R0（R0 已经是过去式） → "当前 == base" **永远不成立** → 判定恒为"过期" → **机制作废**（所有审议结果全被丢弃，且没有任何报错）。

**结论**：锚 R1。任务单 §4.2 的字段文档已改成"本轮**落库后**"，并在代码注释里把这段推演写死（免得后人按字面理解改回 R0）。

**落法**：`baseRevision: output.revision ?? 0`。`?? 0` 是**安全的失败方向** —— 内核没填（老版本 / 测试 mock）时记 0，而真实版本都 ≥ 1，0 会被判定为"过期"（宁可当过期，不像有效）。

### 2.2 决策 D2：`baseRevision` 设成**必填**，不是可选

任务单没规定要不要必填。本单选**必填**，理由：

- 这是切灰度时做"过期判定"的**唯一依据**。忘传 = 那个键恒为 `undefined` → 判定恒走"过期"分支 → 审议结果全被丢弃 → **机制静默失效且无报错**；
- 必填 = **编译器逼着每个构造点想一遍**（仓库纪律：契约要显式）。可选字段的默认值在长链路上极易被漏掉。

**代价（明写）**：5 个既有审议 spec 的 `buildInput()` + 1 个 admin spec 的 trace 字面量必须同步加 `baseRevision`。这正是"契约变严"的应有成本 —— 比"运行期悄悄失效"便宜得多。

### 2.3 决策 D3：`RedisService` **没有 SETNX** —— 任务单 §二 核实清单第 7 条不成立

**grep 核实结果**：任务单第 7 条写「Redis 已有 `RedisService` 可直接用（SET / DEL / SETNX）」。**实际不成立** —— `RedisService` 有 `set` / `get` / `del` / `exists` / `incr` / `incrby` / `expire` / `ttl` 等，**没有 `setnx`**；只有 `getClient()` 返回**裸 ioredis client**。

**方案对比**：

| 方案 | 评价 |
|---|---|
| 直接用 `redis.getClient().set(key, val, "EX", ttl, "NX")` | 能用，但把 Redis 命令细节漏到**业务层**（processor）里。`getClient()` 的既定定位是"特殊场景（multi / pipeline / SCAN MATCH）"，不是常规 KV |
| **在 infra 层新增 `RedisService.setnx()`** ✅ | SETNX 是标准 KV 命令，与 `set` / `get` / `del` 同级，封装进 infra 层最贴合；processor 只表达意图（"我要拿锁"），不表达命令 |

**落地**：`setnx(key, value, ttlSec?)` 发 `SET key value EX <ttl> NX`，返回 `true` = 拿到锁 / `false` = key 已存在（**不是失败**，调用方要分清"被占用"与"Redis 挂了"）。单测 ④-1 / ④-2 直接断言发出去的命令形状。

**为什么必须用 SETNX 而不是"先 GET 再 SET"**：后者是**读-改-写** —— 两个并发调用会同时看到"不存在" → 同时写 → 两个持有者 → mutex 静默失效（且不报错，最难查的那一类）。SET ... NX 由 Redis 侧原子完成，才是真互斥。

### 2.4 决策 D4：mutex 拿锁结果是**三态**，不是 boolean

`acquireMutex()` 返回 `acquired` / `busy` / `unavailable`：

| 态 | 含义 | 处置 |
|---|---|---|
| `acquired` | 拿到锁 | 继续入队，**本轮持有**它 |
| `busy` | 锁在别人手里（同一会话已有审议在跑） | **不入队**（省一次入队 + 一次 LLM 调用） |
| `unavailable` | Redis 不可用 | **放行**（按"没有锁"处理），且**不持有** |

**为什么不能合成 boolean**："被占用"与"Redis 挂了"的处置**完全不同** —— 前者要拦下（省钱），后者要放行（Redis 抖一下不该让**所有**会话的审议全停，那是更大的事故）。合成一个 boolean = 必须二选一，**无论选哪个都会错一半**。

**与熔断器同纪律**：WP67 的熔断状态读取失败也是"按没有熔断处理"（放行）。本单的 mutex 失败处理与之一致 —— **观测面的辅助机制坏了，不该拖垮主链路**。

### 2.5 决策 D5：释放锁**只删自己的**

`releaseMutex()` 先 `GET` 比对锁的值（= 持有者标识 `turnIndex`），不等于自己的就不删。

**为什么**：锁的 TTL 可能已经过期，期间被**别的**轮次拿走了；这时无脑 `DEL` = 把别人的锁删了（那一轮正在跑，却被当成"没锁" → 又能进一个 → mutex 静默失效）。

**已知代价**：读-改-写**不是原子**的 —— 两次调用之间锁可能易主。后果只是"偶尔提前释放"（mutex 提前失效 = 多烧一次 LLM），**不是正确性问题**（正确性靠切灰度时的版本号校验）。值得这点代价。

### 2.6 决策 D6：mutex **跨 BullMQ 重试持有**

WP66 的重试会把 handler 的异常抛回 BullMQ，退避后再跑一次。若首次失败就释放锁，**退避窗口里同一会话能再进一个审议** → mutex 失效（而重试的正是"同一轮"）。

**落法**：`processJob()` 用 `keepMutex` 标志 + `finally` 释放；只有"这次失败**还会重试**"（`hasAttemptsLeft(job)`：当前是第 `attemptsMade + 1` 次，总次数 `job.opts.attempts`）才**不释放**。

**边界**：重试次数用完（最后一次）→ 释放锁。否则锁会一直挂到 TTL 过期，白白拦掉这场会话后面 30 秒的每一轮。

### 2.7 决策 D7：入队失败**立即释放锁**

`queue.add` 抛错时立刻 `releaseMutex()`。一次入队失败不该连累这场会话**后面 30 秒的每一轮**（否则它只能等 TTL 到期才能再观测）。

### 2.8 决策 D8：`hasAttemptsLeft()` 对 `job.opts` / `job.attemptsMade` 做**防御**

**触发场景（实测）**：既有 3 个审议 spec 的 job 桩是 `{ data, attemptsMade }`（**没有** `opts`），`job.opts.attempts` 直接抛 `TypeError: Cannot read properties of undefined` —— 而这个 TypeError 发生在 `catch` 块里，**把原本要抛的 `DeliberationRetryableError` 顶掉了**：BullMQ 看不到真正的失败原因，"值不值得重试"也判错了（WP66 的重试语义直接失效）。

**落法**：`job.opts?.attempts ?? 1` + `job.attemptsMade ?? 0`，读不到就按"没有剩余次数"处理（宁可早释放锁 —— mutex 提前失效只是多烧一次 LLM，**不能**为省一次调用把真正的错误信号吃掉）。

> 真实 BullMQ 里 `Job.opts` 一定有（`opts: JobsOptions` 是必填属性），所以这是**防御**而非修补真实 bug —— 但边界代码就该按"外部输入可能不完整"来写。

### 2.9 决策 D9：TTL 30 秒的**已知代价**（明写出来，不藏）

TTL 是**兜底**（进程崩了 / job 被丢弃 → mutex 不会永不释放）。代价：

- **队列积压超过 30 秒时**，锁会在 job 开跑**之前**就过期 → mutex 失效 → 同一会话可能并发跑两个审议；
- 边界：同 `jobId` 被 BullMQ 去重时（`queue.add` 遇已存在的 jobId 会**静默跳过**），job 根本不会跑 → 锁靠 TTL 兜底释放。

**可接受**：mutex 是**优化**（省 LLM 调用），**不是正确性手段** —— 并发审议的结果在切灰度时会被**版本号校验**挡掉（任务单 §一 的定性完全正确，本单严格照此执行）。

### 2.10 决策 D10：内核改动的**授权与范围**

- 任务单 §4.1 明确写了要改 `engine-session.types.ts` + `in-memory-engine-session.ts`，**属预批准例外**（与 WP38 加 `events` 同性质）；
- 实际 `git diff --stat HEAD -- src/engine-core` = **2 文件 / +23 行 / -0 行** —— 全部是**新增**（1 个可选字段 + 3 行填充 + 注释），**零删除、零逻辑改动**；
- `in-memory-engine-session.ts` 取的是 `saved.revision`（**仓储返回的**权威值），不是本地 `base.revision + 1` 另算一个 —— 归一化后的版本号才是权威；
- `boundary.spec.ts` 的 11 条断言**一条都不用改**（纯加可选字段，不碰公开面导出）。

---

## 3. 闸门数字

| # | 闸门 | 结果 |
|---|---|---|
| 1 | ESLint | ✅ **0 problem**（`npx eslint "{src,test,bin}/**/*.ts"` exit 0） |
| 2 | TypeScript | ✅ **0 error**（`npx tsc -p tsconfig.build.json --noEmit` exit 0） |
| 3 | 单测 | ✅ **124 文件 / 2114 例全绿**（WP58 后半段后基线 123 文件 / 2092 例 → 本单 **+1 文件 / +22 例**，既有 2092 例零回归） |
| 4 | engine-core | ⚠️ **改 2 个文件**（任务单 §4.1 授权）—— `git diff --stat HEAD -- src/engine-core` = 2 文件 / +23 行 / -0 行，纯新增只读字段 |
| 5 | mutex 拦下 | ✅ 同一会话连发 3 次入队 → 只有第 1 个进去，后 2 个被拦下（用例 ②-2） |
| 6 | mutex 释放 | ✅ Worker 跑完（成功 / 失败 / 异常三种结局）锁都释放（用例 ②-6）；入队失败也立即释放（②-5） |
| 7 | TTL 兜底 | ✅ TTL = 30 秒并随 `SET NX EX` 下发；进程崩溃后自动过期（用例 ②-1 / ②-10 / ④-1） |
| 8 | baseRevision 一致 | ✅ 入队时 42 → job 载荷 42 → trace 里 42（用例 ③-1 端到端） |

**闸门命令**：

```bash
npx eslint "{src,test,bin}/**/*.ts"                        # 0 problem
npx tsc -p tsconfig.build.json --noEmit                  # 0 error
npx vitest run --exclude "**/e2e/**/*.ts"                # 124 文件 / 2114 例全绿
git diff --stat HEAD -- src/engine-core                  # 2 文件 / +23 行 / -0 行
```

> ⚠️ e2e 需要真 DB，本单按仓库惯例排除。

---

## 4. 本单**不做**的事（任务单 §八 反双胞胎，逐条照办）

1. **不做过期校验与丢弃** —— 本期只把 `baseRevision` 传进去、记在 trace 里。切灰度时再做"回来时 load 当前 revision，不匹配就丢弃"。现在做了也没用（结果不生效）；
2. **不做审议结果写回快照** —— 那是切灰度的事；
3. **不做 admin 前端面板** —— 后端机制已就位，前端后续单；
4. **不做 mutex 的可观测接口** —— trace 里已有 `baseRevision`，debug 面板能查；
5. **不改内核决策逻辑** —— 只是把 `saved.revision` 挂到输出里，纯观测字段。

---

## 5. 切灰度（Phase3A）还差什么

本单把**准备**做完了，剩下的是灰度单的事：

1. **过期判定与丢弃** —— 审议回来时 load 当前 revision，与 `baseRevision` 不一致就丢弃结果；
2. **审议输出过约束校验层** —— delta cap + 临床合理性校验，通过了才能落快照（母版 PoC 组小结里点名的最后一项）；
3. **约束校验层落地** —— 母版明确"审议输出要过约束校验层才能落快照"，本单不涉及；
4. **mutex 的 TTL 随队列积压调整** —— 若生产积压超 30 秒，需把 TTL 与实际排队时长对齐（当前是知情取舍，见 D9）。

> 一句话：**串行与版本号这两块地基已经打好了，但影子期仍不生效** —— 审议结果照旧只写 Redis trace，不进 BDI 快照。

---

_创建：2026-11-06_
_核实：任务单 §二 的 7 条核实清单逐条自己 grep 过（其中第 7 条不成立，见 D3）_