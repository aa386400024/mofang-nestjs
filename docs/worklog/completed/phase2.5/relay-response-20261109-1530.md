# WP-F 成本看板合并数据源 · 第二意见（评审）

> 评审对象：`docs/worklog/pending/phase2.5-wp-f-cost-board-merge-sources.md`（WP-F 任务单）
> 评审时间：2026-11-09 14:30 GMT+8
> 评审方式：读真实代码 + grep 核实，未改任何生产代码（本轮只出意见）

---

## 0. 总体结论

**方向对，落地前有两个 P0 级问题会让当前方案直接失效**，另有 3 个待决策点可以现在就定死。

- 方向（合并两张表 + 按来源区分）我完全同意；"复用同一张定价表""engine-core 零改动"这两条硬约束也认同。
- **P0-1**：`ap_practice_sessions.total_cost` **全仓没有写入点，28/28 场恒为 null** —— 方案第 3 条"直接用 total_cost × 7.2"会算出**恒为 0** 的成本，看板照样"空的"，用户原始诉求没解决。
- **P0-2**：`total_cost` 声明为**美元**，而唯一那张定价表 `LLM_PRICE_*_PER_1K` 的单位是**元 / 千 token**。如果 `total_cost` 是拿同一套 token 单价算出来的，那它其实是"元"被标成了"美元"，再 ×7.2 就是**错的 7.2 倍**。目前没人知道它打算怎么算，因为没人写它。
- 三个待决策点的答案：**汇率本期根本不需要**（走同源路线）；**口径差异靠"同源"消除、而不是靠"加提示"掩盖**；**时区两表一致、真正的坑在跨环境写入**。
- 合并方式：**不要在 controller 里拼 SQL，也不要建 MySQL 视图**。仓库已有的"纯函数层 + 适配层"分层就是答案，沿它扩即可。

---

## 1. P0-1 · `total_cost` 恒为 null，没有写入点

### 事实（grep 核实）

| 证据 | 位置 |
|---|---|
| 字段声明存在，`decimal(10,4) NULL`，注释"美元, 粗略估算" | `src/auto-practice/entities/practice-session.entity.ts:149-151` |
| DDL 里同样是 `total_cost DECIMAL(10,4) NULL` | `src/migration/1714900000033-AddAutoPracticeTables.ts:78` |
| **全仓 grep `totalCost`：只有实体声明、前端类型定义、文档，零写入点** | 本轮 grep 结果 |
| 实测 **28/28 场 `totalCost=null`**，登记为 P2-1 | `docs/worklog/completed/phase2.5/phase2.5-wp-d-auto-practice-2026-11-09-test-report.md:105,213` |

写入侧本该在 `persistSession()`（`src/auto-practice/practice-runner.service.ts:394-403`），但那里只写 `startedAt / finishedAt / ...fields`，**没有成本字段**。

### 后果

- `costAutoPractice` 恒为 0 → 用户看到的还是"看板空的"，只是这次是**有会话数、没成本**。
- 任务单验收标准 5.2（"三场 × 每场 totalCost × 7.2，数量级对得上"）**无法验收**——因为被乘的那个数不存在。
- 任务单 §4 硬约束"practice_sessions 的 totalCost 是美元，转人民币用固定汇率 7.2"是**建立在不存在的值上**。

### 修法（两条路，推荐第二条）

**路线 A：先补写入源（最小改动）**
在 runner 结算时把 token 与成本写进 `total_cost`。数据源现成：自动对练的每轮 trace 里已有 `llmUsage.promptTokens / completionTokens`（`src/admin-debug/debug-session.service.ts:290-296`）。工作量与 WP-D fix-list 的 **P2-1 预估一致（2h）**。

**路线 B（推荐）：统一到"元"，直接从 llmUsage 算**
不落美元，落**人民币**，口径与正式训练完全同源：
- 用**同一张** `LLM_PRICE_INPUT_PER_1K / LLM_PRICE_OUTPUT_PER_1K`；
- 用**同一个** `estimateSessionCost()`（`src/engine-adapters/observability/session-cost.ts`）；
- 于是 `costCny` 直接就是元，**汇率问题整个消失**。

代价是字段语义要改（`total_cost` 美元 → 新增 `total_cost_cny` 或改列注释），要写一条 migration（counselor 系 migration 一律手写 DDL，且真注册点是 `bin/ormconfig.ts`）。

---

## 2. P0-2 · `total_cost` 的币种/口径与正式训练不同源

### 事实

- 唯一定价表单位是**元 / 千 token**：`.env.example:395-396` → `LLM_PRICE_INPUT_PER_1K=0.0015`、`LLM_PRICE_OUTPUT_PER_1K=0.0045`；`src/admin-debug/cost-pricing.ts:28-31` 写明"别新增 `LLM_COST_*` 之类的平行键 —— 那就是**两张定价表**"。
- `estimateSessionCost()` 产出的 `estimatedCostCny` 也是**元**。
- 而 `total_cost` 注释明写"**美元**, 粗略估算"。

### 为什么这比"粗略 vs 精确"更危险

如果 `total_cost` 是用**同一套 token 单价**算出来的（很可能，因为仓库只有这一张表），那这个字段的真实含义是"**元**"，只是被标成了"美元"。这时读取端再 ×7.2：

> 真实成本 = 0.0015 元/千 token → 存成 0.0015（被当成美元） → 读出 0.0015 × 7.2 = 0.0108 元 = **实际成本的 7.2 倍**。

**这种错比"数字偏小"危险得多**：看板上的量级看着合理，没人会去质疑一个"看起来差不多"的数。而且现在没人写它，所以**这个语义歧义还没被固化，但也没有任何文档定义过它**——必须在写第一行代码之前把"total_cost 到底怎么算"定死。

### 我的建议

**直接把自动对练的成本算成人民币元，和正式训练同源同口径**（路线 B）。理由：

1. 消除汇率（少一个 env 键、少一处运维配置、少一处漂移源）；
2. 消除口径差（两个数可以直接相加、直接比大小、直接算均价）；
3. 复用既有 `estimateSessionCost()`，连 `costBasis`（`full / output_only`）都能一并产出——这是"口径写在数据里"的仓库纪律（`src/admin-debug/admin-debug.controller.ts:470-476`）要求的。

---

## 3. 待决策点 2 · 口径不一致要不要加"提示"？

### 答复：**不要靠"提示"掩盖，靠"同源"消除**

加一句"报告里提示口径差异"是**症状处理**：读者要么忽略它（那就等于没做），要么每次都要人工判读（那就等于把复杂度推给读表的人）。仓库既有纪律是**口径写进数据**，不是写进注释。

不过，**同源之后仍有一条真实的差异必须显式处理**，而且它比"粗略估算"重要得多：

> **自动对练里，AI 咨询师自己也要调 LLM（`CounselorAgentService`，`src/auto-practice/counselor-agent.service.ts`），这笔钱是真花了；但正式训练里咨询师是真人，这笔 LLM 成本不存在。**
>
> 所以即使两边都精确到元，自动对练的**单场成本天然高于**正式训练——因为它多跑了一整个"咨询师侧"的 LLM。

这意味着：

- 如果自动对练的成本**只统计来访侧** llmUsage（debug-session JSON 里每轮 trace 的 `llmUsage` 是引擎侧用量），它和正式训练是**可比**的（正式训练的留痕也是引擎侧）；
- 如果要把咨询师侧也算进去，才是"真实总花费"，但那就**不能直接和正式训练比大小**，需要一个独立的分字段。

**建议的字段设计**（把差异做成数据，不是注释）：

```ts
interface CostTrendPoint {
  date: string
  tokens: number              // 合计（formal + auto_practice）
  costCny: number             // 合计（元）
  sessions: number            // 合计场次
  sessionsFormal: number
  sessionsAutoPractice: number
  costFormal: number          // 元
  costAutoPractice: number    // 元
  tokensFormal: number        // ← 建议补：tokens 也分来源
  tokensAutoPractice: number  // ← 建议补
}
```

`tokens` 也分来源的理由：现有 `tokens` 来自留痕、`sessions` 来自会话表，**两者口径本来就不一样**（`src/admin-debug/cost-view.ts:158-168` 专门解释过）。合并两个来源后，"tokens 全是 0 但 sessions 不为 0"这个信号会更难解读——必须能一眼分清是哪个来源贡献的。

**"精确 vs 估算"这件事的正确落法**：如果最终仍保留一个"估算"字段（比如数据库里预存的 `total_cost`），那就在**每行**上带一个口径标记（例如 `costBasis: 'full' | 'output_only' | 'estimated'`），让前端能标"估算"。成本列表接口的 `costBasis` 字段本来就是干这个的（`admin-debug.controller.ts:470-476`：*"不带这个字段的话，读表的人会把'只算了输出侧'当成'全场就这么多'"*）。

---

## 4. 待决策点 3 · 两表 `started_at` 的时区一致吗？会落到不同天吗？

### 答复：**两表结构一致、同一环境内不会错天；真正的坑在跨环境写入**

### 事实

| 项 | training_sessions | ap_practice_sessions |
|---|---|---|
| 列类型 | `datetime` **nullable** | `DATETIME` **NOT NULL** |
| 定义位置 | `src/counselor/entities/training-session.entity.ts:300` | `src/migration/1714900000033-AddAutoPracticeTables.ts:80` |
| 软删 | 有 `deletedAt`（查询要 `IsNull()`） | **无**（审计数据，明确不软删） |

两列都是 MySQL `DATETIME`（**不带时区**），实体侧都是 `Date`。

### TypeORM 的实际行为（已读驱动源码核实）

- 写：`MysqlDriver.preparePersistentValue` 对 `datetime` 走 `DateUtils.mixedDateToDate(value)`（`node_modules/typeorm/driver/mysql/MysqlDriver.js:490-494`）→ mysql2 按**连接本地时区**把 `Date` 格式化成墙钟字符串；
- 读：`normalizeHydratedDate` → `new Date('YYYY-MM-DD HH:mm:ss')`，JS 把**无时区**字符串按**本地时区**解析。

→ **同一台机器上写读对称，绝对时刻是正确的**。服务器 TZ 是 UTC 还是 UTC+8 都不影响"这一场属于哪一天"的判断，因为读取端统一走 `shanghaiDateKey()`（`src/shared/time/shanghai-date.ts`，显式固定 UTC+8，与运行环境无关）。**这一层是稳的。**

### 真正的三个坑

1. **跨环境写入 → 8 小时错位，凌晨批次整批落到前一天。**
   `DATETIME` 存的是"本地墙钟"，不含时区信息。开发机（UTC+8）写入的行，被生产容器（常是 UTC）读出来 → 整体偏 8 小时。**灰度验证期恰恰是"本地跑对练 + 服务器看板上"**，这个组合会自然发生。而且错位只影响**本地墙钟 00:00–08:00** 的会话——正好是**批量对练最常跑的时间段**。同一批几十场会整齐地掉到前一天，用户看到"今天跑了 0 场，昨天跑了几十场"。

2. **偏差不可察觉。** 库里没有任何字段能告诉你这行是哪个时区写的，复制一次数据库偏差就固化下来，且没有任何信号。

3. **会话计数口径不对称。**
   - `training_sessions.started_at` 是 **nullable** → 现有 `buildCostTrend` 里 `if (!session.startedAt) continue`（`src/admin-debug/cost-view.ts:180-183`），**没有开场时刻的会话既不计 token 也不计 sessions**；
   - `ap_practice_sessions.started_at` 是 **NOT NULL** → 自动对练**没有这个洞**。
   - 于是"两边都是一场"的语义其实不等价。合并时必须**在两源上用同一套规则**（要么都算、要么都不算），否则分来源的 sessions 之和与总数对不上。
   - 另：ap 表**没有软删**，formal 表查询要 `deletedAt: IsNull()`——两源过滤条件天然不对称，这是表设计决定的，不是 bug，但要在交付记录里登记。

### 建议

- **写入侧显式按 UTC 墙钟写**（不依赖 `new Date()` 的隐式本地解释），或直接用 `timestamp`/带时区语义；
- 读取侧一律 `shanghaiDateKey()`，已经做到了；
- 在交付记录 §偏差 里**明写"本表 started_at 为 UTC 墙钟"**，避免下一个维护者按本地时间理解；
- **本条我建议登记为需要一条 migration**（ap 表加 `started_at_utc` 或统一改语义），但可以放到下一期，本期至少要在代码注释里锁死口径。

---

## 5. 待决策点 1 · 汇率写死还是 env？WP25 守卫会不会挂？

### 先纠正一个前提：**当前任务单把汇率当成了必需项，但按推荐路线它根本不需要**

若走 §1 的路线 B（自动对练成本直接算成元、用同一张定价表），**没有美元就没有换算，本期不需要任何汇率常量，更不需要新 env 键**。这是最优解：**少一个 env 键 = 少一处运维配置 = 少一处漂移源**，与仓库"定价只有一份"纪律同款。

### 如果最终仍要保留"美元字段 + 读取端换算"

**回答你的问题：新增 env 键不会天然触发 WP25 失败——但只做一半必挂。**

WP25 守卫（`test/config/wp25-env-example-coverage.spec.ts:657-667`）是**双向**的：

| 断言 | 内容 | 只加一边会怎样 |
|---|---|---|
| ① | 代码里读的每个 env 键，`.env.example` 必须有**生效行** | 只改代码不改进模板 → **红** |
| ② | `.env.example` 每个生效行，代码里必须有读取点 | 只改模板不改代码 → **红**（"配了也不生效"） |

所以**两边同时加，测试不会挂**。具体要改的地方（缺一不可）：

1. **代码读取点**：必须是 AST 能抽到的形态 —— `config.get('FX_USD_CNY_RATE')` 直接传字符串字面量，或 `export const FX_RATE_ENV_KEY = 'FX_USD_CNY_RATE'` 常量再传常量（守卫的 `CONST_LITERALS` 机制会解析常量）；**不能**藏在拼接字符串里。
2. **`.env.example` 加生效行**（不是注释行——注释行不算契约）。
3. **`typings/global.d.ts` 声明该键**（仓库惯例，如 `AUTO_PRACTICE_COUNSELOR_MODEL` 在 `typings/global.d.ts:388-392`），否则 TS 下 `config.get` 拿不到类型。
4. 非法值处理要跟现有定价 env **同款**：**回退默认、不抛错**（见 `resolveSessionCostPricing` 与 `test/admin-debug/wp31-cost-board.spec.ts:343` 对 `'abc'` / `'-1'` 的断言）。

### 但更该问的是：**汇率该不该做成 env？**

从工程纪律看，**读取端乘一个可变汇率是有问题的**：

> 汇率是随时间变的。如果读取端每次都乘"当下的汇率"，那**同一批历史数据的成本会随汇率波动**——上月写的场次，今天读出来的金额和上周读出来的不一样。成本看板要能对账、要比预算、要复盘，这个"数字会自己变"的性质比"汇率写死"糟糕得多。

所以正确的位置是**写入侧换算 + 存快照**：落库时把当时的汇率一起存下来（或落库时就算成人民币），历史数据从此**不随汇率漂移**。这正好也是路线 B 的做法。

**结论**：

- 本期（路线 B）：**不引汇率键**，一字不提。
- 若将来确有跨币种需求：换算在**写入侧**做，库里存金额 + 当时的汇率快照；env 只用来配"下一次写入用哪个汇率"，**不参与读取期换算**。

---

## 6. 方案没覆盖到的其他坑（清单）

### P1 · 会越权：自动对练没有归属，但看板有学员隔离

`buildOwnerFilter`（`src/admin-debug/admin-scope.ts`）的语义是：**带管理员 basic 凭据 → 不过滤；学员 → 只看 `user_id = 自己`；匿名 → 不过滤**。而 `ap_practice_sessions` 表**根本没有 userId 归属**（自动对练是运维批量跑的）。

→ 合并时若无条件把自动对练并进去，**学员会看到别人的自动对练数据**（角色 slug、批次 id、成本）。这在隐私边界上是一条真越权，任务单完全没提。

**必须显式决策**：建议**学员身份的请求完全不含自动对练源**；只有管理员 basic 凭据能看到自动对练。（另注：`admin-scope.ts` 自己也写了"用 admin 账号 JWT 登录调试器时，看板只统计他自己的会话"——这一层口径不要动，动了就是越权。）

### P1 · `limit` 语义会吃掉一整个来源

"两张表混合按时间倒序取前 N"——一次跑 30 场自动对练，`limit=20` 的会话列表会**全是自动对练**，正式训练一条不剩。

**建议**：每源先按 `startedAt` 各取 N，合并后再排序 → 返回最多 2N 行；或明确"总数上限 N，但注明可能偏向某一源"。这需要写进接口契约和交付记录。

### P1 · 扫描上限是**每源一次** 2000

`COST_TREND_SCAN_LIMIT = 2000`（`admin-debug.controller.ts:139`）。两源各查一次、各自截断，**总量最多 4000**，且两源分别按"最近的优先"截断——同一天里挤掉的可能整段是某一源。趋势接口的截断行为要在响应或交付记录里说明（现有正式源的做法是"登记在交付记录"）。

### P1 · 失败/取消/进行中的场次算不算？

ap 表有 6 种状态（`running / completed / crisis_ended / stagnant / failed / canceled`）。**`failed` 的场次也花了钱**（跑了几轮才报错），`running` 的场次钱已经花了一半。

建议：**成本照算**（钱花了就是花了），**但 sessions 计数是否含 failed/canceled 要单独定义**，否则"均价"的分母口径不清。

### P2 · `totalTokens=0` 会让前端的"留痕没开"提示误判

`CostBoard.vue` 用 `totalTokens === 0` 判断"多半是留痕没开"（`admin-dashboard/src/views/CostBoard.vue:40-42`）。合并后如果自动对练 tokens 先填 0 而 sessions 不为 0，这个信号会变得**误导**。这也是为什么我建议 tokens 一定做出来（§3），而不是留 0。

### P2 · 前端契约：这期到底包不包含前端

`CostBoard.vue` 现在只有 4 张汇总卡片 + 一个表格。任务单 §6 明确"前端趋势图改分组柱状图不在本期范围"，但**"每条能区分来源"必须前端加标签**才成立——如果本期前端不动，验收标准 5.1 的第 3 条（"会话列表里每条都有来源标签"）就无法验收。

**需要跟大炮确认边界**：本期是"后端出契约、前端另派"，还是本单一并改前端？（AGENTS.md 说 admin-dashboard 由另一个 AI 管，所以更可能是前者——那就必须把验收标准改成"接口返回 source 字段"，否则是个填不满的坑。）

### P2 · 表名歧义：仓库里有**两张** practice session 表

- `practice_sessions` —— **用户端自由练习**（`src/practice/entities/practice-session.entity.ts:16`），有 `uid`、`tool_key`、`started_at`，**无任何 token/成本列**；
- `ap_practice_sessions` —— **自动对练**（`src/auto-practice/`），有 `total_cost`。

任务单说的是后者（表格里写的 `ap_practice_sessions`），你的描述里写的是"practice_sessions（自动对练场次）"——实现时**别把两张表搞混**。另外顺带确认一下：**用户端自由练习要不要也进看板？** 它没有成本字段，要进得先补 token 统计（且触发"自由练习无分数"零压红线的边界讨论）。建议本期**不做**，另开。

### P2 · 隐私

debug-session JSON 里含**对话原文 + prompt 全文**。从 JSON 补算成本时**只取 `llmUsage` 里的数字**，绝不进日志、绝不进响应体（AGENTS.md §5.4）。现有的 `cost-view.ts` 就是这么做的（只读 `llmUsage`），沿用即可。

### P2 · 改纯层函数签名会撞现有测试

若把 `buildCostTrend(sessions, pricing, days, now)` 改成吃"统一行模型"，`test/admin-debug/wp31-cost-board.spec.ts`（1252 例里的一部分）会红。**建议新增函数而不是改签名**（见 §7）。

---

## 7. 更优雅的合并方式（你的第 3 问）

### 明确不建议的两条路

**❌ 在 controller 里拼 SQL / 直接 UNION 两张表。**
- 两张表 schema 差异大（软删有无、金额单位、成本来源不同），UNION 出来的是一堆 `CASE WHEN`；
- 口径换算（币种、成本口径、tokens 补算）会散在 SQL 里，**没法单测**，也没法跟现有 `test/admin-debug/wp31-cost-board.spec.ts` 的纯函数测试对齐；
- 仓库现有分层（`cost-view.ts` 纯函数 + controller 做 IO）会被破坏。

**❌ 建 MySQL VIEW。**
- DB 不知道 `LLM_PRICE_*`、不知道汇率、不知道 `costBasis` 口径——这些是**应用层口径**，写进视图等于把口径钉死在 SQL 里，且不可单测、不可复用；
- 视图跨两张异构表 + 还要套 `turn_debug_trace` 的 JSON 聚合，MySQL 侧做这个会很脏；
- 视图还会绕过 TypeORM 的实体层，破坏"软删手写 `IsNull()`"这类既有约定。

### ✅ 推荐：沿用仓库既有分层，加一层"来源适配器"

仓库已经有一套**非常清晰**的分层范式，照它扩就对了：

| 层 | 现有 | WP-F 该怎么扩 |
|---|---|---|
| **纯函数层**（零 Nest / 零 IO / 零 env） | `src/admin-debug/cost-view.ts`：`aggregateSessionCost()`、`buildCostTrend()` | 新增**统一行模型** `CostSourceSession` + 一个吃统一模型的 `buildMergedCostTrend()` / `buildMergedSessionList()` |
| **口径/配置层** | `src/admin-debug/cost-pricing.ts`：env → 单价唯一映射 | 汇率（若需要）在这里加，**唯一一份** |
| **适配层**（做 IO，产出行模型） | controller 里直接查库 | 新增两个 provider：`FormalCostSource`（查 training_sessions + 解析留痕）、`AutoPracticeCostSource`（查 ap_practice_sessions + 取 token/成本） |
| **controller** | 调 `buildCostTrend` | 只做"取两个源的行 → 交给纯函数合并 → 返回"，**不含任何口径逻辑** |

统一行模型草案（放纯层，零 IO）：

```ts
export type CostSourceKind = 'formal' | 'auto_practice';

export interface CostSourceSession {
  readonly source: CostSourceKind;
  readonly sessionId: string;
  readonly startedAt: Date | null;
  readonly visitorAlias: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly reasoningTokens: number;
  readonly costCny: number;
  readonly costBasis: SessionCostBasis;
  /** 自动对练特有：咨询师模式 / 角色 / 批次。 */
  readonly characterSlug?: string | null;
  readonly counselorModeId?: string | null;
  readonly batchId?: string | null;
}
```

这样做的收益：

1. **口径只写一份**：成本换算、`costBasis` 判定、tokens 补算全在适配层/纯层，controller 里没有一行 `× 7.2`；
2. **可单测**：合并逻辑是纯函数，测起来不需要 DB；
3. **可扩展**：将来加第三个来源（比如用户端自由练习），只需再加一个 provider，**controller 和前端契约一行不改**——这正是任务单 §6 提到的"前端后面再优化"能低成本兑现的原因；
4. **不碰 engine-core**（全在 `src/admin-debug/` 与 `src/auto-practice/`），红线安全。

### 落地时的两个纪律

- **新增函数，不改现有函数签名**（保护 `wp31-cost-board.spec.ts`）；旧的 `buildCostTrend` 保留或内部转调新函数。
- **不引入 DI 装饰器 / `@Global` 注册表**：仓库那条"agent 与 business 之间只走 `@Global` 注册表"是针对 agent 层的，普通 provider 用构造函数注入即可，别过度设计。

---

## 8. 建议的落地顺序

```
Step 0  修 WP-D 的 P2-1：让自动对练的成本/token 真的有值
        （runner 结算时落库，用同一张定价表算成"元"；顺带补 modelVersion / seedValue）
        → 不做这步，WP-F 做出来也是 0

Step 1  （可选）用 debug-session JSON 做一次离线核对
        ⚠️ 只能当临时手段：JSON 只保留最近 50 个文件（MAX_DEBUG_SESSIONS=50，
        src/admin-debug/debug-session-store.ts:141），且只在**本机磁盘**，
        多实例部署下别的实例读不到 → 不可作为长期数据源，更不可作为看板在线计算源

Step 2  做 WP-F 合并：统一行模型 + 两个 provider + 纯函数合并 + controller 接线
Step 3  前端（另一个 AI）：CostBoard.vue 加来源标签 / 分来源卡片
Step 4  补测试：test/admin-debug/wp-f-cost-board-merge.spec.ts
        （覆盖：两源混合排序、limit 语义、口径标记、学员隔离）
```

**特别强调 Step 0 与 Step 2 的依赖**：先合并看板、后补数据源，等于交付一个"有会话数、没成本"的看板——那正是用户一开始抱怨的状态。

---

## 9. 交付记录必须登记的偏差（建议清单）

1. `ap_practice_sessions.total_cost` 原声明"美元" → 实际口径改为"元"，字段语义变更 + migration；
2. `training_sessions.started_at` nullable vs `ap_practice_sessions.started_at` NOT NULL → 两源 sessions 计数规则的统一处理；
3. ap 表无软删、formal 表需 `deletedAt: IsNull()` → 过滤条件不对称；
4. 趋势扫描上限 2000 是**每源一次**；
5. 自动对练**咨询师侧 LLM 成本**是否计入、以及它与正式训练不可直接比大小；
6. `tokens` 与 `sessions` 来源不同（留痕 vs 表），合并后该信号怎么解读；
7. 学员身份请求**不含**自动对练源（若采纳我的建议）。

---

## 10. 需要大炮拍板的 3 件事

1. **本期是否含前端**？若不含，验收标准 5.1 第 3 条要改成"接口返回 `source` 字段"，否则是个填不满的坑。
2. **`failed / canceled / running` 的自动对练场次算不算 sessions？**（成本我建议照算）
3. **是否接受"先补数据源（Step 0）、再做看板（Step 2）"的顺序**？还是坚持本期只做看板（那自动对练成本这一期必然是 0，需要提前跟用户说清楚）。

---

## 附 · 证据索引

| 结论 | 证据位置 |
|---|---|
| `total_cost` 恒 null、无写入点 | `src/auto-practice/entities/practice-session.entity.ts:149-151`；`src/migration/1714900000033-AddAutoPracticeTables.ts:78`；`docs/worklog/completed/phase2.5/phase2.5-wp-d-auto-practice-2026-11-09-test-report.md:105,213` |
| runner 结算点（缺成本写入） | `src/auto-practice/practice-runner.service.ts:394-403` |
| 定价表单位为"元/千 token"、唯一映射 | `.env.example:395-396`；`src/admin-debug/cost-pricing.ts:28-31` |
| 成本计算同款函数 | `src/engine-adapters/observability/session-cost.ts`（`estimateSessionCost`） |
| 两表 `started_at` 列定义 | `src/counselor/entities/training-session.entity.ts:300`；`src/migration/1714900000033-AddAutoPracticeTables.ts:80` |
| TypeORM datetime 读写行为 | `node_modules/typeorm/driver/mysql/MysqlDriver.js:490-494`；`node_modules/typeorm/util/DateUtils.js:18-24` |
| 上海日界统一口径 | `src/shared/time/shanghai-date.ts`（`shanghaiDateKey`） |
| 趋势函数的 null 处理与"补齐无数据天" | `src/admin-debug/cost-view.ts:180-183,196-215` |
| 现有成本端点实现 | `src/admin-debug/admin-debug.controller.ts:446-498` |
| 扫描上限 2000 | `src/admin-debug/admin-debug.controller.ts:139` |
| 学员隔离口径 | `src/admin-debug/admin-scope.ts`（`buildOwnerFilter`） |
| WP25 双向守卫断言①② | `test/config/wp25-env-example-coverage.spec.ts:657-667` |
| env 键类型声明惯例 | `typings/global.d.ts:388-392` |
| debug-session JSON 结构与 llmUsage | `src/admin-debug/debug-session.service.ts:290-296`；`src/admin-debug/debug-session-store.ts:74-111` |
| debug-session 只保留 50 个文件 | `src/admin-debug/debug-session-store.ts:141` |
| 用户端自由练习表（另一张表，无成本列） | `src/practice/entities/practice-session.entity.ts:16,21-45` |
| 前端 tokens=0 误判提示 | `admin-dashboard/src/views/CostBoard.vue:40-42` |
| WP-F 任务单本体 | `docs/worklog/pending/phase2.5-wp-f-cost-board-merge-sources.md` |

---

_本轮只读代码与文档，未改动任何生产代码。engine-core 零改动。_
