# WP7 · RenderSpec 组装 + turn 接线填 reply（决策→说话闭环）后端任务单

> 母版: [`../architecture/ai-engine-roadmap-v1.1.md`](../architecture/ai-engine-roadmap-v1.1.md) ｜ backlog: [`./phase1-integration-backlog-2026-10-28.md`](./phase1-integration-backlog-2026-10-28.md) WP7
> 前置（已交付）: WP0–WP5 内核纯层；**WP6 `LlmRenderAdapter`（RenderPort 真实实现 + 主备 + 输出 guard + 降级非空）**
> 仓库: `E:\Work\Project\backend\mofang-nestjs`
> 日期: 2026-10-28 ｜ 类型: **适配层（`src/engine-adapters/rendering/`）**；本期把内核决策接成"一句真实来访口语"，**不做流式、不接 WS、不做 NestJS DI 注册、不接生产 LLM 接线**（均属 WP8）
> 目标读者: 后端；闸门由大炮在 Windows PowerShell 复跑 `eslint` / `tsc` / `jest`
> **状态**: 🟢 **已交付并自跑复跑绿**（eslint 0 / tsc 0 / jest engine-adapters 3 套件 47 用例全绿、engine-core 7 套件 177 用例全绿零回归）
> 交付记录: [`engine-wp7-spec-assembly-turn-reply-implementation-2026-10-28.md`](./engine-wp7-spec-assembly-turn-reply-implementation-2026-10-28.md)

---

## 0. 一句话目标

WP6 给了一个"能渲染"的 `RenderPort`，但内核 `turn` 产出的 `reply` 仍是恒空串，决策结果没变成话。WP7 在适配层补两件事：① 把 `EngineTurnOutput`（本轮 intention / 快照情绪·阻抗·移情·信任 / 核心信念 / 开场记忆 / 历史）**组装成 `RenderSpec`**；② 用一个可独立 `new` 的**装配门面**调内核 `turn` → 组装 → `RenderPort.render` → 把真实文本作为本轮来访 `reply` 返回，并把"问+答"成对补写工作记忆。本期交付"决策→说话"的最小闭环单元，**不碰内核、不碰网络接线、不做流式**。

> 为什么不在内核里填 reply：第 0 原则要求内核零 IO / 零 prompt / 零网络。`RenderPort` 是外部能力，内核只产出决策状态；"调谁渲染、怎么拼上下文、怎么回填"是装配职责，必须落在适配层。**禁止改 `in-memory-engine-session.ts` 去调 RenderPort 或填 reply。**

---

## 1. 范围与 Done 定义

### 1.1 本期做到（In Scope）

1. **规格组装器 `buildRenderSpec`**（`src/engine-adapters/rendering/spec-assembler.ts`，纯函数，零 IO）：
   输入一个组装上下文，输出符合内核 `RenderSpec` 形状的对象，字段映射口径见 §3。
   - 内部调用内核 `fitContextToBudget(turns, contextTokens)` 裁剪历史，不自己另写一套裁剪；
   - `taskKind` 本期恒为 `'chat'`（来访口语生成）；`stable / advanced` 本期不调用。
2. **装配门面 `TurnRenderOrchestrator`**（`turn-render-orchestrator.ts`，可独立 `new` 的纯类，非 NestJS）：
   - 构造注入：`session: EngineSessionPort`、`renderer: RenderPort`、`memories: MemoryStore`、可选 `assembler`、可选默认 `tokenBudget`；
   - `async turn(handleId, input: EngineTurnInput): Promise<TurnRenderResult>`：
     1. `await session.turn(handleId, input)` 拿到 `EngineTurnOutput`（内核侧 `reply` 仍为 `''`，正常）；
     2. 用组装器把 output + 累积历史 + `openingContext` 拼成 `RenderSpec`；
     3. `await renderer.render(spec)` 拿 `RenderResult`；
     4. 把 `RenderResult.text` 作为本轮来访回复回填进结果；透传内核的 `snapshot / turnIndex / intention / trajectoryTrace / safety / openingContext`；
     5. 渲染成功后补写**来访半边**工作记忆（见 §1.1-4）。
   - **永不炸穿**：渲染链路任何异常都被兜成非空中性话术，不 reject 给调用方（WP6 内部已降级，门面再包一层防御）。
3. **中文来访风格 system prompt（仅适配层模板）**：
   - 通过 WP6 预留的 `buildMessages(spec)` 缝注入系统消息；模板只放适配层，**内核不含任何 prompt**；
   - 模板约束：把本轮 intention（策略/情绪/阻抗/移情）、forbiddenBehaviors、核心信念约束、轨迹承接要点写进系统侧，要求"口语、克制、不越出决策目标、不给建议/不承诺治愈"；
   - 角色映射保持 WP6 现状：咨询师 → `user`，来访 → `assistant`（模型扮演来访）。
4. **问+答成对写工作记忆**：
   - 内核 `rememberTurn` 已写**咨询师半边**（`source=TURN, tier=WORKING`），门面**不要重复写咨询师半边**；
   - 门面在渲染成功后写**来访半边**：`memories.remember({ tenantId, sessionId, visitorId, id, tier: WORKING, source: TURN, content: 来访回复文本, importance: 中性值, occurredAt })`；
   - 门面在自身实例内维护最近对话序列（咨询师 userText + 来访 reply 交替），作为下一轮 `recentTurns`；本期不依赖内核 `workingContext`（它只存咨询师半边字符串）。
5. 单测（`test/engine-adapters/wp7-turn-render.spec.ts`，全 mock，不起 NestJS、不发网络）覆盖 §8 清单。

### 1.2 明确不做（Out of Scope）

| 不做项 | 归属 |
|---|---|
| `streamChat` 流式聚合、SSE/WS 增量推送、语音出声、首 token 延迟/断流/abort | WP8 |
| NestJS `@Module` / DI 注册 / 全局单例 / 接 `LlmRouterService` 生产接线 | WP8 |
| openSession / closeSession 与现有 vpt 会话生命周期对齐、灰度切旧 visitor 链路 | WP8 |
| 新增语义记忆召回（每轮按议题 recall）；本期 `recall` 只透传 `openingContext` | WP2 遗留 / 后续 |
| `trajectoryNote` 取剧本节点 `referenceNotes`（trace 只带 `activeNodeId`，门面未持有剧本） | 留缝，后续 |
| 多流派话术、角色 5Ps 完整注入、人设漂移调参 | Phase2 / WP9 |
| 改动 `src/engine-core/` 任何文件（含 `in-memory-engine-session.ts`） | **禁止** |
| 改动 `src/llm/` 内部、`src/agent/visitor`、`src/voice` | 禁止 |
| 建表 / migration / entity / 落库 / 新增第三方依赖 / 改 `.env` | 本期无 |

### 1.3 与 WP6 的衔接

- 直接复用 WP6 的 `LlmRenderAdapter`（已是 `RenderPort`）；门面只依赖 `RenderPort` 接口，不 import WP6 具体类，便于替换/mock。
- WP6 预留的 `buildMessages` 缝就是本期注入系统 prompt 的位置，不要改 WP6 适配器内部。
- **WP6 已知小缺陷（建议顺手补，不阻塞本单）**：`LlmRenderAdapter` 成功路径未调 `runtime.markSuccess(candidate.id)`，导致成功后失败计数/冷却不清零。建议在 `render` 拿到 `success` outcome 处统一 `this.runtime.markSuccess(outcome.providerHint)`，并补一条**经 `adapter.render` 真实链路**的清零单测（现有④是直接调 runtime，绕开了适配器）。

---

## 2. 边界红线

- **`src/engine-core/` 整树零改动**：不新增导出、不改纯函数、不改 `turn`；`boundary.spec.ts` 不为本单更新。
- **门面与组装器零 `@nestjs/*`、零 typeorm、零网络、零 `.env` 读取**；可脱离容器 `new` 出来测。
- 不在 `RenderSpec` / 门面结果里塞厂商私有字段、模型名、温度、apiKey。
- 渲染失败只降级为非空中性话术，**绝不把高危原文或异常栈传出**；安全信号只进日志/回调。
- 不重复写咨询师半边记忆；不写内核已写过的条目。

---

## 3. RenderSpec 组装口径（`buildRenderSpec`）

输入上下文（建议形状，由门面在调用处组装）：

```ts
interface SpecAssemblyInput {
  readonly output: EngineTurnOutput;
  readonly recentTurns: readonly RenderContextTurn[]; // 门面累积的历史（旧→新）
  readonly attachmentStyle?: AttachmentStyle;        // 本期省略（门面未持有角色基线）
  readonly tokenBudget: RenderTokenBudget;
}
```

`RenderSpec` 字段映射：

| RenderSpec 字段 | 取值来源 |
|---|---|
| `taskKind` | 恒 `'chat'` |
| `intention` | `output.intention`（规则轨每轮产出；缺失时由门面构造一个中性最小意图，不抛） |
| `emotion` | `output.snapshot.emotion` |
| `resistance` | `output.snapshot.resistance` |
| `transference` | `output.snapshot.transference` |
| `trust` | `output.snapshot.trust` |
| `coreBeliefs` | `output.snapshot.coreBeliefs` |
| `attachmentStyle` | 本期省略（留可选注入缝） |
| `forbiddenBehaviors` | `intention.forbiddenBehaviors` 去重；角色层 forbidden 合并留缝（本期门面拿不到 profile） |
| `recall` | `output.openingContext ?? []`（仅 resume 首轮携带） |
| `trajectoryNote` | 本期省略（留缝） |
| `recentTurns` | `fitContextToBudget(input.recentTurns, tokenBudget.contextTokens).turns` |
| `tokenBudget` | 门面默认种子 `{ maxCompletionTokens: 160, contextTokens: 512 }`，可被构造参数覆盖 |

> 说明：`emotion/resistance/transference/trust/coreBeliefs` 都在 `output.snapshot` 上，不在 `output` 平铺；`intention` 是 `output` 独立字段。组装器不要从 `snapshot` 里取 `intention`（快照不含意图）。

---

## 4. 门面返回形状（`TurnRenderResult`）

```ts
interface TurnRenderResult {
  /** 本轮来访口语（RenderResult.text；降级时为中性兜底句）。 */
  readonly reply: string;
  /** 内核本轮快照（透传副本）。 */
  readonly snapshot: BdiSnapshot;
  readonly turnIndex: number;
  readonly intention?: Intention;
  /** 渲染元信息（供观测，不进内核）。 */
  readonly render: {
    readonly fallbackUsed: boolean;
    readonly providerHint?: string;
    readonly usage?: { completionTokens: number; totalTokens: number };
  };
  readonly trajectoryTrace?: TrajectoryTrace;
  readonly safety?: SafetyVerdict;
  readonly openingContext?: readonly MemoryHit[];
}
```

门面不修改内核 `EngineTurnOutput`，只在其外包一层 `render` 元信息与真实 `reply`。

---

## 5. 失败与降级语义

1. `session.turn` 抛内核错误（如 `ABORTED` / `INVALID_INPUT` / `SESSION_NOT_FOUND`）→ **原样冒泡**给门面调用方，门面不吞（这些是调用方参数/会话状态错误，应由 WP8 传输层处理）。
2. `renderer.render` 抛异常（理论上 WP6 已不 reject，这里是防御）→ 门面 catch，返回非空中性兜底句（复用 WP6 兜底口径：中性、不越界、不给建议），`render.fallbackUsed=true`，记 warn 日志，不写来访半边记忆。
3. 渲染成功但文本为空 → 走同 2 的降级出口。

---

## 6. 文件落点（建议）

```
src/engine-adapters/rendering/
├── spec-assembler.ts          【新】buildRenderSpec 纯函数 + 组装输入类型
└── turn-render-orchestrator.ts【新】TurnRenderOrchestrator（注入 session/renderer/memories）

test/engine-adapters/
└── wp7-turn-render.spec.ts    【新】全 mock 单测
```

> 不改 `src/engine-adapters/rendering/` 下 WP6 三文件（除 §1.3 建议的 markSuccess 小修）。

---

## 7. 配置种子值（集中、可覆盖，本期不读 env）

| 项 | 种子值 | 说明 |
|---|---|---|
| `tokenBudget.maxCompletionTokens` | 160 | 单轮完成上限，可被构造参数覆盖 |
| `tokenBudget.contextTokens` | 512 | 历史裁剪预算 |
| 来访半边记忆 importance | 0.5 | 中性，与内核工作记忆口径一致 |

种子值未标定，集中一处，WP8 接真实模型后校准。

---

## 8. 单测清单（`wp7-turn-render.spec.ts`，全 mock）

1. **规格映射**：给定带 intention/快照的 output，组装出的 `RenderSpec` 的 `intention/emotion/resistance/transference/trust/coreBeliefs` 与来源一致，`taskKind='chat'`。
2. **历史裁剪**：构造超长 `recentTurns`，断言组装后 `recentTurns` 经 `fitContextToBudget` 裁剪、不超 `contextTokens`（可直接断言内核裁剪行为被复用）。
3. **成功闭环**：stub renderer 返回固定文本 → 门面 `turn` 返回的 `reply` 等于该文本，`render.fallbackUsed/providerHint` 透传正确。
4. **成对记忆**：渲染成功后，`memories.remember` 被调用且写入的是**来访半边**（content=来访文本, tier=WORKING, source=TURN）；断言**没有**重复写咨询师半边。
5. **渲染异常不炸穿**：stub renderer reject → 门面不 reject，返回非空兜底句，`fallbackUsed=true`。
6. **内核错误冒泡**：stub session.turn 抛 `ABORTED` → 门面原样抛，不降级吞掉。
7. **system prompt 缝**：断言注入的 `buildMessages` 被用于构造消息，咨询师/来访角色映射正确（user/assistant）。
8. **零回归**：`engine-core` 既有 177 用例全绿；门面/组装器源码不出现 `@nestjs` / `typeorm` / `fetch` / `axios`。

---

## 9. 验收（Done）

- [x] 给定一段咨询师输入，门面返回非空来访口语，且不越出 `intention` 目标与 forbiddenBehaviors（由系统 prompt 约束，单测覆盖调用契约）。
- [x] 单轮 completion 受预算上限；超长历史经裁剪不超 `contextTokens`。
- [x] 渲染失败降级为非空中性句，不炸穿、不传高危原文。
- [x] 问+答成对进工作记忆，咨询师半边不重复写。
- [x] `eslint` 0 error、`tsc --noEmit` 0 error、`jest engine-adapters` 全绿、`jest engine-core` 177 零回归。
- [x] 零新增依赖、零 migration/entity、零 `.env` 改动、`engine-core`/`src/llm`/`src/agent`/`src/voice` 零改动。

## 10. 复跑闸门（Windows PowerShell，后端自跑）

```powershell
cd E:\Work\Project\backend\mofang-nestjs
npx eslint "src/**/*.ts"
npx tsc -p tsconfig.build.json --noEmit
npx jest test/engine-adapters
npx jest test/engine-core --maxWorkers=2
```

## 11. 交接给 WP8

WP7 交付的是"可独立 new 的闭环单元"；WP8 负责：NestJS DI 注册、接 `LlmRouterService` 生产 `ChatCaller`、`streamChat` 流式推送、open/close 对齐 vpt 会话、灰度切旧 visitor 链路、aborted/断流处理。WP7 不预留任何网络/流式假设。

**WP8 接线时必须补的两件事**：

1. **会话归属注入**：`TurnRenderOrchestrator` 需要 `resolveSession(handleId) => { tenantId, sessionId, visitorId }`（或单会话门面的 `sessionContext`）—— 内核会话端口没有"由句柄反查归属"的方法，归属由装配层在 `openSession` 时登记。未注入 → 门面跳过来访半边工作记忆写入并告警（对话不断流，但工作记忆只有半边）。
2. **prompt 缝接线**：把本单导出的 `buildVisitorMessages` 传给 WP6 适配器构造时的 `buildMessages` 位 —— 渲染端口只收 spec，消息怎么拼是渲染执行侧的事。

---

## 12. 交付状态

**代码已交付并自跑复跑绿**，逐条对照见交付记录
[`engine-wp7-spec-assembly-turn-reply-implementation-2026-10-28.md`](./engine-wp7-spec-assembly-turn-reply-implementation-2026-10-28.md)。

### 12.1 闸门

| 命令 | 结果 |
|---|---|
| `npx eslint "src/**/*.ts"` | exit 0，0 error |
| `npx tsc -p tsconfig.build.json --noEmit` | exit 0，0 error |
| `npx jest test/engine-adapters` | **3 套件 / 47 用例全绿**（WP2 B 层既有 13 + WP6 19 + WP7 新增 15） |
| `npx jest test/engine-core --maxWorkers=2` | **7 套件 / 177 用例全绿**（内核零回归） |

`pnpm build` 全量构建与既有业务测试本轮未跑（本期零 entity / migration / module 改动，**`src/engine-core/` 与 `src/llm/` 整树零改动**）。

### 12.2 与本单的差异（须知会）

| # | 差异 | 理由 |
|---|---|---|
| 1 | **门面零 `@nestjs/*`，日志用模块级 `console.warn`** | 任务单 §2 要求门面零 `@nestjs/*` 且必须能脱离 Nest 容器独立 new 出来跑；引 Nest Logger 等于把框架带进纯 TS 装配单元 |
| 2 | **会话归属靠注入 `resolveSession` / `sessionContext`** | 内核会话端口没有"由句柄反查归属"的方法（句柄=运行时维度，归属=业务维度，刻意分开）；解析不到 → 跳过来访半边记忆写入并告警，不抛错 |
| 3 | **降级时历史只追加"问"，不追加"答"，也不写记忆** | 兜底句是系统产物不是来访真说的话；喂回模型等于教模型输出兜底话术，写进记忆等于让召回混进不是来访说过的话 |
| 4 | **"成功"与"降级"是两个标志** | WP6 的 `fallbackUsed` 只表示"走过备用路径"，此时文本**仍是真话术**，应进历史与记忆；只有门面自身降级才是系统产物。内部用 `degraded` 区分，对外仍只暴露 `render.fallbackUsed` |
| 5 | **门面另起 `TurnRenderResult`，不修改内核 `EngineTurnOutput`** | 内核出参逐字透传，外面包一层 `render` 元信息与真实 reply；改内核出参会破坏 WP0–WP5 已发布契约 |
| 6 | **组装器是纯函数，编排是门面**（两者同文件族但职责分开） | 分开才能单独单测字段映射；将来换决策来源（模型轨 / WP9）时只换调用方，不改编排 |
| 7 | **意图缺失构造中性最小意图，情绪/阻抗/移情取自本轮快照** | 意图缺失是"这轮没决策出策略"，不是输入非法；快照里的中性基线才是这场的真实起点，写死常量等于凭空造一个与当前状态不一致的意图 |
| 8 | **历史窗口上限 = 内核 `WORKING_MEMORY_WINDOW_TURNS × 2`** | 门面历史只是给模型看的上下文，不是决策依据，不必比内核工作记忆窗口更宽；复用内核常量不另写数字 |
| 9 | **新增 `forgetSession(handleId)`** | 门面是长生命周期对象，历史必须能显式释放，否则是缓慢内存泄漏；WP8 在 `closeSession` 时调用 |
| 10 | **记忆写失败不炸穿** | 记忆写不进去是"降级"，不是"会话失败"（同 WP2 embedder 失败语义） |
| 11 | **策略/情绪 → 中文标签用穷尽 `Record`** | 内核新增枚举时 TS 编译期报错强制补齐，不会静默漏译成英文原样出现在 prompt 里 |
| 12 | **零回归第 8 条断言打在 import 面，不是全文** | 任务单原文是"源码不出现 @nestjs / typeorm / fetch / axios"；若按**全文**匹配，连"本文件不使用框架"这句注释都会被判违规。断言打在 import/require 的 specifier 上才是依赖面的真实口径，且比全文更严格 |
| 13 | **WP6 缺陷已顺手修**：适配器成功路径补 `markSuccess` + 暴露 `health()` 只读快照 + 补**经 `adapter.render` 真实链路**的清零单测 | 之前只清零了 runtime 的单测（绕开了适配器），于是"失败过一次、后来已恢复"的候选带着旧计数进冷却，比实际更早被踢出轮换 |

### 12.3 已知缺口（下一轮需决策）

1. **未接进内核 `turn` 管线，内核 `reply` 仍恒 `''`**：门面返回的 `TurnRenderResult.reply` 由调用方（WP8）取用；内核出参逐字未动。
2. **无 NestJS DI 注册 / 无生产 `ChatCaller` 接线 / 无流式**：均属 WP8。
3. **会话归属必须由装配层注入 `resolveSession`**：WP8 需在 `openSession` 时登记 handleId → 归属，否则工作记忆只有半边。
4. **prompt 模板是工程初版，未做真实模型 A/B 校准**：温度/句数上限/规则条数需按真实模型效果调（模板集中在一处，改动面小）。
5. **策略/情绪中文标签表需随内核枚举同步**：穷尽 `Record` 会在编译期强制提醒，不会漏。
6. **每轮按议题语义 recall 未做**（本期 `recall` 只透传 `openingContext`）：WP2 遗留。
7. **`trajectoryNote` 未接**（门面不持有剧本）：组装器已留注入位。
8. **角色层 `attachmentStyle` / `forbiddenBehaviors` 未注入**：WP9 角色资产池。
9. **历史只在进程内存**（重启丢）：同内核工作窗口口径。
10. **`pnpm build` 全量构建与既有业务测试本轮未跑**：建议合并前补跑。
