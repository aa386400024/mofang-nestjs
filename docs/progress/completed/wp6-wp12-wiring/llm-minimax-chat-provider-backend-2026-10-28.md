# 任务单 · 把现有 MiniMax 订阅接入 chat registry（让 WP8 引擎聚合 turn 产出真实 reply）后端任务单

> 关联: WP8-A [`engine-wp8-di-wiring-aggregated-turn-backend-2026-10-28.md`](./engine-wp8-di-wiring-aggregated-turn-backend-2026-10-28.md)（已交付，装配接线验收通过，但本机无 chat key，turn 只能走降级兜底）
> 母版: [`../architecture/ai-engine-roadmap-v1.1.md`](../architecture/ai-engine-roadmap-v1.1.md)
> 仓库: `E:\Work\Project\backend\mofang-nestjs`
> 日期: 2026-10-28 ｜ 类型: **`src/llm` 增补一个 chat provider**（小型适配，不动引擎内核与装配层）
> 目标读者: 后端；闸门命令由大炮在 Windows PowerShell 复跑 `tsc` / `eslint` / `jest`
> **状态**: 🟢 **已交付并自跑复跑绿**（eslint 0 / tsc 0 / jest test/llm 1 套件 22 用例全绿、engine-adapters+engine-core 11 套件 258 用例全绿零回归）；curl 端到端实测 `reply` 非空真实文本 / `fallbackUsed=false` / `providerHint=minimax`
> 交付记录: [`llm-minimax-chat-provider-implementation-2026-10-28.md`](./llm-minimax-chat-provider-implementation-2026-10-28.md)

---

## 0. 一句话目标

WP8-A 装配链路已通，但本机 `.env` 没有任何 `LLM_<PROVIDER>_API_KEY`，默认主候选 DEEPSEEK 无 key，turn 必然走降级兜底（`fallbackUsed=true, providerHint='degraded'`）。本单**不新购 key**，把现有的 MiniMax 订阅（`MINIMAX_API_KEY`，目前只被旧 agent 流式 / voice TTS·ASR / counselor 分析使用）接进 `LlmRouterService` 的 chat registry，新增一个 `minimax` chat provider，再用 `ENGINE_RENDER_PRIMARY_PROVIDER=minimax` 把 WP8 引擎主候选指过去，使 `/engine/debug/turn` 返回**非空真实 reply、`fallbackUsed=false`、`providerHint=minimax`**。

> 为什么单独成单：这是给 chat 抽象层补一个厂商适配，与 WP8-B（流式/WS/灰度）无关；改动集中在 `src/llm`，不碰引擎内核。

---

## 1. 现状事实（开工先 Read 对齐，勿臆造）

- chat 出口链路：`RouterChatCaller` → `LlmRouterService.chat` → `ProviderRegistryService.resolveChat(providerId)` → provider.chat。
- 启动注册点：`src/llm/llm.module.ts::onModuleInit` → `registerDefaultProviders(registry, config)`（`src/llm/config/llm.config.ts`）。当前**只在配了 `LLM_DEEPSEEK_API_KEY` / `LLM_DOUBAO_API_KEY` / `LLM_QWEN_API_KEY` 时**注册对应三家。
- `AIProviderId` 枚举（`src/llm/common/enums/llm.enums.ts`）当前**没有 minimax**；`ALL_PROVIDER_IDS` 也不含。
- apiKey 默认解析器 `defaultEnvApiKeyResolver` 读 `LLM_<PROVIDER>_API_KEY`；**MiniMax 现有 key 在 `MINIMAX_API_KEY`**，命名不同，不能复用通用 `buildEnvConfig` 的取键逻辑。
- MiniMax 本身是 OpenAI 兼容协议：`${MINIMAX_BASE_URL}/v1/chat/completions`、`Authorization: Bearer <key>`、OpenAI 风格 messages、SSE（见 `src/agent/llm/llm.service.ts` 既有实现）。
- 现有 OpenAI 兼容基类 `OpenAICompatibleChatProvider`（`src/llm/common/base/openai-compatible-chat.provider.ts`）已封装 LangChain `ChatOpenAI` 的聚合 `chat()` / `streamChat()` / `testConnection()`，新 provider 继承即可，不重写协议。
- env 现状：`MINIMAX_API_KEY`（已配，隐藏）、`MINIMAX_LLM_MODEL=MiniMax-M3.1-Flash`、`MINIMAX_BASE_URL` 未在 `.env` 设置 → 走 `config/envs/default.ts` 缺省 `https://api.minimax.cn`（**不含 `/v1`**）。

---

## 2. 范围（In Scope）

### 2.1 新增枚举值

在 `AIProviderId` 增加 `MINIMAX = 'minimax'`，并加入 `ALL_PROVIDER_IDS`（保持与现有项并列）。开工先 Read 枚举文件，确认 `ALL_PROVIDER_IDS` 是否被别处遍历，避免漏列导致 admin/列表缺失。

### 2.2 新建 MiniMax chat provider

新增 `src/llm/providers/minimax.provider.ts`：

- `MinimaxChatProvider extends OpenAICompatibleChatProvider`，结构对齐 `deepseek.provider.ts`（极简子类）。
- `id = AIProviderId.MINIMAX`，`name = 'MiniMax'`。
- **baseUrl / defaultChatModel 从 env 构造，不写死**：
  - baseUrl：取 `MINIMAX_BASE_URL`，缺省 `https://api.minimax.cn`；**在 provider 内 normalize 到 `/v1`**（LangChain `ChatOpenAI` 的 `baseURL` 由它自己拼 `/chat/completions`，不要再传一个已带 `/v1` 的串造成双写，也不要漏 `/v1`）。
  - defaultChatModel：取 `MINIMAX_LLM_MODEL`，缺省 `MiniMax-M3`。
- 本单**只注册 CHAT 能力，不注册 embedding**（MiniMax embedding 另议，不占位）。
- 已知上游差异（实施时按真实返回处理，不要硬塞）：
  1. **M3.1-Flash 的 temperature 被上游忽略**（官方固定），不必为本 provider 纠结传值，基类透传即可。
  2. **token 上限字段**：上游思考 token 计入长度上限，可能要求 `max_completion_tokens` 而非 `max_tokens`。若聚合 `chat()` 返回 400/截断，再在子类覆盖 `buildLLM` 把字段映射到 `max_completion_tokens`；基类默认 `maxTokens` 先试，**不要一上来就改基类**。

### 2.3 启动注册分支

在 `registerDefaultProviders`（`src/llm/config/llm.config.ts`）增加 MiniMax 分支：

- **仅当 `config.get('MINIMAX_API_KEY')` 非空才注册**（与现有三家"有 key 才注册"口径一致）。
- 该分支的 apiKey **单独读 `MINIMAX_API_KEY`**，不要走通用 `buildEnvConfig`（它读的是 `LLM_<ID>_API_KEY`，对不上）。
- `LLMProviderConfig` 里 `enabled = !!apiKey`、`capabilities=[LLMCapability.CHAT]`、`defaultChatModel` 取自 env。
- 不改动 deepseek / doubao / qwen 三个现有分支。

### 2.4 模型 tier 映射（可选但推荐）

`LlmRouterService.getDefaultModelForTier` 的 `TIER_MODELS` 可补一行 `[AIProviderId.MINIMAX]`（RAG → `MINIMAX_LLM_MODEL` 对应模型）；**不补也能工作**——缺省会回落到注册 provider 的 `defaultChatModel`（见 `defaultChatProviderFallback`）。若补，只补映射，不改回落逻辑。

### 2.5 让 WP8 指向 MiniMax（纯 env，不改代码）

部署侧在 `.env` 增加（或调试环境临时加）：

```env
ENGINE_RENDER_PRIMARY_PROVIDER=minimax
```

`render-config.factory.ts` 已支持该键（缺省回默认 provider），本单不改 wiring。

---

## 3. 明确不做（Out of Scope）

| 不做项 | 归属 |
|---|---|
| 流式窄面 `stream`、SSE/WS 增量、首 token、chunk 聚合 | WP8-B |
| 把新引擎接进 `voice.service` WS、TTS 出声、barge-in、灰度切旧 | WP8-B |
| MiniMax embedding provider / 向量入库 | 后续轮 |
| 改动 `src/engine-core/`、`src/engine-adapters/wiring/` | **禁止**（内核与 WP8-A 装配零改动） |
| 改动 `MINIMAX_API_KEY` 在 voice TTS/ASR、counselor 分析、旧 agent 流式的既有用法 | **禁止**（只新增 chat 注册，不替换旧链路） |
| 改动 deepseek/doubao/qwen 现有分支与配置 | **禁止** |
| 建表 / migration / entity | 本期无 |

---

## 4. 配置面（复用既有 env，不新增密钥）

| env 键 | 用途 | 缺省 |
|---|---|---|
| `MINIMAX_API_KEY` | chat 鉴权（复用既有，不改名） | 空 → 不注册 minimax |
| `MINIMAX_BASE_URL` | OpenAI 兼容基址（normalize 到 /v1） | `https://api.minimax.cn` |
| `MINIMAX_LLM_MODEL` | 默认 chat 模型 | `MiniMax-M3`（本机 `.env` 为 `MiniMax-M3.1-Flash`） |
| `ENGINE_RENDER_PRIMARY_PROVIDER` | WP8 主候选指向 minimax | 默认 provider（本单调试设为 `minimax`） |

> 不新增 `LLM_MINIMAX_API_KEY`：直接复用 `MINIMAX_API_KEY`，避免同一把 key 两处维护。

---

## 5. 异常与边界语义

- **无 `MINIMAX_API_KEY` 时不注册、不报错**：`onModuleInit` 日志照常列出已注册 provider，minimax 缺席即可，不得抛错阻断启动。
- **key 错/上游 401/429/5xx**：由 WP6 `LlmRenderAdapter` 既有主备/冷却/降级接管；minimax 单候选失败时返回兜底句 + `fallbackUsed=true`，HTTP 200，不 500（沿用 WP8-A 已验收的降级语义）。
- **不泄漏**：调试响应不回显 apiKey、上游私有字段、完整系统 prompt。
- 注册是进程内单例，不引入全局单例竞争。

---

## 6. 单测清单（全 mock，不连真实上游）

新增 `test/llm/minimax-provider.spec.ts`（或归入既有 llm 测试目录，按仓库惯例）：

1. `MINIMAX_API_KEY` 非空时 `registerDefaultProviders` 注册 minimax chat，且 apiKey 取的是 `MINIMAX_API_KEY`（不是 `LLM_MINIMAX_API_KEY`）。
2. `MINIMAX_API_KEY` 缺失时不注册 minimax，且不抛错、不影响其它三家注册。
3. provider 的 `id=minimax`、`defaultChatModel` 来自 `MINIMAX_LLM_MODEL`、baseUrl 已 normalize 到 `/v1`（无双 `/v1`、无缺 `/v1`）。
4. 现有 deepseek/doubao/qwen 分支注册行为不受影响（回归断言）。
5. 测试零真实网络、零真实 key。

---

## 7. 验收（Done 的可观察标准）

- `npx tsc -p tsconfig.build.json --noEmit` 0 错；`eslint` 0 error；新增 jest 套件全绿，`test/engine-adapters`、`test/engine-core` 既有套件零回归。
- 启动后 `GET /llm/providers`（或启动日志 `LLM providers initialized`）能看到 `minimax`。
- 配 `ENGINE_RENDER_PRIMARY_PROVIDER=minimax` 重启后，按 WP8-A §9 curl：
  1. `POST /engine/debug/open` → 201 拿 handleId；
  2. `POST /engine/debug/turn`（`userText="你最近睡得怎么样？"`）→ **201，`reply` 非空真实文本**，`render.fallbackUsed=false`，`render.providerHint='minimax'`，`usage.completionTokens>0`，`snapshot` 可见、`turnIndex` 递增；
  3. `POST /engine/debug/close` → `{ok:true}`。
- `git status`：仅本单新增 provider/配置分支/测试/文档；`engine-core`、`engine-adapters/wiring`、`voice`、`agent`、`counselor` 零改动。

---

## 8. 闸门命令（大炮在 Windows PowerShell 复跑，后端勿代跑 flutter/dart）

```powershell
cd E:\Work\Project\backend\mofang-nestjs
npx tsc -p tsconfig.build.json --noEmit
npm run lint
npx jest test/llm
npx jest test/engine-adapters test/engine-core   # 回归零红
```

---

## 9. 交接给后续

- 流式 `stream`、接 WS/vpt、灰度切旧仍归 **WP8-B**，本单只把聚合 chat 这一条路打通。
- MiniMax embedding、成本计费、多 provider 主备真实切换的线上标定，归后续轮。

---

## 10. 交付状态

**代码已交付并自跑复跑绿**，逐条对照见交付记录
[`llm-minimax-chat-provider-implementation-2026-10-28.md`](./llm-minimax-chat-provider-implementation-2026-10-28.md)。

### 与本任务单的**四处显式差异**（已记录，非绕过）

1. **新增 `src/llm/config/provider-env.ts`**（§3 目录未列）：把"provider → apiKey env 键名 / 模型 env 键名 / 基址归一"收敛成**一张表**，供启动注册与运行时解析共用。
   任务单 §1 只提到 `buildEnvConfig` 取键对不上，**没提运行时解析器 `defaultEnvApiKeyResolver` 也对不上** —— 只改注册会得到"provider 注册成功、一调用就报 API key not found"的半注册状态。
2. **改了共享基类 `openai-compatible-chat.provider.ts`**（§3 未列，§2.2 假设"基类已封装好协议"）：`@langchain/openai` 1.x 的 `ChatOpenAI` **只认 `apiKey`**（旧字段名 `openAIApiKey` 在 chat 模型上被忽略），基类原样传旧字段名 → 所有 OpenAI 兼容 provider 调用即报 `Missing credentials`。**存量缺陷**，一次修好 deepseek / doubao / qwen / custom / minimax 全部。embedding 侧经核对无此问题（1.x 的 embeddings 仍认 `openAIApiKey`），未动。
3. **改了 `LlmRouterService.getDefaultModelForTier` 的回落语义**（§2.4 写"若补，只补映射，不改回落逻辑"）：原回落取的是**默认 chat provider** 的模型（问 minimax 拿 deepseek 的模型名 → 上游 400），且**渲染配置在 DI 实例化期冻结、provider 注册在 `onModuleInit`**，那一刻注册表是空的。改为 **env 优先 → 注册表 → 默认 provider → 常量**：模型名是部署事实（env），不是注册状态。**未**把 minimax 模型名写死进静态 tier 表（写死等于替用户决定订阅内容）。
4. **本机 `.env` 新增 1 行** `ENGINE_RENDER_PRIMARY_PROVIDER=minimax`（§2.5 要求配；`.env` 在 `.gitignore` 内，不入库，未改任何凭证）。

> 任务单 §6-5「测试零真实网络、零真实 key」已遵守：单测全 mock + 假 key；真实上游调用只发生在 §7 的端到端验收里（一次性，未常驻）。
