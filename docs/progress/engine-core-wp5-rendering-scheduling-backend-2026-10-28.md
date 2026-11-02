# WP5 · 多模型渲染调度（渲染契约层：意图→口语的端口 + 任务分层 + Token 预算裁剪 + 主备容灾契约 + 输出侧伦理校验）后端任务单

> 母版: [`../architecture/ai-engine-roadmap-v1.1.md`](../architecture/ai-engine-roadmap-v1.1.md) WP5（多模型渲染引擎 / 约束注入 / 流式 / 任务分层 / 主备容灾 / Token 预算）+ §3 五引擎「多模型渲染引擎」
> 前置: [`engine-core-wp0-boundary-skeleton-backend-2026-10-28.md`](./engine-core-wp0-boundary-skeleton-backend-2026-10-28.md)（边界骨架，已交付）、
>       [`engine-core-wp1-bdi-cognitive-engine-backend-2026-10-28.md`](./engine-core-wp1-bdi-cognitive-engine-backend-2026-10-28.md)（BDI 规则轨，已交付）、
>       [`engine-core-wp2-layered-memory-backend-2026-10-28.md`](./engine-core-wp2-layered-memory-backend-2026-10-28.md)（分层记忆 V1，已交付）、
>       [`engine-core-wp3-trajectory-control-backend-2026-10-28.md`](./engine-core-wp3-trajectory-control-backend-2026-10-28.md)（会话轨迹控制，已交付）、
>       [`engine-core-wp4-ethics-safety-backend-2026-10-28.md`](./engine-core-wp4-ethics-safety-backend-2026-10-28.md)（伦理安全，已交付并复跑绿：eslint 0 / tsc 0 / jest engine-core 153 用例全绿、engine-adapters 13 绿，WP0–WP3 既有 123 零回归）
> 仓库: `E:\Work\Project\backend\mofang-nestjs`
> 日期: 2026-10-28 ｜ 类型: 引擎内核**渲染契约层**（渲染端口接口 + 渲染规格 DTO + 任务分层枚举 + Token 预算/上下文裁剪纯函数 + 主备容灾选择状态机 + 输出侧伦理校验编排），本期**无真实 LLM 调用、无 prompt 模板、无流式、无落库、无模型**
> 目标读者: 后端；内核命令同 WP0–WP4，由大炮在 Windows 复跑 `lint` / `tsc` / `jest`
> **状态**: 🟢 **已交付并自跑复跑绿**（eslint 0 / tsc 0 / jest engine-core 7 套件 177 用例全绿、engine-adapters 13 用例全绿；WP0–WP4 既有 153 用例零回归）
> **交付记录**: [`engine-core-wp5-rendering-scheduling-implementation-2026-10-28.md`](./engine-core-wp5-rendering-scheduling-implementation-2026-10-28.md)

---

## 0. 一句话目标

在 WP1–WP4 之上给内核补一层**「渲染调度契约」**：把"结构化意图（Intention）+ 情绪/阻抗/移情 + 永久核心信念 + 记忆召回 + 轨迹参考 + 禁止行为 + 最近对话"打包成一份**与具体模型解耦的渲染规格 `RenderSpec`**，定义一个可替换的 `RenderPort` 抽象端口（未来由 NestJS 适配层接真实 LLM）；同时把**任务分层（低温稳定 / 高温口语 / 高阶）、单轮 Token 预算与上下文裁剪、主备容灾的"选谁"决策、渲染输出侧伦理校验**这些**不依赖网络的策略**写成纯函数放进内核，真实的模型调用、prompt 拼接、流式转发、自动重试执行全部留到适配层装配轮。本期内核**零 LLM、零网络、零 prompt、零落库、零管线改动**：`turn` 一行不改，`reply` 仍恒空，未注入 `RenderPort` 时与 WP4 **逐字一致**（零回归硬要求）。

> 衔接说明：WP1–WP4 的 `turn` 管线固定为 `loadState → [WP4 只读安全步] → classify → transitionState → planIntention → [WP3 轨迹步] → save → rememberTurn → openingContext`。**WP5 本期不重写、不插入、不改这条管线**，也不把渲染接进 `turn`。渲染发生在适配层：适配层拿到 `EngineTurnOutput.intention` 后，自己组装 `RenderSpec`、调注入的 `RenderPort`、拿结果填 `reply` 并做输出侧校验。内核本期只把"规格形状、端口、可测策略"立好，供装配轮直接消费。

> 为什么本期不在内核里真调 LLM：第 0 原则（roadmap §0）要求内核纯 TS、零框架、零 IO、未来整包搬走；LLM 调用属传输/适配职责（同 WP4 的 `RiskProbePort` 只留接口、PsyGUARD 真实实现留装配轮）。内核一旦 `fetch` 模型、读 `.env` 模型名、拼 prompt，就与网络和具体厂商绑死，拆微服务要返工。

---

## 1. 范围与 Done 定义

### 1.1 本期做到（In Scope）

1. **任务分层枚举 `RenderTaskKind`（纯字符串联合，非 enum）**：`stable`（结构化推理 / 状态更新 / 摘要，低温稳定模型）/ `chat`（来访口语生成，高温流式）/ `advanced`（复杂检测 / 高阶判定，按需调高阶模型）。只定义分类口径，不在内核选模型。
2. **渲染规格 DTO `RenderSpec`（纯数据，不落库）**：把本轮 `Intention`、当前 `emotion / resistance / transference / trust`、永久核心信念 `coreBeliefs`、依恋风格、合并后的 `forbiddenBehaviors`、WP2 记忆命中 `MemoryHit[]`、WP3 本轮轨迹参考、最近对话上下文、Token 预算打包成一个可序列化对象；不携带任何模型名、温度、prompt。
3. **渲染端口 `RenderPort`（接口，不实现）**：`render(spec: RenderSpec): Promise<RenderResult>`，范式照 `RiskProbePort` / `Embedder`：内核只依赖接口，真实 LLM / 主备切换 / 流式实现留适配层；端口不承诺成功，`reject` 由适配层兜住。
4. **渲染结果 `RenderResult`（纯数据）**：文本 + 任务分层标签 + 用量（completion/total tokens）+ `fallbackUsed` 标记 + 可选 `providerHint`；不含厂商私有字段。
5. **Token 预算纯函数（`cognition/rendering/token-budget.ts`）**：
   - 保守 token 估算 `estimateTokens(text)`（内核不装 tiktoken，字符率集中为常量，留替换口）；
   - `fitContextToBudget(turns, budgetTokens)`：从**尾部保留最近轮**，超预算从最旧往前丢整轮，单轮仍放不下时按字符截断并给出丢弃计数；
   - `resolveCompletionTokens(raw?, default)`：单轮完成上限归一，越界/非法回落种子值。
6. **主备容灾选择状态机纯函数（`cognition/rendering/failover.ts`）**：给定候选序列与已尝试记录/连续失败计数，决定"下一个选谁 / 是否耗尽"，纯函数无 IO、无定时器；真实网络重试、冷却、恢复切回在适配层。
7. **输出侧伦理校验编排（`cognition/rendering/output-guard.ts`）**：渲染文本复用 WP4 `assessSafety({ side: 'visitor_output' })`，返回 `SafetyVerdict`；内核**只给信号不重生成**，越界由适配层决定重生成 / 降级话术 / 拦截（补上 WP4 §12-3"拿到真实来访口语后启用 visitor_output 检测"的内核侧准备）。
8. 单测覆盖：任务分层、预算裁剪（整轮丢弃 / 单轮截断 / 上限归一）、容灾选择（主失败切备 / 耗尽 / 恢复计数）、输出校验（干净 pass / 高危命中 / probe 降级）、零回归。

### 1.2 明确不做（Out of Scope，后期/装配轮再入）

| 不做项 | 归属 |
|---|---|
| 真实 LLM 调用、system/user prompt 模板拼接、角色人设话术、中文来访口吻润色 | 适配层装配轮（内核只给 `RenderSpec` 与端口） |
| 温度 / topP / 模型名映射、按 `RenderTaskKind` 选具体厂商模型、API key / baseUrl / 超时读 `.env` | 适配层 / 配置层 |
| SSE / WS 流式转发、chunk 增量、语音 bidi 出声 | 适配层（现有 `src/llm` 流式底座复用） |
| 主备自动重试执行、超时切换、失败冷却、恢复后切回的网络动作 | 适配层（内核只给"选谁"纯决策） |
| 成本看板、token 计费、异常限流、预算告警埋点 | 后期运营轮 |
| 把 `RenderPort` 接进 `turn` 管线、给 `reply` 填值、自动触发渲染 | 装配轮（本期 `reply` 恒空，零回归） |
| 渲染结果落 MySQL / Qdrant、渲染审计表 | 装配轮 |
| 内核直接"重生成 / 替换话术 / 拦截输出" | 适配层职责，内核只给 `SafetyVerdict` 信号 |
| 用模型做情绪位移 / 台词风格微调、接入 PsycheChat 语料 | 后期模型轨 |

### 1.3 与现有 `src/llm` 路由的关系（重要，别重复造）

仓内 `src/llm/` 已有多 provider（deepseek/doubao/qwen/custom）+ `LlmRouterService` + 流式 `streamChat`。WP5 内核**不触碰、不重写**它：`RenderPort` 的真实实现由适配层包装现有 `LlmRouterService`（含主备 fallback、流式），内核只定义"要什么规格、返回什么结果"。现有路由的 provider 注册 / apiKey 解析 / tier 模型映射属适配层，本期不动。

---

## 2. 边界红线（继承 WP0–WP4，继续生效）

- `src/engine-core/` 整树**零** `@nestjs/*`、零 `typeorm`、零逃出本目录的相对 import、零 NestJS 装饰器；新增第三方依赖仍仅限 `{ nanoid }` + `node:*`。本期**不新增任何第三方包**（token 估算、裁剪、状态机全用标准库纯函数）。
- 端口方法签名**不破坏**：`openSession / turn / closeSession` 三方法名、同步/异步形态、既有返回形态不变；本期**不给 `OpenEngineSessionInput` / `EngineTurnInput` / `EngineTurnOutput` 加任何必填字段**（连可选字段也尽量不加；`reply` 仍恒空）。
- 内核不读数据库、不发网络、不调模型、不读 `.env`；`RenderPort` 由适配层装配时注入，本期 `turn` 内根本不调用它。
- 测试仍放 `test/engine-core/`，直接 `new` 内存实现跑，不启动 NestJS 容器；本期无 B 层，不建 `test/engine-adapters/` 新用例。
- 渲染策略**不改写** `snapshot` / `intention` / 轨迹游标 / 安全事件，不阻断 BDI 管线；内核无副作用。

> ⚠️ `test/engine-core/boundary.spec.ts` 的公开面白名单（断言⑥ `expectedPublic`）与目录清单（断言⑦ `expected`）是**硬编码**。本期新增公开导出 / 新文件后，**必须同步更新这两个断言**，不得删断言、不得改断言绕过去。

---

## 3. 目录落点

### 3.1 内核层（`src/engine-core/`，纯 TS，零框架）

```
src/engine-core/
├── domain/
│   ├── rendering/
│   │   └── render-types.ts           【新】RenderTaskKind / RenderSpec / RenderContextTurn / RenderTokenBudget / RenderResult
│   └── ports/
│       └── render-port.ts           【新】RenderPort 接口（真实 LLM 适配留装配轮）
├── cognition/
│   └── rendering/                    【新目录】渲染纯策略（无状态、无 IO、无随机）
│       ├── token-budget.ts          【新】estimateTokens / fitContextToBudget / resolveCompletionTokens + 种子常量
│       ├── failover.ts               【新】主备容灾"选谁"纯状态机（候选序列/失败计数/耗尽判定）
│       └── output-guard.ts          【新】渲染文本过 WP4 assessSafety(visitor_output) 的输出侧校验编排
└── index.ts                          【改】导出新增类型/纯函数（同步 boundary 白名单）
```

> 说明：本期**不改** `in-memory/in-memory-engine-session.ts`（不构造注入 renderer、不在 turn 调用），渲染与本轮管线解耦；`RenderPort` 的注入与调用全部在未来适配层。这样保证零回归。

### 3.2 B 层 / 适配层

本期**无 B 层、无适配实现**：不写 LLM 客户端、不接 `LlmRouterService`、不建表。`src/engine-adapters/` 现有文件不动；`RenderPort` 的真实实现（包装现有 `src/llm`、主备切换、流式）留装配轮。

---

## 4. 类型契约（可直接施工）

### 4.1 渲染类型（`domain/rendering/render-types.ts`，新）

```ts
import type { Intention } from '../intention';
import type { EmotionState } from '../emotion';
import type { BdiResistance } from '../bdi-snapshot';
import type { TransferenceState } from '../transference';
import type { CoreBelief } from '../beliefs';
import type { AttachmentStyle } from '../character-profile';
import type { MemoryHit } from '../ports/memory.store';

/**
 * 任务分层: 决定适配层选低温稳定 / 高温口语 / 高阶模型, 内核不选模型.
 * 用字符串联合而非 enum: 纯控制流判别式, 保持内核零运行时导出.
 */
export type RenderTaskKind =
  | 'stable'    // 结构化推理 / 状态更新 / 摘要 → 低温稳定模型
  | 'chat'      // 来访口语生成 → 高温流式
  | 'advanced'; // 复杂检测 / 高阶判定 → 按需高阶模型

/** 最近对话的一轮 (角色归一; 内核不区分 ASR 来源). */
export interface RenderContextTurn {
  readonly role: 'counselor' | 'visitor';
  readonly text: string;
}

/** Token 预算 (适配层把具体上限换算成 token; 内核只做裁剪与归一). */
export interface RenderTokenBudget {
  /** 单轮完成 (completion) token 上限. */
  readonly maxCompletionTokens: number;
  /** 可放入上下文的 token 预算 (用于 fitContextToBudget). */
  readonly contextTokens: number;
}

/**
 * 渲染规格 (纯数据, 可序列化): 适配层从 EngineTurnOutput + 记忆 + 轨迹组装.
 * 不含模型名 / 温度 / prompt / apiKey —— 那些属适配层.
 */
export interface RenderSpec {
  readonly taskKind: RenderTaskKind;
  /** 本轮结构化意图 (WP1). */
  readonly intention: Intention;
  readonly emotion: EmotionState;
  readonly resistance: BdiResistance;
  readonly transference: TransferenceState;
  /** 关系信任 [0,1]. */
  readonly trust: number;
  /** 永久核心信念 (不可变锚点). */
  readonly coreBeliefs: readonly CoreBelief[];
  readonly attachmentStyle?: AttachmentStyle;
  /** 禁止行为 (角色 forbiddenBehaviors ∪ 本轮 intention.forbiddenBehaviors, 由适配层合并去重). */
  readonly forbiddenBehaviors: readonly string[];
  /** WP2 记忆命中 (本轮相关召回). */
  readonly recall: readonly MemoryHit[];
  /** WP3 本轮轨迹参考素材 / 承接提示 (从 trajectoryTrace 提取, 可空). */
  readonly trajectoryNote?: string;
  /** 最近对话 (已按预算裁剪前的原始序列, 由 fitContextToBudget 裁剪). */
  readonly recentTurns: readonly RenderContextTurn[];
  readonly tokenBudget: RenderTokenBudget;
}

/** 渲染结果 (纯数据, 不含厂商私有字段). */
export interface RenderResult {
  readonly text: string;
  readonly taskKind: RenderTaskKind;
  readonly usage: {
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
  /** 是否走了备用候选 (适配层置位). */
  readonly fallbackUsed: boolean;
  /** 可选: 实际提供服务的候选标识 (适配层填, 供观测). */
  readonly providerHint?: string;
}
```

### 4.2 渲染端口（`domain/ports/render-port.ts`，新）

```ts
import type { RenderSpec, RenderResult } from '../rendering/render-types';

/**
 * 渲染抽象 (未来 = 适配层包装现有 src/llm 的主备/流式实现).
 * 内核只依赖该接口, 不关心模型部署 / 厂商 / 网络.
 * 失败语义: 端口不承诺成功, render 允许 reject —— 由适配层兜住并按 failover 决策切换,
 * 内核自身不重试、不冷却、不读时钟.
 */
export interface RenderPort {
  render(spec: RenderSpec): Promise<RenderResult>;
}
```

### 4.3 Token 预算纯函数（`cognition/rendering/token-budget.ts`，新）

```ts
/** 保守 token 估算种子 (中文为主; 内核不装 tiktoken, 字符率集中此处, 后期可替换为编码器). */
export const DEFAULT_COMPLETION_TOKENS = 160;
/** 每 token 保守估算字符数 (中文按 ~1.6 字符/token 的保守口径; 偏宁可多估不可少估). */
export const CHARS_PER_TOKEN = 1.6;

/** 保守估算文本 token 数 (无编码器时的工程近似, 仅供预算裁剪, 不作计费). */
export function estimateTokens(text: string): number;

/**
 * 按 contextTokens 预算裁剪最近对话: 尾部保留最近轮, 超预算从最旧往前丢整轮;
 * 单轮仍放不下时按字符从头部截断 (保留尾部), 返回裁剪后序列与丢弃/截断计数.
 */
export function fitContextToBudget(
  turns: readonly RenderContextTurn[],
  budgetTokens: number,
): { turns: RenderContextTurn[]; droppedTurns: number; truncatedTurns: number };

/** 单轮完成上限归一: 越界 / NaN / ≤0 → 回落 default(DEFAULT_COMPLETION_TOKENS), 不抛. */
export function resolveCompletionTokens(raw: number | undefined, fallback?: number): number;
```

### 4.4 主备容灾选择状态机（`cognition/rendering/failover.ts`，新）

```ts
/** 一个可服务候选 (适配层提供; 内核只做选择). */
export interface FailoverCandidate {
  readonly id: string;
}

/** 容灾状态 (纯数据, 由适配层持有; 内核函数只做纯推导). */
export interface FailoverState {
  /** 候选序列, 第 0 位为主. */
  readonly candidates: readonly FailoverCandidate[];
  /** 已尝试过的候选 id (按尝试顺序). */
  readonly attempted: readonly string[];
  /** 各候选连续失败计数 (无记录 = 0). */
  readonly consecutiveFailures: Readonly<Record<string, number>>;
}

/**
 * 选择下一个候选: 主失败后按序列切备; 全部尝试过 → 返回 null (exhausted, 适配层降级).
 * 纯函数, 无 IO / 无定时器 / 无冷却; 真实重试、退避、恢复切回由适配层实现.
 */
export function selectFailoverTarget(state: FailoverState): FailoverCandidate | null;
```

### 4.5 输出侧伦理校验编排（`cognition/rendering/output-guard.ts`，新）

```ts
import type { RiskProbePort } from '../../domain/ports/risk-probe';
import type { SafetyVerdict } from '../../domain/safety/safety-types';

/**
 * 渲染文本输出侧校验: 复用 WP4 assessSafety(side='visitor_output').
 * 内核只返回 verdict 信号, 不重生成 / 不替换 / 不拦截;
 * 越界 (warn/block) 由适配层决定重生成 / 降级话术 / 拦截.
 * 超时 / probe 异常静默回落规则 (同 WP4, 不炸穿).
 */
export function guardVisitorOutput(
  text: string,
  opts?: { probe?: RiskProbePort; timeoutMs?: number },
): Promise<SafetyVerdict>;
```

> `guardVisitorOutput` 内部直接复用 WP4 的 `assessSafety`，只是把 `side` 固定为 `'visitor_output'` 并做一层薄封装，避免适配层自己拼 WP4 参数；**不重复实现**规则判定与降级。

---

## 5. 策略语义（实施中不反复）

### 5.1 任务分层口径（`RenderTaskKind`）

| kind | 用途 | 适配层取向（内核不强制） |
|---|---|---|
| `stable` | 状态更新、意图后处理、摘要、记忆晋升等结构化推理 | 低温、确定性、便宜模型 |
| `chat` | 来访本轮口语回应 | 高温、流式、符合角色口吻 |
| `advanced` | 复杂检测、高阶判定（后期） | 按需调高阶模型，不每轮都用 |

内核只携带 `taskKind` 标签，不写死温度/模型；温度与模型名映射在适配层。

### 5.2 Token 预算裁剪（`fitContextToBudget`）

1. `estimateTokens` 用 `CHARS_PER_TOKEN` 保守估算；预算裁剪只做"塞得下吗"的工程近似，**不作计费依据**。
2. 保留方向：**永远保留尾部最近轮**（对话新近性最重要）；超预算从最旧的轮开始整轮丢弃。
3. 某一轮单独就超预算：整轮丢不出去（至少要把当前轮呈现）时，从该轮**头部截断字符**、保留尾部，并在 `truncatedTurns` 计数。
4. `resolveCompletionTokens`：`undefined` / NaN / ≤0 → 回落 `DEFAULT_COMPLETION_TOKENS=160`，不抛；正数原样返回。

### 5.3 容灾选择（`selectFailoverTarget`）

1. 候选第 0 位为主；`attempted` 不含它时优先选主（健康时每次都从主开始，由适配层在主失败后记入 attempted）。
2. 主在 `attempted` 中 → 按序列选第一个**未尝试**的候选；都尝试过 → 返回 `null`（exhausted，适配层走最终降级，不炸）。
3. 本函数**不做**连续失败阈值、冷却、恢复切回、指数退避——这些是有状态/有时钟的运行时行为，属适配层；内核只回答"按当前记录下一个选谁"。

### 5.4 输出校验（`guardVisitorOutput`）

- 干净文本 → `pass`、空类别；命中高危（自杀计划/准备/主动意图/自伤行为/攻击他人）→ `block` 信号，适配层不得把该文本直接出声，应重生成或降级。
- 注入了 `probe`（未来 PsyGUARD 适配）且规则非 block 才异步探测；超时/抛错/脏形状静默回落规则，同 WP4。
- 内核不据此改写 `RenderResult.text`，只给 `SafetyVerdict`。

### 5.5 本期不接管线（零回归关键）

- `turn` 内**不调用** `RenderPort`、不组装 `RenderSpec`、不调 `guardVisitorOutput`；`reply` 恒 `''`。
- 无 `RenderPort`、无任何渲染动作时，整条 turn 与 WP4 逐字一致，出参字段集合不变。

---

## 6. 软降级与容错

| 场景 | 行为 |
|---|---|
| 未注入 / 不使用 RenderPort | turn 完全不受影响，与 WP4 逐字一致（本期默认状态） |
| 上下文轮数为 0 / 空文本 | `fitContextToBudget` 返回空/原样，不抛；`estimateTokens('')=0` |
| 单轮文本远超预算 | 头部截断保留尾部，`truncatedTurns+1`，不丢当前轮 |
| `maxCompletionTokens` 越界（≤0 / NaN / undefined） | `resolveCompletionTokens` 回落 160，不抛 |
| 候选全部尝试过 | `selectFailoverTarget` 返回 `null`，适配层走最终降级，内核不抛 |
| 输出校验 probe 超时 / 抛错 / 脏形状 | 回落规则结果，不炸穿（同 WP4） |
| `trajectoryNote` / `attachmentStyle` / `providerHint` 缺省 | 可选字段省略，不报错 |

---

## 7. 异常与边界

| 场景 | 行为 |
|---|---|
| 本期 turn 是否产出口语 | **不产出**：`reply` 恒 `''`，渲染留装配轮 |
| 内核是否读 `.env` / 选模型 / 拼 prompt | 一律不；全部适配层 |
| 跨会话 / 跨租户 | 本期无会话内渲染状态；`RenderSpec` 是适配层每次现造的纯对象，无共享可变态 |
| 主备状态由谁持有 | 适配层持有 `FailoverState`，内核纯函数只做选择推导 |
| 输出 block 是否拦截出声 | 内核只给信号，拦截/重生成由适配层 |
| 与 WP4 安全步的关系 | `guardVisitorOutput` 复用 `assessSafety`，不重复造规则；咨询师侧检测仍在 WP4 安全步，本期不动 |

---

## 8. 单测清单（`test/engine-core/wp5-rendering.spec.ts`，纯内存）

1. **任务分层枚举存在**：`stable / chat / advanced` 三个标签形状正确（类型层由 tsc 保证，测试覆盖消费路径）。
2. **预算估算**：`estimateTokens('')=0`；中文长文本估算为正数且随长度单调不减。
3. **整轮丢弃**：构造多轮且总 token 超 `contextTokens`，`fitContextToBudget` 结果尾部轮保留、最旧轮被丢，`droppedTurns>0`。
4. **单轮截断**：单轮文本单独超预算 → 该轮被头部截断保留尾部，`truncatedTurns=1`，结果非空。
5. **预算上限归一**：`resolveCompletionTokens(undefined/0/NaN)` → 160；正数原样返回。
6. **容灾选主**：`attempted` 为空 → 选候选[0]。
7. **主失败切备**：主在 attempted 且有未尝试备选 → 选第一个未尝试候选。
8. **耗尽返回 null**：全部候选已尝试 → `selectFailoverTarget` 返回 `null`，不抛。
9. **输出校验干净**：干净来访文本 → `pass`、空类别。
10. **输出校验高危命中**：喂入 `active_ideation`/`suicide_plan` 种子词 → `block`、类别正确。
11. **输出校验 probe 降级**：fake probe 超时/抛错 → 回落规则，不炸穿。
12. **零回归**：不传任何渲染依赖，turn 产出的 snapshot/intention/turnIndex/trajectoryTrace/safety 与 WP4 路径一致，`reply` 仍为 `''`，出参无新增字段。

---

## 9. 验收清单（逐条可勾选）

- [x] `npx tsc -p tsconfig.build.json --noEmit` 0 错。
- [x] `npx eslint "src/**/*.ts"` 0 error（新文件遵守既有 complexity / prettier / import-order）。
- [x] `npx jest test/engine-core` 全绿；**WP0–WP4 既有 engine-core 用例零回归**（engine-adapters 本期不动，复跑仍绿即可）。
- [x] `boundary.spec.ts` 全绿：内核整树零 `@nestjs`/`typeorm`；本期新增导出已进断言⑥白名单、新文件已进断言⑦目录清单（双向比对不漏不多）。
- [x] 本期**未改** `in-memory/in-memory-engine-session.ts` 的 turn 管线；`reply` 仍恒 `''`；无渲染依赖时出参与 WP4 逐字一致。
- [x] `RenderPort` 仅接口，内核无任何 LLM 调用 / prompt / 网络 / `.env` / 模型名。
- [x] 容灾函数纯函数无 IO/无定时器；输出校验复用 WP4 `assessSafety`，不重复实现规则。
- [x] 本期零 migration/entity/新表、零 `.env` 改动、零新第三方依赖、零落库。

---

## 10. 交付闸门（大炮在 Windows 跑）

```powershell
cd E:\Work\Project\backend\mofang-nestjs
npx eslint "src/**/*.ts"
npx tsc -p tsconfig.build.json --noEmit
npx jest test/engine-core
```

**新增 env 开关**：无。本期纯内核契约 + 纯策略函数，不新增 `.env` 项、不接 LLM/模型名/主备地址（全部留适配层装配轮）。

---

## 11. 关键决策记录（已定，实施中不反复）

| # | 决策 | 理由 / 备选 |
|---|---|---|
| M1 | 本期只立**渲染契约层**，不真调 LLM、不接 turn | 第 0 原则：内核零 IO/零网络，未来整包搬走；真调用绑死厂商与网络，拆微服务要返工（同 WP4 RiskProbePort 只留接口） |
| M2 | `RenderSpec` 只装结构化目标与状态，不含模型名/温度/prompt | 模型选型与话术是适配层/配置职责；内核只回答"决策到哪了"，不回答"用哪个模型说" |
| M3 | 任务分层用字符串联合非 enum | 同 WP2/WP4：纯控制流判别式，保持内核零运行时导出 |
| M4 | Token 估算是**保守工程近似**，不作计费；不装 tiktoken | 内核保持零新依赖；字符率集中常量，后期可换编码器；裁剪只判断"塞不塞得下" |
| M5 | 容灾只给"选谁"纯决策，不做重试/冷却/退避/恢复切回 | 后者有时钟/有状态/有网络，属适配层运行时；内核纯函数可测、可复现 |
| M6 | 输出校验复用 WP4 `assessSafety(visitor_output)`，薄封装不重造 | 规则与降级口径统一，避免两套 visitor_output 判定漂移；补上 WP4 §12-3 的内核侧准备 |
| M7 | 本期不构造注入 RenderPort、不在 turn 调用 | 保证零回归：默认状态下整条管线与 WP4 逐字一致，渲染接线完整留给装配轮 |
| M8 | `RenderResult` 不含厂商私有字段，只暴露 usage/fallbackUsed/providerHint | 结果要能跨厂商、跨实现通用；厂商特有字段留在适配层内部 |

### 待大炮过目（不阻塞开工，有异议再调）

- `DEFAULT_COMPLETION_TOKENS=160`、`CHARS_PER_TOKEN=1.6` 是工程种子值，非标定；集中为常量，装配轮接真实编码器/按模型上下文窗口校准。
- 主备容灾本期只给选择状态机，真实"主失败 N 次切备、冷却、健康恢复切回"在适配层；若装配轮发现需要内核侧持有连续失败计数，再以纯函数形式追加状态迁移，不在本期提前做。
- `guardVisitorOutput` 本期不接进 turn，仅作为装配层拿到渲染文本后的校验工具；咨询师侧检测仍由 WP4 安全步覆盖。

---

## 12. 下一步（本期不做，另起任务单）

1. **渲染装配轮（适配层，独立成单）**：包装现有 `src/llm` 的 `LlmRouterService` 实现 `RenderPort`；组装 `RenderSpec`、按 `RenderTaskKind` 选温度/模型、接主备自动切换与流式、把结果填 `reply`、输出过 `guardVisitorOutput`、SSE/WS 对接到现有语音播放。
2. **WP2 遗留补漏（与 WP5 无关，单独成单，勿并入本期）**：Qdrant 写侧 `setPayload`/scroll 冲突标记；短时记忆自动写入与会话结束编排层接线；衰减半衰期 30 天 / 阈值 0.1 标定。
3. **PsyGUARD 独立服务 + B 层适配轮**：独立 Python FastAPI（RoBERTa 11 类，CPU，单条 <50ms），B 层写 HTTP `RiskProbePort` 实现，同时供 WP4 咨询师侧与 WP5 输出侧使用。
4. **伦理报告落库/入档案**：把 WP4 进程内 `SafetyReport` 持久化进实训档案、对接会后复盘页。
5. **成本运营轮**：token 计费、成本看板、异常限流、预算告警埋点（后期）。

---

## 13. 交付状态

**代码已交付并自跑复跑绿**，逐条对照见交付记录
[`engine-core-wp5-rendering-scheduling-implementation-2026-10-28.md`](./engine-core-wp5-rendering-scheduling-implementation-2026-10-28.md)。

### 13.1 闸门

| 命令 | 结果 |
|---|---|
| `npx eslint "src/**/*.ts"` | exit 0，0 error |
| `npx tsc -p tsconfig.build.json --noEmit` | exit 0，0 error |
| `npx jest test/engine-core` | 7 套件 / 177 用例全绿（WP0–WP4 既有 153 **零回归** + WP5 新增 24） |
| `npx jest test/engine-adapters` | 1 套件 / 13 用例全绿（WP2 B 层，本期未动） |

`pnpm build` 全量构建与既有业务测试本轮未跑（本期零 entity / migration / module 改动，且 **turn 管线零改动**）。

> `npx jest test/engine-core` 并行模式会**偶发**打印一条「worker 未优雅退出」告警 —— 已定位为**环境并发问题、非本期代码缺陷**（证据链见交付记录 §1.1）；退出码 0、177 用例结果不受影响。复跑加 `--maxWorkers=2` 可消除且更快（实测 44–51s → 13–17s）。

### 13.2 与本单的差异（须知会）

| # | 差异 | 理由 |
|---|---|---|
| 1 | **`FailoverState.consecutiveFailures` 随状态带过来，但选择时不参与判定** | 状态就该是状态的完整样子 —— 只挑内核当下用得上的字段传过来，等于让内核与适配层各持一份不同的真相；阈值/冷却由适配层读它自己决定 |
| 2 | **预算裁剪的「整轮丢弃」方向写死为从最旧开始** | 对话新近性最重要；"丢当前轮"与"丢最旧轮"在实现上是两种完全不同的循环写法，先定方向才不会写反 |
| 3 | **token 估算保守（偏多估）** | 少估 → 实际塞不下 → 模型侧静默截断而内核以为裁好了（"以为做了防护其实没做"）；多估只浪费几个 token。失败方向必须是安全那侧 |
| 4 | **`resolveCompletionTokens` 对正数原样返回（不 floor）** | 按 §4.3/§5.2「正数原样返回」；上限是否取整属适配层/配置层口径，内核不擅自改写调用方的数 |
| 5 | **零回归断言锁到「出参字段集合」** | 只断言 `reply === ''` 不够 —— 若将来有人在 `turn` 出参里偷偷加字段，字段集合断言会立刻变红 |
| 6 | **访问核用 `import type` 统一风格** | 与内核既有文件（`import type { X } from '...'`）一致 |

### 13.3 已知缺口（下一轮需决策）

1. **`RenderPort` 无真实实现、`reply` 仍恒空**：装配轮包装现有 `LlmRouterService`（含主备 fallback 与流式）实现 `RenderPort`；本期内核不调模型。
2. **无渲染规格组装器**：`RenderSpec` 的组装（意图 + 记忆 + 轨迹 → 规格）在适配层，内核只定义形状。
3. **`DEFAULT_COMPLETION_TOKENS=160` / `CHARS_PER_TOKEN=1.6` 未标定**：集中为常量，装配轮接真实编码器 / 按模型上下文窗口校准。
4. **容灾只给选择，不给执行**：主失败 N 次切备、冷却、健康恢复切回在适配层；若装配轮发现需要内核侧持有连续失败计数，再以纯函数形式追加状态迁移。
5. **输出侧高危由适配层决定重生成/降级/拦截**：内核只给信号（内核只判定不拦截，同 WP4）。
6. **WP2 遗留两项另起单**：Qdrant 写侧冲突标记（需给 `QdrantService` 补 `setPayload`）、短时记忆自动写入与会话结束编排层接线。均与 WP5 无关，本期未动。
7. **jest 并行模式偶发「worker 未优雅退出」告警（环境并发，非本期代码缺陷）**：已定位为默认 7 个 ts-jest worker 把 8 核机器压满导致的 worker 退出握手超时；`--detectOpenHandles` 全量零 open handle、`--runInBand` 与 `--maxWorkers=2` 均无告警。退出码 0、结果不受影响。是否在 `jest.config.ts` 固化 `maxWorkers` 由仓库负责人决定（详见交付记录 §1.1 五条证据）。
