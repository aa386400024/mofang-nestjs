# WP68 任务单 — 意图锁定机制（基础版）

> **状态**：✅ 已交付（2026-11-05）→ [`engine-wp68-deliberation-intention-lock-implementation-2026-11-05.md`](engine-wp68-deliberation-intention-lock-implementation-2026-11-05.md)
> **路径**：`docs/worklog/completed/phase2/wp68-deliberation-intention-lock-2026-11-05.md`
> 优先级: 🟡 P1 (PoC 组基础设施)
> 前置: WP67 (审议熔断与降级策略) 已交付核验
> 红线: engine-core 零改动
> 北极星: [`../../../architecture/hybrid-bdi-agent-blueprint-v1.0.md`](../../../architecture/hybrid-bdi-agent-blueprint-v1.0.md) §2.3 约束校验层 · 意图锁定机制

---

## 1. 背景与目标

### 1.1 为什么要做这个 WP

影子模式跑了这么久，我们一直在对比"软状态 delta"——规则算子算的 trust/safety/bond 和 LLM 建议的差多少。但还有一个维度没对比：**意图层面**。

内核的 `Intention.strategy` 是每轮从状态选出来的行为策略（simple_response / recounting / affective_exploration / insight / resistance 等 8 种）。现在是规则算子选的，以后切灰度后 LLM 也可以建议切换意图。

问题是：LLM 会不会乱改意图？这一轮在谈信任，下一轮突然跳到阻抗，再下一轮又跳到移情——那就太跳了，不符合真实的咨询节奏。

**意图锁定机制**就是防这个的：当前意图锁定 N 轮，锁定期间 LLM 的 intentionShift 建议被忽略，到时间才允许切换。

### 1.2 本 WP 要做什么（PoC 阶段）

影子模式下，**旁路模拟**意图锁定机制：
1. **审议 Schema 加 intentionShift 字段** —— LLM 可以建议切换行为策略（可选，觉得不需要就返回 null）
2. **加意图锁定逻辑** —— 记录"规则算子选的意图" vs "LLM 建议的意图" vs "锁定后实际用的意图"
3. **影子模式下可观测** —— trace 里能看到这三个值的对比，PoC 统计时能分析"LLM 建议的切换合不合理，锁定机制有没有拦住乱改"

> ⚠️ 注意：影子模式下，锁定后的意图还是用规则算子选的那个——主流程根本没切到 LLM。意图锁定只是**旁路模拟**，验证"如果真用 LLM 审议，锁定机制有没有用"。

---

## 2. 设计决策

### D1: intentionShift 是可选字段——LLM 觉得不需要切换就返回 null

不是每轮都要切换意图。大多数轮次就是在当前主题下深入，不需要换策略。所以：
- `intentionShift: null` = 不需要切换，继续用当前意图
- `intentionShift: { targetStrategy: 'insight', reason: '...' }` = 建议切换到 insight

### D2: 意图锁定状态存 Redis——跨轮次保存

和熔断状态一样，存 Redis。key 与熔断 key 同构（带租户 + 会话长度前缀）。

状态结构：
```json
{
  "currentStrategy": "affective_exploration",
  "lockedUntilRound": 5,
  "roundIndex": 2
}
```

### D3: 锁定轮数默认 3 轮——工程种子值，待校准

`ENGINE_DELIBERATION_INTENTION_LOCK_ROUNDS` 默认 3。意思是：选定一个意图后，锁定 3 轮，期间不允许切换。第 4 轮开始允许切换，切换后重新锁定 3 轮。

> ⚠️ 这是工程种子值，不是临床数字——PoC 跑完后根据督导反馈校准。

### D4: 影子模式下，锁定机制是"旁路模拟"

主流程还是用规则算子选的意图，意图锁定只是：
- 读 LLM 建议的 intentionShift
- 判断当前是否在锁定期
- 如果在锁定期，记录"LLM 建议了切换，但被锁定拦住了"
- 写进 trace，供 PoC 统计分析

主流程的意图选择逻辑一行不动——内核的 `planIntention()` 该怎么跑还怎么跑。

### D5: 触发事件白名单 PoC 阶段不做

蓝图里写的是"咨询师直接提问了这个意图相关的话题"可以提前解锁。但这个怎么判断？怎么知道咨询师是不是"直接提问了这个意图相关的话题"？太复杂了，NLP 级别的判断。

PoC 阶段先不做——就是纯锁定 N 轮，到时间自动解锁。以后真要做触发事件，再单独一单。

### D6: 意图锁定状态的 TTL = 24 小时，每次更新刷新

意图锁定是按轮次算的，不是按时间算的。但 Redis key 总得有个 TTL——不然会话结束了 key 还留着，占内存。

设 24 小时足够跑完一个会话了。每次更新锁定状态的时候刷新 TTL——活跃会话永不过期，不活跃的自动清掉。

---

## 3. 改动文件清单

### 3.1 改 4 个文件

| 文件 | 改什么 |
|---|---|
| `src/engine-adapters/deliberation/deliberation-types.ts` | ① 新增 `DeliberationIntentionShift` 类型（targetStrategy + reason）；② `DeliberationOutput` 加可选字段 `intentionShift: DeliberationIntentionShift \| null`；③ 导出 `DELIBERATION_INTENTION_LOCK_ROUNDS` 默认值常量 |
| `src/engine-adapters/deliberation/deliberation-prompt.ts` | ① prompt 里加 intentionShift 的说明（可选字段，不需要切换就返回 null）；② JSON Schema 示例里加 intentionShift 字段 |
| `src/engine-adapters/deliberation/llm-deliberation.service.ts` | ① `DeliberationShadowInput` 加 `ruleStrategy: BehaviorStrategy` 字段（规则算子本轮选的行为策略，编排门面传进来）；② `validateDeliberationOutput` 加 intentionShift 字段的校验；③ trace 记录里加 `ruleStrategy` / `llmIntentionShift` / `lockedStrategy` / `llmIntentionAccepted` 四个字段 |
| `src/engine-adapters/deliberation/deliberation.processor.ts` | ① 新增 `resolveIntentionLock()` 纯函数；② 新增 `loadIntentionLockState()` / `saveIntentionLockState()` 方法；③ `processJob()` 里：跑完 LLM 审议后，拿规则算子的 strategy 和 LLM 建议的 intentionShift，过一遍锁定逻辑，记录结果 |

### 3.2 改 1 个文件（编排门面）

| 文件 | 改什么 |
|---|---|
| `src/engine-adapters/rendering/turn-render-orchestrator.ts` | 调 `runShadowMode()` 的时候，多传一个 `ruleStrategy` 字段（从内核的 intention 里拿）。**只加一个字段，不改调用逻辑**。 |

> ⚠️ 这是对"编排门面零改动"的一个小修正——之前任务单说门面零改动，但意图锁定需要知道规则算子选的策略，审议输入里必须带这个字段。改动极小：只加一个字段传进去，不改任何逻辑。

### 3.3 配置：2 改

| 文件 | 改什么 |
|---|---|
| `.env.example` | 加 `ENGINE_DELIBERATION_INTENTION_LOCK_ROUNDS=`（生效行 + 注释块） |
| `typings/global.d.ts` | 加 `ENGINE_DELIBERATION_INTENTION_LOCK_ROUNDS?: string` |

### 3.4 测试：1 增

| 文件 | 改什么 |
|---|---|
| `test/engine-adapters/wp68-deliberation-intention-lock.spec.ts` | 新增测试用例（详见 §5） |

### 3.5 零改动确认

- ❌ `src/engine-core/**` —— 一行不动
- ❌ `turn-render-orchestrator.ts` —— 一行不动
- ❌ `planIntention()` 的意图选择逻辑 —— 一行不动（影子模式下主流程还是规则算子选意图）
- ❌ `validateDeliberationOutput` 的 delta 校验逻辑 —— 一行不动（只加 intentionShift 的校验）

---

## 4. 关键实现细节

### 4.1 DeliberationIntentionShift 类型

```typescript
/** LLM 建议的意图切换 (可选, 不需要切换就返回 null). */
export interface DeliberationIntentionShift {
  /** 建议切换到的行为策略 (必须是 8 种合法策略之一). */
  readonly targetStrategy: BehaviorStrategy;
  /** 切换理由 (自然语言, 供督导观测). */
  readonly reason: string;
}
```

> ⚠️ `BehaviorStrategy` 类型从内核 import——不要自己重新定义一套，保持和内核一致。

### 4.2 意图锁定状态结构

```typescript
interface IntentionLockState {
  /** 当前规则算子选的行为策略. */
  currentStrategy: BehaviorStrategy;
  /** 锁定到第几轮 (不含本轮). */
  lockedUntilRound: number;
  /** 当前轮次. */
  roundIndex: number;
}
```

### 4.3 resolveIntentionLock 纯函数

```typescript
/**
 * 意图锁定判定 (纯函数, 可单测).
 *
 * @param state 当前锁定状态 (null = 没锁过)
 * @param currentStrategy 规则算子本轮选的策略
 * @param llmSuggestion LLM 建议的切换 (null = 不建议切换)
 * @param lockRounds 锁定轮数
 * @param roundIndex 当前轮次
 * @returns 锁定后的结果: 实际用的策略 + LLM 建议有没有被拦住
 */
export function resolveIntentionLock(
  state: IntentionLockState | null,
  currentStrategy: BehaviorStrategy,
  llmSuggestion: DeliberationIntentionShift | null,
  lockRounds: number,
  roundIndex: number,
): {
  effectiveStrategy: BehaviorStrategy;
  llmSuggestionAccepted: boolean;
  newState: IntentionLockState;
} {
  // 情况 1: 没锁过 (第一轮) —— 用规则算子的策略, 开始锁定
  if (!state) {
    return {
      effectiveStrategy: currentStrategy,
      llmSuggestionAccepted: false, // 第一轮不接受 LLM 建议, 先锁定规则算子的
      newState: {
        currentStrategy,
        lockedUntilRound: roundIndex + lockRounds,
        roundIndex,
      },
    };
  }

  // 情况 2: 规则算子选的策略变了 —— 说明内核的意图切换了, 重新锁定
  if (state.currentStrategy !== currentStrategy) {
    return {
      effectiveStrategy: currentStrategy,
      llmSuggestionAccepted: false,
      newState: {
        currentStrategy,
        lockedUntilRound: roundIndex + lockRounds,
        roundIndex,
      },
    };
  }

  // 情况 3: 还在锁定期内 —— 忽略 LLM 建议
  if (roundIndex < state.lockedUntilRound) {
    return {
      effectiveStrategy: currentStrategy,
      llmSuggestionAccepted: false,
      newState: { ...state, roundIndex },
    };
  }

  // 情况 4: 锁定期过了 —— 接受 LLM 建议 (如果有的话)
  if (llmSuggestion) {
    return {
      effectiveStrategy: llmSuggestion.targetStrategy,
      llmSuggestionAccepted: true,
      newState: {
        currentStrategy: llmSuggestion.targetStrategy,
        lockedUntilRound: roundIndex + lockRounds,
        roundIndex,
      },
    };
  }

  // 情况 5: 锁定期过了, 但 LLM 没建议切换 —— 继续用当前策略
  return {
    effectiveStrategy: currentStrategy,
    llmSuggestionAccepted: false,
    newState: { ...state, roundIndex },
  };
}
```

### 4.4 trace 里加的字段

```typescript
export interface DeliberationTraceRecord {
  // ... 原有字段 ...

  /** 规则算子本轮选的行为策略. */
  readonly ruleStrategy: BehaviorStrategy;
  /** LLM 建议的意图切换 (null = 不建议). */
  readonly llmIntentionShift: DeliberationIntentionShift | null;
  /** 锁定后实际用的策略 (影子模式下 = ruleStrategy, 只是记录). */
  readonly lockedStrategy: BehaviorStrategy;
  /** LLM 的建议有没有被锁定拦住. */
  readonly llmIntentionAccepted: boolean;
}
```

> ⚠️ 影子模式下 `lockedStrategy` 永远等于 `ruleStrategy`——因为主流程根本没切到 LLM。这个字段只是记录"如果真用 LLM 审议，锁定后会是什么"。

---

## 5. 测试要求

新增 `test/engine-adapters/wp68-deliberation-intention-lock.spec.ts`，覆盖以下用例：

### 5.1 锁定状态判断（5 例）

1. ✅ 没锁过（第一轮）→ 用规则算子的策略，开始锁定
2. ✅ 规则算子选的策略变了 → 重新锁定
3. ✅ 还在锁定期内 → 忽略 LLM 建议
4. ✅ 锁定期过了 + LLM 有建议 → 接受建议，重新锁定
5. ✅ 锁定期过了 + LLM 没建议 → 继续用当前策略

### 5.2 intentionShift 校验（3 例）

6. ✅ targetStrategy 合法 → 校验通过
7. ✅ targetStrategy 非法（不在 8 种里）→ 校验失败，丢掉
8. ✅ reason 为空字符串 → 校验失败，丢掉

### 5.3 配置（2 例）

9. ✅ `ENGINE_DELIBERATION_INTENTION_LOCK_ROUNDS` 默认 3
10. ✅ env 配非法值时回退默认 3，不抛错

### 5.4 边界（3 例）

11. ✅ 开关关闭时，不跑意图锁定逻辑
12. ✅ Redis key 带租户与会话长度前缀（撞键防护）
13. ✅ `boundary.spec.ts` 11 条断言全绿（engine-core 零改动）

---

## 6. 验收标准

### 6.1 功能验收

| 条目 | 要求 |
|---|---|
| 审议 Schema 加 intentionShift 字段 | ✅ 可选，LLM 觉得不需要就返回 null |
| 意图锁定逻辑 | ✅ 锁定 N 轮，期间忽略 LLM 建议 |
| 影子模式下可观测 | ✅ trace 里有 ruleStrategy / llmIntentionShift / lockedStrategy / llmIntentionAccepted |
| 配置 env 可调 | ✅ 锁定轮数 env 可配 |

### 6.2 闸门验收

| 闸门 | 要求 |
|---|---|
| `npx eslint "src/**/*.ts" "test/**/*.ts"` | 0 error |
| `npx tsc -p tsconfig.build.json --noEmit` | 0 error |
| `npx vitest run --exclude '**/e2e/**/*.ts'` | 全绿，既有用例零回归 |
| `git diff --stat HEAD -- src/engine-core` | 为空 |

---

## 7. 交付后补记要求

交付时请写明：
1. 实际改了哪些文件，和任务单 §3 对不对得上
2. 有没有设计偏差，为什么
3. 测试用例数、全量测试跑下来多少绿
4. env 键全不全（双向覆盖断言过没过）

---

_创建：2026-11-05_
_前置依赖：WP67 已交付核验（98/100）_
_PoC 组最后一个 WP，做完就收尾_

---

## 8. 交付后补记（2026-11-05）

> 交付记录：[`engine-wp68-deliberation-intention-lock-implementation-2026-11-05.md`](engine-wp68-deliberation-intention-lock-implementation-2026-11-05.md)
> 下表逐条登记**与任务单原文的偏差**，每条都能自圆其说。

| # | 任务单原文 | 实际落地 | 为什么 |
|---|---|---|---|
| 1 | §3.1「`deliberation.processor.ts`：① 新增 `resolveIntentionLock()` 纯函数；② 新增 `loadIntentionLockState()` / `saveIntentionLockState()`；③ `processJob()` 里跑完 LLM 审议后过一遍锁定逻辑」 | **processor 零改动** —— 判定与锁状态读写全在 `llm-deliberation.service.ts` | trace 是 **service** 写的（WP65 起的纪律"队列层不自己写 trace"）—— processor 拿到结局时 trace 早已写完，要塞进 4 个字段只能**二次改写 Redis**（读-改-写，竞态窗口，每轮多 2 次往返）。**已与大炮确认走方案 A（service 层）**。另：锁定是**观察工具**（不改任何主流程行为），控制闸门才归 processor（WP67 熔断器就是，它决定"要不要入队"，必须在 LLM 跑之前判）。见交付记录 §2.1 |
| 2 | §4.2 状态只有 `currentStrategy` 一个字段；§4.3 情况 2 判定 `state.currentStrategy !== currentStrategy` | 状态拆成 **`ruleStrategy` + `effectiveStrategy` 两个**字段；情况 2 判定改成 `state.ruleStrategy !== currentStrategy` | 任务单的**代码和自己的注释矛盾**：情况 4 把 `currentStrategy` 写成 **LLM 建议的**策略，而情况 2 的注释说的是"**规则算子**选的策略变了"。照抄会在影子模式下产生假象 —— 建议被采纳一次后，下一轮 `state.currentStrategy`(=LLM 建议) 必然 ≠ `currentStrategy`(=规则策略) → **每轮都走情况 2** → 锁反复重上、**永不过期** → "拦住率"被撑爆 → **PoC 结论失真**。拆两个字段后，情况 2 只在**内核真的换意图**时触发。见交付记录 §2.2 |
| 3 | §4.3 情况 3 / 5 返回 `effectiveStrategy: currentStrategy` | 情况 3 / 5 返回 `state.effectiveStrategy` | 采纳过的切换要在**锁定期内保持** —— 否则"锁定"就白锁了（LLM 建议被采纳后，下一轮又退回规则策略）。用例 ⑤-18 钉死。见交付记录 §2.2 |
| 4 | §3.2「prompt 里加 intentionShift 的说明 + JSON Schema 示例里加 intentionShift 字段」 | 另加：**user prompt 新增「当前行为策略」区块** + schema 里 8 种策略**带中文含义** | `intentionShift` 的语义是"**换**到另一个策略" —— 模型不知道当前用哪个，就无从判断该不该换，只能瞎猜。**缺这个字段，WP68 想回答的问题（"LLM 会不会乱改意图"）就问不出答案**。英文名在前中文在后（模型要原样输出英文名）。见交付记录 §2.3 |
| 5 | §3.1「`BehaviorStrategy` 类型从内核 import —— 不要自己重新定义一套」 | 类型从内核 import ✓；但**运行期清单**放适配层，用**穷尽 `Record<BehaviorStrategy, true>`** | 内核只导出**类型**（union），运行期没有值 —— 而 prompt 要列合法取值、校验层要做白名单，都需要运行期清单。给内核加数组 = **破红线**。用穷尽 Record 而不是 `as const` + `satisfies`：后者只保证"不多"，内核加第 9 种策略时**编译期不报错**、模型却永远选不到它；前者会让 **TS 直接报错**逼着补。见交付记录 §2.4 |
| 6 | §3.1「`DeliberationOutput` 加**可选**字段 `intentionShift: DeliberationIntentionShift \| null`」 | 落成**必填但可为 null** | 蓝图 §2.2 的输出示例就是 `"intentionShift": null` 这个形状。字段永远存在 → 消费方不用到处判 `undefined`；LLM 不返回它时校验层补 null。见交付记录 §2.5 |
| 7 | §5.2-7/8「targetStrategy 非法 / reason 为空 → 校验失败，丢掉」 | 丢掉这个建议（当 null）+ 原始值进 `rejectedEntries`；**不整份判不合法** | 与**单条 delta** 的处理同款：一条非法建议不该让整轮审议白跑（那正是 WP66 的重试要救的场景）。用例 ②-10 钉死。见交付记录 §2.6 |
| 8 | §3.2「调 `runShadowMode()` 的时候，多传一个 `ruleStrategy` 字段（从内核的 intention 里拿）」 | 传 `spec.intention.strategy`（**本轮渲染实际用的那个策略**） | `output.intention` 在类型上是**可选**的；`buildRenderSpec` 保证 `spec.intention` **永远有值**（内核意图缺失时兜底 `simple_response`）。取 `spec` → 永远有值 + 与渲染口径同一来源 + 不是"猜一个"（猜出来的策略会让锁定判定建立在假数据上）。见交付记录 §2.3 |
| 9 | （任务单未提）锁状态读失败怎么办 | **fail-open** —— 读不到 / 写坏都当"没锁过"；审议**失败**的那轮**不写**锁状态 | 锁定是观察工具不是正确性保障（与 WP67 熔断器同款口径）；状态写坏时当没锁过，**不让一个坏 key 永久卡住会话**；失败轮次压根没有建议可判。见交付记录 §2.7 |
| 10 | （任务单未提）锁定轮数能不能填 0 | **0 是合法值** = 关掉锁定（对照实验用）；只有 `< 0` / 非数字 / 空串才回退默认 3 | 母版要回答"锁定机制有没有用"，就得有"没有锁定机制"的对照档 —— 没有这个档就答不了。见交付记录 §2.8 |
| 11 | §6.2 闸门「既有用例零回归」 | **五个既有 spec 必然要改**（wp63 2 处 / wp64 3 处 / wp65 3 处 / wp66 3 处 / wp67 1 处） | 入参加必填 `ruleStrategy`、输出加必填 `intentionShift`、一次成功审议现在写**两个** Redis key（trace + 锁状态）—— 凡是断言"`set` 调用了几次"的用例必然失效。落法是加一个 `traceWrites(set)` 辅助按 trace key 前缀过滤，**既有用例语义反而更强**。**用例数一条没减**。见交付记录 §2.9 |
| 12 | §3.4「`turn-render-orchestrator.ts` —— 一行不动」 | 改了**一行调用**（多传一个字段）+ 一处方法签名 + 文件头注释 | §3.2 自己已经说明这是"对'编排门面零改动'的一个小修正"。门面的**逻辑**一个字没动（不判定、不拦截、不改主流程）。用例 ⑥-26 钉死"门面不 import 任何锁定符号"。见交付记录 §2.1 |
| 13 | §2 D5「触发事件白名单 PoC 阶段不做」 | **照办**（未做） | 与任务单一致，无偏差。"咨询师直接提问了这个意图相关的话题"是 NLP 级判断。以后真要做，单独一单 |
| 14 | 抬头「优先级: 🟡 P1」 | 母版 `phase2-wp-list` 的 WP68 行与统计表都归在 **🟢 P2** 技术债桶 —— 本单**按母版口径**回写，没改优先级 | 优先级是产品口径的取舍，不是本单该定的；**两处不一致已登记**，由大炮决定要不要统一 |

**闸门**：eslint **0 error**（`npx eslint "src/**/*.ts" "test/**/*.ts"` exit 0）/ tsc **0 error**（`npx tsc -p tsconfig.build.json --noEmit` exit 0）/ vitest **106 文件 1790 例全绿**（WP67 基线 105 文件 1763 例 → 本轮 **+1 文件 / +27 例**；闸门用 `vitest run --exclude '**/e2e/**/*.ts'`，e2e 要真 DB）/ `git diff --stat HEAD -- src/engine-core` = **空**（内核零改动）/ `boundary.spec.ts` 全绿 / env 双向覆盖断言全绿。

> ⚠️ **PoC 组（WP63–WP68）至此 6 条全部交付** —— 影子期的对比数据齐了：软状态 delta（WP64/66）、意图层（WP68）、熔断与降级（WP67）。**下一站是 Phase3A 切灰度**，届时必须先补 WP65 的 per-session mutex + 快照版本号，并让审议输出过约束校验层才落快照。
