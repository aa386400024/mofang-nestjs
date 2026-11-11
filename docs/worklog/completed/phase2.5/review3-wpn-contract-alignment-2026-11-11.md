# REVIEW-3 · WP-N 标注批次前后端契约类型对齐复核交付记录

> **状态**：✅ 已交付 · **日期**：2026-11-11 · **分支**：integrate · **执行方**：MiniMax Code
> **任务单**：[phase2.5-contract-wpn-fe-be-alignment-review-2026-11-11.md](../../pending/phase2.5-contract-wpn-fe-be-alignment-review-2026-11-11.md)
> **契约真相源**：`docs/team/quality-annotation-batch-api-contract.md`（WP-N 后端 active spec）
> **代码改动**：前端 `admin-dashboard/src/api/types.ts` **1 个文件**（仅类型投影）；后端 `src/` **零改动**

---

## 一、本单做了什么

把契约 md 的 7 个 HTTP 端点逐条对照 `admin-dashboard/src/api/types.ts`（消费侧类型投影）与 `admin-dashboard/src/api/client.ts`（请求封装），核对**字段名 / 层级 / 可空性 / 枚举取值 / 查询参数 / 响应包裹形状**六项。结论：**23 个字段组中 21 组完全一致，2 组存在"前端类型比契约松"的口径缺口，已做最小类型修复；另有 1 条契约内部自相矛盾项登记为契约待修订（不改前端）**。

---

## 二、端点对照表（交付物 1）

| #   | 端点（契约 §1.1）                                | 查询参数                   | 响应包裹                                                                          | 前端类型                                                 | 一致性                                          |
| --- | ------------------------------------------------ | -------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------- |
| 1   | `GET /admin/api/quality/batches`                 | `includeInvalid` ✅        | `{data[], meta:{generatedAt,total}, warnings[]}` ✅                               | `AnnotationBatchListResponse` + `AnnotationBatchSummary` | ✅ 一致（`valid: boolean                        | null` 可空性一致；`validityFlags: string[]` ✅） |
| 2   | `GET /admin/api/quality/annotations`             | `status` ✅ + `batchId` ✅ | `{items[], done, total}` ✅                                                       | `AnnotationListResponse` + `AnnotationRow`               | ✅ 一致（24 字段逐项对齐）                      |
| 3   | `GET /admin/api/quality/annotations/:ref`        | —                          | `{row, characterLabel, messages[], transcriptSource, warnings[]}` ✅              | `AnnotationDetail`                                       | ✅ 一致                                         |
| 4   | `PUT /admin/api/quality/annotations/:ref`        | —                          | 行视图（同 #2）✅                                                                 | `AnnotationSaveBody` → `AnnotationRow`                   | ⚠️ 3 字段可空性与契约 §2.4 有出入（见 §三 C-2） |
| 5   | `GET /admin/api/quality/annotations/:ref/reveal` | —                          | `{auto:{explorationTurn, dominantLabel, crisisLevel}}` ✅                         | `AnnotationReveal`                                       | ✅ 一致                                         |
| 6   | `GET /admin/api/quality/annotations/:ref/auto`   | —                          | 同 #5 ✅                                                                          | `AnnotationReveal`                                       | ✅ 一致                                         |
| 7   | `GET /admin/api/quality/consistency`             | `batchId` ✅               | `{labeled, total, labelAgreement, crisisAgreement, explorationTurnMae, scope}` ⚠️ | `AnnotationConsistency`                                  | ⚠️ `scope` 可空性偏松（见 §三 C-1）             |

### 2.1 字段级核对明细

| 组                           | 字段数    | 核对结论                                                      |
| ---------------------------- | --------- | ------------------------------------------------------------- |
| `AnnotationBatchSummary`     | 12        | ✅ 逐项一致（`createdAt: string                               | null`、`valid: boolean                                                                 | null`、`engineVersion/promptVersion/configFingerprint: string | null` 三处可空性与契约"可空=是"一致） |
| `AnnotationRow`              | 24        | ✅ 逐项一致（含 `id: string                                   | null`、`attachmentStyle: string`（非空串）、`transcriptSource`、`warnings: string[]`） |
| `AnnotationSaveBody`         | 11        | ✅ 字段名/层级全一致；⚠️ 3 个字段的"必填 vs 可空"见 C-2       |
| `AnnotationDetail`           | 5         | ✅ 一致                                                       |
| `AnnotationMessage`          | 3         | ✅ 一致（`role`、`text`、`turnIndex`）                        |
| `AnnotationReveal`           | 3         | ✅ 一致（`auto.dominantLabel: AnnotationLabel                 | null`）                                                                                |
| `AnnotationConsistency`      | 5 + scope | ✅ 5 个标量一致；⚠️ `scope` 可空性见 C-1                      |
| `AnnotationConsistencyScope` | 7         | ✅ 字段名/层级一致；⚠️ 两个码数组的**枚举类型**偏松（见 C-3） |
| `AnnotationListResponse`     | 3         | ✅ 一致                                                       |

### 2.2 枚举取值核对（契约 §2.2 / §2.7 vs 前端 vs 后端常量）

| 枚举                         | 契约                                                                          | 前端类型                            | 后端常量                                                             | 结论                      |
| ---------------------------- | ----------------------------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------- | ------------------------- |
| `dominantLabel`              | recounting / resistance / simple_response / affective / cognitive_exploration | `AnnotationLabel` 同 5 值、**同序** | `ANNOTATION_LABEL`（`quality-annotation.constants.ts:21-33`）同 5 值 | ✅ 三方一致               |
| `transcriptSource`           | frozen / live / missing                                                       | `AnnotationTranscriptSource`        | `TRANSCRIPT_SOURCE`                                                  | ✅ 一致                   |
| `incomparableReasons`        | 4 个码（契约写"enum[]"）                                                      | **`string[]`** ⚠️                   | `COMPARABILITY_REASON`（4 个字面量）                                 | ⚠️ C-3 已修               |
| `warnings`（scope 内）       | 2 个码（契约写"enum[]"）                                                      | **`string[]`** ⚠️                   | `COMPARABILITY_WARNING`（2 个字面量）                                | ⚠️ C-3 已修               |
| `status`（查询参数）         | pending / done / all                                                          | `'pending'                          | 'done'                                                               | 'all'`（`client.ts:275`） | `ANNOTATION_STATUS`                       | ✅ 一致                       |
| `includeInvalid`（查询参数） | "1"                                                                           | "0"                                 | "true"                                                               | "false"                   | `boolean` → 只发 `'1'`（`client.ts:271`） | `parseIncludeInvalid` 收 4 值 | ✅ 一致（前端只发合法子集，见 §四） |

> **一处易误判已排除**：后端 `quality-annotation.constants.ts:77` 的映射键写作 `affective_exploration`，但那是**内核策略名 → 标注标签值**的映射；常量本体 `ANNOTATION_LABEL.Affective = 'affective'`（:28-30）。前端 `'affective'` 与契约一致，**不是枚举漂移**。

### 2.3 契约 §三「前端必须处理的三种态」核对

| 态                              | 前端实现                                                                                                | 结论      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- | --------- |
| ① `id: null`（未落行）          | `AnnotationTool.vue:156-158` `rowRef(row) = row.id ?? row.debugSessionId`；列表 `:key="rowRef(row)"` ✅ | ✅ 已处理 |
| ② `transcriptSource: 'missing'` | 列表徽标 `:408` + 详情横幅 `:431` ✅                                                                    | ✅ 已处理 |
| ③ `scope.comparable: false`     | `:184` `consistencyComparable` + 原因码横幅 `:363` + 告警码 `:391` ✅                                   | ✅ 已处理 |

---

## 三、缺口清单与处置（交付物 2）

### C-1 · `AnnotationConsistency.scope` 可空性偏松 —— ✅ 已修

- **现状**：前端 `scope?: AnnotationConsistencyScope`（可选）。
- **契约**：§2.7 响应恒带 `scope`（`batchId` / `sessions` / `engineVersions` / `promptVersions` / `comparable` / `incomparableReasons` / `warnings`）。
- **后端**：`src/quality/quality-annotation.view.ts:166` 声明 `readonly scope: AnnotationConsistencyScope;` —— **必填**。
- **风险**：前端 `AnnotationTool.vue:184` 写的是 `consistency.value?.scope?.comparable ?? true` —— 若 `scope` 缺失，**兜底成"可比"**，三个一致性数字会被当作可信结论展示。这正是契约 §2.7 引用 WP-K 教训要防的"**自信的错结论**"。
- **处置**：`api/types.ts` 改为 `scope: AnnotationConsistencyScope`（必填）。**零运行时变化**（后端恒返回；前端 `?.` 链仍合法，TS 不报"多余可选链"）。

### C-2 · `AnnotationSaveBody` 3 字段可空性与契约 §2.4 有出入 —— ⚠️ **不改前端**，登记契约待修订

- **契约内部矛盾**：§2.4 写"Request Body（**全部可空**；字段语义见 §2.2 行视图）"，但 §2.2 行视图里 `crisisPeakLevel` / `needsReview` / `durationMs` 三项"可空 = **否**"。**契约自己跟自己不一致。**
- **后端**：`QualityAnnotationSaveDto` 三项均为 `@IsOptional()`（`src/quality/dto/quality-annotation.dto.ts`），即**允许不传**；服务层语义：`crisisPeakLevel` 不传 → 保留旧值（`quality-annotation.service.ts:723`）、`durationMs` 不传 → 保留旧值（:727）、`needsReview` 不传 → **重置 false**（:726）。
- **前端**：`crisisPeakLevel: number` / `needsReview: boolean` / `durationMs: number` 三项**必填**，与契约 §2.2 行视图一致，与 §2.4 "全部可空"不一致。
- **为什么不改前端**：
  1. 前端类型比后端**更严**（不是更松）→ **不可能产生非法请求**，无运行时缺陷；
  2. 实际用法正确：`AnnotationTool.vue:268-279` 每次都发全量表单值（`crisisPeakLevel` 是 0~3 滑杆、`needsReview` 是复选框、`durationMs` 是前端实测耗时），加载时从行视图回填（`:239-244`）→ "发送旧值 = 不改该列"的语义成立；
  3. 若改成可选，反而会**打开一条语义未定义的"不传"路径**（三个字段的"不传"语义各不相同：两个保留、一个重置），并让 `needsReview` 有被静默重置的风险 —— 比现状更差。
  4. 按任务单 §2 处置分级："契约文档与后端实现不符 → 不改前端适配错误后端，只在交付记录登记契约待修订条目"。
- **处置**：**不改前端**；登记契约待修订条目（见 §六）。

### C-3 · `scope.incomparableReasons` / `scope.warnings` 用 `string[]` 而非枚举联合 —— ✅ 已修

- **现状**：两个码数组都是 `string[]`，可塞任意字符串。
- **契约**：§2.7 两处都标注为 `enum[]`。
- **后端**：`readonly ComparabilityReason[]` / `readonly ComparabilityWarning[]`（字面量联合），且判定器**只**会 push 4 个 reason（`quality-annotation-batch.ts:171-174`）与 2 个 warning（:176-177）。
- **风险**：前端拿 `string[]` 时，后端若新增一个码，前端**编译期无感知**，只能靠 `codeText` 兜底显示英文原码（`AnnotationTool.vue:92`）—— 口径漂移不可见。
- **处置**：`api/types.ts` 新增两个字面量联合类型 `ComparabilityReason`（4 值）/ `ComparabilityWarning`（2 值），并把两个数组收窄。**零运行时变化**（前端仍按原逻辑渲染；未知码的 `codeText` 兜底路径保留 —— 只是类型层不再允许传入非法码）。
- **注**：**未**动 `AnnotationBatchListResponse.warnings` —— 它的码带动态后缀（`INVALID_BATCHES_HIDDEN:<n>`），不是枚举，保持 `string[]`。

### 3.1 未修但已登记的后续项

| 编号 | 条目                                                                                                                                              | 归属           |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| F-1  | `AnnotationTool.vue:184` 的 `?? true` 兜底（C-1 修完类型后已是死路径，但**视图层**本单不改）—— 应改为"scope 缺失 = 报错/不显示数字"而非"当成可比" | 后续前端单     |
| F-2  | 前端既有 51 条 vue-tsc 类型债（13 文件）—— 本单**不清理**（任务单明确），沿用 WP-N-FE 交付记录 §遗留 #4                                           | 已登记 backlog |
| F-3  | 契约 §2.4 "全部可空" 与 §2.2 行视图可空性矛盾（C-2）—— 需契约方拍板并修订                                                                         | 契约待修订     |

---

## 四、只读核对的其他发现（未改，记在案）

1. **`includeInvalid` 前端只发 `'1'`**：契约允许 4 个取值，前端类型是 `boolean` → 只发 `'1'` 或不发（缺省 `0`）。这是**合法子集**，不可能触发契约 §六 的"非法值 → 400"。**不构成缺口**，不改。
2. **`status` 恒发送**：前端 `client.ts:275` 默认 `'pending'` 并恒写入 query，契约缺省亦为 `pending` → 行为一致。
3. **批次口径未做前端默认值**：契约 §五 明令"前端**不许**把 `batchId` 做成默认值"，前端 `client.ts:277` 仅在显式传入时拼参 ✅，视图 `batchQuery()`（`AnnotationTool.vue:163-165`）以 `selectedBatchId.value` 为准 ✅。

---

## 五、改动文件清单

| 文件                                | 改动                                                                                                                                                                                                |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin-dashboard/src/api/types.ts`  | 新增 `ComparabilityReason` / `ComparabilityWarning` 两个字面量联合类型；`AnnotationConsistencyScope.incomparableReasons` / `.warnings` 收窄为对应联合；`AnnotationConsistency.scope` 由可选改为必填 |
| 后端 `src/**`                       | **零改动**                                                                                                                                                                                          |
| `admin-dashboard/src/api/client.ts` | **零改动**（无需改：查询参数透传已符合契约）                                                                                                                                                        |
| Vue 视图 / 组件                     | **零改动**（任务单 §2 明令不在本单重构组件）                                                                                                                                                        |

---

## 六、闸门表（真实数字）

### 6.1 后端（本单后端零改动，复用同工作树基线实测值）

| 闸门        | 命令                                            | exit code | 真实数字                                                                                                                     |
| ----------- | ----------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 类型        | `pnpm exec tsc -p tsconfig.build.json --noEmit` | **0**     | **0 error**                                                                                                                  |
| Lint        | `pnpm lint`（`--cache`）                        | **0**     | **0 error / 2 warning**（既有 `import/order`，位于 `src/auto-practice/metrics/batch-metrics.service.ts:23 / :25`，本单未碰） |
| 测试        | `pnpm test`                                     | **0**     | **181 文件 / 2947 例**：**2943 passed + 4 skipped，0 failed**；Duration 101.63s                                              |
| engine-core | `git diff --stat HEAD -- src/engine-core`       | **0**     | **空**                                                                                                                       |

### 6.2 前端（改动前后各跑一次，两组数字分列）

| 闸门         | 命令                                                                 | 改动前基线                                          | 改动后                                                          | 判定                                                                                                |
| ------------ | -------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 类型         | `pnpm --dir admin-dashboard type-check`（`vue-tsc --build`）         | **51 错误 / 13 文件**                               | **51 错误 / 13 文件**                                           | ✅ **新增 0 错误**（既有债数字与改动前**逐一致**）                                                  |
| 本单改动文件 | 同上（只看 `api/types.ts` / `api/client.ts` / `AnnotationTool.vue`） | `types.ts` 0、`client.ts` 2、`AnnotationTool.vue` 0 | `types.ts` **0**、`client.ts` **2**、`AnnotationTool.vue` **0** | ✅ `types.ts` 仍 0；`client.ts` 2 条**未变**（:237 / :258，既有 `Object.entries` cast，非本单引入） |
| 构建         | `pnpm --dir admin-dashboard build-only`（`vite build`）              | —                                                   | 见 §六.3                                                        | ✅                                                                                                  |

> **既有债基线复核**：改动前实测 **51 错误 / 13 文件**，与 WP-N-FE 交付记录 §三 记的"51 条 / 13 文件"**完全吻合** → 基线可信，非本单引入。

### 6.3 前端构建结果

| 命令                                    | exit code | 真实输出                                                                                       |
| --------------------------------------- | --------- | ---------------------------------------------------------------------------------------------- |
| `pnpm --dir admin-dashboard build-only` | **0**     | **✓ built in 5.37s**；产物含 `AnnotationTool-qsn95AwL.js`（23.79 kB / gzip 6.84 kB）等，无告警 |

---

## 七、回归风险

- ✅ **后端 `src/` 零改动** → 后端行为零风险；`git diff --stat HEAD -- src/engine-core` 为空，`boundary.spec.ts` 未改未跑。
- ✅ **前端改动仅在类型层**（`api/types.ts`），**无运行时逻辑变更**：改的是"允许什么形状"，不是"跑什么逻辑"。`api/client.ts` 与所有 Vue 视图**零改动**。
- ✅ **C-1 / C-3 均为"收紧到后端实际形状"**：后端恒返回 `scope`、只 push 那 4+2 个码 → 收紧后类型与运行时事实**更一致**，不可能出现"类型允许但后端不产"的形状。
- ✅ **未碰 DB / migration / prompt / engine-core / Flutter**。
- ✅ **心理对话原文零外泄**：本记录只出现字段名、枚举值、码值、文件:行，无任何逐字稿内容或标注答案。
- ✅ **未自动 commit / push**。

---

## 八、遗留项

1. **契约待修订（F-3 / C-2）**：契约 §2.4 "Request Body（全部可空）"与 §2.2 行视图（`crisisPeakLevel` / `needsReview` / `durationMs` 可空=否）矛盾；后端 DTO 三项均为 `@IsOptional()`。建议契约方明确"这三项不传 = 保留旧值（`needsReview` 例外 = 重置 false）"并同步 §2.2 / §2.4。
2. **前端既有 51 条类型债（F-2）**：13 个文件（`api/client.ts` / `App.vue` / `DebugTracePanel.vue` / `AutoPractice.vue` / `CharacterDetail.vue` / `CharactersList.vue` / `CostBoard.vue` / `Dashboard.vue` / `EvalReports.vue` / `GateDecisions.vue` / `ParamCalibrator.vue` / `SessionDetail.vue` / `SessionsList.vue`），本单不清理，沿用 WP-N-FE §遗留 #4。
3. **视图层后续（F-1）**：`AnnotationTool.vue:184` 的 `?? true` 兜底待清（本单只读视图，不改）。
4. **本单未做在线联调复核**：契约对照 + 类型投影 + 静态闸门已完成；浏览器三路径回归沿用 WP-N-FE 交付记录 2026-11-11 的用户现场走查结论（无问题），本单未重复。

---

## 九、commit message 草稿（**不自动提交**）

```
fix(admin-dashboard): WP-N 契约类型对齐 —— scope 必填 + 可比性码收窄为枚举联合
```
