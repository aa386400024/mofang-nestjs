# WP43 交付记录 — 评估引擎基础版（规则引擎快速评分）

> 状态: ✅ 已交付
> 任务单: [`wp43-evaluation-engine-basic-2026-11-06.md`](wp43-evaluation-engine-basic-2026-11-06.md)
> 日期: 2026-11-06
> 红线: **engine-core 零改动**（`git diff --stat HEAD -- src/engine-core` = 空）

---

## 1. 开工前核实清单（任务单 §一・五，五条全部核实）

| # | 任务单要求 | 核实结果 | 证据 |
|---|---|---|---|
| 1 | techStats 与 eventTags 不重复 | ✅ **不重复** | `SessionTechStats`（`src/counselor/domain/session-core/session-core.types.ts:62`）= 手法分类（questionTypes open/closed/semi + interventions reflection/paraphrase/summary/confrontation/interpretation/advice，**中性描述**，督导 LLM 同一次调用顺带产出）；eventTags（`CounselorEventKind`）= 行为效果分类（empathy / acceptance / normalization / open_probe / affirmation / judgment / preaching / minimizing / boundary_cross / sensitive_touch / neutral，**带评价**）。维度正交，无重复 |
| 2 | supervisor 六维与 eventTags 互补 | ✅ **互补** | `SupervisionDimensions`（`src/agent/supervisor/supervisor.types.ts:36`）= {empathy, activeListening, questioning, boundary, response, professionalism}，**LLM 综合打分 0-100、30-120s**；WP43 = **规则计数**（毫秒级）。粒度不同，不替代 |
| 3 | 数据来源 = 内核出参，不依赖留痕开关 | ✅ **确认** | 数据源是 `EngineTurnOutput.snapshot / events / safety`（每轮内核都在算），**不是** `turn_debug_trace`；全链路零 `ENGINE_DEBUG_TRACE_ENABLED` 读取 → prod 缺省关留痕时评估照跑 |
| 4 | engine-core 零改动 | ✅ **确认** | 本单开工前 WP38 已提交（`6a68fc9`），基线即 0 文件；本单收尾仍为 **0 文件 / 0 行** |
| 5 | crisis 从 safety 判定统计，不另写一套 | ✅ **确认** | `SafetyVerdict`（`src/engine-core/domain/safety/safety-types.ts`）= {level, side, categories, matchedRules, source, reason}；内核现有 11 类危机类别已核全并写进 `CRISIS_SAFETY_CATEGORIES` 常量（咨询师侧 `suicide_coaching` + 来访侧 `suicide_attempt / suicide_plan / suicide_preparation / active_ideation / passive_ideation / suicide_exploration / self_harm_behavior / self_harm_ideation / aggression_others / aggression_self`）。**零新增检测逻辑** |

---

## 2. 实际改了哪些文件

### 2.1 新增（7）

| 文件 | 改了什么 |
|---|---|
| `src/voice/session-evaluation-slot.ts` | **voice 层 @Global 插槽**：`SessionEvaluationTurnInput`（逐轮纯数据投影）/ `SessionEvaluationSessionInput`（整场）/ `SessionEvaluationSink`（业务侧实现接口）/ `SessionEvaluationRegistry`（注册表，失败只记 warn 不抛） |
| `src/counselor/evaluation/evaluation-engine.ts` | **纯规则评分引擎**：常量 + 类型 + `computeSessionEvaluation(turns)`。零 IO / 零 ORM / 零 LLM / 零 NestJS |
| `src/counselor/evaluation/session-evaluation.dto.ts` | 查询 DTO（分页 + 详情 + 列表项 + 列表结果） |
| `src/counselor/evaluation/session-evaluation.service.ts` | 评估服务：实现 `SessionEvaluationSink`（算分落库）+ 单场查询 + 我的列表；`onModuleInit` 注册进插槽 |
| `src/counselor/entities/session-evaluation.entity.ts` | `session_evaluations` 表实体（9 列 + 2 索引） |
| `src/counselor/controllers/session-evaluation.controller.ts` | `GET /counselor/evaluations`（我的快速评估列表） |
| `src/migration/1714900000030-CreateSessionEvaluations.ts` | 建表迁移（手写 DDL + INFORMATION_SCHEMA 幂等守卫） |

### 2.2 改动（8）

| 文件 | 改了什么 |
|---|---|
| `src/engine-adapters/wiring/engine-stream-backend.adapter.ts` | ① 新增 `sessionEvaluationTurns` 评估台账（与逐字稿同生命周期）；② `buildStream` 每轮结算后投影内核出参；③ `closeSession` 收尾 fire-and-forget 交办；④ **抽出两个私有方法**（`finalizeSessionEvaluation` / `reportSessionCost`）—— `closeSession` 圈复杂度原本已到仓库上限 20 |
| `src/engine-adapters/wiring/engine.providers.ts` | `EngineStreamBackendDeps` 加 `evaluation?`；工厂 `createEngineStreamBackend` **第 12 位**追加（位置参数只能追加在尾部） |
| `src/engine-adapters/wiring/engine.module.ts` | 后端工厂注入 `SessionEvaluationRegistry`（`optional: true` —— 缺了只影响"这场没有快速评分"） |
| `src/voice/voice-session.module.ts` | @Global 模块加 `SessionEvaluationRegistry` provider + export |
| `src/counselor/counselor.module.ts` | entity 24 → **25**；`forFeature` 加 `SessionEvaluation`；providers 加 `SessionEvaluationService`；controllers 加 `SessionEvaluationController` |
| `src/counselor/controllers/training-session.controller.ts` | 新增 `GET :id/evaluation`（挂在会话下面，与 consent / hints / marks / bookmarks 五个兄弟端点同款） |
| `src/migration/index.ts` | 导出 `CreateSessionEvaluations1714900000030` |
| `bin/ormconfig.ts` | 登记 `CreateSessionEvaluations1714900000030`（**真注册点**，漏登记会静默不建表） |

### 2.3 测试（2）

| 文件 | 改了什么 |
|---|---|
| `test/counselor/wp43-evaluation-engine.spec.ts` | **新增 27 例**：算分规则（13）/ 插槽（5）/ 落库口径（4）/ 查询口径（2）/ 端点契约（3） |
| `test/engine-adapters/wp43-evaluation-wiring.spec.ts` | **新增 7 例**：引擎侧接线（内核出参投影 / 收尾才交办 / 二次 close 不重复交办 / 重连重置 / 缺会话 id 或学员身份不交办 / 一轮没跑不交办 / 快照缺字段健壮兜底） |

---

## 3. 关键设计决策（与任务单有出入的地方 + 为什么）

### 3.1 跨层走 voice 层 @Global 插槽，**不新建 engine → counselor 反向依赖**

引擎侧要触发评估，业务侧要算分落库 —— 若引擎直接注入评估服务，就是 `engine-adapters → counselor` 的**反向依赖**（仓库明令禁止）。

**修法与 `StudentRiskAuditRegistry` / `CharacterVersionRegistry` / `VoiceSessionBridgeRegistry` 同款**：voice 层只声明接口 + 全局注册表；引擎侧只认接口，收尾时把本场出参交给注册表；业务侧在 `onModuleInit` 注册实现。两侧互不认识对方的具体类型。

插槽形状是**纯数据**（不带任何 engine-core 类型）—— 跨层契约越窄越不容易漂：业务侧不认识内核快照类型，内核改一个字段也不会带崩业务。

### 3.2 引擎侧累计 / 业务侧算分

每轮内核出参由**引擎后端**按会话累计（与逐字稿 / 用量同生命周期：openSession 重置、closeSession 清空），closeSession 时一次性交给插槽；**业务侧**算分并落库。

为什么不在引擎侧算分：评分规则是**业务口径**（哪些行为加分、伦理占多少权重），放引擎侧就等于让装配层懂临床。放业务侧则规则只有一份（`evaluation-engine.ts`），引擎侧只搬数据 —— 插槽一旦长出规则，两侧就会各有一份口径。

### 3.3 覆盖写而非追加行

一场会话一份评估（`session_id` 唯一）。会话被重开 / 续接时会重算，**新的是全量、旧的过时** → 覆盖。堆行的话列表里会出现同一场两行，用户看不懂哪份是真的。

### 3.4 BDI 变化维度取 4 维，纽带感只留档

任务单表格列了信任 / 安全感 / 阻抗 / 情绪 4 项 —— 与 WP42 同盟三维（trust / safety / bond）合起来是 5 项。本单**按任务单取 4 项**（trust / safety / resistance / valence），`bond` 的首末差值落 `rawStats.bondDelta` **不单独计分**（任务单未列）。理由：纽带感没有"越高越好"的单调含义，混进平均分会污染 BDI 维度的分；先留档、等有数据校准再决定要不要计分。

### 3.5 阻抗是**反向**口径

任务单表格写"阻抗变化 = 最后一轮 resistance − 第一轮 resistance"。但阻抗下降 = 来访更能展开 = **表现更好**。字面照做会让"阻抗下降"得低分（方向反了）。

**实现口径**：`first.resistance − last.resistance`（取负号），并在本单测试里锁死（阻抗 0.9 → 0.4 = 75 分；0.4 → 0.9 = 25 分）。

另外：三维阻抗取**话量维**（`resistance.verbal`）—— 三层里唯一直接对应"来访愿不愿多讲"的一维。

### 3.6 空场次不落库

一轮都没跑 → **没有事实** → 不写一条 0 分（那会让人以为"这场表现极差"）。空场次返回全 0 分是纯函数层的行为，落库层直接跳过。

### 3.7 评估失败只记 warn，不反过来搞挂会话收尾

落库失败由插槽层记 warn（只记错误**类型**，不带 message —— 隐私红线：报错文案可能带心理内容片段），会话照常收尾。与 trace flush / WP12 收尾同款语义。

### 3.8 评分刻度是**工程种子值**，不新增 env 键

任务单给了"每维 0-100 / 正向次数越多越高 / 负向次数越多越低"的形状，**没给具体刻度**。本单取一组可解释的默认值并**集中成常量**（`evaluation-engine.ts` 顶部）：

| 常量 | 值 | 含义 |
|---|---|---|
| `POSITIVE_TECHNIQUE_SCORE_PER_HIT` | 25 | 正向手法每次 +25（4 次封顶 100） |
| `NEGATIVE_TECHNIQUE_PENALTY_PER_HIT` | 25 | 负向手法每次 −25（4 次扣到 0） |
| `BOUNDARY_CROSS_PENALTY_PER_HIT` | 50 | 边界越界每次 −50（2 次扣到 0，严重项单独一档） |
| `BDI_CHANGE_NEUTRAL_SCORE` / `BDI_CHANGE_SCORE_SCALE` | 50 / 50 | 变化 0 = 50 分，变化 1.0 = ±50 分 |
| `ETHICS_WARN_PENALTY` / `ETHICS_BLOCK_PENALTY` | 20 / 40 | warn −20 / block −40 |
| `TOTAL_WEIGHT_TECHNICAL / _BDI / _ETHICS` | 0.6 / 0.2 / 0.2 | 总分权重（**任务单给定**） |

**不新增 env 键**（会触发 WP48 的 env 守卫机制：配了不生效的键正是 WP48 挖出来的盲区）；刻度集中一处 + 注明"待真实数据校准"，与内核 `DeltaCapConfig` / `RecallPolicyOptions` 同款纪律。

### 3.9 偏差：接口路径与任务单 §2.4 不一致

任务单写的两条路径在本仓**都不存在**，已按仓库既有范式落地：

| 任务单 §2.4 | 本单最终落地 | 为什么 |
|---|---|---|
| `GET /counselor/sessions/:sessionId/evaluation` | **`GET /counselor/training-sessions/:sessionId/evaluation`** | 仓库里没有 `/counselor/sessions` 这条前缀；五个兄弟端点（consent / hints / marks / bookmarks / transcript）全挂在 `/counselor/training-sessions/:id/*` 下。另起一条路径 = 同一份数据两个路径，迟早漂 |
| `GET /counselor/users/me/evaluations` | **`GET /counselor/evaluations`** | 本仓没有 `users/me` 约定；学员端"我的 XX"一律是 `@CurrentUser()` 取当前用户 + 资源路径（`/counselor/training-sessions` 就是"我的会话列表"，`/counselor/ability` 是"我的能力画像"）。加一个 `me` 变体会是孤例 |

### 3.10 偏差：`closeSession` 圈复杂度触顶 → 抽出两个私有方法

`closeSession` 原本已到仓库 eslint 上限 20（代码注释里写着"已到 20 的上限"）。加评估逻辑后必然超标。

**处置**：抽出两个**独立决策**成私有方法 —— `finalizeSessionEvaluation`（评估交办）与 `reportSessionCost`（单场成本日志，与已有的 `clearRiskMonitor` 同款理由）。**行为逐字不变**（成本日志的"按句柄判定、只打一次"语义原样保留），只是把决策从收尾流程里挪出去。

### 3.11 快照字段按"可能缺失"读（`numberOr` 兜底）—— 评估绝不能搞挂主链路

内核快照的字段是**逐步加上去**的：`safety` / `bond` 是 WP42 才有的，`events` 是 WP38 才有的，`resistance` / `emotion` 是 WP1 的。接续**旧会话**（WP32 的 Redis 状态持久化里存着 WP42 之前写的快照）时，读到的快照就是**缺字段**的。

如果直接解引用 `snapshot.resistance.verbal`，整个对练回合会抛错 —— 而评估只是**增强**能力，绝不能因为"想打个分"把主链路搞挂（同 riskAudit / traceRecorder 的口径）。所以投影一律走 `numberOr(value, fallback)`（缺失 / 非有限数 → 兜底值）。

**这条是实测撞出来的**：全量闸门第一轮里，既有测试的精简快照 stub（只给部分字段）让整轮 throw → 连带 6 例既有测试变红。修完即恢复 —— 也证明"评估不能搞挂主链路"这条纪律不是口号。

### 3.12 触发时机：会话结束（`closeSession`），自动

任务单 §五 待确认项 2 建议自动触发 —— 已按自动落地。用户无感，不加"生成评估"按钮。

---

## 4. 闸门数字

| 闸门 | 命令 | 结果 |
|---|---|---|
| ESLint | `npx eslint "{src,test,bin}/**/*.ts"` | **0 error**（2 个 warning 是**既有**的 `counselor.module.ts` `import/order`（drills 两个 import 的历史顺序），与本单无关） |
| 类型 | `npx tsc -p tsconfig.build.json --noEmit` | **0 error** |
| 单测 | `npx vitest run test/counselor/wp43-evaluation-engine.spec.ts` | **27 例全绿** |
| 单测 | `npx vitest run test/engine-adapters/wp43-evaluation-wiring.spec.ts` | **7 例全绿** |
| 全量 | `npx vitest run --exclude "**/e2e/**/*.ts"` | **121 文件 / 2044 例全绿** |
| 内核红线 | `git diff --stat HEAD -- src/engine-core` | **空（0 文件 / 0 行）** |

> ⚠️ 闸门跑批期间有**并行会话**在改 `src/admin-debug/debug-session-title.generator.ts` / `src/admin-debug/debug-session.service.ts`，中途一度产生 4 个 lint error（prettier / max-len）。**不是本单文件**，对方改完后已自行修复 —— 现全仓 eslint 0 error。提交时注意别把并行会话的改动一起带上。

> 部署顺序提醒：`session_evaluations` 是新表 → **必须先 `pnpm migration:run` 再起服务**，否则写库报 `Table 'session_evaluations' doesn't exist`。

---

## 5. 前端对接契约（最终路径）

| 端点 | 方法 | 鉴权 | 说明 |
|---|---|---|---|
| `/counselor/training-sessions/:id/evaluation` | GET | JWT | 单场快评详情（不在则 404，message = "该训练会话暂无快速评估"） |
| `/counselor/evaluations?page=1&pageSize=20` | GET | JWT | 我的快评列表（`pageSize` 上限 100，按创建时间倒序） |

详情响应体：`{ sessionId, overallScore, technical, bdiDelta, ethics, rawStats, createdAt }`。
列表响应体：`{ items: [{ sessionId, overallScore, safetyLabel, crisisCount, createdAt }], total, page, pageSize }`。

---

## 6. 未做 / 后续

1. **评分刻度未用真实数据校准** —— 当前是工程种子值（§3.8）。建议等 WP44（成长档案）有真实分布后再调。
2. **BDI 变化只取首末轮**（任务单口径），没做逐轮回归 / 斜率。趋势信息已足够支撑"提升幅度"，要做趋势图留给 WP44。
3. **纽带感未计分**（§3.4）—— 只留 `rawStats.bondDelta`。
4. **resumed 会话只统计本次连接内的轮次** —— openSession 重置评估台账（重连 = 新一场口径，与逐字稿同生命周期）。跨会话接续的完整评估留给后续。
5. **伦理维度只统计内核 safety 判定** —— 前置 safety gate（`riskProbe`）的判定不计入（那是"学员侧危机处置"链路，与"咨询师侧伦理表现"是两件事，避免双计）。
