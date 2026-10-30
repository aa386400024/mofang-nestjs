# WP6 · RenderPort LLM 适配 + 主备执行（适配层：包装现有 src/llm 实现 RenderPort，主备容灾落地 + 输出侧 guard 处置）后端任务单

> 母版: [`../architecture/ai-engine-roadmap-v1.1.md`](../architecture/ai-engine-roadmap-v1.1.md) WP5 渲染契约（已交付）+ backlog [`./phase1-integration-backlog-2026-10-28.md`](./phase1-integration-backlog-2026-10-28.md) WP6
> 前置（均已交付）: WP0 边界骨架 / WP1 BDI / WP2 分层记忆 / WP3 轨迹 / WP4 伦理 / WP5 渲染契约层（`RenderPort`/`RenderSpec`/`RenderResult`/`selectFailoverTarget`/`guardVisitorOutput`/token-budget）
> 仓库: `E:\Work\Project\backend\mofang-nestjs`
> 日期: 2026-10-28 ｜ 类型: **适配层（`src/engine-adapters/`）**，首次触碰真实 LLM；本期**不组装 RenderSpec、不接 turn、不填 reply、不接流式/WS**
> 目标读者: 后端；闸门命令由大炮在 Windows PowerShell 复跑 `eslint` / `tsc` / `jest`
> **状态**: 🟢 **已交付并自跑复跑绿**（eslint 0 / tsc 0 / jest engine-adapters 2 套件 31 用例全绿、engine-core 7 套件 177 用例全绿零回归）
> 交付记录: [`engine-wp6-llm-render-port-implementation-2026-10-28.md`](./engine-wp6-llm-render-port-implementation-2026-10-28.md)

---

## 0. 一句话目标

WP5 只在内核立了 `RenderPort` 接口和"选谁"的纯决策 `selectFailoverTarget`，但**没有任何真实实现**。WP6 在适配层写一个 `LlmRenderAdapter implements RenderPort`：包装现有 `src/llm` 的 `LlmRouterService.chat`，按 `RenderTaskKind` 选配置化的温度/模型，用内核纯决策驱动**真实主备切换**（失败计数 / 冷却 / 指数退避 / 健康恢复切回主），并在出文本后过 `guardVisitorOutput` 做 block 重生成 / 降级处置，把结果归一成 `RenderResult`。本期只交付"一个能被独立 `new` 出来、可单测的渲染适配器"，**不接进 turn、不填 reply、不做流式、不组装规格**（分别属 WP7 / WP8）。

> 为什么是适配层而不是内核：第 0 原则（roadmap §0）要求内核零网络 / 零 `.env` / 零厂商。真实调 LLM、读 apiKey、冷却计时、主备状态都是运行时 IO 与有状态行为，必须落在 `src/engine-adapters/`；内核只给接口形状和"下一个选谁"的纯推导。

---

## 1. 范围与 Done 定义

### 1.1 本期做到（In Scope）

1. **`LlmRenderAdapter implements RenderPort`**（`src/engine-adapters/rendering/llm-render.adapter.ts`）：
   - 构造注入一个窄面 `ChatCaller`（实际由 `LlmRouterService.chat` 适配，便于单测 mock）+ 配置 + 可选输出 guard + 可注入时钟；
   - `render(spec: RenderSpec): Promise<RenderResult>`：本轮内按主备候选逐个尝试，成功即返回；失败按策略切备；全部失败走最终降级。
2. **适配层主备运行时 `RenderFailoverRuntime`**（`render-failover.runtime.ts`）：
   - 持有每个候选的 `consecutiveFailures` 与 `cooldownUntil`；
   - 每轮先剔除冷却中候选，再把剩余序列交给内核 `selectFailoverTarget` 选下一个；
   - 成功清零计数；失败累加，达阈值置冷却；冷却到期候选重新可被选（恢复切回主）；实现指数退避（退避基数来自配置，时钟可注入）。
3. **任务分层 → 请求参数映射**（配置驱动，不写死）：`stable` 低温、`chat` 高温、`advanced` 本期回退 chat 配置；模型名 / 温度 / maxTokens 全部来自配置对象，适配器不硬编码厂商。
4. **输出侧 guard 处置**：拿到文本后调 `guardVisitorOutput(text, { probe? })`：
   - `pass` → 直接放行；
   - `warn` → 记日志放行，不改写；
   - `block` → 重生成一次（可换更稳定候选 / 降温度），仍 block → **不把高危文本传出**，返回兜底稳定话术，`fallbackUsed=true`，安全信号只进日志/回调，不塞进 `RenderResult`。
5. **`RenderResult` 归一**：`text / taskKind / usage{completionTokens,totalTokens} / fallbackUsed / providerHint`；usage 由 `ChatCompletionResponse.usage` 映射；厂商私有字段不外露。
6. **错误归一与切备判定**：超时 / 网络 / 5xx / 空内容 → 可切备；鉴权失败（401/403 / apiKey 缺失）→ 不在坏 key 上循环，直接最终降级。
7. 单测（`test/engine-adapters/wp6-llm-render.spec.ts`，全 mock，不起 NestJS）覆盖 §8 清单。

### 1.2 明确不做（Out of Scope）

| 不做项 | 归属 |
|---|---|
| 从 `EngineTurnOutput` 组装 `RenderSpec`（意图/记忆/轨迹/历史→规格） | WP7 |
| 把渲染接进 `turn`、给 `reply` 填值、问+答成对写记忆 | WP7 |
| `streamChat` 流式聚合、SSE/WS 增量推送、语音出声 | WP8 |
| NestJS `@Module` 完整 DI 注册 / 全局单例 | WP8（本期交付可独立 `new` 的纯类） |
| MiniMax 专用接入、key 申请、模型名写死 | 配置层 / WP8（本期用已注册 provider，MiniMax 经 custom/openai-compatible 配置接入） |
| token 计费、成本看板、异常限流、预算告警埋点 | 后期运营轮 |
| 改动 `src/engine-core/` 任何文件 | 禁止（内核零改动，177 用例零回归） |
| 改动 `src/llm/` 内部（router / provider / config / 注册逻辑） | 禁止（只调用其公开 `chat`） |
| 建表 / migration / entity / 落库 | 本期无 |

### 1.3 与现有 `src/llm` 的关系（别重复造）

- 复用 `LlmRouterService.chat(req, { providerId })` 作为唯一调用出口；它已负责 provider 注册、apiKey 解析、"指定 provider 未注册→回落默认"。
- **注意它内部没有跨候选主备重试、没有冷却、没有恢复切回**——这些正是 WP6 在适配层补的；不要去改 router 加这些逻辑。
- 适配器通过窄面 `ChatCaller` 依赖，不直接 `import LlmRouterService` 具体类，保证单测可 mock、未来可换调用出口。

---

## 2. 边界红线（本期新增，适配层版）

- **`src/engine-core/` 整树零改动**：不新增导出、不改纯函数、不改 `turn`；`boundary.spec.ts` 不要求为本单更新（本单不动内核）。
- **`src/llm/` 零改动**：只调用公开 `chat`，不修改 router/provider/config/注册。
- 适配器是**纯类**：可脱离 NestJS 容器 `new` 出来测；不写 `@Injectable()` 也能跑（DI 装饰器可在 WP8 再加，本期以可测为先）。
- 不读数据库、不建表、不写 migration；配置由构造参数注入，本期不强制新增 `.env` 键（建议键在 §10 列出，供 WP8 接线）。
- 不在 `RenderResult` 里塞厂商私有字段或安全 verdict 私有字段；安全信号经日志 / 可选回调暴露。

---

## 3. 目录落点

```
src/engine-adapters/rendering/                 【新目录】
├── render-adapter.config.ts                   【新】配置类型 RenderAdapterConfig / 候选定义 / 种子默认值
├── render-failover.runtime.ts                 【新】主备运行时：冷却/失败计数/退避/恢复切回，调用内核 selectFailoverTarget
└── llm-render.adapter.ts                      【新】LlmRenderAdapter implements RenderPort（调 ChatCaller + guard + 归一）

test/engine-adapters/
└── wp6-llm-render.spec.ts                     【新】全 mock 单测
```

> 现有 `src/engine-adapters/embedder/`、`persistence/` 不动。

---

## 4. 类型契约（可直接施工）

### 4.1 配置（`render-adapter.config.ts`）

```ts
import type { RenderTaskKind } from '../../engine-core';

/** 一个主备候选：id 与已注册 providerId 对齐，决定实际调用出口。 */
export interface RenderCandidate {
  /** 候选标识（即 AIProviderId 字符串），供 providerHint / 日志。 */
  readonly id: string;
  /** 覆盖该候选在某 taskKind 下的温度 / 模型；缺省走全局。 */
  readonly overrides?: Partial<Record<RenderTaskKind, { temperature?: number; model?: string; maxTokens?: number }>>;
}

export interface RenderAdapterConfig {
  /** 候选序列，第 0 位为主；顺序即优先级。 */
  readonly candidates: readonly RenderCandidate[];
  /** 各 taskKind 默认温度 / 模型 / 完成上限（可被候选 overrides 覆盖）。 */
  readonly taskDefaults: Record<RenderTaskKind, { temperature: number; model?: string; maxTokens?: number }>;
  /** 单次调用超时 ms。 */
  readonly timeoutMs: number;
  /** 连续失败多少次进入冷却。 */
  readonly failureThreshold: number;
  /** 冷却时长 ms（首轮）；后续按指数退避递增。 */
  readonly cooldownBaseMs: number;
  /** 退避基数（冷却 = cooldownBaseMs * 2^(连续失败-1)，封顶由 cooldownMaxMs）。 */
  readonly cooldownMaxMs: number;
  /** block 重生成最大次数（本期固定 1）。 */
  readonly maxBlockRegen: number;
  /** 全部失败 / 仍 block 时的兜底稳定话术（中性、不越界、不给出建议）。 */
  readonly fallbackUtterance: string;
}
```

> `taskDefaults` 种子值（非标定，集中在配置，WP8 可从 env 覆盖）：`stable` temperature≈0.2、`chat` temperature≈0.85、`advanced` 本期回退 chat；`maxTokens` 默认取 `RenderSpec.tokenBudget.maxCompletionTokens`。

### 4.2 窄调用面（解耦，便于 mock）

```ts
import type { ChatCompletionRequest, ChatCompletionResponse } from '../../llm/common/interfaces/chat-provider.interface';

/** 适配器只依赖这一面；生产由 LlmRouterService.chat 适配实现。 */
export interface ChatCaller {
  chat(req: ChatCompletionRequest, providerId?: string): Promise<ChatCompletionResponse>;
}
```

### 4.3 主备运行时（`render-failover.runtime.ts`）

```ts
import { selectFailoverTarget, type FailoverState } from '../../engine-core';

/** 适配层持有的候选运行时状态（内核不持有）。 */
interface CandidateRuntime {
  consecutiveFailures: number;
  cooldownUntil: number; // 0 = 不在冷却
}

export class RenderFailoverRuntime {
  constructor(candidates: readonly RenderCandidate[], now?: () => number);
  /** 本轮可选候选：剔除冷却中，构造 FailoverState 交内核 selectFailoverTarget 选下一个。 */
  next(attempted: readonly string[]): RenderCandidate | null;
  /** 成功：清零该候选计数与冷却。 */
  markSuccess(id: string): void;
  /** 失败：累加计数，达阈值按指数退避置冷却。 */
  markFailure(id: string, config: RenderAdapterConfig): void;
}
```

> `next` 内部：先用自有 `cooldownUntil` 过滤掉冷却候选，再把剩余序列 + 本轮 `attempted` 拼成内核 `FailoverState`，调 `selectFailoverTarget`；**"选谁"永远走内核纯函数**，适配层只负责冷却过滤与状态记账。

### 4.4 适配器（`llm-render.adapter.ts`）

```ts
import type { RenderPort, RenderSpec, RenderResult } from '../../engine-core';

export interface LlmRenderAdapterDeps {
  readonly caller: ChatCaller;
  readonly config: RenderAdapterConfig;
  /** 可选输出 guard（默认包一层无操作；生产传 guardVisitorOutput 适配）。 */
  readonly guard?: (text: string) => Promise<{ level: 'pass' | 'warn' | 'block' }>;
  /** 可选安全信号回调（日志/观测用，不进 RenderResult）。 */
  readonly onSafetySignal?: (text: string, level: string, categories: readonly string[]) => void;
  readonly now?: () => number;
}

export class LlmRenderAdapter implements RenderPort {
  constructor(deps: LlmRenderAdapterDeps);
  render(spec: RenderSpec): Promise<RenderResult>;
}
```

---

## 5. 策略语义（实施中不反复）

### 5.1 主备执行循环（`render` 内）

1. 本轮维护本地 `attempted: string[]`；循环 `runtime.next(attempted)`：
   - 返回 `null`（全部冷却/耗尽）→ 走最终降级（§5.4），不 reject 炸穿。
   - 选中候选 → 用 `taskDefaults[candidate]` + `overrides` 拼 `ChatCompletionRequest`（model / temperature / maxTokens / messages 由 WP7 在 spec 上准备，本期适配器只负责把 spec 已带的 `recentTurns` 等透传，**不拼系统 prompt**——prompt 组装属 WP7）。
2. 带超时调 `caller.chat`：成功 → `markSuccess`、取 `content`、进 §5.3 guard；失败 → `markFailure`、记入 attempted、继续下一个。
3. 鉴权失败类错误（401/403/apiKey 缺失）直接 break 到最终降级，不在坏 key 上逐候选循环。

### 5.2 冷却 / 退避 / 恢复切回

- 连续失败达 `failureThreshold` → 置 `cooldownUntil = now + cooldownBaseMs * 2^(consecutiveFailures-1)`，封顶 `cooldownMaxMs`。
- 冷却未到期的候选在 `next` 中被过滤，本轮不选。
- 冷却到期 → 候选重新进入序列（主回到第 0 位被优先选），实现"健康恢复切回主"。
- 时钟可注入，单测用假时钟推进冷却，不等真实时间。

### 5.3 输出 guard 处置

| verdict | 动作 |
|---|---|
| `pass` | 文本直接作为 `RenderResult.text` |
| `warn` | 记日志 / `onSafetySignal`，文本放行不改写 |
| `block` | 重生成一次（换候选或降温度重试）；仍 block → 丢弃高危文本，返回 `fallbackUtterance`，`fallbackUsed=true`，`onSafetySignal` 记录类别，**不把原文传出** |

### 5.4 最终降级

全部候选失败或最终 block：返回 `RenderResult{ text: fallbackUtterance, taskKind: spec.taskKind, usage:{completionTokens:0,totalTokens:0}, fallbackUsed:true, providerHint:'degraded' }`，不 reject，保证 WP7 拿到非空文本、对话不断流。

### 5.5 usage 与 providerHint 映射

- `usage.completionTokens = resp.usage.completionTokens`，`totalTokens = resp.usage.totalTokens`；降级时归零。
- `providerHint` = 实际成功（或降级）的候选 id；`fallbackUsed` = 本轮是否切过备 / 走过降级 / 走过 block 重生成。

---

## 6. 软降级与容错

| 场景 | 行为 |
|---|---|
| 主调用超时 / 网络错 / 5xx | `markFailure`，切下一个候选 |
| 返回空内容（`content` 为空串） | 视为失败切备 |
| 鉴权失败（401/403/缺 key） | 不循环，直接最终降级 |
| 候选全部冷却 / 耗尽 | 返回兜底话术，不 reject |
| guard 返回 `warn` | 放行，仅记录 |
| guard 返回 `block` 且重生成后仍 block | 返回兜底，不传高危原文 |
| 未注入 guard | 跳过校验直接放行（开发/测试态） |
| 时钟未注入 | 默认 `Date.now()` |

---

## 7. 异常与边界

| 场景 | 行为 |
|---|---|
| 本期是否组装 prompt / RenderSpec | **不**，WP7；适配器只消费已给的 `RenderSpec` |
| 本期是否流式 | **不**，`chat` 聚合一次性返回；`streamChat` 留 WP8 |
| 主备状态作用域 | 本期为适配器实例内全局冷却；会话级隔离留 WP8 |
| 安全 verdict 是否进 RenderResult | **不**，只进日志/回调（遵守 WP5 M8：结果跨厂商通用，无私有字段） |
| 是否改内核 / 改 src/llm | 一律不改 |
| 失败是否向上抛给调用方 | 最终降级返回兜底，不抛；可识别错误仅在日志 |

---

## 8. 单测清单（`test/engine-adapters/wp6-llm-render.spec.ts`，全 mock）

1. **主成功**：主一次返回 → `fallbackUsed=false`、`providerHint=主id`、usage 正确映射。
2. **主失败切备**：主 reject、备成功 → `fallbackUsed=true`、`providerHint=备id`。
3. **失败计数进冷却**：主连续失败达阈值 → 本轮 `next` 跳过主选备；假时钟未推进时下一轮仍跳过主。
4. **冷却到期恢复切回主**：假时钟推进过 `cooldownUntil` → 主重新被优先选中。
5. **全部耗尽最终降级**：所有候选失败 → 返回 `fallbackUtterance`、`fallbackUsed=true`、`providerHint='degraded'`、不 reject。
6. **block 重生成**：首返 block、重生成 pass → 返回重生成文本；两次都 block → 返回兜底、不传高危原文。
7. **warn 放行**：guard 返回 warn → 文本原样放行且有信号记录。
8. **空内容切备**：主返回空串 → 切备。
9. **鉴权失败不循环**：401/403 错误 → 直接降级，不对后续候选逐个尝试。
10. **taskKind 参数注入**：断言传给 `caller.chat` 的 temperature/model 符合配置（stable 低温、chat 高温、候选 overrides 优先生效）。
11. **零回归**：`npx jest test/engine-core` 177 用例不受影响（本单不改内核）。

---

## 9. 验收清单（逐条可勾选）

- [x] `npx tsc -p tsconfig.build.json --noEmit` 0 错。
- [x] `npx eslint "src/**/*.ts"` 0 error（遵守既有 complexity / prettier / import-order）。
- [x] `npx jest test/engine-adapters` 全绿（2 套件 / 31 用例）；`npx jest test/engine-core` 177 用例**零回归**。
- [x] `src/engine-core/` 与 `src/llm/` `git status` 零改动（仅新增 `src/engine-adapters/rendering/` 与对应测试）。
- [x] 适配器可脱离 NestJS `new` 出来跑；主备冷却/恢复逻辑用注入时钟可测，不等真实时间。
- [x] block 高危文本不被传出；最终降级返回非空兜底，不 reject。
- [x] `RenderResult` 无厂商私有字段、无安全 verdict 私有字段。
- [x] 本期零 migration/entity/新表、零强制 `.env` 改动、零新第三方依赖（复用现有 llm 类型）。

---

## 10. 交付闸门（大炮在 Windows PowerShell 跑）

```powershell
cd E:\Work\Project\backend\mofang-nestjs
npx eslint "src/**/*.ts"
npx tsc -p tsconfig.build.json --noEmit
npx jest test/engine-adapters
npx jest test/engine-core
```

**建议 env 键（WP8 接线时从 env 读入配置，本期不强制落 `.env`）**：`ENGINE_RENDER_CANDIDATES`（主备序列）、`ENGINE_RENDER_TIMEOUT_MS`、`ENGINE_RENDER_FAILURE_THRESHOLD`、`ENGINE_RENDER_COOLDOWN_BASE_MS`、`ENGINE_RENDER_COOLDOWN_MAX_MS`、`ENGINE_RENDER_FALLBACK_UTTERANCE`。

---

## 11. 关键决策记录（已定，实施中不反复）

| # | 决策 | 理由 / 备选 |
|---|---|---|
| M1 | 主备"选谁"仍走内核 `selectFailoverTarget`，适配层只做冷却过滤与记账 | 内核纯决策可复现可测；冷却/退避/时钟是有状态 IO，留适配层（WP5 M5） |
| M2 | 本期 `render` 用 `chat` 聚合，不接 `streamChat` | 先把"出文本+主备+guard"闭环跑通；流式增量属 WP8，避免一期塞两种返回形态 |
| M3 | 温度/模型/候选全配置化，不写死厂商，本期不强制接 MiniMax | 厂商与 key 属配置层；MiniMax 经 custom/openai-compatible 在 WP8 接线，不在适配器硬编码 |
| M4 | 最终降级返回兜底而非 reject | 保证 WP7/对话不断流；失败信号进日志，由上层决定是否报错 |
| M5 | 安全 verdict 不进 `RenderResult`，走日志/回调 | 遵守 WP5 M8：结果跨厂商通用，私有字段会让每接一个厂商都改内核契约 |
| M6 | 适配器纯类、本期不加 `@Injectable`/不建 Module | 以可独立单测为先；DI 注册在 WP8 接会话时统一做 |
| M7 | 鉴权失败不循环切备 | 坏 key 对所有候选都坏，逐个尝试只放大延迟；直接降级并记录 |
| M8 | 本期不拼系统 prompt、不组装 RenderSpec | 那是 WP7 的职责；适配器只消费 spec，避免一期把"决策→规格→渲染"缠在一起 |

### 待大炮过目（不阻塞开工）

- `taskDefaults` 温度种子（stable 0.2 / chat 0.85）非标定，集中配置，WP8 按模型与实测调整。
- 主备冷却本期为实例级全局；若 WP8 需要按会话隔离健康状态，再在适配层加会话维度键，不在本期提前做。
- `fallbackUtterance` 兜底话术需中性、不给建议、不承诺，文案由产品/专业口径在 WP8 定稿。

---

## 12. 下一步（本期不做，另起任务单）

1. **WP7**：RenderSpec 组装器 + turn 接线填 reply + 中文来访风格 prompt（适配层）+ 问+答成对写记忆；消费本期的 `LlmRenderAdapter`。
2. **WP8**：NestJS DI 注册适配器、`streamChat` 流式聚合、接现有 WS/vpt 会话、灰度替换 visitor 直出、端到端最小闭环。
3. 配置层：候选序列/MiniMax key/温度模型映射从 env/DB 读入。

---

## 13. 交付状态

**代码已交付并自跑复跑绿**，逐条对照见交付记录
[`engine-wp6-llm-render-port-implementation-2026-10-28.md`](./engine-wp6-llm-render-port-implementation-2026-10-28.md)。

### 13.1 闸门

| 命令 | 结果 |
|---|---|
| `npx eslint "src/**/*.ts"` | exit 0，0 error |
| `npx tsc -p tsconfig.build.json --noEmit` | exit 0，0 error |
| `npx jest test/engine-adapters` | **2 套件 / 31 用例全绿**（WP2 B 层既有 13 + WP6 新增 18） |
| `npx jest test/engine-core` | **7 套件 / 177 用例全绿**（内核零回归） |

`pnpm build` 全量构建与既有业务测试本轮未跑（本期零 entity / migration / module 改动，**`src/engine-core/` 与 `src/llm/` 整树零改动**）。

> `npx jest test/engine-core` 并行模式会**偶发**打印一条「worker 未优雅退出」告警 —— 已定位为**环境并发问题、非代码缺陷**（默认 7 个 ts-jest worker 把 8 核机器压满导致的 worker 退出握手超时；证据链见 WP5 交付记录 §1.1）。退出码 0、177 用例结果不受影响；复跑加 `--maxWorkers=2` 可消除且更快。

### 13.2 与本单的差异（须知会）

| # | 差异 | 理由 |
|---|---|---|
| 1 | **block 重生成 = 同候选 + 降温度，不是换候选** | 候选刚成功返回内容说明它**健康**，换掉它等于拿没验证过的候选去赌第二次；block 最可能成因是采样飘了，降温最对症。**若重生成本身失败（错误/空内容）→ 回到主备循环切下一候选，那时"换候选"才成立** |
| 2 | **新增 `buildMessages` 消息构造缝**（§4.4 未列） | 本期红线是"不拼 prompt"，而 prompt 属 WP7；不留缝 WP7 就得改本文件。缺省按 `spec.recentTurns` 直映射（咨询师 → `user`、来访 → `assistant`） |
| 3 | **guard 返回值补 `categories` 字段** | §5.3 要求"onSafetySignal 记录类别"，§4.4 的 `{ level }` 最小形状没有类别可选；`categories` 可选，旧形状仍可赋值（向后兼容） |
| 4 | **模型名缺失 → 直接降级，不发请求** | `ChatCompletionRequest.model` 必填，而 provider 基类是 `request.model ?? default` —— 空串不是 nullish，传 `''` 等于拿空模型真去调（必然失败、还可能被计费）。宁可降级 |
| 5 | **guard 抛错 → 回落到内核规则层；规则层也异常才按 block** | 输出侧校验是最后一道闸，"未校验文本直接出声"不可接受；但也不能因校验器故障让对话全挂。内核 `guardVisitorOutput` 永不抛（WP4 口径），此为纯防御路径 |
| 6 | **上下文为空 → 直接降级** | 没有对话轮次就没法渲染（退化输入，非 provider 故障），同样走降级出口，保证 WP7 拿到的永远是非空文本 |
| 7 | **`maxTokens` 整数化 + 夹到 ≥ 1** | 非整数会被厂商截断/报错，0 等于"不要输出"；归一走内核 `resolveCompletionTokens`（口径唯一） |
| 8 | **候选序列为空 → 构造即抛** | 那是接线错误，应在装配期炸，而不是第一次 render 时让用户只听到兜底话术 |
| 9 | **冷却到期不清零失败计数（成功才清零）** | 否则指数退避永远停在第一档，持续故障的候选被按固定节奏反复唤醒，退避白做 |
| 10 | **鉴权失败为启发式判定**（结构化 status 优先 + 文案兜底） | 厂商异常形状不统一；误判代价是"多降级一次"，不是"高危文本放出去"，失败方向可接受 |

### 13.3 已知缺口（下一轮需决策）

1. **适配器未接进 `turn`，`reply` 仍恒空**：WP7 负责组装 `RenderSpec` + 接线 + 填 `reply`（`buildMessages` 缝已留）。
2. **无 NestJS DI 注册 / 无 Module**：`LlmRouterService` → `ChatCaller` 的生产接线在 WP8 统一做（本期按 M6 只交付可独立 `new` 的纯类）。
3. **窄面 `ChatCaller` 无 `uid` / 无 `AbortSignal`**：用户级 key 与请求取消在 WP8 接线时可能需**扩窄面**（适配层内部契约，内核契约不动）。
4. **无流式**：本期 `chat` 聚合一次性返回（M2）；`streamChat` 增量推送属 WP8。
5. **主备冷却为实例级全局**：任务单 §7 明确本期不做会话级隔离；"provider 刚挂了"是 provider 级事实，实例级共享是刻意的。
6. **温度 / 阈值 / 冷却时长种子值未标定**：`stable 0.2` / `chat 0.85` 为工程种子值，集中在 `render-adapter.config.ts`，WP8 按真实模型与实测校准。
7. **`fallbackUtterance` 文案未由产品定稿**：种子文案中性、不越界、不给建议；正式文案由产品/专业口径定稿。
8. **`pnpm build` 全量构建与既有业务测试本轮未跑**：建议合并前补跑。
