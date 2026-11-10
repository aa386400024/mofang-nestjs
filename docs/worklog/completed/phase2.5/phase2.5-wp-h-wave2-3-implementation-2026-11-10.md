# Phase2.5 WP-H 第二/三波 + 批次可观测性收口 · 交付记录

- 日期：2026-11-10
- 执行方：MiniMaxCode
- 委托方：主 Agent（豆包）
- 上游依据：[`wp-h-render-availability-fix-task.md`](../../pending/wp-h-render-availability-fix-task.md) 第五节改动 5~9 + [`wp-h-wave2-3-and-observability-task-2026-11-10.md`](../../pending/wp-h-wave2-3-and-observability-task-2026-11-10.md) §2.2
- 基线 HEAD：`f59c307`（分支 `integrate`）
- 第一波交付记录：[`phase2.5-wp-h-wave1-render-availability-implementation-2026-11-09.md`](phase2.5-wp-h-wave1-render-availability-implementation-2026-11-09.md)

---

## 一、本单做了什么（落点表）

| 编号 | 规格 | 落点 | 状态 |
|---|---|---|---|
| 改动 5 | `degraded_turns` 拆双计数器 | 实体新增 `counselor_degraded_turns` / `visitor_degraded_turns`；迁移 `1714900000039`；`_heavy_degraded` 判定所需字段就绪（写入侧归主 Agent） | ✅ 本单交实体列 + 迁移 + 迁移回填口径 |
| 改动 6 | 渲染降级率独立指标 | 实体新增 `render_fallback_turns` / `llm_call_turns` / `render_fallback_ratio`；`GET /admin/api/auto-practice/batches/:id` 返回批次级聚合 | ✅ 实体 + 端点聚合 |
| 改动 7 | `prompt_tokens` 归约链 | provider → chunk 契约 → 渲染适配器 → 留痕 trace 全链穿透（**按真实根因修**，见偏差 A1） | ✅ 链路修复 |
| 改动 8 | `engine_version` 自动派生 | `inference-fingerprint.service.ts`：`ENGINE_VERSION` 优先，否则 `git describe --always --dirty`，无 git 回落 `unknown` | ✅ |
| 改动 9 | 批次有效性门禁 | 新表 `ap_practice_batches`（迁移 `1714900000040`）+ `PracticeBatchHealthService` + 端点返回 `batchHealth` 与不合格时的 `warning` | ✅ |
| 新增 10 | 日志降噪开关 | `DB_QUERY_LOGGING`（缺省 false）→ TypeORM `logging` 级别数组；`error`/`warn`/`migration` 永远保留 | ✅ |
| 新增 11 | WS 空房间短路 | `AutoPracticeGateway.publishToSession`：空房间直接 return（不序列化不 emit），降为 debug 且同场次只打一次 | ✅ |
| 新增 12 | 逐字稿批次索引 | `data/debug-sessions/_batches/<key>.json`（只有 id 与枚举，零对话文本） | ✅ |

### 【交接】实体列与迁移已落地

- 迁移文件名：`src/migration/1714900000039-AddPracticeSessionRenderMetrics.ts`（类 `AddPracticeSessionRenderMetrics1714900000039`，另一笔 `1714900000040-CreateAutoPracticeBatches.ts` 建批次结论表）
- 新列：`counselor_degraded_turns` / `visitor_degraded_turns` / `render_fallback_turns` / `llm_call_turns` / `render_fallback_ratio`
- 列定义：前四列 `INT NOT NULL DEFAULT 0`；`render_fallback_ratio` `DECIMAL(5,4) NULL`
- up/down 已验证：**是**（`migration:show` 正确列出 → `migration:run` 建列 → `migration:revert` 五列干净删除 → 再 `migration:run` 复原；DB 现为 33 列，逐列核对类型/默认值通过）
- `practice-runner.service.ts` 未改动：**是**（本单全程未触碰该文件与 `test/auto-practice/practice-runner.spec.ts`）

**计数写入侧交给主 Agent 的口径**（`practice-runner.service.ts` 落地时照此写）：

| 列 | 写什么 | 口径 |
|---|---|---|
| `counselor_degraded_turns` | 咨询师侧降级轮数 | 每轮**最多 +1** |
| `visitor_degraded_turns` | 来访者侧降级轮数 | 每轮**最多 +1** |
| `degraded_turns`（旧列，保留） | `max(counselor, visitor)` | 维持旧语义可读性，不改口径 |
| `render_fallback_turns` | 来访者侧走兜底的总次数 | 渲染结果 `providerHint === 'degraded'` 时 +1 |
| `llm_call_turns` | 来访者侧真实调用的轮数 | 与上一行互斥 |
| `render_fallback_ratio` | `render_fallback_turns / turn_count` | 写时计算；**分母为 0 时留 NULL**（= 未知，不是 0） |

---

## 二、关键设计决策与偏差说明

### 偏差 A1 · 改动 7 的真实根因与任务单描述不同（**按真实根因修**）

任务单原文写的是"`prompt_tokens` 链路没带"。核查后的真实根因是：

- **聚合路径（`llm-render.adapter.ts:289`）本来就带 `promptTokens`**（WP24 已修过）—— 缺的不是这一段；
- **流式路径**只出 `completionTokens` / `totalTokens`，因为上游流式只给累计 `tokenCount`；
- **关键漏点在更上游**：`src/llm/common/base/openai-compatible-chat.provider.ts` 的 `applyChunkUsage` 读到了 `usage_metadata.input_tokens`，却只把 `input + output` 合成 `tokenCount` 累加，**把 input 拆分直接丢弃**；而 `ChatCompletionChunk` 契约里根本没有 prompt/completion 字段。

也就是说：**上游一直报着输入侧用量（OpenAI 兼容的 `usage.prompt_tokens` → LangChain 的 `usage_metadata.input_tokens`），是本仓在 provider → chunk → 适配器的归约链上把它丢了**，于是"流式路径没有 prompt_tokens"被当成"上游没报"，传了整整三批数据。

因此修复落在**契约层**而不是改 `debug-session.service.ts` 的 `?? 0`：

1. `ChatCompletionChunk` 增加 `promptTokens?` / `completionTokens?`（**可选 = 没报**，不是 0）；
2. provider 的 `applyChunkUsage` 保留 input/output 拆分（抽成可单测的纯函数 `resolveChunkUsageSplit`）；
3. 渲染适配器的流式累计器 `StreamUsageAccumulator` 吃下**每一条** chunk（含没有 delta 的收尾块 —— 上游的 usage 正是收尾时才到齐），`buildStreamOutcome` 如实输出；
4. `DebugTurnTrace.llmUsage.promptTokens` 由 `number` 改成 `number | null`：**null = 上游没报（不可得）**，不再用 0 冒充"输入侧免费"。既有消费方（`cost-view.ts` 的 `?? 0`、runner 的 `?? 0`）本来就是 null-safe，**不需要改**。

### 偏差 A2 · "上游未报时落 null" 在**落库层**做不到（规格原文照抄，落地时按本条执行）

原任务单改动 7 要求"上游未报时保持 null 而不是写 0"。本单做到的是**链路层**（trace 的 `promptTokens` 为 `null`）；**落库层**做不到，原因两条：

- `ap_practice_sessions.prompt_tokens` 是 WP-F 迁移 `1714900000037` 建的 `INT NOT NULL DEFAULT 0` 列 —— 不是本单建的，改它的列可空性属于改动 WP-F 的 schema；
- 写入 `prompt_tokens` 的代码在 `practice-runner.service.ts` 里，**归主 Agent**（本单一行不许动）。

等价的诚实信号是既有的 `cost_basis`：上游没报输入侧 → `promptTokensAvailable = false` → `cost_basis = 'output_only'`（下界），上游报了 → `cost_basis = 'full'`。这条链路本单修好后就自动生效。

### 偏差 A3 · 改动 9 的"批次状态写为 INVALID"落成**独立表**而非独立列

原任务单允许"写为 INVALID（或独立列 `validity_flags`）"。本单选了独立表 `ap_practice_batches`（迁移 `1714900000040`）：

- `ap_practice_sessions` 是**场次**表，批次是"一组场次"，它的结论没有地方安放；往场次表里塞批次级状态位会让一场场次携带不属于它的结论；
- 一批一行，字段：`valid` / `validity_flags` / `llm_call_ratio` / `fallback_ratio` / `counter_consistent` / 三个计数合计 / `engine_version`。

### 偏差 A4 · 批次门禁是**读时算**的，不等"跑完"

原任务单写"批次跑完时计算 `batch_health`"。本单改成：判定永远是**读时算**（每次 `GET /batches/:id` 按当前库里的场次重算并落库），队列侧只在"本批全部跑完"的那一次额外落库 + 写索引。

理由：批次跑到一半时前面几场就已经可能不合格（整场 0 token / 全程兜底），早标出来早提醒人；等"跑完"再判等于让人先看完一堆不可用的数据。

### 偏差 A5 · 新增 10 的 `slowQuery` 阈值是**新增**的，不是"保留"

原任务单写"慢查询（`slowQuery` 阈值 1000ms）保留"。核查发现本仓此前**并没有**配这个阈值（`grep maxQueryExecutionTime` 全仓无命中）。本单按任务单口径把它显式配上（`maxQueryExecutionTime: 1000`），并保证 `warn` 级别永远保留 —— TypeORM 的慢查询是按 `warn` 落的，关掉 warn 就等于把"这条 SQL 跑了 3 秒"一起静音了。

另外 `development.ts` 原来是 `logging: true`（**全开**），本单改为与生产同口径的级别数组（缺省 `error|warn|migration`）。

### 偏差 A6 · 改动 6 的兜底率给了**两个口径**

原任务单改动 6 说"批次级三者之和"，改动 9 说"fallback_ratio 的批次均值"。本单两个都给，避免二选一：

- `metrics.renderFallbackRatio` —— **批次均值**（各场次 ratio 的平均），改动 9 的门禁用它；
- `metrics.renderFallbackRatioWeighted` —— **加权值**（合计兜底轮 / 合计轮数），各场次轮数差异大时它更接近"这批真实兜底了多少"。

### 偏差 A7 · 新增 12 的单场索引用 `scope` 区分

任务单给的索引形状里 `batchId` 是字符串。单场实时跑没有 batchId（`batchId = null`），本单把单场的 `batchId` 写 `null` 并加一个 `scope: 'single' | 'batch'` 字段区分，文件名用 `practiceSessionId`（nanoid，与批次 id 不冲突）。

---

## 三、闸门数字（全部实测，命令原样可复跑）

| 项 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npx tsc -p tsconfig.build.json --noEmit` | **exit 0**，0 error |
| Lint（改动文件） | `npx eslint --no-cache <23 个改动文件>` | **0 error / 0 warning** |
| 本单新增单测 | `npx vitest run test/auto-practice/wp-h-wave2-3-batch-observability.spec.ts` | **25 例全绿** |
| 本单新增单测 | `npx vitest run test/engine-adapters/wp-h-wave2-3-prompt-tokens.spec.ts` | **7 例全绿**（合计 32 例） |
| 全量回归 | `npx vitest run` | **4 failed / 2621 passed / 19 skipped（2644）** |
| 迁移 0039 | `migration:show` → `run` → `revert` → `run` | up/down **双向可执行**，DB 复原为 33 列 |
| 迁移 0040 | `migration:show` → `run` → `revert` → `run` | up/down **双向可执行**，表建/删各一次成功 |
| `engine-core` 零改动 | `git diff --stat HEAD -- src/engine-core` | **输出为空** |

### 全量回归的 4 条失败（**与本单无关，失败集合未扩大**）

基线是"4 failed / 2575 passed"，4 条全是主 Agent 提交引入的既有问题（`POST`/`GET characters` 路由重名 3 条 + `MAX_DEBUG_SESSIONS` 用例未同步 1 条）。本次全量仍是**同样这 4 条**，一条不多：

| 文件 | 用例 |
|---|---|
| `test/admin-debug/debug-session-persistence.spec.ts` | ② 保留最近 50 个会话 › 超出 500 个 → 最旧的被自动删掉（`MAX_DEBUG_SESSIONS`） |
| `test/admin-debug/wp26-admin-role-guard.spec.ts` | ⑥ 4 个端点全部覆盖 › 全部端点（含 WP30 / WP31 新增的）的有效 guard 都含 AdminRoleGuard |
| `test/admin-debug/wp30-admin-real-api.spec.ts` | ⑤ 4 个新端点全部继承 AdminRoleGuard |
| `test/admin-debug/wp31-cost-board.spec.ts` | ⑤ 守卫继承 › 2 个新端点都是 GET 且有效 guard 含 AdminRoleGuard |

**未修、未 skip、未改断言**（本单红线）。passed 从 2575 涨到 2621：本单新增 32 例 + 主 Agent 并行的 WP-J 新增用例。

---

## 四、改动文件清单

### 新增（7）

| 文件 | 作用 |
|---|---|
| `src/migration/1714900000039-AddPracticeSessionRenderMetrics.ts` | 改动 5/6 的五列迁移（up 加列回填 0 / down 干净删列） |
| `src/migration/1714900000040-CreateAutoPracticeBatches.ts` | 改动 9 的 `ap_practice_batches` 新表 |
| `src/auto-practice/entities/practice-batch.entity.ts` | 批次结论实体（13 列） |
| `src/auto-practice/practice-batch-health.service.ts` | 批次指标聚合 + 有效性门禁 + 逐字稿索引（纯函数 + 服务） |
| `src/config/envs/db-logging.ts` | `DB_QUERY_LOGGING` 解析（纯函数，dev/prod 共用） |
| `test/auto-practice/wp-h-wave2-3-batch-observability.spec.ts` | 改动 6/8/9 + 新增 10/11/12 的单测（25 例） |
| `test/engine-adapters/wp-h-wave2-3-prompt-tokens.spec.ts` | 改动 7 的单测（7 例） |

### 修改（20）

| 文件 | 改了什么 |
|---|---|
| `src/auto-practice/entities/practice-session.entity.ts` | 改动 5/6 的五列 + 文件头说明（历史不可反推的口径写进注释） |
| `src/auto-practice/auto-practice.controller.ts` | `GET /batches/:id` 返回批次指标 + `batchHealth` + 不合格时的 `warning`；单场跑完写索引 |
| `src/auto-practice/auto-practice.gateway.ts` | 新增 11：空房间短路（不 emit / 同场次只打一条 debug / 场次结束清理） |
| `src/auto-practice/auto-practice.module.ts` | 注册 `PracticeBatch` 实体 + `PracticeBatchHealthService` |
| `src/auto-practice/practice-queue.service.ts` | 改动 9：job 跑完刷新批次健康（只在全批跑完时落库） |
| `src/auto-practice/inference-fingerprint.service.ts` | 改动 8：`ENGINE_VERSION` → `git describe --always --dirty` → `unknown` |
| `src/config/envs/development.ts` | 新增 10：`logging` 改级别数组 + 慢查询阈值 |
| `src/config/envs/production.ts` | 新增 10：同上（原 `logging: false`） |
| `src/llm/common/interfaces/chat-provider.interface.ts` | 改动 7：chunk 契约加 `promptTokens?` / `completionTokens?` |
| `src/llm/common/base/openai-compatible-chat.provider.ts` | 改动 7：保留 input/output 拆分（新增可测纯函数 `resolveChunkUsageSplit`） |
| `src/engine-adapters/rendering/llm-render.adapter.ts` | 改动 7：流式累计器吃下每条 chunk 的用量拆分 |
| `src/engine-adapters/rendering/streaming-render.port.ts` | 改动 7 的口径注释（原注释说"流式拿不到输入侧"，已过时） |
| `src/admin-debug/debug-session.service.ts` | 改动 7：`llmUsage.promptTokens` 改 `number | null`（没报 = null） |
| `src/migration/index.ts` | 注册两笔新迁移 |
| `bin/ormconfig.ts` | 注册两笔新迁移（import + `migrations[]` 数组，两处都改） |
| `typings/global.d.ts` | 登记 `DB_QUERY_LOGGING` |
| `.env.example` | 登记 `DB_QUERY_LOGGING=false`（附"批量跑批时保持 false"说明） |
| `docs/worklog/pending/phase2.5-README.md` | WP-H 行状态 + §3.2 出口条件 ③④ + §3.3 顺序 |
| `docs/worklog/pending/wp-h-render-availability-fix-task.md` | 顶部状态行改为"三波全交付" + 指向本交付记录 |
| `docs/worklog/completed/phase2.5/phase2.5-wp-h-wave2-3-implementation-2026-11-10.md` | 本文件 |

### 未触碰（主 Agent 的 WP-J 改动，本单不碰）

`src/auto-practice/practice-runner.service.ts`、`test/auto-practice/practice-runner.spec.ts`、`src/auto-practice/auto-practice.events.ts`、`src/auto-practice/counselor-agent.service.ts`、`test/auto-practice/dialogue-quality.spec.ts`、`src/engine-adapters/rendering/` 下的 prompt 文案、`scripts/ops/canary/`、`src/engine-core/**`。

---

## 五、遗留与后续

### 5.1 需要主 Agent 接着做（按依赖顺序）

1. **写计数**（本单已把列与迁移交到位，见 §一 的"计数写入侧口径"）：`practice-runner.service.ts` 里落 `counselor_degraded_turns` / `visitor_degraded_turns` / `render_fallback_turns` / `llm_call_turns` / `render_fallback_ratio`，并把 `_heavy_degraded` 的判定改成"两侧各自 `/ turnCount >= 0.5`"。旧列 `degraded_turns` 写 `max(counselor, visitor)`。
2. **跑批取证**（跑批由主 Agent 发起；本单不跑批量实验）：100 场级批次跑完后，先看 `GET /admin/api/auto-practice/batches/:id` 的 `batchHealth.valid` —— 不合格会直接带 `warning`，此时该批指标不可用于结论。
3. **复核成本口径**：改动 7 修好后 `prompt_tokens` 应落非 0、`cost_basis` 应从 `output_only` 升到 `full`；若仍是 0，说明上游流式没回 usage（LangChain 的 `streamUsage` + 上游 `include_usage`），需要另查上游返回。

### 5.2 本单已知的限制

1. **历史批次一律判不合格**：门禁依据（`render_fallback_turns` / `llm_call_turns`）在 WP-H 之前根本没统计，历史批次被读到时 `llm_call_ratio = 0` → `valid = false`。这是**安全方向**（宁可标成不可用，也不许它混进分析冒充合格数据），迁移注释里已写明。
2. **`render_fallback_ratio` 的历史行是 NULL**：= "没测过"，不是 0。批次均值只对**测过**的场次取平均；一个都没测过的批次会被打上 `FALLBACK_RATIO_UNKNOWN` 标记 → 不合格。
3. **`engine_version` 取的是进程工作目录的 git 状态**：容器里没有 `.git` 时回落 `unknown`（不抛错）。部署方想固定版本号，用 `ENGINE_VERSION` 显式覆盖。
4. **`DB_QUERY_LOGGING` 缺省关的是 query 级**：`error`/`warn`/`migration` 永远保留，慢查询（1000ms）按 warn 落，不会被静音。
5. **索引文件不是数据源**：`data/debug-sessions/_batches/*.json` 只是索引（id + 枚举），删掉不影响任何读取路径；权威数据仍是 DB 与逐字稿 JSON。

### 5.3 部署注意

- **必须先 `pnpm migration:run` 再起服务** —— 实体加了 5 列、新建了 1 张表，迁移没跑就是 `Unknown column` / `TableNotFound`。
- 起服务前仍按第一波金丝雀记录 §8 核对三件事（入口是 `dist/app.js`、mtime 晚于最后改码、启动日志有"单候选模式"与 `queue started concurrency=2`）。

---

## 六、commit message 草稿

```
fix(phase2.5): 指标可信度与版本追溯 (WP-H 第二/三波)

- degraded_turns 拆双计数器 + 回填 0 (历史不可反推)
- 新增 render_fallback_turns / llm_call_turns / render_fallback_ratio
- prompt_tokens 归约链补齐 (此前全库恒为 0; 真根因在 provider/chunk 契约层丢拆分)
- engine_version 改 git describe --always --dirty 派生
- 新增批次有效性门禁 (ap_practice_batches + batchHealth + warning), 不合格批次标记 INVALID 不进分析
- 跑批期关 TypeORM query 日志 (DB_QUERY_LOGGING, 缺省 false)
- WS 空房间短路 + 逐字稿批次索引 (不含对话文本)
```
