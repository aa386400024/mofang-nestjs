# WP-N-FE · 标注台批次化前端 · 交付记录

> 状态：✅ 已交付（2026-11-11）
> 仓库：`E:\Work\Project\backend\mofang-nestjs`，分支 `integrate`
> 执行方：MainAgent（用户明确授权前端编码；规范边界见 §3 文档组）
> 关联任务单：[WP-N 后端](../pending/wp-n-annotation-batch-scope-task-2026-11-11.md)（并行执行中，未验收）· [WP-N-FE 前端任务单](../pending/wp-n-fe-annotation-batch-ui-task-2026-11-11.md)
> 任务性质：既有标注台 `/quality/annotation` 按 WP-N 批次契约改造（批次选择、ref 解析、三态横幅、轮级表单、可比性守卫）

---

## 1. 一句话总结

标注台前端接入批次维度：批次选择器、`id ?? debugSessionId` ref 解析、未建行 / 逐字稿缺失 / 批次不可比三态显式处理、轮级最小集三字段表单、批次元信息只读展示；契约层类型与 API client 先行预接并对照后端实时代码核对。前端构建闸门通过，本单新增改动 0 类型错误。

## 2. 方案偏差与口径说明

1. **契约文档尚未落地**：后端 D8 产物 `docs/team/quality-annotation-batch-api-contract.md` 仍由 WP-N 后端并行交付中。本单类型 / 视图对照后端实时代码核对（`quality-annotation.controller.ts` 端点与查询参数、`quality-annotation.view.ts` 出参视图、`dto/quality-annotation.dto.ts`、`quality-annotation.constants.ts` 枚举码），字段名与形状与现有后端代码一致；**待后端契约文档定稿后需逐条复核**，若有漂移先同步 `types.ts / client.ts` 再动视图。
2. **轮级三列随本单接入**：`firstBadTurn` / `badTurns`（逗号分隔字符串，非数组）/ `turnNote` 按 WP-N 规格一并落地；表单只做事实描述，不含评分、等级、对错口径（零压红线）。
3. **批次选项展示**：选项标签含 `sessions / annotatableSessions` 计数；`valid === false` 的批次选项置 `disabled`。`includeInvalid` 开关未在选择器暴露（后端默认隐藏无效批次；需要查看无效批次时后续再加）。
4. **既有类型债未清理**：前端工程改动前即存在 51 条 vue-tsc 类型错误，分散在其他视图与组件；本单不清理、不重构，另立 backlog 跟踪。
5. **未跑后端闸门**：本单只改前端目录与规范文档；后端 `tsc / eslint / vitest` 归 WP-N 后端任务单执行。

## 3. 改动文件清单

### 3.1 前端代码（`admin-dashboard/`）

| 文件                           | 用途                                                                                                                                                                                                                                                                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/api/types.ts`             | WP-N 契约类型：`AnnotationBatchSummary` / `AnnotationBatchListResponse` / `AnnotationConsistencyScope` / `AnnotationTranscriptSource`；`AnnotationRow` 批次 6 列 + 轮级 3 列 + `warnings`；`id` 放宽 `string \| null`；`updatedAt` 可空；`AnnotationDetail` 冗余 `transcriptSource / warnings`；`AnnotationSaveBody` 轮级可选字段 |
| `src/api/client.ts`            | `listBatches()`；`list / consistency` 支持 `batchId`；detail / save / reveal / auto 形参改 `ref`（行 UUID 或 `debugSessionId`）                                                                                                                                                                                                   |
| `src/views/AnnotationTool.vue` | 批次选择器与批次告警；`rowRef()` 辅助；三态徽标与横幅；轮级三字段表单与本地解析校验；批次 / 引擎 / prompt 元信息只读行；一致性不可比守卫（遮数字 + 原因码中文映射 + 告警单列）；进度文案去硬编码                                                                                                                                  |

### 3.2 规范文档（前端编码授权放宽）

| 文件                            | 改动                                                                                                                                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/team/conventions.md`      | §1.2 由「不写前端代码」改为「默认隔离，授权可写」：任务单明确授权时可在 `admin-dashboard/` 内实现与任务单不冲突的前端代码；命令边界写明前端目录跑自带脚本、后端闸门只管 `src/`。§1.3 标题与 Flutter 命令条款同步 |
| `docs/team/wp-task-template.md` | §0 改动范围枚举、§2 前端目录边界、§5.3 前端闸门执行方、§7 提交分组措辞同步放宽；保留目录隔离、既有债基线、提交分组纪律                                                                                           |
| `AGENTS.md`                     | §2 协作边界第 2 / 3 条：前端代码边界与命令边界改写，指向 conventions §1.2                                                                                                                                        |

### 3.3 任务单

| 文件                                                                  | 用途                                                                  |
| --------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `docs/worklog/pending/wp-n-fe-annotation-batch-ui-task-2026-11-11.md` | 前端任务单（D1–D8 视图改动点 + 三态 + 闸门 + 回写清单），随本记录归档 |

## 4. 闸门记录

| 闸门           | 命令（在 `admin-dashboard/` 目录）                                                                        | exit code | 结果                                                                                                                                                                                                                                                    |
| -------------- | --------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 类型           | `pnpm type-check`（`vue-tsc --build`）                                                                    | 2         | 51 条**既有**类型债（其他视图 / 组件）；本单文件 0 新增错误：`AnnotationTool.vue`、`api/types.ts`、`client.ts` 的 `qualityAnnotation` 段均无报错。`client.ts:237 / :258` 两条为既有 `evalReports / gateTraces` 代码的 `Object.entries` cast，非本单引入 |
| 构建           | `pnpm build-only`（`vite build`）                                                                         | 0         | 4731 modules transformed；`AnnotationTool` chunk 23.79 kB（gzip 8.74 kB）；built in 8.27s                                                                                                                                                               |
| engine-core    | `git diff --stat HEAD -- src/engine-core`                                                                 | —         | 空（0 行）                                                                                                                                                                                                                                              |
| 手工浏览器回归 | 三条路径：① 不传 batchId 与改造前一致；② 选批次队列 / 进度 / 一致性随批切换；③ `missing` 与不可比横幅可见 | —         | ✅ **已在线回归**（2026-11-11，用户现场三路径走查，未发现问题）                                                                                                                                                                                         |

## 5. 三态与批次切换实现对照

| 态         | 判定                                     | 前端处理                                                                                                                                        |
| ---------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 未建行     | `row.id === null`                        | 队列项「未落行」徽标；可打开、可填写、可保存；`detail / save / reveal / auto` 均走 `rowRef(row)`                                                |
| 逐字稿缺失 | `row.transcriptSource === 'missing'`     | 队列项「逐字稿缺失」徽标；中栏横幅提示，气泡区不渲染对话                                                                                        |
| 批次不可比 | `consistency.scope.comparable === false` | 校准概览三数字整体遮住；横幅逐条展示 `incomparableReasons`（原因码中文映射，未知码原样）；`scope.warnings` 单列提示；`labeled === 0` 旧空态保留 |

批次切换：`selectedBatchId` 初始为空串（不传 `batchId`，历史全量口径，与改造前逐字一致）；切换时清空 `current / reveal / highlightTurn / AI 建议` 后 `refresh()`；队列、进度、一致性均随同一 `batchId` 请求，不跨批缓存。

## 6. 风险与回归

- **向后兼容**：不传 `batchId` 时，`list / consistency` 请求不带批次参数，队列、进度、一致性口径与改造前一致。
- **范围隔离**：未改后端 `src/**`、`test/**`、`bin/**`、`scripts/**`；未动 `engine-core/**`；未改其他视图（`BatchRegression.vue` 及其组件保持现状）；未新增 npm 依赖；未改路由与全局 store。
- **并行产物**：WP-N 后端并行改动（`src/quality/**`、migration、`bin/ormconfig.ts`、`test/quality/**`、`.wpn-probe*.mjs` 临时脚本）不属于本单，提交时按分组隔离，不混提。
- **隐私**：对话原文不进 console / 日志；`turnNote` 等用户输入只走保存接口。

## 7. 遗留项与建议人工复核

1. **契约复核**：✅ 已在后端验收 §4 逐条核对（7 路由、行视图 22 字段、枚举码、可比性判定、`id` 可空性与前端 `types.ts` / client 对齐）。
2. **浏览器手工回归**：✅ 已完成（2026-11-11，用户现场走查 §4 三条路径，批次切换不串口径、两种横幅文案与禁用态均正常，未发现问题）。
3. **既有类型债**：51 条 vue-tsc 错误另立 backlog（`AutoPractice.vue` / `DebugTracePanel.vue` / `SessionDetail.vue` / `CharacterDetail.vue` 等 13 个文件），不在本单清理。2026-11-11 复跑 `pnpm type-check`：51 错误 / 13 文件；本单改动的 `AnnotationTool.vue`、`types.ts` 为 0 错误，`client.ts` 2 条为既有。
4. **无效批次查看**：如后续需要在标注台查看 `valid=false` 批次，再在选择器加 `includeInvalid` 开关。

## 7.1 后续补丁（2026-11-11 · REVIEW-3 契约类型对齐复核）

契约 7 端点 × 前端 `types.ts`/`client.ts` 逐条对照后，发现并修正 **2 处前端类型偏松**（均在 `admin-dashboard/src/api/types.ts`，**零运行时变化**）：

1. `AnnotationConsistency.scope` 由可选改为**必填** —— 后端 `quality-annotation.view.ts:166` 恒返回 `scope`；此前可选 + 视图层 `?? true` 兜底会把「scope 缺失」悄悄当成「可比」= 自信的错结论（WP-K 教训）。
2. `AnnotationConsistencyScope.incomparableReasons` / `.warnings` 由 `string[]` **收窄为枚举联合**（4 + 2 个码，与后端 `COMPARABILITY_REASON` / `COMPARABILITY_WARNING` 严格 1:1）—— 契约 §2.7 标注为 `enum[]`。

前端 `pnpm type-check` 改动前后均为 **51 错误 / 13 文件**（既有债数字逐一致，新增 0 错误）；`pnpm build-only` exit 0。详见 [REVIEW-3 交付记录](review3-wpn-contract-alignment-2026-11-11.md)。

---

## 8. 提交分组与 commit 草稿（不自动提交）

建议分两组 stage：

- **组 1 · 前端代码**：`admin-dashboard/src/api/types.ts`、`admin-dashboard/src/api/client.ts`、`admin-dashboard/src/views/AnnotationTool.vue`
- **组 2 · 文档**：`AGENTS.md`、`docs/team/conventions.md`、`docs/team/wp-task-template.md`、`docs/worklog/pending/wp-n-fe-annotation-batch-ui-task-2026-11-11.md`（归档后路径）、本交付记录

Commit message 草稿：

```
feat(quality-annotation): 标注台接入批次维度前端接线与视图

- 批次选择器、ref 解析、三态横幅、轮级最小集表单、一致性可比性守卫
- 契约层 types/client 对照后端实时代码预接；放宽前端编码授权规范措辞
```
