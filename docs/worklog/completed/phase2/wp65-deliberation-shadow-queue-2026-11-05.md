# WP65 任务单 — 审议影子模式 BullMQ 队列化

> **状态**：✅ 已交付（2026-11-05）→ [`engine-wp65-deliberation-shadow-queue-implementation-2026-11-05.md`](engine-wp65-deliberation-shadow-queue-implementation-2026-11-05.md)
> **路径**：`docs/worklog/completed/phase2/wp65-deliberation-shadow-queue-2026-11-05.md`
> 优先级: 🟡 P0 (PoC 组基础设施)
> 前置: WP64 (LLM 审议层 PoC 影子模式) 已交付核验
> 红线: engine-core 零改动
> 北极星: [`../../../architecture/hybrid-bdi-agent-blueprint-v1.0.md`](../../../architecture/hybrid-bdi-agent-blueprint-v1.0.md) §2.2 审议引擎层

---

## 1. 背景与目标

### 1.1 为什么要做这个 WP

WP64 的影子模式是 **fire-and-forget**——每轮旁路直接调 `LlmDeliberationService.runShadowMode()`，主流程不 await。现在有三个问题：

1. **没有并发控制**——每轮都直接发 LLM 请求，如果会话跑很快，瞬间打一堆请求上去，容易打爆上游配额触发 429
2. **进程重启丢任务**——fire-and-forget 的请求在内存里，进程一重启就没了，PoC 数据收集不完整
3. **没有可观测性**——队列里有多少任务、跑了多少、失败了多少，现在完全看不见

### 1.2 本 WP 要做什么

把影子模式的 LLM 调用从"直接同步调"改成"**BullMQ 队列异步跑**"：

- 主流程入队就返回，比之前的 fire-and-forget 还干净
- Worker 按并发上限慢慢跑，不会打爆上游
- 任务持久化在 Redis，进程重启不丢
- BullMQ 自带监控（队列长度 / 成功率 / 失败原因），可观测性直接拉满
- WP66 的格式校验重试，直接用 BullMQ 的 `attempts` 配置就行，不用自己写

---

## 2. 设计决策

### D1: 用项目现成的 BullMQ 模式，不搞花的

完全照 `counselor-supervision.processor.ts` 的既定 pattern 抄：
- `onModuleInit` 建 Queue + Worker，`onModuleDestroy` 关（`Promise.allSettled`）
- `prefix: 'bullmq'` + `defaultJobOptions` 全项目统一
- 不引 `@nestjs/bull`，项目既定用 bullmq 原生 Queue + Worker

### D2: Worker concurrency = 3（env 可配）

审议单次调用大概 3-8s（推理模型 thinking + 输出），比督导的 30-120s 短，所以并发可以高一点。默认 3，env 可调：
```
ENGINE_DELIBERATION_WORKER_CONCURRENCY=3
```

### D3: 重试策略沿用全项目统一口径

`attempts: 3, backoff: { type: 'exponential', delay: 1000 }`——跟 counselor-supervision 一样。
WP66 的"格式校验重试"就是把 `attempts` 调成合适的值，不用改代码。

### D4: Service 职责收窄——只入队，不跑

`LlmDeliberationService.runShadowMode()` 从"直接调 LLM 写 trace"改成"**入队就返回**"。
真正跑 LLM + 写 trace 的逻辑挪到 `DeliberationProcessor` 里。

这样做的好处：
- Service 变得很薄——就是个入队接口，对外签名不变
- 跑 LLM 的逻辑全在 Processor 里，Worker 扩缩容不用动 Service

### D5: Job payload 就是 DeliberationShadowInput

不需要额外包装，直接把 `DeliberationShadowInput` 当 job data 传。
BullMQ 会自动 JSON 序列化/反序列化。

---

## 3. 改动文件清单

### 3.1 新增 2 个文件

| 文件 | 内容 |
|---|---|
| `src/engine-adapters/deliberation/deliberation.processor.ts` | 新增 `DeliberationProcessor`（BullMQ Worker）——收 job → 调 LLM → 写 trace。完全照 `counselor-supervision.processor.ts` 的结构写 |
| `test/engine-adapters/wp65-deliberation-queue.spec.ts` | 新增测试用例（详见 §5） |

### 3.2 改 3 个文件

| 文件 | 改什么 |
|---|---|
| `src/shared/infra/redis/redis.constants.ts` | `QUEUE_NAMES` 加一条 `deliberation: 'deliberation-shadow'` |
| `src/engine-adapters/deliberation/llm-deliberation.service.ts` | `runShadowMode()` 从"直接跑"改成"入队就返回"。注入 `DeliberationQueue`（就是 BullMQ Queue 实例） |
| `src/engine-adapters/wiring/engine.module.ts` | `providers` 加 `DeliberationProcessor`；`DeliberationService` 的依赖注入加 Queue |

### 3.3 零改动确认

- ❌ `src/engine-core/**` —— 一行不动
- ❌ `turn-render-orchestrator.ts` —— 不用改！它还是调 `deliberation.runShadowMode()`，签名没变，内部从同步改成入队对它透明
- ❌ 既有测试 —— 一行不动

---

## 4. 关键实现细节

### 4.1 DeliberationProcessor 结构（照抄 counselor-supervision 的 pattern）

```typescript
@Injectable()
export class DeliberationProcessor implements OnModuleInit, OnModuleDestroy {
  private queue!: Queue<DeliberationShadowInput>;
  private worker!: Worker<DeliberationShadowInput>;

  constructor(
    private readonly redis: RedisService,
    private readonly llmDeliberation: LlmDeliberationService, // 跑 LLM + 写 trace 的逻辑搬这里
  ) {}

  async onModuleInit(): Promise<void> {
    const connection = this.redis.getBullClient();
    const bullPrefix = 'bullmq';

    this.queue = new Queue(QUEUE_NAMES.deliberation, {
      connection,
      prefix: bullPrefix,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { count: 1000, age: 24 * 3600 },
        removeOnFail: { count: 5000 },
      },
    });

    this.worker = new Worker(QUEUE_NAMES.deliberation, async (job) => {
      await this.llmDeliberation.executeShadowMode(job.data);
    }, {
      connection,
      prefix: bullPrefix,
      concurrency: this.resolveWorkerConcurrency(),
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(`[deliberation_shadow_failed] jobId=${job?.id} session=${job?.data?.sessionId} err=${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.worker?.close(), this.queue?.close()]);
  }

  /** 入队 1 个审议任务 */
  async enqueue(input: DeliberationShadowInput): Promise<boolean> {
    try {
      await this.queue.add('shadow', input, {
        // jobId 不带 turnIndex, 因为同会话不同轮次是独立的 job, 不需要去重
      });
      return true;
    } catch (error) {
      this.logger.warn(`[deliberation_enqueue_failed] session=${input.sessionId} turn=${input.turnIndex}: ${messageOf(error)}`);
      return false;
    }
  }
}
```

### 4.2 LlmDeliberationService 拆分

原来的 `runShadowMode()` 拆成两个方法：

| 方法 | 职责 | 谁调它 |
|---|---|---|
| `runShadowMode(input)` | **入队**——调 `processor.enqueue(input)`，不跑 LLM | 编排门面（turn-render-orchestrator） |
| `executeShadowMode(input)` | **真正跑**——调 LLM + 写 trace（就是原来 runShadowMode 里的逻辑） | DeliberationProcessor 的 Worker |

> ⚠️ 注意：对外的端口接口 `DeliberationShadowPort.runShadowMode()` 签名不变——还是 `(input) => Promise<void>`。编排门面完全感知不到内部从同步改成了入队。

### 4.3 env 配置（新增 1 个）

在 `.env.example` 和 `typings/global.d.ts` 里加：

| env 键 | 默认值 | 说明 |
|---|---|---|
| `ENGINE_DELIBERATION_WORKER_CONCURRENCY` | `3` | Worker 并发数 |

> 其他 env 键（`ENABLED` / `MODEL` / `TIMEOUT_MS` / `TEMPERATURE` / `MAX_COMPLETION_TOKENS`）WP64 已经加过了，不用动。

---

## 5. 测试要求

新增 `test/engine-adapters/wp65-deliberation-queue.spec.ts`，覆盖以下用例：

### 5.1 入队路径（4 例）

1. ✅ `runShadowMode()` 入队成功后，queue.add 被调一次，参数正确
2. ✅ 入队失败时（queue.add 抛错），不抛回调用方，只打 warn
3. ✅ 开关关闭时（`ENGINE_DELIBERATION_ENABLED=false`），不入队，queue.add 没被调
4. ✅ 缺省（不配 env）时也是关的，不入队

### 5.2 执行路径（5 例）

5. ✅ `executeShadowMode()` 正常跑：调 LLM + 写成功 trace
6. ✅ LLM 报错时：写失败 trace（ok=false + errorCode），不抛
7. ✅ JSON 解析失败时：写失败 trace，不抛
8. ✅ 超时错误时：写失败 trace，不抛
9. ✅ Redis 写 trace 失败时：只打日志，不抛

### 5.3 Worker 配置（3 例）

10. ✅ Worker concurrency 从 env 读，默认 3
11. ✅ env 配非法值时回退默认 3，不抛错
12. ✅ `onModuleDestroy` 时 Worker 和 Queue 都正确关闭

### 5.4 边界（3 例）

13. ✅ `executeShadowMode()` 不写对话原文进 trace（隐私红线）
14. ✅ 日志里只出 sessionId / turnIndex / 错误码，不出审议原文
15. ✅ `boundary.spec.ts` 11 条断言全绿（engine-core 零改动）

---

## 6. 验收标准

### 6.1 功能验收

| 条目 | 要求 |
|---|---|
| `DeliberationProcessor` 正确注册到 engine.module | ✅ onModuleInit 启动 Worker，onModuleDestroy 关闭 |
| `runShadowMode()` 入队就返回 | ✅ 不再直接调 LLM |
| Worker 并发数默认 3，env 可配 | ✅ |
| 任务持久化在 Redis | ✅ BullMQ 原生支持，进程重启不丢 |
| 重试策略沿用全项目口径 | ✅ attempts=3, exponential backoff |

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
_前置依赖：WP64 已交付核验（97/100）_

---

## 8. 交付后补记（2026-11-05）

> 交付记录：[`engine-wp65-deliberation-shadow-queue-implementation-2026-11-05.md`](engine-wp65-deliberation-shadow-queue-implementation-2026-11-05.md)
> 下表逐条登记**与任务单原文的偏差**，每条都能自圆其说。

| # | 任务单原文 | 实际落地 | 为什么 |
|---|---|---|---|
| 1 | §4.2 表格：`runShadowMode`（入队）留在 **`LlmDeliberationService`** 上，`executeShadowMode` 也住在它身上；§4.1 代码示例又要 `DeliberationProcessor` 调 `this.llmDeliberation.executeShadowMode(job.data)` | **端口实现在 `DeliberationProcessor`**（`runShadowMode` = 入队），**`LlmDeliberationService` 只保留 `executeShadowMode`**（跑 LLM + 写 trace），且**不再实现** `DeliberationShadowPort` | 两者合起来 = `service → processor → service` 的**循环依赖**（NestJS 启动直接炸）。落法：依赖**单向**（processor → service），零新增类，与仓库既有 `TurnAnalysisProcessor → TurnAnalysisService` 同款形状。`DeliberationShadowPort` 接口**继续声明在 `llm-deliberation.service.ts`** —— 门面零改动是本单核心约束，搬走端口定义会让门面多一条 import。见交付记录 §2.1 |
| 2 | §3.2「`llm-deliberation.service.ts` 注入 `DeliberationQueue`（就是 BullMQ Queue 实例）」 | **没有**把 Queue 注入 service；`Queue` 由 processor 在 `onModuleInit` 里自己 `new` | 与第 1 条同源：把「队列」漏进执行器，与分层意图相反。照 `counselor-supervision.processor.ts` / `turn-analysis.processor.ts` 的既定 pattern，Queue 的生命周期归 processor。见交付记录 §2.1 |
| 3 | §4.1 注释：「jobId 不带 turnIndex, 因为同会话不同轮次是独立的 job, 不需要去重」 | **jobId 带 turnIndex**：`d-shadow-{租户长度}-{租户}-{会话长度}-{会话}-{轮次}` | 按那条注释写会出**静默丢任务**的 bug：`removeOnComplete = { count: 1000, age: 24h }` 让已完成的 job 在 Redis 留 24 小时，而 BullMQ 的 `queue.add()` 遇**已存在的 jobId 会静默跳过**（不报错）→ jobId 只有 sessionId 时，**审议只跑第一轮且零报错**。幂等粒度必须落到"同一场会话的同一轮"（硬约束 13）。见交付记录 §2.2 |
| 4 | §4.1 注释：jobId 直接写（无长度前缀 / 无转义） | jobId 加**长度前缀 + `:` 转义**（转义单射，先 `%` 后 `:`） | ① 撞键防护：`(租户="a-b", 会话="c")` 与 `(租户="a", 会话="b-c")` 不能算出同一个 jobId（否则第二个会话的审议被静默丢弃）；② BullMQ 的自定义 jobId 基本不能含 `:`（`bullmq/dist/cjs/classes/job.js` 只在"恰好 3 段"的历史兼容分支放行），而这两个 id 是外部传入的字符串。见交付记录 §2.3 |
| 5 | §3.3「既有测试 —— 一行不动」 | **WP64 的 `wp64-deliberation-shadow.spec.ts` 必须改**（20 处 `service.runShadowMode(` → `service.executeShadowMode(`，**用例数与断言内容一条不减**）；入队路径的新用例全部放 WP65 新 spec | §4.2 要求 `runShadowMode` 的语义从"跑"改成"入队"，而 WP64 spec 断言的正是"`service.runShadowMode()` 会调 LLM + 写 trace" —— 语义一改断言必然要改。**这一条在任务单内部无法同时满足**（§3.3 与 §4.2 互斥）。见交付记录 §2.8 |
| 6 | §4.1 代码示例：`enqueue()` 不判开关 | **入队前判一次开关**（关了就不入队，白占队列 + 白等上游都不值当）；**执行时再判一次**（硬约束 12：异步任务的偏好在执行时读） | 任务单只在 §5.1 里隐含了入队侧判开关，没提执行时。执行时那一次是必需的：入队到执行可能隔几十秒，运维这期间把开关关了 → 队列里的旧 job 应该跳过，不烧这次 LLM。两处判定收敛到**同一个导出纯函数** `resolveDeliberationEnabled()`，杜绝两份真相。见交付记录 §2.4 |
| 7 | §5.2 的执行路径用例（5 条）隐含"Worker 回调直接调 service" | `processJob()` 只调 `llmDeliberation.executeShadowMode(job.data)`，**永不抛** | 审议失败若把 job 打成 `failed` → BullMQ 按 `attempts: 3` 重试 → **再烧两次 LLM**，而失败原因（JSON 不合法、模型抽风）重试也未必好。`executeShadowMode()` 内部已把异常吃干净（WP64 既有纪律），job 正常完成。见交付记录 §2.7 |
| 8 | §3.1「新增 2 个文件」/ §3.2「改 3 个文件」 | **新增 2**（`deliberation.processor.ts` + WP65 spec）/ **改 6**（`llm-deliberation.service.ts` / `engine.module.ts` / `redis.constants.ts` / `.env.example` / `typings/global.d.ts` / WP64 spec） | 多出的 3 个改：① `llm-deliberation.service.ts` —— 改名 + 抽纯函数（第 1、6 条）；② `.env.example` + `typings/global.d.ts` —— §4.3 要求的第 5 个 env 键（任务单 §3 的文件清单里漏列了）；③ WP64 spec —— 第 5 条。**`turn-render-orchestrator.ts` 确认零改动**（端口签名不变）。见交付记录 §1 |
| 9 | §4.3 env：新增 1 个 `ENGINE_DELIBERATION_WORKER_CONCURRENCY` | **照办**（默认 3，非法值回退 3 不抛错），`.env.example` + `typings/global.d.ts` 都加 | —— 一致，无偏差。**逐个字面量**读（不用计算键）→ env 覆盖断言（AST 抽取）双向守住。见交付记录 §1.3 |
| 10 | D1「完全照 `counselor-supervision.processor.ts` 抄」 | **照抄**（`onModuleInit` 建 Queue + Worker / `onModuleDestroy` 用 `Promise.allSettled` / `prefix: 'bullmq'` / 统一 `defaultJobOptions` / `enqueue()` 失败只 warn / worker `failed` 事件打 error）；**并发数取 3 而非 1**（§D2 已规定），另加**长度前缀 jobId**（第 3、4 条） | —— 一致，无偏差。并发 3 与另两个 worker 的差异（supervision 1 / turn-analysis 2）已登记在交付记录 §2.6 |

**闸门**：eslint **0 error**（`npx eslint "src/**/*.ts" "test/**/*.ts"` exit 0）/ tsc **0 error**（`npx tsc -p tsconfig.build.json --noEmit` exit 0）/ vitest **103 文件 1717 例全绿**（WP64 基线 102 文件 1697 例 → 本轮 **+1 文件 / +20 例**，既有 1697 例零回归；闸门用 `vitest run --exclude '**/e2e/**/*.ts'`，e2e 要真 DB）/ `git diff --stat HEAD -- src/engine-core` = **空**（内核零改动）/ `boundary.spec.ts` 全绿 / env 覆盖断言双向全绿。

**遗留**：backlog 母版里 WP65 的另一半（**per-session mutex + 快照版本号**）**仍未做** —— 本单交付的是「队列化」这一半。影子模式下审议结果**不写状态**，所以并发不会造成状态覆盖；但**切灰度（结果开始生效）之前必须先补 per-session mutex**，否则同一会话两轮审议同时回写 BDI 快照会互相覆盖。母版那一行**保留为未完成**，不因本单销账。详见交付记录 §4.1。

