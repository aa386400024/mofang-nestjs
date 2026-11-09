# Phase2.5 WP-H · 渲染可用性与指标可信度修复任务单

> **状态：待发**。等 WP-G（对话质量修复）交付完成后再发本单 —— 两单都改 `practice-runner.service.ts`，并发改会冲突。
> **前置阅读**：`docs/worklog/pending/phase2.5-data-pipeline-audit-2026-11-09.md`
> **生成时间**：2026-11-09

---

## 一、为什么要有这一单（必须先看这一节）

WP-G 任务单的立论是：**「来访者话术重复率 95.9%，根因是角色 prompt 只有 4-5 个固定句式」**。

这个立论**被证伪了**。对归档 500 份逐字稿做全量计数后确认：

- 报告里来访者 TOP4 话术（各出现 1844 次），**逐字等于** `render-adapter.config.ts:150` 的 `DEFAULT_RENDER_FALLBACK_UTTERANCES` 四句
- 报告里咨询师「嗯，我在听。你可以接着说。」5018 次，等于 `counselor-agent.service.ts:78` 的 `FALLBACK_REPLIES[0]`
- 归档 500 份逐字稿中，来访者消息 17,585 条，兜底池 4 句命中 **16,143 条 = 91.8%**
- 四句命中次数为 4031 / 4033 / 4039 / 4040，几乎完全相等 —— 这是 `llm-render.adapter.ts:989` 的 `fallbackCursor % pool.length` 确定性轮转的必然结果，LLM 生成不可能这么均匀
- 更硬的证据：1,031 个有轮次的场次里，**926 场（89.8%）整场 `total_tokens = 0`**；`prompt_tokens` 全库最大值 **0**

**结论：这三批数据不是「质量差的对练」，是「LLM 基本没被调用」。那 4 句话不是角色说的话，是渲染降级兜底。**

因此：
- **WP-G 的 3 项渲染层 prompt 改动（扩充角色话术、加强 VARIATION_INSTRUCTION、细化 STRATEGY_LABEL）现在无法验收，也无法证伪。** LLM 不被调用时，角色 prompt 写 20 句还是 200 句都毫无意义——兜底句取自常量池，与角色 prompt 无关。这三项代码该保留，但验收要推迟到本单完成之后。
- 在修好可用性之前跑第四批，得到的任何指标都不能用于调参。

---

## 二、根因链（已代码验证，可直接照此定位）

```
批量 320~336 场 × 20~35 轮 ≈ 6,000~11,000 次调用，Worker 并发 3
        ↓
MiniMax 上游限流 / 超时（MINIMAX_LLM_MAX_RETRIES=2）
        ↓
连续失败 3 次 → 单例熔断器打开 → 冷却 30s 起，指数退避至 300s
        ↓
冷却期内所有会话的渲染直接返回兜底池（游标轮换，不发请求）
        ↓
来访者说兜底 4 句、咨询师说兜底 1 句 → 对话无实质内容 → 停滞
        ↓
两侧每轮各降级一次 → degraded_turns = 2 × turn_count → heavy_degraded 99.7%
```

关键代码位置：

| 环节 | 位置 | 现状 |
|---|---|---|
| 候选序列构造 | `src/engine-adapters/wiring/render-config.factory.ts:115` | `ENGINE_RENDER_FALLBACK_PROVIDERS` 未配置 → **candidates 长度 = 1** |
| 熔断阈值 | `src/engine-adapters/rendering/render-adapter.config.ts:130` | `failureThreshold = 3` |
| 冷却上限 | `src/engine-adapters/rendering/render-adapter.config.ts:136` | `cooldownMaxMs = 300_000`（5 分钟） |
| 单例状态 | `src/engine-adapters/rendering/llm-render.adapter.ts:246` | `fallbackCursor` 实例级 → 冷却状态全进程共用 |
| 兜底话术池 | `src/engine-adapters/rendering/render-adapter.config.ts:150` | 4 句，即报告 TOP4 |
| 兜底时用量写死 0 | `src/engine-adapters/rendering/llm-render.adapter.ts:956`、`974` | `usage: { completionTokens: 0, totalTokens: 0 }` |
| 降级计数双计 | `src/auto-practice/practice-runner.service.ts:310`、`318`、`388` | 每轮最多 +2，阈值按轮数算 |
| 版本号恒 dev | `src/auto-practice/inference-fingerprint.service.ts:86` | `.env` 无 `ENGINE_VERSION` |

---

## 三、硬约束（红线，与 WP-G 一致）

1. **`src/engine-core/` 一行不改**。BDI 决策、安全评估、记忆系统全部不动。
2. 本单改动集中在 `engine-adapters/rendering`、`engine-adapters/wiring`、`llm/`、`auto-practice`（非 prompt 部分）。
3. **隐私红线**：日志不出现心理内容原文，只打状态码、数字、错误类型名。
4. **不自动 git commit / push**，改完给 commit message 草稿。
5. **不改变降级语义**：`degraded=true` 的语义（「这段不是来访者真说的话」）不能动，上层用它决定是否写入历史。
6. **缺省零回归**：未配置新 env 时，行为与改前一致（除刻意修的 bug）。

---

## 四、验收门禁（本单的验收标准就是这套数字）

修完不是「看起来好了」，必须过下面三条才算合格：

| # | 检查项 | 合格线 | 不合格含义 |
|---|---|---|---|
| 1 | `total_tokens > 0` 的场次占比 | **≥ 90%** | 说明仍在兜底 |
| 2 | 来访者发言中兜底池 4 句占比 | **< 5%** | 说明降级仍在发生 |
| 3 | `degraded_turns ≤ turn_count`（全库） | **100%** | 计数口径仍未修好 |

**验证方式**：先跑 20~30 场金丝雀（并发 1~2），三条全过再跑大批；任一不过，回到对应改动项。

---

## 五、具体改动项

### 第一波：让 LLM 真的被调用（最高优先，先做这波）

#### 改动 1：候选序列至少 2 个，且启动期强校验

**文件**：`src/engine-adapters/wiring/render-config.factory.ts`（`buildCandidates`，:115）

**现状**：`ENGINE_RENDER_FALLBACK_PROVIDERS` 为空时，`candidates` 长度为 1，等于没有备份。熔断一开就是全损。

**改成**：
1. `buildCandidates` 返回后，若 `candidates.length < 2`，打 `logger.warn`，明确写出「单候选模式：熔断将导致全部请求降级，批量跑批前请配置 ENGINE_RENDER_FALLBACK_PROVIDERS」。
2. 增加 env `ENGINE_RENDER_REQUIRE_FAILOVER`（默认 false）。为 true 时，`candidates.length < 2` 直接抛错，让装配期炸掉而不是跑到一半才发现。
3. 在 `.env.example` 补 `ENGINE_RENDER_FALLBACK_PROVIDERS=` 及其说明。

**不得**在装配层硬编码模型名（沿用现有口径：模型名从 env 或 router 的 tier→model 映射取）。

**验收**：单测覆盖「空 fallback 列表 → warn 被调用」「REQUIRE_FAILOVER=true + 单候选 → 抛错」。

#### 改动 2：冷却参数重估 + 半开探测

**文件**：`src/engine-adapters/rendering/render-adapter.config.ts`、`render-failover.runtime.ts`

**现状**：`failureThreshold=3`、`cooldownBaseMs=30_000`、`cooldownMaxMs=300_000`。单 provider 场景下等于「三次抖动 → 五分钟静默」。

**改成**：
1. `DEFAULT_RENDER_COOLDOWN_MAX_MS`：`300_000` → **`60_000`**。
2. 新增 env `ENGINE_RENDER_COOLDOWN_MAX_MS` 覆盖项（工厂里读，缺省用新种子值）。
3. **半开探测**：`RenderFailoverRuntime` 增加 `shouldProbe(id)` —— 冷却到期前若距 `cooldownUntil` 已过 `halfOpenAfterMs`（建议 = `cooldownBaseMs`），放行**一次**探测请求；探测成功 → `markSuccess` 清零并完全恢复；失败 → 重新进冷却（且把 `halfOpenAfterMs` 翻倍，上限 = `cooldownMaxMs`）。
4. 冷却期内即便全候选不可用，也要**记录一次可观测事件**（计数 + 原因），供改动 5 的指标使用。

**验收**：单测覆盖「冷却期内第一次调用被放行探测」「探测失败后冷却时长翻倍」「冷却上限不超过 60s」。

#### 改动 3：上游重试走真退避

**文件**：`src/llm/`（MINIMAX provider 的重试实现）

**现状**：`MINIMAX_LLM_MAX_RETRIES=2`，无退避，429 下等于放弃。

**改成**：重试间隔改为指数退避 + 随机抖动（如 500ms / 1.5s / 4s + jitter），仅对可重试错误（429 / 5xx / 超时）重试；鉴权失败、参数错误**不重试**。

**验收**：单测覆盖「429 三次后放弃并上抛」「401 立即上抛不重试」。

#### 改动 4：批量并发可配置，默认降低

**文件**：`src/auto-practice/practice-queue.service.ts`

**现状**：Worker 并发 3，配合长 prompt 会把上游打满。

**改成**：新增 env `AUTO_PRACTICE_CONCURRENCY`（默认 **2**，允许 1~5）。启动时打一行 info 说明当前并发。

**验收**：env 未配时默认 2；配 1 时同时只跑 1 场。

---

### 第二波：指标可信度

#### 改动 5：`degraded_turns` 拆双计数器（**必须做，否则 WP-G 无法验收**）

**文件**：`src/auto-practice/practice-runner.service.ts:310`、`:318`、`:388` + 实体 + 迁移

**现状**：一个 `degradedTurns` 同时装「咨询师侧降级次数」和「来访者侧降级次数」，每轮最多 +2；而 `:388` 用 `degradedTurns / turnCount >= 0.5` 判 `_heavy_degraded` —— 分子是「事件数」，分母是「轮数」，两个口径混用。实测 687/1014 场（67.8%）的 `degraded_turns > turn_count`，数学上不可能；209 场恰好 2 倍。

**改成**：
1. 拆成两个计数器：`counselorDegradedTurns`、`visitorDegradedTurns`，各自每轮最多 +1。
2. 实体加两列 `counselor_degraded_turns`、`visitor_degraded_turns`（迁移，`INT NOT NULL DEFAULT 0`）。
3. **保留旧列 `degraded_turns` 不动**，写入时取 `max(counselor, visitor)` 以维持旧语义的可读性；同时新增 `render_fallback_ratio`（见改动 6）作为真正的质量指标。
4. `:388` 的 `_heavy_degraded` 改判：`counselorDegradedTurns / turnCount >= 0.5 || visitorDegradedTurns / turnCount >= 0.5`。

**验收**：
- 单测：两侧各降级一次的一轮，`degraded_turns` 不再是 2，而是每列各 1。
- 迁移可回滚（down 删两列）。
- 跑完一批后全库断言 `counselor_degraded_turns <= turn_count AND visitor_degraded_turns <= turn_count`。

#### 改动 6：新增「渲染降级率」独立指标

**文件**：`src/auto-practice/practice-runner.service.ts`、`src/auto-practice/entities/practice-session.entity.ts`

**现状**：没有任何字段能区分「LLM 挂了」和「内容质量差」。这是这次三批数据全部作废的直接原因——数据一直在流，没人拦。

**改成**：
1. 实体新增 `render_fallback_turns`（该场访问者侧走兜底的总次数）、`render_fallback_ratio`（`render_fallback_turns / turn_count`）、`llm_call_turns`（真实调用次数）。
2. 每次渲染结果 `providerHint === 'degraded'` 时 `render_fallback_turns += 1`，否则 `llm_call_turns += 1`。
3. 批次汇总接口（`auto-practice.controller.ts` 的统计端点）返回批次级三者之和。

**验收**：跑 5 场已知正常/已知降级的混合批，三个字段数值与人工核对一致。

#### 改动 7：修 `prompt_tokens` 归约链

**文件**：`src/admin-debug/debug-session.service.ts` 的 `buildLlmUsage`（:560）、`src/auto-practice/` 用量累加处

**现状**：`prompt_tokens` 全库最大值 0，从未记录过一次；`cost_basis` 恒为 `output_only`，全库成本 5.72 元（严重低估）。

**改成**：从 `RenderResult.usage.promptTokens`（`llm-render.adapter.ts:299` 已已传）一路带到 `buildLlmUsage` 与累计字段；上游未报时保持 `null` 而不是写 0，并在 `cost_basis` 里如实降级为 `output_only`。

**验收**：单测覆盖「上游给了 promptTokens → 落库非 0」「上游没给 → 落 null 且 cost_basis=output_only」。

---

### 第三波：版本追溯与批次门禁

#### 改动 8：`engine_version` 自动派生

**文件**：`src/auto-practice/inference-fingerprint.service.ts:86`

**改成**：

```ts
engineVersion: this.config.get<string>('ENGINE_VERSION')?.trim() || gitDescribeDirty(),
// gitDescribeDirty() = execSync('git describe --always --dirty').trim()
// 例： "76d6d93-dirty" / "76d6d93"
// git 不可用（生产容器无 .git）时回落 'unknown'，不抛错
```

`-dirty` 后缀是关键：让「数据来自未提交代码」这件事在数据里可见。

**验收**：工作区 dirty 时写入含 `-dirty`；clean 时不含；无 git 时写 `unknown`。

#### 改动 9：批次有效性门禁（本单的护栏）

**文件**：`src/auto-practice/practice-queue.service.ts`（批次结束时）+ 统计端点

**现状**：无。三批无效数据静默流进分析，导致整个 Phase2.5 的结论全部作废。

**改成**：
1. 批次跑完时计算 `batch_health`：

   | 字段 | 合格线 |
   |---|---|
   | `llm_call_ratio`（`llm_call_turns>0` 的场次占比） | ≥ 90% |
   | `fallback_ratio`（`render_fallback_ratio` 的批次均值） | < 5% |
   | `counter_consistency`（`degraded_turns <= turn_count`） | 100% |

2. 任一不合格 → `batch_health.valid = false`，并把批次状态写为 `INVALID`（或独立列 `validity_flags`）。
3. 统计/分析端点遇到 `valid = false` 时，在返回体里带 `warning: '该批次未通过有效性门禁，指标不可用于结论'`。
4. 不做自动删除、不自动重跑 —— 只标记，由人决定。

**验收**：手工构造一个降级率 50% 的批次，`valid` 必须为 false 且端点带 warning。

---

## 六、执行顺序与交付要求

1. **第一波**（改动 1~4）先做，单独可交付 —— 这是让 LLM 回来的前提。
2. **第二波**（改动 5~7）再做。改动 5 与 WP-G 同文件，**必须确认 WP-G 已合并后再动**。
3. **第三波**（改动 8~9）最后。
4. 每波交付：改动清单 + 单测 + `npx tsc -p tsconfig.build.json --noEmit` 0 错 + commit message 草稿。

**验证协议（交付后由主 Agent 执行，不由 MiniMax Code 代跑）**：
- 金丝雀：20~30 场，并发 1~2
- 三项门禁全过 → 才允许跑大批
- 金丝雀数据归档到 `data/archives/debug-sessions-canary-{日期}/`，**不要**留在默认目录（`MAX_DEBUG_SESSIONS=500` 会吃掉）

---

## 七、WP-G 那 3 项 prompt 改动怎么处理

保留代码，但**验收推迟**。理由：现在无法判断「话术是否够多样」，因为 LLM 根本没说话。

本单第一波通过门禁后，用同一批金丝雀数据重新评估：
- 若来访者唯一话术数显著上升 → WP-G 那 3 项有效，保留
- 若无变化 → 说明根因确实不在 prompt，回头再查

**不要**在 WP-H 完成后立刻否定 WP-G 的 prompt 改动 —— 那些改动本身无害，只是之前没有可验证的条件。

---

## 八、Commit message 草稿（交付后填具体 hash）

```
fix(phase2.5): 修复渲染可用性与指标可信度 (WP-H)

根因: 渲染候选序列只有 1 个 provider (ENGINE_RENDER_FALLBACK_PROVIDERS 未配置),
配合 failureThreshold=3 + cooldownMax=300s 的单例熔断, 批量跑批时上游限流即导致
连续冷却, 三批共 1031 场中 926 场 (89.8%) 整场 total_tokens=0, 来访者 91.8%
发言为兜底池话术. 此前归因为"角色 prompt 话术太少"的结论不成立.

- 候选序列至少 2 个 + 启动期强校验 (REQUIRE_FAILOVER)
- 冷却上限 300s → 60s, 新增半开探测
- 上游重试改指数退避 + 抖动
- 批量并发可配置, 默认 3 → 2
- degraded_turns 拆 counselor/visitor 双计数器 (修复 67.8% 场次分子>分母)
- 新增 render_fallback_turns / llm_call_turns / render_fallback_ratio
- prompt_tokens 归约链补齐 (此前全库恒为 0)
- engine_version 改 git describe --dirty 派生
- 新增批次有效性门禁, 不合格批次标记 INVALID 不进分析
```
