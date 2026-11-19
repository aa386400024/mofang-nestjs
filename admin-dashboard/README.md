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
| 自动对练 | `/auto-practice` | 批量对练、场次进度、手动调试会话（创建/发轮/恢复/重命名/关闭/删除） |
| 质量标注 | `/quality` | 批次标注、盲标揭示、一致性统计（API 真数据） |
| 批次回归 | `/batch-regression` | 批次历史、指标快照、回归对比（API 真数据） |
| 参数校准 | `/calibrator` | 工程种子参数的离线沙盘与候选配置导出（明确不读写引擎运行态） |

## 技术栈

- Vue 3 `<script setup>` + TypeScript
- Vite
- Tailwind CSS（暗色主题，自定义类：`bg-bg-surface` / `card` / `chip` / `bg-accent` 等）
- ECharts（vue-echarts）
- 路由：`createWebHashHistory`

## 开发

```sh
pnpm install
pnpm dev
```

API base 为 `/admin/api`，由 NestJS 后端的 AdminDebugModule 提供。

## 数据边界

- 会话详情、调试 trace、delta 审计、事件标签、成本、记忆、PsyGUARD、质量标注、批次回归均直接使用后端字段；后端未返回的字段显示空态，不再由前端造数。
- 自动对练场次表 `ap_practice_sessions` 无 `title` 列且设计为审计表，页面不提供重命名/删除/AI 重命名入口；手动调试会话的重命名与删除走 `debug/sessions/:id` 真接口。
- 参数校准页是**离线沙盘**：使用前端工程种子值推演并导出候选配置，不读取也不写回引擎运行态；真实生效参数以引擎启动时的 env / 部署配置为准。

## 构建

```sh
pnpm build
```
