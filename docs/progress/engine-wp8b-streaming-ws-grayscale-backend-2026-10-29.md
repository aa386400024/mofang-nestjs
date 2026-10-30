# WP8-B · 流式原生渲染（单一实现）+ 接入 voice WS/vpt + 灰度切旧 · 后端任务单（B 方案）

> 母版: [`../architecture/ai-engine-roadmap-v1.1.md`](../architecture/ai-engine-roadmap-v1.1.md)
> 前置（均已交付复跑绿）: WP0–WP7 / WP8-A 聚合装配 [`engine-wp8-di-wiring-aggregated-turn-backend-2026-10-28.md`](./engine-wp8-di-wiring-aggregated-turn-backend-2026-10-28.md) / MiniMax chat provider [`llm-minimax-chat-provider-backend-2026-10-28.md`](./llm-minimax-chat-provider-backend-2026-10-28.md)
> 仓库: `E:\Work\Project\backend\mofang-nestjs` ｜ 日期: 2026-10-29
> 决策: **B · 流式原生渲染、单一实现**（已否决"A 适配层另写流式旁路双实现"）
> 闸门由大炮在 Windows PowerShell 复跑 `tsc` / `eslint` / `jest`，后端勿代跑 flutter/dart。

---

## 0. 一句话目标

把 WP8-A 的聚合闭环改造成**流式原生的单一渲染实现**：同一个候选轮换/主备冷却/降级核心，既能聚合取文（调试端点），也能真增量吐字（voice）；再用一个可一键回退的灰度开关把它接进成熟 voice WS 链路，实现增量 `llm_text` + TTS 句合成 + barge-in 断流，**不长出第二套渲染、不复制闭环、engine-core 零改动**。

> 为什么不是"另写一个流式版适配器"：那会让主备/冷却/guard/降级维护两遍、必然漂移，且流式中途 block 已出声无法撤回。流式只是同一段渲染的**交付形态**，不是第二条平行管线。

---

## 1. 架构核心（先读懂再动手）

### 1.1 现状事实（开工先 Read 对齐）

- 内核 `RenderPort.render(spec): Promise<RenderResult>`（`src/engine-core/domain/ports/render-port.ts:37`），`RenderSpec` 纯数据、`RenderResult{text, taskKind, usage, fallbackUsed, providerHint?}`；**内核自身不调用 RenderPort，只由适配层持有**。
- 聚合渲染器 `src/engine-adapters/rendering/llm-render.adapter.ts`：`render()`（:168）主备循环 → `attempt()`（:236）→ `callOnce()`（:323，withTimeout + markFailure + isAuthFailure 鉴权失败不切备）→ `handleText()`（:262，全文 guard，block 走 `regenerate()` :295 同候选降温重生成一次）→ `degrade()`（:422 兜底句）；候选健康来自 `RenderFailoverRuntime`（next/markSuccess/markFailure/cooldown）。
- 门面 `turn-render-orchestrator.ts`：`turn()`（:204）= ①`session.turn` 内核决策 → ②`assemble` 出 RenderSpec → ③`renderer.render` → ④`settleTurn`（:302 历史+来访半边工作记忆落账）→ ⑤组装 `TurnRenderResult`。决策/组装/落账与取文方式无关。
- router 已有成熟流式：`LlmRouterService.streamChat(req,{providerId,uid,signal})`（`src/llm/registry/llm-router.service.ts:98`）→ AsyncIterable\<ChatCompletionChunk\>（`{delta, tokenCount(累计), isFinal, finishReason, model?}`），AbortSignal 透传。注意 chunk **只有累计 tokenCount，无 prompt/completion 拆分**。
- voice 消费器成熟且与生成器解耦：`consumeLlmStream`（`src/voice/voice.service.ts:720`）只认三态 `LlmStreamChunk`：`content{content}`→`llm_text`+`ttsHandle.sendText`；`done{usage}`→`llm_done`+`finish`；`error{error{code,message,retryable}}`→`error`+`cancel`。`bargeIn`（:771）递增 generation + `llmAbort.abort()` + TTS cancel/dispose；每 chunk 做 generation mismatch 检查。

### 1.2 B 方案落法（单一实现）

**(a) 共享候选健康核心，不复制主备逻辑。** 复用 WP6 的 `RenderFailoverRuntime`（候选序列/冷却/失败记账/鉴权失败不切备/超时）。聚合与流式只在"拿到内容后怎么处置"不同，候选选择与健康状态是同一份。

**(b) 渲染器两种消费模式，同一类 `LlmRenderAdapter`：**
- `render(spec): Promise<RenderResult>` —— **保留现有聚合行为**（全文 guard、block→同候选降温 regen、可切备、可降级），供 WP8-A 调试端点与非流式调用。
- 新增 `streamRender(spec, handlers): Promise<StreamRenderOutcome>` —— 流式原生（状态机见 §2）。

**(c) 流式端口定义在适配层，不进 engine-core。** 新增 `StreamingRenderPort extends RenderPort`（放 `src/engine-adapters/rendering/`），`streamRender` 为**可选方法**；门面 deps 的 renderer 类型放宽为该窄面，**未实现 streamRender 时回退"聚合收集成流"**，保证现有 mock/旧实现不破、`test/engine-core` 与既有适配器单测零回归。

**(d) ChatCaller 窄面补可选 stream。** 在现有 `chat(req, providerId?)` 之外补 `stream(req, opts?:{providerId?,uid?,signal?}): AsyncIterable<ChatCompletionChunk>`，生产 `RouterChatCaller` 委托 `LlmRouterService.streamChat`；未提供 stream 的 caller（如测试 stub）走聚合兜底。**不复制注册/鉴权/回落。**

---

## 2. 流式状态机（streamRender，写死语义）

一个候选的尝试分四阶段，候选选择与健康记账复用现有 runtime：

1. **候选选择窗口（首 delta 前）**：`next()` 取候选 → 建立流。
   - 鉴权失败（isAuthFailure，401/403/坏 key 文案）→ **不切备**，直接进入降级（坏 key 对所有候选都坏，逐个试只放大延迟，沿用 WP6 M7）。
   - 可重试错误 / 超时 / 空流（首个 delta 前无内容）→ `markFailure`，`next()` 切下一候选。
2. **锁定**：首个非空 delta 到达 → `markSuccess`、**锁定该候选（此后不再切备，已出声无法撤回）**，`handlers.onDelta(delta)` 转发。
3. **边吐边累计**：后续 delta 依次 `onDelta` 并累计文本；此阶段错误 / abort → **不再切备**，收尾走降级兜底。
4. **收尾**：
   - 正常结束（isFinal/流耗尽）→ 累计全文 → 跑**后置全文 guard**（见 §3）→ 归约 usage（completionTokens 取末条 `tokenCount`，totalTokens 同源；流式无 prompt 拆分，不编造）→ 返回 `{text, fallbackUsed, providerHint, usage, guardVerdict}`。
   - 全候选失败 / 无流 / 全挂 → `degrade()` 兜底句（`fallbackUsed=true, providerHint='degraded'`），**仍正常返回收尾结果**（让上层能发 `done`，TTS 不悬挂），绝不 reject。

> 关键约束：**流式路径不做"中途 block → regen/切备"**（已播内容收不回）。这是它与聚合 render 的本质差别，也是单一实现下两种消费模式的合理分工。

---

## 3. guard 拆两层（解决"流式已吐才判 block"的脏语义）

| 层 | 时机 | 做什么 | 命中后 |
|---|---|---|---|
| **前置预检** | 首 delta 前、建流时 | 仅基于 `RenderSpec` 的静态规则（intention / forbiddenBehaviors / 危机等级），**不调模型**；本期做最小明确规则集（明显自伤/违禁直说直接降级） | 不启用该候选 / 直接降级，不发声 |
| **后置全文 guard** | 流结束拿到全文后 | 复用现有 `evaluate()`（注入 guard 优先 → 内核 `guardVisitorOutput` 回落 → 异常按 block） | **只记 safety 信号 + 落账标记，不 regen、不撤回已播内容**；warn 仅观测不改写（沿用 WP6 口径） |

完整的前置风险探测（RiskProbePort 实时分析）归后续轮，本期前置只做静态最小集，不得因此阻塞主路径。

---

## 4. 门面流式出口（不复制闭环）

`TurnRenderOrchestrator` 新增 `turnStream(handleId, input, { onDelta, signal })`：

- **复用** `session.turn` 内核决策、`buildRenderSpec` 组装、`settleTurn` 落账（与 `turn()` 共用私有方法，不复制历史/记忆逻辑）；
- 调 `renderer.streamRender`，把 delta 经 `onDelta` 转发；缺 streamRender 时内部用 `render()` 聚合后按字符/句切成 onDelta（兜底形态，不作为主路径）；
- 收尾 `settleTurn`：成功才追加"问+答"并写来访半边工作记忆；降级只追加咨询师半边、不写记忆（与现有降级语义一致）；
- 返回与 `TurnRenderResult` 同构的元信息（reply/snapshot/turnIndex/intention/render/trajectoryTrace/safety）。

---

## 5. voice 接入（灰度防腐层，保留；消费器零改动）

- 在适配层定义与旧 `VisitorService` 同构窄接口 `VoiceTurnBackend`（先 Read `visitor.service.ts` 的 `openSession/streamTurn/closeSession/transcript` 签名对齐形状，**不改旧类**）：

```ts
interface VoiceTurnBackend {
  openSession(opts:{sessionId;tenantId;userId;personaId?;preset?;traceId?}): Promise<VoiceSessionPersona>;
  streamTurn(opts:{sessionId;tenantId;userId;userText;traceId?;signal?}): Promise<{ stream: LlmStream }>;
  closeSession(sessionId): { finalTurnCount:number; finalMessageCount:number };
  transcript(sessionId): readonly TranscriptTurn[];
}
```

- 新引擎适配实现持有 `EngineTurnService`/门面 `turnStream`：open→内核 `openSession`（**本期中性基线/最小 seed，不塞剧本**，角色注入归 WP9）；streamTurn→把 streamRender 的 delta 翻译成三态 `LlmStreamChunk`（content/done/error）；close/transcript 适配供 `persistTurnIfComplete` 与收尾。
- `VoiceService` 持有该窄接口，按灰度开关在旧 `VisitorService` 与新适配间选择；**`consumeLlmStream`/`bargeIn`/generation 防旧流/TTS 句切/`persistTurnIfComplete` 全部零改动**。
- **失败自动回落**：新引擎 open 失败 / 未注册候选 / 流式异常 → 本场回旧链路，发与旧链路一致的帧，不 500、不关 WS。

---

## 6. 明确不做（Out of Scope）

| 不做项 | 归属 |
|---|---|
| 5Ps 角色/剧本真实注入、preset/templateId/skillCode→characterProfile 完整映射 | WP9 角色资产池（本期中性基线） |
| 修改内核决策纯函数、`session.turn`、BDI/记忆；`engine-core` 整树零改动 | 禁止（177 用例零回归） |
| 新增/改动前端 WS 帧协议（llm_start/llm_text/llm_done/tts_audio/cancelled/error/session_ended 沿用） | 本期不做 |
| 前置实时 RiskProbe 探测、流式中途 block 撤回/regen | 后续轮（语义上也不可撤回） |
| BDI/长时记忆 MySQL·Qdrant 落库标定、冲突标记原地写、计费入库/看板/限流 | 后续运营轮 |
| 删除/替换旧 `agent/visitor` 直出链路 | 禁止（本期并存、可回退） |
| 改动 TTS bidi 池、句切算法、ASR、握手、voice-session-bridge | 禁止（成熟资产） |
| MiniMax embedding、静态 tier 表分档 | 后续轮 |

---

## 7. 目录落点（建议，按仓库惯例微调）

```
src/engine-adapters/rendering/
├── streaming-render.port.ts        【新】StreamingRenderPort extends RenderPort（适配层，不进 engine-core）
├── llm-render.adapter.ts           【改】抽出共享候选健康核心；新增 streamRender；render() 复用核心
├── turn-render-orchestrator.ts     【改】新增 turnStream，复用决策/组装/settleTurn
└── engine-stream-backend.adapter.ts【新】实现 VoiceTurnBackend，桥接门面 turnStream ↔ voice 窄接口

src/llm/
└── common/.../chat-caller 窄面       【改】补可选 stream（RouterChatCaller 委托 router.streamChat）

src/voice/
├── voice-turn-backend.port.ts      【新】新旧同构窄接口（不动旧类）
└── voice.service.ts                【改】持有窄接口 + 灰度选择（最小改动，不动消费器）

test/engine-adapters/wp8b-stream-render.spec.ts   【新】流式状态机/主备/锁定/降级/guard 两层
test/engine-adapters/wp8b-turn-stream.spec.ts   【新】门面 turnStream 复用闭环/落账/兜底
test/voice/wp8b-grayscale.spec.ts                【新】灰度选择/回落/barge-in/超时
```

---

## 8. 配置面（env → ConfigService，全部可选）

| env 键 | 含义 | 缺省 |
|---|---|---|
| `ENGINE_VOICE_ENABLED` | 新引擎是否接入 voice（总开关） | `false`（默认旧链路，安全可回退） |
| `ENGINE_RENDER_PRIMARY_PROVIDER` | 流式主候选 providerId | 已配 `minimax` |
| `ENGINE_RENDER_FALLBACK_PROVIDERS` | 备候选逗号分隔 | 空 |
| `ENGINE_RENDER_TIMEOUT_MS` | 单轮流式首 token/整体超时 | 30000 |
| `ENGINE_RENDER_FAILURE_THRESHOLD` / `COOLDOWN_*` | 主备冷却（复用 WP6） | WP6 种子 |
| `ENGINE_STREAM_GRAYSCALE_SESSIONS` | 灰度会话白名单（可选） | 空 |

新链路**显式传候选 providerId**，不依赖不可用的默认 deepseek；模型名 env 优先（`MINIMAX_LLM_MODEL`）。

---

## 9. 异常与边界语义

- **首 delta 前**：鉴权失败→直接降级不切备；可重试错/超时/空流→markFailure 切备；全挂→兜底句并正常收尾 done。
- **首 delta 后（已锁定）**：中途错误/abort→不切备，收尾降级；迟到 chunk 被 generation 检查丢弃（复用现有）。
- **barge-in/暂停**：`llmAbort.abort()` 真断流、TTS cancel/dispose，复用现有 `cancelled/paused` 帧，不新增帧。
- **超时**：到点 abort，发 error(retryable 按上游) 或降级，状态回 idle，不卡 processing。
- **后置 guard block**：记 safety 信号/落账标记，不撤回、不 regen；warn 仅观测。
- **开关关 / 名单外**：100% 旧链路，逐帧零差异。

---

## 10. 单测清单（全 mock，不连真实上游/TTS/网络）

**`test/engine-adapters/wp8b-stream-render.spec.ts`**
1. 首 delta 前主候选可重试错 → markFailure → 切备成功；鉴权失败 → 不切备直接降级。
2. 首个非空 delta → markSuccess 锁定；锁定后中途错误 → 不切备、收尾降级。
3. delta 顺序原样 onDelta 转发且累计全文正确；usage 从末条 tokenCount 归约，不编造 promptTokens。
4. 全候选失败 → 兜底句 `fallbackUsed=true/providerHint='degraded'`，仍返回可收尾结果，不 reject。
5. 前置静态预检命中 → 不建流/直接降级；后置 guard block → 只记信号，不改写/撤回已吐文本。
6. caller 无 stream 能力 → 回退聚合收集，不抛错。

**`test/engine-adapters/wp8b-turn-stream.spec.ts`**
7. turnStream 先 session.turn 决策再取文；成功收尾追加问+答并写来访半边记忆；降级只追加咨询师半边、不写记忆。
8. turnStream 与 turn() 共用同一历史/记忆，无双份写入。

**`test/voice/wp8b-grayscale.spec.ts`**
9. 开关关 → 选旧 VisitorService，调用形态与现状一致。
10. 开关开且健康 → 选新适配，delta 经 consumeLlmStream 产出 llm_text/llm_done。
11. 新引擎 open/流式抛错 → 本场回落旧链路，不冒泡、不关 WS。
12. barge-in：abort 被调、generation 递增、迟到 chunk 不喂 TTS；超时回 idle 不悬挂。

---

## 11. 验收（Done 的可观察标准）

- `npx tsc -p tsconfig.build.json --noEmit` 0 错；`eslint` 0 error；新增套件全绿，`test/engine-core`、`test/engine-adapters`（含 wp6/wp7/wp8）、`test/voice` 既有套件零回归。
- **开关关**：旧链路帧序列与现状逐帧一致（回归基线）。
- **开关开（联调配好 MiniMax）**：`user_text` → `llm_start` → 多个增量 `llm_text`（非整段一次到达，记 ttft_ms 日志）→ `llm_done`；voice 模式 TTS 句级 `tts_audio` 正常；barge-in 立即断流无迟到音频；`persistTurnIfComplete` 只记完整轮。
- 新引擎失败本场自动回落旧链路，WS 不中断。
- `git status`：`engine-core`、`voice/tts`、ASR、bridge 零改动；旧 `agent/visitor` 无删除/破坏；渲染主备/冷却只存在一份实现。

---

## 12. 闸门命令（大炮在 Windows PowerShell 复跑）

```powershell
cd E:\Work\Project\backend\mofang-nestjs
npx tsc -p tsconfig.build.json --noEmit
npm run lint
npx jest test/engine-adapters/wp8b-stream-render.spec.ts test/engine-adapters/wp8b-turn-stream.spec.ts test/voice/wp8b-grayscale.spec.ts
npx jest test/engine-core test/engine-adapters test/voice --maxWorkers=2
```

---

## 13. 交接给 WP9（本单不做）

1. 角色资产池：`templateId/skillCode/preset` → 内核 `characterProfile`/`seed`，替换中性基线，实现 5Ps 开场与难度/防御/情绪基线。
2. 新引擎逐字稿/报告与 counselor 桥（`bridges.appendTurn/close`）字段对齐。
3. 灰度转全量、旧链路下线、默认 provider 修正（消除 deepseek 占位）、前置实时风险探测。

---

## 14. 交付状态

**已交付**（2026-10-29）。交付记录：[`engine-wp8b-streaming-ws-grayscale-backend-implementation-2026-10-29.md`](./engine-wp8b-streaming-ws-grayscale-backend-implementation-2026-10-29.md)。

### 闸门结果（自跑）

| 闸门 | 结果 |
|---|---|
| `npx tsc -p tsconfig.build.json --noEmit` | 0 错 |
| `npx eslint "src/**/*.ts"` | 0 error 0 warning |
| `npx jest`（本单三个新套件） | 3 套件 / 37 用例全绿 |
| `npx jest test/engine-core test/engine-adapters test/voice --maxWorkers=2` | 16 套件 / 370 用例全绿（engine-core 177 用例零回归） |
| `git diff --stat -- src/engine-core` | **空**（内核整树零改动） |

分组：`engine-core` 7/177（零回归）｜`engine-adapters` 6/105（新增 24）｜`voice` 3/88（新增 13）。

### 实际目录落点（与 §7 的差异）

| 本单建议 | 实际 | 原因 |
|---|---|---|
| `src/engine-adapters/rendering/engine-stream-backend.adapter.ts` | `src/engine-adapters/wiring/engine-stream-backend.adapter.ts` | 它依赖 wiring 层的 `EngineTurnService`；放 rendering 会造成 rendering → wiring → rendering **目录环**，且"跨子系统形状翻译"本属 wiring 层职责 |
| （未列） | `src/engine-adapters/rendering/streaming-render.port.ts` | 流式端口（适配层，不进内核） |
| （未列） | `src/voice/voice-turn-backend.port.ts` | 新旧同构窄接口 + DI token |
| （未列） | `src/voice/voice.module.ts` 导入 `EngineWiringModule` | Nest DI 模块作用域内取 provider 必须 import；依赖方向仍单向 voice → engine-adapters |

### 与本单显式差异（八处）

1. **前置静态预检的数据来源**：本单写"intention / forbiddenBehaviors / 危机等级"，但 `RenderSpec` **没有**安全/危机字段（内核零改动是红线），且 `forbiddenBehaviors` 是**负向约束**（含敏感词恰恰说明"别碰"）。实际口径 = 用**内核同一套** `evaluateSafety(side='visitor_output')` 规则判"会驱动模型说出口的角色内容"（`coreBeliefs[].statement` + `trajectoryNote`），**零新规则词典**。
2. **流式降级的 `providerHint`**：本单只规定了"全挂"口径；实际**所有降级统一** `providerHint='degraded'`，候选 id 落日志。
3. **聚合 vs 流式的降级落账差异**：聚合路径的兜底句**仍会被写进**来访半边记忆（WP7 既有行为，未动、零回归优先）；流式路径按本单要求 degraded → **不写**。两条路径语义不同，单测分别钉死。
4. **回落的粒度**：细分为"首个增量**前**失败 → **透明**切回旧链路（帧序列与旧链路逐帧一致）"与"已出声之后 → 发 `error` 帧 + 本场后续轮回落"。已出声不可撤回。
5. **`voice.module.ts` 新增模块依赖**（见上表）。
6. **兜底切段口径**：`splitTextIntoDeltas`（句末标点 + 24 字硬切），**故意不复用** TTS 切句器 —— 那是**出声协议**口径（切早会让那句永不合成），这里是**字幕**口径。
7. **`ChatCaller.stream` 的 `uid`**：适配器支持 `deps.uid` 透传，默认不配（`RenderSpec` 无 uid 概念）。
8. **流式 usage 口径**（与本单一致，此处仅确认）：`completionTokens` 与 `totalTokens` **同源取末条** `tokenCount`，不编造 prompt/completion 拆分。

### 灰度验证

- **开关关**：`voice.service` 根本不会碰引擎后端 → 帧序列与现状**逐帧一致**（`wp8b-grayscale.spec.ts` 用例逐帧断言 `llm_start / llm_text×N / llm_done`）。
- **开关开**：增量 `llm_text`（真实上游实测 7 段增量，ttft 5824ms / 总 6184ms）、voice 模式增量文本喂 TTS（`ttsHandle.sent` 断言）、barge-in 真断流（`signal.aborted=true` + 迟到 chunk **不**喂 TTS）。
- **真实上游联调**（一次性脚本，跑完即删）：`RouterChatCaller.stream → router.streamChat → MiniMax SSE → LlmRenderAdapter.streamRender` 全链路通；`check1 增量到达 = PASS` / `check2 barge-in 断流 = PASS`。
- **失败自动回落**：开场失败 / 建流失败 / 首个增量前失败 → 本场回旧链路，帧序列与旧链路逐帧一致，不 500、不关 WS。

### 遗留缺口（交接 WP9 / 后续轮）

角色剧本与 5Ps 注入（本期中性基线）｜新引擎逐字稿与 counselor 桥字段对齐｜前置实时 `RiskProbePort` 探测｜聚合路径兜底句落账语义统一（会动 WP7 既有行为）｜WS 端到端联调（需 JWT + DB persona + 真 TTS 三件外部依赖）｜默认 provider 的 deepseek 占位需在部署 env 显式改 `minimax`。
