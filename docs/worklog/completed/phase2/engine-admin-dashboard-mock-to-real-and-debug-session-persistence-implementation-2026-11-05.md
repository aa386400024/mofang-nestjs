# Admin Dashboard 剩余页面切真 API + 调试会话持久化 · 交付记录

> 日期：2026-11-05
> 任务单：[`admin-dashboard-mock-to-real-and-debug-session-persistence-2026-11-05.md`](./admin-dashboard-mock-to-real-and-debug-session-persistence-2026-11-05.md)
> 范围：后端补 9 个端点 + 前端 3 页去 mock + 调试会话文件持久化
> 边界：engine-core 零改动 · 心理内容不进日志 · 不自动 commit/push

---

## 一、一句话

Admin Dashboard 最后三个 mock 页（Dashboard / MemoryBrowser / PsyGuardMonitor）全部切到真 API；调试会话从"刷新即丢"改成**落 JSON 文件**，刷新/重启不丢，跑满 3 轮自动起标题。

---

## 二、改了哪些文件

### 2.1 后端 · 新增（7 个）

| 文件 | 职责 |
|---|---|
| `src/admin-debug/insights-view.ts` | **纯函数层**：看板聚合 / 按天分桶 / 记忆条目映射 / PsyGUARD 视图。零 @nestjs / 零 typeorm / 零 IO |
| `src/admin-debug/admin-insights.controller.ts` | 5 个新端点（dashboard / dashboard/weekly-sessions / memories / psyguard / psyguard/trend） |
| `src/admin-debug/admin-insights.module.ts` | 洞察面的装配（鉴权中间件 + AdminRoleGuard + 向量库 + 探针） |
| `src/admin-debug/admin-scope.ts` | 归属过滤口径的**唯一实现**（原来散在 `AdminDebugController` 私有方法里） |
| `src/admin-debug/cost-pricing.ts` | **env 键 → 成本单价**的唯一映射（WP31 成本看板与本单仪表盘共用，见下方说明） |
| `src/admin-debug/debug-session-store.ts` | 调试会话的**文件存储**：建档 / 追加 / 改标题 / 标完成 / 列表 / 读 / 删 + 50 个上限淘汰 |
| `src/admin-debug/debug-session-title.generator.ts` | 会话标题自动生成（LLM 路由 + 窄端口 + 解析/兜底/截断） |

> **为什么多抽一个 `cost-pricing.ts`**：仪表盘要显示"总 token / 估算成本"，成本看板（WP31）已经在算成本。
> 两者都要读 WP24 的 `LLM_PRICE_INPUT_PER_1K` / `LLM_PRICE_OUTPUT_PER_1K`。
> 如果各抄一份键名，改了一处忘了另一处 → **看板上的数和单场成本日志里的数对不上**，
> 而这种漂移极难排查（数字差一点点，像数据问题不像配置问题）。
> 于是把"env 键 → 单价"收成**唯一一处**，两个控制器都调它；顺手把 WP31 的
> `AdminDebugController.resolveCostPricing()` 也改成调同一处（行为逐字不变）。
> `cost-view.ts` 是**纯函数层**（不读 env，定价由调用方注入），所以这个 env 读取没往那儿塞。

### 2.2 后端 · 新增（1 个，跨模块）

| 文件 | 职责 |
|---|---|
| `src/engine-adapters/wiring/risk/psyguard-health.module.ts` | 把 `PsyGuardHealthChecker` 抽成模块 —— 引擎装配层与 admin 洞察面**共用同一个探针实例** |

### 2.3 后端 · 修改（9 个）

| 文件 | 改了什么 |
|---|---|
| `src/admin-debug/admin-debug.controller.ts` | 归属过滤改为调用共享的 `buildOwnerFilter`（行为逐字不变，口径只有一份）；成本定价改为调用共享的 `resolveCostPricingFromEnv`（行为逐字不变） |
| `src/admin-debug/debug-session.service.ts` | 接持久化：建会话建档 / 每轮追加 / 关会话标完成 / 3 轮后异步起标题；新增 4 个历史会话方法 |
| `src/admin-debug/debug-session.controller.ts` | 新增 4 个历史会话端点（GET list / GET :id / PATCH :id / DELETE :id） |
| `src/admin-debug/admin-debug-chat.module.ts` | 注册 `DebugSessionStore` + 标题生成端口（useFactory），import `LlmModule` |
| `src/engine-adapters/wiring/engine.module.ts` | `PsyGuardHealthChecker` 的 provider 挪进 `PsyGuardHealthModule`（装配位置变了，行为不变） |
| `src/engine-adapters/wiring/risk/psyguard-health.checker.ts` | `check()` 加空地址短路（没配服务时不必每次都走一遍异常 + warn 日志） |
| `src/app.module.ts` | 注册 `AdminInsightsModule` |
| `.gitignore` | 加 `data/debug-sessions/`（这些文件含心理内容，绝不进版本库） |
| `.env.example` | 登记 `ADMIN_DEBUG_SESSION_DIR`（**WP25 机器守卫要求**：代码里读的每个 env 键都要在模板里有生效行） |

### 2.4 前端 · 修改（7 个）

| 文件 | 改了什么 |
|---|---|
| `admin-dashboard/src/api/client.ts` | 5 处 mock → 真 fetch（dashboard / weeklySessions / memories / psyguard / psyguardTrend）+ debugSession CRUD 的返回类型补准 |
| `admin-dashboard/src/api/types.ts` | 契约换真：`MemoryEntry`（内核口径）/ `MemoryListResponse` / `DashboardStats` 加 3 字段 / `PsyGuardStats` 加 3 字段 / 新增 `PsyGuardTrend` |
| `admin-dashboard/src/views/Dashboard.vue` | 去 "Pending" 空态标识；加「平均轮次」卡片（网格改 5 列自适应）；PsyGUARD 卡片与风险分布卡在"指标未采集"时显示「—」而不是 0 |
| `admin-dashboard/src/views/MemoryBrowser.vue` | 接真 API；「类型」维度换成内核真有的「来源」维度；区分"记忆库不可用"与"暂无记忆"两个空态 |
| `admin-dashboard/src/views/PsyGuardMonitor.vue` | 接真 API；**修掉图表配置非响应式的 bug**（同 WP31 成本看板那个坑）；指标未采集时不画假曲线 |
| `admin-dashboard/src/views/SessionDetail.vue` | 跟随 `MemoryEntry` 契约改动（type → source / source → tier） |
| `admin-dashboard/src/i18n/locales/{zh-CN,en}.ts` | 各加 11 条文案（平均轮次 / 指标未采集 / 记忆库不可用 / 加载中等） |

### 2.5 测试（4 个）

| 文件 | 例数 | 覆盖 |
|---|---|---|
| `test/admin-debug/admin-insights.spec.ts` | 20 | 5 个新端点 + 口径（分桶 / 成本 / 轮次分母 / 归属隔离 / 指标未采集）+ 路由与守卫 |
| `test/admin-debug/debug-session-persistence.spec.ts` | 26 | 真文件落盘（建档/追加/原子写/标题覆盖规则/列表/删除/坏文件跳过/路径穿越防护/50 上限）+ 服务编排（3 轮触发命名 / 失败兜底 / 人工改名不被覆盖 / 关会话标完成 / 失败后下一轮照常跑） |
| `test/admin-debug/wp26-admin-role-guard.spec.ts`（改） | +1 | 路由清单扩到洞察面的 5 个新端点（class 级守卫自动继承） |
| `test/admin-debug/wp58-debug-session.spec.ts`（改） | +1 | 新增 4 个历史端点的路径/方法断言；服务构造补两个新依赖（内存版存储替身 + 标题生成替身） |

> ⚠️ **持久化 spec 的异步断言用的是"轮询到条件成立"，不是"等固定几拍"。**
> 标题生成是 fire-and-forget + 3 次本地文件 I/O（读记录 → 调生成器 → 写回）；全量回归时
> 111 个测试文件并行抢 CPU，固定拍数（`setTimeout(1ms)` × 5）**等不起** —— 首轮全量回归
> 就实测挂过 1 例（单跑绿 / 全量红）。现在正向断言用 `waitFor(条件)`，否定断言用
> `settleAsync()`（留 200ms 余量后再断言"没发生"，否则触发条件写错时会**假绿**）。

---

## 三、接口契约

### 3.1 新增 5 个（洞察面）

| 端点 | 返回 | 口径要点 |
|---|---|---|
| `GET /admin/api/dashboard` | `{totalSessions, todaySessions, crisisHits, totalTokens, estimatedCostCny, avgTurnsPerSession, sessionsScanned, truncated, psyguard}` | 会话数来自**会话表**（全量 count）；token/轮次/危机/成本来自**留痕**（受 2000 场扫描窗口约束）；`psyguard` 子视图与 `/psyguard` 同源 |
| `GET /admin/api/dashboard/weekly-sessions` | `{date, count}[]` | 行数恒 7，Asia/Shanghai 分桶，没有会话的天补 0 |
| `GET /admin/api/memories` | `{entries, scope, source, total, limit}` | `scope` 恒 `long_term`；`source` = `qdrant`（读到了）/ `unavailable`（向量库读不到）；上限 500 条 |
| `GET /admin/api/psyguard` | `{status, modelLoaded, contractOk, metricsAvailable, p50Ms, p90Ms, totalRequests, byCategory, checkedAt}` | 状态是**实时探活真值**；`metricsAvailable` 恒 `false`（后端未采集指标）→ 三个数字恒 0 |
| `GET /admin/api/psyguard/trend` | `{metricsAvailable, points}` | `points` 行数恒 7，全 0 + `metricsAvailable: false` |

### 3.2 新增 4 个（调试会话历史）

| 端点 | 返回 | 与既有端点的区别 |
|---|---|---|
| `GET /admin/api/debug/sessions` | `[{id, title, characterSlug, createdAt, updatedAt, turnCount, status}]` | — |
| `GET /admin/api/debug/sessions/:id` | `{id, title, titleSource, characterSlug, characterLabel, createdAt, updatedAt, status, turnCount, messages[]}` | `messages[].trace` **挂在来访者那条上**（与前端实时路径同款） |
| `PATCH /admin/api/debug/sessions/:id` | `{id, title}` | 标题置空 → 400；会话不存在 → 404 |
| `DELETE /admin/api/debug/sessions/:id` | `{id, deleted}` | **真删文件**（见下方 ⚠️） |

> ⚠️ **`/debug/session/:id` 与 `/debug/sessions/:id` 只差一个 s，是两件事**：
> - `DELETE /debug/session/:id` = **关会话** → 释放内核句柄 + 文件标 `completed`，历史**还在**；
> - `DELETE /debug/sessions/:id` = **删会话** → 文件删掉，这条历史**彻底没了**。
>
> 字面路径不同（`session` vs `sessions`），Express 不会互相命中；但读代码容易看串，所以写进了两个文件的文件头与端点注释。**建议后续把"删历史"改成 `DELETE /debug/sessions/:id` 之外的显式动作（如 `POST /debug/sessions/:id/purge`），或在前端按钮上二次确认文案里点明"不可恢复"。**

---

## 四、偏差表（任务单 vs 实际落地）

| # | 任务单写的 | 实际落地 | 为什么 |
|---|---|---|---|
| B1 | WP58 的纪律是「调试会话不落库」 | 改成「落 **JSON 文件**，**仍然不写** `training_sessions` / `turn_debug_trace`」 | 这是对 WP58 纪律的**扩展**（从纯内存 → 文件持久化），不是推翻：不污染学员的正式场次表。登记在此，避免将来有人按 WP58 的原话判"越界" |
| B2 | ①「总 token / 平均每会话轮次」未说窗口 | token / 轮次 / 成本 / 危机命中都受 **2000 场扫描窗口**约束；会话数是全量 count | 每场都要读 `turn_debug_trace`（JSON 列，单场几 KB），无上限扫描 = 一个看板请求拖垮库。窗口与 WP31 成本趋势同款；`sessionsScanned` / `truncated` 写在返回体里 |
| B3 | ②「如果是 Qdrant，就从 Qdrant 查；如果是内存，就从内存查」 | 只查 **Qdrant**（长时记忆）；工作/短时记忆**拿不到** | 内核 `MemoryStore` 端口只有 `remember` / `recall`，**没有 list-all**；`InMemoryMemoryStore` 在 `src/engine-core/in-memory/` —— **红线不可改**。工作/短时记忆在进程内的会话级回落仓里，端口层看不见。`scope: 'long_term'` 写在响应里，页面别当"全部记忆" |
| B4 | ③「先返回 mock 值也行」 | 返回**真实探活状态**（reachable / modelLoaded / contractOk）+ `metricsAvailable: false` + 三个数恒 0 | 任务单允许 mock，但仓库铁律是"不编造数据"。全返固定 mock = 面板上的"运行中"是编的；现在状态是真的，缺的指标用**显式标志位**说清"是没数，不是 0 次"。真指标另开单（缺口 G1） |
| B5 | ② 前端 `MemoryEntry.type` = 事实/情感/关系/事件/偏好 | 换成内核真有的 **tier + source** 两维 | 后端**没有任何内容分类器** —— 那个五分类是前端自造的假维度，留着就是编造。换成内核真有的维度后，筛选 chip 与分布条照常工作 |
| B6 | ④「跑了 3 轮后自动用 LLM 生成会话标题」 | 阈值 = **第 3 轮整**；生成**异步**（不阻塞那一轮响应）；模型用 **`MEMORY_SUMMARY_MODEL`** 这个既有 env | ① 1 轮看不出在聊什么，2 轮太短；② 标题是锦上添花，不能让一轮 HTTP 等 3–8s 的 LLM；③ "从长文本抽要点"与会话摘要是**同一族任务**，仓库既有纪律是同一族用**同一个键**（再开 `DEBUG_TITLE_MODEL` = 两张会漂的模型表） |
| B7 | ④「存 `data/debug-sessions/{sessionId}.json`」 | 同上，但目录可用 env `ADMIN_DEBUG_SESSION_DIR` 覆盖 | 容器部署时可能要把调试数据挂到独立卷；测试也需要指向临时目录。**默认值就是任务单写的路径** |
| B8 | ④「保留最近 50 个会话，超过的自动删」 | 按**创建时间**倒序保留 50 个 | 若按"最后更新时间"排，一场跑了一半的老会话会被顶到前面 —— 新建会话反而把老会话挤没了，与"保留最近 50 个"字面意思相反 |
| B9 | ② 前端 `visitorAlias` 字段 | 后端**不返回**（内核没有来访者别名） | 内核 `visitorId` 是**归属键** `"{学员id}:{角色key}"`，不是人类可读名字。返回一个编出来的别名就是造数据。前端直接显示 `visitorId` |
| B10 | 未提"关会话"与"删会话"的关系 | 拆成两个端点（`/debug/session/:id` vs `/debug/sessions/:id`），并在两处文件头写明区别 | 见 §三 的 ⚠️ 框 |
| B11 | 未提模块归属 | 洞察面单独成 `AdminInsightsModule`，`AdminDebugModule` **零改动** | 洞察面要多依赖一个**向量库**（`QdrantService`），而 `AdminDebugModule` 被 `EngineWiringModule` import（为了 `TraceRecorder`）—— 塞进去依赖方向会变浑 |

---

## 五、闸门数字

| 闸门 | 命令 | 结果 |
|---|---|---|
| ESLint | `npx eslint "src/**/*.ts" "test/**/*.ts"` | ✅ **0 error / 0 warning** |
| TypeScript | `npx tsc -p tsconfig.build.json --noEmit` | ✅ **0 error** |
| 单测（仓库口径） | `npx vitest run --exclude '**/e2e/**/*.ts'` | ✅ **111 文件 / 1898 例全绿**（本单新增 46 例：洞察面 20 + 持久化 26） |
| engine-core 红线 | `git diff --stat HEAD -- src/engine-core` | ✅ **空**（零改动） |
| 前端类型 | `cd admin-dashboard && npx vue-tsc --noEmit -p tsconfig.app.json` | ⚠️ 10 处报错，**全部是既有的**（本单新增 **0** 处，见下表） |
| 文档链接 | 本单改动文档的 92 条本地链接 | ✅ **0 条断链** |

### 闸门踩坑（两处，都是真踩到了才写下来）

1. **`.env.example` 登记漏了 → WP25 机器守卫拦下**。
   守卫用例①（`test/config/wp25-env-example-coverage.spec.ts`）要求"代码里读的每个 env 键，
   `.env.example` 里都要有**生效行**（未注释的 `KEY=`）"。新加的 `ADMIN_DEBUG_SESSION_DIR`
   一开始只在代码里读了、没登记 → 首轮全量回归挂了这 1 例。已补进 `.env.example` 的
   「引擎调试与调参」段（`ENGINE_DEBUG_CHAT_DELIBERATION_WAIT_MS` 之后），守卫复跑 9/9 绿。
   **教训**：在仓库里新增 env 键 = **代码 + `.env.example` 两处**，不是一处。
2. **持久化 spec 的异步断言是 flaky 的**。首轮全量回归实测挂 1 例
   （`跑满 3 轮 → 自动生成标题`），**单跑却全绿** —— 典型的"机器快慢"问题：
   标题生成是 fire-and-forget + 3 次本地文件 I/O，全量回归时 111 个测试文件并行抢 CPU，
   原来那 5 拍 `setTimeout(1ms)` 等不住。已改成**轮询到条件成立**
   （正向断言 `waitFor(条件)` / 否定断言 `settleAsync()` 留 200ms 余量），复跑全绿。

---

## 六、运维须知

### 6.1 新增 env

| env | 默认 | 说明 |
|---|---|---|
| `ADMIN_DEBUG_SESSION_DIR` | `data/debug-sessions` | 调试会话 JSON 的存放目录。**含心理内容**（对话原文 + prompt 全文），务必放在**不进版本库**的位置（仓库已把默认路径写进 `.gitignore`）。**已在 `.env.example` 的「引擎调试与调参」段登记生效行** —— WP25 机器守卫（`test/config/wp25-env-example-coverage.spec.ts` 用例①）要求"代码里读的每个 env 键"在模板里都有生效行 |
| `MEMORY_SUMMARY_MODEL` | 走 router 默认（RAG 层模型） | **复用既有键**，没新增 —— 会话标题与摘要同族同键 |

### 6.2 新增依赖与模块

- `AdminInsightsModule` 已在 `AppModule` 注册；它 import `AIEngineModule`（为了 `QdrantService`）。
- `PsyGuardHealthChecker` 抽到 `PsyGuardHealthModule`，**引擎装配层与 admin 洞察面共用同一个实例** —— 启动自检仍然只探一次。
- `AdminDebugChatModule` 新增 `DebugSessionStore` provider 与标题生成端口（useFactory，依赖 `LlmRouterService` + `ConfigService`）。

### 6.3 上手要点

- **调试会话文件默认落在 `data/debug-sessions/`**（工作目录相对路径）。容器部署时若工作目录不可写，用 `ADMIN_DEBUG_SESSION_DIR` 指到可写卷；指不到时**调试会话仍能正常跑**（落盘失败只记 warn，不阻断引擎侧会话）。
- **文件里含 prompt 全文**（含 system prompt 与记忆上下文）—— 生产环境如需开调试面板，注意 `ENGINE_DEBUG_CHAT_ENABLED` 闸门 + 文件目录的访问权限。
- **`/admin/api/memories` 会把所有来访者的长时记忆正文吐给 admin** —— 与既有的 `/admin/api/sessions/:id`（返完整逐字稿）是**同一档**的内部调试能力，不是新的暴露面；但它必须留在 admin 鉴权后面（已挂 `AdminBasicAuthMiddleware` + `AdminRoleGuard`）。
- **留痕开关仍决定看板有没有数**：`ENGINE_DEBUG_TRACE_ENABLED` 生产缺省关 → token / 轮次 / 危机命中恒 0，但**场次数仍然准确**。看到"有场次但 0 token"就是留痕关了，不是 bug（与 WP31 同一口径）。

---

## 七、遗留 / 建议

### 缺口（真没做）

| # | 缺口 | 影响 | 建议 |
|---|---|---|---|
| G1 | **PsyGUARD 真指标没采集**（p50 / p90 / 请求数 / 类别计数） | PsyGuardMonitor 页的延迟趋势、请求量、类别分布全是"指标未采集" | 在 `HttpPsyGuardProbe` 那一层加一个指标收集器（延迟直方图 + 分类计数），落 Redis（多实例下内存计数会散）。**另开单** —— 要动热路径，按仓库纪律先讨论后实现 |
| G2 | **工作 / 短时记忆列不出来** | MemoryBrowser 只有长时记忆 | 内核 `MemoryStore` 端口加 `list` 能力（**需 engine-core 改动，走红线条**），或另建一张 MySQL 记忆索引表由写侧同步 |
| G3 | **调试会话文件不含"本场记忆"** | 调试面板看得到逐轮 trace，看不到引擎召回的记忆 | 引擎侧 `ENGINE_MEMORY_STORE` 的召回结果没进留痕契约；要加得扩留痕契约（`TurnTrace` 加可选字段，与 WP30 加 `trajectoryTrace` 同款做法） |
| G4 | **调试会话标题不参与检索** | 会话多了只能靠标题肉眼找 | 加 `title` 索引字段（`.json` 同目录的索引文件）或把标题编进文件名 |
| G5 | **删除历史会话无二次确认在后端** | 后端 `DELETE` 直接删文件 | 前端已 `confirm()`；后端如需审计，可加一条审计日志（当前不记，因为删除是调试操作、不含业务语义） |

### 建议（可另开单）

- **R1**：把 `DELETE /debug/sessions/:id` 改成显式的"清除历史"动作，或在前端确认文案里点明"不可恢复"（见偏差 B10）。
- **R2**：PsyGUARD 面板的 `metricsAvailable` 一旦为 true，前端的图表分支（现在 `v-if="!stats.metricsAvailable"` 走的是"不画图"分支）要跟着切回 —— 写的时候留了 `v-else` 分支，接上指标即可。
- **R3**：看板的 2000 场扫描窗口与 WP31 成本看板是**两个独立窗口**，两者相加可能扫到同一场两次 —— 真要提性能，应把"按时间窗扫留痕"抽成一个共享的仓储方法（现在两处各自 `find`）。
- **R4**：`SessionDetail.vue` 的"本场记忆"区块恒空（`/sessions/:id/memories` 恒返 `[]`，WP30 遗留）—— 要真数据得先解 G3。

### 既有 vue-tsc 报错（**非本单引入**，勿当本单的锅）

`npx vue-tsc --noEmit -p tsconfig.app.json` 当前 **10 处**报错，全部来自**本单没动过**的文件：

| 文件 | 处数 | 性质 |
|---|---|---|
| `admin-dashboard/src/views/DebugChat.vue` | 5（241 / 492 / 542 / 546 / 616） | 另一次 WP 的前端接线留下的（`sessionId`/`messages` 当成了普通变量、`RenderSpecSummary` 缺 `promptFull`） |
| `admin-dashboard/src/views/ParamCalibrator.vue` | 2 处 / 4 行（397 ×2、478 ×2） | `row` / `m` 可能为 undefined |
| `admin-dashboard/src/views/SessionDetail.vue` | 1（98） | `beliefActivation` computed 的返回类型不满足 `Record<string, number>`（WP57 遗留 mock） |

本单**新增 0 处**（改前 10 处、改后 10 处）。`SessionDetail.vue` 那 1 处因本单删了 2 行代码而行号从 100 移到 98，**性质不变**。

---

## 八、commit message 草稿

```
feat(admin): Dashboard/MemoryBrowser/PsyGuardMonitor 三页切真 API + 调试会话落 JSON 文件持久化（3 轮后 LLM 自动命名）
```
