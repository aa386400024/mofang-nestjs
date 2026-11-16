# WP31 · 成本看板与告警 · 任务单

> **状态**：✅ 已交付（2026-11-05）→ [`engine-wp31-cost-board-alert-implementation-2026-11-05.md`](engine-wp31-cost-board-alert-implementation-2026-11-05.md)
> **路径**：`docs/worklog/completed/phase2/wp31-cost-board-alert-2026-11-05.md`
> **优先级**：🔴 P0（商业化根基）
> **预估**：中
> **依赖**：无
> **边界**：engine-core 零改动；心理内容不进日志；不自动 git commit/push

---

## 一、任务目标

Admin Dashboard 的 **CostBoard（成本看板）** 页面现在还是 mock 数据。本 WP 把它切到真 API，展示真实的 token 消耗、成本、会话数，并接入超阈值告警规则。

---

## 二、现状扫描（已核实）

### 2.1 后端已有的相关 API

| 端点 | 用途 | 状态 |
|---|---|---|
| `GET /admin/analytics/overview` | 知识库 analytics（4 KPI：KB 发布量 / 转化率 / 审核 SLA / 排期占比） | ✅ 已实现，但**不是成本看板** |
| `GET /admin/api/sessions` | 会话列表（含 `totalTokens`） | ✅ 已实现 |
| `GET /admin/api/sessions/:id` | 会话详情（含 `traces`，每轮有 `llmUsage`） | ✅ 已实现 |

### 2.2 前端 mock 清单

| 方法 | 用途 | 用在哪个页面 | 后端有没有？ |
|---|---|---|---|
| `costTrend()` | 成本趋势（按天聚合：tokens / cost / sessions） | `CostBoard.vue` | ❌ 没有 |
| `sessionCosts()` | 会话成本列表（每场会话的 token / 成本） | `CostBoard.vue` | ❌ 没有 |

### 2.3 成本数据在哪里（已核实）

| 数据源 | 有什么 | 问题 |
|---|---|---|
| `training_sessions.tech_stats` | ❌ **没有 token 统计**——只有提问类型 / 干预技术 / 行为指标 / 督导点评 | 之前以为有，实际核对后发现没有 |
| `turn_debug_trace[].llmUsage` | ✅ 每轮的 promptTokens / completionTokens / reasoningTokens | ⚠️ 生产环境留痕默认关（`ENGINE_DEBUG_TRACE_ENABLED` prod 缺省关）→ 没数据 |
| `training_sessions` 表本身 | 会话数、时长、startedAt | 有 |

### 2.4 关键发现

**成本数据现在只能从 `turn_debug_trace` 里聚合，但生产环境留痕默认关。**

这意味着：
- 成本看板接口可以立住（后端补 2 个端点，前端切 mock）
- 但生产环境默认没数据（留痕关了，trace 是空的）
- 要让成本看板有数据，需要：要么开留痕开关，要么在 `training_sessions.tech_stats` 里加 token 统计（后续 WP 补）

---

## 三、设计决策

### D1：范围只做 CostBoard 页面，不做告警规则

**理由**：
- WP31 任务单原文写的是"成本看板展示 token 消耗/用户/会话，超阈值告警规则接入"
- 告警规则是另一个大工程（阈值配置、告警通道、通知策略），本期先做看板，告警后续 WP 补
- 一次做太多容易乱，先把看板切干净

### D2：后端补 2 个端点

**要补的后端端点**：

| 端点 | 用途 | 返回什么 |
|---|---|---|
| `GET /admin/api/cost/trend?days=7` | 成本趋势（按天聚合） | `[{ date, tokens, costCny, sessions }]` |
| `GET /admin/api/cost/sessions?limit=20` | 会话成本列表 | `[{ sessionId, visitorAlias, startedAt, totalTokens, costCny }]` |

**理由**：
- 前端这 2 个 mock 现在是空壳，后端没有真 API
- 不补后端端点，前端切不了
- 这 2 个端点都是只读的 GET，不涉及写操作，风险低

### D3：成本数据从 `turn_debug_trace` 聚合（生产环境默认空）

**理由**：
- `training_sessions.tech_stats` 里**没有 token 统计**（只有提问类型 / 干预技术 / 行为指标）
- 唯一有 token 统计的地方是 `turn_debug_trace[].llmUsage`
- 但生产环境留痕默认关 → 成本看板默认是空的
- 本期先把接口立住（前端切 mock），数据源缺口登记后续 WP 补

### D4：成本单价从 env 配置读

**理由**：
- 不同模型单价不一样，不能硬编码
- 从 env 读：`LLM_COST_PER_1K_PROMPT_TOKENS` / `LLM_COST_PER_1K_COMPLETION_TOKENS`
- 默认值给工程种子值（比如 prompt 0.001 元/1k，completion 0.002 元/1k），标注"工程种子值，待校准"

### D5：生产环境没数据怎么办

**理由**：
- 留痕关了 → trace 是空的 → 成本看板是空的
- 这不是 bug，是设计如此（留痕是调试用的，不是生产监控用的）
- 登记缺口 G1：要让成本看板有生产数据，需要在 `training_sessions.tech_stats` 里加 token 统计字段（后续 WP 补）

### D6：前端切 mock 的顺序

**理由**：
- 先切 `costTrend()` → 等后端补了 `/cost/trend` 再切
- 一次切一处，容易验证

---

## 四、文件清单

### 后端新增/修改

| 文件 | 改什么 |
|---|---|
| `src/admin-debug/admin-debug.controller.ts` | 加 2 个 GET 端点：`/cost/trend` / `/cost/sessions` |
| `src/admin-debug/admin-debug.module.ts` | 不用改（已经有 sessionRepo） |

### 前端修改

| 文件 | 改什么 |
|---|---|
| `admin-dashboard/src/api/client.ts` | 把 `costTrend()` / `sessionCosts()` 2 个 mock 换成真 fetch 调用 |
| `admin-dashboard/src/views/CostBoard.vue` | 确认数据显示正常，去掉 mock 标识（如果有的话） |

---

## 五、验收标准

### 5.1 后端

- [ ] `GET /admin/api/cost/trend?days=7` 返回按天聚合的成本趋势
- [ ] `GET /admin/api/cost/sessions?limit=20` 返回会话成本列表
- [ ] 成本单价从 env 配置读，有默认值
- [ ] 所有端点都走 `AdminRoleGuard`（非 admin → 403）
- [ ] 心理内容不进日志

### 5.2 前端

- [ ] `api/client.ts` 里 2 个 mock 方法都换成真 fetch
- [ ] `CostBoard.vue` 页面显示真实成本数据
- [ ] 页面上没有"mock"或"假数据"的标识

---

## 六、边界与红线

- ✅ engine-core 零改动（`git diff --stat HEAD -- src/engine-core` = 空）
- ✅ 心理内容（对话原文、记忆内容）不进日志
- ✅ 所有端点都走 admin 鉴权（basic auth + admin role guard）
- ✅ 不自动 git commit/push，只给 commit message 草稿

---

## 七、交付物

1. 后端 2 个 GET 端点实现
2. 前端 2 处 mock 切真
3. 单测覆盖（后端 2 个端点各 1-2 例）
4. 交付记录文档

---

## 八、待确认问题

1. 成本单价默认值给多少？建议 prompt 0.001 元/1k，completion 0.002 元/1k（工程种子值，待校准）
2. 成本趋势默认天数是 7 天还是 30 天？建议 7 天
3. 缺口 G1：生产环境要让成本看板有数据，需要在 `training_sessions.tech_stats` 里加 token 统计字段——这个后续 WP 补，本期不做

---

## 九、交付后补记（2026-11-05）

> 交付记录：[`engine-wp31-cost-board-alert-implementation-2026-11-05.md`](engine-wp31-cost-board-alert-implementation-2026-11-05.md)
> 下表逐条登记**与任务单原文的偏差**（完整版见交付记录 §三）。

| # | 任务单原文 | 实际落地 | 为什么 |
|---|---|---|---|
| 1 | §D4「从 env 读：`LLM_COST_PER_1K_PROMPT_TOKENS` / `LLM_COST_PER_1K_COMPLETION_TOKENS`」 | **复用仓库已有的** `LLM_PRICE_INPUT_PER_1K` / `LLM_PRICE_OUTPUT_PER_1K` | grep 核实：这两个键**早就在** `.env.example` 404–405 行（WP24 加的），`engine.module.ts:443-446` 已在读它们装配单场成本日志。新增一套 `LLM_COST_*` = **两张定价表**，运维改一处另一处不动 → 看板与日志的数对不上。同一份单价只有一份 env |
| 2 | §八 Q1「默认值建议 prompt 0.001 / completion 0.002」 | 用 `DEFAULT_SESSION_COST_PRICING` = **0.0015 / 0.0045** | `.env.example` 已显式给了这一组值，模块注释写明是"**MiniMax Token Plan 口径**"；任务单建议的数**来源不明**。换掉它 = 看板与单场成本日志用不同单价。⚠️ 仍是工程默认值，上生产前要对一遍当期报价 |
| 3 | 任务单未规定时区 | 按 **Asia/Shanghai (UTC+8)** 分桶 | 不用 UTC（北京 08:00 前的场被切到前一天）；不用服务器本地时区（本地机与生产容器边界不同 → 同一批数据落进不同的天）；固定 UTC+8 无 DST，与运行环境无关。用 `Intl.DateTimeFormat`（仓库既有做法），不引 luxon |
| 4 | §D2「会话成本返回 `totalTokens`」 | 按任务单用 `totalTokens`，前端 `SessionCost.tokens` 改成 `totalTokens` | 前端原类型是 `tokens`，与任务单不一致。选 `totalTokens` 的理由：与既有 `GET /admin/api/sessions` 的 `totalTokens` **同名同义** —— 同一个值在两个端点叫两个名字，读的人得先猜是不是一回事 |
| 5 | 任务单未规定趋势行数 | **恒返回 `days` 行**，缺数据的天补 0 | 趋势图要**连续时间轴** —— 缺一天断一截，看的人会以为那天没开张。补 0 是如实的，不是编造 |
| 6 | §D2 返回字段清单里**没有**成本口径 | **加** `costBasis`（`full` / `output_only`） | WP24 纪律："一个数带不清的口径, 不该只靠'看文档的人记得'来解释"。上游没报输入侧用量时成本只是**下界** |
| 7 | 任务单未规定 `sessions` 口径 | `sessions` 来自**会话表**，`tokens` / `costCny` 来自**留痕** | 来源不同口径必须分开：场次是表里的事实（留痕关也有），token / 成本是留痕里的事实（留痕关就为 0）→ "有场次但 0 token" = 留痕关了的信号 |
| 8 | 任务单未规定扫描上限 | 趋势最多扫 **2000 场**，窗口最长 **90 天** | 每场都要读 `turn_debug_trace`（JSON 列，单场几 KB），无上限地扫 = 一个看板请求把库拖垮 |
| 9 | §一 含"接入超阈值告警规则" | **只做看板，告警不做** | 沿用 §D1 的既定范围（阈值配置 + 告警通道 + 通知策略是另一个工程）。母版 WP31 的措辞含告警 —— **本单只销了看板那一半**，登记遗留 R1 |
| 10 | §四「`CostBoard.vue` 确认数据显示正常」 | 发现并**修掉一个真 bug**（汇总卡片与折线图原来是在 setup 里求值一次的常量，永远显示 0）→ 全部改 `computed` | 原代码 `const totalTokens = trend.value.reduce(...)` 在 setup 执行时 `trend` 还是空数组 → 4 张卡片**永远 0**、图是空的。**不修的话接了真 API 页面还是一片 0** |
| 11 | 任务单未提金额精度 | `toFixed(2)` → `toFixed(4)` | 单场成本量级是 0.0015 ~ 0.05 元；`toFixed(2)` 会把 0.0036 显示成 **¥0.00** —— 一半以上场次看起来"免费" |

**闸门**：eslint **0 error**（`npx eslint "src/**/*.ts" "test/**/*.ts"` exit 0）/ tsc **0 error**（`npx tsc -p tsconfig.build.json --noEmit` exit 0）/ vitest **109 文件 1850 例全绿**（WP30 基线 108 文件 1834 例 → 本轮 **+1 文件 / +16 例**；闸门用 `vitest run --exclude '**/e2e/**/*.ts'`，e2e 要真 DB/Redis）/ `git diff --stat HEAD -- src/engine-core` = **空**（内核零改动）/ `boundary.spec.ts` 全绿。

> ⚠️ **前端 vue-tsc 有 8 处既有报错**，全在本单**没碰**的文件里（`DebugChat.vue` × 4 —— 工作区里那份未提交的 WP58 前端接线正改着它；`ParamCalibrator.vue` × 2；`SessionDetail.vue` × 1 组，WP30 已登记）。**本单改动的 5 个前端文件零报错。**
>
> ⚠️ **本场成本口径是下界的情形**：`costBasis = 'output_only'` 时金额只含输出侧。
>
> ⚠️ **生产成本看板默认空**：成本数据来自留痕，而 `ENGINE_DEBUG_TRACE_ENABLED` 生产缺省关 → `tokens` / `costCny` 恒 0（`sessions` 仍准确）。这是设计如此，不是 bug —— 缺口 G1（`tech_stats` 补 token 统计）。
