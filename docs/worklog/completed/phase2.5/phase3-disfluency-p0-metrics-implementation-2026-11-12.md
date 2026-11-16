# Phase3 P0 · 文字层真人度「不流利表达」度量层 —— 交付记录

> 状态：✅ 已交付（2026-11-12）
> 任务单：`docs/worklog/completed/phase2.5/phase3-disfluency-p0-metrics-2026-11-12.md`
> 蓝图：`docs/worklog/pending/phase3-text-disfluency-humanization-plan-2026-11-11.md`（§6 P0 · 度量层）
> 执行方：MiniMax Code
> 仓库 / 分支：`mofang-nestjs` / `integrate`
> 性质：纯新增只读度量能力，**零行为变化**（不碰 prompt / env / 表 / 引擎 / schemaVersion）

---

## 1. 一句话总结

在 `src/auto-practice/metrics/` 下新增不流利（disfluency）纯函数分析器与词表模块，把 AI 来访者台词判成 filler / pause / repetition / repair / trailoff / elongation 六类计数；判读只在服务层（IO 层）做一次，**原文用完即弃**，只把纯数值投影进 `TraceInput`，再由纯计算层聚合成 8 个 `text.disfluency.*` 指标写入批次快照（字典升 `dict-v2`）。全程零 prompt 改动、零新增 LLM 调用、零结构化 tag、零新表/migration、engine-core 零改动。

## 2. 方案设计：实际实现 vs 任务单方案（偏差登记）

按 `docs/team/conventions.md` §2.5，方案与任务单有出入必须写明「原方案 / 实际方案 / 为什么」。本单共 6 处偏差，全部是「按任务单红线与蓝图 §5.2.3 隐私分层落地所必需的调整」，无一处为省事。

### 2.1 偏差 1：数值契约的落位（lexicon 而非 analyzer）

| 项       | 内容                                                                                                                                                                                                                                                                                                                   |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 原方案   | 蓝图 §5.2.1 与任务单 §5.1 把 `DisfluencyCounts` / `DisfluencyMetrics` / `aggregateDisfluency` 写在 `disfluency-analyzer.ts`                                                                                                                                                                                            |
| 实际方案 | 类型 + `aggregateDisfluency` + `EMPTY_DISFLUENCY_METRICS` 落在 `disfluency-lexicon.ts`；`disfluency-analyzer.ts` 原样 `export { aggregateDisfluency, EMPTY_DISFLUENCY_METRICS }` 与 `export type { DisfluencyCounts, DisfluencyMetrics }` re-export                                                                    |
| 为什么   | 蓝图 §5.2.3 与任务单红线**同时**要求「compute 层不得 import analyzer」与「compute 层要聚合 8 指标」。若数值契约只存在于 analyzer，compute 层为了拿类型与聚合函数就必须 import analyzer，红线自破。把**纯数值契约**下沉到纯常量模块后，compute 层只 import `disfluency-lexicon.js`，analyzer 仍是唯一接触台词原文的模块 |
| 对外影响 | **无**。`from "./disfluency-analyzer.js"` 仍可拿到 `analyzeDisfluency` / `aggregateDisfluency` / 两个类型，对外 API 形状与蓝图 §5.2.1 逐项一致                                                                                                                                                                         |

### 2.2 偏差 2：归一化拆成两套（长度口径 / 识别口径）

| 项       | 内容                                                                                                                                                                                                              |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 原方案   | 任务单 §5.5：归一化口径对齐 `visitor-quality-audit.ts:266-268`（单一套）                                                                                                                                          |
| 实际方案 | 两套并存：`normalizeForLength`（长度口径，与 audit 逐字等价，用于 `normalizedLength`）；`normalizeForDetection`（识别口径，保留可识别标记，用于六类识别）                                                         |
| 为什么   | audit 的 normalize 会**删掉**省略号与破折号。若识别也用它，pause（省略号）与 elongation（破折号拖音）将**永不命中**，度量层会静默少两类。识别口径只做「去空白 + 连续省略号合并 + 破折号统一」，不引入任何文本语义 |
| 逐字对照 | 见 §5.1                                                                                                                                                                                                           |

### 2.3 偏差 3：repetition 收窄为「只认子句开头的重复」

| 项       | 内容                                                                                                                               |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 原方案   | 蓝图 §5.1：正则检测连续重复的 1-2 字词，排除叠词词表                                                                               |
| 实际方案 | 在「相邻 1-2 字重复」基础上**追加位置约束**：命中必须位于子句开头（句首或紧跟标点）才算 repetition                                 |
| 为什么   | 中文无词边界，「今天天气不错」这类跨词边界的叠字会被相邻重复规则误判（实测原规则多计 1 次），导致 `repetition_per_turn` 系统性偏高 |
| 代价     | 句中口吃式重复会漏计 —— 这是**已知取舍**，交 P1 基线批次量化后决定是否放开（遗留项 L-4）                                           |
| 附带修正 | 叠词白名单判定改为「精确 + 左扩一字 + 右扩一字」，否则「一点点」命中的是「点点」，会被误计 repetition                              |

### 2.4 偏差 4：`TraceInput.disfluency` 设为必填字段

| 项       | 内容                                                                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 原方案   | 任务单未规定可选性；蓝图 §5.2.3 要求「新增一个纯数值 disfluency 字段」                                                                                                    |
| 实际方案 | 设为**必填**（`readonly disfluency: DisfluencyMetrics`），不设可选兜底                                                                                                    |
| 为什么   | 必填让「某个 trace 忘了填」在**编译期**暴露，而不是运行时静默 `undefined` 产出 NaN 指标。service 层保证每次投影都填值（命中 → 真值，未命中 → `EMPTY_DISFLUENCY_METRICS`） |
| 代价     | 既有 spec 夹具必须同步补字段（3 个 spec 文件，见 §7.1）                                                                                                                   |

### 2.5 偏差 5：8 指标不含 `elongation_per_turn`

蓝图 §5.2.2 的 8 指标表本来就没有 elongation 单列项，实现严格照表：`elongation` 只计入 `events` 总量与 `event_turn_rate`，不单列 per-turn 指标。compute 层以显式注释说明，避免后来者误加（compute spec 已断言该键为 `undefined`）。

### 2.6 偏差 6：新键断言落在字典 spec + compute spec，不落在「快照 schema 测试」

| 项       | 内容                                                                                                                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 原方案   | 蓝图 §6 P0 的改动文件清单写「快照 schema 测试补新键断言」                                                                                                                                      |
| 实际方案 | 新键断言放在 `wp-k-metric-dictionary.spec.ts`（八键齐备 / 单位 / bounds / 进 `NON_NULLABLE_IDS`）与 `wp-k-batch-compute.spec.ts`（八指标聚合值 + byMode / byCharacter 切片 + 零值兜底无 null） |
| 为什么   | 本单红线明确「不改 `batch-metrics.schema.ts`、不升 schemaVersion」，因此没有可改的快照 schema 测试；新键的真实契约面是「字典 + 计算层取值」，断言放在这两处比放在 schema 断言更贴近契约        |
| 等价性   | 蓝图意图（快照侧能断言新键存在且有值）已由 compute spec 的 `result.metrics[id]` 断言覆盖                                                                                                       |

## 3. 改动文件清单

### 3.1 新建（3）

| 文件                                                     | 用途                                                                                                                                                                                                                                                |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/auto-practice/metrics/disfluency-lexicon.ts`        | 六类词表（`FILLER_WORDS` / `REPAIR_TRIGGERS` / `REPETITION_WHITELIST` / `ELONGATION_STEMS`）、正则基元、标点字符类、两套归一化函数，以及纯数值契约（`DisfluencyCounts` / `DisfluencyMetrics` / `EMPTY_DISFLUENCY_METRICS` / `aggregateDisfluency`） |
| `src/auto-practice/metrics/disfluency-analyzer.ts`       | `analyzeDisfluency(text)`：六类识别 + 优先级消歧（一位置只归一类），并 re-export 数值契约；**唯一接触台词原文**的模块                                                                                                                               |
| `test/auto-practice/metrics/disfluency-analyzer.spec.ts` | 21 例：六类正例 / 消歧优先级 / 叠词白名单 / 连接词位置约束 / 聚合口径 / 边界（空文本·纯标点·超长句）/ 确定性 / 两套归一化                                                                                                                           |

### 3.2 修改（6）

| 文件                                                   | 改动                                                                                                                                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/auto-practice/metrics/metric-dictionary.ts`       | 版本常量 `dict-v1` → `dict-v2`；新增 `buildDisfluencyMetrics()` 登记 8 个 `text.disfluency.*` 指标（id / label / unit / direction / bounds / nullable / definition）                              |
| `src/auto-practice/metrics/batch-metrics.compute.ts`   | `TraceInput` 增必填 `disfluency: DisfluencyMetrics`；新增 `computeDisfluencyMetrics()` 只做数值聚合，写入 8 个指标键；import 仅来自 `disfluency-lexicon.js`                                       |
| `src/auto-practice/metrics/batch-metrics.service.ts`   | 新增 `collectVisitorDisfluency()`（读顶层 `messages`，取 `role === "visitor"`，按 `turnIndex` 建索引，原文用完即弃）与 `rawTurnIndex()`；`projectTrace(raw, disfluency)` 填数值；未命中填零值结构 |
| `test/auto-practice/wp-k-metric-dictionary.spec.ts`    | +5 例：版本 `dict-v2`、八键齐备且 `nullable=false` / `direction=neutral`、单位与蓝图表一致、bounds 纪律、八键全部进 `NON_NULLABLE_IDS`                                                            |
| `test/auto-practice/wp-k-batch-compute.spec.ts`        | 夹具补 `disfluency` 默认值 + `disfluency()` 构造器；+3 例：八指标全局与 byMode / byCharacter 切片一致、零值兜底轮次八指标为 0 不留 null、elongation 只入总量不单列指标                            |
| `test/auto-practice/wp-k-regression-evaluator.spec.ts` | 夹具补 `disfluency: EMPTY_DISFLUENCY_METRICS`（`TraceInput` 新增必填字段所致）                                                                                                                    |

### 3.3 明确未改（红线自查）

- `src/engine-core/**` —— **零改动**（`git diff --stat HEAD -- src/engine-core` 输出为空，实测确认）；`boundary.spec.ts` 未碰。
- `src/auto-practice/metrics/batch-metrics.schema.ts` —— 未改；快照 `schemaVersion` 仍为 **1**。
- `scripts/ops/quality/**` —— 未改（审计脚本迁移属 P1）。
- prompt 链路（`turn-render-orchestrator.ts` 等）—— 未改。
- `.env` / `.env.example` / env 键 —— 未新增、未改动。
- 实体 / migration / 种子 / resolver / module 装配 —— 未改；**无新表、无新 migration、无装配改动**。
- `admin-dashboard/` 与 Flutter 客户端 —— 未碰。
- 未新增任何 LLM 调用；未引入结构化 tag；未在适配层随机插文本。

## 4. 闸门（真实命令 / exit code / 数字）

| #   | 命令                                            | exit code | 数字                                                                                                                           |
| --- | ----------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `pnpm exec tsc -p tsconfig.build.json --noEmit` | 0         | 0 error                                                                                                                        |
| 2   | `pnpm lint`                                     | 0         | 0 error / 0 warning（eslint 无任何输出）                                                                                       |
| 3   | `pnpm exec vitest run test/auto-practice`       | 0         | Test Files 19 passed (19)；Tests 293 passed (293)；failed 0 / skipped 0；Duration 8.21s；外层脚本墙钟 11.7s                    |
| 4   | `pnpm test`（全量）                             | 0         | Test Files 187 passed \| 1 skipped (188)；Tests 3058 passed \| 4 skipped (3062)；failed 0；Duration 85.07s；外层脚本墙钟 80.4s |
| 5   | `git diff --stat HEAD -- src/engine-core`       | 0         | 输出为空（零改动）                                                                                                             |

- 机器状态：Windows 11 Home China 10.0.26300 x64；Intel Core i7-8550U @ 1.80GHz；15.9 GB RAM；Node v26.13.0；PowerShell 5.1.26100.9818；pnpm。
- 跑 vitest 前 PATH 补 `D:\Apps\Git\cmd`（避免 vitest 内部调 git 时 ENOENT 假失败）；全程 `pnpm`，**未用裸 npx**。
- 全量基线对比：上一任务基线 **3029 passed / 4 skipped** → 本次 **3058 passed / 4 skipped**，净增 **+29**（= analyzer spec 21 + 字典 spec 5 + compute spec 3），**无新增 failed、无新增 skipped**。
- 另跑了一次无 cache 版 eslint（`pnpm exec eslint "{src,test,bin}/**/*.ts"`），同为 0 error / 0 warning。
- 注意：`tsconfig.build.json` **不含 `test/**`**，测试侧类型问题要用 `pnpm typecheck`（`tsconfig.check.json`）才查得到；本单测试文件随 lint / 全量 vitest 一并通过。

## 5. 任务特有结果

### 5.1 归一化函数与 `visitor-quality-audit.ts:266-268` 逐项对照

audit 侧原始口径（`scripts/ops/quality/visitor-quality-audit.ts:266-268`，脚本内私有函数、**未 export**，纯模块无法 import）：

```
text.replaceAll(/\s+/g, '').replaceAll(/[，。！？、,.!?；;：:"“”'‘’()（）…—-]/g, '')
```

本单侧实现（`src/auto-practice/metrics/disfluency-lexicon.ts`）：

| 项               | audit :266-268                                     | 本单 `normalizeForLength`                                                                  | 是否一致                            |
| ---------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------- |
| 第 1 步 去空白   | `replaceAll(/\s+/g, "")`                           | `replaceAll(/\s+/g, "")`                                                                   | ✅ 逐字一致                         |
| 第 2 步 去标点   | 正则字符类 `[，。！？、,.!?；;：:"“”'‘’()（）…—-]` | 常量 `PUNCTUATION_CHARS`（同一张字符表）+ `new RegExp("[" + PUNCTUATION_CHARS + "]", "g")` | ✅ 字符类逐字一致（字面转义后等价） |
| 第 3 步 长度统计 | `.length`                                          | `.length`                                                                                  | ✅ 一致                             |
| 语义             | 删掉全部标点（含省略号 `…`、破折号 `—` / `-`）     | 同上                                                                                       | ✅ 一致                             |

**结论**：`normalizeForLength` 与 audit 的归一化逐字等价，故 `normalizedLength`（密度分母）与审计脚本的字符统计口径可直接比较，两边数值可比。

识别侧 `normalizeForDetection` 是**另一套**（有意为之，见 §2.2）：

| 步  | 动作                                     | 目的                                                      |
| --- | ---------------------------------------- | --------------------------------------------------------- |
| ①   | 去所有空白 `replaceAll(/\s+/g, "")`      | 与 audit 同款                                             |
| ②   | `replaceAll(/\.{2,}\|…+\|。{2,}/g, "…")` | 连续省略号 / 句号串合并为**一次**停顿（蓝图 §5.1 纪律 5） |
| ③   | `replaceAll(/-{2,}\|—+/g, "——")`         | 破折号统一，支撑 elongation 的「词干 + 破折号」识别       |

识别口径**保留**省略号与破折号标记。两套口径互不串用：`analyzeDisfluency` 内 `normalizedLength` 取长度口径，六类识别取识别口径。

### 5.2 messages 对齐规则、零值兜底、重复 turnIndex

- **数据来源**：`batch-metrics.service.ts` 的 `projectTraces(fileContent)` 是唯一读逐字稿的层。逐字稿形状见 `src/admin-debug/debug-session-store.ts:64-73`：`DebugSessionMessage { role: "counselor" | "visitor"; text; turnIndex; ts }`，顶层 `messages` 与 `traces` 平级。
- **对齐规则**：`collectVisitorDisfluency(parsed)` 只取 `role === "visitor"` 的条目，按 `turnIndex` 建 `Map<number, DisfluencyMetrics>`；投影每条 trace 时用 `rawTurnIndex(raw)` 取该 trace 的 `turnIndex` 去查表。
- **重复 turnIndex**：同一 `turnIndex` 出现多条 visitor 条目时，**取数组中首条**（`if (out.has(turnIndex)) continue;`），后到者丢弃。理由：逐字稿里 visitor 正常一轮一条，首条语义上最贴近「该轮首次来访者发言」，口径确定且可复现。
- **零值兜底**：查表未命中（老逐字稿没有 `messages`、该轮无 visitor 条目、`turnIndex` 类型异常等）→ 填 `EMPTY_DISFLUENCY_METRICS`：六类计数全 0、`events` 0、`hasEvent` false、`normalizedLength` 0。8 个 `nullable: false` 指标因此**不留 null**（compute spec 已断言全为 0）。
- **原文处置**：`text` 只在 `collectVisitorDisfluency` 这一次调用里活一次，`analyzeDisfluency` 返回纯数值后原文不再被引用，不进任何下游结构；`TraceInput.disfluency` 物理上只有数字（六类 counts / events / hasEvent / normalizedLength）。
- **容错**：`turnIndex` 经 `toNumber()` 归一（非有限值 → 0）；`text` 非字符串 → `""`（按空文本分析，等价零值）。

### 5.3 8 指标在手工构造样本上的聚合结果

**样本 A**（analyzer spec「多轮聚合」用例，3 轮）：

| 轮  | 台词（仅文档用，不进任何日志/快照） | 归类       |
| --- | ----------------------------------- | ---------- |
| 1   | 嗯，我有点不知道怎么说              | filler × 1 |
| 2   | 我本来以为没事的……结果还是没忍住    | pause × 1  |
| 3   | 还行                                | 无事件     |

聚合结果：`eventsPerTurn = 0.666667`（2/3）、`eventTurnRate = 0.666667`（2/3）、`densityPer100Chars = 7.407407`、`typeCounts = { filler: 1, pause: 1, repetition: 0, repair: 0, trailoff: 0, elongation: 0 }`。

**样本 B**（compute spec「八指标：全局与 byMode / byCharacter 切片一致」用例，2 轮，每轮归一化 100 字）：

| 指标 id                               | 值                 |
| ------------------------------------- | ------------------ |
| `text.disfluency.events_per_turn`     | 2（4 事件 / 2 轮） |
| `text.disfluency.event_turn_rate`     | 1                  |
| `text.disfluency.density_per100`      | 2（4 / 200 × 100） |
| `text.disfluency.filler_per_turn`     | 1                  |
| `text.disfluency.pause_per_turn`      | 0.5                |
| `text.disfluency.repair_per_turn`     | 0.5                |
| `text.disfluency.repetition_per_turn` | 0                  |
| `text.disfluency.trailoff_per_turn`   | 0                  |

同一样本下 `byMode["expert"].metrics["text.disfluency.events_per_turn"] = 2`、`byCharacter["vpt_test"].metrics["text.disfluency.filler_per_turn"] = 1` —— 切片自动带上，无需额外接线。

**样本 C**（零值兜底）：全零轮次 → 8 个指标全为 `0`，**无 null**。

**样本 D**（elongation）：2 次 elongation / 2 轮 → `events_per_turn = 1`、`event_turn_rate = 0.5`，且 `text.disfluency.elongation_per_turn` 为 `undefined`（不单列指标）。

### 5.4 analyzer import 边界 grep 证据

命令：`grep -rn "analyzeDisfluency|disfluency-analyzer" src/`（全量 `src/` 扫描）：

```
src/auto-practice/metrics/disfluency-analyzer.ts:245:export function analyzeDisfluency(text: string): DisfluencyMetrics {
src/auto-practice/metrics/batch-metrics.service.ts:25:import { analyzeDisfluency } from './disfluency-analyzer.js';
src/auto-practice/metrics/batch-metrics.service.ts:65:    out.set(turnIndex, analyzeDisfluency(text));
```

`analyzeDisfluency` 在 `src/` 下的全部出现 = 定义 1 处（analyzer）+ import 1 处 + 调用 1 处，**后两处都在 service 的 IO 层**。`disfluency-analyzer` 字样另有两处纯注释（`metric-dictionary.ts:290` 的口径说明、`disfluency-lexicon.ts:10` 的落位说明），**非 import**。

命令：`grep -n "disfluency-analyzer|text: string" src/auto-practice/metrics/batch-metrics.compute.ts` → **零命中**（compute 层无 analyzer import、无文本形参）。

compute 层实际 import 只有一行：

```
import { aggregateDisfluency, type DisfluencyMetrics } from './disfluency-lexicon.js';
```

--- 纯数值模块，无文本处理。

## 6. 契约变化

| 项                   | 变化                                                                                                                                                                                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 指标字典             | 新增 8 键：`text.disfluency.events_per_turn` / `event_turn_rate` / `density_per100` / `filler_per_turn` / `pause_per_turn` / `repair_per_turn` / `repetition_per_turn` / `trailoff_per_turn`。**只增不改不复用**，既有 id 的语义与取值一律未动 |
| 字典版本             | `METRIC_DICTIONARY_VERSION`：`dict-v1` → **`dict-v2`**                                                                                                                                                                                         |
| 快照 `schemaVersion` | **仍为 1**（未升）；`batch-metrics.schema.ts` 未改 —— metrics 键由字典驱动，加键不破坏契约                                                                                                                                                     |
| 快照 metrics map     | 每个批次新增 8 个 `text.disfluency.*` 键，值恒为数字（无 null）                                                                                                                                                                                |
| 切片                 | `byMode` / `byCharacter` 自动带上同 8 键                                                                                                                                                                                                       |

供前端 / 下游 AI 对齐的差异点（**本单不改前端**）：

1. 字典版本号由 `dict-v1` 变 `dict-v2`，任何按版本缓存字典的前端需失效旧缓存。
2. `text.disfluency.*` 是**新增键族**，旧快照没有这些键 —— 跨批次比较时须按「键缺失 = 该批次无此能力」处理，**不要当 0**。
3. `density_per100` 首版 `bounds` 为 `null`（无取值域上界）；`per_turn` / `ratio` 类的 `bounds` 是 `[0,1]` 的**语义取值域**而非硬上限（均值口径，单轮多事件时均值可 > 1）—— 蓝图 §5.2.2 原表把 per_turn 写作「÷ 纳入轮数」而 bounds 给 `[0,1]`，本单按蓝图原表落地，并在 `definition` 里写明「均值口径」。
4. `elongation` 无单列指标，只进 `events_per_turn` / `event_turn_rate` / `density_per100`。

## 7. 风险与回归

### 7.1 被改的既有测试及原因

| 文件                                                   | 改动                                                                                | 原因                                                                                                          |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `test/auto-practice/wp-k-batch-compute.spec.ts`        | `trace()` 工厂补 `disfluency: EMPTY_DISFLUENCY_METRICS`；新增 `disfluency()` 构造器 | `TraceInput` 新增**必填**字段（§2.4），既有工厂不补则类型报错。默认值取零值结构，**不改变任何既有断言的数值** |
| `test/auto-practice/wp-k-regression-evaluator.spec.ts` | 两处夹具补 `disfluency: EMPTY_DISFLUENCY_METRICS`                                   | 同上                                                                                                          |
| `test/auto-practice/wp-k-metric-dictionary.spec.ts`    | 追加 describe 块（+5 例）                                                           | 只增不改，既有断言未动                                                                                        |

**没有删除或放宽任何既有断言**，没有改任何既有期望值；全量用例 3029 → 3058（+29），failed 仍为 0。

### 7.2 回归面

- 新增能力只读取既有 `messages` 数据，未写回任何既有字段；`projectTrace` 的既有投影字段逐项未动。
- 未命中的老批次（无 `messages`）走零值兜底，8 指标为 0，**不影响**既有任何指标的计算与判据（`intake-v1` 八条判据未动；`humanization-v1` 判据本单未实现）。
- 字典守卫 `NON_NULLABLE_IDS` 自动纳入 8 个新键 —— 计算层漏赋值会在测试期失败，不会静默出 null。
- engine-core 零改动，边界 spec 未改。

### 7.3 已知风险

1. **词表是工程种子值，不是临床标定**（与 `visitor-quality-lexicon.ts` 同款纪律）。filler / repair 触发词、叠词白名单、trailoff 阈值都带 ⚠️ 注释，P1 基线后需校准。
2. **repetition 收窄的代价**：句中口吃式重复漏计（§2.3）。若 P1 基线显示 repetition 显著偏低，需放开位置约束或改用分词边界。
3. **`density_per100` 无上界**：理论上界 = 事件数 / 归一化字符数 × 100，短句高事件时可能显著大于 1；前端若按 ratio 渲染会越界。
4. **`trailoff` 的 4 字阈值**（`TRAILOFF_MIN_CHARS`）是启发式种子值，短句的句末省略号会归为 pause 而非 trailoff。

## 8. 遗留项与建议人工复核

| #    | 遗留项                                                                                                                                                                | 归属    | 建议                                                                                                                                                                                                                                                                                                                                                                            |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L-1  | `visitor-quality-audit.ts` 迁移到 `disfluency-lexicon.ts` 词表口径 + 新增 D7 段六类分布输出；废弃脚本内私有 FILLERS 独立口径（旧字段保留一个版本周期并标 deprecated） | **P1**  | 与蓝图 §5.2.3 第 4 点、§6 P1 一致；迁移后两侧才是同一份真相源                                                                                                                                                                                                                                                                                                                   |
| L-2  | 8 指标的 `bounds` 在基线批次后补齐：`density_per100` 的保守上界；per_turn 类若确认可 > 1 则调整语义取值域                                                             | P1      | 基线数据出来前 `density` 保持 `null`，不要瞎填                                                                                                                                                                                                                                                                                                                                  |
| L-3  | `density_per100` 取值域校准 + 归一化字符数口径的跨批次可比性确认                                                                                                      | P1      | 建议基线批次同时输出分子分母，人工核对                                                                                                                                                                                                                                                                                                                                          |
| L-4  | repetition「只认子句开头」的位置取舍是否保留                                                                                                                          | P1      | 用基线批次量化：放开位置约束前后 `repetition_per_turn` 差多少、是否引入「今天天气」类误计                                                                                                                                                                                                                                                                                       |
| L-5  | filler 词表与位置约束（句首 / 被标点隔离）阈值校准；`然后 / 其实 / 就是 / 那个` 的实际分布                                                                            | P1      | 词表带 ⚠️ 标记，等基线                                                                                                                                                                                                                                                                                                                                                          |
| L-6  | `TRAILOFF_MIN_CHARS = 4` 阈值校准                                                                                                                                     | P1      | 看短句句末省略号的归类分布                                                                                                                                                                                                                                                                                                                                                      |
| L-7  | `humanization-v1` 判据（蓝图 §5.2.4）尚未实现                                                                                                                         | P2      | 本单只做度量，不做判据                                                                                                                                                                                                                                                                                                                                                          |
| L-8  | 角色侧联动（`disfluency-profile.ts` / `disfluency-instruction.ts` / env 三态开关 / 指纹段 / 灰度）                                                                    | P2 / P3 | 蓝图 §5.3–§5.5、§6 P2 / P3                                                                                                                                                                                                                                                                                                                                                      |
| L-9  | 角色实体列 / 迁移 / 透传 / 灰度判据                                                                                                                                   | P3      | 蓝图 §6 P3                                                                                                                                                                                                                                                                                                                                                                      |
| L-10 | Phase3 专属 backlog 台账尚未建立                                                                                                                                      | —       | `docs/worklog/pending/` 下当前**没有** Phase3 专用台账（只有 `phase2.5-p1d-known-issues-2026-11-11.md` 与 phase4 backlog）。本单 L-1 ~ L-9 已登记在**蓝图内**新增的「P0 落地状态与遗留项」小节；建议 P1 派单时一并建立 Phase3 backlog 台账并迁移过去（并行进程已新起 `docs/worklog/pending/phase3-disfluency-p1-audit-baseline-draft-2026-11-12.md`，可作为台账起点，本单未碰） |

### 建议人工复核

1. 抽 3–5 轮真实 visitor 台词，人工核对六类归类是否与听感一致（重点：filler 的句首 / 被标点隔离判定、trailoff 的 4 字阈值）。
2. 核对一个含 `messages` 的既有批次快照，确认 8 指标为合理量级（**只看数字，不导出原文**）。
3. 核对一个**不含** `messages` 的老批次，确认 8 指标全 0 且其余指标与改造前一致。

## 9. 交付回写清单（任务单 §8）

- [x] 交付记录已写到 `docs/worklog/completed/phase2.5/phase3-disfluency-p0-metrics-implementation-2026-11-12.md`
- [x] 任务单从 `pending/` 移到 `docs/worklog/completed/phase2.5/`，顶部状态行改为 ✅ 并链接交付记录
- [x] 回写蓝图 `phase3-text-disfluency-humanization-plan-2026-11-11.md`：标注 P0 任务单 / 交付记录链接 + P0 落地状态 + 遗留项清单
- [x] 确认未碰 P1 / P2 / P3 范围文件；遗留项登记在蓝图「P0 落地状态与遗留项」小节（Phase3 backlog 台账待 P1 派单时建立，见 L-10）
- [x] `git diff --stat HEAD -- src/engine-core` 为空
- [x] 提交分组核对：本单文件与并行进程产物分开（见 §10），未代提交
- [x] 给出一行 commit message 草稿（未 commit / push）

## 10. 提交分组核对

**本单文件（建议同一 commit）**：

```
src/auto-practice/metrics/disfluency-analyzer.ts       (new)
src/auto-practice/metrics/disfluency-lexicon.ts         (new)
src/auto-practice/metrics/metric-dictionary.ts          (modified)
src/auto-practice/metrics/batch-metrics.compute.ts     (modified)
src/auto-practice/metrics/batch-metrics.service.ts      (modified)
test/auto-practice/metrics/disfluency-analyzer.spec.ts  (new)
test/auto-practice/wp-k-metric-dictionary.spec.ts       (modified)
test/auto-practice/wp-k-batch-compute.spec.ts           (modified)
test/auto-practice/wp-k-regression-evaluator.spec.ts    (modified)
docs/worklog/completed/phase2.5/phase3-disfluency-p0-metrics-2026-11-12.md               (new)
docs/worklog/completed/phase2.5/phase3-disfluency-p0-metrics-implementation-2026-11-12.md (new)
docs/worklog/pending/phase3-text-disfluency-humanization-plan-2026-11-11.md               (modified)
```

**不属于本单（并行进程产物，勿混入本次提交）**：

```
data/quality/char-label-map.txt
data/quality/safety-reconcile-96-2026-11-12.txt
data/quality/safety-slice-96-2026-11-12.txt
data/quality/verify-17-22-slice-2026-11-12.txt
scripts/ops/quality/phase25-verify-17-22-2026-11-12.ts
docs/worklog/completed/phase2.5/phase2.5-audit-96-batch-six-dimension-rerun-2026-11-12.md
docs/worklog/completed/phase2.5/phase2.5-i23-safety-delta-attribution-2026-11-12.md
docs/worklog/pending/phase3-disfluency-p1-audit-baseline-draft-2026-11-12.md  (并行进程新起的 P1 草稿单, 正好对应 L-1; 本单未碰)
docs/worklog/pending/phase2.5-p1d-known-issues-2026-11-11.md  (并行进程写的 I-23 归因, 本单未碰)
```

## 11. commit message 草稿

```
feat(auto-practice): 新增 Phase3 P0 文字层不流利度量层 (dict-v2 + 8 个 text.disfluency.* 指标)
```

---

_交付记录完成时间：2026-11-12（Asia/Shanghai）。未执行 git commit / push，等待主控指令。_
