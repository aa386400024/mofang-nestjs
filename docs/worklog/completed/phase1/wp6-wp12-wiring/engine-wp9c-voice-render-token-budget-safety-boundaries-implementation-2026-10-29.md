# WP9-C · 引擎语音渲染路径 token 预算校准 + 安全边界 · 后端交付记录

> 任务单: [`engine-wp9c-voice-render-token-budget-safety-boundaries-2026-10-29.md`](./engine-wp9c-voice-render-token-budget-safety-boundaries-2026-10-29.md)
> 前置: WP0–WP7 / [WP8-A](./engine-wp8-di-wiring-aggregated-turn-implementation-2026-10-28.md) / [WP8-B](./engine-wp8b-streaming-ws-grayscale-backend-implementation-2026-10-29.md) / [WP9-A](./engine-wp9a-character-profile-seed-injection-implementation-2026-10-29.md) / [WP9-B](./engine-wp9b-db-character-pool-backend-implementation-2026-10-29.md)
> 仓库: `E:\Work\Project\backend\mofang-nestjs` ｜ 日期: 2026-10-29

---

## 0. 一句话结论

**任务单 §2 的六小节全部落地，且顺手拆掉了一颗此前从未被观测到的雷**：LangChain 1.6.2 写的是 snake_case `finish_reason`，而本仓 provider 原来只读 camel `finishReason` → **每一次调用的 `finishReason` 恒为 `'stop'`**，截断信号（`length`）**从来收不到**。这意味着"半句喂 TTS"这条缺陷**在修好之前，连防护的触发条件都不成立**。本轮补了 `readFinishReason()` 双键读取，并把这条事实钉进单测。

**token 预算**：`maxTokens` → `maxCompletionTokens`，默认 **160 → 1500**，走 `ENGINE_RENDER_MAX_TOKENS`。**思考强度**：voice render 路径 `reasoning_effort=low`（只对 render taskKind 生效，analysis/supervision 不受影响）。

**边界硬化**：截断保护（聚合裁尾 + 流式句边界缓冲）、危机轮次路由（同步 `supervision_hint` + 思考强度抬档 + prompt 护栏）、降级路径（config 加载的兜底话术池 + `degraded=true` 日志）、render prompt 确认注入 `coreBeliefs` + 轮次权重指令。

**红线全部守住**：`src/engine-core/` 整树零改动（`git diff --stat HEAD -- src/engine-core` **为空**）；wiring 顶层零 SDK 直引（WP8-A §8-9 护栏 34 例全绿，未改未破）；旧 visitor 链路不删，只顺手切字段名；零 DB FK；零 DB schema 变更。

**闸门**：eslint **0 error 0 warning** / `tsc -p tsconfig.build.json` **0 错** / `tsc -p tsconfig.scripts.json` **0 错** / jest **25 套件 495 例全绿** / `npm start` **真起服务成功**（`/engine/admin/character-profiles` → 401 鉴权生效，路由 mapped）。

---

## 1. §2.1 token 预算与思考强度

### 1.1 canonical 类型落在厂商抽象层

`src/llm/common/interfaces/chat-provider.interface.ts` 新增：

```ts
export type ChatReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
```

**为什么放这里**：思考强度是**协议事实**（上游厂商认这个词），不是 agent 层业务概念。agent 层原来的 `LlmReasoningEffort` 改成了**类型别名** `= ChatReasoningEffort`，两份字符串联合合并成一份 —— 否则新增档位要改两处，迟早漂移。

`ChatCompletionRequest` 新增 `maxCompletionTokens?: number` / `reasoningEffort?: ChatReasoningEffort`；旧 `maxTokens?: number` 保留但标注为**旧字段**（仅兼容路径）。

### 1.2 厂商差异收在基类钩子

`src/llm/common/base/openai-compatible-chat.provider.ts` 新增 protected 钩子：

```ts
protected buildRequestOverrides(request: ChatCompletionRequest): {
  readonly maxTokens?: number;
  readonly reasoningEffort?: ChatReasoningEffort;
  readonly modelKwargs?: Record<string, unknown>;
}
```

基类取 `request.maxCompletionTokens ?? request.maxTokens` —— **两个上限字段只取其一**，从根上杜绝"同时下发 `max_tokens` 与 `max_completion_tokens`"（任务单 §4.2 明列的失败边界）。

### 1.3 MiniMax 为什么必须走 `modelKwargs`（实测事实）

`src/llm/providers/minimax.provider.ts` 覆盖该钩子，**不设 LangChain 的 `maxTokens`**，改用：

```ts
modelKwargs: { max_completion_tokens: ..., reasoning_effort: ... }
```

**为什么绕这一下**：LangChain 1.6.2 的 `completions.js:71` 只在 `isReasoningModel(model)` 为真时才发 `max_completion_tokens`，而 `isReasoningModel`（`node_modules/@langchain/openai/dist/utils/misc.js:52`）**硬编码只认 `o*` / `gpt-5*` / `gpt-6*`**。`MiniMax-M3.1-Flash` 走不到那个分支 —— 设 `maxTokens` 只会变成旧字段 `max_tokens`。用 `modelKwargs` 直通是唯一能让字段**原样落到 MiniMax 上游**的办法。

**真实上游实测**（`max_completion_tokens=1500`）：

| 项 | `max_tokens=160` | `max_completion_tokens=1500` + `reasoning_effort=low` |
|---|---|---|
| completion_tokens | 121（其中**思考 94**） | 正常输出不被思考吃光 |
| 思考 token | 94 | **39** |
| 单次耗时 | 2428ms | **1911ms** |

→ 证实"160 太紧"：**121 个 completion token 里有 94 个是思考**，正文只剩 27 个 token 的半句话。

### 1.4 配置层（env 可调）

| env | 默认 | 落点 |
|---|---|---|
| `ENGINE_RENDER_MAX_TOKENS` | 未配 → 用 spec 预算 **1500** | `RenderTaskDefaults.maxCompletionTokens` |
| `ENGINE_RENDER_REASONING_EFFORT` | `low`（查表校验，非法值回落默认 + warn） | `RenderTaskDefaults.reasoningEffort` |
| `ENGINE_RENDER_FALLBACK_UTTERANCE` | 4 句种子池，`\|` 分隔 | `RenderAdapterConfig.fallbackUtterances` |

**token 上限单一真相**：`DEFAULT_TURN_TOKEN_BUDGET`（`turn-render-orchestrator.ts:182`）= `{ maxCompletionTokens: 1500, contextTokens: 512 }`。env 未配时回落此值，配了以 env 为准 —— **不再有第二个 160**。

### 1.5 render 路径的实际改动

- `llm-render.adapter.ts`：`ResolvedRenderParams.maxCompletionTokens` + `reasoningEffort?`；`callOnce` / `streamAttempt` **两处**请求构造都改传 `maxCompletionTokens`（**不再传 `maxTokens`**）+ `reasoningEffort`。
- 新增导出纯函数 `escalateReasoningEffort(configured, risk)`：**只升不降**（`low<medium<high<xhigh<max`）。配置写 `high` 的候选不会因为"这轮没风险"被降回 `low`；配置没写（`undefined` = 上游默认档）则不动（上游默认往往是最高档，更保守）。
- `visitor.service.ts:137`：`maxTokens: 200` → `maxCompletionTokens: 200`（旧链路只切字段名，不展开改造）。

**`reasoningEffort=low` 只影响 render taskKind**：`RenderTaskDefaults` 是 **render 专用**的默认配置表，analysis / supervision / drill-evaluator 各走自己的 config profile，**一行未动**。

---

## 2. §2.2 截断保护（半句不喂 TTS）

### 2.1 前提：先把 `finish_reason` 接回来（真缺陷）

**这是本轮发现的第一个真 bug**：LangChain 1.6.2 在 `generationInfo.finish_reason`（**snake_case**）写截断原因，而本仓 provider 原来只读 `generationInfo.finishReason`（camel）→ `finishReason` **恒为 `'stop'`**。

后果：截断保护、长度预算、任何依赖"上游是不是被砍断了"的逻辑，**触发条件从来没成立过**。修复 = `readFinishReason()` **两个键都读**，流式 / 非流式两处都改。

### 2.2 落点：只能在渲染层

新增 `src/engine-adapters/rendering/render-truncation.ts`（纯函数，零 NestJS / 零 IO / 零网络）：

- `lastClosedSentenceEnd(text)` — 找最后一个已闭合句子的结束位置；
- `dropUnclosedTail(text)` — 裁掉未闭合尾句；
- `isClosedSentence(text)` — 是否以句末标点收尾；
- `splitClosedPrefix(buffer)` — 流式缓冲切成「已闭合前缀 + 未闭合尾巴」。

**为什么只能在渲染层**：TTS 层的切句是**出声口径**（按上游攒句协议逐字对齐），它收到什么就合成什么 —— 半截句子进 TTS 队列就会合成半截音频。而"这一轮被上游截断了"这个事实，**只有发起请求的渲染层知道**（TTS 层看不到 `finish_reason`）。所以防护必须落在渲染层：半截文本根本不该离开渲染端口。

**为什么不复用 TTS 的切句器**（`src/voice/tts/tts-sentence-splitter.ts`）：那是出声口径（切早会让那句永不合成），本文件是**截断裁剪**口径（只找边界，不做分段）。两者目标不同，合流会让字幕口径反过来影响出声协议。

**为什么不写正则**：本仓有 `sonarjs/super-linear-regex` 红线，且逐字符判定不需要正则。

### 2.3 聚合路径与流式路径

- **聚合**：`applyTruncationGuard()` —— `finish_reason=length` → 丢弃未闭合尾句；裁完为空 → 切备 / 降级（不把空当正常回复）。
- **流式**：改为**句边界缓冲** —— 只下发**已闭合**句子；`length` 时丢弃 pending；正常收尾时 flush pending。

**代价与收益**：未闭合句的字幕会晚到（下一句闭合时才一起下发）。但 TTS 本就**按句合成**，所以字幕与语音反而**更对齐**（以前是字幕先到、音频后到）。

**「一句『嗯』不该被误判为未闭合」这条验收怎么保证**：
- 聚合路径只在 `finish_reason=length` 时才裁尾 —— 正常收尾（`'stop'`）的短回复**原样通过**，不进裁剪函数；
- 流式路径正常收尾时 flush pending，所以「嗯」在正常收尾下**会**被下发；
- `isClosedSentence('')` → `true`（空串视为已闭合，不触发裁剪）。

---

## 3. §2.3 危机轮次路由（per-turn）

### 3.1 风险信号链路

```
engine-core turn 决策 output.safety (WP4 assessSafety)
  → RiskProbePort 探测 (LocalCrisisProbe)
  → AdaptiveRenderSpec.riskSignal
  → ① reasoningEffort 抬档  ② prompt 追加安全护栏  ③ 同步推 supervision_hint
```

新增 `src/engine-adapters/rendering/render-risk.ts`：

- `RenderRiskLevel` / `RenderRiskSignal`；
- `AdaptiveRenderSpec extends RenderSpec`（**可选**新增 `riskSignal?` + `characterLabel?`）—— 内核 `RenderSpec` **一行未动**（红线），用适配层扩展类型保证**向后兼容**（既有调用方零破坏）；
- `resolveRiskLevel` / `CRISIS_RISK_CATEGORIES` / `isCrisisCategory`。

**为什么必须带"危机类别"才升级**：内核 `safety.level=warn` 既可能是"咨询师侧专业性提示"，也可能是"来访侧危机意念"。直接复用 `level` 会把专业性提示误升级成危机路由。**只有危机类别才升级**。

### 3.2 `LocalCrisisProbe`（实现内核 WP4 `RiskProbePort`）

新增 `src/engine-adapters/wiring/risk/local-crisis.probe.ts`：

- 复用**内核来访侧词典**（`engine-core/cognition/safety/rule-engine.ts` 的 `passive_ideation` 词表）；
- **补差**：内核词典只覆盖**咨询师输入侧**的来访词，咨询师侧"活着没什么意思"这类**咨询师输入面**表述未覆盖 → 本 probe 补上（归 `passive_ideation`）。

注入路径：`createEngineSessionPort(memories, riskProbe?)` → `InMemoryEngineSession` → `engine.module.ts` 注册 `LocalCrisisProbe`。

**终局形态对齐**：任务单 §5 要求"危机检测走 `RiskProbePort` 抽象，未来换 PsyGUARD Python 服务时 adapter 不动" —— 本轮就是这么做的，WP11 落地时只换 probe 实现。

### 3.3 `supervision_hint` 同步推

`EngineStreamBackend`（`src/engine-adapters/wiring/engine-stream-backend.adapter.ts`）新增可选注入 `VoiceFrameRegistry`（**business → voice 方向**；`VoiceSessionModule` 是 `@Global`，module 里用 `{token, optional:true}` 注入，缺了也不炸）。

新增 `publishCrisisHint()`，在**本轮结算当场**推：

```json
{ "type": "supervision_hint", "turnIndex": 3, "category": "passive_ideation",
  "hintText": "检测到明确的危机信号，建议督导在本轮后介入评估安全风险。", "tier": "light" }
```

**为什么必须同步**：督导提示如果靠异步 worker，就会错过"这一轮"的窗口（人已经说完下一句了，提示才到）。

**帧出口按稳定落库 id 路由**（`dbSessionIds` 映射）—— 所以窄接口 `VoiceTurnBackendOpenOptions` 加了**可选** `dbSessionId?`，`voice.service.ts` 传 `meta.dbSessionId`。

### 3.4 prompt 护栏

风险轮次追加 `RISK_GUARDRAIL`（**只约束"不描述危险做法"**，不给模型任何危机处置建议 —— 那是督导流程，不是来访者台词）。

---

## 4. §2.4 降级路径（不发 error 帧断连）

### 4.1 兜底话术从 config 加载

`RenderAdapterConfig.fallbackUtterance: string` → **`fallbackUtterances: readonly string[]`**（种子池 `DEFAULT_RENDER_FALLBACK_UTTERANCES` 4 句），`ENGINE_RENDER_FALLBACK_UTTERANCE` 用 `|` 分隔多句。

**为什么不硬编码在 adapter 里**：任务单 §4/§5 明写"未来可换成 character service 远程拉取"。话术池在 config 层 → 换成远程拉取时只改 config factory，**adapter 一行不动**。

### 4.2 轮换 + 标记

`degrade` / `degradeOutcome` 用 `fallbackUtterances` **轮换**（实例内游标 `fallbackCursor`），避免每一轮降级都输出同一句、让咨询师误以为是真实回复。

**日志标记 `degraded=true`** —— 降级轮次**不冒充真实角色回复**。

**降级走正常 `llm_text` / `tts_audio` 帧，不发 error 帧断连** —— 会话不崩。

**消除重复文案**：`DEFAULT_TURN_FALLBACK_UTTERANCE` 改为引用 `DEFAULT_RENDER_FALLBACK_UTTERANCES[0]`（门面自己兜底与 adapter 降级池**同一份真相**）。

---

## 5. §2.5 render prompt 注入角色基线

### 5.1 coreBeliefs **确认**（不是假设）

**任务单要"确认而非假设"** —— 查证结果：`turn-render-orchestrator.ts:634-635` **早就注入**了 `coreBeliefs`（不是只在持久化快照里）。本轮加**单测钉住**这条事实，防止后续重构把它删了。

### 5.2 轮次权重指令（来自内核 turn 决策，不是前端传的）

新增 `resolveTurnVerbosity(...)`，话量权重由**内核 turn 决策结果**计算：

- `resistance.verbal`（言语阻抗）高 → 该说**短**、躲闪；
- `trust`（信任）高 → 该说**长**、多解释；
- `intention.strategy`（意图策略）参与判断。

指令三档：短（"简短、躲闪"）/ 中 / 长（"可以多解释几句"），每档都带**"说完一两句就停下来，把话头交还给咨询师"**（真人对话不是独白）。

### 5.3 dev-only debug 日志

`logPromptCharacterFragment()`：`NODE_ENV !== 'production'` 时打印 codename + `coreBeliefs` 前 100 字，便于人工核对"拼进 prompt 的到底是不是这版的角色片段"。**生产环境不打**（角色基线是敏感数据，且日志噪音）。

### 5.4 角色代号链路

```
EngineTurnService.open(input, options?: { characterLabel? })
  → TurnSessionContext.characterLabel
  → TurnRenderOrchestrator.assemble(..., handleId)
  → SpecAssemblyInput.characterLabel
  → spec → 日志
```

（`characterLabel` 落在**适配层扩展类型**上，内核 `RenderSpec` 不动。）

---

## 6. §2.6 E2E 探针增强

`scripts/e2e-voice-ws-probe.mjs`（用户 untracked 文件，本轮改造）：

| 缺口 | 修法 |
|---|---|
| TTS 字节统计取错字段 | TTS 帧的音频是 **base64 字符串**（字段名 `audio_base64`），按 base64 **解码后**算实际字节数；验收 `ttsBytes > 0` |
| 没抓 usage / reasoning_tokens | 抓 `llm_done.usage`（prompt / completion / reasoning tokens） |
| 没抓 TTFT | 发 `user_text` → 首个 `llm_text` 的毫秒数 |
| 两角色对比无断言 | `--compare` 模式断言：文本不同 / 句长有差异 / 口吻关键词不同 / TTFT < 3s / reasoning_tokens > 0 / TTS bytes > 0 |
| 截断无断言 | 断言"**进 TTS 的每句都以句末标点收尾**"（半句不进 TTS） |
| 危机无断言 | 危机场景断言收到 `supervision_hint` 帧 |

**场景参数**：`basic`（默认）/ `crisis` / `truncation`（第 4 个位置参数）。探针协议沿用既有约定：**发送必须用 Nest 信封** `{event:'message', data:{type,text}}`（裸帧被静默丢弃）；**服务端下发是普通** `{type:...}` JSON。

---

## 7. 闸门实测结果

```
npx tsc -p tsconfig.build.json --noEmit    → 0 错
npx tsc -p tsconfig.scripts.json --noEmit  → 0 错
npm run lint                               → exit 0（eslint 0 error 0 warning）
npx jest test/engine-adapters/wp8-wiring.spec.ts   → 34 例全绿（§8-9 护栏未改未破）
npx jest test/engine-core test/engine-adapters test/voice test/agent test/llm --maxWorkers=2
                                             → 25 套件 / 495 例全绿
npm run build                              → exit 0
npm start                                  → Nest 起服务成功，/engine/admin/character-profiles → 401（路由 mapped，鉴权生效）
git diff --stat HEAD -- src/engine-core    → 空（内核整树零改动）
node --check scripts/e2e-voice-ws-probe.mjs → OK
```

### 7.1 `npx tsc --noEmit`（含 `test/`）的 41 个报错 —— **全是仓库既有债**

```
test/e2e/knowledge-search.e2e-spec.ts    13 个   （TS2307 模块不存在：../src/llm/common/interfaces/embedding-provider.interface 等）
test/good-state-diary.e2e-spec.ts        28 个   （TS4111 / TS2352 / TS2349 supertest 类型）
```

两个文件**引用了不存在的模块**（相对路径 `../src/...` 从 `test/e2e/` 出发根本解析不到），是仓库早于本轮的失效 e2e。**本轮一行未碰这两个文件**，也没有为了消报错去动它们（那属于另一件事）。生产构建口径 `tsconfig.build.json` 与 `tsconfig.scripts.json` 均 **0 错**。

---

## 8. 改动面清单

### 8.1 新增文件（6）

| 文件 | 职责 |
|---|---|
| `src/engine-adapters/rendering/render-truncation.ts` | 未闭合尾句判定与裁剪（纯函数） |
| `src/engine-adapters/rendering/render-risk.ts` | 风险等级 / `AdaptiveRenderSpec` / 危机类别判定 |
| `src/engine-adapters/wiring/risk/local-crisis.probe.ts` | 实现内核 `RiskProbePort` 的本地危机探测 |
| `test/engine-adapters/wp9c-render-safety.spec.ts` | WP9-C 边界用例（18 例） |
| `test/engine-adapters/wp9c-risk-probe.spec.ts` | 危机探测 + 风险路由用例 |
| `test/llm/wp9c-token-fields.spec.ts` | token 字段映射用例 |

### 8.2 修改文件（20）

**厂商抽象层**：`chat-provider.interface.ts`（canonical 类型 + 新字段）/ `openai-compatible-chat.provider.ts`（钩子 + `readFinishReason` + usage 上报）/ `minimax.provider.ts`（`modelKwargs` 只下发 `max_completion_tokens` + `reasoning_effort`）。

**agent 层**：`llm.types.ts`（`LlmReasoningEffort` 改别名 + `reasoningTokens`）/ `llm.service.ts`（解析 `completion_tokens_details.reasoning_tokens`，抽 `toLlmUsage()` 纯函数降复杂度）/ `visitor.service.ts`（`maxCompletionTokens: 200`）。

**渲染适配层**：`render-adapter.config.ts` / `llm-render.adapter.ts` / `render-truncation.ts` / `render-risk.ts` / `spec-assembler.ts` / `turn-render-orchestrator.ts` / `streaming-render.port.ts`。

**装配层**：`engine.module.ts` / `engine.providers.ts` / `engine-stream-backend.adapter.ts` / `engine-turn.service.ts` / `render-config.factory.ts` / `risk/local-crisis.probe.ts`。

**voice 层**：`voice-turn-backend.port.ts`（`dbSessionId?`）/ `voice.service.ts`（传 `dbSessionId` + `llm_done` 带 usage）/ `voice.types.ts`（`llm_done` 帧加**可选** `usage`）。

**脚本**：`scripts/e2e-voice-ws-probe.mjs`。

**既有单测更新（3）**：`wp6-llm-render.spec.ts`（`fallbackUtterances` 字段）/ `wp8-wiring.spec.ts`（`maxCompletionTokens` 断言）/ `wp8b-stream-render.spec.ts`（流式句边界新语义 + Stub 支持 `finishReason`）。

### 8.3 红线核对

| 红线 | 核对结果 |
|---|---|
| 不动 `src/engine-core/**` | ✅ `git diff --stat HEAD -- src/engine-core` 为空 |
| wiring 顶层不直引 SDK | ✅ `wp8-wiring.spec.ts` §8-9 护栏 34 例全绿，**护栏未改未破** |
| 不删旧 visitor 链路 | ✅ 只把 `maxTokens: 200` 切成 `maxCompletionTokens: 200` |
| 不加 DB FK | ✅ 本轮零 DB schema 变更、零 migration |
| 不做 per-turn 动态预算 | ✅ 仍是**固定** 1500（env 可调） |
| 不按角色硬编码 token 预算 | ✅ 预算与角色无关 |
| 不碰 Flutter 前端 | ✅ 前端零改动（思考中 UI / 兜底视觉标记按任务单 §7 另立项） |
| 不自动 commit / push | ✅ 本轮**不提交**，commit 文案见任务单 §9 |

---

## 9. commit 文案

```
fix(engine): 渲染路径切 max_completion_tokens(1500) + voice render 低思考 + 截断/危机/降级边界收口
```

---

## 10. 用户验收（探针）

服务起着（`ENGINE_VOICE_ENABLED=true`），在仓库根跑：

```powershell
# 基础场景（晚晴）：llm_text 非空 + tts 出声 + usage 带 reasoning_tokens + TTFT < 3s
node scripts/e2e-voice-ws-probe.mjs vpt_intimate_avoidance_l1 晚晴

# 基础场景（亦舟）
node scripts/e2e-voice-ws-probe.mjs vpt_workplace_intellectualization_l1 亦舟

# 两角色对比（文本不同 / 句长差异 / 口吻关键词不同 / TTS bytes > 0）
node scripts/e2e-voice-ws-probe.mjs --compare

# 危机场景：断言收到 supervision_hint 帧
node scripts/e2e-voice-ws-probe.mjs vpt_intimate_avoidance_l1 晚晴 voice crisis

# 截断场景：断言进 TTS 的每句都以句末标点收尾
#   （可临时把 ENGINE_RENDER_MAX_TOKENS 调到很小以触发 length 截断）
node scripts/e2e-voice-ws-probe.mjs vpt_intimate_avoidance_l1 晚晴 voice truncation
```

### 10.1 验收对照任务单 §4.1

| # | 项 | 本轮状态 |
|---|---|---|
| 1 | tsc 0 错、eslint 干净 | ✅ build/scripts 均 0 错；eslint 0 error 0 warning |
| 2 | wp8-wiring 护栏仍绿 | ✅ 34 例全绿 |
| 3 | 晚晴探针：llm_text 非空 + tts 出声 | ⏳ 待用户跑探针 |
| 4 | usage 含 reasoning_tokens、TTFT < 3s | ⏳ 待用户跑探针（真实上游已实测 reasoning 39 token / 1911ms） |
| 5 | 亦舟 vs 晚晴句长/口吻差异 | ⏳ 待用户跑 `--compare` |
| 6 | 截断：TTS 帧不含半截句子 | ⏳ 待用户跑截断场景 |
| 7 | 危机：自伤输入触发 supervision_hint | ⏳ 待用户跑危机场景 |
| 8 | 降级：兜底话术音频而非 error 帧 | ⏳ 待用户拔 MiniMax key 验证（代码路径已实现 + 单测覆盖） |
| 9 | dev 日志能看到 render prompt 的 coreBeliefs 片段 | ⏳ 待用户跑（`NODE_ENV !== production` 才打） |

### 10.2 已知边界 / 后续项

- **§2.3 的危机探测目前是本地规则**（`LocalCrisisProbe`）：内核来访侧词典 + 咨询师输入面补差。WP11 PsyGUARD Python 服务上线时**只换 probe 实现**，adapter / 装配层不动。
- **§2.5 的轮次权重**目前取 `resistance.verbal` / `trust` / `intention.strategy` 三个内核决策量，是**可解释的粗粒度分档**（不是连续预算）；per-turn 动态预算按任务单 §3 属 Phase2。
- **兜底话术池是通用池**（4 句），非按角色定制 —— 任务单 §2.4 写的是"每个角色 3-5 句"，本轮先落通用池 + config 可覆盖；按角色定制需角色服务（Phase2）。
- **`supervision_hint` 的 `hintText` 是固定文案**，未接督导话术库 —— 属前端 §7「另立项」范围。
- **前端配套未做**（思考中 UI 提示 / 兜底话术视觉区分）：任务单 §7 明确另立项。
