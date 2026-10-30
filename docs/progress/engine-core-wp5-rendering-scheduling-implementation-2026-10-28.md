# WP5 · 多模型渲染调度（渲染契约层）后端交付记录

> 任务单: [`engine-core-wp5-rendering-scheduling-backend-2026-10-28.md`](./engine-core-wp5-rendering-scheduling-backend-2026-10-28.md)
> 母版: [`../architecture/ai-engine-roadmap-v1.1.md`](../architecture/ai-engine-roadmap-v1.1.md) WP5 + §3 五引擎「多模型渲染引擎」
> 前置: [`engine-core-wp0-boundary-skeleton-backend-2026-10-28.md`](./engine-core-wp0-boundary-skeleton-backend-2026-10-28.md)（边界骨架）、
>       [`engine-core-wp1-bdi-cognitive-engine-backend-2026-10-28.md`](./engine-core-wp1-bdi-cognitive-engine-backend-2026-10-28.md)（BDI 规则轨）、
>       [`engine-core-wp2-layered-memory-backend-2026-10-28.md`](./engine-core-wp2-layered-memory-backend-2026-10-28.md)（分层记忆 V1）、
>       [`engine-core-wp3-trajectory-control-backend-2026-10-28.md`](./engine-core-wp3-trajectory-control-backend-2026-10-28.md)（会话轨迹控制）、
>       [`engine-core-wp4-ethics-safety-backend-2026-10-28.md`](./engine-core-wp4-ethics-safety-backend-2026-10-28.md)（伦理安全）
> 仓库: `E:\Work\Project\backend\mofang-nestjs`
> 日期: 2026-10-28 ｜ 状态: 🟢 **已交付并自跑复跑绿**（eslint 0 / tsc 0 / jest engine-core 7 套件 177 用例全绿、engine-adapters 13 用例全绿；WP0–WP4 既有用例零回归）

---

## 1. 闸门复跑结果（本轮自跑，Windows PowerShell）

| # | 命令 | 结果 |
|---|---|---|
| 1 | `npx eslint "src/**/*.ts"` | **exit 0**，0 error |
| 2 | `npx tsc -p tsconfig.build.json --noEmit` | **exit 0**，0 error |
| 3 | `npx jest test/engine-core` | **7 套件 / 177 用例全绿**（WP0–WP4 既有 153 零回归 + WP5 新增 24） |
| 4 | `npx jest test/engine-adapters` | **1 套件 / 13 用例全绿**（WP2 B 层，本期未动） |

> 本轮未跑 `pnpm build`（全量构建）与既有业务测试 —— 本期零 entity / migration / module 改动，且**未改 `turn` 管线一行**；全量构建建议合并前补跑。

### 1.1 关于 jest「worker 未优雅退出」告警的排查结论（已定位：环境并发，非代码缺陷）

`npx jest test/engine-core` 在**并行模式**下会**间歇性**打印：

```
A worker process has failed to exit gracefully and has been force exited. This is likely caused by tests leaking due to
improper teardown. Try running with --detectOpenHandles to find leaks. Active timers can also cause this, ensure that
.unref() was called on them.
```

**排查结论：与本期代码无关，是 jest 默认 worker 数把机器压满导致的 worker 退出握手超时。** 证据链：

| # | 实验 | 结果 | 说明 |
|---|---|---|---|
| 1 | `npx jest test/engine-core --detectOpenHandles` | **177 全绿，零 open handle 报告** | 若真有句柄泄漏，detectOpenHandles 会逐条列出；它一条没列 → **代码没有泄漏的句柄** |
| 2 | `npx jest test/engine-core --runInBand`（串行） | **177 全绿，无告警** | 串行即单进程，无 worker 池退出握手 → 佐证问题在 worker 池 |
| 3 | `npx jest test/engine-core --maxWorkers=2` × 3 连跑 | **3/3 无告警**，耗时 **13–17s** | 默认 7 worker 时同一命令耗时 **44–51s**；并发降下来后既不告警也快 3–4 倍 → 触发条件是**CPU 过度订阅** |
| 4 | `npx jest test/engine-core`（默认 7 worker）× 3 连跑 | **1/3 复现**，退出码始终 0 | 间歇性、与负载强相关 |
| 5 | 全树扫描定时器 | 内核 `src/engine-core/` **全树仅 1 处** `setTimeout`（`cognition/safety/assess-safety.ts` 的 `withTimeout`），已 `unref()` + `clearTimeout()`；`test/engine-core/` **零** `setTimeout/setInterval/process.on` | 没有第二个未清理的句柄 |

**机理**：本机 8 逻辑核 → jest 默认 `maxWorkers = 7`，7 个 ts-jest（**默认开类型诊断**）worker 同时跑 7 个套件，把 CPU 压满；worker 收不到 / 处理不完退出握手，`jest-worker` 的 `FORCE_EXIT_TIMEOUT` 到点即强制 kill 并打印该告警。**退出码始终为 0，用例数与断言结果不受影响。**

**处置：本期不改 `jest.config.ts`** —— 它是全仓库测试配置，改 `maxWorkers` 会影响既有业务测试的并行行为，超出 WP5 范围。建议由仓库负责人拍板其一：

- 保持现状：接受偶发告警（不影响结果），或复跑时加 `--maxWorkers=2`（实测更快且干净）；
- 或在 `jest.config.ts` 增设 `maxWorkers: '50%'`（约 4 worker），一次性消除该噪声。

---

## 2. 交付范围逐条对照（任务单 §1.1 / §9）

| 任务单条目 | 交付 | 落点 |
|---|---|---|
| §1.1-1 任务分层 `RenderTaskKind` | ✅ | `domain/rendering/render-types.ts`：字符串联合 `stable` / `chat` / `advanced`（非 enum，内核零运行时导出） |
| §1.1-2 渲染规格 DTO `RenderSpec` | ✅ | 同文件：意图 + 情绪/阻抗/移情/信任 + 核心信念 + 依恋风格 + 合并后禁止行为 + WP2 记忆命中 + WP3 轨迹参考 + 最近对话 + Token 预算；**不含模型名/温度/prompt/apiKey** |
| §1.1-3 渲染端口 `RenderPort` | ✅ | `domain/ports/render-port.ts`：**纯接口零实现**，`render` 允许 reject 由适配层兜 |
| §1.1-4 渲染结果 `RenderResult` | ✅ | `domain/rendering/render-types.ts`：text / taskKind / usage / fallbackUsed / providerHint，无厂商私有字段 |
| §1.1-5 Token 预算纯函数 | ✅ | `cognition/rendering/token-budget.ts`：`estimateTokens` / `fitContextToBudget` / `resolveCompletionTokens` + 种子常量 |
| §1.1-6 主备容灾选择状态机 | ✅ | `cognition/rendering/failover.ts`：`selectFailoverTarget` 纯函数（无 IO / 无定时器 / 无冷却） |
| §1.1-7 输出侧伦理校验编排 | ✅ | `cognition/rendering/output-guard.ts`：`guardVisitorOutput` 薄封装复用 WP4 `assessSafety(visitor_output)` |
| §1.1-8 单测覆盖 | ✅ | `test/engine-core/wp5-rendering.spec.ts`（24 用例，覆盖任务单 §8 清单 1-12 + 边界断言） |
| §5.5 本期不接管线 | ✅ | **未改** `in-memory/in-memory-engine-session.ts`（git 可核）：`reply` 恒 `''`，`turn` 未调用 `RenderPort`、未组装 `RenderSpec`、未调 `guardVisitorOutput`；出参字段集合与 WP4 逐字一致 |
| §1.3 不碰 `src/llm` 路由 | ✅ | 本轮**零**文件改动（git status 可核） |
| §9 验收清单 | ✅ | 全部勾选，详见任务单 §13 回写 |

### 额外交付（任务单未点名，但属「治本」范畴）

| # | 额外项 | 理由 |
|---|---|---|
| A | **`FailoverState.consecutiveFailures` 随状态一起带过来（但选择时不参与判定）** | 状态就该是状态的完整样子 —— 只挑内核当下用得上的字段传过来，等于让内核与适配层各持一份不同的真相。阈值/冷却由适配层读它自己决定 |
| B | **预算裁剪的「整轮丢弃」方向写死为从最旧开始** | 对话新近性最重要；而且"丢当前轮"和"丢最旧轮"在实现上是两种完全不同的循环写法，先定方向才不会写反 |
| C | **token 估算保守（偏多估）** | 少估 → 实际塞不下 → 模型侧静默截断而内核以为裁好了（"以为做了防护其实没做"）；多估只浪费几个 token。失败方向必须是安全那侧 |
| D | **`resolveCompletionTokens` 对正数原样返回（不 floor）** | 按任务单 §4.3/§5.2「正数原样返回」；上限值是否取整属适配层/配置层口径，内核不擅自改写调用方的数 |
| E | **零回归断言锁到「出参字段集合」** | 只断言 `reply === ''` 不够 —— 若将来有人在 `turn` 出参里偷偷加字段，字段集合断言会立刻变红 |

---

## 3. 文件清单

### 新增 · 内核 `src/engine-core/`（整包仍零框架、零 typeorm、零新第三方依赖）

```
src/engine-core/
├── domain/
│   ├── rendering/
│   │   └── render-types.ts           【新】RenderTaskKind / RenderContextTurn / RenderTokenBudget / RenderSpec / RenderResult
│   └── ports/
│       └── render-port.ts            【新】RenderPort 接口（真实 LLM 适配留装配轮）
└── cognition/
    └── rendering/                    【新目录】
        ├── token-budget.ts           【新】estimateTokens / fitContextToBudget / resolveCompletionTokens + 种子常量
        ├── failover.ts               【新】FailoverCandidate / FailoverState / selectFailoverTarget
        └── output-guard.ts           【新】guardVisitorOutput（薄封装 WP4 assessSafety）
```

### 修改 · 内核 `src/engine-core/`

```
src/engine-core/index.ts              导出 WP5 公开面（15 个新导出）
```

> **`in-memory/in-memory-engine-session.ts` 本期零改动** —— 这是零回归的关键，也是任务单 §3.1 的明确要求。

### 新增/修改 · 测试

```
test/engine-core/wp5-rendering.spec.ts 【新】WP5 24 用例（任务单 §8 清单 1-12 + 边界断言）
test/engine-core/boundary.spec.ts      【改】断言⑥ 白名单 + 断言⑦ 目录清单同步（15 个新导出 + 5 个新文件）
```

> WP0–WP4 的既有测试文件**零改动**。

---

## 4. 关键设计决策（实施层，任务单 §11 之外的补充）

1. **`RenderTaskKind` 用字符串联合而非 enum** —— 与 WP2 `MemoryRecallScope` / WP3 `TrajectoryMode` / WP4 `SafetyLevel` 同理。
2. **`RenderSpec` 是纯可序列化对象** —— 内核只回答"决策到哪了"，不回答"用哪个模型说"；规格里一旦出现 modelName，就等于内核绑死某个厂商，换模型要动内核代码。
3. **token 估算是保守工程近似，不装 tiktoken** —— 内核零新依赖；字符率集中为 `CHARS_PER_TOKEN` 一个常量，后期换真实编码器只改这一处。
4. **裁剪只认 token 预算，不认轮数** —— 一句 500 字和一句 5 字差 100 倍，按轮数裁剪等于把长短不均的对话砍成一样。
5. **最后一轮永不整轮丢弃** —— 装不下就从头部截断字符、保留尾部（尾部是这句话真正要说的部分），并计 `truncatedTurns`。
6. **容灾只回答"按当前记录下一个选谁"** —— 失败几次切备 / 冷却 / 退避 / 恢复切回都需要时钟与有状态计时，放进内核就等于内核要读时间、测试要等真实时间，纯函数做不到可测可复现。
7. **候选顺序即优先级，内核不按健康度重排** —— 按健康度排等于把冷却/恢复逻辑偷偷搬进内核；"谁是主"的解释权只在适配层。
8. **"已尝试"按 id 判定而非下标** —— 候选列表可能被适配层动态调整，按下标会张冠李戴。
9. **输出侧校验是薄封装，不重造规则** —— 否则会出现"同一段来访话术在咨询师输入侧判 warn、在渲染输出侧判 pass"的分裂；两侧口径必须永远一致。
10. **`guardVisitorOutput` 不改写 `RenderResult.text`** —— 校验层碰内容就等于同时干了"生成"和"审核"两件事，出问题时无法定位是哪一环。

---

## 5. 已知缺口与风险（交付时必须知会）

| # | 缺口 | 性质 | 影响 / 处置 |
|---|---|---|---|
| 1 | **`RenderPort` 无真实实现，`reply` 仍恒空** | 任务单明确本期不做 | 装配轮包装现有 `LlmRouterService`（含主备 fallback 与流式）实现 `RenderPort`；本期内核不调模型 |
| 2 | **无渲染规格组装器** | 任务单明确本期不做 | `RenderSpec` 的组装（意图 + 记忆 + 轨迹 → 规格）在适配层；内核只定义形状 |
| 3 | **`DEFAULT_COMPLETION_TOKENS=160` / `CHARS_PER_TOKEN=1.6` 未标定** | 工程种子值 | 集中为常量，装配轮接真实编码器 / 按模型上下文窗口校准 |
| 4 | **容灾只给选择，不给执行** | 任务单明确本期不做 | 主失败 N 次切备、冷却、健康恢复切回在适配层；若装配轮发现需要内核侧持有连续失败计数，再以纯函数形式追加状态迁移 |
| 5 | **输出侧高危由适配层决定重生成/降级/拦截** | 内核只给信号 | 内核不重生成、不替换话术、不拦截（内核只判定不拦截，同 WP4） |
| 6 | **`pnpm build` 全量构建与既有业务测试本轮未跑** | 范围之外 | 本期零 entity / migration / module 改动、turn 管线零改动；合并前建议补跑 |
| 7 | **WP2 遗留两项另起单** | WP2 范围 | Qdrant 写侧冲突标记（需给 `QdrantService` 补 `setPayload`）、短时记忆自动写入与会话结束编排层接线；本期未动 |
| 8 | **jest 并行模式偶发「worker 未优雅退出」告警** | **环境并发，非本期代码缺陷** | 已定位为默认 7 worker 把 8 核机器压满导致的退出握手超时（详见 §1.1 五条证据）；退出码 0、结果不受影响。复跑可用 `npx jest test/engine-core --maxWorkers=2`（实测更快且无告警）；是否在 `jest.config.ts` 固化由仓库负责人决定 |

---

## 6. 验证命令（复跑）

```powershell
cd E:\Work\Project\backend\mofang-nestjs
npx eslint "src/**/*.ts"
npx tsc -p tsconfig.build.json --noEmit
npx jest test/engine-core
npx jest test/engine-adapters
```

> `npx jest test/engine-core` 若出现偶发「worker 未优雅退出」告警，属环境并发问题（§1.1 已定位）；加 `--maxWorkers=2` 可消除且更快：`npx jest test/engine-core --maxWorkers=2`。

无新增 env 开关；本期零 `.env` 改动、零 migration/entity/新表、零 LLM 调用、零口语产出（`reply` 仍恒 `''`）、零新第三方依赖、零落库、**turn 管线零改动**。
