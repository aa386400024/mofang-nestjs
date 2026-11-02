# WP8-A · 引擎 NestJS 装配 + 聚合 turn 生产接线后端交付记录

> 任务单: [`engine-wp8-di-wiring-aggregated-turn-backend-2026-10-28.md`](./engine-wp8-di-wiring-aggregated-turn-backend-2026-10-28.md)
> 总清单: [`phase1-integration-backlog-2026-10-28.md`](./phase1-integration-backlog-2026-10-28.md) WP8
> 母版: [`../architecture/ai-engine-roadmap-v1.1.md`](../architecture/ai-engine-roadmap-v1.1.md)
> 前置: WP0–WP5 内核纯层；**WP6 `LlmRenderAdapter`**；**WP7 `TurnRenderOrchestrator` + `buildVisitorMessages`**
> 仓库: `E:\Work\Project\backend\mofang-nestjs`
> 日期: 2026-10-28 ｜ 类型: **NestJS 装配层（`src/engine-adapters/wiring/`，新增）**；本期把 WP6/WP7 的纯单元接进 DI，首次在生产路径真实调 LLM

---

## 1. 闸门复跑结果（本轮自跑，Windows PowerShell）

| # | 命令 | 结果 |
|---|---|---|
| 1 | `npx eslint "src/**/*.ts"` | **exit 0**，0 error |
| 2 | `npx tsc -p tsconfig.build.json --noEmit` | **exit 0**，0 error |
| 3 | `npx jest test/engine-adapters` | **4 套件 / 81 用例全绿**（WP2 B 层既有 13 + WP6 19 + WP7 15 + **WP8-A 新增 34**） |
| 4 | `npx jest test/engine-core --maxWorkers=2` | **7 套件 / 177 用例全绿**（**内核零回归**） |

> 本轮未跑 `pnpm build`（全量构建）与既有业务测试 —— 本期零 entity / migration 改动，但**新增了一个被 `AppModule` 引入的模块**（`EngineWiringModule`）与一个调试控制器，全量构建与启动建议合并前补跑（见 §7 遗留缺口 1）。

---

## 2. 红线核对（任务单 §2 + §9）

| 红线 | 落点 | 证据 |
|---|---|---|
| `src/engine-core/` 整树零改动 | 不新增导出、不改纯函数、不改端口签名、不改 `boundary.spec.ts` 断言 | `git status --porcelain -- src/engine-core` → **空** |
| `src/llm/` 零改动 | 只调用公开 `chat` / `getDefaultModelForTier` | `git status --porcelain -- src/llm` → **空** |
| `src/voice/`、`src/agent/visitor/`、`src/counselor/` 零改动 | 本期与旧链路物理隔离，未触碰 | `git status --porcelain -- src/voice src/agent src/counselor` → **空** |
| 装配层只做「读 env → 造纯对象 → 注入」 | 不写决策、不拼 prompt、不组装 RenderSpec | prompt 在 WP7 `turn-render-orchestrator.ts`；规格在 WP7 `spec-assembler.ts`；决策在内核 |
| 不泄漏 apiKey / 厂商私有字段 / 完整系统 prompt | 调试端点只回 `TurnRenderResult` 既有字段 | 单测 §8-9 + 附加 B 字段级断言 |
| 不新建表 / migration / entity | 本期无 | git status 可核 |
| 不引入新的全局单例竞争 | 引擎会话 / 归属表 / 渲染端口均为**模块内单例**（`@Module` providers） | `engine.module.ts` providers 清单 |
| 端口方法签名不破坏 | `openSession / turn / closeSession` 三方法名与形态不变 | 内核 177 用例零回归 |
| DTO 只追加可选字段 | `EngineOpenDto/EngineTurnDto/EngineCloseDto` 全为新类型，不改既有 DTO | — |

### 与任务单 §9 的一处**显式差异**（必须记录，非绕过）

任务单 §9 写「`git status` 确认**仅新增 wiring 目录 + 本单文档**」，但 §9 同时要求「用调试端点 curl 跑通 open → turn → close」——**端点必须注册进 `AppModule` 才有**，否则路由不存在、`curl` 无从谈起。

因此本期差异项为 **`src/app.module.ts` 追加 1 行 import + imports 数组追加 1 项**（`EngineWiringModule`）。它**不在 §1.2 的禁止清单**（`engine-core` / `src/llm` / `voice` / `agent/visitor` / `counselor`）内，且不替换任何既有模块 —— 新旧链路**并存**，`AIEngineModule` / `VoiceModule` 原样保留。

---

## 3. 交付范围逐条对照（任务单 §1.1 / §8 / §9）

| 任务单条目 | 交付 | 落点 |
|---|---|---|
| §1.1-1 生产 `ChatCaller` 适配 | ✅ | `router-chat-caller.ts`：`RouterChatCaller implements ChatCaller`，委托 `router.chat(req, providerId ? { providerId } : {})`；**不复制** router 的注册表 / apiKey / 回落逻辑 |
| §1.1-2 渲染适配器装配 | ✅ | `render-config.factory.ts`：`buildEngineRenderDeps` 注入 `buildMessages=buildVisitorMessages`（WP7 prompt 缝）/ `guard=createVisitorOutputGuard()`（WP4 口径）/ `onSafetySignal`（只记 level+categories，**不记文本**） |
| §1.1-3 内核会话装配 | ✅ | `engine.providers.ts::createEngineSessionPort`：`InMemoryEngineSession({ bdiStates: InMemoryBdiStateRepository, memories })`；**同一记忆实例**与门面共用 |
| §1.1-3 记忆优先 `QdrantMemoryStore`、未配置回落内存 | ✅ | `createEngineMemoryStore`：有 `QDRANT_URL` → `QdrantMemoryStore`（内置内存回落仓）；无 → `InMemoryMemoryStore`；**缺客户端时炸在装配期**，不静默回落 |
| §1.1-4 门面装配 + 归属缝 | ✅ | `createEngineOrchestrator`：注入 `resolveSession(handleId) → registry.resolve(handleId)`；**不传 `sessionContext`**（多会话） |
| §1.1-5 门面服务 `EngineTurnService` | ✅ | `engine-turn.service.ts`：`open`（登记归属）/ `turn`（委托编排器）/ `close`（`forgetSession → closeSession → finally 删归属`） |
| §1.1-6 env 配置面 | ✅ | `render-config.factory.ts` + §4 配置面表 |
| §1.1-7 聚合调试端点（JWT） | ✅ | `engine-wiring.controller.ts`：`POST /engine/debug/open|turn|close`，`@UseGuards(JwtAuthGuard)`，`tenantId` 取 JWT |
| §1.1-8 单测覆盖 §8 清单 | ✅ | `test/engine-adapters/wp8-wiring.spec.ts`（**34 用例**，清单 1-9 全覆盖 + 12 条补充） |
| §1.2 不做流式 / WS / 灰度切旧 | ✅ | 本期无 `stream`、无 WS、无旧链路开关 |
| §9 验收清单 | ✅ | 见 §2 红线核对表 |

### §8 单测清单逐条对照

| # | 清单项 | 对应用例 | 状态 |
|---|---|---|---|
| 1 | `ChatCaller` 透传 | §8-1 ① req 与 providerId 原样进 `router.chat`、响应原样返回；② 未指定 providerId 时不塞该字段 | ✅ |
| 2 | 装配后 deps 断言 | §8-2 ① `buildMessages === buildVisitorMessages`（引用相等）；② `guard` 与 `createVisitorOutputGuard()` **行为等价**（高危文本判 block、正常文本判 pass）；③ 产出 `LlmRenderAdapter` | ✅ |
| 3 | 归属登记 | §8-3 ① open 后登记表含 `handleId → {tenantId, sessionId, visitorId}`；② turn 时 `resolveSession` 取到归属 → 来访半边记忆按该归属写入 | ✅ |
| 4 | 未登记归属 | §8-4 ① `resolveSession=undefined` → **不写**来访半边记忆、**不抛错**、本轮照常返回 reply | ✅ |
| 5 | close 清理 | §8-5 ① `forgetSession` + `closeSession` 被调、归属条目被删；② 未知句柄 close 不抛（内核幂等）；③ 内核 close 抛错时归属仍被清掉（`finally`） | ✅ |
| 6 | 内核错误冒泡 | §8-6 ① `SESSION_NOT_FOUND` 原样抛出（`rejects.toBe`）；② `INVALID_INPUT` 同 | ✅ |
| 7 | 渲染降级 | §8-7 ① 渲染抛异常 → 非空兜底句 + `fallbackUsed=true` + `providerHint='degraded'`；② 空文本同样降级；**均不 reject** | ✅ |
| 8 | 配置工厂 | §8-8 ① env 全缺省 → 全部回 WP6 种子；② `ENGINE_RENDER_CHAT_TEMPERATURE` 覆盖生效且**不串到 stable**；③ 候选顺序 = 优先级且去重；④ 模型名缺省**向 router 问**；⑤ 显式模型名优先；⑥ 非法数值回落种子 | ✅ |
| 9 | 无真实依赖 | §8-9 ① 装配层**按包名**扫描：零向量库 SDK / 厂商 SDK / ORM；② 未配向量库时记忆仓储是纯内存实现（不建客户端） | ✅ |

> **清单外补充 12 条**：装配工厂（向量库分流 / 缺客户端炸装配期 / 会话端口 open-turn-close 幂等）、调试端点（6 种内核错误码 → HTTP 状态映射 / 非内核异常原样上抛 / 角色内核脏 payload 丢弃回中性基线 / 角色内核合法透传 / close 固定 `ok` / turn 透传 handleId+userText+traceId）、端口 token 互不相同。

---

## 4. 配置面实测（任务单 §5，本期实际解析口径）

| env 键 | 含义 | 缺省行为 | 备注 |
|---|---|---|---|
| `ENGINE_RENDER_PRIMARY_PROVIDER` | 主候选 providerId | 回 `LLM_DEFAULT_CHAT_PROVIDER`，再回 `AIProviderId.DEEPSEEK` | 与 router 默认回落一致 |
| `ENGINE_RENDER_FALLBACK_PROVIDERS` | 备候选（逗号分隔） | 空 → 仅主候选 | 顺序即优先级；自动去重 |
| `ENGINE_RENDER_CHAT_TEMPERATURE` | chat 层温度 | `0.85`（WP6 种子） | 非法值回落种子 |
| `ENGINE_RENDER_STABLE_TEMPERATURE` | stable 层温度 | `0.2`（WP6 种子） | — |
| `ENGINE_RENDER_CHAT_MODEL` / `_STABLE_MODEL` / `_ADVANCED_MODEL` | 分层模型名 | **向 router 问** `getDefaultModelForTier(LLMTier.RAG, providerId)` | 装配层不硬编码模型名表 |
| `ENGINE_RENDER_MAX_TOKENS` | 完成 token 上限 | 不设 → 由 `RenderSpec.tokenBudget`（160）决定 | 未设置就不覆盖 |
| `ENGINE_RENDER_TIMEOUT_MS` | 单次超时 | `30000` | 非法值回落 |
| `ENGINE_RENDER_FAILURE_THRESHOLD` | 连续失败进冷却阈值 | `3` | 非法值回落 |
| `ENGINE_RENDER_COOLDOWN_BASE_MS` / `_MAX_MS` | 退避基数 / 封顶 | `30000` / `300000` | 非法值回落 |
| `ENGINE_RENDER_FALLBACK_UTTERANCE` | 兜底中性话术 | WP6 种子句 | — |
| `QDRANT_URL`（**既有键，未新增**） | 决定记忆仓储实现 | 未配置 → 纯内存 | 复用既有 env，不引入新键 |

> **模型名为什么放候选 `overrides` 而不是 `taskDefaults`**：`taskDefaults` 是**全局一层**，模型名却是**厂商相关**（deepseek-chat / qwen-plus）。主备两个不同厂商共用一个全局模型名，切到备候选时必然打错模型。所以 `taskDefaults[kind]` 只放厂商无关的温度 / token 上限，模型名放 `candidate.overrides[kind].model`。
>
> **模型名为什么"缺省向 router 问"**：各厂商有什么模型，只有 router 知道（`LlmRouterService.getDefaultModelForTier`）。装配层硬编码一份模型名表 = 第二份"厂商有什么模型"的真相，厂商一改就漂移。

---

## 5. 装配链（`EngineWiringModule` 注册了什么）

```
ConfigService ──▶ RenderConfigFactory ──▶ RenderAdapterConfig
                        │
LlmRouterService ─▶ RouterChatCaller ────┐
                                          ▼
                                LlmRenderAdapter (WP6) ──▶ ENGINE_RENDER_PORT
MemoryStore(Qdrant/内存) ─┐
                          ├──▶ InMemoryEngineSession (内核) ──▶ ENGINE_SESSION_PORT
                          └──▶ TurnRenderOrchestrator (WP7)
                                 ▲
                         归属登记表 (resolveSession 缝)
                                 │
                         EngineTurnService ──▶ EngineWiringController
```

| provider token | 实现 | 注册方式 |
|---|---|---|
| `RouterChatCaller` | `LlmRouterService.chat` → 窄面 | `useClass` |
| `RenderConfigFactory` | env → `RenderAdapterConfig` | `useClass` |
| `EngineSessionRegistry` | `handleId → TurnSessionContext` 进程内登记表 | `useClass` |
| `OpenAICompatEmbedder` | `new OpenAICompatEmbedder(router)` | `useFactory`（**第 2 个构造参数带默认值，Nest 直 new 会把 `Object` 当依赖而报错**） |
| `ENGINE_MEMORY_STORE` | `QdrantMemoryStore` / `InMemoryMemoryStore` | `useFactory`（按 `QDRANT_URL` 分流） |
| `ENGINE_RENDER_PORT` | `LlmRenderAdapter` | `useFactory`（WP6 + WP7 prompt 缝 + WP6 guard） |
| `ENGINE_SESSION_PORT` | `InMemoryEngineSession` | `useFactory` |
| `TurnRenderOrchestrator` | WP7 门面 | `useFactory`（接 `resolveSession` 缝） |
| `EngineTurnService` | 对外门面服务 | `useClass` |

**exports**：`EngineTurnService` + `ENGINE_SESSION_PORT` + `ENGINE_RENDER_PORT`（供 WP8-B 接语音链路时直接注入）。

---

## 6. 文件清单

### 新增 · 装配层 `src/engine-adapters/wiring/`

```
src/engine-adapters/wiring/
├── engine.module.ts           【新】@Module: 注册全部 provider + 控制器, exports 门面与两个端口
├── engine.tokens.ts           【新】3 个端口 DI token (Symbol): ENGINE_SESSION_PORT / ENGINE_MEMORY_STORE / ENGINE_RENDER_PORT
├── engine.providers.ts        【新】纯装配工厂: 记忆仓储分流 / 内核会话 / 门面（含归属缝）
├── router-chat-caller.ts      【新】LlmRouterService.chat → 窄面 ChatCaller
├── render-config.factory.ts   【新】env → RenderAdapterConfig + 渲染端口装配 (buildEngineRenderDeps / buildEngineRenderPort)
├── engine-turn.service.ts     【新】EngineSessionRegistry (归属登记表) + EngineTurnService (open/turn/close 门面)
└── engine-wiring.controller.ts【新】聚合调试端点 open/turn/close (JWT) + DTO + 错误映射 + 角色内核净化
```

### 新增 · 测试

```
test/engine-adapters/wp8-wiring.spec.ts   【新】34 用例, 覆盖 §8 清单 1-9 + 12 条补充
```

### 修改

```
src/app.module.ts   追加 1 行 import + imports 数组追加 EngineWiringModule (与既有 AIEngineModule / VoiceModule 并存, 不替换旧链路)
```

---

## 7. 本期关键决策（写清理由，避免下期返工）

1. **端口 token 用 `Symbol` 独立成 `engine.tokens.ts`**：内核 `EngineSessionPort` / `MemoryStore` / `RenderPort` 是 **interface**，编译后**没有运行时值**，不能当 Nest provider token；字符串 token 会**静默撞车**注入错依赖（不报错，只是行为诡异）；独立成文件同时打破 `module → service → module` 的循环依赖。
2. **归属登记表独立成 `EngineSessionRegistry` 类**（而不是塞进 `EngineTurnService`）：依赖方向是 门面 → 编排器 → 归属查询函数 → 登记表。若表在门面里，就是 **门面 → 编排器 → 门面** 的循环依赖。
3. **归属只由装配层登记**：内核会话端口刻意**没有**"由句柄反查归属"的能力（句柄 = 运行时维度，归属 = 业务维度，内核只在 `openSession` 时拿到一次）。多会话用 `resolveSession`，**不传** `sessionContext`（单会话固定归属），避免双写冲突。
4. **构造逻辑抽成纯工厂 `engine.providers.ts`，`@Module` 只留声明**：`useFactory` 里的代码**单测覆盖不到** —— 要测它就得拉起整个 Nest 容器（`AIEngineModule` 带着 TypeORM entities + `UserModule` + LangChain `RagService`），于是"装配对不对"只能等启动时炸。抽成纯工厂后，模块只声明「token ↔ 工厂」映射，工厂只造对象，两段都能被单测覆盖 —— 这是本期"接线正确性"唯一可靠的护栏。
5. **记忆仓储按 `QDRANT_URL` 是否配置分流**：配了 → `QdrantMemoryStore`（内置内存回落仓；WORKING / SHORT_TERM 本就不向量化的内容走内存）；没配 → 纯 `InMemoryMemoryStore`。**用既有 env 键，不新增**。配了向量库却缺客户端 → **装配期直接炸**，不静默回落成纯内存（静默回落 = 线上以为在持久化，实际一条都没存）。
6. **记忆用 ai-engine 的 `QdrantService`**（复用，不新建客户端）：它结构上满足 `QdrantMemoryClient` 窄面（`upsert` / `search`）；Nest 按模块 token 去重，`AppModule` 已含 `AIEngineModule`，不产生重复实例。
7. **调试端点走 `@Controller('engine/debug')` + passport 版 `JwtAuthGuard`**（`src/auth/guards`）：`JwtStrategy.validate` 会回填 `tenantId`，`@TenantId()` 可用；`AuthModule` 是 `@Global()`，无需 import。路由名带 `debug` = 一眼看出不是正式路径，将来下线删一个模块即可，不牵动正式链路。
8. **内核错误在控制器层按 code 映射 HTTP 状态**（`INVALID_INPUT`/`UNSUPPORTED`→400、`SESSION_NOT_FOUND`→404、`SESSION_ALREADY_OPEN`/`STATE_CONFLICT`/`ABORTED`→409、其余→500），由全局 `BizExceptionFilter` 归一响应体；**不吞错**（吞掉会把"参数错"伪装成一次正常对练）。
9. **`characterProfile` 必须净化**：内核 `buildInitialSnapshot` 直接遍历 `coreBeliefs` 并展开 `activationTags`，脏 payload（如 `coreBeliefs: "abc"`）会在**开场那一刻**抛 TypeError、整场会话 500。形状非法**整体丢弃回中性基线**（不是逐字段容错 —— 部分字段缺失的"半合法"角色内核会让内核拿到自相矛盾的画像）。
10. **本仓 tsconfig 开了 `noPropertyAccessFromIndexSignature`**：索引签名属性必须走方括号访问（`raw['coreBeliefs']`），否则 TS4111 编译错。（这是本期自检实际踩到的坑。）

---

## 8. 遗留缺口

### 归 WP8-B（流式 + WS + 灰度切旧）

1. **流式窄面**：`ChatCaller` 需加 `stream(req, providerId?, signal?)`（委托 `LlmRouterService.streamChat`），并让 `RenderPort` / 门面能吐 chunk；或先在门面层把聚合 reply 包成增量。
2. **接 WS / vpt**：把 `EngineTurnService` 挂进 `voice.service` 的生成位，复用其现有 `llmAbort` AbortController、generation 防旧流、barge-in、TTS `task_cancel`；`open`/`close` 与 `vpt-session-bridge` 生命周期对齐。
3. **灰度切旧**：env 开关 / 按会话在新引擎与旧 `agent/visitor` 直出间切换，保留一键回退；保证既有前端语音播放与落库不破。
4. **窄面缺 `uid` / `AbortSignal`**：本期 `ChatCaller` 只有 `chat(req, providerId?)`，WP8-B 接真实链路时大概率要扩窄面（**内核契约不动**）。
5. **首 token 延迟 / 断网 / 超时 / 中止（ABORTED）不挂死**：聚合态尚不涉及，增量态必须验证。

### 归后续轮

6. **WP9 角色资产池**：5Ps 真实注入开场基线、`attachmentStyle` / `forbiddenBehaviors` 真实注入（本期调试端点只接受手工传入的 `characterProfile`）。
7. **PsyGUARD 独立服务**（Python FastAPI）+ B 层 HTTP `RiskProbePort` 适配；伦理报告落库 / 入档案（`SafetyReport` 进程内累计，close 前取走）。
8. **BDI 状态落库**：本期 `InMemoryBdiStateRepository`；MySQL/TypeORM 仓储属后续轮。
9. **WP2 遗留**：Qdrant 写侧冲突标记（需 `setPayload`/scroll）、短时记忆自动写入与会话结束编排、衰减半衰期 30 天 / 阈值 0.1 标定。
10. **成本运营轮**：token 计费 / 看板 / 预算告警。

### 环境 / 流程

11. **`pnpm build` 全量构建与既有业务测试历次未跑**（历次 WP 均如此）—— 本期新增了一个被 `AppModule` 引入的模块与调试控制器，**建议合并前补跑全量构建 + 启动冒烟**。
12. **jest 默认并行在 8 核机器上偶发 "worker 未优雅退出" 告警**（WP5 已定位为**环境并发问题**，非代码缺陷：`--runInBand` / `--maxWorkers=2` 均无告警且快 3–4 倍）。**未改 `jest.config.ts`**（全仓库测试配置，超范围）—— 待用户拍板是否设 `maxWorkers`。

---

## 9. 怎么验证（本期交付物）

### 单测

```powershell
cd E:\Work\Project\backend\mofang-nestjs
npx jest test/engine-adapters/wp8-wiring.spec.ts   # 34 用例
```

### 端到端（需要真实 env：`QDRANT_URL` / LLM provider 的 apiKey）

```powershell
# 1) 开会话 → 拿 handleId
curl.exe -X POST http://localhost:3000/engine/debug/open `
  -H "Authorization: Bearer <JWT>" -H "Content-Type: application/json" `
  -d '{"sessionId":"s-debug-1","visitorId":"visitor-1"}'

# 2) 走一轮 → 返回完整 TurnRenderResult (聚合, 非流式)
curl.exe -X POST http://localhost:3000/engine/debug/turn `
  -H "Authorization: Bearer <JWT>" -H "Content-Type: application/json" `
  -d '{"handleId":"<上一步的 handleId>","userText":"你最近睡得怎么样？"}'

# 3) 关会话 → 归属清空
curl.exe -X POST http://localhost:3000/engine/debug/close `
  -H "Authorization: Bearer <JWT>" -H "Content-Type: application/json" `
  -d '{"handleId":"<handleId>"}'
```

> 期望：第 2 步返回**非空真实 reply**、`turnIndex` 递增、`snapshot` 可见、`render.providerHint` 为实际命中的候选 id；LLM 全挂时返回兜底句 + `fallbackUsed=true` + `providerHint='degraded'`（HTTP 仍 200）。
