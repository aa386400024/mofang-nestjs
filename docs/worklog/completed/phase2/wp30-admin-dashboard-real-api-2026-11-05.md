# WP30 · Admin Dashboard 切真 API · 任务单

> **状态**：✅ 已交付（2026-11-05）→ [`engine-wp30-admin-dashboard-real-api-implementation-2026-11-05.md`](engine-wp30-admin-dashboard-real-api-implementation-2026-11-05.md)
> **路径**：`docs/worklog/completed/phase2/wp30-admin-dashboard-real-api-2026-11-05.md`
> **优先级**：🔴 P0（商业化根基）
> **预估**：中
> **依赖**：无
> **边界**：engine-core 零改动；心理内容不进日志；不自动 git commit/push

---

## 一、任务目标

Admin Dashboard 里 **CharacterDetail（角色详情）** 和 **SessionDetail（会话详情）** 两个页面，现在还在用 mock 数据。本 WP 把它们切到真 API，去掉 mock 标识，让 admin 调试者能看到真实数据。

---

## 二、现状扫描（已核实）

### 2.1 后端已有的 admin API（`/admin/api/*`）

| 端点 | 用途 | 状态 |
|---|---|---|
| `GET /admin/api/sessions` | 会话列表 | ✅ 已实现 |
| `GET /admin/api/sessions/:id` | 会话详情（元信息 + trace + 逐字稿 + 报告） | ✅ 已实现 |
| `GET /admin/api/characters` | 角色池列表 | ✅ 已实现 |
| `GET /admin/api/health` | 引擎健康状态 | ✅ 已实现 |
| `POST /admin/api/debug/session` | 调试会话创建 | ✅ WP58 已实现 |
| `POST /admin/api/debug/session/:id/turn` | 调试会话轮次 | ✅ WP58 已实现 |
| `DELETE /admin/api/debug/session/:id` | 调试会话关闭 | ✅ WP58 已实现 |

### 2.2 前端 mock 清单（`admin-dashboard/src/api/client.ts`）

| 方法 | 用途 | 用在哪个页面 | 后端有没有？ |
|---|---|---|---|
| `character(slug)` | 角色详情（按 slug 查） | `CharacterDetail.vue` | ❌ 只有列表，没有详情 |
| `characterSessions(slug)` | 角色历史会话 | `CharacterDetail.vue` | ❌ 没有 |
| `memories(slug)` | 角色记忆区块（⚠️ 传的是 slug，不是 visitorId，语义存疑） | `CharacterDetail.vue` | ❌ 没有 |
| `trajectory(sessionId)` | 轨迹/剧本节点 | `SessionDetail.vue` | ❌ 没有 |
| `sessionMemories(sessionId)` | 本场记忆 | `SessionDetail.vue` | ❌ 没有 |

### 2.3 页面上的 mock 标识（要去掉）

| 位置 | 现在的样子 | 切真后要改成 |
|---|---|---|
| `CharacterDetail.vue` L31 | `auditStatus ?? 'pending'`（pending = 待接入） | 直接显示后端返回的 `auditStatus`（approved/rejected/pending） |
| `CharacterDetail.vue` L25-30 | 注释说明"数据源仍是 mock" | 删掉这段注释 |

### 2.4 其他 mock（本 WP 不做，登记 backlog）

| 方法 | 用途 | 用在哪个页面 | 为什么不做 |
|---|---|---|---|
| `memories(visitorId)` | 记忆浏览器 | `MemoryBrowser.vue` | 页面还没做，先不补 API |
| `psyguard()` / `psyguardTrend()` | PsyGUARD 监控 | `PsyGuardMonitor.vue` | 页面还没做，先不补 API |
| `costTrend()` / `sessionCosts()` | 成本看板 | `CostBoard.vue` | 归 WP31，本 WP 不做 |
| `weeklySessions()` | 近 7 天会话趋势 | `Dashboard.vue` | 归 WP31，本 WP 不做 |
| `dashboard()` | 仪表盘统计 | `Dashboard.vue` | 归 WP31，本 WP 不做 |

---

## 三、设计决策

### D1：范围只做 CharacterDetail + SessionDetail 两个页面

**理由**：
- WP30 任务单原文写的是"CharacterDetail + SessionDetail 接 /admin/api/* 真数据"
- 其他页面（MemoryBrowser / PsyGuardMonitor / CostBoard / Dashboard）要么还没做，要么归 WP31
- 一次做太多容易乱，先把这两个页面切干净

### D2：后端补 4 个端点，前端切 4 处 mock

**要补的后端端点**：

| 端点 | 用途 | 返回什么 |
|---|---|---|
| `GET /admin/api/characters/:slug` | 角色详情 | 角色基线 + 5Ps + 表达风格 + 会话数 + auditStatus |
| `GET /admin/api/characters/:slug/sessions` | 角色历史会话 | 该角色的最近 N 场会话列表 |
| `GET /admin/api/sessions/:id/trajectory` | 轨迹/剧本节点 | 本场会话的剧本节点状态 |
| `GET /admin/api/sessions/:id/memories` | 本场记忆 | 本场会话的记忆条目 |

**理由**：
- 前端这 4 个 mock 现在是空壳或假数据，后端没有真 API
- 不补后端端点，前端切不了——总不能把 mock 留着
- 这 4 个端点都是只读的 GET，不涉及写操作，风险低

### D3：角色详情端点——从 `character_profiles` 表查

**理由**：
- `GET /admin/api/characters` 列表已经是从 `character_profiles` 表查的
- 详情端点应该同表同口径，只是按 slug 查单行
- 不要查 `visitor_pool_templates`（那是速查卡表，和引擎基线不是同一份数据）
- 必须返回 `auditStatus` 字段——前端页面有审核状态标注，mock 里没有这个字段

### D4：角色历史会话端点——从 `training_sessions` 表按 characterSlug 过滤

**理由**：
- 会话列表 `GET /admin/api/sessions` 已经从 `training_sessions` 表查
- 角色历史会话只是加一个过滤条件：`turnDebugTrace` 里的 `characterSlug` 等于指定值
- 注意：`turnDebugTrace` 是 JSON 列，过滤可能要在内存里做（先查出最近 N 条，再过滤）

### D5：轨迹/剧本节点端点——从 `turnDebugTrace` 里抽

**理由**：
- 会话详情 `GET /admin/api/sessions/:id` 已经返回了 `traces`（调试快照数组）
- 轨迹/剧本节点是 trace 的一部分，不用单独存表
- 直接从 traces 里抽出来返回就行

### D6：本场记忆端点——从 `training_sessions.memories` 字段抽

**理由**：
- 如果 `training_sessions` 表有 `memories` JSON 列，直接抽出来
- 如果没有，这个端点就先返回空数组（登记缺口，后续 WP 补）

### D7：CharacterDetail 页面的 memories 区块——先去掉（不补后端）

**理由**：
- 现在 CharacterDetail 页面用 `api.memories(props.slug)` 查记忆，传的是**角色 slug**
- 但 `memories()` 的语义是按 **visitorId** 查记忆——传 slug 进去语义完全不对
- 这个区块本来就是 mock 的，而且语义不对——与其补一个错误语义的 API，不如先把这个区块去掉（或改成空状态），等真的有"角色相关记忆"的需求了再补
- 这样前端少切一处 mock，后端少补一个端点，范围更干净

### D8：前端切 mock 的顺序——先切后端已有的，再切后端补的

**理由**：
- `session(id)` 已经是真 API 了，不用切
- 先切 `character(slug)` → 等后端补了 `/characters/:slug` 再切
- 一次切一处，容易验证

---

## 四、文件清单

### 后端新增/修改

| 文件 | 改什么 |
|---|---|
| `src/admin-debug/admin-debug.controller.ts` | 加 4 个 GET 端点：`/characters/:slug` / `/characters/:slug/sessions` / `/sessions/:id/trajectory` / `/sessions/:id/memories` |
| `src/admin-debug/admin-debug.module.ts` | 不用改（已经有 sessionRepo 和 characterRepo） |

### 前端修改

| 文件 | 改什么 |
|---|---|
| `admin-dashboard/src/api/client.ts` | 把 `character()` / `characterSessions()` / `trajectory()` / `sessionMemories()` 4 个 mock 换成真 fetch 调用 |
| `admin-dashboard/src/views/CharacterDetail.vue` | ① 去掉 mock 标识注释 ② `auditStatus` 直接显示后端返回值 ③ 去掉 memories 区块（或改成空状态） |
| `admin-dashboard/src/views/SessionDetail.vue` | 确认数据显示正常 |

---

## 五、验收标准

### 5.1 后端

- [ ] `GET /admin/api/characters/:slug` 返回角色详情，含 `auditStatus` 字段
- [ ] `GET /admin/api/characters/:slug/sessions` 返回该角色的最近 N 场会话
- [ ] `GET /admin/api/sessions/:id/trajectory` 返回轨迹节点（或空数组）
- [ ] `GET /admin/api/sessions/:id/memories` 返回本场记忆（或空数组）
- [ ] 所有端点都走 `AdminRoleGuard`（非 admin → 403）
- [ ] 心理内容不进日志

### 5.2 前端

- [ ] `api/client.ts` 里 4 个 mock 方法都换成真 fetch
- [ ] `CharacterDetail.vue` 页面显示真实角色数据（含 auditStatus）
- [ ] `CharacterDetail.vue` 页面没有 mock 标识注释
- [ ] `CharacterDetail.vue` 页面的 memories 区块已去掉（或改成空状态）
- [ ] `SessionDetail.vue` 页面显示真实轨迹和记忆数据
- [ ] 页面上没有"mock"或"假数据"的标识

---

## 六、边界与红线

- ✅ engine-core 零改动（`git diff --stat HEAD -- src/engine-core` = 空）
- ✅ 心理内容（对话原文、记忆内容）不进日志
- ✅ 所有端点都走 admin 鉴权（basic auth + admin role guard）
- ✅ 不自动 git commit/push，只给 commit message 草稿

---

## 七、交付物

1. 后端 4 个 GET 端点实现
2. 前端 4 处 mock 切真
3. 单测覆盖（后端 4 个端点各 1-2 例）
4. 交付记录文档

---

## 八、待确认问题

1. `training_sessions` 表有没有 `memories` JSON 列？如果没有，`sessionMemories` 端点就先返回空数组
2. 角色历史会话的"最近 N 场"，N 默认多少？建议 20，和会话列表一致
3. 轨迹/剧本节点如果数据库里没有数据，是返回空数组还是 404？建议空数组（正常现象，不是错误）

---

## 九、交付后补记（2026-11-05）

> 交付记录：[`engine-wp30-admin-dashboard-real-api-implementation-2026-11-05.md`](engine-wp30-admin-dashboard-real-api-implementation-2026-11-05.md)
> 下表逐条登记**与任务单原文的偏差**（完整版见交付记录 §三）。

| # | 任务单原文 | 实际落地 | 为什么 |
|---|---|---|---|
| 1 | §D5「轨迹/剧本节点端点——从 `turnDebugTrace` 里抽」 | **先补留痕契约再抽**：`TurnTrace` 加可选 `trajectoryTrace`，`buildTurnTrace()` 带上 `result.trajectoryTrace` | grep 核实：WP19-R 的 `TurnTrace` 字段里**没有**轨迹字段，`turn_debug_trace` 今天**根本没有轨迹数据** → 端点恒返空 = 假接口。内核 `TurnRenderResult.trajectoryTrace` 本就透传内核出参，只是没进留痕。补一个**可选**字段（追加不改名、老会话读出来没有这一项 = 老数据）比"端点恒空"诚实。⚠️ **老会话仍无轨迹**，需重新开一场对练 |
| 2 | 前端类型 `TrajectoryNode { nodeId, label, type, triggeredAt, description? }` | 新建 `src/admin-debug/trajectory-view.ts` 做**单向翻译**：`label` 按幕 id 后缀派、`type` 按**幕序**派、`triggeredAt` 回查逐轮留痕、`scriptName` 取真静态剧本 `title` | 内核 `TrajectoryTrace` 说的是**引擎语义**（哪一幕 / 游标 / 访问过哪些），面板要的是**督导语义**（这场戏走到哪 / 这一幕叫什么 / 什么时候触发）。**内核只有 `nodeId`，没有 label、没有触发时刻**。类型按**幕序**而不按后缀：10 个伦理盲盒第 2 幕有两个后缀（`_event` 与危机剧本的 `_signal`），按后缀会漏一个剧本。认不出的**退回不编** |
| 3 | §D2「角色详情 —— 5Ps」；§2.3「auditStatus 直接显示后端返回的 `auditStatus`（approved/rejected/**pending**）」 | 5Ps 按**临床 5Ps 标准对应**映射（DB `vulnerability`→`predisposing`、`maintaining`→`perpetuating`）；`auditStatus` 以 **DB 真值** `draft`/`approved`/`rejected` 为准 | `CharacterFivePs` 的字段名与前端 `fivePs` **对不上**，不映射前端就一直显示空白（运维会误以为角色没写 5Ps）。DB 里**不存在 `pending`**（`CharacterAuditStatus` 就三个值）；页面上的"待接入真实 API (mock 数据)"提示随之删除（那正是 mock 标识） |
| 4 | §八 Q2「最近 N 场，N 默认多少？建议 20」 | N = 20；另设**扫描窗口 500 场** | `training_sessions` **没有角色列** → 角色过滤只能在内存做（读 `turn_debug_trace` 的 `characterSlug`）。内存过滤**必须有上限**。⚠️ **`sessionCount` 因此是"扫描窗口内的场次数"，不是全量总数** —— 要全量需把角色 slug 提成列（或加索引表），登记 R3 |
| 5 | §D6 / §八 Q1「从 `training_sessions.memories` 字段抽；没有就返回空数组」 | **确认没有该列** → 端点立住，**恒返 `[]`** | 逐字核过 `TrainingSession` 实体：留痕 `turn_debug_trace` / 逐字稿 `transcript` / 技术统计 `tech_stats` —— 无 memories 列。长时记忆在 **Qdrant**（按 (学员,角色) 作用域召回，无"按会话列全量"口径）；`MemoryStore` 的 `recall` 是**语义召回**（top-k），拿它冒充"本场记忆"是给运维一个"看起来有、实际是另一回事"的接口，且接进 `AdminDebugModule` 会**重现 WP58 刚解决的模块循环依赖** → 登记缺口 G1 |
| 6 | §D7「CharacterDetail 的 memories 区块先去掉」 | **照做**：区块整个删除 | 原 `api.memories(props.slug)` 传的是**角色 slug**，而语义是按 **visitorId** 查 —— 宁可空着，不补一个错误语义的接口 |
| 7 | §2.4「其他 mock 本 WP 不做」 | `memories()` / `psyguard()` / `costTrend()` / `weeklySessions()` / `dashboard()` **全部保留 mock** | `MemoryBrowser.vue` 在用 `api.memories()`；成本看板归 WP31。本单只切两个页面 |
| 8 | §五 5.2「页面上没有『mock』或『假数据』的标识」 | 额外清掉 `SessionDetail.vue` 里写死的 `memoryTurnMap`（`m001 → 1` … 假 id 表）与 `memoriesForTurn` 死代码 | 那是**假数据集**而不是标识 —— 点记忆会跳到一个**不相关**的轮次。后端记忆契约里没有"来源轮次"字段，故改为只高亮（等后端补 `originTurnIndex` 再接） |

**闸门**：eslint **0 error**（`npx eslint "src/**/*.ts" "test/**/*.ts"` exit 0）/ tsc **0 error**（`npx tsc -p tsconfig.build.json --noEmit` exit 0）/ vitest **108 文件 1834 例全绿**（WP58 基线 107 文件 1817 例 → 本轮 **+1 文件 / +17 例**；闸门用 `vitest run --exclude '**/e2e/**/*.ts'`，e2e 要真 DB/Redis）/ `git diff --stat HEAD -- src/engine-core` = **空**（内核零改动）/ `boundary.spec.ts` 全绿。

> ⚠️ **前端 vue-tsc 有 6 处既有报错**（`DebugChat.vue` × 2、`ParamCalibrator.vue` × 2、`SessionDetail.vue` × 1 组）：逐条核过 `git diff HEAD`，**全部与本单改动无关**（`SessionDetail.vue` 那处在 `beliefActivation` 假数据块里，本单未动）。本单改的 6 个前端文件里 `client.ts` / `types.ts` / `CharacterDetail.vue` / 两个 i18n 文件**零报错**。
>
> ⚠️ **本场记忆恒空**（G1）、**5Ps 已返回但页面还没渲染**（R1）、**`sessionCount` 非全量**（R3）—— 见交付记录 §七。
