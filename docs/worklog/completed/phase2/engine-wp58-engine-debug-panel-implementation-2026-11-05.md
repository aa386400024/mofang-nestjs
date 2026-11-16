# WP58 · 引擎调试面板（/debug-chat 后端接口）· 交付记录

> 任务单：[`wp58-engine-debug-panel-2026-11-05.md`](wp58-engine-debug-panel-2026-11-05.md)（已随本记录移入 `completed/phase2/`）
> 交付日期：2026-11-05
> 边界：**engine-core 零改动**（`git diff --stat HEAD -- src/engine-core` = 空）· 调试会话**纯内存不落库** · 心理内容**不进日志**

---

## 一、交付摘要

给 admin-dashboard 的 `/debug-chat` 页面补齐 **3 个写操作接口**，让 admin 调试者能**真跑引擎流程**并看到每一步内部状态：

| 端点 | 作用 | 返回 |
|---|---|---|
| `POST /admin/api/debug/session` | 开一场调试会话（角色解析 → 内核 openSession） | `{ sessionId, debugSessionId, characterSlug, characterLabel, createdAt }` |
| `POST /admin/api/debug/session/:id/turn` | 发一轮对话（真调引擎） | `{ turnIndex, reply, trace }`，`trace` 含 BDI 快照 / delta / 意图 / 渲染规格 / **prompt 全文** / 审议 trace |
| `DELETE /admin/api/debug/session/:id` | 关掉调试会话（清内存 + 关内核句柄） | `{ sessionId, closed: true }` |

**关键取舍**（详见 §三 偏差表）：

- 装配上**避开模块循环依赖** —— 新增独立模块 `AdminDebugChatModule`，依赖单向 DAG，**不用 `forwardRef`**（仓库里 `forwardRef` 使用次数 = 0）。
- 走**流式**出口而不是任务单写的聚合出口 —— 聚合路径拿不到 prompt（`promptPreview` 恒空串），而 §7.1 明确要求"prompt 全文"。
- prompt 全文走**新增的按需通道**（4 个文件），**只走内存、不落库** —— 留痕契约（`TurnTrace.renderSpec`）仍只取 500 字预览。
- 审议 trace **有界等待**（默认 5s）—— 审议是 BullMQ 异步跑的，不等必然读到 null。

---

## 二、文件清单

### 新增（4 个）

| 文件 | 行数量级 | 用途 |
|---|---|---|
| `src/admin-debug/debug-session.service.ts` | ~600 | 调试会话逻辑：内存会话表 / 角色解析 / delta / 审议 trace 读取 / 开关闸门 / trace 组装 |
| `src/admin-debug/debug-session.controller.ts` | ~130 | 3 个写接口（class 级挂 `AdminRoleGuard`） |
| `src/admin-debug/admin-debug-chat.module.ts` | ~90 | 装配（`EngineWiringModule` + `CharacterPoolModule` + `UserModule` + `TypeOrmModule.forFeature([User])` + 中间件挂载） |
| `test/admin-debug/wp58-debug-session.spec.ts` | ~640 | 26 例单测（任务单 §8 的 16 条 + 10 条防漂移） |

### 修改（7 个）

| 文件 | 改什么 |
|---|---|
| `src/app.module.ts` | 注册 `AdminDebugChatModule`（2 行：import + imports 数组条目） |
| `src/engine-adapters/rendering/streaming-render.port.ts` | `StreamRenderOutcome` 加**可选** `promptFull?: string` |
| `src/engine-adapters/rendering/llm-render.adapter.ts` | 新增 `buildPromptFull()`；`buildOutcome` / `streamViaAggregate` 两处带上全文 |
| `src/engine-adapters/rendering/turn-render-orchestrator.ts` | `TurnRenderResult.render` / `NormalizedRender` 加 `promptFull?`；`turnStream` 加 `options.includePromptFull`（**默认不带**） |
| `src/engine-adapters/wiring/engine-turn.service.ts` | `turnStream` 透传 `options` |
| `typings/global.d.ts` | 声明 `ENGINE_DEBUG_CHAT_ENABLED` / `ENGINE_DEBUG_CHAT_DELIBERATION_WAIT_MS` |
| `.env.example` | 两个新 env 键（含口径说明） |

> **`src/admin-debug/admin-debug.module.ts` 一行未改** —— 见偏差 D1。

---

## 三、关键设计决策（与任务单的偏差表）

> 按 `docs/team/conventions.md` §2.5：先 grep 核实真实函数名 / 调用链 / 文件路径，再找企业级最佳方案，逐条登记。

| # | 任务单原文 | 实际做法 | 理由 |
|---|---|---|---|
| **D1** | §六「修改 `admin-debug.module.ts`：① import `EngineModule` ② import `CharacterPoolModule` ③ 注册新 controller + service」 | **新增** `admin-debug-chat.module.ts` 承载新 controller + service；`admin-debug.module.ts` **一行未改** | grep 核实：`src/engine-adapters/wiring/engine.module.ts:122` **已经 import `AdminDebugModule`**（为了 `TraceRecorder` 落库）。调试接口要 `EngineTurnService` → 若放回 `AdminDebugModule` 就是 `EngineWiringModule ⇄ AdminDebugModule` **模块循环依赖**，Nest 启动期即炸（provider 互等实例化）。拆新模块后依赖是**单向 DAG**：`AppModule → AdminDebugChatModule → EngineWiringModule → AdminDebugModule`。**不用 `forwardRef`** —— 全仓 `forwardRef` 使用次数为 0，那是处理循环依赖的兜底，不是首选 |
| **D2** | §4.2 逻辑第 3 步「调 `TurnRenderOrchestrator.turn(handleId, { userText })`」 | 走 `EngineTurnService.turnStream(handleId, input, handlers, { includePromptFull: true })` | grep 核实：聚合路径 `renderSafely` 调 `buildSpecSummary(spec, {})` —— **传空真值** → `promptPreview` 恒 `''`，且没有 `finishReason` / `ttftMs`。§7.1 明确要求"prompt 全文（不只前 500 字）"，聚合路径给不了。流式出口能拿到全部真值（真值只在适配器里）。⚠️ **流式 ≠ 改变引擎行为**：两条路径共用同一套闭环（内核决策 / 规格组装 / 落账），只差"怎么把文本取回来" |
| **D3** | §4.1 出参 `debugSessionId` | **同时**给 `sessionId` 与 `debugSessionId`（**同一个值**） | 前端 `admin-dashboard/src/views/DebugChat.vue:95` 读的是 `data.sessionId`；任务单写的是 `debugSessionId`。两个名字同值 = 两套契约都能用，但只有**一个**真相 |
| **D4** | §4.2 入参 `userText` | **同时**收 `counselorText`（前端发它）与 `userText`（任务单叫它） | 同 D3：`DebugChat.vue:125` 的 body 是 `{ counselorText: text }` |
| **D5** | §4.2 出参是**扁平**结构（`bdiSnapshot` / `delta` / `renderSpec` … 都在顶层） | 返回 `{ turnIndex, reply, trace }`，完整状态在 **`trace`** 里 | 前端契约是 `data.trace`（`DebugChat.vue:146`）。为兼容任务单示例而把 trace 再摊一份到顶层 = **两份形状**，将来改字段要改两处。以**前端真实契约**为准 |
| **D6** | §4.2 `delta` 是 6 键扁平（`trust/safety/bond/valence/arousal/resistance`） | `delta` = 内核**全量 11 维** `DeltaVector`；另给 `deltaDetail`（前端 8 维投影 + `events: []`） | 内核阻抗是**三维**（verbal/depth/style），拍平成一个 `resistance` 标量会丢信息；`deltaDetail` 是 `delta` 的**投影**（不是第二份真相）。`events`（内核逐事件明细）**内核不对外** → 留空数组，**不编** |
| **D7** | §4.2 `intention` 示例 `{ strategy: "explore", emotion: "neutral", resistance: "low" }` | 返回内核 `Intention` **原样** | grep 核实：内核 `Intention` = `{ strategy, emotion: EmotionState, resistance: BdiResistance, transference, forbiddenBehaviors, rationale? }` —— `emotion` / `resistance` 都是**对象**，不存在 `"neutral"` / `"low"` 这种字符串；`strategy` 的 8 种取值里也没有 `"explore"`（真实值：`simple_response` / `request` / `recounting` / `cognitive_exploration` / `affective_exploration` / `insight` / `discussing_plans` / `resistance`） |
| **D8** | §4.2 `renderSpec.taskKind: "freeform"` | 实际是内核 `RenderTaskKind`（`stable` / `chat` / `advanced`） | 内核没有 `"freeform"` 这个任务档（`freeform` 是审议的**模式**，不是渲染任务分层） |
| **D9** | §7.1「调试 trace 里有 prompt 全文（不只前 500 字）」；§5.3「prompt 全文：从渲染 spec 里拿（现有）」 | 渲染链**新增一条按需通道**（4 个文件）：`StreamRenderOutcome.promptFull?` → `buildPromptFull()` → 门面 `includePromptFull` 开关 | grep 核实：适配器**只产 500 字预览**（`buildPromptPreview`，WP19-R 刻意"不落完整 prompt"：全量落库等于摊开角色约束）。而"现有 spec 里拿全文"不成立 —— `RenderSpecSummary` 只有预览。**新增而不是改口径**：全文**只走内存**（`includePromptFull` 默认**关**，语音主链路不带），留痕契约 `TurnTrace.renderSpec` **仍只取 `promptPreview`** → **不落库** |
| **D10** | §8.3「传不存在的 debugSessionId → 404（幂等）」 | **404**（`BizCode.ResourceNotFound`） | "幂等"与"404"自相矛盾（幂等通常意味着重复调用也 200）。按**显式验收条目**取 404，并在此登记该措辞冲突 |
| **D11** | §5.3「delta：从 `lastSnapshots` 算（现有）」 | 调试服务**自己记**上一轮快照 | 门面的 `lastSnapshots` 是 **private**（`turn-render-orchestrator.ts:459`），外部拿不到。口径与门面一致：第 1 轮 `delta = null`（没有上一轮可比），第 2 轮起用 `computeRuleDelta(prev, cur)` —— 与影子审议的 `ruleDelta` **同源同口径** |
| **D12** | §4.2 逻辑第 4 步「从 Redis 读这一轮的审议 trace」 | 读 Redis + **有界等待**（默认 5s，`ENGINE_DEBUG_CHAT_DELIBERATION_WAIT_MS` 可调，0 = 不等） | 审议是 **BullMQ 异步**跑的（WP65：入队 → Worker → LLM → 写 trace，单次 3–8s），turn 返回那一刻 trace **通常还没写进去** —— 不等就必然读到 null，面板上那一栏永远是空的。**第 1 轮不等待**（门面首轮没有起始快照 → 跳过影子审议，等也等不到）。超时 → 如实返回 `null`，不编 |
| **D13** | 任务单未规定开关关闭时的行为 | **403**（`BizCode.Forbidden`，"引擎调试面板接口未启用"）；判定放在**服务层**而非只在 controller | 这是"这个能力开没开"的判断，属能力本身 —— 将来别的入口调这个服务时不该绕过开关 |
| **D14** | §4.1 逻辑第 3 步「`visitorId: 'debug-admin'`」 | 额外把 `userId` 也登记为 `'debug-admin'`（`EngineTurnService.open` 的 options） | 影子审议要求 `userId` **非空**，否则**跳过这一轮**（`shadowDeliberation` 早退）→ 面板永远看不到审议 trace。这是"审议 trace 能出现"的前提 |
| **D15** | §4.1 逻辑第 3 步「`sessionId: debug_{nanoid()}`」 | **内核 sessionId 与调试会话 id 同一个值** | 审议 trace 的 Redis key = `deliberation_trace:{租户长度}:{租户}:{会话长度}:{会话}:{轮次}` —— 会话 id 与归属登记必须一致，key 才算得准。`tenantId` 固定 `'debug'`、`visitorId` 固定 `'debug-admin'` 同理 |

### 3.1 其它实现口径（非偏差，但值得记）

1. **鉴权双层**：`AdminBasicAuthMiddleware`（判身份：运维 basic 凭据 / 学员 JWT）+ class 级 `AdminRoleGuard`（判角色：DB 真值 `users.admin_role = 'admin'`）。中间件在 `AdminDebugChatModule.configure()` 里**按控制器**挂载（`forRoutes(DebugSessionController)`）—— 新增端点自动继承。
2. **调试会话不落库**：状态只在内存 `Map` 里；`DebugSessionService` **零 TypeORM / 零 `InjectRepository`**（单测用源码扫描钉死，注释剥掉后断言）。不写 `training_sessions`，不写 `turn_debug_trace`。
3. **心理内容不进日志**：服务日志只有 `session` / `turn` / `elapsedMs` / 角色代号。**审议 trace 读取失败时只打错误类型名**（`JSON.parse` 的报错文案里会带内容片段）。
4. **角色解析失败 → 400「角色不存在」**，不开中性会话 —— 调试者要的是"这个角色跑起来什么样"，开错角色等于白跑一轮。
5. **`promptFull` 只带 system 消息全文**（与 `promptPreview` 同源：取第一条 system 消息，只是**不截断**）—— 调试器最需要核对的是角色约束/护栏那一段；对话轮次本来就是调试会话自己的消息。

---

## 四、接口契约（给前端 AI）

### 4.1 `POST /admin/api/debug/session`

请求：`{ "characterSlug": "vpt_intimate_avoidance_l1" }`

```json
{
  "sessionId": "debug_xxx",
  "debugSessionId": "debug_xxx",
  "characterSlug": "vpt_intimate_avoidance_l1",
  "characterLabel": "亲密回避型 L1",
  "createdAt": "2026-11-05T10:00:00.000Z"
}
```

错误：`400` 角色代号必填 / 角色不存在 · `403` 开关关闭或非 admin。

### 4.2 `POST /admin/api/debug/session/:id/turn`

请求：`{ "counselorText": "我今天感觉不太好" }`（`userText` 同义兼容）

```json
{
  "turnIndex": 2,
  "reply": "（叹了口气）嗯……怎么了？",
  "trace": {
    "turnIndex": 2,
    "characterSlug": "vpt_intimate_avoidance_l1",
    "bdiSnapshot": {
      "trust": 0.55, "safety": 0.45, "bond": 0.2,
      "valence": 0.5, "arousal": 0.5,
      "resistance": 0.31,
      "resistanceVerbal": 0.31, "resistanceDepth": 0.32, "resistanceStyle": 0.33,
      "anxiousSecure": "neutral"
    },
    "delta": { "trust": 0.05, "safety": 0.02, "bond": 0.01, "valence": 0, "arousal": 0, "verbal": 0, "depth": 0, "style": 0, "positive": 0, "negative": 0, "dependency": 0 },
    "deltaDetail": { "trust": 0.05, "safety": 0.02, "bond": 0.01, "valence": 0, "arousal": 0, "verbal": 0, "depth": 0, "style": 0, "events": [] },
    "intention": { "strategy": "simple_response", "emotion": { "...": "内核 EmotionState" }, "resistance": { "...": "内核 BdiResistance" }, "transference": { "...": "..." }, "forbiddenBehaviors": [] },
    "renderSpec": { "taskKind": "chat", "promptPreview": "你是一个来访者…", "promptFull": "完整 system prompt 全文", "maxCompletionTokens": 1500, "reasoningEffort": "medium" },
    "llmUsage": { "promptTokens": 180, "completionTokens": 120, "reasoningTokens": 60, "ttftMs": 420, "finishReason": "stop" },
    "crisis": { "detected": false, "category": null },
    "deliberationTrace": { "...": "Redis 里的 DeliberationTraceRecord；没拿到为 null" },
    "ts": "2026-11-05T10:01:00.000Z"
  }
}
```

> ⚠️ **`deliberationTrace` 第 1 轮恒为 `null`**（门面首轮跳过影子审议）。
> ⚠️ **`delta` 第 1 轮恒为 `null`**（没有上一轮快照可比）。

### 4.3 `DELETE /admin/api/debug/session/:id`

成功：`{ "sessionId": "debug_xxx", "closed": true }` · 不存在：`404`。

---

## 五、闸门数字

| 闸门 | 命令 | 结果 |
|---|---|---|
| ESLint | `npx eslint "src/**/*.ts" "test/**/*.ts"` | **0 error** |
| TypeScript | `npx tsc -p tsconfig.build.json --noEmit` | **0 error** |
| 测试 | `npx vitest run --exclude '**/e2e/**/*.ts'` | **107 文件 / 1817 例全绿**（WP68 基线 106 / 1790 → 本轮 **+1 文件 / +27 例**，既有 1790 例零回归） |
| 内核红线 | `git diff --stat HEAD -- src/engine-core` | **空** |
| 边界断言 | `test/engine-core/boundary.spec.ts` | 11 条全绿（随全量 vitest 一起跑） |

> 闸门用 `vitest run --exclude '**/e2e/**/*.ts'`（= 仓库 `pnpm test` 口径）。任务单 §7.2 写的是不带 `--exclude` 的 `npx vitest run` —— 不带 exclude 会把 e2e 拉进来，e2e 要真 DB / Redis，本机跑不了。

### 5.1 单测覆盖清单（27 例）

| 组 | 例数 | 内容 |
|---|---|---|
| ① 创建调试会话 | 3 | 合法 slug（含内核 open 的归属断言）/ 角色不存在 400 / 角色代号必填 400 |
| ② 发一轮对话 | 7 | 完整 trace / BDI 三维 + 阻抗三维 / delta 两轮口径 / 审议 trace 读出 / 第 1 轮无审议 trace / 会话不存在 404 / 空输入 400 |
| ③ 关闭调试会话 | 2 | 关句柄 + 内存清干净 / 不存在 404 |
| ④ 开关与鉴权 | 5 | 开关关 403 / 开关口径 5 态 / 等待上限口径 4 态 / class 级守卫断言 / 守卫三态（非 admin 403、admin 放行、basic 放行） |
| ⑤ 边界 | 3 | 不落库（源码扫描）/ engine-core 只 type-only import / 心理内容不进日志（打桩 `Logger` 断言） |
| ⑥ 模块装配 | 5 | 无循环依赖 / 依赖声明齐全 / 中间件挂载 / 三端点路径与方法 / 入参两名字同义 |
| ⑦ prompt 全文通道 | 2 | `buildPromptFull` 不截断 / 门面**按需**带出（要了才有） |

---

## 六、运维须知

### 6.1 两个新 env 键

| 键 | 缺省 | 口径 |
|---|---|---|
| `ENGINE_DEBUG_CHAT_ENABLED` | 非生产 **开** / 生产 **关** | 显式配了按配的来（`true/1/yes/on` 开）；没配 → `NODE_ENV` 不是 production/prod 时开 |
| `ENGINE_DEBUG_CHAT_DELIBERATION_WAIT_MS` | `5000` | 等审议 trace 的上限；非法值 / 负数回退默认；`0` = 不等（直接读一次） |

> ⚠️ **生产必须保持关闭** —— 这三个接口**能真跑引擎**（每轮一次 LLM 调用），开着就等于让持有 admin 凭据的人反复烧额度，且调试会话会占住内核会话与记忆仓储。

### 6.2 前端接线（前端 AI 负责，本单只补后端）

`admin-dashboard/src/views/DebugChat.vue` 里有 2 处注释掉的 TODO：
- `startSession()`（约 L88–96）→ `POST /admin/api/debug/session`，读 `data.sessionId`
- `sendTurn()`（约 L121–146）→ `POST /admin/api/debug/session/:id/turn`，body `{ counselorText }`，读 `data.trace`

`resetSession()` 目前只清本地状态，**没调 DELETE** —— 后端已备好 `DELETE /admin/api/debug/session/:id`（否则内核会话句柄会一直挂着）。

### 6.3 已知边界

1. **进程重启丢调试会话**（内存态，任务单 D1 已定）。
2. **多实例部署不共享**：调试会话在内核会话的进程内句柄表里，Nginx 轮询到另一实例会 404。调试场景建议单实例或粘性会话。
3. **审议 trace 偶发拿不到**：LLM 慢于等待上限 / 审议开关关 / 熔断中 → `null`。这是**如实反映**，不是 bug。
4. **prompt 全文只在渲染端口实现了流式时才有**（`LlmRenderAdapter` 实现了；若换成无流式能力的渲染端口会走"聚合收集成流"兜底，此时只有预览没有全文）。

---

## 七、遗留 / 后续建议

| # | 事项 | 归属 |
|---|---|---|
| 1 | 前端 `DebugChat.vue` 的 2 处 TODO 接线 + `resetSession()` 补 DELETE 调用 | 前端 AI |
| 2 | `debug-chat` 页面的"会话调试视图"其余部分（母版 WP58 描述里的 BDI 状态变更事件明细、delta cap 砍幅）—— 本单给了 `delta` / `deltaDetail`，**cap 砍幅报告（`capReport`）与信念激活（`beliefActivation`）未接**（内核不对外这两项的逐轮明细） | 前端 AI / 后续单 |
| 3 | 母版 WP58 的"触发了什么事件"（`deltaDetail.events`）—— 需要内核暴露逐事件明细，属内核改动，另开单 | 后续单 |
| 4 | 调试会话的 TTL / 容量上限（现在只靠 admin 手动 DELETE） | 后续单 |

---

_本记录由后端 AI 生成，遵循 `docs/team/conventions.md` §二 的交付格式。_
