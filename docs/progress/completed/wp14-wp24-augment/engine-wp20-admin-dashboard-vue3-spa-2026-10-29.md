# WP20 · Vue 3 调试器 SPA（admin-dashboard）

> 类型: 前端任务单（Vue 3 SPA，不是 Flutter）
> 前置: WP19（AdminDebugModule API 就绪后联调）
> 日期: 2026-10-29
> 位置: `mofang-nestjs/admin-dashboard/`（独立工程，不进 Flutter）
> 状态: **前端脚手架已搭好（create-vue + Vite + Tailwind + ECharts），mock 数据跑通，等 WP19 API 落地切真接口**

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
- 引擎在线状态绿点（接 `/admin/api/health`）

### `/characters` — 角色池（只读）
表格：代号、slug、依恋类型、trust/resist/valence/arousal、状态。

---

## 3. 约束

- 全部只读，没有编辑按钮、没有表单提交。
- 不做实时 WebSocket 推送，刷新页面拉最新数据。
- API base URL：dev 走 Vite proxy `/admin/api` → `localhost:3000`；prod 同源。
- API client `src/api/client.ts` 里 `USE_MOCK=true`（当前假数据），后端 WP19 落地后改 `false`。
- 不做 i18n、不做登录页（basic auth 由 NestJS 中间件管）。

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
| 7 | `USE_MOCK=false` 后接口字段与 WP19 契约一致 |

---

## 7. commit 文案

```
feat(admin): Vue3调试器SPA — create-vue脚手架+ECharts雷达图+报告区，深色主题只读
```
