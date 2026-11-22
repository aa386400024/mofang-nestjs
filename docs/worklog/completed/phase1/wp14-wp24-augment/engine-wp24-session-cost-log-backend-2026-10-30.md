# WP24 · 单场成本日志（closeSession 结构化输出）

> **日期**：2026-10-30
> **仓库**：`E:\Work\Project\backend\mofang-nestjs`
> **性质**：低成本护栏，内测期防烧 LLM 额度
> **状态**：✅ **已交付**（2026-10-30）｜ 交付记录：[engine-wp24-session-cost-log-backend-2026-10-30-implementation-2026-10-30.md](engine-wp24-session-cost-log-backend-2026-10-30-implementation-2026-10-30.md)
> **前置依赖**：~~WP19（每轮 LLM usage 已留痕）~~ → **实测不依赖**。本单直接取渲染结果里的 usage（`settled.result.render.usage`），**不走 `traceRecorder`** —— WP19 留痕链是否通与本单无关。

---

## 0. 为什么有这条

内测阶段你得知道：**这一场会话花了多少钱？** 不做看板，先在日志里打一条结构化的，能 `grep` 出来就行。

---

## 1. 目标

`closeSession` 时打一条结构化日志，输出本场会话的总成本概览。

---

## 2. 内容

### 2.1 在哪里打

新引擎路径（`EngineStreamBackend`）的 `closeSession` 方法收尾处。

### 2.2 打什么字段

一条结构化日志，包含：

| 字段 | 说明 | 来源 |
|---|---|---|
| `sessionId` | 会话 ID | 入参 |
| `model` | 使用的模型名（如 `abab6.5s-chat`） | 从渲染结果里取（见下方「交付时修正」） |
| `totalPromptTokens` | 整场总 prompt tokens | 累加本场所有轮次的 usage.promptTokens（见下方「交付时修正」） |
| `totalCompletionTokens` | 整场总 completion tokens | 累加本场所有轮次的 usage.completionTokens |
| `totalTokens` | 总 tokens（= prompt + completion） | 算出来的 |
| `estimatedCostCny` | 预估费用（人民币，元） | 按 MiniMax 定价表算（见 §2.3） |
| `costBasis` | **成本口径**：`full` / `output_only` | 输入侧用量是否可得 |
| `turnCount` | 本场总轮数 | 累加 |
| `enginePath` | 走的哪条链路（`bdi` / `legacy`） | 本次新引擎路径固定 `bdi` |

> **交付时修正（本任务单有两处前提错误，交付记录 §1 有完整说明）**：
>
> 1. **`totalPromptTokens` 与 `model` 原表没有数据源**。上游**流式**路径只给累计 `tokenCount`，没有 prompt/completion 拆分（`ChatCompletionChunk` 无这两个字段），而 voice 端到端走的正是流式。交付口径：内核加**可选** `promptTokens?` / `model?` 透传（用户拍板），`model` 流式路径有、`totalPromptTokens` 流式路径**不可得** → `costBasis` 落成 `output_only`。
> 2. **新增 `costBasis` 字段**（原表没有）。输入侧不可得时成本是**全场成本的下界**，口径必须落在数据里 —— 一个系统性偏低的数字等于没有数字。

### 2.3 成本怎么算

MiniMax 定价（按当前 Token Plan）：
- 输入（prompt）：约 ¥0.0015 / 千 tokens
- 输出（completion）：约 ¥0.0045 / 千 tokens

公式：
```
estimatedCostCny = (totalPromptTokens / 1000) * 0.0015 + (totalCompletionTokens / 1000) * 0.0045
```

**注意**：定价表做成 env 可配（`LLM_PRICE_INPUT_PER_1K` / `LLM_PRICE_OUTPUT_PER_1K`），默认值写在上面。以后涨价了改 env 就行，不用改代码。

### 2.4 日志格式

用 NestJS 的 `logger.log()`，输出结构化 JSON 一行：

```json
{
  "event": "session_cost_summary",
  "sessionId": "xxx",
  "model": "abab6.5s-chat",
  "totalPromptTokens": 1234,
  "totalCompletionTokens": 567,
  "totalTokens": 1801,
  "estimatedCostCny": 0.0045,
  "turnCount": 8,
  "enginePath": "bdi"
}
```

---

## 3. 验收

| # | 验收条 | 实际 |
|---|---|---|
| 1 | 跑一场完整会话（open → 几轮 turn → close），日志里能 grep 到 `session_cost_summary` 这条 | ✅ 引擎后端闭环用例通过（`openSession` → `streamTurn` → `closeSession`） |
| 2 | 数字加起来对得上：`totalTokens = totalPromptTokens + totalCompletionTokens` | ✅ 两条路径下都成立（输入侧不可得时它本就是 0，且 `total` 与 `completion` 同源） |
| 3 | 定价走 env，改 env 后 `estimatedCostCny` 跟着变 | ✅ `resolveSessionCostPricing` + `estimateSessionCost` 用例覆盖（合法值生效 / 缺省走默认 / 非法值回退不抛） |
| 4 | 不影响现有流程：closeSession 该干嘛干嘛，打日志是顺手的事，不阻断、不抛错 | ✅ 逐字稿定稿 + 摘要晋升照常；成本日志在句柄判定内，打完即删累加器 |

**额外补的护栏**（原验收没写，但本单实际改了既有锁，必须记）：改了 WP6 的「渲染结果字段集合固定」零回归锁（加 `model` / `usage.promptTokens`）、放宽了 WP10 的源码切片窗口（900 → 1600）—— 详见交付记录 §3。

---

## 4. 不做

- 不做成本看板（admin-dashboard 的成本看板是 mock，后面切真接口时再接）
- 不做告警（日预算超限提醒归 WP22）
- 不做按用户汇总（Phase2）
- 不改 WP19 的留痕链（那是另一个坑）

---

## 5. 一句话给后端

> 在 `EngineStreamBackend.closeSession()` 收尾处，累加本场所有轮次的 LLM usage，打一条 `session_cost_summary` 结构化日志，包含 sessionId / model / totalPromptTokens / totalCompletionTokens / estimatedCostCny / turnCount / enginePath。定价走 env 可配。半小时的活。
