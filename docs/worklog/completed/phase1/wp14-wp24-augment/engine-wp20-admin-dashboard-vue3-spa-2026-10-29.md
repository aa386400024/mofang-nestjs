# WP20 · Vue 3 调试器 SPA（admin-dashboard）

> 类型: 前端任务单（Vue 3 SPA，不是 Flutter）
> 前置: WP19（AdminDebugModule API 就绪后联调）
> 日期: 2026-10-29
> 位置: `mofang-nestjs/admin-dashboard/`（独立工程，不进 Flutter）
> 状态: **前端脚手架已搭好（create-vue + Vite + Tailwind + ECharts）；后端 WP19-R 的 `/admin/api/*` 已收口，前端已切真接口 —— 9 个页面里 4 个走真 API、1 个半真、4 个仍全 mock**（2026-11-03 按代码核实回写，详见 §2「数据来源现状」）
>
> ⚠️ **时序说明**：本任务单写于 **2026-10-29**，初稿描述的是"纯 mock 脚手架"阶段。**WP19-R（2026-11-02，后端 `/admin/api/*` 收口）与 WP22（2026-11-02，前端切真接口 + 补 i18n / 登录页）之后，前端已经不再是"零真 API 调用"** —— 下面凡是写"全 mock"的地方都按当前代码事实重写，读的时候以代码为准。

---

## 0. 为什么有这条

WP19 把每轮 BDI 快照 + usage 落库了，但没有界面看。WP20 做一个 Vue 3 SPA，只读地展示这些数据，让调试引擎时不用翻 DB。

**定位**：开发者工具，不是给用户用的产品。深色主题，参考 Postman/Datadog 暗色面板。

---

## 1. 技术栈（已安装）

- **Vue 3 + Vite + TypeScript**（官方 `create-vue` 脚手架）
- **Vue Router**（hash 模式）
- **Tailwind CSS 3**（深色主题，粉橘 accent 系）
- **Pinia**（轻量状态管理）
- **ECharts + vue-echarts**（六维评分雷达图，后续图表扩展预留）
- **不做 SSR**——纯 SPA，NestJS serve `dist/` 静态文件

---

## 2. 页面结构（已实现）

### `/sessions` — 会话列表
- 顶部统计条：总会话数、已完成数、总 Token、平均时长
- 表格：时间、角色、时长、token、状态。点行进详情。

### `/sessions/:id` — 会话回放
- **左栏**：逐字稿（咨询师/来访交替气泡）
- **右栏上**：轮次选择器 + BDI 快照 tile（trust/valence/arousal/resistance，hover 中文解释）+ LLM Usage tile（completion/reasoning/TTFT/finish，hover 解释）+ 危机检测
- **RenderSpec Prompt**：system/context/instructions 三段分卡展示（粉/黄/绿标签）+ taskKind/effort/maxTokens chip
- **BDI 轨迹图**：整场会话 trust/valence/arousal/resistance 随轮次变化折线（ECharts line）
- **报告区**：总分仪表盘 + 六维评分 **ECharts 雷达图** + annotations（绿/黄/红点）+ 成长建议列表
- 所有参数 hover 有 InfoTooltip 中文解释

### 顶栏
- 引擎在线状态绿点 —— ⚠️ **2026-10-29 初稿写的是"接 `/admin/api/health`"，但代码里没有这层调用**：`App.vue` 的是一个静态圆点（`<span class="w-2.5 h-2.5 rounded-full bg-ok">`），**不轮询、不探活**。真要探活得自己接 `api.health()`。

### 数据来源现状（2026-11-03 按代码核实回写）

**以代码为准，不以本文件的初稿描述为准**：

- `src/api/client.ts` 的 `api` 对象共 **15 个方法**，其中 **4 个是真 API 调用** —— `sessions` / `session` / `characters` / `health`，走 `get()` → `fetch('/admin/api/...')`，自动带 basic auth 头，遇 401 弹框重输凭据后重试；其余 11 个返回硬编码常量。
- `src/router/index.ts` 共 **9 个页面路由**（外加 1 条 `/` → `/dashboard` 重定向）：

| 页面 | 数据来源 | 说明 |
|---|---|---|
| `/login` | **真 API** | 登录时直接 `fetch('/admin/api/health')` 校验 basic auth 凭据是否被后端接受 |
| `/sessions` | **真 API** | `api.sessions(20)` → `GET /admin/api/sessions` |
| `/sessions/:id` | **真 API**（主数据） | 主数据走 `api.session(id)` → `GET /admin/api/sessions/:id`；**侧栏两块仍是 mock**（BDI 轨迹 `api.trajectory`、本场记忆 `api.sessionMemories`） |
| `/characters` | **真 API** | `api.characters()` → `GET /admin/api/characters` |
| `/dashboard` | **半真** | `api.dashboard()` / `api.weeklySessions()` 是"API 骨架 + mock 数据"—— 方法签名与后端契约对齐，但返回值是写死的常量 |
| `/characters/:slug` | 全 mock | `api.character` / `api.memories` / `api.characterSessions` 全返常量；**且缺 pending 状态标注**（已知缺口，见 WP26 任务单 P2-35） |
| `/memories` | 全 mock | `api.memories()` 恒返空数组 |
| `/psyguard` | 全 mock | `api.psyguard()` / `api.psyguardTrend()` 全返常量 |
| `/cost` | 全 mock | `api.costTrend()` / `api.sessionCosts()` 全返空数组 |

**合计：4 个真 API 页面 + 1 个半真 + 4 个全 mock。**

> **为什么"半真"要单独标一档**：真 API 页面的数据会随 DB 变，半真页面**看着有值、其实是常量** —— 调试时最容易踩的坑就是"页面有数据就以为链路通了"。三档分开写，读的人才知道哪些结论能直接采信、哪些只能当占位。
>
> **内测影响**：内测主链路（对练 → 逐字稿 → 督导报告）**不走 admin-dashboard**，所以全 mock 的那 4 个页面不是内测阻塞项（与 WP25 扫描报告 §1.3 同口径）。

### `/characters` — 角色池（只读）
表格：代号、slug、依恋类型、trust/resist/valence/arousal、状态。

---

## 3. 约束

- 全部只读，没有编辑按钮、没有表单提交。
- 不做实时 WebSocket 推送，刷新页面拉最新数据。
- API base URL：dev 走 Vite proxy `/admin/api` → `localhost:3000`；prod 同源。
- API client `src/api/client.ts` **没有 `USE_MOCK` 全局开关**（2026-10-29 初稿写的 `USE_MOCK=true` 已随切真接口删除）—— 现在是**逐方法写死**：4 个方法直接 `fetch('/admin/api/...')`，其余方法返回硬编码常量。要再切真接口就是**逐方法改这个文件**，没有开关可翻。
- ~~不做 i18n、不做登录页~~ —— **已实现**（WP22 补的）：`src/i18n/index.ts` 提供中英切换（顶栏按钮），`/login` 页采集 basic auth 凭据并存 `sessionStorage`；basic auth 本身仍由 NestJS 中间件校验，前端只负责采集与携带。

---

## 4. NestJS 集成（WP19 接）

- `admin-dashboard/dist/` build 后，NestJS `AdminDebugModule` 用 `useStaticAssets` serve。
- `/admin/*` 路径返回 SPA index.html。
- `/admin/api/*` 走 API controller。

---

## 5. 不做

- ❌ 角色编辑 CRUD。
- ❌ 用户管理/权限。
- ❌ 实时大盘/图表（ECharts 已装，后续按需加趋势图）。
- ❌ 告警/通知。
- ❌ 做进 Flutter App。

---

## 6. 验收

| # | 项 |
|---|---|
| 1 | `npm run build` 产 `dist/`，NestJS serve 后浏览器访问 `/admin/` 能打开 |
| 2 | 会话列表从 `/admin/api/sessions` 拉数据渲染 |
| 3 | 点某场会话，左栏逐字稿 + 右栏轮次详情联动 |
| 4 | 六维雷达图从报告数据渲染 |
| 5 | BDI 快照数值和 DB trace 对得上 |
| 6 | 角色池列表从 `/admin/api/characters` 拉数据 |
| 7 | 接口字段与 WP19 契约一致（**4 个页面已切真 API**：`/login` / `/sessions` / `/sessions/:id` / `/characters`；`/dashboard` 半真，另 4 个页面仍全 mock） |

---

## 7. commit 文案

```
feat(admin): Vue3调试器SPA — create-vue脚手架+ECharts雷达图+报告区，深色主题只读
```
