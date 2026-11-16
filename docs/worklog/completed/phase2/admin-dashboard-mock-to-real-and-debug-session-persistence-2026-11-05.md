# Admin Dashboard 剩余页面切真 API + 调试会话持久化 · 任务单

> **状态**：✅ 已交付（2026-11-05）→ [`engine-admin-dashboard-mock-to-real-and-debug-session-persistence-implementation-2026-11-05.md`](./engine-admin-dashboard-mock-to-real-and-debug-session-persistence-implementation-2026-11-05.md)
> **路径**：`docs/worklog/completed/phase2/admin-dashboard-mock-to-real-and-debug-session-persistence-2026-11-05.md`
> 日期：2026-11-05
> 范围：后端补接口 + 前端切 mock
> 边界：engine-core 零改动 · 心理内容不进日志 · 不自动 commit/push

---

## 一、背景

WP30 只切了 CharacterDetail + SessionDetail，WP31 切了成本看板。还有三个页面是 mock 数据：

| 页面 | 现在的状态 |
|---|---|
| `Dashboard.vue` | `dashboard()` / `weeklySessions()` 返回 mock |
| `MemoryBrowser.vue` | `memories()` 返回空数组 |
| `PsyGuardMonitor.vue` | `psyguard()` / `psyguardTrend()` 返回 mock |

另外 WP58 的调试会话是纯内存的，刷新就没了。前端已经写好了会话列表组件，后端只需要补 CRUD 接口。

---

## 二、第一部分：Dashboard 页切真 API

### 2.1 要做的接口

| 接口 | 说明 |
|---|---|
| `GET /admin/api/dashboard` | 总览统计：总会话数 / 今日会话数 / 总 token 消耗 / 平均每会话轮次 |
| `GET /admin/api/dashboard/weekly-sessions` | 最近 7 天每天的会话数（折线图用） |

### 2.2 前端改动

- `api/client.ts`：`dashboard()` / `weeklySessions()` 换成真调用
- `Dashboard.vue`：数据正常显示就行，不用改 UI

---

## 三、第二部分：MemoryBrowser 页切真 API

### 3.1 要做的接口

| 接口 | 说明 |
|---|---|
| `GET /admin/api/memories` | 列出所有记忆条目（按 visitorId 分组 / 时间线两种视图） |

### 3.2 说明

- 现在 `memories()` 返回空数组，因为后端根本没这个接口
- 记忆数据存在哪？如果是 Qdrant，就从 Qdrant 查；如果是内存，就从内存查
- 先做最简单的：返回所有记忆条目，不分页，不筛选（前端自己过滤）

---

## 四、第三部分：PsyGuardMonitor 页切真 API

### 4.1 要做的接口

| 接口 | 说明 |
|---|---|
| `GET /admin/api/psyguard` | PsyGUARD 状态：是否加载 / p50/p90 延迟 / 总请求数 / 各类别计数 |
| `GET /admin/api/psyguard/trend` | 最近 7 天 PsyGUARD 调用量趋势 |

### 4.2 说明

- PsyGUARD 是 Python 模型服务，后端现在有没有指标？如果没有，先返回 mock 值也行
- 先做最简单的：返回固定的几个数，后面再补真指标

---

## 五、第四部分：调试会话持久化

### 5.1 要做的接口

| 接口 | 说明 |
|---|---|
| `GET /admin/api/debug/sessions` | 列出所有历史调试会话（id / title / characterSlug / createdAt / updatedAt / turnCount） |
| `GET /admin/api/debug/sessions/:id` | 获取某个调试会话的完整 messages + traces |
| `PATCH /admin/api/debug/sessions/:id` | 更新会话标题 |
| `DELETE /admin/api/debug/sessions/:id` | 删除调试会话 |

### 5.2 存储

- 存 `data/debug-sessions/{sessionId}.json`（JSON 文件，不进数据库）
- 每个文件包含：id / title / characterSlug / createdAt / updatedAt / messages[] / traces[]
- 保留最近 50 个会话，超过的自动删

**写文件时机**：
- **创建会话时**：建一个空的 JSON 文件，写入 id / title / characterSlug / createdAt
- **每发一轮对话后**：把这一轮的 counselorText / reply / trace 追加到 messages[] 和 traces[]，同时更新 updatedAt
- **关闭会话时**：把会话标记为已完成（status: 'completed'）
- ⚠️ 为什么每轮写而不是关闭时一次性写：中途崩溃 / 进程重启也不丢数据，刷新页面就能看到跑了一半的会话

### 5.3 会话名自动生成

- 跑了 3 轮对话后，自动用 LLM 生成会话标题（比如"悲伤回避型来访者 - 初始访谈"）
- 用户可以手动改（改完立即写文件）
- 生成失败兜底用"未命名会话 - {时间戳}"

### 5.4 前端已写好的部分

- `SessionList.vue`：会话列表组件（带展开收起 / 编辑标题 / 删除按钮）
- `DebugChat.vue`：三栏布局（左边会话列表 / 中间聊天窗口 / 右边调试面板）
- `api/client.ts`：debugSession 的 CRUD 方法已加好

---

## 六、设计决策

### D1：调试会话存 JSON 文件，不进数据库

**理由**：
- 调试数据，不污染生产库
- 调试会话量不大（最多 50 个），JSON 文件足够
- 落库要建表 + migration，太重了

### D2：Dashboard / Memory / PsyGuard 先做简单版

**理由**：
- 先有数据显示，后面再优化筛选 / 分页 / 真指标
- MemoryBrowser 现在是空的，先把数据接出来再说
- PsyGUARD 指标如果后端没有，先返回 mock 也行

---

## 七、验收标准

### Dashboard 页验收

- [x] `GET /admin/api/dashboard` 返回总览统计
- [x] `GET /admin/api/dashboard/weekly-sessions` 返回最近 7 天会话数
- [x] 前端 Dashboard.vue 正常显示数据

### MemoryBrowser 页验收

- [x] `GET /admin/api/memories` 返回记忆条目列表
- [x] 前端 MemoryBrowser.vue 正常显示（分组视图 + 时间线视图）

### PsyGuardMonitor 页验收

- [x] `GET /admin/api/psyguard` 返回 PsyGUARD 状态
- [x] `GET /admin/api/psyguard/trend` 返回调用量趋势
- [x] 前端 PsyGuardMonitor.vue 正常显示

### 调试会话持久化验收

- [x] `GET /admin/api/debug/sessions` 能列出历史会话
- [x] `GET /admin/api/debug/sessions/:id` 能获取完整 messages + traces
- [x] `PATCH /admin/api/debug/sessions/:id` 能改标题
- [x] `DELETE /admin/api/debug/sessions/:id` 能删除
- [x] 会话跑 3 轮后自动生成标题
- [x] 前端 SessionList.vue 能正常显示 + 选择 + 删除

---

## 八、待确认问题

1. 记忆数据现在存在哪？Qdrant 还是内存？
   - **答**：**两者都有**。长时记忆（`tier: long_term`）在 Qdrant `visitor_long_memory` 集合；工作 / 短时记忆在**进程内**的会话级回落仓。
   - **落地**：本单只查 Qdrant（内核 `MemoryStore` 端口只有 `remember` / `recall`，**没有 list-all**，`InMemoryMemoryStore` 在 engine-core 不可改）。响应带 `scope: 'long_term'` + `source: 'qdrant' | 'unavailable'` 标清口径。缺口 G2。
2. PsyGUARD 后端现在有没有指标统计？还是需要新加？
   - **答**：**没有**。后端只有 `PsyGuardHealthChecker`（探活：reachable / modelLoaded / contractOk），**没有任何请求计数 / 延迟直方图 / 类别计数**。
   - **落地**：**没返 mock 值** —— 返**实时探活真值** + `metricsAvailable: false` + 三个数恒 0，前端显示「指标未采集」且不画假曲线。真指标另开单（缺口 G1，要动热路径，先讨论后实现）。
3. 调试会话自动命名用哪个模型？复用现有的 LLM 客户端？
   - **答**：**复用现有 LLM 客户端**（`LlmRouterService`），模型名走**既有 env `MEMORY_SUMMARY_MODEL`**（同族任务同键，没新增 `DEBUG_TITLE_MODEL`）。
   - **落地**：第 3 轮整**异步**触发（不阻塞那一轮响应）；失败兜底 `"未命名会话 - {时间戳}"`；**人工改名永不被自动标题覆盖**。

---

## 九、交付后补记（2026-11-05）

- 交付记录：[`engine-admin-dashboard-mock-to-real-and-debug-session-persistence-implementation-2026-11-05.md`](./engine-admin-dashboard-mock-to-real-and-debug-session-persistence-implementation-2026-11-05.md)
- 与任务单有出入的地方共 **11 条**（B1–B11），逐条见交付记录 §四「偏差表」。最需要留意的三条：
  - **B3**：记忆只列长时（内核端口无 list-all，engine-core 红线不可破）；
  - **B4**：PsyGUARD **没返 mock 值**，改返真探活状态 + `metricsAvailable: false`；
  - **B6**：标题生成走**第 3 轮整 + 异步** + **复用 `MEMORY_SUMMARY_MODEL`**。
- 闸门数字见交付记录 §五。
