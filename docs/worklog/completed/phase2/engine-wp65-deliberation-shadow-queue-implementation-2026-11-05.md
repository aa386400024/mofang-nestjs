# WP65 交付记录 — 审议影子模式 BullMQ 队列化

> 任务单：[`../../pending/wp65-deliberation-shadow-queue-2026-11-05.md`](../../pending/wp65-deliberation-shadow-queue-2026-11-05.md)
> 日期：2026-11-05
> 红线：**engine-core 零改动**（`git diff --stat HEAD -- src/engine-core` 为空）

---

## 1. 实际改了哪些文件

### 1.1 适配层：1 增 2 改（任务单 §3.1 新增 `deliberation.processor.ts` + §3.2 改 `llm-deliberation.service.ts` / `engine.module.ts` —— 对得上；`redis.constants.ts` 归到 §1.2 基础设施）

| 文件 | 改什么 |
|---|---|
| `src/engine-adapters/deliberation/deliberation.processor.ts` | **新增**。`DeliberationProcessor`：BullMQ `Queue` + `Worker`、`enqueue()`、`runShadowMode()`（端口实现 = 入队）、`buildDeliberationJobId()`、`resolveWorkerConcurrency()` |
| `src/engine-adapters/deliberation/llm-deliberation.service.ts` | `runShadowMode()` 改名 **`executeShadowMode()`**（语义不变：跑 LLM + 写 trace，只是不再由门面直接调）；`LlmDeliberationService` **不再实现** `DeliberationShadowPort`；新增导出纯函数 `resolveDeliberationEnabled()`（开关判定的唯一口径） |
| `src/engine-adapters/wiring/engine.module.ts` | `providers` 加 `DeliberationProcessor`；`TurnRenderOrchestrator` 的 `deliberation` 注入从 `LlmDeliberationService` 换成 `DeliberationProcessor` |

### 1.2 基础设施：1 改

| 文件 | 改什么 |
|---|---|
| `src/shared/infra/redis/redis.constants.ts` | `QUEUE_NAMES` 加 `deliberation: 'deliberation-shadow'` |

### 1.3 配置：2 改

| 文件 | 改什么 |
|---|---|
| `.env.example` | 加 `ENGINE_DELIBERATION_WORKER_CONCURRENCY=`（生效行 + 注释块） |
| `typings/global.d.ts` | 加 `ENGINE_DELIBERATION_WORKER_CONCURRENCY?: string` |

### 1.4 测试：1 增 1 改

| 文件 | 改什么 | 用例数 |
|---|---|---|
| `test/engine-adapters/wp65-deliberation-queue.spec.ts` | **新增**。覆盖任务单 §5 的 15 条 + 5 条防漂移 | **20** |
| `test/engine-adapters/wp64-deliberation-shadow.spec.ts` | 机械改名：`service.runShadowMode(` → `service.executeShadowMode(`（20 处）+ 文件头补 WP65 说明。**用例数不变** | 33（原样） |

### 1.5 零改动（逐条核实过）

- ✅ `src/engine-core/**` —— **一行不动**（`git diff --stat HEAD -- src/engine-core` 输出为空）
- ✅ `src/engine-adapters/rendering/turn-render-orchestrator.ts` —— **一行不动**。门面只认 `DeliberationShadowPort`，对"内部是直接跑还是入队"**完全无感**
- ✅ `src/engine-adapters/wiring/engine.providers.ts` —— 一行不动（`deliberation?: DeliberationShadowPort` 的端口类型没变）
- ✅ `src/counselor/**` —— 一行不动（不 import `CounselorModule`，装配层依旧零 ORM）
- ✅ `test/engine-adapters/wp63-deliberation-schema.spec.ts` —— 一行不动

---

## 2. 关键设计决策（与任务单有出入的地方 + 为什么）

### 2.1 决策 D1：**端口实现在 processor，service 降级为执行器**（任务单 §4.1 + §4.2 合起来是循环依赖）

任务单 §4.2 的表格写的是「`runShadowMode`（入队）留在 `LlmDeliberationService` 上、`executeShadowMode` 也住在它身上」，而 §4.1 的代码示例又要求 `DeliberationProcessor` 调 `this.llmDeliberation.executeShadowMode(job.data)`。两者合起来 = `service → processor → service` 的**循环依赖**（NestJS 启动直接炸 `Circular dependency`）。

**落法（与大炮确认过的方案 A）**：

```
TurnRenderOrchestrator ──▶ DeliberationProcessor   实现 DeliberationShadowPort
                                    │  runShadowMode() = 入队就返回
                                    ▼
                            LlmDeliberationService.executeShadowMode() = 跑 LLM + 写 trace
```

- 依赖方向**单向**（processor → service），零循环，零新增类；
- 与仓库既有的 `TurnAnalysisProcessor → TurnAnalysisService` **同款形状**；
- `DeliberationShadowPort` 接口**继续声明在 `llm-deliberation.service.ts`** —— 门面与它的端口定义一起搬走会让门面多一条 import 路径，而门面零改动是本单的核心约束。

**连带偏差**：任务单 §3.2 写「`LlmDeliberationService` 的依赖注入加 Queue」—— 本实现**没有**把 `Queue` 注入 service。`Queue` 由 processor 在 `onModuleInit` 里自己 `new`（与 `counselor-supervision.processor.ts` / `turn-analysis.processor.ts` 同款）。把 Queue 注入 service 会把"队列"这个概念漏进执行器，与 D1 的分层意图相反。

### 2.2 决策 D2：**jobId 必须带 turnIndex**（任务单 §4.1 的注释「jobId 不带 turnIndex」是错的）

任务单 §4.1 的代码示例里注释着「jobId 不带 turnIndex, 因为同会话不同轮次是独立的 job, 不需要去重」。按那个写法会出**静默丢任务**的 bug：

- `defaultJobOptions.removeOnComplete = { count: 1000, age: 24h }` → **已完成的 job 在 Redis 里留 24 小时**；
- BullMQ 的 `queue.add()` 遇到**已存在的 jobId** 会**静默跳过**（不报错、不覆盖）；
- 于是 jobId 只有 sessionId 时：第 1 轮入队 → 第 2 轮起的 job 全部被去重丢弃 → **审议只跑第一轮，且没有任何报错**。

**落法**：`buildDeliberationJobId(tenantId, sessionId, turnIndex)` = `d-shadow-{租户长度}-{租户}-{会话长度}-{会话}-{轮次}`。幂等粒度落到"同一场会话的同一轮"（仓库硬约束 13：jobId 要幂等）。

### 2.3 决策 D3：jobId 加**长度前缀 + 转义**（任务单未提，防两类事故）

- **长度前缀**：`(租户="a-b", 会话="c")` 与 `(租户="a", 会话="b-c")` 不能算出同一个 jobId（否则第二个会话的审议被静默丢弃 —— 最难查的一类 bug）；
- **转义 `:`**：BullMQ 的自定义 jobId 基本不能含 `:`（`bullmq/dist/cjs/classes/job.js` 只在"恰好 3 段"的历史兼容分支放行，我们的 jobId 段数不固定 → 一律当非法），而 tenantId / sessionId 是外部传入的字符串，不保证干净。转义**先 `%` 后 `:`** 且必须**单射**（否则字面量 `%3A` 与 `:` 会编码成同一个串）。

### 2.4 决策 D4：开关**入队前 + 执行时各判一次**，共用一个纯函数

任务单只在入队侧提了开关。执行时再判一次的理由是**仓库硬约束 12**（异步任务的偏好在执行时读）：入队到执行之间可能隔几十秒，运维这期间把开关关了 → 队列里的旧 job 应该**跳过**，不烧这次 LLM。

两处判定收敛到导出的纯函数 `resolveDeliberationEnabled()`（`llm-deliberation.service.ts`）—— 各写一份必然漂移（一处认 `on` 一处不认）。

### 2.5 决策 D5：job payload = **完整 `DeliberationShadowInput`**（任务单 D5 一致，但**有意偏离仓库惯例**）

仓库既有的 `TurnAnalysisProcessor` 只在 payload 里带定位信息（service 自己读库拿最新数据）。审议**没有这个条件**：

- 审议的**起始快照**（`baseSnapshot`）**没有 DB 真相源可读** —— 它是内核这一轮开始时的内存状态，适配层拿不到；
- 若执行时再读，读到的是**几秒后**的状态，与"这一轮的 delta"对不上号。

所以 payload 随 job **冻结**。**隐私影响已登记**：payload 含对话原文（`counselorText` / `visitorText`）+ 心理画像（`baseSnapshot` / `characterBrief`），会在 Redis 里**最多留 24 小时**（`removeOnComplete.age`）。它不进日志 / crash report / 网络日志（隐私红线 AGENTS.md §5.4），队列层日志只出 jobId / sessionId / turnIndex / 错误码。

### 2.6 决策 D6：Worker 并发 **3**（任务单 D2 一致；与另两个 worker 的差异登记在案）

| worker | 并发 | 理由 |
|---|---|---|
| `counselor-supervision` | 1 | 单次 LLM 30-120s，串行才压得住上游 |
| `counselor-turn-analysis` | 2 | low 档 3-8s，短任务 |
| **`deliberation`（本单）** | **3** | 审议 3-8s（推理模型 thinking + 输出），但要读完整状态快照做对比，比每轮分析的轻档重 → 折中档，env 可调 |

### 2.7 决策 D7：**Worker 的 job handler 永不抛**（审议失败不该触发 BullMQ 重试）

`executeShadowMode()` 内部已把所有异常吃干净（WP64 的既有纪律），所以 job **正常完成**。
若审议失败会把 job 打成 `failed` → BullMQ 按 `attempts: 3` 重试 → **再烧两次 LLM**，而失败原因（JSON 不合法、模型抽风）重试也未必好。WP66 的"格式校验重试"是另一码事（它要的是"校验不过就重试一次"，不是"任何失败都重试"）。

### 2.8 决策 D8：任务单 §3.3 的「既有测试 —— 一行不动」**做不到**（不可避免的偏差）

任务单 §4.2 要求 `runShadowMode` 的语义从"跑"改成"入队"，而 WP64 的 `wp64-deliberation-shadow.spec.ts`（33 例）断言的正是"`service.runShadowMode()` 会调 LLM + 写 trace" —— 语义一改，这些断言必然要改。

**落法**：WP64 spec 里只做**机械改名**（`service.runShadowMode(` → `service.executeShadowMode(`，20 处），**用例数、断言内容、覆盖范围一条不减**；入队路径的新用例全部放进 WP65 新 spec。文件头补了一段说明"为什么改名"。

### 2.9 决策 D9：不引 `@nestjs/bull`，用 bullmq 原生 `Queue` + `Worker`（任务单 D1 一致 —— 确认项）

`prefix: 'bullmq'` + 统一 `defaultJobOptions`（`attempts: 3` / `exponential` 1000ms / `removeOnComplete {count:1000, age:24h}` / `removeOnFail {count:5000}`）+ `onModuleDestroy` 用 `Promise.allSettled([worker?.close(), queue?.close()])` —— 逐字照 `counselor-supervision.processor.ts` / `turn-analysis.processor.ts` 的既定 pattern。

### 2.10 决策 D10：开关的判定口径抽成纯函数 `resolveDeliberationEnabled()`

见 §2.4。放在 `llm-deliberation.service.ts` 里导出（而不是另开一个文件）—— 一个 6 行的纯函数不值得单开文件，且它本来就和 `ENGINE_DELIBERATION_*` 那一族 env 在一起。

---

## 3. 验收对照（任务单 §6）

### 3.1 功能验收（§6.1）

| 条目 | 要求 | 结果 |
|---|---|---|
| `DeliberationProcessor` 正确注册到 engine.module | ✅ onModuleInit 启动 Worker，onModuleDestroy 关闭 | ✅ |
| `runShadowMode()` 入队就返回 | ✅ 不再直接调 LLM | ✅ |
| Worker 并发数默认 3，env 可配 | ✅ | ✅ |
| 任务持久化在 Redis | ✅ BullMQ 原生支持，进程重启不丢 | ✅ |
| 重试策略沿用全项目口径 | ✅ attempts=3, exponential backoff | ✅ |

### 3.2 闸门验收（§6.2）

| 闸门 | 要求 | 实测 |
|---|---|---|
| `npx eslint "src/**/*.ts" "test/**/*.ts"` | 0 error | **0 error**（exit 0） |
| `npx tsc -p tsconfig.build.json --noEmit` | 0 error | **0 error**（exit 0） |
| `npx vitest run --exclude '**/e2e/**/*.ts'` | 全绿，既有零回归 | **103 文件 / 1717 例全绿**（WP64 时是 102 文件 / 1697 例 → 本单 +1 文件 +20 例） |
| `git diff --stat HEAD -- src/engine-core` | 为空 | **空** |

> `npx vitest run`（**不带** `--exclude`）会把 e2e 拉进来报 DI 装配失败 —— e2e 要真 DB / Redis，与本单无关。仓库口径一直是带 `--exclude` 跑。

### 3.3 测试用例要求（§5 的 15 条 → 实际 20 条）

| 任务单 §5 | 用例 | 本单 spec 对应 |
|---|---|---|
| 5.1-1 入队成功 → `queue.add` 被调一次，参数正确 | ✅ | ①-1 |
| 5.1-2 入队失败 → 不抛回调用方，只 warn | ✅ | ①-2 |
| 5.1-3 开关关闭 → 不入队 | ✅ | ①-3 |
| 5.1-4 缺省 → 也不入队 | ✅ | ①-4 |
| 5.2-5 正常跑 → 调 LLM + 写成功 trace | ✅ | ②-5（worker 回调 → `executeShadowMode`）+ WP64 spec ②（trace 内容） |
| 5.2-6 LLM 报错 → 写失败 trace，不抛 | ✅ | ②-6 |
| 5.2-7 JSON 解析失败 → 写失败 trace，不抛 | ✅ | ②-7 |
| 5.2-8 超时 → 写失败 trace，不抛 | ✅ | ②-8 |
| 5.2-9 Redis 写 trace 失败 → 只打日志，不抛 | ✅ | ②-9 |
| 5.3-10 并发从 env 读，默认 3 | ✅ | ③-10 |
| 5.3-11 非法值回退 3，不抛错 | ✅ | ③-11 |
| 5.3-12 `onModuleDestroy` 关 Worker + Queue | ✅ | ③-12 |
| 5.4-13 trace 不写对话原文 | ✅ | ④-13 |
| 5.4-14 日志只出 sessionId / turnIndex / 错误码 | ✅ | ④-14 |
| 5.4-15 内核零改动（boundary 11 条断言） | ✅ | ④-15（内核树零审议代码）+ `boundary.spec.ts` 本身全绿 |

**额外 5 条防漂移**（⑤-a ~ ⑤-e）：队列配置与仓库统一口径一致（队列名 / prefix / attempts / 退避 / removeOn\*）、jobId 幂等键（带 turnIndex / 同轮同 id / 异轮异 id / 不含非法字符）、jobId 撞键防护、jobId 转义单射、**编排门面零改动**（门面源码里不出现 `DeliberationProcessor` / `bullmq`）。

---

## 4. 留给后续 WP 的接口（本单刻意没做）

1. **母版 WP65 的另一半没做**：backlog 母版里 WP65 = 「会话级串行队列与状态一致性」（per-session mutex + 快照版本号）。本单交付的是**队列化**这一半。
   - 影子模式下**并发不会造成状态错乱** —— 审议结果**不写状态**（WP64 的硬纪律 ①），同一会话两轮审议同时跑也只是多算一次对比数据；
   - 但**切灰度（结果开始生效）之前，per-session mutex 必须先补** —— 那时两个 job 同时回写 BDI 快照就会互相覆盖。母版那一行保留为未完成状态，**不因为本单而销账**。
2. **WP66（格式校验 + 重试）**：直接调 `defaultJobOptions.attempts` 即可，不用改代码；但注意 §2.7 —— 重试策略是"队列级"的，"校验不过重试一次"要在 worker handler 里区分错误类型。
3. **WP67（三级降级）**：降级标记（`degraded: true`）要落在**会话**上，而队列层是**跨会话**跑的 —— 降级状态建议由 service 写会话状态，不放队列层。
4. **队列可观测性**（队列长度 / 成功率 / 失败原因）：BullMQ 自带，但仓库还没有 BullMQ 的 metrics 采集口（`src/infra/metrics` 目前只覆盖 HTTP / LLM）。要做的话是独立一单。

---

## 5. 运维须知（跑 PoC 前必读）

1. **开关默认关**：`ENGINE_DELIBERATION_ENABLED=false`（`.env.example` 里是显式生效行）。要跑 PoC 把它打开，**并盯着 token 账单**。
2. **队列名**：`deliberation-shadow`（BullMQ 前缀 `bullmq`）。进程重启不丢任务 —— 队列里没跑完的 job 会继续跑。
3. **并发**：`ENGINE_DELIBERATION_WORKER_CONCURRENCY=3`（留空 = 3；非法值回退 3，**不抛错**）。
4. **Redis 里有心理内容**：未跑完的 job payload 含对话原文，最多留 **24 小时**（`removeOnComplete.age`）；已完成的 trace 记录留 **30 天**。两者都只在 Redis 里，不进日志。
5. **失败不炸主流程**：入队失败 → warn + 返回 false；审议失败 → 记一条 `ok=false` 的 trace，不抛、不重试。

---

## 6. commit message（**未自动提交**，等大炮手动提交）

```
feat(wp65): 审议影子模式 BullMQ 队列化 —— 入队异步跑，Worker 并发可配，内核零改动
```

---

_交付：2026-11-05 · engine-core 零改动 · 闸门 0 error / 1717 例全绿_
