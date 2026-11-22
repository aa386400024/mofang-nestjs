# WP-F · 成本看板合并数据源（正式训练 + 自动对练）

> 阶段：Phase2.5 灰度验证期
> 类型：后端功能（admin 端点扩展 + 数据源补全）
> 优先级：P1
> 前置：WP31（成本看板初版）✅、WP-D（自动对练场次表）✅
> 评审：已通过 MiniMax Code 第二意见评审（2026-11-09），P0 问题已修正方案
> **状态**: ✅ 已交付（2026-11-09）→ [交付记录](phase2.5-wp-f-cost-board-merge-sources-implementation-2026-11-09.md)

---

## 1. 背景与问题

成本看板（/cost）现在只统计 **training_sessions**（正式咨询师训练会话），
但 Phase2.5 灰度验证期间大量跑的是 **ap_practice_sessions**（自动对练场次），
导致看板看起来"没跑过"——实际上跑了几十场自动对练，成本全漏了。

用户要求：成本看板要能同时展示正式训练和自动对练，并且**能区分出来**每条数据来自哪。

---

## 2. 现状盘点（已 grep 核实）

### 2.1 已有的两张表

| 表 | 实体 | 有什么 | 缺什么 |
|---|---|---|---|
| `training_sessions` | `TrainingSession` | 会话元数据 + 留痕快照（token / cost 从留痕算） | — |
| `ap_practice_sessions` | `PracticeSession` | `debugSessionId`、`startedAt`、`turnCount`、6 种状态 | **`total_cost` 全仓没有写入点，28/28 场恒为 null**；没有 token 字段 |

### 2.2 现有端点

- `GET /admin/api/cost/trend?days=N` — 按天聚合，只查 training_sessions
- `GET /admin/api/cost/sessions?limit=N` — 会话成本列表，只查 training_sessions

### 2.3 评审发现的 P0 问题（已修正）

| 问题 | 原方案 | 修正后 |
|---|---|---|
| P0-1：`total_cost` 恒为 null，没有写入点 | 直接用 `total_cost × 7.2`，结果恒为 0 | 路线 B：runner 结算时直接用同一张定价表算成**人民币元**落库，和正式训练同源 |
| P0-2：币种口径错了 7.2 倍 | `total_cost` 标"美元"但实际是元，再 ×7.2 错 7.2 倍 | 不搞美元了，直接算元，汇率问题整个消失 |

---

## 3. 落地顺序（分两步）

### Step 0：补数据源（自动对练成本/token 真的有值）

**做什么：** 在自动对练 runner 结算时，把 token 和成本落库到 `ap_practice_sessions`。

**怎么做：**
- 数据源：自动对练每轮 trace 里已有 `llmUsage.promptTokens / completionTokens`
- 成本计算：复用现有的 `estimateSessionCost()`（`src/engine-adapters/observability/session-cost.ts`）
- 定价表：用同一张 `LLM_PRICE_INPUT_PER_1K / LLM_PRICE_OUTPUT_PER_1K`
- 落库：新增字段 `total_cost_cny`（元），或改 `total_cost` 注释为"元"（二选一，注意写 migration）
- 口径标记：同时写 `cost_basis`（`full` / `output_only`），和正式训练保持一致

**为什么先做这步：** 不补数据源，合并完看板自动对练那栏还是 0，用户看到的还是"空的"，诉求没解决。

### Step 2：做合并看板

**做什么：** 扩展成本趋势和会话列表接口，合并两张表。

---

## 4. 需求详情

### 4.1 成本趋势接口扩展

`GET /admin/api/cost/trend?days=N`

**改动：** 合并 training_sessions + ap_practice_sessions 两张表的按天聚合。

**返回字段扩展：**

```ts
interface CostTrendPoint {
  date: string           // YYYY-MM-DD (Asia/Shanghai)
  tokens: number         // 总 token（formal + auto_practice）
  costCny: number        // 总成本（人民币）
  sessions: number       // 总会话数
  // 新增：分来源统计，方便前端做分组图
  sessionsFormal: number        // 正式训练会话数
  sessionsAutoPractice: number  // 自动对练场次
  costFormal: number            // 正式训练成本（¥）
  costAutoPractice: number      // 自动对练成本（¥）
  tokensFormal: number          // ← 新增：tokens 也分来源
  tokensAutoPractice: number    // ← 新增
}
```

**实现要点：**
- training_sessions 的 tokens / cost 继续从留痕快照算（原有逻辑不变）
- ap_practice_sessions 的 tokens / cost 从 Step 0 补的字段读
- 按天聚合的时区口径不变（`shanghaiDateKey()`，Asia/Shanghai）
- 扫描上限：每源一次 2000，总量最多 4000（和现有行为一致，登记在交付记录）

### 4.2 会话成本列表扩展

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
  costBasis: 'full' | 'output_only' | 'estimated'
  // 自动对练特有字段（source=auto_practice 时有值）
  characterSlug?: string        // 来访者角色 slug
  counselorModeId?: string       // 咨询师模式 id
  batchId?: string | null        // 批次 id
  status?: string                // 自动对练场次状态
}
```

**实现要点：**
- training_sessions 的 `source = 'formal'`，visitorAlias 用原逻辑
- ap_practice_sessions 的 `source = 'auto_practice'`，visitorAlias 用 `character_slug` 兜底
- **limit 语义**：每源先按 startedAt 各取 N，合并后再排序 → 返回最多 2N 行（避免一次跑 30 场自动对练，limit=20 全是自动对练）
- **会话计数规则**：成本照算（钱花了就是花了，failed/running 的也算），但 sessions 计数是否含 failed/canceled 要单独定义（建议：completed/crisis_ended/stagnant 算 session，failed/canceled 不算 session 但成本照算）

---

## 5. 合并方式（架构纪律）

**不要：**
- ❌ 在 controller 里拼 SQL / 直接 UNION 两张表（口径换算散在 SQL 里，没法单测）
- ❌ 建 MySQL VIEW（应用层口径写不进视图，破坏 TypeORM 实体层约定）

**要：沿用仓库既有分层，加一层"来源适配器"**

| 层 | 现有 | WP-F 该怎么扩 |
|---|---|---|
| 纯函数层（零 Nest / 零 IO） | `cost-view.ts`：`aggregateSessionCost()`、`buildCostTrend()` | 新增统一行模型 `CostSourceSession` + 吃统一模型的 `buildMergedCostTrend()` / `buildMergedSessionList()` |
| 口径/配置层 | `cost-pricing.ts`：env → 单价唯一映射 | 不新增汇率 env（路线 B 不需要） |
| 适配层（做 IO，产出行模型） | controller 里直接查库 | 新增两个 provider：`FormalCostSource`、`AutoPracticeCostSource` |
| controller | 调 `buildCostTrend` | 只做"取两个源的行 → 交给纯函数合并 → 返回"，不含口径逻辑 |

**两个纪律：**
- 新增函数，不改现有函数签名（保护 `wp31-cost-board.spec.ts`）
- 不引入 DI 装饰器 / `@Global` 注册表（普通 provider 用构造函数注入即可）

---

## 6. 硬约束

- engine-core 纯层零改动
- 成本定价表只有一份（LLM_PRICE_INPUT_PER_1K / LLM_PRICE_OUTPUT_PER_1K），不另造
- **不搞美元字段，不搞汇率换算**——自动对练成本直接算成人民币元，和正式训练同源同口径
- **学员隔离**：学员身份的请求**完全不含**自动对练源（自动对练没有 userId 归属，合并进去会越权）；只有管理员 basic 凭据能看到自动对练
- 心理内容（对话原文、prompt 全文）禁止进日志、crash report、响应体——只取 `llmUsage` 里的数字
- 不自动 git commit / push，只给 commit message 草稿

---

## 7. 验收标准

1. Step 0 完成后：跑 3 场自动对练，`ap_practice_sessions.total_cost_cny`（或等价字段）有值，数量级和同轮正式训练对得上
2. Step 2 完成后：/cost 页：
   - 汇总卡片显示总会话数 = 正式 + 自动对练
   - 趋势图每天的 sessions 数 = 正式 + 自动对练（分来源）
   - 会话列表里每条都有"来源"标签，正式训练和自动对练能区分
   - 自动对练的成本金额数量级合理
3. training_sessions 的原有数据不受影响（回归验证，wp31-cost-board.spec.ts 全绿）
4. 学员身份请求看不到自动对练数据（隐私边界验证）

---

## 8. 不在本期范围

- 前端趋势图改成分组柱状图 / 分来源卡片（前端由另一个 AI 做，后端只出契约）
- 用户端自由练习（`practice_sessions`，另一张表，无成本列）进看板
- 汇率做成 env 配置（路线 B 不需要）
- 自动对练咨询师侧 LLM 成本是否单独拆字段（本期先算引擎侧，和正式训练可比；咨询师侧成本另开）

---

## 9. 交付记录必须登记的偏差

1. `ap_practice_sessions.total_cost` 原声明"美元" → 实际口径改为"元"，字段语义变更 + migration
2. `training_sessions.started_at` nullable vs `ap_practice_sessions.started_at` NOT NULL → 两源 sessions 计数规则的统一处理
3. ap 表无软删、formal 表需 `deletedAt: IsNull()` → 过滤条件不对称
4. 趋势扫描上限 2000 是每源一次，总量最多 4000
5. 自动对练咨询师侧 LLM 成本是否计入、以及它与正式训练不可直接比大小
6. 学员身份请求不含自动对练源
7. limit 语义：每源先取 N，合并后最多 2N 行

---

_创建：2026-11-09_
_更新：2026-11-09（MiniMax Code 评审后修正方案，路线 B + 两步走）_
