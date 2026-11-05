# WP31 · 成本看板与告警（切真 API）· 交付记录

> 任务单：[`wp31-cost-board-alert-2026-11-05.md`](wp31-cost-board-alert-2026-11-05.md)（已随本记录移入 `completed/phase2/`）
> 交付日期：2026-11-05
> 边界：**engine-core 零改动**（`git diff --stat HEAD -- src/engine-core` = 空）· 心理内容**不进日志** · 所有端点走 admin 鉴权 · **不自动 commit/push**

---

## 一、交付摘要

把 admin-dashboard 的 **CostBoard（成本看板）** 页面从 mock 数据切到真 API：

| 端点 | 作用 | 返回 |
|---|---|---|
| `GET /admin/api/cost/trend?days=7` | 成本趋势（按天聚合） | `[{ date, tokens, costCny, sessions }]`，行数恒等于 `days`（缺数据的天补 0） |
| `GET /admin/api/cost/sessions?limit=20` | 会话成本列表 | `[{ sessionId, visitorAlias, startedAt, totalTokens, costCny, **costBasis** }]` |

前端同步切掉 2 处 mock + **修掉一个"看板永远显示 0"的真 bug**（汇总卡片与折线图原来是在 setup 里求值一次的常量，数据异步到达后不会重算）。

**关键取舍**（详见 §三 偏差表）：

- **定价复用 WP24 已有的 env 与口径** —— 不新增 `LLM_COST_PER_1K_*` 键，也不用任务单建议的新默认值。仓库里早有 `LLM_PRICE_INPUT_PER_1K` / `LLM_PRICE_OUTPUT_PER_1K`（`.env.example` 404–405 行）与 `estimateSessionCost()`，看板直接用 —— **看板上的数和单场成本日志里的数必须对得上**，两张定价表迟早漂。
- **口径写在数据里** —— 每行带 `costBasis`（`full` / `output_only`）。上游没报输入侧用量时成本只是**下界**，不带这个字段的话读表的人会把"只算了输出侧"当成"全场就这么多"。
- **按天分桶用 Asia/Shanghai 固定 UTC+8** —— 不用 UTC（北京 08:00 前的场会被切到前一天），也不用服务器本地时区（本地机与生产容器边界不同 → 同一批数据落进不同的天）。
- **`sessions` 与 `tokens` 来源不同** —— 场次来自会话表（不受留痕开关影响），token / 成本来自留痕（留痕关就为 0）。于是留痕关着时看到"有场次但 0 token"，那正是留痕关了的信号。

---

## 二、文件清单

### 新增（2 个）

| 文件 | 行数量级 | 用途 |
|---|---|---|
| `src/admin-debug/cost-view.ts` | ~250 | 纯函数：会话成本聚合（token / 费用 / **口径**）+ 按天趋势 + Asia/Shanghai 分桶 |
| `test/admin-debug/wp31-cost-board.spec.ts` | ~410 | 16 例单测（趋势 / 列表 / 定价 env / 纯函数口径 / 守卫继承） |

### 修改（后端 3 个）

| 文件 | 改什么 |
|---|---|
| `src/admin-debug/admin-debug.controller.ts` | 加 2 个 GET 端点 + `resolveCostPricing()`（读 env）+ `clampInt()`（非法参数回退，不把 NaN 传下去） |
| `src/engine-adapters/observability/session-cost.ts` | `roundCost` 由 private 改 **export**（看板按天相加多场成本时尾数同样要定点）+ 文件头补 WP31 复用说明 |
| `test/admin-debug/wp26-admin-role-guard.spec.ts` | 端点清单断言 8 条 → 10 条（新增 2 个端点自动继承 class 级 `AdminRoleGuard`） |

### 修改（前端 5 个）

| 文件 | 改什么 |
|---|---|
| `admin-dashboard/src/api/client.ts` | `costTrend()` / `sessionCosts()` 2 处 mock → 真 fetch（带 `days` / `limit` 参数） |
| `admin-dashboard/src/api/types.ts` | `SessionCost.tokens` → **`totalTokens`**（与既有 `/admin/api/sessions` 同名同义）+ 新增 `costBasis`；`startedAt` 改可空 |
| `admin-dashboard/src/views/CostBoard.vue` | **汇总卡片与折线图改 `computed`**（原来求值一次，永远显示 0）+ 空状态重写（删掉"Pending: WP24 成本聚合 API"）+ 表格列 key 改 `totalTokens` + 新增"口径"列 + 留痕关时的黄色提示 + 金额精度 `toFixed(2)` → `toFixed(4)` |
| `admin-dashboard/src/i18n/locales/zh-CN.ts` | `cost` 下新增 6 条文案（空状态 / 无 token 统计提示 / 口径列） |
| `admin-dashboard/src/i18n/locales/en.ts` | 同上 |

> **未新增 env 键、未新增表、未新增列。** 定价走的是仓库**已有**的两个 env。

---

## 三、关键设计决策（与任务单的偏差表）

> 按 `docs/team/conventions.md` §2.5：先 grep 核实真实函数名 / 调用链 / 文件路径，再找企业级最佳方案，逐条登记。

| # | 任务单原文 | 实际做法 | 理由 |
|---|---|---|---|
| **B1** | §D4「从 env 读：`LLM_COST_PER_1K_PROMPT_TOKENS` / `LLM_COST_PER_1K_COMPLETION_TOKENS`」 | **复用仓库已有的** `LLM_PRICE_INPUT_PER_1K` / `LLM_PRICE_OUTPUT_PER_1K` | grep 核实：这两个键**早就在** `.env.example` 404–405 行（WP24 加的），且 `engine.module.ts:443-446` 已在读它们装配单场成本日志。新增一套 `LLM_COST_*` = **两张定价表**，运维改了一处另一处不动 → 看板与日志的数对不上，而且没人知道该改哪个。同一份单价只有一份 env |
| **B2** | §八 Q1「默认值建议 prompt 0.001 元/1k、completion 0.002 元/1k」 | 用 `DEFAULT_SESSION_COST_PRICING` = **0.0015 / 0.0045**（元/千 token） | 同上：`.env.example` 404–405 行已经显式给了 0.0015 / 0.0045，模块注释写明是"**MiniMax Token Plan 口径**"。任务单建议的 0.001/0.002 是**另一个数**（且没写来源）—— 换掉它等于让看板与单场成本日志用不同单价。⚠️ 这两个值仍是**工程默认值，不是与厂商合同核对过的报价**（沿用 WP24 的原话），上生产前要对一遍当期报价 |
| **B3** | 任务单未规定时区 | 按 **Asia/Shanghai (UTC+8)** 分桶 | · 不用 UTC：北京 08:00 之前开的场会被切到前一天，运营看"今天"会觉得数字对不上 · 不用服务器本地时区：本地开发机（UTC+8）与生产容器（常是 UTC）分桶边界不同 → 同一批数据在两个环境落进不同的天 · 固定 UTC+8：无 DST，边界确定，与运行环境无关。用 `Intl.DateTimeFormat`（仓库既有做法，`home-micro-intervention-stats.service.ts`），不引 luxon |
| **B4** | §D2「`/cost/sessions` 返回 `[{ sessionId, visitorAlias, startedAt, totalTokens, costCny }]`」 | 按任务单用 **`totalTokens`**，并把前端 `SessionCost.tokens` 改成 `totalTokens` | 前端原类型写的是 `tokens`，与任务单不一致。选 `totalTokens` 的理由：**它与既有 `GET /admin/api/sessions` 的 `totalTokens` 是同一个概念同一个名字** —— 同一个值在两个端点里叫两个名字，读的人得先猜它们是不是一回事。趋势聚合点沿用任务单的 `tokens`（那是"当天合计"，不是单场） |
| **B5** | 任务单未规定趋势行数 | **恒返回 `days` 行**，缺数据的天补 0 | 趋势图要**连续时间轴** —— 缺一天就断一截，看的人会以为那天没开张，而不是"那天没有会话"。补 0 是如实的（0 场会话 → 0 token → 0 成本），不是编造 |
| **B6** | §D2 的返回字段清单里**没有**成本口径 | **加** `costBasis`（`full` / `output_only`） | WP24 立下的纪律："一个数带不清的口径, 不该只靠'看文档的人记得'来解释"。上游没报输入侧用量时成本只是**下界**；不带这个字段，前端表格就只能把下界当全场成本显示 |
| **B7** | 任务单未规定 `sessions` 口径 | `sessions` 来自**会话表**，`tokens` / `costCny` 来自**留痕** | 两者来源不同，口径必须分开：场次是表里的事实（留痕关也有），token / 成本是留痕里的事实（留痕关就为 0）。于是"有场次但 0 token" = 留痕关了 —— 这个信号本身就是有用的 |
| **B8** | 任务单未规定扫描上限 | 趋势一次最多扫 **2000 场**（`COST_TREND_SCAN_LIMIT`），窗口最长 **90 天** | 每场都要读 `turn_debug_trace`（JSON 列，单场可能几 KB），无上限地扫 = 一个看板请求把库拖垮。⚠️ 因此趋势是"**扫描窗口内**的口径"，超限时按 `startedAt` 倒序取（最近的优先） |
| **B9** | §一「展示真实 token 消耗、成本、会话数，**并接入超阈值告警规则**」 | **只做看板，告警不做** | 沿用任务单 §D1 的既定范围：告警规则是另一个工程（阈值配置 + 告警通道 + 通知策略）。母版 WP31 的措辞含告警 —— 本单**只销了看板那一半**，登记为遗留 R1 |
| **B10** | §四「`CostBoard.vue` 确认数据显示正常」 | 发现并**修掉一个真 bug**：汇总卡片与折线图原来是在 setup 里求值一次的**常量** | 原代码 `const totalTokens = trend.value.reduce(...)` 在 setup 执行时 `trend` 还是空数组 → 4 张汇总卡片**永远显示 0**，折线图 `xAxis.data` / `series.data` 也是空数组 → 图是空的。数据是异步到的，汇总必须跟着数据走 → 全部改 `computed`。**这不是"接了真 API 就能显示"** —— 不修的话接了真 API 页面还是一片 0 |
| **B11** | 任务单未提金额精度 | 金额展示从 `toFixed(2)` 改 `toFixed(4)` | 单场成本的实际量级是 **0.0015 ~ 0.05 元**（4500 token ≈ 0.011 元）。`toFixed(2)` 会把 0.0036 显示成 **¥0.00** —— 一半以上的场次看起来"免费"。4 位小数是这个量级下不丢信息的最小精度 |

### 3.1 其它实现口径（非偏差，但值得记）

1. **非法 query 参数回退缺省，不抛、不传 NaN**：既有 `GET /sessions` 写的是 `Math.min(Number(limit ?? 20), 50)` —— `Number('abc')` = NaN → `take: NaN` 会让驱动层炸掉。本单的 `clampInt()` 统一处理（非数字 → 缺省，超界 → 夹住，取整）。**没改既有端点**（不在本单范围），登记为遗留 R4。
2. **没有开场时刻（`startedAt` 为 null）的会话不落进趋势**：无法定位到某一天，不硬塞进"今天"，也不编日期。它仍会出现在 `/cost/sessions` 列表里。
3. **心理内容不进日志**：本单**没有新增任何日志**；两个端点全是只读、无副作用。成本数据只含 token 数与金额，不含任何对话内容。
4. **`totalTokens` 不重复计思考 token**：`totalTokens = promptTokens + completionTokens`（思考 token 已含在输出侧）—— 与既有 `GET /admin/api/sessions` 的 `sumTokens()` 同口径。

---

## 四、接口契约（给前端 AI）

### 4.1 `GET /admin/api/cost/trend?days=7`

```json
[
  { "date": "2026-11-03", "tokens": 600, "costCny": 0.0015, "sessions": 1 },
  { "date": "2026-11-04", "tokens": 800, "costCny": 0.0036, "sessions": 1 },
  { "date": "2026-11-05", "tokens": 4500, "costCny": 0.01125, "sessions": 2 }
]
```

- `days`：缺省 7，上限 90；非法值回退 7（**不抛**）。
- **行数恒等于 `days`**（缺数据的天补 0），按日期升序。
- `date` 是 **Asia/Shanghai** 的 `YYYY-MM-DD`。
- `sessions` 来自会话表；`tokens` / `costCny` 来自留痕 —— **留痕关着时 `sessions > 0` 而 `tokens = 0`**。

### 4.2 `GET /admin/api/cost/sessions?limit=20`

```json
[
  {
    "sessionId": "…",
    "visitorAlias": "晚晴",
    "startedAt": "2026-11-05T02:00:00.000Z",
    "totalTokens": 1500,
    "costCny": 0.00375,
    "costBasis": "full"
  }
]
```

- `limit`：缺省 20，上限 50；非法值回退 20。
- `costBasis`：`full` = 输入输出都计；`output_only` = 上游没报输入侧用量，成本是**下界**。
- `startedAt` 可为 `null`。

---

## 五、闸门数字

| 闸门 | 命令 | 结果 |
|---|---|---|
| ESLint | `npx eslint "src/**/*.ts" "test/**/*.ts"` | **0 error** |
| TypeScript | `npx tsc -p tsconfig.build.json --noEmit` | **0 error** |
| 测试 | `npx vitest run --exclude '**/e2e/**/*.ts'` | **109 文件 / 1850 例全绿**（WP30 基线 108 / 1834 → 本轮 **+1 文件 / +16 例**，既有 1834 例零回归） |
| 内核红线 | `git diff --stat HEAD -- src/engine-core` | **空** |
| 边界断言 | `test/engine-core/boundary.spec.ts` | 11 条全绿（随全量 vitest 一起跑） |
| 前端类型 | `npx vue-tsc --noEmit -p tsconfig.app.json`（`admin-dashboard/`） | **8 处报错，全部在非本单文件**（见下） |

> 闸门用 `vitest run --exclude '**/e2e/**/*.ts'`（= 仓库 `pnpm test` 口径）。不带 `--exclude` 会把 e2e 拉进来，e2e 要真 DB / Redis，本机跑不了。

### 5.1 前端 vue-tsc 的 8 处既有报错（**不是 WP31 引入**）

| 文件 | 行 | 报错 | 与 WP31 的关系 |
|---|---|---|---|
| `views/DebugChat.vue` | 439 | `Object.keys(...)` 收 `undefined` | **工作区里那份未提交的 WP58 前端接线**带来的（`DebugChat.vue` 此刻有未提交改动 = 有人在改它） |
| `views/DebugChat.vue` | 489 / 493 | `promptFull` 不在 `RenderSpecSummary` 上 | 同上 —— 后端 WP58 已返回 `promptFull`，但前端 `types.ts` 的 `RenderSpecSummary` 还没加这个字段。**本单没碰这两个文件**（`types.ts` 只改了 `SessionCost`） |
| `views/DebugChat.vue` | 563 | 模板里 `messages.value` | 同上 |
| `views/ParamCalibrator.vue` | 397 / 478 | `noUncheckedIndexedAccess` 下的 `possibly undefined` | **WP31 未碰这个文件** |
| `views/SessionDetail.vue` | 100 | `beliefActivation` 的 `Record<string, number>` 推断不兼容 | WP30 已登记的既有问题（该 computed 是 WP57 待接的假数据块，HEAD 里逐字未改） |

> **本单改动的 5 个前端文件里，`CostBoard.vue` / `client.ts` / `types.ts` / 两个 i18n 文件零报错。**

### 5.2 单测覆盖清单（16 例）

| 组 | 例数 | 内容 |
|---|---|---|
| ① 成本趋势 | 4 | 按 Asia/Shanghai 分桶 + 补齐没数据的天 + 跨 UTC 日界的会话归位正确 / 留痕关时 sessions 有数而 tokens 为 0 / `days` 缺省 7·非法回退·0 → 1·超限 → 90 / 学员隔离生效 |
| ② 会话成本列表 | 3 | token / 成本 / **口径**三字段 / `limit` 缺省 20·非法回退·超限夹住 / 无留痕的会话仍列出（0 token 0 成本） |
| ③ 定价走 env | 3 | env 配了按 env / 没配走默认 / 非法值回退默认不抛 |
| ④ 纯函数口径 | 4 | `totalTokens = 输入 + 输出`（思考 token 不重复计）/ 无留痕不报错 / 趋势补 0 / 时区边界（上海 00:00 前归前一天 + 窗口起点 UTC 时刻） |
| ⑤ 守卫继承 | 2 | class 级 `AdminRoleGuard` 断言 / 2 个新端点都是 GET 且有效 guard 含 `AdminRoleGuard` |

> "今天"用 vitest fake timers 冻结（`vi.setSystemTime`）—— 按天分桶的断言必须有确定的"今天"，否则跨天跑就会飘。

---

## 六、运维须知

### 6.1 无新 env 键

本单**不新增 env**。成本单价走仓库**已有**的两个键（`.env.example` 404–405 行已有含口径说明）：

| 键 | 缺省 | 口径 |
|---|---|---|
| `LLM_PRICE_INPUT_PER_1K` | `0.0015` | 元 / 千 token（输入侧） |
| `LLM_PRICE_OUTPUT_PER_1K` | `0.0045` | 元 / 千 token（输出侧） |

> ⚠️ 这两个值是**工程默认值**，不是与厂商合同核对过的报价（沿用 WP24 的原话）—— 真正计费以厂商账单为准。非法值（空串 / 非数字 / 负数）回退默认，**不抛**。

### 6.2 成本看板默认空 —— 这是设计，不是 bug

成本数据来自**引擎调试留痕**（`turn_debug_trace[].llmUsage`），而 `ENGINE_DEBUG_TRACE_ENABLED` 在**生产环境缺省关**。于是：

- 生产环境的成本看板 `tokens` / `costCny` **恒 0**，但 `sessions` 仍准确（来自会话表）。
- 前端会显示黄色提示："有会话但没有 Token 统计"。

要在线上看到真实成本，有两条路：**① 开留痕开关**（代价是每轮落一份 JSON 快照）；**② 在 `training_sessions.tech_stats` 里补 token 统计**（更省，但那是另一个单 —— 缺口 G1）。

### 6.3 已知边界

1. **趋势是"扫描窗口内"的口径**：最多扫 2000 场、窗口最长 90 天，超限时按 `startedAt` 倒序取最近的。
2. **`startedAt` 为 null 的会话不进趋势**（无法定位到某一天），但仍在会话成本列表里。
3. **成本口径是下界的情形**：`costBasis = 'output_only'` 时，该行金额只含输出侧。
4. **看板与单场成本日志共用同一套定价**：改 env 两边一起变，不会漂。

---

## 七、遗留 / 后续建议

| # | 事项 | 归属 |
|---|---|---|
| **G1** | **生产成本数据源** —— `tech_stats` 里没有 token 统计，留痕又默认关。要让生产看板有数，得给 `training_sessions.tech_stats` 补 token 统计字段（或加一张用量表） | 后续单（DB 层） |
| **R1** | **超阈值告警规则** —— 母版 WP31 的另一半：阈值配置 + 告警通道 + 通知策略。**本单只销了看板那一半** | 后续单 |
| **R2** | 趋势的**全量口径** —— 现在有扫描窗口上限；真要全量得把会话维度做成可 SQL 聚合的索引表 | 后续单（DB 层） |
| **R3** | 既有 `GET /sessions` 的 `limit` 参数**没有防 NaN**（`Math.min(Number(limit ?? 20), 50)` → `Number('abc')` = NaN → `take: NaN`）。本单新端点用了 `clampInt()`，既有端点**没改**（不在本单范围） | 后续单（同一 controller，顺手改） |
| **R4** | `Dashboard.vue` 的 `weeklySessions()` / `dashboard()` 等 mock 仍在（`MemoryBrowser` / `PsyGuardMonitor` 同理） | 后续单 |
| **R5** | 前端 `types.ts` 的 `RenderSpecSummary` 缺 `promptFull` 字段 → `DebugChat.vue` 有 2 处 vue-tsc 报错。**工作区里那份未提交的 WP58 前端接线正改着这个文件，本单没碰** | 前端 AI（正在改那份接线的人） |

---

_本记录由后端 AI 生成，遵循 `docs/team/conventions.md` §二 的交付格式。_
