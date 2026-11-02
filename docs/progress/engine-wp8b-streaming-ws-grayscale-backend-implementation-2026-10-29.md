# WP8-B · 流式原生渲染（单一实现）+ 接进 voice WS + 灰度切旧 · 后端交付记录

> 任务单: [`engine-wp8b-streaming-ws-grayscale-backend-2026-10-29.md`](./engine-wp8b-streaming-ws-grayscale-backend-2026-10-29.md)（B 方案）
> 前置: WP0–WP7 / [WP8-A](./engine-wp8-di-wiring-aggregated-turn-implementation-2026-10-28.md) / [MiniMax chat provider](./llm-minimax-chat-provider-implementation-2026-10-28.md)
> 仓库: `E:\Work\Project\backend\mofang-nestjs` ｜ 日期: 2026-10-29

---

## 0. 一句话结论

**流式与聚合共用同一份渲染实现**：`LlmRenderAdapter` 一个类同时提供 `render()` 与 `streamRender()`，两者走**同一个** `runCandidateLoop` + **同一个** `RenderFailoverRuntime`（候选序列 / 冷却 / 退避 / 记账只有一份）；流式只多一个"首个非空 delta 即锁定候选"的纪律。`TurnRenderOrchestrator.turnStream` 复用决策 / 组装 / 落账的同一套闭环；voice 侧通过窄接口 `VoiceTurnBackend` + 灰度开关接入，**消费器（`consumeLlmStream` / `bargeIn` / generation / TTS 句切 / `persistTurnIfComplete`）零改动**，新引擎失败本场自动回落旧链路。

---

## 1. 实际落点

### 新增（4 个源文件 + 3 个测试文件）

| 文件 | 职责 |
|---|---|
| `src/engine-adapters/rendering/streaming-render.port.ts` | 流式渲染端口（适配层，不进内核）：`StreamingRenderPort extends RenderPort`（`streamRender` 为**可选方法**）、`StreamRenderHandlers`、`StreamRenderOutcome`、`RenderGuardVerdict` / `RenderPrecheckVerdict`；附兜底用的 `splitTextIntoDeltas` |
| `src/voice/voice-turn-backend.port.ts` | voice 侧窄接口 `VoiceTurnBackend`（`openSession` / `streamTurn` / `closeSession` / `transcript`）+ DI token `VOICE_TURN_BACKEND`；形状**贴着旧 `VisitorService`** |
| `src/engine-adapters/wiring/engine-stream-backend.adapter.ts` | 新引擎版对话后端：把 `turnStream` 的增量桥成 voice 的三态 `LlmStreamChunk`（content / done / error），并维护逐字稿副本 |
| `test/engine-adapters/wp8b-stream-render.spec.ts` | 清单 1-6（+ 共享健康状态的护栏） |
| `test/engine-adapters/wp8b-turn-stream.spec.ts` | 清单 7-8（+ 渲染器无流式时的兜底形态） |
| `test/voice/wp8b-grayscale.spec.ts` | 清单 9-12（+ 白名单 / 窄接口自证） |

### 修改（9 个源文件）

| 文件 | 改动 |
|---|---|
| `src/engine-adapters/rendering/llm-render.adapter.ts` | 抽出共享 `runCandidateLoop`（聚合与流式唯一一份候选主备循环）；新增 `streamRender` 状态机；`ChatCaller` 补**可选** `stream`；`ChatStreamOptions{providerId?,uid?,signal?}`；guard 拆**前置静态预检** + **后置全文 guard**；`classifyFailure` 统一失败归类 |
| `src/engine-adapters/rendering/turn-render-orchestrator.ts` | 新增 `turnStream(handleId, input, handlers)`（复用 `session.turn` / `assemble` / `settleTurn`）+ `streamSafely`；`deps.renderer` 放宽为 `StreamingRenderPort` |
| `src/engine-adapters/wiring/router-chat-caller.ts` | 实现 `stream` → 委托 `LlmRouterService.streamChat`（不复制注册 / 鉴权 / 回落） |
| `src/engine-adapters/wiring/engine-turn.service.ts` | 新增 `turnStream` 透传 |
| `src/engine-adapters/wiring/engine.providers.ts` | `renderer` 类型放宽为 `StreamingRenderPort` |
| `src/engine-adapters/wiring/render-config.factory.ts` | 注入 `precheck: createVisitorPrecheck()`；`buildEngineRenderPort` 返回 `StreamingRenderPort` |
| `src/engine-adapters/wiring/engine.module.ts` | `ENGINE_RENDER_PORT` 产出改为 `StreamingRenderPort`；注册 `EngineStreamBackend` + `VOICE_TURN_BACKEND`（`useExisting`）并导出 |
| `src/voice/voice.service.ts` | 持有窄接口 + 灰度开关 + 失败自动回落（**消费器零改动**） |
| `src/voice/voice.module.ts` | 导入 `EngineWiringModule`（拿 `VOICE_TURN_BACKEND`） |

### 红线核查

- `git diff --stat -- src/engine-core` → **空**（内核整树零改动，177 用例零回归）
- `src/voice/tts/**`、`src/voice/asr-token/**`、`src/voice/voice-session-bridge.ts` → **零改动**
- `src/agent/visitor/**` → **零改动**（旧链路保留，可回退）
- 前端 WS 帧协议 → **零改动**（`llm_start` / `llm_text` / `llm_done` / `tts_audio` / `cancelled` / `error` / `session_ended` 沿用）

---

## 2. 关键设计决策

### 2.1 为什么 `streamRender` 挂在**同一个类**上（而不是新写一个流式适配器）

任务单的判断是对的：另写一个流式旁路等于让**主备 / 冷却 / guard / 降级**维护两遍，必然漂移，且漂移方向恰好是"流式路径切了个聚合路径不认的候选"。落地方式是把两条路径的**差异**收敛到三个点，其余全部共用：

| 共用部分 | 落点 |
|---|---|
| 候选选择 / 冷却过滤 / 失败记账 | `RenderFailoverRuntime`（同一实例，同一份健康状态） |
| 候选主备循环（挑谁 → 试 → 换人 / 收摊） | `runCandidateLoop`（唯一一份） |
| 参数解析 / 消息构造 / 失败归类 / guard / 安全信号 / 兜底句 | `resolveParams` / `buildMessages` / `classifyFailure` / `evaluate` / `reportSignal` / `degradeOutcome` |

差异只有：① 流式把全文 guard 挪到**收尾**且只记信号；② 流式在**首个非空 delta** 处锁定候选；③ 流式不做中途 block → regen（已出声收不回）。

### 2.2 为什么"锁定候选"是流式的纪律，而不是优化

流式已出声，撤回不了。中途切备等于"来访者说了半句 A，突然改口说 B" —— 对练里那不是模型切换，那是人格分裂。所以流式的纪律是：**首 token 之后不再换人**，中途出错就承认这一轮不完整（降级 + 不落记忆），而不是硬凑一个"看起来成功"的回复。聚合路径保留"block → 同候选降温重生成一次"，因为它还没出声，撤回得起。

### 2.3 为什么 guard 拆两层，且前置预检**复用内核同一套规则**

- **前置静态预检**（首 delta 前，只看 `RenderSpec`，不调模型）：命中 block → 这一轮不开口（流式没有"说完再撤回"的选项）。
- **后置全文 guard**（流结束拿到全文后）：复用现有 `evaluate()`（注入 guard 优先 → 内核 `guardVisitorOutput` 回落 → 异常按 block），**只记 safety 信号，不 regen、不撤回**。

前置预检**不另写规则词典**，直接用内核的 `evaluateSafety(text, 'visitor_output')`（与输出侧 guard 同一份词汇表）。判的是"会驱动模型说出口的角色内容"：`coreBeliefs[].statement` + `trajectoryNote`。

> **为什么不用 `forbiddenBehaviors`**：它是**负向约束**（"你绝不会做的事"），里面出现敏感词恰恰说明"这次别碰"；拿它当风险信号，会把最该谨慎的场景判成最该拦的场景。

### 2.4 为什么 `streamRender` 是**可选方法**而不是必实现

必实现会立刻打破两处既有契约（内核 `RenderPort` 的实现者、单测里的 mock 全要跟着改），并把"能不能流式"从**运行时能力**退化成**编译期约束** —— 于是所有 stub 都要为了编译通过而写一个假流。做成可选方法后：没实现流式的渲染器 → 门面走"聚合取文 + 切段成增量"的兜底形态，既有 mock 与既有单测零回归，降级是**显式**的而不是隐式的崩溃。

### 2.5 为什么 voice 侧要有一个"窄接口"，而不是直接依赖引擎

`VoiceService` 是**成熟资产**（WS 帧协议 / TTS 句切 / barge-in / 逐字稿落库都已跑通），新引擎是**灰度期资产**。两者要并存，就必须有一个"两边都像"的契约面。若 `VoiceService` 直接依赖 `EngineTurnService`，那"关掉灰度"就得改构造签名 —— 开关会从**可回退**退化成**不可回退**。

窄接口的形状**贴着旧 `VisitorService`**（`openSession` / `streamTurn` / `closeSession` / `transcript`），所以旧实现**结构化直接满足**（编译期自证已写进 `wp8b-grayscale.spec.ts` 的用例 B），新实现只需把引擎语义翻译成同一组三态 chunk —— **翻译点只有一处**（`EngineStreamBackend`）。

### 2.6 为什么回落必须是**透明**的（帧序列与旧链路逐帧一致）

灰度开关是**回退保险**：出问题时把开关一关，必须立刻回到"和改动前一模一样"。所以：

- **开关关**：`voice.service` 根本不会碰引擎后端（旧 `VisitorService` 直接当后端用）→ 帧序列与现状逐帧一致。
- **新引擎失败**：在**首个增量之前**失败 → 透明切回旧链路（流的层面换源，消费器看到的仍是一条普通三态流）→ 帧序列与旧链路逐帧一致。
- **已出声之后**失败 → 不透明回落（已出声不可撤回）→ 发 `error` 帧 + 本场后续轮次回旧链路。

---

## 3. 流式状态机（落地口径）

```
streamRender(spec, handlers)
 ├─ 0. buildMessages 为空 → 直接降级 (degraded)
 ├─ 1. 前置静态预检 (只基于 RenderSpec, 不调模型)
 │      block → 不建流, 直接降级
 ├─ 2. 调用出口无 stream 能力 → 回退"聚合取文 + 切段成增量"
 └─ 3. runCandidateLoop (共享核心)
        每个候选:
          3.1 建流 + 取首个非空 delta
                鉴权失败 → 不切备, 直接降级 (坏 key 对所有候选都坏)
                可重试错 / 超时 → markFailure, 切下一个候选
                空流 (首 delta 前无内容) → markFailure, 切下一个候选
          3.2 锁定: 首个非空 delta 到达 → markSuccess + 锁定候选 (此后不切备)
                → handlers.onDelta(delta)
          3.3 边吐边累计 (delta 依次 onDelta; 累计全文; 末条 tokenCount)
                中途错误 / abort → 不切备, 收尾降级
          3.4 收尾: 后置全文 guard (只记信号) → 归约 usage → 返回
```

**usage 口径**：流式只有累计 `tokenCount`（无 prompt/completion 拆分）→ `completionTokens` 与 `totalTokens` **同源取末条**，不编造拆分。

**降级结果**：`{ text: 兜底句, fallbackUsed: true, providerHint: 'degraded', degraded: true }`。`degraded=true` 的语义是"这不是来访者完整说出来的真话"，上层据此**不写**来访半边工作记忆。

---

## 4. 门面流式出口

`TurnRenderOrchestrator.turnStream(handleId, input, handlers)` 与 `turn()` **共用**私有方法：

| 步骤 | 聚合 `turn()` | 流式 `turnStream()` |
|---|---|---|
| ① 内核决策 | `session.turn` | `session.turn`（同一入口，错误同样原样冒泡） |
| ② 组装规格 | `assemble(output, [...history, 咨询师本轮])` | 同 |
| ③ 取文 | `renderer.render` | `renderer.streamRender`（缺流式 → 聚合 + 切段兜底） |
| ④ 落账 | `settleTurn` | `settleTurn`（**同一份**） |
| ⑤ 组装返回 | `TurnRenderResult` | 同构 `TurnRenderResult` |

**降级语义**：成功 → 追加"问 + 答"并写来访半边工作记忆；降级 → 只追加咨询师半边、**不写**记忆。

---

## 5. voice 灰度接入

### 开关

| env 键 | 含义 | 缺省 |
|---|---|---|
| `ENGINE_VOICE_ENABLED` | 新引擎接管语音链路（总开关） | `false`（旧链路 100% 原样） |
| `ENGINE_STREAM_GRAYSCALE_SESSIONS` | 灰度会话白名单（逗号分隔）；空 = 总开关打开即全量 | 空 |

读取口径：`ENGINE_VOICE_ENABLED` 只有明确为真（`1/true/yes/on`）才算真 —— 字符串 `'false'` 在 JS 里是 truthy，那是"把关了读成开了"的经典事故。

### 回落矩阵

| 失败点 | 行为 | 客户端可见 |
|---|---|---|
| 开场（`openSession`）失败 | 本场回旧链路 | 帧序列与旧链路**逐帧一致** |
| 建流（`streamTurn`）抛错 | 本场回旧链路 | 帧序列与旧链路**逐帧一致** |
| 首个增量**前**失败（error chunk / 异常） | 透明切回旧链路 | 帧序列与旧链路**逐帧一致** |
| 首个增量**后**失败 / abort | 不切备；发 `error` 帧；本场后续轮次回旧链路 | `error` 帧（已出声不可撤回） |
| 旧链路补开失败（回落不了） | 维持新链路 + 告警 | 新链路原样 |

### 消费器零改动

`consumeLlmStream` / `bargeIn` / generation 防旧流 / TTS 句切 / `persistTurnIfComplete` **一行未动**。透明回落是在**流的层面**完成的（`guardEngineStream` 守卫生成器），消费器看到的仍是一条普通三态流。

---

## 6. 闸门结果（自跑，Windows PowerShell）

```
npx tsc -p tsconfig.build.json --noEmit        → 0 错
npm run lint (npx eslint "src/**/*.ts")        → 0 error 0 warning
npx jest test/engine-adapters/wp8b-stream-render.spec.ts
        test/engine-adapters/wp8b-turn-stream.spec.ts
        test/voice/wp8b-grayscale.spec.ts        → 3 套件 / 37 用例全绿
npx jest test/engine-core test/engine-adapters test/voice --maxWorkers=2
                                             → 16 套件 / 370 用例全绿
```

分组口径：`test/engine-core` 7 套件 177 用例（**零回归**）／`test/engine-adapters` 6 套件 105 用例（新增 24）／`test/voice` 3 套件 88 用例（新增 13）；三个新套件合计 37 用例。

---

## 7. 真实上游联调（MiniMax）

单测证明"状态机语义正确"，但证明不了"厂商真的按增量吐字、`AbortSignal` 真的能掐断 SSE"。为此跑了一次**一次性联调脚本**（`test/wp8b-live-check.ts`，不进 jest、跑完即删）：只启 `LlmModule`（零 DB），走真实 `RouterChatCaller.stream → router.streamChat → MiniMax SSE → LlmRenderAdapter.streamRender`。

```
[live] provider=minimax model=MiniMax-M3.1-Flash
[live] + 5824ms delta="还行"
[live] + 5902ms delta="，就是最近想"
[live] + 5903ms delta="得"
[live] + 5904ms delta="有点多"
[live] + 5919ms delta="，晚上容易醒，白天"
[live] + 5977ms delta="就"
[live] + 5980ms delta="犯困。"
[live] turn1 deltas=7 ttft_ms=5824 total_ms=6184 usage={"completionTokens":329,"totalTokens":329} provider=minimax degraded=false
[live] turn1 text="还行，就是最近想得有点多，晚上容易醒，白天就犯困。"
[live] check1 增量到达 = PASS
[live] turn2 abort后收到 delta 数=1 degraded=true provider=degraded text="……我先缓一下, 我们接着说。"
[live] check2 barge-in 断流 = PASS
```

- **增量到达**：7 段增量、ttft 5824ms / 总耗时 6184ms → 上游确实是**逐段吐字**，不是整段一次到达。
- **barge-in 断流**：首个 delta 后立刻 `abort()` → 只收到 1 段增量，流被真断（`degraded=true`）。

---

## 8. 与任务单的显式差异

| # | 任务单口径 | 实际落地 | 原因 |
|---|---|---|---|
| 1 | 适配器放 `src/engine-adapters/rendering/engine-stream-backend.adapter.ts` | 放 `src/engine-adapters/wiring/` | 它依赖 wiring 层的 `EngineTurnService`，放 rendering 会造成 **rendering → wiring → rendering 目录环**；且"把一个子系统的形状翻译成另一个子系统的形状"本就是 wiring 层的定义 |
| 2 | 前置预检依据 `intention / forbiddenBehaviors / 危机等级` | 依据 `coreBeliefs[].statement` + `trajectoryNote`，规则用**内核同一套** `evaluateSafety(side='visitor_output')` | `RenderSpec` **没有**安全/危机字段（内核零改动是红线）；`forbiddenBehaviors` 是负向约束，含敏感词恰恰说明"别碰"，拿它当风险信号会误伤最该谨慎的场景 |
| 3 | 流式降级 `providerHint` 只规定了"全挂"口径 | **所有降级统一** `providerHint='degraded'`，候选 id 落日志 | 一个降级结果一个口径；"哪个候选出的"是日志/指标问题，不是结果契约问题 |
| 4 | （未规定）聚合 vs 流式的降级落账差异 | 聚合路径的兜底句**仍会被写进**来访半边记忆（WP7 既有行为，未动）；流式路径按任务单要求 degraded → **不写** | 两边语义不同：聚合路径无法区分"兜底句"与"真话"（WP7 既有行为，零回归优先）；流式路径拿得到 `degraded` 标记。单测已分别钉死 |
| 5 | "流式异常 → 本场回旧链路" | 细分为"首个增量**前** → 透明回落（帧逐帧一致）"与"已出声 → `error` 帧 + 后续轮回落" | 已出声不可撤回；透明回落才能满足"发与旧链路一致的帧" |
| 6 | （未规定）voice 侧模块依赖 | `VoiceModule` 导入 `EngineWiringModule` | Nest DI 模块作用域内取 provider 必须 import；依赖方向仍是单向 voice → engine-adapters（引擎不认识语音协议） |
| 7 | （未规定）兜底切段口径 | `splitTextIntoDeltas`（句末标点 + 24 字硬切） | **故意不复用** TTS 切句器：TTS 切句是**出声协议**口径（与上游攒句逐字对齐，切早会让那句永不合成），这里是**字幕**口径；混用会把上游协议风险带进字幕层 |
| 8 | `ChatCaller.stream` 的 `uid` | 适配器支持 `deps.uid` 透传，默认不配 | `RenderSpec` 里没有 uid 概念；留字段是为了装配层将来能接计费/审计口径 |

---

## 9. 遗留缺口（交接 WP9 / 后续轮）

1. **角色剧本注入归 WP9**：引擎侧开场是**中性基线**（`EngineStreamBackend` 返回中性 persona 快照，不塞 `characterProfile` / `trajectory`）。
2. **逐字稿与 counselor 桥字段对齐**：新引擎后端自己维护 `TranscriptTurn[]`（只记**完整跑完**的轮次），尚未与 counselor 侧的 `bridges.appendTurn/close` 字段做逐项对齐。
3. **前置实时风险探测**（`RiskProbePort`）未接：本期前置只做静态最小集；`RiskProbePort` 仍只在输出侧可选接入。
4. **聚合路径的兜底句落账语义**未统一（见 §8 #4）：若要统一，应改 `TurnRenderOrchestrator.renderSafely` 依据 `providerHint==='degraded'` 判降级 —— 但那会动 WP7 既有行为与用例，本期不做。
5. **WS 端到端联调**（真 WS 握手 + 真 TTS 句级音频）未在本轮跑：需要 JWT、DB persona、真 TTS 上游三件外部依赖；本轮以"真实上游流式 + 帧序列断言"覆盖了协议层与状态机层。
6. **默认 provider 仍是 deepseek 占位**：`ENGINE_RENDER_PRIMARY_PROVIDER=minimax` 需在部署 env 里显式配置（`.env` 已在本地配好，入库不入 git）。

---

## 10. 如何验证（复跑命令）

```powershell
cd E:\Work\Project\backend\mofang-nestjs
npx tsc -p tsconfig.build.json --noEmit
npm run lint
npx jest test/engine-adapters/wp8b-stream-render.spec.ts test/engine-adapters/wp8b-turn-stream.spec.ts test/voice/wp8b-grayscale.spec.ts
npx jest test/engine-core test/engine-adapters test/voice --maxWorkers=2
git diff --stat -- src/engine-core     # 必须为空
```

联调（真实上游，需 `.env` 里有 `MINIMAX_API_KEY` / `MINIMAX_LLM_MODEL`）：临时脚本已随交付删除，需要时可按本记录 §7 的日志格式重建一次性脚本。
