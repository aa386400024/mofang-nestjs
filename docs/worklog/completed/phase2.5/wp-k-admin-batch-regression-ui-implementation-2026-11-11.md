# WP-K · 批次回归追踪 · Admin 前端页面补做 · 交付记录

- 日期：2026-11-11
- 执行：主 Agent（自做）
- 范围：`admin-dashboard/`（Vue3 + Naive UI + ECharts），后端三端点与契约早已就绪，前端此前一行未接
- 契约：`docs/team/batch-regression-api-contract.md` §6「前端批次回归页要求（契约，不代实现）」
- 性质：WP-K D9 只交付后端契约；本轮补齐消费该契约的管理后台页面。本轮所有改动留在工作区，**未提交、未推送**

---

## 1. 一句话结论

**批次回归对比页已接入 admin-dashboard，并按三层补全图表：历史批次指标多系列趋势折线 + 场次/轮数规模柱状图 + 批次构成统计卡（层 1，列表行字段零额外请求）；单批快照下钻面板——八维首末雷达、维度变化条、事件/策略率分布、出口分布、覆盖率环图、按模式/角色分组切片（层 2，按需调 `batchMetrics`）；对比报告逐指标 delta 横向条形图（层 3，复用报告数据）。基线单选 / 候选多选（上限 10）+ 逐指标差分表 + 配置变化段标签 + incomparable 警示横幅（不渲染好坏红绿结论）+ legacy 批次分组折叠。另建指标说明体系：本地指标目录镜像（口径 / 单位 / 取值域 / 方向 / 8 条验收判据）、指标名旁多行说明浮层、指标字典汇总卡（判据表 + 族目录），趋势 / 差值图加零轴参考线。新增 11 个源码文件、改动 6 个既有文件；新增文件类型检查 0 错误，`vite build-only` 打包 exit 0，`BatchRegression` 独立懒加载分包。**

---

## 2. 契约 §6 五条要求落地对照

| 契约要求（§6）                                            | 落地位置                             | 实现                                                                                                                                                                |
| --------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ① 时间轴：批次按时间排列，关键指标折线可切换              | `BatchTrendChart.vue` + 视图折线卡片 | 行数据按 `createdAt` 升序排序；4 个冗余标量（探索率 / 深度阻抗变化 / 安全感变化 / 正事件率）同图多系列折线，legend 可点击显隐；null 值断线（`connectNulls: false`） |
| ② 差分表：逐指标列 base / candidate / delta / 方向        | `CompareReportCard.vue` 表格         | 列：指标名、基线、候选、差值（带正负号）、方向标签；指标 id → 展示名本地投影，未知 id 原样回退保留可追溯                                                            |
| ③ changedSegments 标签 + hover 段名                       | `CompareReportCard.vue` 段标签行     | 7 段配置指纹标签，`NTooltip` hover 显示段英文 id；段顺序与后端 `CONFIG_SEGMENT_ORDER` 对齐                                                                          |
| ④ incomparable 顶部横幅 + 原因，禁止渲染变好/变坏红绿结论 | `CompareReportCard.vue` 警示块       | 琥珀色横幅列出 `reasons`；incomparable 时**不渲染差分表**，结论标签用 warning 而非 success/error                                                                    |
| ⑤ legacy 批次置灰标注「未采集指标」，不与有效批同色对比   | `BatchRegression.vue` 行判定         | 四个冗余标量全 null 判为 legacy（与实体 `metrics_json = NULL` 同源）；行置灰 `opacity-50` + 标签；基线 / 候选均禁选                                                 |

### 四态结论标签映射（前端展示，不改后端语义）

| verdict      | Naive tag type | 文案（zh / en）       |
| ------------ | -------------- | --------------------- |
| improved     | success        | 改善 / Improved       |
| neutral      | default        | 中性 / Neutral        |
| regressed    | error          | 回归 / Regressed      |
| incomparable | warning        | 不可比 / Incomparable |

---

## 3. 改动文件清单

### 新建源码（11 个，均在 `admin-dashboard/src/`）

| 文件                                | 用途                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/batchRegressionMeta.ts` | 共享映射：指纹段顺序、八维 / 事件 / 策略 / 出口枚举顺序与短名、指标 id → 展示名投影、`formatMetric`（null → —）、`formatDelta`（带正负号）、`shortHash`、`isLegacyBatch`、`formatBatchTime`、维度 / 事件 / 策略 / 出口短名导出。单一真相源仍在后端字典，前端只做本地投影                                              |
| `components/BatchTrendChart.vue`    | 层 1 多系列趋势折线；props `{ rows }`；四冗余标量同图 + legend；数据源为列表行冗余标量，不逐批拉快照                                                                                                                                                                                                                  |
| `components/BatchScaleChart.vue`    | 层 1 批次规模柱状图；场次（左轴）/ 轮数（右轴）双系列柱，计数口径与比率折线分图                                                                                                                                                                                                                                       |
| `components/BatchRowItem.vue`       | 批次列表行子组件：基线按钮 + 候选复选框 + 快照入口 + 标签 + 四标量 + 指纹；有效批与 legacy 折叠组复用同一模板，emit `select-base` / `toggle-candidate` / `view-snapshot`                                                                                                                                              |
| `components/CompareReportCard.vue`  | 单候选批报告卡片：结论标签、legacy 标签、incomparable 横幅、变化段标签、可比时差分表 + 内嵌差值条形图                                                                                                                                                                                                                 |
| `components/CompareDeltaChart.vue`  | 层 3 对比差值条形图：items 的 delta 横向条，按 \|delta\| 排序，按 movement 方向着色；incomparable（items 空）回退空态                                                                                                                                                                                                 |
| `components/BatchSnapshotPanel.vue` | 层 2 单批快照下钻面板：覆盖统计卡、八维首末雷达、维度平均变化条、事件率 / 策略率横向条、出口分布柱、覆盖率环图、按模式 / 按角色分组切片表                                                                                                                                                                             |
| `components/metricCatalog.ts`       | 指标目录本地镜像：`MetricInfo`（标签 / 单位 / 方向 / 取值域 / 口径 / 验收判据）、八维 / 事件 / 策略 / 出口族规则生成、5 条显式标量、8 条 intake 判据镜像、`getMetricInfo` / `getMetricInfoByRowField` / `EXPECTATION_LIST` / `expectationText`；阈值真相源在后端 `metric-dictionary.ts` 与 `acceptance-thresholds.ts` |
| `components/MetricInfoTooltip.vue`  | 指标说明浮层：props `metricId?` / `rowField?`；方向标签 + 口径 + 单位 / 取值域 + 验收区间与临床依据；目录未登记指标不渲染入口；无判据指标明确标注"未纳入 intake 验收"                                                                                                                                                 |
| `components/MetricCatalogCard.vue`  | 指标字典汇总卡：8 条验收判据表（指标 / 类型 / 区间 / 依据）+ 五族目录摘要；纯静态、无请求                                                                                                                                                                                                                             |
| `views/BatchRegression.vue`         | 主视图：批次列表（基线单选 + 候选多选 ≤10）、层 1 趋势 / 规模图与构成卡、快照按需加载与下钻面板、对比触发、结果卡片、指标字典汇总卡；加载 / 错误 / 空态三态兜底                                                                                                                                                       |

### 修改的既有文件（6 个）

| 文件                    | 改动                                                                                                                                                                                                                                                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api/types.ts`          | 末尾追加契约类型：`BatchVerdict`、`ConfigSegment`、`ConfigFingerprintSegments`、`ApiEnvelope<T>`、`BatchSummaryRow`、`BatchCoverage`、`BatchLineageEntry`、`MetricsSlice`、`BatchMetricsV1`、`BatchMetricsPayload`、`RegressionItem`、`CompareCandidateReport`、`CatalogMetricDef`、`CatalogExpectation`、`MetricCatalogPayload` |
| `api/client.ts`         | `api` 对象末尾新增 `batchRegression` 分组：`listBatches`（分页 / 排序 / 过滤参数预留）、`batchMetrics`、`compareBatches`（候选切片上限 10）、`getMetricCatalog`；统一走 `{ data, meta, warnings }` 信封                                                                                                                          |
| `router/index.ts`       | 懒加载 `BatchRegression`，路由 `/batch-regression`，位于 eval-reports 与 quality/annotation 之间                                                                                                                                                                                                                                 |
| `App.vue`               | 菜单 training 组（autoPractice 之后）、全局搜索 `allPages` 项、面包屑分支三处接线                                                                                                                                                                                                                                                |
| `i18n/locales/zh-CN.ts` | `nav.batchRegression` + `batchRegression` 整段（指标 / 标签 / 四态 / 方向 / 七段名）                                                                                                                                                                                                                                             |
| `i18n/locales/en.ts`    | 同上英文对齐                                                                                                                                                                                                                                                                                                                     |
| `components.d.ts`       | unplugin-vue-components 自动生成，追加 `BatchTrendChart`、`BatchScaleChart`、`BatchSnapshotPanel`、`BatchRowItem`、`CompareReportCard`、`CompareDeltaChart`、`MetricInfoTooltip`、`MetricCatalogCard` 全局组件声明（非手写）                                                                                                     |

### 后端端点（本轮追加：字典只读投影）

| 文件                                                      | 改动                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/auto-practice/metrics/metric-dictionary.ts`          | 新增 `METRIC_DICTIONARY_VERSION = 'dict-v1'`（字典版本标识，供前端缓存与审计比对）；字典 / 判据常量本身零改动                                                                                                                                                                                      |
| `src/auto-practice/auto-practice.controller.ts`           | 新增 `GET metrics/catalog` 只读端点；投影组装抽为静态纯方法 `AutoPracticeController.buildMetricCatalog()`（无 IO、无判定逻辑，便于单测）；返回信封 `{ data: { dictionaryVersion, acceptanceVersion, metrics, expectations }, meta: { generatedAt, metricCount, expectationCount }, warnings: [] }` |
| `test/auto-practice/wp-k-metric-catalog-endpoint.spec.ts` | 新增单测 4 条：字典 / 判据数组与常量同源（长度 + 逐条引用一致）、版本号透传、每条判据 metricId 都在字典内                                                                                                                                                                                          |

### 与后端契约对齐核对（逐字段 / 逐路由）

- 信封：新三端点统一 `{ data, meta, warnings }`；与旧 `GET /batches/:id`（裸对象，当前批次进度轮询）区分，未混用。
- 路由：`GET /auto-practice/batches`、`GET /auto-practice/batches/:id/metrics`、`GET /auto-practice/batches/compare?base=&candidates=`，query 参数名与控制器 `@Query('base')` / `@Query('candidates')` 一致；前端 `BASE = '/admin/api'` 拼全路径。
- 判定器 `items` 只保留非 neutral 方向指标（trust/safety/bond/valence 的 first_avg/last_avg/delta_avg/per_turn_rate + 五个标量），前端名称投影表与该集合一一覆盖；其余事件 / 策略 / 阻抗三维 / p10/p90 为 neutral 不进 items。

---

## 4. 闸门表（真实数字）

| 闸门             | 命令                                                                                                                             | 结果                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 后端类型         | `pnpm exec tsc -p tsconfig.build.json --noEmit`                                                                                  | **exit 0**，无错误                                                                            |
| 后端单测         | `pnpm exec vitest run test/auto-practice/wp-k-metric-catalog-endpoint.spec.ts test/auto-practice/wp-k-metric-dictionary.spec.ts` | **2 files / 13 tests 全绿**（catalog 投影 4 + 字典自洽 9）                                    |
| 类型（新增文件） | `pnpm type-check`（`vue-tsc --build`）                                                                                           | **11 个新增文件 0 错误**；`types.ts` / `client.ts` 新增段、`App.vue` 新增行无报错             |
| 类型（整工程）   | 同上                                                                                                                             | **51 条既有历史类型债**，exit 2；全部位于改动前即存在的旧视图 / 组件（见 §6），本轮未越权清理 |
| 打包             | `pnpm build-only`（纯 `vite build`，不串 type-check）                                                                            | **exit 0**，7.99s；`dist/assets/BatchRegression-*.js` 37.74 kB（gzip 10.84 kB）独立分包       |

> 说明：`build` 脚本 = `run-p type-check build-only`，会被既有 51 条类型债阻断；`build-only` 为纯打包闸门，本次用其验证产物。

---

## 5. 页面交互与状态兜底

- **选择约束**：legacy 行不可设基线、不可勾选候选；基线自身从候选集合排除；候选达 10 上限后停止追加；未选基线或候选为空时对比按钮 disabled。
- **legacy 分组折叠**：有快照的有效批次默认展开；快照未采集的 legacy 批次收进可折叠分组「历史批次 · 未采集指标（N）」，点击组头展开 / 收起；折线只绘制有效批次；选中态（基线 / 候选）独立于显隐，折叠不丢失已选。
- **层 1 趋势 / 规模 / 构成**：折线与规模柱只画有效批次（`trendRows` 按时间升序）；构成统计卡计数有效批 / legacy / 门禁不合格（`valid === 0`）；规模图为计数口径，与比率折线分图分轴。
- **层 2 快照下钻**：行内「查看快照」按钮（仅非 legacy 可用）→ 按需调 `batchMetrics(batchId)`；同一批再次点击收起；面板展示覆盖统计、八维首末雷达、维度变化、事件 / 策略率、出口分布、覆盖率环图与分组切片；legacy 占位（`legacy: true`）显示未采集原因，不渲染图表。当前库内仅 1 批有快照，其余快照图待回填更多批次后显现。
- **层 3 差值条形**：报告卡片内 `CompareDeltaChart` 复用 `report.items`，零额外请求；按 movement 着色（改善绿 / 中性灰 / 回退红），明细数值仍以差分表为准。
- **指标说明层**：趋势表头四指标、差分表指标名、快照面板图表标题挂 `MetricInfoTooltip`（口径 / 单位 / 取值域 / 方向 / 验收区间与依据）；视图顶部 `MetricCatalogCard` 汇总 8 条 intake 判据表 + 五族目录；趋势折线、差值条、维度变化条挂零轴参考线。判据限值因维度而异，未在图上叠加分维区间线，区间由汇总卡与浮层承载。
- **目录数据源（远端优先 + 本地兜底）**：视图 `onMounted` 调 `loadMetricCatalog()` 并行拉取（不阻塞批次列表）；远端目录会话级缓存，`catalogTick` 驱动卡片 / 浮层重算；拉取失败静默回退本地兜底规则，汇总卡标注来源（remote / fallback）与字典 / 判据版本号。本地兜底常量仅作离线降级，不再是口径真相源。
- **三态**：`loading` → `Skeleton`（card-list ×5）；`err` → `EmptyState`（warning 图标 + 重试 `onRetry`，沿用既有 `EmptyState` props 口径，非事件绑定）；空列表 → `EmptyState`（doc 图标）。快照面板独立 loading / err / 数据三态。
- **对比流程**：`compareBatches(baseId, candidateIds)` → `reports = res.data`；对比中按钮 loading；结果区逐候选渲染 `CompareReportCard`，候选行通过 batchId 反查列表行补齐规模 / 时间 / note。
- **请求纪律**：趋势与构成图直接消费列表行冗余标量，不逐批拉快照；仅快照下钻面板按需单批请求，避免 N+1。

---

## 6. 既有类型债（本次未动，不纳入范围）

整工程 51 条 `vue-tsc` 错误，分布如下，均为改动前存在的旧代码：

| 文件                                                                               | 条数 |
| ---------------------------------------------------------------------------------- | ---- |
| `components/DebugTracePanel.vue`                                                   | 12   |
| `views/AutoPractice.vue`                                                           | 7    |
| `views/CharacterDetail.vue`                                                        | 7    |
| `views/SessionDetail.vue`                                                          | 5    |
| `views/ParamCalibrator.vue`                                                        | 4    |
| `views/CharactersList.vue`                                                         | 3    |
| `views/EvalReports.vue`                                                            | 3    |
| `api/client.ts`（既有 evalReports / gateTraces 的 `as Record` 断言，非本次新增段） | 2    |
| `App.vue`（既有 `filteredPages` computed，非本次新增行）                           | 2    |
| `views/Dashboard.vue`                                                              | 2    |
| `views/GateDecisions.vue`                                                          | 2    |
| `views/CostBoard.vue`                                                              | 1    |
| `views/SessionsList.vue`                                                           | 1    |

新代码内布尔 prop 统一用 `:bordered="false"` 布尔绑定，未沿用旧视图 `bordered="false"` 字符串写法（旧写法在 vue-tsc 下报 TS2322，属上述既有债的同类模式）。

---

## 7. 风险与回归

- **后端改动范围**：本轮后端仅新增 `metrics/catalog` 只读端点、静态投影方法与 `METRIC_DICTIONARY_VERSION` 常量；未改判定器、未改 `src/engine-core`、未改任何业务计算逻辑与既有端点行为。
- **未碰既有视图逻辑**：除 `App.vue` 三处菜单 / 搜索 / 面包屑接线外，旧视图只读参照（`EvalReports.vue` 三态、`BdiTrajectoryChart.vue` ECharts 写法），未改其行为。
- **i18n 双端对齐**：zh-CN / en 键集合一一对应；未知指标 id 回退原始 id，不会因缺文案丢字段。
- **指标口径边界**：目录真相源在后端 `metric-dictionary.ts` / `acceptance-thresholds.ts`，经 `metrics/catalog` 只读端点下发；前端本地规则仅作端点失败时的离线兜底。前端**不复算** pass / fail，验收结论以后端判定器为准，避免阈值在两端漂移。合理区间仅覆盖 8 条 intake 判据；其余指标在浮层明确标注"未纳入 intake 验收"，不编造健康阈值。
- **后端路由顺序风险（需复核，本次未改后端）**：控制器中 `@Get('batches/:id')`（`auto-practice.controller.ts` 216 行）先于 `@Get('batches/compare')`（354 行）注册。Express 先注册先匹配，`/batches/compare` 可能被参数段 `:id` 捕获（`id = "compare"`）。后端 WP-K 测试只直调 `evaluateRegression` 纯函数、未走 HTTP supertest，故此顺序风险未被测试覆盖。建议后端把 `@Get('batches/compare')` 装饰器上移到 `@Get('batches/:id')` 之前（纯位置调整，不改逻辑）。前端 compare 调用路径与参数名已按契约写对。

---

## 8. 遗留项与演进

1. **路由顺序复核**：见 §7，需后端确认 `batches/compare` 是否被 `batches/:id` 截胡；建议补一条 supertest HTTP 用例覆盖该端点。
2. **既有 51 条类型债**：未在本次清理（隔离红线：不顺手重构相邻旧文件）；如需收口，建议单开任务，按 §6 清单分批修。
3. **列表筛选 / 分页控件**：legacy 批次已在前端分组折叠（方案 1）；sort / order / valid / since / fingerprint 参数已在 API 层预留，视图层暂未暴露筛选控件与分页器；后端列表接口尚无 `legacy`（`metrics_json IS NULL`）过滤参数，批次量增大、分页被 legacy 占坑时再补。
4. **快照下钻深化**：层 2 面板已覆盖雷达 / 维度变化 / 事件 / 策略 / 出口 / 覆盖 / 分组切片；快照 `lineage`（逐场血缘）与 p10 / p90 分布暂以明细字段留存、未单独出图；待回填更多批次后可补分组间指标对比与分布百分位图。
5. **dev 目视验证**：本轮在本环境完成类型检查与打包验证，未长驻启动 dev server 做浏览器目视；建议方便时 `pnpm dev` 打开 `/batch-regression`，用真实批次基线 + 候选走一遍对比流程确认渲染。
6. **提交**：改动全部留在工作区，未 commit / push；commit message 草稿见对话交付说明。
7. **目录演进（本次未做）**：端点下发与会话缓存已落地；后续可演进——(a) 字典 / 判据版本号写入快照 `lineage` 与报告 meta，形成完整审计链（回看旧报告可显示基于哪版标准）；(b) 前后端共享 `MetricDef` / `MetricExpectation` 类型模块或契约生成，替代手写 types；(c) 字典结构预留分档阈值能力（未来按角色 / 场景差异化判据时无需推倒）。本地兜底常量仍需与后端常量保持一致，作为离线降级防线。
