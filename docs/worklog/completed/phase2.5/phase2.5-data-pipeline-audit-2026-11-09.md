# Phase2.5 自动对练 · 数据链路体检发现（2026-11-09 晚）

> 触发原因：确认「下次批量跑之前要不要清数据」时，顺带核对了 `engine_version` 的写入链路，查出 4 个必须先修的问题；随后用户追问「还有什么没发现的问题」，又查出第 5 个（也是真正的根因）。
> 结论：**不能直接开跑下一批**。更关键的是——**这三批数据不能作为任何 prompt 调优的依据**，因为其中 91.8% 的来访者发言根本不是 LLM 生成的，是渲染兜底池。
> 性质：只读排查，未改动任何代码与数据。`practice-runner.service.ts` 正在被 MiniMax Code 改（WP-G），本单不并发修改。

---

## 一句话结论

| 问题 | 严重度 | 影响 |
|---|---|---|
| **⑤ 91.8% 的来访者发言、65.3% 的咨询师发言是「兜底句」，LLM 实际基本没被调用** | **P0 · 根因** | **专家报告的根因定性错了，WP-G 的修复方向不对** |
| ① `degraded_turns` 双计数，`heavy_degraded` 打标率 89.7% | **P0** | 修复效果无法度量，基线指标全部失真 |
| ② `engine_version` 全是 `"dev"`，代码版本追溯失效 | P1 | 跨批次对比只能靠 `batch_id` 硬切 |
| ③ 534 场逐字稿已永久丢失（含专家报告所依据的整批） | **P0** | 对话级复算不可能，只能信报告结论 |
| ④ 第三批已跑完 336 场，停滞率 42.9%（是基线的 2 倍） | P0 | 现状比报告更差，不是「等第三批」而是「已经跑完且更糟」 |
| ⑥ `prompt_tokens` 全库恒为 0，成本只算输出侧 | P2 | 成本看板严重低估 |

---

## 发现 ⑤（根因）整批对练跑的是兜底句，不是 LLM 输出

专家报告的结论是「来访者角色的表达极度单一，严重依赖少数几个固定句式，根因是每个角色只有 4-5 个固定回避句式」。
**这个定性是错的。** 那 4 句话根本不是角色的话，是**渲染层的兜底话术池**。

### 证据 1：报告 TOP4 话术与代码里的兜底池逐字相同

`src/engine-adapters/rendering/render-adapter.config.ts:150`

```ts
export const DEFAULT_RENDER_FALLBACK_UTTERANCES: readonly string[] = [
  '……我先缓一下，我们接着说。',
  '嗯……让我想想，该怎么说。',
  '最近确实有点难说出口……我们慢慢聊吧。',
  '我不太想现在讲清楚，能先聊点别的吗？',
];
```

报告「维度2」的来访者 TOP4 就是这四句，一字不差，各出现 1844/1844/1844/1845 次。

咨询师那边同理：报告里 5018 次的「嗯，我在听。你可以接着说。」是 `counselor-agent.service.ts:78` 的 `FALLBACK_REPLIES[0]` —— 它正是 WP-G 改动 1 说「原来只有一句」的那一句。

### 证据 2：独立复算（不引用报告数字）

对归档的 500 个逐字稿做全量计数（只数固定工程字符串，不读内容）：

| 项 | 值 |
|---|---|
| 归档文件数 | 500 |
| 来访者消息总数 | 17,585 |
| 兜底池 4 句命中合计 | **16,143（91.8%）** |
| 四句各自命中 | 4031 / 4033 / 4039 / 4040 |

四句的命中次数几乎完全相等 —— 这是 `llm-render.adapter.ts:989` 那个游标的必然结果：

```ts
const index = this.fallbackCursor % pool.length;   // 0,1,2,3,0,1,2,3...
this.fallbackCursor += 1;
```

**确定性轮换，不是 LLM 随机复读。** LLM 生成的句子不可能出现这种均匀分布。

### 证据 3：token 数据反证「LLM 没被调用」

渲染降级时返回的用量被写死为 0（`llm-render.adapter.ts:956`、`974`：`usage: { completionTokens: 0, totalTokens: 0 }`）。所以：

| 项 | 值 |
|---|---|
| 有轮次的场次 | 1,031 |
| `total_tokens = 0` 的场次 | **926（89.8%）** |
| `prompt_tokens` 全库最大值 | **0**（从未记录过一次） |
| 全库 completion_tokens 合计 | 1,271,290 |
| 全库总成本 | 5.72 元（`cost_basis = output_only`） |

**89.8% 的场次整场一个 token 都没消耗** —— 那不是「响应慢」，是一次真实调用都没发生。

### 证据 4：为什么会被全程兜底 —— 单 provider + 单例冷却

`src/engine-adapters/wiring/render-config.factory.ts:115`

```ts
const primary = this.text('ENGINE_RENDER_PRIMARY_PROVIDER') ?? ...
const fallbacks = (this.text('ENGINE_RENDER_FALLBACK_PROVIDERS') ?? '').split(',')...
```

实际 `.env`：

```
ENGINE_RENDER_PRIMARY_PROVIDER=minimax
（ENGINE_RENDER_FALLBACK_PROVIDERS 未配置 → 候选序列只有 1 个元素）
```

熔断参数（`render-adapter.config.ts:127-139`）：

| 参数 | 值 |
|---|---|
| `DEFAULT_RENDER_TIMEOUT_MS` | 30,000 |
| `DEFAULT_RENDER_FAILURE_THRESHOLD` | **3**（连续 3 次失败即进冷却） |
| `DEFAULT_RENDER_COOLDOWN_BASE_MS` | 30,000 |
| `DEFAULT_RENDER_COOLDOWN_MAX_MS` | **300,000（5 分钟）** |

适配器是**单例**（`private fallbackCursor = 0`，注释明说「适配器是单例」），冷却状态**全进程共用**。

### 完整因果链（现已闭环）

```
批量 320~336 场 × 20~35 轮 ≈ 6,000~11,000 次调用，Worker 并发 3
        ↓
MiniMax 上游限流 / 超时（MINIMAX_LLM_MAX_RETRIES=2 也不够）
        ↓
连续 3 次失败 → 单例熔断器打开 → 冷却 30s 起，指数退避到 300s
        ↓
冷却期内所有会话的渲染直接返回兜底池（游标轮换，不发请求）
        ↓
来访者「说」那 4 句，咨询师「说」那句兜底 → 对话无实质内容 → 停滞
        ↓
两侧每轮都降级 → degraded_turns = 2 × turn_count → heavy_degraded 99.7%
```

`degraded_turns` 恰好 2 倍的场次有 **209 场**（见发现①）—— 这个数字现在有了解释：**每一轮两侧都在走兜底**。

### 这对 WP-G 意味着什么

WP-G 的 8 项改动里，3 项是渲染层 prompt（「每个角色补 15-20 种回避/阻抗表达」「禁止连续两轮相似」等）。

**只要 LLM 不被调用，角色 prompt 里写 20 句还是 200 句都毫无意义** —— 那 4 句兜底是从 `render-adapter.config.ts` 的常量池里取的，跟角色 prompt 没有任何关系。

正确的修复顺序必须反过来：

1. **先解决上游可用性**：配置第二/第三个 provider 进 `ENGINE_RENDER_FALLBACK_PROVIDERS`（现在只有一个 minimax，等于没有备份）；把批量并发降到上游能吃住的水平；429 走真正的指数退避重试而不是 2 次就放弃。
2. **冷却参数要重估**：`failureThreshold=3` + `cooldownMax=300s` 在单 provider 场景下等于「三次抖动 → 5 分钟静默」。至少把 `cooldownMaxMs` 压到 30~60s，且冷却期间仍尝试（半开），而不是直接兜底。
3. **把「渲染降级率」做成独立、可观测的指标**，而不是混进 `degraded_turns`。跑完一批先看这个数，低于阈值才谈 prompt 质量。
4. 以上都修完之后，WP-G 的 prompt 改动才有意义 —— 那时才是「话术是否够多样」的问题。

> ⚠️ 这意味着**今天这三批数据不能作为任何 prompt 调优的依据**。95.9% 重复率、18.7%/42.9% 停滞率、cold 模式最优这些结论，全部建立在「LLM 基本没说话」的数据上。

---

## 发现 ① `degraded_turns` 双计数 —— 指标层的根因

### 代码证据

`src/auto-practice/practice-runner.service.ts`

```ts
// :310  咨询师侧降级 +1
if (counselorReply.degraded) degradedTurns += 1;

// :318  来访者侧（引擎渲染降级）+1
if (result.trace.degraded) degradedTurns += 1;

// :388  按「轮数」算比例
if (degradedTurns > 0 && turnCount > 0 && degradedTurns / turnCount >= 0.5) {
  exitReason = `${exitReason}_heavy_degraded`;
}
```

一个 turn 内，咨询师侧和来访者侧**各可能降级一次**，同一个计数器被加两次。

- `counselorReply.degraded` = 咨询师 LLM 失败走兜底（`counselor-agent.service.ts:182/195/201`）
- `result.trace.degraded` = 来访者渲染侧降级（`debug-session.service.ts:562`，`providerHint === 'degraded'`）

**计数器语义是「降级事件数」，阈值判断却当成「降级轮数」用。** 两个口径混在一个变量里。

### 数据证据（全库 1034 场）

| 指标 | 值 |
|---|---|
| 统计范围（completed/stagnant/crisis_ended） | 1014 场 |
| `degraded_turns > turn_count`（数学上不可能） | **687 场（67.8%）** |
| 恰好等于 2×turn_count（两侧每轮都降级） | 209 场 |
| 平均 degraded_turns / 平均 turn_count | 43.2 / 28.9 |

### 后果

| 批次 | 场次 | 带 `_heavy_degraded` 后缀 | 打标率 |
|---|---|---|---|
| `BLi9l-8JkZG0G3txFbkh7`（批1） | 320 | 292 | 91.3% |
| `qVRglsXVKxiKijT_9yg0N`（批2） | 308 | 301 | 97.7% |
| `axm3xLl75QjwGIKccsEp0`（批3） | 336 | 335 | **99.7%** |
| **全库** | 1034 | 928 | **89.7%** |

真实降级率只要有 ~25%（任一侧），`degraded/turn = 0.5` 就触发打标。于是：

1. 几乎所有场次都被打上 `_heavy_degraded` → 这个后缀已经没有区分度；
2. 报告里「`max_turns_heavy_degraded` 占 49.7%」这类数字，读不出「正常跑满」和「降级跑满」的差别；
3. **WP-G 修完后的验收没有干净基线** —— 改好了也还是 99% 全标 degraded，看不出改善。

### 建议修法（需要决策，不擅自动）

三选一，推荐 A：

- **A（推荐）拆成两个计数器**：`degraded_counselor_turns` / `degraded_visitor_turns`，各自 /turnCount 判断，任一 ≥ 50% 才打后缀。语义清晰、可分别定位是哪一侧在坏。成本：加 1 列迁移 + 改判据 + 历史行无法回填（标注为「口径变更前」）。
- **B 最小改动**：改成 `if (counselorReply.degraded || result.trace.degraded) degradedTurns += 1;`，即每轮最多 +1。改 2 行，无需迁移，历史数据和新数据口径仍不完全一致但至少可比。
- **C 只改阈值**：`>= 0.5` 提到 `>= 1.0`（等价于两侧都降级）。不推荐 —— 掩盖了「单侧坏满整场」的情况。

---

## 发现 ② `engine_version` 全是 `"dev"`

### 代码

`src/auto-practice/inference-fingerprint.service.ts:86`

```ts
engineVersion: this.config.get<string>('ENGINE_VERSION') ?? 'dev',
```

`typings/global.d.ts:392` 和 `.env.example` 都登记了 `ENGINE_VERSION`，但**实际 `.env` 里没有这一行**（只有 `MINIMAX_LLM_MODEL`）。于是全部走 `?? 'dev'`。

### 数据

| engine_version | 场次 |
|---|---|
| `"dev"` | 966 |
| `NULL` | 68（迁移前的存量行） |

**零区分度。** 表设计里 WP-B 想要的「按代码版本回溯」能力，实际是空的。

### 附带风险

当前 git 工作区是 **dirty** 的（10+ 文件已改未提交，含 `practice-runner.service.ts` / `counselor-agent.service.ts`）。此时 `HEAD` 的 sha `76d6d93` **不等于正在运行的代码**。

### 建议

不靠人工填 env（会忘），改成启动时自动派生：

```ts
// 优先 env 显式指定；否则取 git describe --dirty --always
engineVersion: this.config.get<string>('ENGINE_VERSION')?.trim()
  || gitDescribeDirty(),   // 例: "76d6d93-dirty" / "76d6d93"
```

`-dirty` 后缀是关键 —— 它让「跑出来的数来自未提交代码」这件事在数据里可见，而不是假装干净。

---

## 发现 ③ 534 场逐字稿已永久丢失

`DebugSessionStore` 的 `MAX_DEBUG_SESSIONS = 500` 按 createdAt 倒序淘汰。跑批速度远超上限，导致先跑批次的逐字稿被后跑批次顶掉。

### 各批次存活情况（以 `debug_session_id` 逐个比对当前目录 + 归档目录）

| 批次 | 总场次 | 当前目录 | 已归档 | **已丢失** | 存活率 |
|---|---|---|---|---|---|
| `axm3xLl75QjwGIKccsEp0`（批3） | 336 | 0 | 336 | 0 | 100% |
| `qVRglsXVKxiKijT_9yg0N`（批2） | 308 | 0 | 164 | **144** | 53.2% |
| `BLi9l-8JkZG0G3txFbkh7`（批1） | 320 | 0 | 0 | **320** | **0%** |
| 手动批次（null） | 67 | 0 | 0 | **67** | **0%** |
| 3 个单场测试批次 | 3 | 0 | 0 | 3 | 0% |
| **合计** | **1034** | 0 | **500** | **534（51.6%）** | 48.4% |

### 这意味着什么

专家报告 `phase2.5-auto-practice-expert-analysis-2026-11-09.md` 的「来访者话术重复率 95.9% / TOP4 占 96% / 咨询师"嗯我在听" 5013 次」是**从批1 的逐字稿算出来的**（报告 299 场样本 ≈ 批1 320 场 + 手动 67 场，对应 396 场报告口径）。

**批1 逐字稿现在全部没了。** 结论仍然可信（报告本身就是证据），但：
- 无法复核「95.9%」是怎么算的；
- 无法抽取具体重复样例给 MiniMax Code 对照；
- WP-G 修完后**没有同源的历史逐字稿做逐句 diff**，只能拿批3（100% 完好）当参照物。

### 现在的补救现状

已归档 `data/archives/debug-sessions-baseline-20261109/`（500 个文件，336 来自批3 + 164 来自批2）。这批是**修复前**跑的，虽然批1 没了，但批2/批3 的逐字稿构成了「修复前」的有效参照 —— 并且恰恰是停滞率最高的那两批，对验证修复效果反而更有价值。

---

## 发现 ④ 第三批已跑完，且明显更差

### 批次时间线（UTC 转 CST +8）

| 批次 | 场次 | 时间窗（CST） | 完成率 | 停滞率 | 平均轮次 | 平均降级 |
|---|---|---|---|---|---|---|
| 批1 `BLi9l…` | 320 | 17:59 – 18:45 | 72.5% | 21.9% | 20.5 | 30.6 |
| 批2 `qVRgls…` | 308 | 18:46 – 19:40 | 56.2% | **43.5%** | 35.4 | 57.7 |
| 批3 `axm3x…` | 336 | 19:41 – 20:57 | 55.4% | **42.9%** | 32.8 | 52.5 |
| 手动 | 67 | 11-08 16:10 – 11-09 08:02 | 83.6% | 1.5% | — | — |

**停滞率从 21.9% 翻倍到 43%**，完成率从 72.5% 掉到 55%。不是「变好」，是**变坏**。

### 4 个新角色已经有数据了

| 角色 | 场次 | 最新 |
|---|---|---|
| `vpt_depression_avoidant_l1` | 42 | 20:57 |
| `vpt_general_secure_l1` | 42 | 20:28 |
| `vpt_social_anxious_l1` | 42 | 20:44 |
| `vpt_trauma_disorganized_l1` | 42 | 20:36 |

**「新角色 0 场数据」这条待办已经过期** —— 四个角色各 42 场，全部在批3。而且它们的停滞率是全场最高的：

| 角色（批3） | 场次 | 完成率 | 停滞率 |
|---|---|---|---|
| `vpt_trauma_disorganized_l1` | 42 | 47.6% | **52.4%** |
| `vpt_general_secure_l1` | 42 | 50.0% | 45.2% |
| `vpt_depression_avoidant_l1` | 42 | 52.4% | 45.2% |
| `vpt_social_anxious_l1` | 42 | 59.5% | 40.5% |
| （对比）原有 `vpt_grief_avoidance_l1` | 42 | 64.3% | 35.7% |

新角色的 prompt 配置质量比老角色更差。`secure`（安全型依恋）本该最好聊，却只有 50% 完成率、45% 停滞率 —— 这是配置问题，不是角色难度问题。

### 退出原因分布（三批对比）

| 退出原因 | 批1 | 批2 | 批3 |
|---|---|---|---|
| `stagnant_heavy_degraded` | 70 | 133 | **144** |
| `max_turns_heavy_degraded` | 198 | 131 | 139 |
| `natural_close_heavy_degraded` | 23 | 36 | 46 |
| `crisis_heavy_degraded` | 1 | 1 | **6** |
| `natural_close`（无后缀，真正自然收尾） | 3 | 5 | 1 |
| `max_turns`（无后缀，干净跑满） | 8 | 1 | **0** |

批3 里**没有任何一场是「干净跑满」**。这就是发现①的直接后果。

---

## 发现 ⑥ 成本口径：`prompt_tokens` 全库恒为 0

| 项 | 值 |
|---|---|
| `prompt_tokens` 全库最大值 | **0** |
| `prompt_tokens` 全库合计 | **0** |
| `cost_basis` 分布 | `output_only` 949 场 / NULL 85 场 |
| 全库总成本 | 5.72 元 |

`llm-render.adapter.ts:299` 已经把 `promptTokens` 往下传了（注释说 WP24 修过「此前被丢弃」），但写库时仍然是 0 —— 说明 `trace.llmUsage` → `buildLlmUsage` → `prompt_tokens` 这条链上还有一处没接上，或者上游聚合响应确实不返回。

`cost_basis = output_only` 这个标签是诚实的（没假装算全），但后果是：**输入侧开销完全不可见**。真实对练场景下 prompt 远大于输出（角色设定 + 状态机 + 历史窗口），输出只算 5.72 元，实际成本可能是它的十倍以上。

不阻塞主线，但成本看板在修好之前不能对外引用。

---

## 建议的执行顺序

> **优先级已被发现⑤重排。** 原本的第一优先是「修 `degraded_turns`」，现在前面多了一层更根本的：**LLM 根本没被调用**。
>
> **修复任务单已写好**：`docs/worklog/pending/wp-h-render-availability-fix-task.md`（WP-H）。等 WP-G 交付后再发给 MiniMax Code —— 两单都改 `practice-runner.service.ts`，并发改会冲突。

### 第 0 步（新，最高优先）：修渲染可用性

在修任何 prompt、跑任何新批次之前，先让 LLM 真的被调用：

1. **配第二个 provider**。`ENGINE_RENDER_FALLBACK_PROVIDERS` 现在是空的，`candidates` 长度 = 1，熔断一开就是全损。这是「有没有备份」的问题，不是优化。
2. **降并发 / 加退避**。`MINIMAX_LLM_MAX_RETRIES=2` 在 429 下等于放弃。批量跑批要么把并发降到上游能吃住的档位，要么加真正的指数退避 + 随机抖动。
3. **重估熔断参数**。`failureThreshold=3` + `cooldownMaxMs=300_000`：三次抖动就换来五分钟静默。批量场景下建议 `cooldownMaxMs≤60_000`，并且冷却期用半开探测（放少量请求试探），而不是一律兜底。
4. **加「渲染降级率」独立指标**。现在只有 `degraded_turns` 这个两侧混合的计数器，看不出「是 LLM 挂了还是内容质量差」。跑完一批先看降级率，高了就说明数据无效，别急着分析。

**验收标准**：跑 20~30 场金丝雀（并发 1~2），三条全过才允许跑大批：

| # | 检查项 | 合格线 |
|---|---|---|
| 1 | `total_tokens > 0` 的场次占比 | ≥ 90% |
| 2 | 来访者发言中兜底池 4 句占比 | < 5% |
| 3 | `degraded_turns ≤ turn_count`（全库） | 100% |

### 第 0.5 步：批次有效性门禁（防复发）

这次的根本教训不是「某个字段算错了」，而是**无效数据静默流进了分析层，没人拦**。三批数据跑完、报告写完、Slides 做完、任务单发出去，才发现 LLM 根本没被调用。

所以必须加一道自动护栏，跑完一批立刻判：

| 字段 | 合格线 | 不合格时 |
|---|---|---|
| `llm_call_ratio` | ≥ 90% | 批次标 `INVALID` |
| `fallback_ratio` | < 5% | 批次标 `INVALID` |
| `counter_consistency` | 100% | 批次标 `INVALID` |

标记为 `INVALID` 的批次：统计端点返回 `warning`，分析脚本拒绝读取，看板显示红条。**只标记，不自动删除、不自动重跑** —— 由人决定。

这条做进 WP-H 改动 9，属于必须先有的基础设施，不是「以后再说」的优化项。

### 第 1 步：修 `degraded_turns` 双计数（发现①）

仍然必须做，且必须并入 WP-G 同文件同批改 —— 否则修好可用性之后，`heavy_degraded` 还是 99%，照样验收不了。对应 WP-H 改动 5。

### 第 2 步：`engine_version` 自动派生（发现②）

小改动，但决定以后所有批次能不能自证代码版本。对应 WP-H 改动 8。

### 第 3 步：排查新角色 prompt 配置（发现④）

4 个新角色停滞率 40~52%，`secure` 型不该这么差。**但注意**：这项要等第 0 步修完再重测才有意义 —— 现在这批数据里新角色和老角色一样都在走兜底，分不出「prompt 差」还是「LLM 没调用」。

### 第 4 步：第四批开跑前的存储策略（发现③）

`MAX_DEBUG_SESSIONS = 500` 对批量实验完全不够。推荐跑批期间把 `ADMIN_DEBUG_SESSION_DIR` 指向按批次命名的目录（`data/debug-sessions-{batchId}/`），跑完归档；env 已支持覆盖（`debug-session-store.ts:146`）。

---

## 关于 WP-G 的 3 项 prompt 改动

WP-G 的 8 项改动里，有 3 项是渲染层 prompt（「每个角色补 15-20 种回避/阻抗表达」「加强 VARIATION_INSTRUCTION」「细化 STRATEGY_LABEL」）。

**不是要退回**，它们的代码应该保留 —— 但**验收必须推迟**。理由：现在没有可验证的条件，LLM 根本没被调用。

处理口径：

- 保留代码，不撤不改
- 等 WP-H 第一波过了门禁，用同一批金丝雀数据重新评估「来访者唯一话术数是否上升」
- 上升 → 有效，保留；无变化 → 回头查别的地方
- **不要**在 WP-H 完成后立刻否定 WP-G 的 prompt 改动 —— 那些改动本身无害，只是之前没有可验证的条件

---

## 附：核对用的 SQL

```sql
-- ① 降级计数是否畸变
SELECT COUNT(*) AS 总场次,
       SUM(degraded_turns > turn_count) AS 降级超轮次,
       ROUND(SUM(degraded_turns > turn_count)/COUNT(*)*100,1) AS 占比
FROM ap_practice_sessions WHERE status IN ('completed','stagnant','crisis_ended');

-- ② 版本追溯是否有效
SELECT engine_version, COUNT(*) FROM ap_practice_sessions GROUP BY engine_version;

-- ⑤ 渲染是否真的在调 LLM（最关键的体检项）
SELECT batch_id, COUNT(*) AS 场次,
       SUM(total_tokens = 0) AS 零token场次,
       ROUND(SUM(total_tokens = 0)/COUNT(*)*100,1) AS 零token占比,
       ROUND(SUM(total_tokens)/NULLIF(SUM(turn_count),0),0) AS 每轮token
FROM ap_practice_sessions WHERE turn_count > 0 GROUP BY batch_id;

-- ④ 批次对比
SELECT batch_id, COUNT(*) AS 场次,
       ROUND(SUM(status='completed')/COUNT(*)*100,1) AS 完成率,
       ROUND(SUM(status='stagnant')/COUNT(*)*100,1) AS 停滞率,
       ROUND(SUM(exit_reason LIKE '%heavy_degraded%')/COUNT(*)*100,1) AS 打标率
FROM ap_practice_sessions WHERE batch_id IS NOT NULL GROUP BY batch_id;
```
