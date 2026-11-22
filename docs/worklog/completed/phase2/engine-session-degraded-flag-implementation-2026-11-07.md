> 
# degraded 会话打标（后端）· 交付记录

> 状态: ✅ 已交付
> 任务单: [`session-degraded-flag-2026-11-07.md`](session-degraded-flag-2026-11-07.md)
> 日期: 2026-11-07
> 红线: ✅ **engine-core 零改动** —— `git diff --stat HEAD -- src/engine-core` = **空**
> 边界断言: ✅ `boundary.spec.ts` 全绿（12 例，零改动即零影响）
> 承接: WP67 母版「降级状态标记」那一半（会话级 `degraded: true` 打标）
> ⚠️ **失败轮次 = 渲染降级轮次**（不是审议层失败）—— 理由见 §2.2 / §2.3
> ⚠️ **单次训练路径永远 `degraded = 0`** —— 后端拿不到失败信号（见 §5.1）

---

## 1. 实际改了哪些文件

### 1.1 生产代码: 3 增 9 改

| 文件 | 改了什么 |
|---|---|
| `src/counselor/domain/session-degraded.ts` | **新增**（132 行 · 本单主判定）: ① 导出 `SessionDegradedReason`（`high_failure_rate` / `consecutive_failures`）; ② 导出阈值常量 `SESSION_DEGRADED_FAILURE_RATE_NUMERATOR` / `_DENOMINATOR`（3/10 = 30%）+ `SESSION_DEGRADED_CONSECUTIVE_THRESHOLD`（3）; ③ 导出纯函数 `evaluateSessionDegraded(turns)` → **判别联合** `SessionDegradedVerdict`（`degraded` 为 true 时 `reason` 一定有值）; ④ 文件头补本单说明块（失败轮次定义 / 三条排除 / 规则优先级 / 严格大于） |
| `src/counselor/providers/session-degraded.service.ts` | **新增**（116 行 · 本单主写入侧）: ① 导出 `loadDegradedSessionExclusion(repo, userId)` —— 读取侧过滤助手（**空集合返回 null**，避开 `In([])` → `IN ()` 的 MySQL 语法错）; ② `SessionDegradedService implements SessionEvaluationSink, OnModuleInit` —— 在 `onModuleInit` 注册进 voice 层 `SessionEvaluationRegistry`; ③ `finalize()` → 跑判定 → 命中才 `update` 两列（**局部列更新**，不碰 `status` / `ended_at`）; ④ 落库行不存在 → 记 warn 不抛 |
| `src/migration/1714900000032-AddSessionDegradedFlag.ts` | **新增**（111 行）: 手写 DDL + INFORMATION_SCHEMA 幂等守卫（缺才加），`degraded TINYINT NOT NULL DEFAULT 0` + `degraded_reason VARCHAR(50) NULL` |
| `src/voice/session-evaluation-slot.ts` | **改**（+10 / -0）: `SessionEvaluationTurnInput` 加**可选**字段 `degraded?: boolean`（可选 = 向后兼容，既有实现与既有测试零改动） |
| `src/engine-adapters/wiring/engine-stream-backend.adapter.ts` | **改**（+4 / -0）: `recordEvaluationTurn()` 投影时带上 `degraded: result.render.providerHint === 'degraded'` —— 与"降级轮次不写逐字稿"**同源**（同一个 `providerHint`，不会两处漂） |
| `src/counselor/entities/training-session.entity.ts` | **改**（+28 / -0）: 加 `degraded`（tinyint default 0）+ `degradedReason`（varchar 50 nullable）两列（放在 `characterVersion` 之后、`startedAt` 之前） |
| `src/counselor/evaluation/session-evaluation.service.ts` | **改**（+13 / -2）: ① 构造器加**第 3 个必填依赖** `TrainingSession` 仓储; ② `listMine()` 加过滤（`sessionId: Not(In(degradedIds))`；没有 degraded 会话时**不加**条件） |
| `src/counselor/providers/growth-archive.service.ts` | **改**（+28 / -3）: ① `overview()` 的快评查询 + `totalSessions` 计数都排除 degraded 会话; ② `trend()` 的快评查询排除; ③ 抽私有 `evaluationFilter(userId)` 一处口径 |
| `src/counselor/providers/ability-aggregate.service.ts` | **改**（+37 / -6）: `loadSignals()` 改为**一次**装载会话清单（id + tenantId + degraded）→ 算出 degraded 集合 → 快评信号跳过 degraded 会话 + 督导信号只取非 degraded 会话（顺带把查询数从 2 降到 1） |
| `src/counselor/counselor.module.ts` | **改**（+4 / -0）: providers 加 `SessionDegradedService`（`TrainingSession` entity 早已在 `TypeOrmModule.forFeature` 里，**不加 entity**） |
| `bin/ormconfig.ts` | **改**（+5 / -0）: **登记 migration 0032**（import + `migrations[]` 数组）—— 漏登记 = 静默不建列 |
| `src/migration/index.ts` | **改**（+4 / -0）: 导出 0032（跟 `bin/ormconfig.ts` 严格 1:1） |

### 1.2 测试: 1 增 2 改

| 文件 | 改了什么 |
|---|---|
| `test/counselor/session-degraded.spec.ts` | **新增 23 例**（本单主测试 · 431 行）: ① 判定纯函数 8 例（闸门 ⑥⑦⑧⑩ + 规则优先级 + 连续失败差一轮 + 空场次 + 可选字段向后兼容）② 写入侧 7 例（三个闸门各一例 + 空场次/无会话 id + 会话行不存在的兜底 + 走插槽交办）③ 读取侧 8 例（排除算子两条分支 + 考核列表过滤 + 无 degraded 时不加条件 + 单场评估不过滤 + 成长档案总览/趋势 + 能力雷达排除） |
| `test/counselor/wp43-evaluation-engine.spec.ts` | **改**（+27 / -4）: `new SessionEvaluationService(...)` 6 处补**第 3 参**（训练会话仓储桩）—— 构造器加了必填依赖，直接 new 的地方必须同步; 另加 `makeSessionRepo()` 桩 |
| `test/engine-adapters/wp43-evaluation-wiring.spec.ts` | **改**（+26 / -2）: ① `StubEngine` 加 `renderOverride` + `buildBackend(options)` 支持替换渲染元信息; ② **新增用例⑥**: 渲染降级轮次 → 投影带 `degraded: true`（**degraded 打标唯一的数据源**，钉死它）; ③ 用例① 的断言补 `degraded: false`（正常轮次的负向口径） |

### 1.3 配置: 零改动

本单**不新增任何 env 键** —— 阈值（30% / 3 轮）是**常量**（`src/counselor/domain/session-degraded.ts`），不是可配项。

理由: 任务单没要求可配; 阈值可配 = 两个 env 键 + 守卫 + 文档，而"30% / 3 轮"是任务单拍板的业务口径。审议层那边阈值可配，是因为它有 `engine.providers.ts` 那套 config 端口（会话级熔断器的阈值 env 可配），本单没有那个基础设施。

### 1.4 文档: 5 改

| 文件 | 改了什么 |
|---|---|
| `docs/worklog/pending/session-degraded-flag-2026-11-07.md` | 状态行改 ✅ + 指向交付记录; 追加「§十二 交付后补记」偏差表 → 移入 `completed/phase2/` |
| `docs/worklog/completed/phase2/engine-session-degraded-flag-implementation-2026-11-07.md` | **新增**（本文件） |
| `docs/worklog/README.md` | Phase2 已开工列表加一条 + **改掉「WP67 只销了熔断器那一半」那句里的"degraded 打标仍未做"** |
| `docs/worklog/pending/phase2-wp-list-2026-11-03.md` | WP67 行 + 尾部 ⚠️ 段: 「degraded 会话打标未做」→ 已做（独立单，附交付记录链接） |
| `docs/worklog/pending/phase2-overview-2026-11-03.md` | P1-16 行同样更新 |

### 1.5 **零改动**（逐条核实过）

- `src/engine-core/**` —— **一行未动**（`git diff --stat HEAD -- src/engine-core` = 空）
- `src/counselor/evaluation/evaluation-engine.ts`（WP43 的评分规则）—— **零改动**: degraded 轮次照常参与算分 —— 打标是**过滤**口径，不是"改算法重算一遍"
- `src/agent/supervisor/**` —— 零改动: 督导报告**照常生成**（任务单 §5.3「督导能看」）
- `src/counselor/providers/vpt-session-bridge.service.ts` / `training-session.service.ts` —— **零改动**: 会话结束点**不动**，打标由 voice 层插槽在**同一个收尾点**完成（见 §2.11）
- `src/voice/voice.service.ts` —— 零改动
- `src/voice/session-evaluation-slot.ts` 的**既有 9 个字段** —— 一个字没改（只**加**了一个可选字段）
- 无新表 / 无新 entity / 无新 env 键
- `admin-dashboard/` 与 Flutter 客户端 —— 零改动（前端另一个 AI 的活）
- **不删会话、不删评估行、不改已有分数** —— degraded 只是打标 + 读取侧过滤（任务单 §七 2/3）

---

## 2. 关键设计决策（与任务单有出入的地方 + 为什么）

### 2.1 决策 D1（核实清单第 4 条的前提不成立）: 失败轮次的**数据源既不是 transcript 也不是 trace**，是**引擎适配器的内存评估台账**

- **任务单 §4.4** 写「入口: 会话结束时，从 transcript 或 trace 里统计失败轮次」。
- **代码实际**:
  - **transcript 里没有失败标记** —— 降级轮次**根本不进逐字稿**（`engine-stream-backend.adapter.ts` 的 `if (!degraded && !blocked) appendTurn(...)`）。任务单 §十一 注意点 2 说的正是这件事。
  - **trace 里也没有 ok / degraded 字段** —— `TurnTrace`（`src/admin-debug/trace-recorder.service.ts`）只有快照 / 渲染规格 / 用量等观测字段; 而且留痕由 `ENGINE_DEBUG_TRACE_ENABLED` 控制，**生产缺省关**（业务能力不能挂在调试开关上）。
- **结论**: 失败轮次的事实**只活在引擎适配器的内存台账**里 —— 也就是 WP43 那条**评估台账**（`sessionEvaluationTurns`，每轮都 push，含降级轮次）。
- **修法**: 复用**已装配好的 voice 层评估插槽**，跨层契约加**一个可选字段** `degraded?: boolean`，由适配器在投影时带上。**不新造插槽、不新造装配点、不加新依赖**。

### 2.2 决策 D2（失败轮次的定义由后端拍板）: 失败轮次 = **渲染降级轮次**，排除三类

- **定义**: 失败轮次 = 本轮 AI 来访者说出的是**系统兜底句**（`render.providerHint === 'degraded'`），不是真实回应。
- **排除的三类 + 理由**:

| 排除项 | 理由 |
|---|---|
| **伦理阻断轮次**（`disposal.action === 'block'`） | 那是安全机制**正常工作**（该拦的拦住了）—— 它是伦理**正贡献**。算成失败 = 把安全机制打成了故障 |
| **引擎异常轮次**（`settled.ok === false`） | 该轮**根本不进评估台账**（适配器在 `settled.ok` 分支直接 return）—— 它**没有污染考核数据**，没污染的东西不需要过滤 |
| **abort 轮次**（用户主动打断） | 用户自己结束的对话，不是系统坏了 |

### 2.3 决策 D3（WP67 口径差异，本单最重要的一条）: **审议层失败不算失败轮次**

- **WP67 母版原文**: 「降级 1: LLM 审议超时 → 跳过审议; 降级 2: LLM 服务连续失败 → 切回纯规则算子模式; **降级状态标记: 会话打标 `degraded: true`，不能用于正式考核**」。
- **本单为什么不照抄**: 审议目前是**影子模式** —— **审议结果从不生效**（WP64/WP65 交付记录里写死了这一点）。所以:
  - 审议 LLM 超时 / 熔断 → 学员这一场**体验完全正常**、对话完全正常、评估完全可信;
  - 把它算成失败并从考核里踢掉 = **把好会话当成坏会话扔了**，比不打标**更糟**（丢数据）。
- **本单的口径**: 「这场会话**到底坏没坏**」→ 坏 = AI 来访者大面积没在说人话（渲染降级）。
- **登记在案**: 等审议**转正**（结果生效）之后，审议失败是否也要计入 degraded，需要在**那一单**重新评估 —— 那时审议失败会真的影响会话质量。见 §5.2。

### 2.4 决策 D4: 规则 2（连续失败）**优先于**规则 1（失败率）

- **任务单 §4.2 给规则 2 的例子**: 「前 5 轮正常，后 3 轮连续失败」= 8 轮里 3 轮失败 = **37.5% > 30%** —— 那条例子**同时命中两条规则**。只有规则 2 优先，它才会落进 `consecutive_failures`（否则闸门 ⑦ 挂）。
- **理由**: 规则 2 是**特异形态**（中途卡死），规则 1 是**一般统计**（整体质量差）。特异形态诊断力更强。
- **实现**: 先判规则 2 再判规则 1（`src/counselor/domain/session-degraded.ts`）。

### 2.5 决策 D5: 失败率用**整数交叉相乘**（`failed × 10 > total × 3`），不用浮点除法

- 任务单 §八 闸门 ⑩ 要求「失败率正好 30% → 不打标（**严格大于**）」。
- 浮点比较有隐患（`3/10` 与 `0.3` 是不是同一个 double 得靠运气），整数比没有这个问题 —— 3×10=30 与 10×3=30 精确相等 → 不打标。
- `failureRate` 仍然算出来放进判定结果，**只用于日志与展示**，不参与判定。

### 2.6 决策 D6: 打标是**第二个插槽实现**，不塞进评估落库方

- `SessionEvaluationRegistry` 本来就支持**多个** sink（`Map` 按名字去重，逐个 await，失败只记 warn 不互相牵连）。
- `SessionEvaluationService` 的职责是「算分 + 落 `session_evaluations`」; degraded 打标是「判这场坏没坏 + 写 `training_sessions`」—— **行与列都不同**，分开更干净，也不污染既有实现的边界。
- 打标 sink 的 `name = 'counselor-session-degraded'`，与 `'counselor-session-evaluation'` 并存。

### 2.7 决策 D7: 读取侧过滤用「**degraded session id 集合 + `Not(In(ids))`**，没有就**不加**过滤条件

- **为什么不写 join / 子查询**: `session_evaluations` 没有 `degraded` 列（那是 `training_sessions` 的），要 join 一次; 单人产品阶段量级是「几十场」，先查 id 集合更直白，也更好测。
- **为什么空集合必须走「不加条件」**: TypeORM 的 `In([])` 会生成 `IN ()` —— 那是 **MySQL 语法错误**，不是「匹配不到」。所以 `loadDegradedSessionExclusion()` 在没有 degraded 会话时**返回 null**，调用方据此跳过加条件（用例钉死）。

### 2.8 决策 D8: 成长档案的 `totalSessions`（总对练场次）**也排除** degraded 会话

- 任务单 §5.2 写「统计时排除 degraded 会话」。
- **口径自洽**: 卡片里的每个数字都出自**同一批**会话（场次、均分、最高分、维度均分、危机次数），否则会出现「场次说 5 场，均分却是 4 场的平均」这种自相矛盾。
- **代价**（诚实登记）: 用户的会话列表可能显示 5 场，成长档案显示 4 场 —— 差的那场是坏会话。另一种口径（场次照旧、只过滤分数）会让卡片内部不一致，**没选**。

### 2.9 决策 D9: 会话**详情 / 单场评估不过滤**（任务单 §5.3）

- `findBySession()` / 会话列表 / 详情**照常能看**到 degraded 会话 —— 督导要能复盘。
- 只有「**考核**口径」的三个读侧过滤: ① 考核列表 `GET /counselor/evaluations`; ② 成长档案总览 + 趋势 `GET /counselor/growth/archive-overview` + `/trend`; ③ 能力雷达信号源（`ability_scores` 的快评信号）。

### 2.10 决策 D10（任务单措辞小偏差）: 状态枚举是 `FINISHED`（`'finished'`），不是 `ENDED`

- 任务单 §4.3 写「status 改成 ENDED」; 实际枚举是 `TrainingSessionStatus.FINISHED = 'finished'`（`src/counselor/enums/training-session-status.enum.ts`）。措辞偏差，行为无差。

### 2.11 决策 D11（核实清单第 3 条的补充）: 会话结束点**有 2 处**，但**本单一处都不改**

- `src/counselor/providers/vpt-session-bridge.service.ts`（`doClose()`，全真语音会话）写 `status = FINISHED`;
- `src/counselor/providers/training-session.service.ts`（`finish()`，单次训练）写 `status = FINISHED`。
- **本单不动这两处** —— 打标由 voice 层插槽在**同一个收尾点**（`engine.closeSession()` → 评估台账交办）完成，与 `doClose()` 的 UPDATE **写不同列**（`status`/`ended_at` vs `degraded`/`degraded_reason`），**互不覆盖** → 没有先后顺序的竞态。
- 单次训练那条路径为什么拿不到失败轮次 → §5.1。

### 2.12 决策 D12: migration **手写 DDL** + INFORMATION_SCHEMA 幂等守卫，序号 `1714900000032`

- 仓库 60+ 条 migration 历来手写（`migration:generate` 的 entities glob 只覆盖 `src/entity/**`，扫不到本仓实体; ADR-0003 禁用 `synchronize`）。
- 存量行由 `DEFAULT 0` 自动填成 0（= 没降级）→ 老会话**照旧参与考核**，零回归（任务单 §八 闸门 ⑤）。

---

## 3. 闸门数字（本单实跑）

| # | 闸门 | 命令 | 结果 |
|---|---|---|---|
| 1 | ESLint | `npx eslint "{src,test,bin}/**/*.ts"` | ✅ **0 error / 0 warning** |
| 2 | TypeScript | `npx tsc -p tsconfig.build.json --noEmit` | ✅ **0 error** |
| 3 | 单测（全量） | `npx vitest run --exclude '**/e2e/**/*.ts'` | ✅ **130 文件 / 2232 例全绿**（改动前 129 / 2208 → **+1 文件 / +24 例**） |
| 4 | engine-core 红线 | `git diff --stat HEAD -- src/engine-core` | ✅ **空**（零改动） |
| 5 | 边界断言 | `npx vitest run test/engine-core/boundary.spec.ts` | ✅ **12 例全绿** |

> 单测增量明细: `test/counselor/session-degraded.spec.ts` **新增 23 例** + `test/engine-adapters/wp43-evaluation-wiring.spec.ts` **新增 1 例**（用例⑥）。
> 既有 spec 因构造器加了必填依赖而同步改: `test/counselor/wp43-evaluation-engine.spec.ts`（6 处 `new SessionEvaluationService(...)` 补第 3 参）。

---

## 4. 验收逐条（任务单 §八）

| # | 闸门 | 要求 | 落地 | 用例 |
|---|---|---|---|---|
| 1 | ESLint | 0 problem | ✅ 0/0 | `npx eslint` |
| 2 | TypeScript | 0 error | ✅ | `npx tsc` |
| 3 | 单测 | 全量跑通，不新增失败 | ✅ 130 文件 / 2232 例 | 全量 vitest |
| 4 | engine-core | 零改动 | ✅ | `git diff --stat` |
| 5 | migration | 加 2 列成功，老会话默认 degraded=0 | ✅ `degraded TINYINT NOT NULL DEFAULT 0`（存量行自动 0）+ `degraded_reason VARCHAR(50) NULL` | 迁移文件 + 实体 |
| 6 | 写入侧 | 失败率 40% 的会话 → degraded=1, reason=high_failure_rate | ✅ | 判定纯函数 + 写入侧各 1 例 |
| 7 | 写入侧 | 连续失败 3 轮的会话 → degraded=1, reason=consecutive_failures | ✅ | 同上 |
| 8 | 写入侧 | 正常会话 → degraded=0, reason=null | ✅（未命中**一行都不写** → 列保持 0 / NULL） | 同上 |
| 9 | 读取侧 | 考核接口查询时，degraded=1 的会话不出现 | ✅ 考核列表 + 成长档案总览/趋势 + 能力雷达 | 读取侧 8 例 |
| 10 | 边界 | 失败率正好 30% → 不打标（严格大于） | ✅ 整数交叉相乘 | 判定纯函数 1 例 |

---

## 5. 残留风险（本单**没有**解决的，登记在案）

### 5.1 ⚠️ 单次训练路径永远 `degraded = 0`（后端拿不到失败信号）

- 单次训练是**客户端驱动**的: Flutter 客户端把每一轮文本 `appendTranscript` 上来，DTO（`AppendTranscriptTurnDto`）只有 `id` / `role` / `text` / `timestamp` / `isTyping` —— **没有失败标记**。
- 而且单次训练**不走引擎** → 不产生评估台账 → 本单的打标通道对它**完全没有输入**。
- 要覆盖它，必须改 `AppendTranscriptTurnDto` 让客户端**主动上报失败轮次** —— 那是**前端另一个 AI 的活**（且要动 Flutter 客户端，本仓库红线）。
- **本单影响面**: 只有全真语音会话（VPT）会被打标。

### 5.2 ⚠️ 审议层降级**不计入** degraded（与 WP67 母版口径不同）

见 §2.3。影子模式下审议结果从不生效，计入 = 扔好会话。**审议转正后需要重新评估**（后续单）。

### 5.3 ⚠️ migration 必须**先跑**

entity 加了列 → 运行时的 SELECT 会带上 `degraded` / `degraded_reason` → migration 没跑就会报 `Unknown column 'degraded'`。加列类迁移的固有代价（与仓库既有 ALTER 迁移同款）。

### 5.4 ⚠️ degraded 会话的**督导报告照常生成**，只是不计入统计

任务单 §5.3 明说「保留 degraded 会话，督导能看」—— 所以督导 job 照常派发、报告照常落库; 本单只在**考核 / 统计口径**上排除。若将来要连报告一起拦，需要另开单。

### 5.5 ⚠️ 阈值是**常量**，不可配

见 §1.3。切灰度后如果要看真实分布再调，改常量要发版。

### 5.6 ⚠️ `session_evaluations` 里的**旧评估行保留**（只是不出现在列表里）

任务单 §七 2「不删除会话」—— degraded 会话的评估行仍在表里，只是不参与列表 / 统计。数据保留，便于事后复盘。

### 5.7 ⚠️ 打标是 **fire-and-forget**（与评估落库同款）

收尾时交办评估台账是异步的（不阻塞 `session_ended` 帧）。打标同理 —— 极端情况下（进程在收尾瞬间被 kill）这一场的标可能没落上。**可接受**: 漏打标的后果是"一场坏会话留在考核里"，比阻塞收尾好。

---

## 6. 隐私与安全（任务单 §六 逐条）

| 要求 | 落实 |
|---|---|
| degraded 字段是元数据 —— 不含心理内容 | ✅ 两列只有 0/1 与一个原因码（`high_failure_rate` / `consecutive_failures`），没有任何对话内容 |
| 日志只出定位信息 —— 不打对话原文 | ✅ 写入侧只打 `[session_degraded] 已打标 session=... reason=... failed=n/m consecutive=k` —— 只有 id、原因码与计数 |

---

## 7. 提交建议

commit message 草稿（**未提交**，等大炮指令）:

```
feat(session): degraded 会话打标 - 连续失败会话不参与考核

会话结束时一次性判定, 失败率 >30% 或连续失败 >=3 轮就打标.
考核接口过滤掉 degraded 会话, 不污染考核数据.
engine-core 零改动.
```

---

## 8. 后续单建议（不在本单范围）

1. **单次训练的上报通道**（§5.1）—— 改 `AppendTranscriptTurnDto` + Flutter 客户端上报失败轮次。
2. **审议转正后**重新评估 degraded 口径（§5.2）。
3. **前端面板**（任务单 §七 5 明令本单不做）。
