# WP-N-FE · 标注台批次化前端（admin-dashboard Vue 接线 + 视图）

> 状态：✅ 已交付（2026-11-11）→ [交付记录](wp-n-fe-annotation-batch-ui-implementation-2026-11-11.md)
> 执行方：MainAgent（用户授权前端编码；契约层 types/client 预接 + 视图落地）
> 仓库：E:\Work\Project\backend\mofang-nestjs，分支 integrate
> 唯一事实源：`docs/worklog/pending/wp-n-annotation-batch-scope-task-2026-11-11.md`（WP-N 后端任务单）+ `docs/team/quality-annotation-batch-api-contract.md`（后端交付的契约文档，**字段名与口径以该文档为最终准**）
> 任务性质：既有页面按新后端契约改造（新功能接线 + 视图三态处理）
> 改动范围：仅 `admin-dashboard/src/views/AnnotationTool.vue`；`admin-dashboard/src/api/types.ts`、`admin-dashboard/src/api/client.ts` 已预接，仅在后端契约与预接类型不一致时做同步修正

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `docs/team/conventions.md` —— §1.2 前端目录隔离、§1.3 命令规范、§5.3 前端闸门；§三 硬约束；零压红线（§5.3 节）
2. `docs/worklog/pending/wp-n-annotation-batch-scope-task-2026-11-11.md` —— 后端规格：§D2 端点、§D3 行字段与三态、§D4 一致性 scope、§D8 契约文档
3. `docs/team/quality-annotation-batch-api-contract.md` —— 后端交付后存在；若尚未落地，本单视图部分不得开工（契约漂移风险）
4. `admin-dashboard/src/views/AnnotationTool.vue`（当前 410 行，行号对照见 §3）
5. `admin-dashboard/src/api/types.ts`（Annotation* 段，已含 WP-N 预接类型）、`admin-dashboard/src/api/client.ts`（`qualityAnnotation` 段）

---

## 1. 背景（先读，方向别错）

### 1.1 现状

标注台 `/quality/annotation` 是封闭集合：唯一队列入口读后端派生列表，旧版只有「全量」一种口径。后端 WP-N 把队列改成「场次 LEFT JOIN 标注行」，支持按批次派生队列、未建行条目先行展示、逐字稿来源标记、批次可比性守卫，并新增轮级最小集三字段。

前端现状（`AnnotationTool.vue`）：

- 全部 API 调用以 `current.row.id` / `row.id` 为主键；派生行 `id: null` 时这条链会断。
- 左栏进度文案 `HINTS.progress`（:48）硬编码「30 场锚点场次」。
- 校准概览三指标无条件展示，没有「不可比」守卫横幅。
- 表单七字段（:101–109），无轮级最小集输入。
- 一致性、队列、保存、揭示、AI 建议五条链都不传批次参数。

### 1.2 关键现状（已核对，别当新问题）

- `client.ts` 的 `qualityAnnotation` 已预接：`listBatches()`、`list(status, { batchId })`、`consistency({ batchId })`，detail/save/reveal/auto 形参已改名 `ref`（行 UUID 或 `debugSessionId`）。
- `types.ts` 已预接：`AnnotationBatchSummary`、`AnnotationConsistencyScope`、`AnnotationTranscriptSource`；`AnnotationRow` 新增 `batchId / counselorModeId / turnCount / engineVersion / promptVersion / characterVersion / transcriptSource / firstBadTurn / badTurns / turnNote`，`id` 放宽为 `string | null`；`AnnotationSaveBody` 新增可选轮级三字段；`AnnotationConsistency` 新增可选 `scope`。
- 既有「不传 batchId」路径必须保持与改造前逐字一致（向后兼容；后端 WP-N §设计铁律同款口径）。

---

## 2. 范围（严格遵守，不越权）

**在范围内：**

- `AnnotationTool.vue`：批次选择器、ref 解析、三态横幅、进度文案去硬编码、轮级三字段表单、批次元信息只读展示、一致性可比性守卫。
- `types.ts` / `client.ts`：仅当后端契约文档与预接类型不一致时做同步修正（字段名、枚举值、嵌套层级）。

**明确不在范围内（禁止顺手做）：**

- 不改后端 `src/**`、`test/**`、`bin/**`、`scripts/**`；不加 migration、不改表结构。
- 不动 `engine-core/**`；不碰 Flutter 客户端。
- 不改其他视图（`BatchRegression.vue` 及其组件保持现状）；不做整体样式体系重构、不换 UI 库。
- 不在标注台出现任何分数 / 等级 / 对错判定口径（零压红线）；轮级字段只能是事实描述。
- 不跑后端命令（`pnpm lint` / `pnpm test` / 后端 tsc）；前端闸门见 §5。
- 不自动 git commit / push；写完给 commit message 草稿，等用户指令。

---

## 3. 目标架构 / 交付物

> 设计原则：单一真相源（口径只从后端响应读，前端不复算）、向后兼容（不传批次 = 旧全量口径）、三态显式可见（不静默吞掉缺失与不可比）、出错当场提示不进库。

### D1 · 批次选择器（左栏顶部，进度卡之上）

- 数据源：`api.qualityAnnotation.listBatches()`；选项第一项固定为「全部历史（不传 batchId）」，其后按 `AnnotationBatchSummary.batchId` 列出批次。
- 选中行为：`refresh()` 用 `list('all', { batchId })` 拉队列、`consistency({ batchId })` 拉一致性；切换批次时清空 `current` / `reveal` / `highlightTurn`。
- **禁止把 batchId 做成默认值**：初始选项 = 「全部历史」，请求不带 `batchId`（契约文档 §D8 第 5 条同款红线）。
- 批次行上只读展示 `sessions / annotatableSessions / transcriptAvailableSessions` 计数；`valid === false` 的批次在选项中标注不可用样式，是否可选以后端契约文档为准。
- envelope `warnings`（如 `INVALID_BATCHES_HIDDEN:<n>`）在选择器下方以小字提示，不弹错。

### D2 · ref 解析（修复派生行 id=null 断链）

- 队列项 `:key` 与点击打开统一用 `row.id ?? row.debugSessionId`；抽出 `rowRef(row)` 辅助函数，避免模板里散落空值判断。
- `detail / save / reveal / auto` 全部传该 ref；`openRow`、`saveAndNext`、`onKey`（ArrowRight）三处调用点同步改。
- 保存成功后按既有流程 `refresh()`；首次保存（原 id=null）后端 upsert 返回行后，队列以新 id 刷新。

### D3 · 三态处理（横幅 + 禁用策略）

| 态         | 判定                                     | 前端处理                                                                                                                                                                                                           |
| ---------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 未建行     | `row.id === null`                        | 队列项加「未落行」徽标；可打开、可填写、可保存（首次 PUT 幂等 upsert）；保存前不额外阻断。                                                                                                                         |
| 逐字稿缺失 | `row.transcriptSource === 'missing'`     | 中栏显示横幅「逐字稿已淘汰 / 缺失，无法定位台词」；气泡区不渲染对话；**是否允许保存本场**以后端契约文档 D3 为准——契约规定不可标时禁用保存按钮并提示，契约允许时照常保存。                                          |
| 批次不可比 | `consistency.scope.comparable === false` | 校准概览三数字整体遮住（灰显或替换为横幅），逐条展示 `scope.incomparableReasons`（码值映射中文提示）；`scope.warnings`（`SMALL_SAMPLE` / `ENGINE_VERSION_DIRTY` 等）单列提示行。数字响应仍在前端，但不展示为结论。 |

- 三态提示文案走既有 `HelpTip` / 朴素横幅样式体系，不新增依赖图标库；不用普通 emoji。

### D4 · 进度文案与口径

- `HINTS.progress`（现 :48）去掉「30 场锚点场次」硬编码；文案改为与批次口径无关的通用说明。
- `done / total` 直接读响应（后端按是否带 batchId 切换口径），前端不自行计数。
- 未选批次（全量）时，进度卡、队列、一致性与改造前一致。

### D5 · 轮级最小集表单（右栏，标注本场面板内）

- 新增三项输入，全部可空，回填来自 `row.firstBadTurn / badTurns / turnNote`：
  - `firstBadTurn`：数字输入，最小 1，可空；
  - `badTurns`：逗号分隔文本框；本地仅做解析校验（去重、升序、≤10 个、每个 ≤ `turnCount`），**提交时按后端 DTO 约定传逗号分隔字符串**（不是数组）；非法输入当场提示且不提交；后端 400 错误原样展示消息；
  - `turnNote`：多行文本，事实描述口径；placeholder 注明「只写观察到的事实，不写评分 / 等级」。
- 保存 body 带上三项（未填传 `null`；不传的键是否省略以契约文档为准，与后端 DTO 对齐）。
- 既有七字段（探索轮次 / 主导标签 / 危机档 / 危机首轮 / 该断轮次 / 存疑 / 备注）保持不变。

### D6 · 批次元信息只读展示

- 详情头部（现 :261–268 区域）只读展示 `batchId`、`engineVersion`、`promptVersion`（`counselorModeId` / `characterVersion` 按契约文档需要决定是否展示）；纯文本，不加交互。
- 队列项副标题在依恋风格之外，需要时补批次短标识；不挤占标签列。

### D7 · 一致性面板守卫（左栏校准概览，现 :210–239）

- `scope.comparable === false`：隐藏 `labelAgreement / crisisAgreement / explorationTurnMae` 三个数值，横幅给不可比原因。
- `scope.warnings` 非空：在数值区下方列提示行（不阻断标注流程）。
- `labeled === 0` 的旧空态文案保留。

### D8 · 契约同步纪律

- 视图只消费 `types.ts` 导出的类型；响应字段在类型里不存在时，先补类型再用，不在组件里 `any` 绕过。
- 后端契约文档落地后，逐条对照本单 D1–D7 与文档 §D2–D4；有出入以文档为准，并在交付记录「方案偏差」里写明。

---

## 4. 红线（违反即返工）

- **batchId 口径**：不传 = 历史全量；传 = 单批；两种口径不能混，前端不得缓存跨批的 done/total/一致性结果。
- **零压红线**：轮级三字段与备注只允许事实描述；禁止出现分数、星级、评级、对错标签。
- **隐私红线**：对话原文不进 console / 日志 / 上报；`turnNote` 等用户输入只走保存接口。
- **契约真相源**：枚举值、字段名、原因码只从后端响应 / 契约文档读；前端不另抄一份判定口径。
- **隔离**：不碰后端目录与其他视图；不新增 npm 依赖；不改路由与全局 store。
- 不自动 commit / push。

---

## 5. 闸门（前端流程执行；本单不跑后端命令）

### 5.1 命令规范

- `admin-dashboard/` 独立 `package.json`，脚本：`type-check`（`vue-tsc --build`）、`build-only`（`vite build`）、`build`（两者串联）。
- 包管理与仓库一致用 pnpm；在 `admin-dashboard/` 目录下执行。

### 5.2 交付前闸门

| 闸门     | 命令                                    | 要求                                                                                                                               |
| -------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 类型     | `pnpm type-check`                       | 本单新增改动 0 error；既有类型债单独列基线数字，不记为本单引入，也不在本单清理                                                     |
| 构建     | `pnpm build-only`                       | 通过                                                                                                                               |
| 手工回归 | 浏览器走查三条路径                      | ① 不传 batchId：队列 / 进度 / 一致性与改造前一致；② 选批次：队列、进度、一致性随批切换；③ `missing` 与不可比两种横幅可见、文案正确 |
| 范围     | `git status --short -- admin-dashboard` | 只含本单文件；后端目录无本单改动                                                                                                   |

> 既有类型债基线：开工前先跑一次 `pnpm type-check` 记录既有 error 数，与收尾结果分开写进交付记录。

---

## 6. 交付记录（完成后写，路径固定）

`docs/worklog/completed/phase2.5/wp-n-fe-annotation-batch-ui-implementation-YYYY-MM-DD.md`，内容：

1. 一句话总结；
2. 实际实现 vs 本单方案的偏差（含与后端契约文档的对照结果；字段不一致时写明改了哪个类型 / 客户端方法）；
3. 改动文件清单（新建 / 修改，逐个一句用途）；
4. 闸门表：命令 / exit code / 真实数字（type-check error 数、build 结果、既有债基线 N 条）；
5. 三态与批次切换的手工走查结果；
6. 风险与回归：既有无批次路径是否保持行为一致；确认未碰后端目录、其他视图、engine-core；
7. 遗留项与建议人工复核。

---

## 7. 【交付回写清单】做完逐项勾选

- [ ] 交付记录已写到 §6 固定路径
- [ ] 本任务单从 `pending/` 移到 `completed/phase2.5/`，状态行改 ✅ 并链接交付记录
- [ ] 回写 `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md` 本任务行状态与交付记录链接
- [ ] 回写 `docs/worklog/pending/phase2.5-README.md` §3 当前任务表
- [ ] `git diff --stat HEAD -- src/engine-core` 为空
- [ ] 提交分组：`admin-dashboard` 文件单独成组，不混入后端并行产物
- [ ] 给一行 commit message 草稿（不自己 commit / push）

---

## 8. 依赖与开工顺序

1. WP-N 后端交付：端点、行字段、scope、轮级三列落地，契约文档 `docs/team/quality-annotation-batch-api-contract.md` 定稿。
2. 对照契约文档核对 `types.ts` / `client.ts` 预接类型（§D8）。
3. 开工本单视图改造；§5.2 闸门通过后写交付记录、回写清单。
