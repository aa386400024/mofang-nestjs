# WP-F · 成本看板合并数据源（正式训练 + 自动对练）

> 阶段：Phase2.5 灰度验证期
> 类型：后端功能（admin 端点扩展）
> 优先级：P1
> 前置：WP31（成本看板初版）✅、WP-D（自动对练场次表）✅

---

## 1. 背景与问题

成本看板（/cost）现在只统计 **training_sessions**（正式咨询师训练会话），
但 Phase2.5 灰度验证期间大量跑的是 **practice_sessions**（自动对练场次），
导致看板看起来"没跑过"——实际上跑了几十场自动对练，成本全漏了。

用户要求：成本看板要能同时展示正式训练和自动对练，并且**能区分出来**每条数据来自哪。

---

## 2. 现状盘点

### 2.1 已有的两张表

| 表 | 实体 | 有什么 | 缺什么 |
|---|---|---|---|
| `training_sessions` | `TrainingSession` | 会话元数据 + 留痕快照（token / cost 从留痕算） | — |
| `ap_practice_sessions` | `PracticeSession` | `totalCost`（美元，粗略估算）、`debugSessionId`、`startedAt`、`turnCount` | 没有 totalTokens 字段；没有 visitorAlias |

### 2.2 现有端点

- `GET /admin/api/cost/trend?days=N` — 按天聚合，只查 training_sessions
- `GET /admin/api/cost/sessions?limit=N` — 会话成本列表，只查 training_sessions

---

## 3. 需求

### 3.1 成本趋势接口扩展

`GET /admin/api/cost/trend?days=N`

**改动：** 合并 training_sessions + practice_sessions 两张表的按天聚合。

**返回字段扩展：**

```ts
interface CostTrendPoint {
  date: string           // YYYY-MM-DD (Asia/Shanghai)
  tokens: number         // 总 token（training 从留痕算；practice 先 0，后续补）
  costCny: number        // 总成本（人民币）
  sessions: number       // 总会话数
  // 新增：分来源统计，方便前端做分组图
  sessionsFormal: number        // 正式训练会话数
  sessionsAutoPractice: number  // 自动对练场次
  costFormal: number            // 正式训练成本（¥）
  costAutoPractice: number      // 自动对练成本（¥）
}
```

**实现要点：**
- training_sessions 的 tokens / cost 继续从留痕快照算（原有逻辑不变）
- practice_sessions 的 cost：用表里已有的 `total_cost` 字段（美元），按汇率 7.2 转人民币
- practice_sessions 的 tokens：先填 0（后续 WP-E 做完后从 debug_session JSON 里补算）
- 按天聚合的时区口径不变（Asia/Shanghai）

### 3.2 会话成本列表扩展

`GET /admin/api/cost/sessions?limit=N`

**改动：** 合并两张表，按 startedAt 倒序混合排列，每条标来源。

**返回字段扩展：**

```ts
interface SessionCost {
  sessionId: string
  source: 'formal' | 'auto_practice'   // 新增：数据来源
  visitorAlias: string
  startedAt: string
  totalTokens: number
  costCny: number
  costBasis: 'full' | 'output_only'
  // 自动对练特有字段（source=auto_practice 时有值）
  characterSlug?: string        // 来访者角色 slug
  counselorModeId?: string       // 咨询师模式 id
  batchId?: string | null        // 批次 id
}
```

**实现要点：**
- training_sessions 的 `source = 'formal'`，visitorAlias 用原逻辑
- practice_sessions 的 `source = 'auto_practice'`，visitorAlias 用 `character_slug` 兜底
- practice_sessions 的 costCny = `total_cost`（美元）× 7.2
- practice_sessions 的 totalTokens 先填 0
- 混合排序后取前 N 条（limit 参数）

---

## 4. 硬约束

- engine-core 纯层零改动
- 不改留痕写入逻辑，只改查询聚合
- 成本定价表只有一份（LLM_PRICE_INPUT_PER_1K / LLM_PRICE_OUTPUT_PER_1K），不另造
- practice_sessions 的 totalCost 是美元，转人民币用固定汇率 7.2（写死在常量里，后面再做成 env）

---

## 5. 验收标准

1. 跑过至少 1 场正式训练 + 3 场自动对练后，/cost 页：
   - 汇总卡片显示总会话数 = 两者之和
   - 趋势图每天的 sessions 数 = 正式 + 自动对练
   - 会话列表里每条都有"来源"标签，正式训练和自动对练能区分
2. 自动对练的成本金额 = 三场 × 每场 totalCost × 7.2，数量级对得上
3. training_sessions 的原有数据不受影响（回归验证）

---

## 6. 不在本期范围

- practice_sessions 的 token 数精确统计（等 WP-E 做完后从 debug_session JSON 里补算）
- 汇率做成 env 配置
- 前端趋势图改成分组柱状图（本期先合并展示，前端后面再优化）

---

_创建：2026-11-09_
