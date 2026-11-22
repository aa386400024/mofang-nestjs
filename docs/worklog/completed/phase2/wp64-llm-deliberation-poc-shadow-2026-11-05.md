# WP64 任务单 — LLM 审议层 PoC（影子模式）

> **状态**：✅ 已交付（2026-11-05）→ [`engine-wp64-llm-deliberation-poc-shadow-implementation-2026-11-05.md`](engine-wp64-llm-deliberation-poc-shadow-implementation-2026-11-05.md)
> **路径**：`docs/worklog/completed/phase2/wp64-llm-deliberation-poc-shadow-2026-11-05.md`
> **优先级**：🟡 P1
> **引擎内核**：✅ 零改动（审议在适配层，不接进内核管道）
> **前置依赖**：WP63（审议 Schema 设计）
> **北极星**：[`../../../architecture/hybrid-bdi-agent-blueprint-v1.0.md`](../../../architecture/hybrid-bdi-agent-blueprint-v1.0.md) §2.2 审议引擎层

---

## 1. 任务概述

### 1.1 一句话目标

在不影响生产的前提下，影子模式跑 LLM 审议——每轮对话后旁路跑一次，对比"LLM 审议 delta"和"规则算子 delta"，积累 100 场真实对话数据，验证 LLM 审议的质量和可行性。

### 1.2 为什么现在做

- WP63 已经把 schema 和 prompt 零件定好了，现在要把它们组装成真正的服务
- 影子模式是"先验证再切换"的必经之路——没有数据，切灰度就是赌博
- 内测阶段刚好能跑真实对话数据，不用自己造测试用例

### 1.3 本期不做什么

- ❌ 不把审议结果写进状态（影子模式 = 旁路观察，不生效）
- ❌ 不接进渲染 prompt（切灰度后才接）
- ❌ 不做格式校验重试（WP66 的事）
- ❌ 不做降级策略（WP67 的事）
- ❌ 不改 engine-core 任何文件
- ❌ 不做 per-session 串行队列（WP65 的事）

---

## 2. 现状盘查结论（已 grep 全渲染层核实）

### 2.1 CounselorLlmJsonClient（结构化输出客户端）

```ts
// src/counselor/providers/llm-json.client.ts:110
async requestJson<T>(input: CounselorLlmJsonRequest<T>): Promise<CounselorLlmJsonResult<T>>
```

**关键口径**：
- 错误当数据返回，不 throw（ok=false + errorCode）
- systemPrompt + schemaDescription 自动拼在一起
- 需要：systemPrompt / userPrompt / schemaDescription / validate / maxCompletionTokens / timeoutMs / tenantId / userId

**WP63 已经出了三个零件**：
- `buildDeliberationSystemPrompt(mode)` → systemPrompt
- `buildDeliberationUserPrompt(input)` → userPrompt
- `buildDeliberationSchemaDescription()` → schemaDescription

本期把这三个零件塞进 `requestJson` 就行。

### 2.2 会话引擎 turn 流程

```ts
// src/engine-core/in-memory/in-memory-engine-session.ts:324
async turn(handleId: string, input: EngineTurnInput): Promise<EngineTurnOutput>
```

**流程**（简化）：
1. 载入状态 base
2. 安全判定 assessSafety（只读不改）
3. 事件分类 classifier.classify(userText) → events
4. 人格调节 + 聚合 delta → eventDelta
5. transitionState → provisional 临时快照
6. planIntention → intention
7. applyTrajectoryStep → trajectory.delta
8. totalDelta = eventDelta + trajectory.delta
9. cappedTotal = capTurnDelta(totalDelta) ← **这就是规则算子的最终 delta**
10. nextSnapshot = applyDeltaVector(base.snapshot, cappedTotal)
11. 落库 bdiStates.save(...)

**影子模式在哪里插入**：
- 在适配层（counselor 服务层），调完 `engineSession.turn()` 之后，**旁路**调一次审议服务
- 不进内核管道，不改 turn 方法
- fire-and-forget：不等审议结果，不影响主流程响应时间

### 2.3 现有 Redis 基础设施

WP32 刚做了 `RedisBdiStateRepository`，Redis 连接已经通了。本期直接复用 `RedisService.getClient()` 存 trace 数据。

### 2.4 现有观察者模式（DeltaCapLogger）

`DeltaCapLogger` 是 cap 观察者——内核上报 cap 报告，adapter 打日志。本期审议服务不是观察者（内核没有 turn 完成事件），是适配层主动调的。

---

## 3. 本期做什么

### 3.1 新增审议服务

新增 `src/engine-adapters/deliberation/llm-deliberation.service.ts`：

```ts
@Injectable()
export class LlmDeliberationService {
  constructor(
    private readonly llmJsonClient: CounselorLlmJsonClient,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * 影子模式跑一次审议（不生效，只记录对比数据）.
   *
   * fire-and-forget：调用方不需要 await，不影响主流程响应时间.
   * 内部捕获所有异常，不抛——影子模式挂了不能炸主流程.
   */
  async runShadowMode(input: DeliberationShadowInput): Promise<void>;
}
```

**DeliberationShadowInput**：
```ts
export interface DeliberationShadowInput {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly turnIndex: number;
  /** 当前会话模式（考核 / 自由练习）—— 决定用哪套 prompt 模板. */
  readonly mode: DeliberationMode;
  /** 本轮开始时的 BDI 状态快照（旧状态，不是变化后的）. */
  readonly baseSnapshot: BdiSnapshot;
  /** 本轮咨询师说的话. */
  readonly counselorText: string;
  /** 本轮来访的反应（**LLM 渲染输出的文本**，不是真实用户语音转文字）. */
  readonly visitorText: string;
  /** 角色种子信息（依恋类型 / 大五人格 简述）. */
  readonly characterBrief: string;
  /** 规则算子算出的最终 delta（capped 后的，用来对比）. */
  readonly ruleDelta: DeltaVector;
}
```

**runShadowMode 内部流程**：
1. 检查 env 开关 `ENGINE_DELIBERATION_ENABLED`，false 就直接 return
2. 组装 systemPrompt + userPrompt + schemaDescription（用 WP63 的三个函数，按 `input.mode` 选 exam / freeform 模板）
3. 调 `llmJsonClient.requestJson<DeliberationOutput>({
     systemPrompt: buildDeliberationSystemPrompt(input.mode),
     userPrompt: buildDeliberationUserPrompt({...}),
     schemaDescription: buildDeliberationSchemaDescription(),
     validate: validateDeliberationOutput,  // WP66 正式做，本期先写个最简版
     maxCompletionTokens: 512,  // 审议输出大概 200-300 token，留足余量
     timeoutMs: configService.get<number>('ENGINE_DELIBERATION_TIMEOUT_MS') ?? 3000,
     tenantId: input.tenantId,
     userId: input.userId,
   })`
4. 如果成功：
   - 计算 delta 差异（审议 delta vs 规则 delta，逐维度对比）
   - 写 trace 数据到 Redis
5. 如果失败：
   - 记录失败原因到 trace 表（ok=false + errorCode）
6. 所有异常都 catch 住，不抛

### 3.2 trace 数据存储（Redis）

**key 设计**（与 WP32 同一套复合键纪律，长度前缀防撞键）：
```
deliberation_trace:{tenantId.length}:{tenantId}:{sessionId.length}:{sessionId}:{turnIndex}
```

**为什么加长度前缀**：
WP32 的 `RedisBdiStateRepository` 早就用长度前缀解决了撞键问题（`(租户="a:b", 会话="c")` 与 `(租户="a", 会话="b:c")` 会撞键 = 跨租户串数据）。本期沿用同一套纪律，不另创一套。

**value（JSON 字符串）**：
```json
{
  "sessionId": "xxx",
  "turnIndex": 12,
  "timestamp": "2026-11-05T10:30:00.000Z",
  "ok": true,
  "errorCode": null,
  "durationMs": 1850,
  "mode": "freeform",
  "tokenUsage": {
    "promptTokens": 1200,
    "completionTokens": 180,
    "totalTokens": 1380
  },
  "ruleDelta": {
    "trust": 0.05,
    "safety": 0.02,
    "bond": 0.01,
    "valence": -0.01,
    "arousal": 0.0,
    "verbal": 0.0,
    "depth": 0.0,
    "style": 0.0,
    "positive": 0.0,
    "negative": 0.0,
    "dependency": 0.0
  },
  "deliberationDelta": {
    "trust": 0.08,
    "safety": 0.03,
    "valence": -0.02
  },
  "deltaDiff": {
    "trust": 0.03,
    "safety": 0.01,
    "valence": -0.01
  },
  "operatorTags": ["empathy", "micro_expression"],
  "reason": "咨询师语气温和，但未直接回应来访情绪，共情效果中等",
  "confidence": 0.65,
  "summary": "来访情绪略有低落，但信任关系在缓慢建立"
}
```

**注意**：trace 表里的 `visitorText` 是 **LLM 渲染输出的来访回应**，不是真实用户的语音转文字——看数据的人不要搞混。

**为什么放 Redis 不放 DB**：
- 影子模式数据量不大（100 场对话 × 每轮一次 ≈ 几千条）
- Redis 读写快，适合做旁路观察
- DB 兜底留到后续 WP（WP32 的 backlog 里也有这条）

**TTL**：30 天（影子模式数据留一个月够分析了）

### 3.3 装配层接线

在 `engine.module.ts` 或 `counselor.module.ts` 里注册 `LlmDeliberationService` 为 provider。

**在哪里调 runShadowMode**：
- 在 counselor 服务调 `engineSession.turn()` 之后，调 `deliberationService.runShadowMode(...)`
- **具体位置**：`src/counselor/` 下调 `engineSession.turn()` 的服务（自由练习引擎 / 全真执业对练）——grep 一下 `engineSession.turn(` 或 `engineSessionPort.turn(` 就能找到所有调用点
- 不 await（fire-and-forget）
- 不影响主流程响应时间

### 3.4 env 配置项

`.env.example` 新增：
- `ENGINE_DELIBERATION_ENABLED` —— `true` / `false`，默认 `false`（影子模式开关）
- `ENGINE_DELIBERATION_MODEL` —— 审议用的模型名（留空 = 用现有 counselor 默认模型）
- `ENGINE_DELIBERATION_TIMEOUT_MS` —— 审议超时时间，默认 3000
- `ENGINE_DELIBERATION_TEMPERATURE` —— 审议温度，默认 0.3（自由练习模式）

`typings/global.d.ts` 对应加四个 ProcessEnv 声明。

---

## 4. 边界问题补充

### 4.1 ⚠️ 为什么不进内核管道？

**因为影子模式的核心是"不影响生产"。**

- 进内核管道 = 改 turn 方法 = 改 engine-core = 违反红线
- 影子模式就是旁路观察，不需要进主流程
- 将来切灰度了，才需要考虑"审议结果怎么接进状态更新"——那是 Phase3A 的事

### 4.2 ⚠️ 为什么 fire-and-forget 不等结果？

**因为影子模式阶段，审议结果不生效。**

- 生产路径：咨询师说话 → 状态变化 → 渲染来访回应 → 返回给用户
- 旁路路径：同时跑 LLM 审议，结果写 trace 表
- 如果等审议结果，响应时间就多了 1-3 秒——用户会感觉卡
- 影子模式的目的是"收集数据"，不是"实时用"

### 4.3 ⚠️ 高安全维度怎么处理？

**硬安全维度（自杀倾向 / 危机等级）永远走规则，不跑 LLM 审议。**

- WP63 的 schema 里已经排除了硬安全维度
- 审议输出如果意外出现了硬安全维度的 delta，约束校验层会拦（本期还没做约束校验层，但 schema 层面已经排除了）
- 这条是红线，没有商量余地

### 4.4 ⚠️ 心理数据合规边界

审议 prompt 里传的是：
- 结构化状态快照（JSON，不是对话原文）
- 咨询师的话（counselorText）
- 来访的渲染回应（visitorText）

**注意**：这里传了对话内容给第三方 LLM（MiniMax）。影子模式阶段：
- 内测用户已经签了用户协议（里面写了"对话内容会用于 AI 来访的状态推理"）
- 高风险对话（涉及自杀、自伤）走本地规则审议，不发给 LLM（本期先留接口，WP67 降级策略里做）

---

## 5. 边界约束

### 5.1 内核改动

**零改动。** 审议服务在适配层，不进内核管道。

### 5.2 适配层改动（3 个文件）

1. `src/engine-adapters/deliberation/llm-deliberation.service.ts` —— **新增** 审议服务
2. `src/engine-adapters/wiring/engine.module.ts` —— 注册 provider
3. `.env.example` + `typings/global.d.ts` —— 4 个 env 键

### 5.3 测试文件

1. `test/engine-adapters/wp64-deliberation-shadow.spec.ts` —— **新增** 测试

### 5.4 不碰的地方

- ❌ 不改内核任何文件
- ❌ 不改 `InMemoryEngineSession.turn()` 方法
- ❌ 不把审议结果写进状态
- ❌ 不做格式校验重试（WP66 的事）
- ❌ 不做降级策略（WP67 的事）
- ❌ 不做 per-session 串行队列（WP65 的事）

---

## 6. 验收标准

### 6.1 功能验收

- [ ] `LlmDeliberationService` 实现了 `runShadowMode` 方法
- [ ] env `ENGINE_DELIBERATION_ENABLED=false` 时，直接 return，不调 LLM
- [ ] env `ENGINE_DELIBERATION_ENABLED=true` 时，正常调 LLM，结果写 Redis trace 表
- [ ] trace 表数据结构完整（耗时 / token / ruleDelta / deliberationDelta / deltaDiff / operatorTags / reason / confidence）
- [ ] 失败时（LLM 报错 / JSON 解析失败 / 超时）也写 trace 表（ok=false + errorCode）
- [ ] 所有异常都 catch 住，不抛到主流程
- [ ] 四个 env 键都进了 `.env.example` 和 `typings/global.d.ts`

### 6.2 闸门验收

- [ ] `npx eslint "src/**/*.ts" "test/**/*.ts"` → 0 error
- [ ] `npx tsc -p tsconfig.build.json --noEmit` → 0 error
- [ ] `npx vitest run` → 全绿（零回归）
- [ ] `git diff --stat HEAD -- src/engine-core` → **空**（本期不改内核）

### 6.3 测试用例要求

至少补充：
1. env 开关关闭时，runShadowMode 直接 return，不调 LLM
2. env 开关开启时，正常调 LLM，trace 数据写入 Redis
3. LLM 返回格式不合法时，trace 表记 ok=false + errorCode
4. LLM 超时时，trace 表记 ok=false + errorCode
5. delta 差异计算正确（逐维度对比 ruleDelta 和 deliberationDelta）
6. 所有异常都被 catch，不抛到调用方

---

## 7. PoC 验收标准（100 场对话跑完后）

> 这些不是本期 WP 的验收标准，是 PoC 整体的验收标准——跑完 100 场对话后，满足以下条件才进 Phase3A 灰度切换：

- 审议成功率 > 95%（格式合法 + API 不报错）
- 审议耗时 P95 < 3s（不拖慢会话）
- delta 差异分布在可接受范围：软状态维度差异均值 < 0.01
- 差异最大的 Top10 场景有临床合理性（人工抽样 5 场，督导认可）
- 高安全维度零误触发（LLM 没有输出过硬安全维度的 delta）
- 审议自我一致性：抽 5 场典型对话同输入跑两次，delta 差异均值 < 0.005
- 成本估算：每轮对话审议成本折算成钱，100 场对话总成本可接受

---

## 8. 本期没做的（明确留给后续）

1. **格式校验与重试** —— WP66
2. **降级策略** —— WP67
3. **per-session 串行队列** —— WP65
4. **约束校验层** —— 审议输出过 delta cap / 临床合理性校验
5. **生产切换** —— 影子模式验证完才谈
6. **DB 兜底持久化** —— trace 数据现在放 Redis，后续加 DB
7. **Admin Dashboard trace 查看页** —— 前端的事

---

## 9. 转述给后端的话术

> WP64：LLM 审议层 PoC（影子模式）。
>
> 开工前先读 `docs/README.md` 和 `docs/worklog/README.md` 入口，确认红线和交付格式。
>
> 任务单在 `docs/worklog/pending/wp64-llm-deliberation-poc-shadow-2026-11-05.md`。
>
> **内核零改动** —— 本期只在适配层新增审议服务，不进内核管道：
> - `llm-deliberation.service.ts` —— **新增** 审议服务（影子模式，旁路观察）
> - `engine.module.ts` —— 注册 provider
> - `.env.example` + `typings/global.d.ts` —— 4 个 env 键
>
> 关键口径：
> - WP63 已经出了三个零件（systemPrompt / userPrompt / schemaDescription），本期直接组装调 `CounselorLlmJsonClient.requestJson()`
> - 影子模式 = 旁路观察，结果不写状态，只写 Redis trace 表
> - fire-and-forget：调完 `engineSession.turn()` 之后旁路调审议，不 await，不影响主流程响应时间
> - 所有异常都 catch 住，不抛到主流程
> - 高安全维度（自杀倾向 / 危机等级）不跑 LLM 审议（schema 层面已排除）
>
> 任务单里所有函数名 / 类型名 / 文件路径都是 grep 核实过的，不是凭印象写的。
>
> 交付按 `team/conventions.md` §二的格式写交付记录：改了哪些文件、关键设计决策（跟任务单有出入要说明）、闸门数字。

---

_创建：2026-11-05_
_深度通知：`CounselorLlmJsonClient.requestJson()`（结构化输出客户端）/ `InMemoryEngineSession.turn()`（会话引擎 turn 流程）/ `RedisService.getClient()`（Redis 连接）/ `DeltaCapLogger`（观察者模式参考）—— 全部 grep 核实_

---

## 10. 交付后补记（2026-11-05）

> 交付记录：[`engine-wp64-llm-deliberation-poc-shadow-implementation-2026-11-05.md`](engine-wp64-llm-deliberation-poc-shadow-implementation-2026-11-05.md)
> 下表逐条登记**与任务单原文的偏差**，每条都能自圆其说。

| # | 任务单原文 | 实际落地 | 为什么 |
|---|---|---|---|
| 1 | §3.3「在 counselor 服务调 `engineSession.turn()` 之后」/「`src/counselor/` 下调 `engineSession.turn(` 的服务……grep 一下就能找到所有调用点」 | 接在 **`src/engine-adapters/rendering/turn-render-orchestrator.ts`**（聚合 `turn()` + 流式 `turnStream()` 两处） | grep 核实：全仓**唯一**调内核会话端口的地方是编排门面（`:395` 聚合 / `:457` 流式）；`src/counselor/**` **零**调用点（counselor 域用 `CounselorLlmJsonClient` 与 practice 引擎，与内核 turn 管道无关）。而且**只有门面同时握有三样东西** —— 咨询师的话、来访的**渲染回应**、本轮前后的快照；内核端口拿不到"来访的渲染回应"（那是渲染产物，内核 `reply` 恒为 `''`）。详见交付记录 §2.1 |
| 2 | §3.1 `ruleDelta` = 「规则算子算出的最终 delta（capped 后的）」 | 用**本轮前后快照的逐维差**反推（`computeRuleDelta`） | 内核的 `cappedTotal` 是 `turn()` 内部的**局部变量**，`EngineTurnOutput` 的出口只有"本轮**结束后**的快照"；内核零改动是本期红线，不可能加出口字段（cap 报告也只带**被砍的**维度）。快照差的口径 = "状态实际怎么动了"，正是审议 delta 该对齐的基准；代价是贴边界的轮次会小于 capped delta。详见交付记录 §2.2 |
| 3 | §3.1 `baseSnapshot` = 「本轮开始时的 BDI 状态快照」 | 适配层**自己记**"上一轮结束时的快照"（门面 `lastSnapshots`），同场会话内与内核下一轮载入的状态**逐字相等** | 内核不给起始快照（出口只有结束后的）。**代价：每场会话的第一轮跳过影子审议**（跨会话接续的第一轮同理 —— 内核那一步先做了 WP36 自然衰减，硬凑会算错）。见交付记录 §2.3 |
| 4 | §3.1 `maxCompletionTokens: 512`（"审议输出大概 200-300 token，留足余量"） | **2048** | M3.1-Flash 是推理模型，**thinking token 计入生成长度上限**（硬约束 8）。"正文 200-300 token" ≠ "总预算 512" —— 思考先吃预算，给 512 会让 JSON 半截 → 连续 `json_not_found`/`json_parse_failed`，**影子模式一条数据都收不到**。引擎渲染侧既有做法是 1500（思考 ~700-1000 + 输出 ~500-800）。见交付记录 §2.4 |
| 5 | §3.1 `configService.get<number>('ENGINE_DELIBERATION_TIMEOUT_MS') ?? 3000` | **自己解析字符串** + 非法值回退默认 3000 | ConfigService **不做类型转换** —— 拿到的是字符串 `'3000'`，一路传到 `AbortSignal.timeout()` 会抛（仓库 WP9-B 已踩过）；且 `?? 3000` 对**空串**永远不触发（而模板里那行是留空的）。见交付记录 §2.11 |
| 6 | §3.4 `ENGINE_DELIBERATION_MODEL` / `ENGINE_DELIBERATION_TEMPERATURE` 两个键 | 给 `CounselorLlmJsonClient` 加**两个可选**字段（per-request `model` / `temperature`） | grep 核实：现有 client 的模型**只**从 env `MINIMAX_COUNSELOR_LLM_MODEL` 解析、且**根本不传** temperature —— 这两个 env 键在原状态下"配了也不生效"，是**骗人的配置项**（env 覆盖断言会放行，但运维改了没用，排查成本极高）。两个字段都是可选、省略即走既有路径 → 既有 6 个调用方行为**逐字不变**；per-call 模型覆盖的底层能力本来就有（`LlmService` 支持 `opts.model`）。见交付记录 §2.5 |
| 7 | §3.2 trace JSON 示例里 `deltaDiff` 只列模型提到的 3 维 | `deliberationDelta` **稀疏**（与示例一致）/ `deltaDiff` **全量 11 维**（模型没提到的按 0 算） | PoC 的验收指标是"软状态维度差异**均值** < 0.01"，均值的**分母**必须是确定的维度集；只算模型提到的维度，分母就变成"模型想说几维"，均值被人为抬高。顺带把"规则动了、审议没提"显式暴露出来（那正是"规则覆盖了、LLM 没看见"的证据）。见交付记录 §2.6 |
| 8 | §3.2 trace JSON 示例（字段：sessionId / turnIndex / timestamp / ok / errorCode / durationMs / mode / tokenUsage / ruleDelta / deliberationDelta / deltaDiff / operatorTags / reason / confidence / summary） | 上述字段**全部按原语义保留**，另**追加** 3 个：`tenantId` / `entries` / `rejectedEntries` | ① `tenantId` —— key 里有租户，值里也存一份（WP32 同纪律：归属对不上 = 撞键，要能一眼看出）；② `entries` —— 逐条 delta 明细（维度+幅度+标签+理由），扁平 `reason` 只是摘要，人工复核 Top10 场景要的是逐维对应；③ `rejectedEntries` —— 被校验层丢掉的**原始**条目：**模型硬塞硬安全维度时必须留证据**，否则 PoC 的"高安全零误触发"无从查证。见交付记录 §2.7 |
| 9 | §3.1 `mode: DeliberationMode`（考核 / 自由练习） | 门面固定传 **`freeform`**（具名常量 + 理由注释） | grep 核实：引擎 turn 管道 today 只服务**语音对练**（自由练习 / 全真执业，都是零压域），MCQ 备考频道走 `training-exercises` 链路、**不经过** `session.turn()`。此刻用考核措辞审自由练习的对话，会把"判定更严"的偏置带进对比数据，PoC 统计立刻失真。见交付记录 §2.8 |
| 10 | §5.2「适配层改动（3 个文件）」 | **9 个**（1 增 6 改 + 2 个配置） | 任务单 §3.3 说的接线点与代码不符（见第 1 条），把旁路接起来必然要动编排门面 / 归属登记 / 装配工厂 / 装配模块；第 6 条要给 client 加字段；`ruleDelta`/`baseSnapshot` 需要适配层自己算（见第 2、3 条）。**逐条对应**：① `llm-deliberation.service.ts`（新增）② `engine.module.ts` ③ `.env.example` + `typings/global.d.ts` ④ `turn-render-orchestrator.ts`（旁路调用点）⑤ `engine-turn.service.ts` + `engine-stream-backend.adapter.ts`（把学员账号与角色底色带进归属）⑥ `engine.providers.ts`（门面接端口）⑦ `counselor/providers/llm-json.client.ts`（per-request 模型/温度）。见交付记录 §1.1 |
| 11 | §3.3「在 `engine.module.ts` 或 `counselor.module.ts` 里注册」 | 注册在 **`engine.module.ts`**；`imports` 加的是 **agent 侧 `LlmModule`**（别名 `AgentLlmModule`），**不** import `CounselorModule` | import `CounselorModule` 会把 counselor 域的 24 个 TypeORM entity + 一堆控制器整包拖进引擎装配层 → 引擎装配层从此认识 ORM，**违反 WP8-A §8-9 的"零 ORM / 零 SDK 包名"护栏**（`wp8-wiring.spec.ts` 按包名判定）。client 无状态，自己注册一份不产生第二份真相。见交付记录 §2.9 |
| 12 | §3.4「`ENGINE_DELIBERATION_ENABLED` 默认 `false`」 | **照办**（缺省关 = 一次 LLM 都不发） | —— 一致，无偏差。只是 `.env.example` 里写**显式** `false`（不是留空）：这是个开关，运维要能一眼看见并直接改（同 `ENGINE_DEBUG_TRACE_ENABLED`）。见交付记录 §2.10 |
| 13 | §3.4「影子模式开关……4 个 env 键」 | **4 个全部实现且真实生效**（不是摆设） | env 覆盖断言（AST 抽取）双向守住"代码读的键都有生效行 / 生效行都有人读"。四个键**逐个字面量**读，不用计算键 —— 计算键断言扫不到，漏写会静默失效 |

**闸门**：eslint **0 error**（`npx eslint "src/**/*.ts" "test/**/*.ts"` exit 0）/ tsc **0 error**（`npx tsc -p tsconfig.build.json --noEmit` exit 0）/ vitest **102 文件 1697 例全绿**（WP63 基线 101 文件 1664 例 → 本轮 **+1 文件 / +33 例**，既有 1664 例零回归；闸门用 `vitest run --exclude '**/e2e/**/*.ts'`，e2e 要真 DB）/ `git diff --stat HEAD -- src/engine-core` = **空**（内核零改动）/ `boundary.spec.ts` 全绿 / env 覆盖断言双向全绿。
