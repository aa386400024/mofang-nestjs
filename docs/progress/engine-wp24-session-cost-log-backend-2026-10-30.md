# WP24 · 单场成本日志（closeSession 结构化输出）

> **日期**：2026-10-30
> **仓库**：`E:\Work\Project\backend\mofang-nestjs`
> **性质**：低成本护栏，内测期防烧 LLM 额度
> **前置依赖**：WP19（每轮 LLM usage 已留痕）

---

## 0. 为什么有这条

WP19 留了每轮 LLM usage（`traceRecorder`），但那是逐轮的散点数据，没有整场汇总。内测阶段你得知道：**这一场会话花了多少钱？** 不做看板，先在日志里打一条结构化的，能 `grep` 出来就行。

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
| `model` | 使用的模型名（如 `abab6.5s-chat`） | 从 RenderPort 的 usage 里取 |
| `totalPromptTokens` | 整场总 prompt tokens | 累加本场所有轮次的 usage.promptTokens |
| `totalCompletionTokens` | 整场总 completion tokens | 累加本场所有轮次的 usage.completionTokens |
| `totalTokens` | 总 tokens（= prompt + completion） | 算出来的 |
| `estimatedCostCny` | 预估费用（人民币，元） | 按 MiniMax 定价表算（见 §2.3） |
| `turnCount` | 本场总轮数 | 累加 |
| `enginePath` | 走的哪条链路（`bdi` / `legacy`） | 本次新引擎路径固定 `bdi` |

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

1. 跑一场完整会话（open → 几轮 turn → close），日志里能 grep 到 `session_cost_summary` 这条
2. 数字加起来对得上：`totalTokens = totalPromptTokens + totalCompletionTokens`
3. 定价走 env，改 env 后 `estimatedCostCny` 跟着变
4. 不影响现有流程：closeSession 该干嘛干嘛，打日志是顺手的事，不阻断、不抛错

---

## 4. 不做

- 不做成本看板（admin-dashboard 的成本看板是 mock，后面切真接口时再接）
- 不做告警（日预算超限提醒归 WP22）
- 不做按用户汇总（Phase2）
- 不改 WP19 的留痕链（那是另一个坑）

---

## 5. 一句话给后端

> 在 `EngineStreamBackend.closeSession()` 收尾处，累加本场所有轮次的 LLM usage，打一条 `session_cost_summary` 结构化日志，包含 sessionId / model / totalPromptTokens / totalCompletionTokens / estimatedCostCny / turnCount / enginePath。定价走 env 可配。半小时的活。
