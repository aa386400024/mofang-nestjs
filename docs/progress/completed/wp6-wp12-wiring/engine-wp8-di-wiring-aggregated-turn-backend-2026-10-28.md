# WP8-A · 引擎 NestJS 装配 + 聚合 turn 生产接线（把 WP6/WP7 纯单元接进 DI，真实调 LLM，先跑通聚合闭环）后端任务单

> 母版: [`../architecture/ai-engine-roadmap-v1.1.md`](../architecture/ai-engine-roadmap-v1.1.md) ｜ backlog [`./phase1-integration-backlog-2026-10-28.md`](./phase1-integration-backlog-2026-10-28.md) WP8
> 前置（均已交付并复跑绿）: WP0 边界骨架 / WP1 BDI / WP2 分层记忆 / WP3 轨迹 / WP4 伦理 / WP5 渲染契约 / WP6 LlmRenderAdapter + 主备执行 / WP7 RenderSpec 组装 + turn 填 reply + 成对记忆
> 仓库: `E:\Work\Project\backend\mofang-nestjs`
> 日期: 2026-10-28 ｜ 类型: **NestJS 装配层（`src/engine-adapters/wiring/`，新增）**，首次把纯单元接进依赖注入、首次在生产路径真实调用 LLM
> 目标读者: 后端；闸门命令由大炮在 Windows PowerShell 复跑 `eslint` / `tsc` / `jest`
> **状态**: 🟢 **已交付并自跑复跑绿**（eslint 0 / tsc 0 / jest engine-adapters 4 套件 81 用例全绿、engine-core 7 套件 177 用例全绿零回归）
> 交付记录: [`engine-wp8-di-wiring-aggregated-turn-implementation-2026-10-28.md`](./engine-wp8-di-wiring-aggregated-turn-implementation-2026-10-28.md)
> 分期说明: backlog 原 WP8 =「接 WS/vpt + 流式 + 灰度切旧」。因 WP6 的 `RenderPort.render` 与 WP7 的 `turn()` 当前都是**聚合一次性返回**，token 级流式需先扩窄面，且现有 `voice.service` 的 WS/TTS/barge-in 是成熟链路，本期先交付 **8-A 聚合生产接线闭环**（DI + 真实 LLM + 归属/prompt 缝 + open/turn/close），**8-B 流式增量 + WS 对接 + 灰度切旧** 紧随其后单独立单（见 §11），不在本单硬塞，避免一次性改成熟语音链路。

---

## 0. 一句话目标

WP6/WP7 交付的是「可脱离 NestJS 容器 `new` 出来、全 mock 可测」的纯类，但**没有任何一个被 DI 真正装配、也没有在生产路径真实调一次 LLM**。WP8-A 在 NestJS 侧写一个装配模块：用 `LlmRouterService.chat` 包出 WP6 需要的窄面 `ChatCaller`，把 `InMemoryEngineSession` / `LlmRenderAdapter` / `TurnRenderOrchestrator` 用真实实现注册成可注入单例，补上 WP7 留给本期的两道缝（`resolveSession` 归属注入、`buildMessages` prompt 缝接线），对外提供一个 `open → turn(咨询师文本) → close` 的门面服务，并配一个**聚合（非流式）**调试端点用 curl 就能验证「咨询师发一句 → 来访回一句真实文本 → BDI 快照变化可见」。本期**不碰 WS、不做 token 流式、不替换/灰度旧语音链路、不接 TTS**（归 8-B）。

> 为什么先聚合后流式：WP7 门面 `turn()` 返回的是整段 `reply`，WP6 `ChatCaller` 只有聚合 `chat()`。流式必须先给窄面加 `streamChat` 变体并让 `RenderPort` 能吐 chunk，这是独立改动；先把「决策→真实说话→成对记忆→归属」这条主干在聚合态打通，流式只换「怎么把一段 reply 变成增量」，风险最小。

---

## 1. 范围与 Done 定义

### 1.1 本期做到（In Scope · WP8-A）

1. **生产 `ChatCaller` 适配**（`src/engine-adapters/wiring/router-chat-caller.ts`）：
   - 实现 WP6 导出的窄面 `ChatCaller`（`chat(req: ChatCompletionRequest, providerId?: string): Promise<ChatCompletionResponse>`）；
   - 内部委托现有 `LlmRouterService.chat(req, { providerId })`，**不复制** router 的 provider 注册 / apiKey 解析 / 未注册回落默认逻辑；
   - 不新增对 `LlmRouterService` 具体实现以外的依赖，不在此层做冷却/重试（那是 WP6 适配器内部职责）。
2. **渲染适配器装配**（`engine.module.ts` 的 provider 工厂）：
   - 用 `createRenderAdapterConfig(candidates, overrides)` 构造 `RenderAdapterConfig`，候选序列与参数从 `ConfigService`/env 读，缺省走 WP6 种子值；
   - 构造 `LlmRenderAdapter` 时注入：`caller`（上一项）、`config`、`buildMessages = buildVisitorMessages`（WP7 导出，**这就是 WP7 留给本期的 prompt 缝**）、`guard = createVisitorOutputGuard()`（WP6 同文件 441 行导出的工厂）、`onSafetySignal`（接 Nest `Logger` 记录 block/warn，信号不进返回体）。
3. **内核会话装配**：注册一个 `EngineSessionPort` 单例 = `new InMemoryEngineSession({ bdiStates, memories, idFactory?, now? })`：
   - `bdiStates`：本期用 `InMemoryBdiStateRepository`（内存起步，落库仓储是后续轮）；
   - `memories`：优先用现有 `QdrantMemoryStore`（其内置内存回落仓 `fallback`），Qdrant 不可达/未配置时回落 `InMemoryMemoryStore`；**不要新造记忆实现**；
   - 不注入自定义 classifier/riskProbe，走内核规则轨缺省。
4. **门面 `TurnRenderOrchestrator` 装配 + 归属缝**：
   - 注入 `session`（上一项）、`renderer`（WP6 适配器）、`memories`（与内核同一 MemoryStore 实例）；
   - 注入 `resolveSession(handleId)`：由装配层自己维护的 `handleId → TurnSessionContext { tenantId, sessionId, visitorId }` 登记表提供；查不到返回 `undefined`（门面会跳过来访半边记忆写入并告警，**不断流、不抛错**）；
   - **不要**同时传 `sessionContext`（那是单会话固定归属，多会话用 `resolveSession`，二者解析函数优先，避免双写冲突）。
5. **门面服务 `EngineTurnService`（@Injectable）**：对外封装生命周期
   - `open(input: { sessionId, tenantId, visitorId, seed?, resumeFromSessionId?, characterProfile? }): { handleId, sessionId }`：调 `session.openSession(input)`，成功后把 `handleId → { tenantId, sessionId, visitorId }` 写进归属登记表；重复 `sessionId` 已开时让内核 `SESSION_ALREADY_OPEN` 原样冒泡；
   - `turn(handleId, { userText, traceId? }): Promise<TurnRenderResult>`：直接委托 `orchestrator.turn(handleId, { userText, traceId })`，内核错误（ABORTED/INVALID_INPUT/SESSION_NOT_FOUND/STATE_CONFLICT）原样冒泡，门面只兜渲染层；
   - `close(handleId)`：先调 `orchestrator.forgetSession(handleId)` 清门面历史，再调 `session.closeSession(handleId)`（内核幂等，未知句柄不抛），最后从归属登记表删除；`finally` 保证清理。
6. **env 配置面**（从 `ConfigService` 读，缺省全部回种子，不强制每个键都配）：候选序列、主备 providerId、chat/stable 温度、模型名、maxTokens、超时、冷却阈值/基数/上限、兜底话术；键名与默认值见 §5。
7. **聚合调试端点**（JWT 保护，仅用于联调，不面向前端正式路径）：`open` / `turn` / `close` 三个路由，`turn` **一次性返回完整 `TurnRenderResult`**（非 SSE、非 chunk）；复用现有 `JwtAuthGuard` 与 `@TenantId()/@UserId()`。
8. 单测（`test/engine-adapters/wp8-wiring.spec.ts`）覆盖 §8 清单，全 mock，不起真实 LLM、不连 Qdrant。

### 1.2 明确不做（Out of Scope · 归 8-B / 后续轮）

| 不做项 | 归属 |
|---|---|
| token 级流式：扩 `ChatCaller.stream` / `RenderPort.stream`、SSE/WS 增量推送、首 token、chunk 聚合 | WP8-B |
| 接入现有 `voice.service` WS 双工、TTS 出声、barge-in / abort 断流对接 | WP8-B |
| 新引擎与旧 `agent/visitor` 直出链路的灰度开关、按会话切换、一键回退 | WP8-B |
| 5Ps 角色真实注入开场基线、resume 携带 openingContext 的完整装配 | WP9（角色资产池） |
| BDI 状态 MySQL/TypeORM 落库、长时记忆持久化标定、冲突标记原地写 | 后续轮（本期内存/Qdrant 现状） |
| token 计费、成本看板、限流、预算告警埋点 | 后期运营轮 |
| 改动 `src/engine-core/` 任何文件 | **禁止**（内核零改动，既有 177 用例零回归） |
| 改动 `src/llm/` 内部（router/provider/config/注册） | **禁止**（只调用公开 `chat`） |
| 改动 `src/voice/`、`src/agent/visitor/`、`src/counselor/` 现有 vpt 链路 | **禁止**（本期并存，不替换） |
| 建表 / migration / entity | 本期无 |

### 1.3 与现有模块的关系（别重复造）

- **`src/llm`（LlmRouterService）**：唯一调用出口，已负责 provider 注册、apiKey、未注册回落默认；本单只包一层 `ChatCaller`，不改它。
- **WP6 `LlmRenderAdapter` / `createRenderAdapterConfig` / `createVisitorOutputGuard`**：直接用，不重写主备、冷却、guard 逻辑。
- **WP7 `TurnRenderOrchestrator` / `buildVisitorMessages` / `buildRenderSpec`**：直接用，不重写规格组装与成对记忆。
- **旧 `src/agent/visitor/visitor.service.ts`（内存 Map + 自拼 prompt）**：本期**并存不动**，8-B 才谈灰度切换。
- **`src/voice/voice.service.ts` + `vpt-session-bridge.service.ts`**：本期不接入；open/turn/close 的语义对齐在 8-B 做。

---

## 2. 边界红线（装配层版）

- **`src/engine-core/` 整树零改动**：不新增导出、不改纯函数、不改端口签名；`boundary.spec.ts` 不要求为本单更新。
- **`src/llm/` 零改动**：只调用公开 `chat`，不修改 router/provider/config/注册/回落。
- **`src/voice/`、`src/agent/visitor/`、`src/counselor/` 零改动**：本期新引擎与旧链路物理隔离，新模块自成一家。
- 装配层只做「接线」：读 env → 构造纯对象 → 注入；**不在装配层写决策、不拼系统 prompt、不组装 RenderSpec**（那些分别在内核 / WP7）。
- 不在调试端点泄漏 apiKey、厂商私有字段、完整系统 prompt；`TurnRenderResult` 只透传既有字段（reply/snapshot/turnIndex/intention/render/trajectoryTrace/safety/openingContext）。
- 不新建数据库表、不写 migration、不引入新的全局单例竞争（`EngineSessionPort` 等注册为模块内单例即可）。

---

## 3. 目录落点

```
src/engine-adapters/wiring/                    【新目录 · NestJS 装配层】
├── engine.module.ts                           【新】@Module: 注册内存仓储/会话/适配器/门面/服务/调试控制器
├── router-chat-caller.ts                      【新】LlmRouterService.chat → 窄面 ChatCaller
├── engine-turn.service.ts                    【新】@Injectable 门面: open/turn/close + 归属登记表
├── engine-wiring.controller.ts               【新】聚合调试端点 open/turn/close（JWT）
└── render-config.factory.ts                   【新】从 ConfigService 读 env → createRenderAdapterConfig

test/engine-adapters/
└── wp8-wiring.spec.ts                         【新】全 mock 单测
```

> `src/engine-adapters/rendering/`（WP6/WP7）、`embedder/`、`persistence/` 不动。

---

## 4. 类型契约（可直接施工，均为既有导出，勿改签名）

### 4.1 窄面（WP6 已导出，只实现不修改）

```ts
// 来自 src/engine-adapters/rendering/llm-render.adapter.ts
export interface ChatCaller {
  chat(req: ChatCompletionRequest, providerId?: string): Promise<ChatCompletionResponse>;
}
```

生产实现：

```ts
// router-chat-caller.ts（示意，以实际 LlmRouterService.chat 签名为准）
@Injectable()
export class RouterChatCaller implements ChatCaller {
  constructor(private readonly router: LlmRouterService) {}
  chat(req: ChatCompletionRequest, providerId?: string) {
    return this.router.chat(req, { providerId });
  }
}
```

> 开工先 `Read` `src/llm/registry/llm-router.service.ts` 确认 `chat` 的第二参数形状（`{ providerId, uid? }`），按真实签名透传，不要臆造字段。

### 4.2 渲染适配器装配（WP6 既有 deps，照传）

```ts
new LlmRenderAdapter({
  caller: routerChatCaller,                       // §4.1
  config: renderConfigFactory.build(configService), // §5
  buildMessages: buildVisitorMessages,            // WP7 导出 = prompt 缝
  guard: createVisitorOutputGuard(),              // WP6 同文件导出
  onSafetySignal: (text, level, categories) => logger.warn(...),
})
```

### 4.3 门面装配与归属登记（WP7 既有 deps）

```ts
new TurnRenderOrchestrator({
  session: engineSessionPort,        // InMemoryEngineSession 单例
  renderer: llmRenderAdapter,        // §4.2
  memories: memoryStore,              // 与内核同一实例
  resolveSession: (handleId) => this.registry.get(handleId), // §4.4 归属缝
  // 不传 sessionContext（多会话，二选一）
});
```

归属上下文（WP7 `TurnSessionContext`，勿改）：

```ts
interface TurnSessionContext {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly visitorId: string;
}
```

### 4.4 `EngineTurnService` 门面签名（本期新增）

```ts
@Injectable()
export class EngineTurnService {
  /** 开会话: 内核 openSession + 登记归属. 返回 { handleId, sessionId }. */
  open(input: {
    readonly sessionId: string;
    readonly tenantId: string;
    readonly visitorId: string;
    readonly seed?: string;
    readonly resumeFromSessionId?: string;
    readonly characterProfile?: unknown;
  }): { readonly handleId: string; readonly sessionId: string };

  /** 一轮: 委托 orchestrator.turn, 错误原样冒泡. 返回完整 TurnRenderResult (聚合). */
  turn(handleId: string, input: { readonly userText: string; readonly traceId?: string }):
    Promise<TurnRenderResult>;

  /** 关会话: forgetSession → closeSession(幂等) → 清归属, finally 保证清理. */
  close(handleId: string): void;
}
```

> `characterProfile` / `resumeFromSessionId` 的精确类型以 `OpenEngineSessionInput`（`src/engine-core/domain/engine-session.types.ts`）为准，开工先 Read 对齐，不要自创。

---

## 5. 配置面（env → ConfigService，缺省回 WP6 种子）

| env 键（建议名） | 含义 | 缺省（回种子，非标定） |
|---|---|---|
| `ENGINE_RENDER_PRIMARY_PROVIDER` | 主候选 providerId（对齐已注册 AIProviderId） | 默认 provider（router 回落） |
| `ENGINE_RENDER_FALLBACK_PROVIDERS` | 备候选 id 列表（逗号分隔） | 空（仅主） |
| `ENGINE_RENDER_CHAT_TEMPERATURE` | chat 层温度 | 0.85 |
| `ENGINE_RENDER_STABLE_TEMPERATURE` | stable 层温度 | 0.2 |
| `ENGINE_RENDER_CHAT_MODEL` | chat 模型名（可被候选 overrides 覆盖） | 由 provider 默认 |
| `ENGINE_RENDER_MAX_TOKENS` | 完成 token 上限 | 取 `RenderSpec.tokenBudget`（160） |
| `ENGINE_RENDER_TIMEOUT_MS` | 单次调用超时 | 30000 |
| `ENGINE_RENDER_FAILURE_THRESHOLD` | 连续失败进冷却阈值 | 3 |
| `ENGINE_RENDER_COOLDOWN_BASE_MS` | 冷却基数 | 30000 |
| `ENGINE_RENDER_COOLDOWN_MAX_MS` | 退避封顶 | 300000 |
| `ENGINE_RENDER_FALLBACK_UTTERANCE` | 兜底中性话术 | `……我先缓一下，我们接着说。` |

> 所有键**可选**：未配置即回种子，不要求本期改 `.env.example` 以外的部署；键名由装配层统一解析，装配层是唯一读 env 的地方，适配器/内核仍零 env。

---

## 6. 异常与边界语义

- **内核错误原样冒泡**：`ABORTED` / `INVALID_INPUT`（userText 空白）/ `SESSION_NOT_FOUND` / `STATE_CONFLICT` / `SESSION_ALREADY_OPEN` 不被门面吞掉，交给控制器归一为 HTTP 错误；门面只兜「渲染这一层」（异常/空文本→兜底句，`fallbackUsed=true`）。
- **归属查不到**：`resolveSession` 返回 `undefined` 时门面跳过来访半边记忆写入并告警，**不得抛错、不得断流**（WP7 既有语义，保持）。
- **close 幂等**：未知/已关 handleId 调 close 不抛错；归属登记表清理放在 `finally`。
- **重复 open 同 sessionId**：内核抛 `SESSION_ALREADY_OPEN`，门面不静默复用旧句柄。
- **LLM 主备全挂 / 仍 block**：返回兜底中性句 + `fallbackUsed=true` + `providerHint='degraded'`，HTTP 200，不 500。
- **调试端点不泄漏**：不回显 apiKey、系统 prompt 全文、厂商私有原始响应。

---

## 7. 调试端点契约（聚合，非流式）

- `POST /engine/debug/open`：body `{ sessionId, visitorId, seed?, resumeFromSessionId?, characterProfile? }`；tenantId 取 JWT；返回 `{ handleId, sessionId }`。
- `POST /engine/debug/turn`：body `{ handleId, userText, traceId? }`；**一次性**返回完整 `TurnRenderResult`（`reply / snapshot / turnIndex / intention? / render{fallbackUsed,providerHint,usage} / trajectoryTrace? / safety? / openingContext?`）。
- `POST /engine/debug/close`：body `{ handleId }`；返回 `{ ok: true }`。
- 全部 `@UseGuards(JwtAuthGuard)`；仅联调使用，路由命名带 `debug`，不挂到前端正式 vpt 路径。

---

## 8. 单测清单（`test/engine-adapters/wp8-wiring.spec.ts`，全 mock）

1. `RouterChatCaller.chat` 把 `req` 与 `providerId` 透传给 `LlmRouterService.chat`，原样返回 response。
2. 装配后 `LlmRenderAdapter` 收到的 `buildMessages` 是 `buildVisitorMessages`、`guard` 是 `createVisitorOutputGuard()` 产物（构造 deps 断言）。
3. `open` 成功后归属登记表含 `handleId → { tenantId, sessionId, visitorId }`；`turn` 时 `resolveSession` 能取到归属。
4. `open` 前未登记归属的 handleId 走 `resolveSession=undefined`：门面写记忆被跳过、不抛错（用 WP7 既有行为断言，不在本侧重写）。
5. `close` 后：`orchestrator.forgetSession` 被调、`session.closeSession` 被调、归属表条目被删；对未知 handleId close 不抛。
6. `turn` 透传内核错误（mock session.turn reject `SESSION_NOT_FOUND`），门面不吞、原样向上抛。
7. 渲染层异常/空文本时仍返回兜底句（`fallbackUsed=true`），不 reject。
8. 配置工厂：env 缺省时全部回种子；提供 `ENGINE_RENDER_CHAT_TEMPERATURE` 时覆盖到 config。
9. 不出现对真实 Qdrant / 真实 LLM 的连接依赖（内存仓储 + mock caller）。

---

## 9. 验收（Done 的可观察标准）

- `npx tsc -p tsconfig.build.json --noEmit` 0 错；`eslint` 0 error；`jest` 新增套件全绿且 engine-core / engine-adapters 既有套件零回归。
- 用调试端点 curl：open → turn（咨询师一句普通文本）→ 返回**非空真实 reply**（mock 环境可断言调用链走到 caller），`turnIndex` 递增，`snapshot` 可见；再 turn 一轮；close 后归属清空。
- 旧 `agent/visitor`、`voice`、`counselor` 模块文件零改动（`git status` 确认仅新增 wiring 目录 + 本单文档）。
- engine-core 目录零改动。

---

## 10. 闸门命令（大炮在 Windows PowerShell 复跑，后端勿在 WSL 代跑）

```powershell
cd E:\Work\Project\backend\mofang-nestjs
npx tsc -p tsconfig.build.json --noEmit
npm run lint
npx jest test/engine-adapters/wp8-wiring.spec.ts
npx jest test/engine-adapters test/engine-core   # 回归零红
```

---

## 11. 交接给 WP8-B（本单不做，写清边界避免返工）

WP8-B 将在本期聚合闭环之上做「端到端一句真实对练」：

1. **流式窄面**：给 `ChatCaller` 加 `stream(req, providerId?, signal?)` 委托 `LlmRouterService.streamChat`（AsyncIterable\<ChatCompletionChunk\> + AbortSignal），并让 `RenderPort`/门面支持吐 chunk（或在门面层把聚合 reply 包成增量，二选一，开工先评估）。
2. **接 WS/vpt**：把 `EngineTurnService` 挂进 `voice.service` 的生成位，复用其现有 `llmAbort` AbortController、generation 防旧流、barge-in、TTS task_cancel；`open/close` 与 `vpt-session-bridge` 生命周期对齐。
3. **灰度切旧**：env 开关/按会话在新引擎与旧 `agent/visitor` 直出间切换，保留一键回退；保证既有前端语音播放与落库不破。
4. 首 token 延迟、断网/超时/中止（ABORTED）不挂死。

> 8-B 开工前先 Read 本单 §1.2 与 `voice.service.ts` 的 abort/barge-in 段，不在本期预埋未验证的流式代码。

---

## 12. 交付状态

**代码已交付并自跑复跑绿**，逐条对照见交付记录
[`engine-wp8-di-wiring-aggregated-turn-implementation-2026-10-28.md`](./engine-wp8-di-wiring-aggregated-turn-implementation-2026-10-28.md)。

### 与本任务单的**两处显式差异**（已记录，非绕过）

1. **`src/app.module.ts` 有 1 处改动**（追加 1 行 import + imports 数组追加 `EngineWiringModule`）。
   §9 写「`git status` 确认仅新增 wiring 目录 + 本单文档」，但 §9 同时要求「用调试端点 curl 跑通 open → turn → close」——**端点必须注册进 `AppModule` 才有**，否则路由不存在、`curl` 无从谈起。
   该文件**不在 §1.2 禁止清单**内，且**不替换**任何既有模块：新旧链路并存，`AIEngineModule` / `VoiceModule` 原样保留。
2. **新增 `src/engine-adapters/wiring/engine.tokens.ts` 与 `engine.providers.ts`** 两个 §3 未列出的文件。
   - `engine.tokens.ts`：内核三个端口是 **interface**，编译后**没有运行时值**，不能当 Nest provider token；必须用 `Symbol`（字符串 token 会静默撞车注入错依赖）。独立成文件同时打破 `module → service → module` 循环依赖。
   - `engine.providers.ts`：把**构造逻辑**从 `@Module` 的 `useFactory` 里抽成纯工厂。`useFactory` 里的代码**单测覆盖不到**（要测就得拉起整个 Nest 容器，含 `AIEngineModule` 的 TypeORM entities / `UserModule` / LangChain `RagService`），于是"装配对不对"只能等启动时炸。抽成纯工厂后模块只声明「token ↔ 工厂」映射，工厂只造对象，两段都能被单测覆盖。

> 交付记录落点：`engine-wp8-di-wiring-aggregated-turn-implementation-2026-10-28.md`（已建），记录了注册了哪些 provider、env 键实际取值、归属登记实现方式、调试端点路由、单测用例数、回归结果、遗留到 8-B 的缺口。
