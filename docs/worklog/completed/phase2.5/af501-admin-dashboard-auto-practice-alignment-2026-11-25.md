# AF-502 交付记录 · auto-practice 调试面板修复与 trace 能力对齐

日期：2026-11-25
任务：AF-502（priorTasks: AF-501，AF-501 因 orchestrator 资源域冲突已 canceled/archived）
分支：`task/AF-502-auto-practice-admin-dashboard-trace`
基线：`b2834b3ede8d0b90a5a1191d0856820cad974e9c`

> 文件路径沿用 AF-501 重签发时任务单里声明的 `artifacts.deliveryRecord`；内容与提交均归属 AF-502。

## 审计结论

用户提出的四个问题全部成立，并额外发现一批后端 `DebugTurnTrace` 已有、admin-dashboard 未消费的字段：

1. 左侧场次卡片在 256px 宽度里堆了四行（角色/状态、轮数/模式/接触方式/危机结论、时间/时长/成本、模型），而当前会话信息栏只有角色和模式。
2. 点击历史轮气泡只设置 `currentTrace`，`DebugTracePanel` 的 `turnIndex` 仍取最后轮；`latestBdi`、原始 JSON、LLM 原始输出、prompt 都跟着最后轮走。
3. BDI 只有三条手写 SVG polyline；`valence` 被归一化进 0~1 进度条，负效价看起来像正向；`resistance/safety/bond` 缺失时被 `?? 0` 误画成 0。
4. 原始 JSON 与导出 JSON 直接 `JSON.stringify`，出现 `0.6895000000000001` 一类长尾。

额外未对齐项：`bdiSnapshot.transference/coreBeliefActivation/coreBeliefActivationPeak`、`resistanceDepth/Style`、`renderSpec.promptFull`、`llmUsage.cachedTokens`、`promptTokens: null`、结构化的 `intention`、`deltaDetail`、`gateDecision`、`deliberationTrace`，以及 `PracticeSession.status` 的完整枚举。

## 实现

- **单一选中轮状态**：新增 `selectedTurnIndex`；气泡、BDI 趋势点都可切换轮次。手动选中旧轮后，`rebuildFromTurns()` 不再把 `currentTrace` 抢回最后轮；新增“回到最新”。当前会话头也显示“查看 N / 共 M”。
- **信息分层**：左侧卡片压缩为两行（角色 + 状态标签、轮数 + 模式），宽度从 `w-64` 调到 `w-72`；对练时间、时长、成本、场景、模型、危机结论移入当前会话信息栏。新增角色/模式/状态/ID 搜索。
- **状态中文化**：新增 `practiceStatusLabel` / `practiceStatusTagType`，覆盖 `running/completed/crisis_ended/stagnant/failed/canceled`；批量进度标签与结束提示同步中文化。
- **BDI 图表重做**：新增 `BdiStatePanel.vue`。0~1 维度（trust/safety/bond/arousal/阻抗话量）用 ECharts radar；阻抗话量/深度/风格用三横条；valence 用 -1~+1 双极刻度和位置条，不再归一化；移情三态、核心信念激活、本轮 Δ 单独成卡；历史趋势折线带选中轮标记线，点击趋势点可切轮。
- **原始输出**：默认只显示选中轮 visitor 文本，提供“显示全部轮次”开关；气泡同步高亮当前选中轮。
- **prompt**：优先使用 `renderSpec.promptFull`，保留 `promptPreview` 作为旧数据兜底；完整 prompt 可折叠、可复制。
- **JSON 精度与导出**：新增 `trace-format.ts`，展示/复制/导出统一递归 4 位小数，`-0` 归一为 0；原始 JSON 使用选中轮的 `bdiSnapshot` + 同轮 `trace`，不再拼接最新轮快照；导出 JSON 带完整 `trace`、`bdiHistory`、`turnIndex` 和 `schemaVersion`。
- **类型对齐**：`BdiSnapshot` 补 `transference/coreBeliefActivation/coreBeliefActivationPeak`；新增 `BdiSnapshotPoint`；`RenderSpecSummary.promptFull`；`LlmUsage.promptTokens: number | null` 与 `cachedTokens`；新增 `IntentionSummary`；`PracticeSession.status` 补全枚举。
- **用量与决策展示**：安全判定 tab 增加输入/缓存/输出/思考 token、首 token、结束原因；事件分类 tab 增加结构化意图、禁止行为、决策理由、审议闸门、delta 与审议 trace（可折叠）。

## gateResults

- `pnpm --dir admin-dashboard type-check`：exit 0，vue-tsc 0 error。
- `pnpm --dir admin-dashboard build-only`：exit 0，vite build 通过，4721 modules transformed。
- `pnpm lint`：exit 0，eslint 0 error；仅有 pnpm 对 Node engine 的环境 WARN，不是 lint warning。
- `pnpm typecheck`：exit 0，tsc --noEmit 0 error。
- `pnpm test`：exit 0；4955 passed，4 skipped（336 个测试文件，335 passed / 1 skipped）。
- `git diff --stat HEAD -- src/engine-core`：空输出，engine-core 零改动。

## scopeCheck

in-scope。

改动文件：

- `admin-dashboard/src/api/types.ts`
- `admin-dashboard/src/utils/trace-format.ts`（新增）
- `admin-dashboard/src/components/BdiStatePanel.vue`（新增）
- `admin-dashboard/src/components/DebugTracePanel.vue`
- `admin-dashboard/src/views/AutoPractice.vue`
- `admin-dashboard/components.d.ts`（组件自动注册生成）
- 本任务任务单/交付记录/回执与编排状态面

未混入既有未提交文档：`CI托管方案调研-2026-11-24.md`、`待排期备忘-2026-11-24.md`、`af476/af477/af479/af480` 交付记录均未暂存。

## contractChecks

- taskId：AF-502 经 CLI register / promote / run-once，提交带 `Task: AF-502`。
- state-write：状态面由 CLI 维护，不手改。
- index-schema：`task-state-index.json` 由事件链投影生成。
- engine-core：零改动。
- privacy：只读既有调试面板与 prompt 区域，不新增对话原文日志。
- artifact-pointer：任务单、交付记录、回执均落文件。

## backlogItems

- 成本看板仍没有缓存命中率聚合；`src/admin-debug/cost-view.ts` 目前只汇总 prompt/completion/reasoning，需要后端单独扩展（本任务范围不含后端）。
- 历史会话摘要中的 `<think>` 污染仍需数据侧清理；本任务按任务单明确不在范围内。
- `gateDecision` 目前是前端可选的兼容字段，后端主路径未返回；UI 已做条件展示，等后端接入后无需再改前端。

## deviationTable

| 项             | 任务单口径                      | 实际                                                                             | 处理                                                                            |
| -------------- | ------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 任务角色       | 首版 AF-501 用 orchestrator     | orchestrator 资源域不含 `admin-dashboard`，`run-once` 报 `scope-domain-conflict` | `task reissue` 为 AF-502，角色改为 executor，`priorTasks: [AF-501]`             |
| 交付记录文件名 | 任务单 artifacts 写 `af501-...` | 任务已重签发为 AF-502                                                            | 沿用声明路径保证 artifact-pointer 可解析，内容与提交归属 AF-502                 |
| 导出 JSON      | 任务单只要求精度统一            | 复盘还需要完整 trace                                                             | 增加 `schemaVersion`、完整 `trace`、`bdiHistory` 与 `turnIndex`，仍在导出范围内 |
| 危机结论       | 原卡片第四行展示                | 卡片压缩为两行                                                                   | 移入当前会话信息栏，避免安全信息丢失                                            |

## reviewVerdict

passed。

四个已确认问题均已修复；后端已有但前端未消费的 trace 字段已补齐类型、面板和导出；选中轮不再被新轮覆盖；BDI 的 0~1 与双极语义分开；JSON 精度统一；engine-core 零改动。前端 type-check/build、后端 lint/typecheck/test 全部通过。
