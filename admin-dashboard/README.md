# admin-dashboard · 引擎调试器

心塑 App 心理咨询师训练引擎的 Web 调试面板（Vue 3 + Vite + Tailwind + ECharts）。

## 页面

| 页面 | 路由 | 说明 |
|---|---|---|
| 概览 | `/dashboard` | 总会话/危机命中/token 消耗/PsyGUARD 健康、风险类别分布、快捷入口 |
| 会话列表 | `/sessions` | 所有会话的时间/时长/token/状态 |
| 会话详情 | `/sessions/:id` | 逐字稿、BDI 快照、LLM usage、安全判定、RenderSpec prompt、BDI 轨迹图、剧本节点轨迹、复盘报告（六维雷达 + annotations） |
| 角色池 | `/characters` | 角色基线列表 |
| 角色详情 | `/characters/:slug` | 5Ps 个案概念化、BDI 基线、表达风格（WP10A） |
| 记忆浏览器 | `/memories` | 长时记忆召回、冲突标记 supersededBy |
| PsyGUARD 监控 | `/psyguard` | 服务状态、p50/p90 延迟趋势、请求量分布、风险类别分布 |
| 成本看板 | `/cost` | 近 7 天 token/成本趋势、单场平均、会话成本排行 |

## 技术栈

- Vue 3 `<script setup>` + TypeScript
- Vite
- Tailwind CSS（暗色主题，自定义类：`bg-bg-surface` / `card` / `chip` / `bg-accent` 等）
- ECharts（vue-echarts）
- 路由：`createWebHashHistory`

## 开发

```sh
npm install
npm run dev
```

API base 为 `/admin/api`，由 NestJS 后端的 AdminDebugModule 提供。

## Mock 说明

以下视图当前使用 mock 数据（在 `src/api/client.ts` 中），后端补 API 后切换为 `get<T>()`：

- 概览仪表盘（`api.dashboard`）
- 角色详情（`api.character`）
- 记忆浏览器（`api.memories`）
- 剧本轨迹（`api.trajectory`）
- PsyGUARD 监控（`api.psyguard` / `api.psyguardTrend`）
- 成本看板（`api.costTrend` / `api.sessionCosts`）
- 会话详情中的安全判定（`TurnTrace.safety`）和报告详情（`ReportDetail.dimensions/annotations`）

## 构建

```sh
npm run build
```
