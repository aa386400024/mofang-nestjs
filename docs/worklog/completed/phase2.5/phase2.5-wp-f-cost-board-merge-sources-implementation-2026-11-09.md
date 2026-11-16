# WP-F 交付记录：成本看板合并数据源（正式训练 + 自动对练）

> **任务单**：[phase2.5-wp-f-cost-board-merge-sources.md](phase2.5-wp-f-cost-board-merge-sources.md)
> **交付日期**：2026-11-09
> **状态**：✅ 已交付
> **红线**：engine-core 零改动（`git diff --stat HEAD -- src/engine-core` = 空）；不搞美元字段 / 不搞汇率；学员请求不含自动对练源；心理内容不进日志 / 响应体

---

## 一、本单做了什么（一句话）

**两步落地**：

- **Step 0（补数据源）**：自动对练 runner 结算时把 token / 成本 / 成本口径写进 `ap_practice_sessions`
  （`total_tokens` / `total_cost_cny`（元）/ `cost_basis`），成本用**同一张定价表 + 同一个 `estimateSessionCost()`** 现算 ——
  不搞美元字段、不搞汇率。
- **Step 2（合并看板）**：`GET /admin/api/cost/trend` 与 `GET /admin/api/cost/sessions` 合并 `training_sessions` +
  `ap_practice_sessions` 两张表，趋势行给**合计 + 分来源**两套数字，会话列表每行带 `source`。

**架构形态**：纯函数层（`cost-view.ts` 新增合并函数）→ 来源适配器层（两个 provider 各自做 IO、产出统一行模型）→
controller 只做「取两个源的行 → 交给纯函数合并 → 返回」，**不拼 SQL / 不 UNION / 不建 MySQL VIEW**。

---

## 二、改了哪些文件

### 2.1 新增（7 个）

| 文件 | 作用 |
|---|---|
| `src/admin-debug/cost-source.formal.ts` | 来源适配器 · 正式训练：查 `training_sessions`，成本从留痕 `llmUsage` 现算 |
| `src/admin-debug/cost-source.auto-practice.ts` | 来源适配器 · 自动对练：查 `ap_practice_sessions`，成本读 Step 0 落库的列 |
| `src/migration/1714900000037-AddPracticeSessionCostColumns.ts` | 手写幂等 DDL：6 个新列 + 旧列 `total_cost` 注释改「已废弃」 |
| `test/admin-debug/wp-f-cost-board-merge.spec.ts` | 合并口径单测（趋势分来源 / 计数规则 / limit 语义 / 学员隔离 / 纯函数层） |
| `test/auto-practice/practice-runner-cost.spec.ts` | runner 成本落库单测（落库值 / 定价表 / failed 也落库 / 无用量不编造） |
| `docs/worklog/completed/phase2.5/phase2.5-wp-f-cost-board-merge-sources-implementation-2026-11-09.md` | 本交付记录 |
| `docs/worklog/pending/relay-response-20261109-wpf-implement.md` | 本次回复原文（按大炮的回复输出约定） |

### 2.2 修改（6 个）

| 文件 | 改了什么 |
|---|---|
| `src/admin-debug/cost-view.ts` | **新增** WP-F 段落：`CostSourceKind` / `MergedCostBasis` / `CostSourceSession` / `MergedCostTrendPoint` / `MergedSessionCost` / `buildMergedCostTrend()` / `buildMergedSessionList()` / `readTraces()`（从 controller 搬到纯函数层）。**既有函数签名一个没动**（`aggregateSessionCost` / `buildCostTrend` 原样保留） |
| `src/admin-debug/admin-debug.controller.ts` | 两个成本端点改为合并两源；新增 `collectCostRows()` / `formalSource()` / `autoPracticeRows()` / `canSeeAutoPractice()` 私有编排方法；构造参数追加两个**可选**来源 provider |
| `src/admin-debug/admin-debug.module.ts` | 注册 `FormalCostSource` / `AutoPracticeCostSource` 两个 provider + `TypeOrmModule.forFeature([... PracticeSession])` |
| `src/auto-practice/entities/practice-session.entity.ts` | 新增 6 列（4 个 token + `total_cost_cny` + `cost_basis`）；旧列 `total_cost` 标注「已废弃」 |
| `src/auto-practice/practice-runner.service.ts` | 循环里按轮累加 `trace.llmUsage`；结算时算成本并随终态一起落库；`ConfigService` 可选注入（读 `LLM_PRICE_*`） |
| `src/migration/index.ts` + `bin/ormconfig.ts` | 迁移 `1714900000037` 两处**严格 1:1** 登记（import + `migrations[]`） |

### 2.3 明确没碰

- `src/engine-core/**` —— 零改动（闸门见 §四）。
- `admin-dashboard/**` —— 前端是另一个 AI 的地盘，本单**只出后端契约**（前端待补项见 §五·偏差 9）。
- `test/admin-debug/wp31-cost-board.spec.ts` —— 受保护回归，**一个字没改**，全绿（见 §四）。
- `src/admin-debug/cost-pricing.ts` —— 定价 env 映射**原地不动**（见 §三·决策 5）。

---

## 三、关键设计决策

### 决策 1：来源适配器分层（任务单 §5）

```
纯函数层    cost-view.ts                 buildMergedCostTrend() / buildMergedSessionList()  ← 合并口径只有这一份
   ↑
适配层      cost-source.formal.ts        查 training_sessions     → CostSourceSession[]
            cost-source.auto-practice.ts 查 ap_practice_sessions → CostSourceSession[]
   ↑
controller  admin-debug.controller.ts     只做「取两源的行 → 交给纯函数 → 返回」
```

**为什么两边要归一成同一个行模型 `CostSourceSession`**：合并的口径（按天分桶 / 排序 / 计数规则）必须只有一份实现。
两张表各算一遍，两边迟早漂 —— 而漂的是「这个数字算不算钱」，不是显示问题。

### 决策 2：sessions 计数与成本**刻意拆成两个字段**

`CostSourceSession.countsAsSession` 与 `costCny` 不联动：

- **成本照算**：failed / running / canceled 的场次照样花钱 → 成本照记；
- **sessions 只算跑成的**：自动对练只认 `completed` / `crisis_ended` / `stagnant`；
- 正式训练**窗口内每一场都算一次会话**（与 WP31 既有口径一致，本单不改）。

两者的差额 = 「花了钱但没跑成」的场次 —— 这正是看板要让人看见的东西。把「该不该计一次会话」
这个业务判断混进成本数字，成本就会被业务规则污染。

### 决策 3：自动对练的成本 = **跑时定价快照**，正式训练 = **读时按当前 env 重算**

- Step 0 按任务单要求把成本**落库**（`total_cost_cny`），看板读它 —— 这是「补数据源」这一步的意义所在；
- 正式训练没有快照列，成本只能读时算（`aggregateSessionCost`）。

**代价**：改了 `LLM_PRICE_*` 之后，历史的自动对练金额**不跟着变**，正式训练的历史金额**会跟着变**。
登记在 §五·偏差 8。这条差异是「落库」这个要求自带的，不是实现偷懒 —— 真要抹平，只能改成
「看板两源都按当前 env 从 token 重算」，那样落库的成本列就变成纯审计快照（本期不做，留给大炮决策）。

### 决策 4：学员隔离落在 **controller 层**，不是数据层

`canSeeAutoPractice(req)` = `req.adminBasicAuth === true`。学员请求**连自动对练表都不查**
（单测断言 `practiceRepo.findCalls` 长度为 0）—— 不只是「查了但过滤掉」，是根本不查。

理由：自动对练**没有 userId 归属**，任何按 userId 的过滤都无从谈起；只要查出来就有泄漏风险，
而学员看板上多出来的自动对练数字，对学员毫无意义。
### 决策 5：定价表**原地不动**（`src/admin-debug/cost-pricing.ts`）

runner 要读单价，理论上可以把 env 映射搬到 `engine-adapters/observability/` 与 `session-cost.ts` 做邻居。
**没搬**，理由：

- 搬了要改两个 controller 的 import，还要让历史文档里的路径全部失效；
- `auto-practice` 早就依赖 `admin-debug`（`AdminBasicAuthMiddleware` / `AdminRoleGuard` / `DebugSessionService`），
  再多一个 `cost-pricing.js` 不新增依赖方向；
- 「定价表只有一份」这条纪律靠的是**引用同一个函数**，不是靠文件放在哪个目录。

### 决策 6：迁移只加列、**不 DROP 旧列**

`total_cost`（声明「美元」）全仓零写入点、恒 NULL。本单把它的 **DB 注释**改成「已废弃：恒 NULL；
成本统一读 `total_cost_cny`（人民币元）」，但**不删列** —— schema 的不可逆变更留给大炮在维护窗口自己决定。
实体里也标注了「不再读写」。

### 决策 7：历史场次（WP-F 之前跑的）口径 = `estimated`

自动对练那些行 `total_cost_cny IS NULL` → 成本 0、口径 `estimated`。`estimated` 是**第三种口径**：
既不是「输入输出都计」，也不是「只算了输出侧」，而是「**这个数没有口径背书**」。
读表的人看到 `estimated` 就该知道：这不是「这场免费」，是「这场没数据」。

### 决策 8：controller 的两个来源 provider 用 `@Optional()` 注入

受保护回归 `wp31-cost-board.spec.ts` 直接 `new AdminDebugController(4 个参数)`，必填构造参数会让那份 spec 编译不过。
因此：

- 构造参数声明为**可选**（`@Optional()`，不引 DI 装饰器 token，不用 `@Global` 注册表 —— 遵守任务单 §5「普通 provider 构造函数注入」）；
- `formalSource()` 在 provider 缺失时**用同一个 `FormalCostSource` 类**本地兜底（不是复制一份查询逻辑）；
- `autoPracticeRows()` 在 provider 缺失时返回空并**告警一次**（不静默 ——「看板悄悄少一个源」比报错更危险）。

生产环境 `AdminDebugModule` 注册了这两个 provider，兜底路径只在单测里生效。

### 决策 9：模块不互相 import（防循环依赖）

`AdminDebugModule` **只**用 `TypeOrmModule.forFeature([PracticeSession])` 注册实体，
**不 import `AutoPracticeModule`** —— 后者 → `AdminDebugChatModule` → … → `AdminDebugModule`，import 回去就成环。
看板只需要「读这张表」，实体注册不是模块依赖。

---

## 四、闸门数字

| 闸门 | 命令 | 结果 |
|---|---|---|
| ESLint | `npx eslint --cache "{src,test,bin}/**/*.ts"` | ✅ **0 error / 0 warning** |
| TypeScript | `npx tsc -p tsconfig.build.json --noEmit` | ✅ **0 error** |
| 单测（全量） | `npx vitest run --exclude "**/e2e/**/*.ts"` | ✅ **147 个文件 passed + 1 skipped（148）/ 2483 例 passed + 4 skipped（2487）**，exit 0 |
| engine-core 红线 | `git diff --stat HEAD -- src/engine-core` | ✅ **空**（零改动） |

**受保护回归**：`test/admin-debug/wp31-cost-board.spec.ts`（14 例）**未修改任何一行**，随全量一起全绿 ——
既有正式训练口径零回归。

**本单新增用例**：

- `test/admin-debug/wp-f-cost-board-merge.spec.ts`（8 例）：趋势总量与分来源字段、failed/canceled 成本照算但不计 session、
  历史场次 `estimated` 口径、两源混合排序 + `source` 字段、limit 语义（每源 N → 合并 2N）、学员隔离（连表都不查）、
  纯函数层补 0 与「无开场时刻排最后」。
- `test/auto-practice/practice-runner-cost.spec.ts`（4 例）：token/成本/口径落库、单价走 `LLM_PRICE_*`、
  failed 也落库已花的钱、没有用量记录 → 0 token / 0 成本 / `output_only`（不编造）。
---

## 五、与任务单的偏差及理由

任务单 §9 要求登记 7 条，实际登记 9 条（7 条逐条对应 + 2 条新增）：

| # | 偏差 | 怎么处理的 |
|---|---|---|
| 1 | `ap_practice_sessions.total_cost` 原声明「美元」 | **新增 `total_cost_cny`（元）为唯一权威成本字段**；旧列**不删**，但 DB 注释改成「已废弃：恒 NULL；成本统一读 total_cost_cny（元）」，实体标注不再读写。（任务单允许二选一，本单选「新增列」+「注释废弃」） |
| 2 | `training_sessions.started_at` 可空 vs `ap_practice_sessions.started_at` NOT NULL | 两源**共用同一个归一行模型**（`startedAt` 可空）。可空的那条落不进任何一天 → 趋势里不计（不硬塞「今天」、不编日期）；列表里**排最后**（放最前会让人以为「这是最新的一场」）。 |
| 3 | ap 表无软删、formal 表需 `deletedAt: IsNull()` | 过滤条件**不对称且如实**：formal 源查 `deletedAt: IsNull()`（软删即无），AP 源不查（该表本来就不做软删，删场次等于让批量统计凭空少一场）。 |
| 4 | 趋势扫描上限 2000 | **每源一次 2000**，总量最多 4000 行参与分桶；`limit` 端点同理（每源各取 N，合并最多 2N）。 |
| 5 | 咨询师侧 LLM 成本是否计入 | **本期只算引擎侧**（`trace.llmUsage`）：`CounselorAgentService.generate()` 只返回 text / model / degraded / closeRequested，**不返回 usage** —— 咨询师侧成本当前不可得，与任务单 §8 一致。⚠️ 因此自动对练金额**只含来访者侧渲染成本**，与正式训练（同样只含引擎侧）可比，但**不等于这场对练的真实总花费**（差一个咨询师 LLM）。 |
| 6 | 学员身份请求不含自动对练源 | 落在 controller 层：`canSeeAutoPractice()` = `adminBasicAuth === true`。学员请求**连自动对练表都不查**（单测断言查询次数为 0）。 |
| 7 | limit 语义：每源先取 N，合并后最多 2N 行 | 已实现：两个来源各 `take: n`，合并后排序，**不二次截断**。 |
| 8 | **（新增）自动对练成本是跑时定价快照，正式训练是读时重算** | 改 `LLM_PRICE_*` 后两边历史金额的漂移方式不同（见 §三·决策 3）。本期按任务单「落库」要求实现；若大炮要求两边完全同口径，改法是「看板两源都从 token 按当前 env 重算」，落库列退化为审计快照。 |
| 9 | **（新增）前端类型缺 3 处字段** | 后端已按任务单 §4.1 / §4.2 返回 `tokensFormal` / `tokensAutoPractice` 与 `costBasis: 'estimated'`，但 `admin-dashboard/src/api/types.ts` 的 `CostTrendPoint` **没有** `tokensFormal?` / `tokensAutoPractice?`，`SessionCost.costBasis` 的联合类型**只有** `'full'` 与 `'output_only'`（缺 `'estimated'`）。本单**不改前端**（另一个 AI 的地盘），已登记为前端待补项，见 §六。 |
---

## 六、大炮要做的事

### 6.1 必须做（部署顺序）

1. **先跑迁移，再起服务**：`pnpm migration:run`

   迁移 `1714900000037` 给 `ap_practice_sessions` 加 6 列（4 个 token + `total_cost_cny` + `cost_basis`），
   并把旧列 `total_cost` 的注释改成「已废弃」。**漏跑迁移 = runner 结算写列直接报错**。

2. **前端补 3 处类型**（本单只出后端契约，`admin-dashboard` 由另一个 AI 负责）：

   - `admin-dashboard/src/api/types.ts` → `CostTrendPoint` 加 `tokensFormal?: number` / `tokensAutoPractice?: number`；
   - `admin-dashboard/src/api/types.ts` → `SessionCost.costBasis` 联合类型加上 `'estimated'`；
   - （建议）前端把 `costBasis === 'estimated'` 显示成「无口径记录」而不是「免费」。

3. **跑一场自动对练验收**（任务单 §7 验收 ①）：

   ```sql
   SELECT id, status, total_tokens, total_cost_cny, cost_basis
   FROM ap_practice_sessions ORDER BY created_at DESC LIMIT 5;
   ```

   预期：`total_tokens > 0`、`total_cost_cny` 有值、`cost_basis = 'full'`。数量级应与同轮正式训练对得上。

### 6.2 建议做（可选）

- 确认 `LLM_PRICE_INPUT_PER_1K` / `LLM_PRICE_OUTPUT_PER_1K` 是当前真实单价 —— 自动对练的落库金额是**跑时快照**，
  配错了要改 env + 重跑（历史行不会自动改）。
- 如需清理历史死列 `total_cost`，在维护窗口手工 `ALTER TABLE ap_practice_sessions DROP COLUMN total_cost;`
  （本单刻意没做不可逆变更）。

---

## 七、commit message 草稿

```
feat(wp-f): 成本看板合并两个数据源 — 自动对练成本/token 落库 + 两表合并趋势与会话列表
```

---

_创建：2026-11-09 · 交付人：MCode（MiniMax Code）· 状态：✅ 已交付_
