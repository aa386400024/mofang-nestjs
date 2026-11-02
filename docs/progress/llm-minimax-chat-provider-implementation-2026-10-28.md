# MiniMax chat provider 接入（让 WP8 引擎聚合 turn 出真实 reply）后端交付记录

> 任务单: [`llm-minimax-chat-provider-backend-2026-10-28.md`](./llm-minimax-chat-provider-backend-2026-10-28.md)
> 母版: [`../architecture/ai-engine-roadmap-v1.1.md`](../architecture/ai-engine-roadmap-v1.1.md)
> 关联: WP8-A [`engine-wp8-di-wiring-aggregated-turn-backend-2026-10-28.md`](./engine-wp8-di-wiring-aggregated-turn-backend-2026-10-28.md)（装配层，已交付）
> 仓库: `E:\Work\Project\backend\mofang-nestjs`
> 日期: 2026-10-28 ｜ 类型: **`src/llm` 增补一个 chat provider**（小型适配，不动引擎内核与装配层）

---

## 1. 闸门复跑结果（本轮自跑，Windows PowerShell，最终树）

| # | 命令 | 结果 |
|---|---|---|
| 1 | `npx eslint "src/**/*.ts"` | **exit 0**，0 error 0 warning |
| 2 | `npx tsc -p tsconfig.build.json --noEmit` | **exit 0**，0 error |
| 3 | `npx jest test/llm` | **1 套件 / 22 用例全绿**（本单新增） |
| 4 | `npx jest test/engine-adapters test/engine-core --maxWorkers=2` | **11 套件 / 258 用例全绿**（engine-adapters 81 + engine-core 177，**零回归**） |

---

## 2. 红线核对（任务单 §3 / §7）

| 红线 | 落点 | 证据 |
|---|---|---|
| `src/engine-core/` 零改动 | 未触碰 | `git status --porcelain -- src/engine-core` → **空** |
| `src/engine-adapters/wiring/` 零改动 | 未触碰（只**读**其装配链做验证） | `git status --porcelain -- src/engine-adapters/wiring` → **空** |
| `src/voice/`、`src/agent/`、`src/counselor/` 零改动 | 未触碰（`MINIMAX_API_KEY` 的既有用法一字未改） | `git status --porcelain -- src/voice src/agent src/counselor` → **空** |
| 改动 deepseek / doubao / qwen 现有分支与配置 | 三个注册分支**一字未动**；只在共享基类补了一个缺失字段 | 见 §5 缺陷 ③ |
| 不做流式 / SSE / WS / 灰度切旧 | 本期无 | — |
| 不新增 `LLM_MINIMAX_API_KEY` | 直接复用 `MINIMAX_API_KEY` | 见 §4 |
| 不注册 MiniMax embedding | `capabilities=[CHAT]`，`resolveEmbedding('minimax')` 为 null | 单测 §6-1 |
| 调试响应不泄漏 apiKey / 上游私有字段 / 完整 prompt | 本期未改调试端点；出参仍是 WP8-A 既定的 `TurnRenderResult` 字段 | — |
| 无表 / migration / entity | 本期无 | git status 可核 |
| 测试零真实网络、零真实 key | 单测全 mock + 假 key | 单测 §6-5 |

---

## 3. 交付范围逐条对照（任务单 §2 / §6 / §7）

| 任务单条目 | 交付 | 落点 |
|---|---|---|
| §2.1 `AIProviderId` 增 `MINIMAX` + `ALL_PROVIDER_IDS` | ✅ | `src/llm/common/enums/llm.enums.ts`；`ALL_PROVIDER_IDS` 经确认**全仓无其它遍历点**（仅定义），加值零风险 |
| §2.2 `MinimaxChatProvider`（继承 OpenAI 兼容基类） | ✅ | `src/llm/providers/minimax.provider.ts`：极简子类，只声明 `id / name / baseUrl / defaultChatModel`；基址与模型名由构造参数注入（provider 自身零 IO） |
| §2.2 baseUrl 从 env 构造并 normalize 到 `/v1` | ✅ | `src/llm/config/provider-env.ts::normalizeOpenAiCompatibleBaseUrl` —— 补 `/v1`、不双写、尾斜杠与完整端点都归一 |
| §2.2 defaultChatModel 取 `MINIMAX_LLM_MODEL`，缺省 `MiniMax-M3` | ✅ | `resolveMinimaxChatModel` |
| §2.2 只注册 CHAT，不注册 embedding | ✅ | `capabilities: [LLMCapability.CHAT]` |
| §2.3 启动注册分支（仅有 key 才注册、apiKey 单独读 `MINIMAX_API_KEY`） | ✅ | `src/llm/config/llm.config.ts` |
| §2.4 tier 模型映射 | ✅（按"env 优先"落地，见 §5 缺陷 ②④） | `LlmRouterService.getDefaultModelForTier` |
| §2.5 `ENGINE_RENDER_PRIMARY_PROVIDER=minimax` | ✅（纯 env，不改 wiring） | 本机 `.env` 已加（`.env` 未入库） |
| §6 单测清单 1-5 | ✅ | `test/llm/minimax-provider.spec.ts`（22 用例 = 清单 5 条 + 护栏 9 条 + provider 3 条 + 回归 5 条） |
| §7 验收（curl 出真实 reply） | ✅ | 见 §6 端到端实录 |

---

## 4. 配置面（复用既有 env，不新增密钥）

| env 键 | 用途 | 缺省 | 备注 |
|---|---|---|---|
| `MINIMAX_API_KEY` | chat 鉴权 | 空 → **不注册 minimax** | 复用既有键，**不新增** `LLM_MINIMAX_API_KEY`（同一把 key 两处维护 = 迟早只改一处） |
| `MINIMAX_BASE_URL` | OpenAI 兼容基址 | `https://api.minimax.cn` | provider 内归一到 `/v1`；**不改全局语义**（旧 agent 流式 / voice TTS / ASR 仍按"不带 /v1"消费同一个键） |
| `MINIMAX_LLM_MODEL` | 默认 chat 模型 | `MiniMax-M3` | 本机 `.env` = `MiniMax-M3.1-Flash` |
| `ENGINE_RENDER_PRIMARY_PROVIDER` | WP8 主候选指向 minimax | 默认 provider | 本机 `.env` 已加 `=minimax`（`.env` 在 `.gitignore` 内，不入库） |

> 本机 `.env` 本轮**仅新增 1 行**：`ENGINE_RENDER_PRIMARY_PROVIDER=minimax`（附中文注释）。其余键全部沿用既有值，未改任何凭证。

---

## 5. 三个存量缺陷（本单真正挖出来的东西 —— 都已修复并加了回归护栏）

> 这三个都不是"MiniMax 特有"的问题，而是**接第一个真实 key 时才暴露**的链路缺陷。
> 任务单 §1 假设"基类已封装好协议，只声明 id/baseUrl/model 即可"，实际不成立。

### 缺陷 ① · apiKey 键名只改了"注册"、没改"运行时解析" → 半注册状态

- **现象**：provider 注册成功（`Registered chat provider: minimax`），一调用就报 `API key not found for provider minimax`。
- **根因**：apiKey 有**两条**读取路径 —— 启动注册（`llm.config.ts`）与运行时鉴权（`LlmRouterService.authorize` → `defaultEnvApiKeyResolver`）。前者改了，后者没改；后者读的是 `LLM_<ID>_API_KEY` 规律，读不到 `MINIMAX_API_KEY`。
- **治本**：把"provider → apiKey env 键名"收敛成**一张表**（`config/provider-env.ts`），注册与运行时解析**共用**。漏掉任一条的症状完全不同（"provider 不出现" vs "注册成功但一调用就报错"），后者的排查成本高一个量级。
- **护栏**：单测 §6-1「运行时 apiKey 解析也读 MINIMAX_API_KEY」。

### 缺陷 ② · tier 模型回落"张冠李戴" → 问 A 拿 B 的模型

- **现象**：`getDefaultModelForTier(RAG, 'minimax')` 返回 `'gpt-4o-mini'`，发到 minimax 被拒：`400 invalid params, unknown model 'gpt-4o-mini' (2013)`。
- **根因**：回落取的是**默认 chat provider** 的模型，而问的是 minimax。本机 `LLM_DEFAULT_CHAT_PROVIDER` 未配 → 默认 deepseek；而 deepseek **没有 key、根本没注册** → 再兜底成常量 `'gpt-4o-mini'`。
- **治本**：回落改为「问谁回谁」：`providerModelFallback(providerId)` 先取该 provider 自己声明的模型。
- **护栏**：单测 §6-4 + 「护栏 7」。

### 缺陷 ③ · LangChain 1.x 凭据字段名 —— **存量缺陷，影响全部 OpenAI 兼容 provider**

- **现象**：`400 / Missing credentials. Please pass an 'apiKey' ... or set the 'OPENAI_API_KEY' environment variable`。
- **根因**：`@langchain/openai` **1.6.2** 的 `BaseChatOpenAI` 取凭据只有一条链：
  `this.apiKey = fields?.apiKey ?? fields?.configuration?.apiKey ?? env OPENAI_API_KEY`。
  共享基类 `OpenAICompatibleChatProvider.buildLLM` 传的是 **`openAIApiKey`** —— 那是 LangChain **0.x** 的字段名，1.x 的 chat 模型**根本不读**（只有 embedding / LLM 类还认）。于是客户端拿不到任何凭据。
- **为什么一直没被发现**：本机此前**没有任何 `LLM_*_API_KEY`**，这些 provider 从未被真正调用过；注册、构造、配置全对，只有发请求时才炸，而错误信息指向 `OPENAI_API_KEY`（本项目根本不用的变量名），极易误判成"key 没配"。
- **治本**：基类同时传 `apiKey`（1.x 真字段，生效）与 `openAIApiKey`（0.x 兼容）。**一次修好 deepseek / doubao / qwen / custom / minimax 全部**。
- **边界确认**：`@langchain/openai` 的 **embeddings** 类仍认 `openAIApiKey`（`fields.apiKey ?? fields.openAIApiKey ?? env`），故 embedding 路径**无此缺陷**，不需要改。
- **护栏**：单测「护栏 9」——断言构造出的 `ChatOpenAI` 真的带着传入的 `apiKey` 与 `configuration.baseURL`。

### 缺陷 ④ · 启动顺序：冻结配置里混进了可变运行时状态

- **现象**：缺陷 ②③ 都修完后，**应用内**仍然降级（268ms 快速失败），而**同一条链在脚本里跑**完全正常（真实 reply、`providerHint=minimax`）。
- **根因**：WP8 的 `RenderAdapterConfig` 在 **DI 实例化期**构建并冻结，而 provider 注册发生在 `onModuleInit` —— **那一刻注册表还是空的**。于是冻结进配置的模型名是"空注册表 + 无默认 provider"算出来的 `'gpt-4o-mini'`。
  脚本能过是因为脚本里 `registerDefaultProviders` 先于配置构建执行 —— **顺序不同，结论就不同**，这正是"依赖可变状态"的典型症状。
- **治本**：**模型名是部署事实（env），不是注册状态**。回落改为「env 优先 → 注册表 → 默认 provider → 常量」。顺带得出本轮的一条通用不变量：
  > **冻结进启动期配置的每一项输入，都必须是启动期已知的静态事实（env / 静态表），不能依赖可变运行时状态。**
- **护栏**：单测「护栏 7 · provider 还没注册时也能拿到正确模型名」——用**空注册表**复现启动期场景，断言拿到 `'MiniMax-M3.1-Flash'` 而不是 `'gpt-4o-mini'`。

---

## 6. 端到端验证实录（真实上游 · 真实 HTTP）

> 验证方式：复用开发机上已在跑的实例（`nest start --watch`，端口 3000），用本地 `.env` 的 `JWT_SECRET` 签一枚 access token，
> 按任务单 §7 走 `POST /engine/debug/open → /engine/debug/turn → POST /engine/debug/close`。

**open**

```json
{"handleId":"gh_h5OFYpIy1xTvkiwX2q","sessionId":"e2e-curl-1"}
```

**turn**（咨询师文本：`你最近睡得怎么样？`）

```
reply        = 还行吧，偶尔会醒，醒了就很难再睡着。
fallbackUsed = False
providerHint = minimax
usage        = {"completionTokens":88,"totalTokens":540}
turnIndex    = 1
耗时 ms      = 2434
HTTP 状态    = 201
```

**close**

```json
{"ok":true}
```

✅ 验收标准逐条满足：非空**真实** reply、`fallbackUsed=false`、`providerHint='minimax'`、`usage.completionTokens>0`、`snapshot` 可见、`turnIndex` 递增、`close` 回 `{ok:true}`。

> 验证期间未新增任何常驻进程：先在备用端口起了一个可控实例抓日志定位缺陷④，定位完即停并删除全部临时文件；
> 上面的最终实录跑在开发机自己的实例上（`nest start --watch` 自动重建并重启，未手工干预）。

---

## 7. 文件清单

### 新增

```
src/llm/config/provider-env.ts            【新】厂商 env 事实单一真相: provider→apiKey env 键 / provider→模型 env 键 / 基址归一
src/llm/providers/minimax.provider.ts     【新】MinimaxChatProvider extends OpenAICompatibleChatProvider (仅 CHAT)
test/llm/minimax-provider.spec.ts         【新】22 用例 (任务单 §6 清单 1-5 + 9 条根因回归护栏 + 回归)
```

### 修改

```
src/llm/common/enums/llm.enums.ts                     增 AIProviderId.MINIMAX + ALL_PROVIDER_IDS + 注释
src/llm/config/llm.config.ts                           增 MiniMax 启动注册分支 (三个既有分支一字未动)
src/llm/registry/llm-router.service.ts                apiKey env 键改走映射表 + tier 模型回落改 env 优先/问谁回谁
src/llm/common/base/openai-compatible-chat.provider.ts 补 `apiKey` 字段 (LangChain 1.x 凭据字段名)
```

### 本机 `.env`（未入库）

```
+ ENGINE_RENDER_PRIMARY_PROVIDER=minimax
```

---

## 8. 遗留缺口

1. **上游已知差异尚未处理**（任务单 §2.2 已预告）：M3.1-Flash 的 temperature 被上游忽略（官方固定，基类透传即可，不做特例）；`maxTokens` vs `max_completion_tokens` —— 本轮实测 `max_tokens` **可用**（返回 `completionTokens=88`，未截断），故**未**在子类覆盖 `buildLLM` 做字段映射（不预埋未验证的特例）。
2. **MiniMax embedding 未注册**：向量模型与维度口径未核，本期只注册 CHAT；后续轮接入。
3. **`getDefaultModelForTier` 的静态 tier 表仍未覆盖 minimax**：本轮按"模型名随订阅变"的原则走 env 优先，未把模型名写死进 tier 表（写死等于替用户决定订阅内容）。若将来 minimax 需要 basic/rag/advanced 分档，再按 provider 维度补表。
4. **`LLM_DEFAULT_CHAT_PROVIDER` 仍缺省 deepseek**：本机无 deepseek key，故 router 的默认 chat provider 是个"不可用"的占位。WP8 走的是显式候选（`ENGINE_RENDER_PRIMARY_PROVIDER`），不受影响；但其它走"默认 provider"的链路（如 `LlmOrchestratorService`）在本机仍会回落失败 —— 属既有环境配置问题，不在本单范围。
5. **`ChatCaller` 窄面仍缺 `uid` / `AbortSignal`**：WP8-B 接真实链路时大概率要扩（内核契约不动）。
6. **流式 / WS / 灰度切旧**：仍归 **WP8-B**，本单只把聚合 chat 这一条路打通。

---

## 9. 怎么复验

```powershell
cd E:\Work\Project\backend\mofang-nestjs
npx tsc -p tsconfig.build.json --noEmit
npx eslint "src/**/*.ts"
npx jest test/llm
npx jest test/engine-adapters test/engine-core --maxWorkers=2
```

端到端（需 `.env` 里有 `MINIMAX_API_KEY` / `MINIMAX_LLM_MODEL` / `ENGINE_RENDER_PRIMARY_PROVIDER=minimax`，以及启动好的服务 + 一枚 JWT）：

```
POST /engine/debug/open   {"sessionId":"<唯一>","visitorId":"visitor-1"}   → 拿 handleId
POST /engine/debug/turn   {"handleId":"<handleId>","userText":"你最近睡得怎么样？"}
                           → reply 非空 / render.fallbackUsed=false / render.providerHint="minimax"
POST /engine/debug/close  {"handleId":"<handleId>"}                        → {"ok":true}
```
