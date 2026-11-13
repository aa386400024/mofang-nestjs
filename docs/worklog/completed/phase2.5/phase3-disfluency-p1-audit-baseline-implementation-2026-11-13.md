# Phase3 文字层真人度 · P1 审计基线 —— 交付记录（2026-11-13）

> 任务单：`docs/worklog/completed/phase2.5/phase3-disfluency-p1-audit-baseline-task-2026-11-13.md`
> 执行方：MiniMax Code
> 仓库：`E:\Work\Project\backend\mofang-nestjs`，分支 `integrate`，基线 HEAD `ab012f1`
> 总体方案（蓝图）：`docs/worklog/pending/phase3-text-disfluency-humanization-plan-2026-11-11.md`
> 基线备忘：`data/quality/disfluency-baseline-memo-2026-11-13.md`
> 遗留台账：`docs/worklog/pending/phase3-disfluency-backlog-2026-11-13.md`
> 任务性质：纯离线观测与口径收敛，**零行为变化**

---

## 1. 结论摘要

1. **口径同源闭环（L-1）**：审计脚本的私有 `FILLERS`（6 词）与私有 `normalize` 已删除，词表与归一化全部改从 P0 纯模块 `src/auto-practice/metrics/` import；重复率 / n-gram / 唯一性三条路径改用 `normalizeForLength`（与旧 `normalize` 逐字等价，数值零漂移）。
2. **D7 段落地**：新增 `[D7] 不流利分布`，输出八指标 + 六类计数合计 + 五类 per_turn，与蓝图 §5.2.4 的三条种子区间**并列对照**（只观测，**不出 PASS / FAIL**，不接门禁）。
3. **D7 快照测试落地**：`test/quality/phase3-disfluency-d7-baseline.spec.ts`，12 例，覆盖六类计数 / 聚合口径 / 空态全零不出 NaN / 无原文泄漏护栏。
4. **双批次基线产出**：`baseline-20261109` 与 `pre96-2026-11-12` 两批实跑 exit 0，各出一份基线 JSON（只含数字与批次 id）+ 一份备忘 md（观测事实 / 建议调参分节）。
5. **台账建立（L-10）**：`docs/worklog/pending/phase3-disfluency-backlog-2026-11-13.md` 迁移 L-1 ~ L-9 并标注归属阶段，登记本单新遗留 P1-N1 ~ P1-N7。
6. **红线全清**：`src/` P0 文件零改动；`git diff --stat HEAD -- src/engine-core` 为空；未碰 prompt / env / 表 / migration / 判据数组；类型债 **401 条 / 87 文件 = 既有基线逐字一致**，本单新增 0。

## 2. 改动文件清单

### 2.1 脚本（1 新增 / 1 修改）

| 文件                                                | 动作     | 说明                                                                                                                                                                                                                    |
| --------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/ops/quality/visitor-quality-disfluency.ts` | **新增** | D7 纯模块：整场 / 批次汇总、种子区间对照、D7 报告渲染、基线 JSON 组装、批次 id 推导。零 IO / 零台词 / 零随机                                                                                                            |
| `scripts/ops/quality/visitor-quality-audit.ts`      | **修改** | 删私有 `FILLERS` 与私有 `normalize`；改 import P0 模块；`deriveTextSignals` 改接分析器度量；`SessionAudit` 增 `disfluency` 纯数值字段；`fillerPerTurn` 标 deprecated；新增 `reportD7(valid)` 与 `--disfluency-out` 导出 |

### 2.2 测试（1 新增）

| 文件                                                 | 动作     | 说明                                |
| ---------------------------------------------------- | -------- | ----------------------------------- |
| `test/quality/phase3-disfluency-d7-baseline.spec.ts` | **新增** | 12 例 D7 快照测试（详见 §6 闸门 3） |

### 2.3 docs（4 新增 / 3 修改）

| 文件                                                                                               | 动作                        | 说明                                                |
| -------------------------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------- |
| `docs/worklog/completed/phase2.5/phase3-disfluency-p1-audit-baseline-implementation-2026-11-13.md` | **新增**                    | 本交付记录                                          |
| `docs/worklog/completed/phase2.5/phase3-disfluency-p1-audit-baseline-task-2026-11-13.md`           | **新增**（由 pending 移入） | 任务单归档，状态行改 ✅                             |
| `docs/worklog/pending/phase3-disfluency-backlog-2026-11-13.md`                                     | **新增**                    | Phase3 专属 backlog 台账（L-10）                    |
| `docs/worklog/pending/phase2.5-README.md`                                                          | **修改**                    | §3 表尾 Phase3 P1 行改 ✅ 并补交付记录链接          |
| `docs/worklog/pending/phase3-text-disfluency-humanization-plan-2026-11-11.md`                      | **修改**                    | §6 P1 段补交付记录 / 台账链接；遗留表加台账交叉链接 |
| `docs/worklog/pending/phase3-disfluency-p1-audit-baseline-draft-2026-11-12.md`                     | **修改**                    | 预研草案收口（主控预置改动，本单仅追加指向）        |

### 2.4 产物（3 新增，随交付提交）

| 文件                                                      | 说明                                |
| --------------------------------------------------------- | ----------------------------------- |
| `data/quality/disfluency-baseline-baseline-20261109.json` | 第一批基线（4 场 / 52 轮）          |
| `data/quality/disfluency-baseline-pre96-2026-11-12.json`  | 第二批基线（70 场 / 776 轮）        |
| `data/quality/disfluency-baseline-memo-2026-11-13.md`     | 基线备忘（观测事实 / 建议调参分节） |

> 归档目录 `data/archives/` **只读，零修改**；两个 JSON 与备忘不含任何台词原文。

## 3. §4.1 口径迁移前后对照（filler）

旧口径 = 脚本私有 6 词 `['嗯','呃','那个','然后','其实','就是']` 的 `text.split(filler).length - 1` 计数（无位置约束、无消歧）；新口径 = P0 analyzer 的 `counts.filler`（位置敏感 + 与高优先级类别互斥消歧）。两个数字在**同一批 valid 场次**上算（旧口径用一次性离线探针复算，探针已删除、不入库）。

| 批次              | 旧口径跨场均值 | 旧口径批次合计 | 旧命中总数 | 新口径跨场均值 | 新口径批次合计 | 新命中总数 | 新/旧命中比 |
| ----------------- | -------------- | -------------- | ---------- | -------------- | -------------- | ---------- | ----------- |
| baseline-20261109 | 0.569444       | 0.500000       | 26         | 0.322619       | 0.288462       | 15         | 57.7%       |
| pre96-2026-11-12  | 0.429366       | 0.417526       | 324        | 0.191222       | 0.181701       | 141        | 43.5%       |

差异来源（旧口径逐词命中：baseline 嗯 12 / 然后 4 / 就是 10；pre96 嗯 69 / 那个 20 / 然后 17 / 其实 79 / 就是 139）：

1. **位置约束**：新口径只统计句首或标点隔离的命中；旧口径把「其实就是…」「然后…」这类句中正常承接全计进去 —— 这两块是旧口径命中数最大的来源（pre96 里「就是」139 + 「其实」79 = 218 / 324 = 67.3%）。
2. **互斥消歧**：新口径一个位置只归一类（repair > trailoff > repetition > pause > filler > elongation）。
3. **词表更大但更严**：10 词 vs 旧 6 词，但位置敏感。

> **两个数字不混用对照**：旧口径字段 `SessionAudit.fillerPerTurn` 已标 `@deprecated`（保留一个版本周期），D4 报告行保留展示并标注 deprecated；D7 段只走新口径。旧口径的数值只出现在本记录与备忘里，**不进任何脚本输出**。

## 4. D7 实现口径

### 4.1 模块分层（隐私分层保持）

| 层                | 模块                                | 允许接触           | 实际内容                                |
| ----------------- | ----------------------------------- | ------------------ | --------------------------------------- |
| IO 层（离线工具） | `visitor-quality-audit.ts`          | 台词原文           | 逐轮 `analyzeDisfluency(text)` → 纯数值 |
| 纯模块            | `visitor-quality-disfluency.ts`     | **只接纯数值契约** | 汇总 / 种子对照 / 报告渲染 / 基线 JSON  |
| 数值契约          | `disfluency-lexicon.ts`（P0，只读） | 无                 | `aggregateDisfluency` + 类型            |
| 纯计算层          | `batch-metrics.compute.ts`          | 无                 | **本单零改动**                          |

纯模块**不 import analyzer**，只 runtime import `aggregateDisfluency` + `round6`，type-only import `DisfluencyCounts / DisfluencyMetrics`。

### 4.2 字段与口径

- 整场：`turns / events / eventTurns / normalizedChars / eventsPerTurn / eventTurnRate / densityPer100Chars / typeCounts(六类) / perTurn(五类)`。
- 批次：**主口径 = 合计口径**（合计事件 ÷ 合计纳入轮数，与 P0 快照 `text.disfluency.*` 同源）；**跨场均值另列作参考**，两者不混用。
- 五类 per_turn = 该类事件总数 ÷ 纳入轮数（分母 0 → 0）；**elongation 只入事件总量，无 per_turn 键**（P0 偏差 5）。
- 种子区间对照三列形态：`种子区间 / 实测值 / 是否落在区间内`；**不输出 PASS / FAIL**，不接健康门禁。
- 纳入范围：`degradedTurns === 0` 的 valid 场次（沿用脚本既有过滤），降级场次不计入基线均值。

### 4.3 CLI

新增 `--disfluency-out <path>` 显式导出基线 JSON；`--dir` 与默认目录行为**不变**。

## 5. 两批次基线数字与种子区间对照

| 指标                                                           | baseline-20261109        | pre96-2026-11-12             |
| -------------------------------------------------------------- | ------------------------ | ---------------------------- |
| 有效场次 / 纳入轮次                                            | 4 / 52                   | 70 / 776                     |
| events / eventTurns / 归一化字符数                             | 51 / 34 / 1 663          | 468 / 344 / 27 244           |
| events_per_turn                                                | 0.980769                 | 0.603093                     |
| event_turn_rate                                                | 0.653846                 | 0.443299                     |
| density_per100                                                 | 3.066747                 | 1.717809                     |
| filler_per_turn                                                | 0.288462                 | 0.181701                     |
| pause_per_turn                                                 | 0.442308                 | 0.207474                     |
| repair_per_turn                                                | 0.230769                 | 0.182990                     |
| repetition_per_turn                                            | 0.019231                 | 0.030928                     |
| trailoff_per_turn                                              | 0                        | 0                            |
| 六类计数（filler/pause/repetition/repair/trailoff/elongation） | 15 / 23 / 1 / 12 / 0 / 0 | 141 / 161 / 24 / 142 / 0 / 0 |

种子区间对照（只观测，不判定）：

| 指标            | 种子区间          | baseline | 区间关系                   | pre96    | 区间关系   |
| --------------- | ----------------- | -------- | -------------------------- | -------- | ---------- |
| event_turn_rate | 区间 [0.20, 0.55] | 0.653846 | 落在区间外（高于上界）     | 0.443299 | 落在区间内 |
| events_per_turn | 上限 ≤ 0.8        | 0.980769 | 落在区间外（高于上界）     | 0.603093 | 落在区间内 |
| repair_per_turn | 上限 ≤ 0.25       | 0.230769 | 落在区间内（达上界 92.3%） | 0.182990 | 落在区间内 |

跨批次可比性观察（L-3）：

1. 两批的**口径完全同源**（同一套 analyzer / 同一套归一化），差异只来自数据本身，可比的是「相对关系」而非绝对值。
2. baseline 批 500 场里 **496 场有渲染降级**（DB runner 落库口径），有效场次仅 4 场 52 轮 —— **样本量不足以支撑分布结论**，该批数字只作「口径可离线复算」的锚点；README §3.1 记录该批兜底句占比 91.8%、大量场次 `total_tokens = 0`，分布偏低 / 失真属预期，**不得当临床标定结论**。
3. baseline 的 `events_per_turn` / `pause_per_turn` 明显高于 pre96，`repetition_per_turn` 明显低于 pre96 —— 既可能是「早期兜底句更啰嗦」的真实差异，也可能是 4 场样本的偶然波动，**当前不选边**。
4. `trailoff` 与 `elongation` 两批合计 828 轮命中 **0 次** —— 检测器依赖的省略号 / 破折号形态在访客台词里一次都没出现，当前数据无法区分「访客不写」与「检测器在本产品线无效」。

观测事实与建议调参的完整分节见 `data/quality/disfluency-baseline-memo-2026-11-13.md`（建议项不落到任何代码或判据）。

## 6. 闸门表（真实命令与数字）

| #                                                                                                                   | 命令                                                                                                                                                                                       | exit        | 结果                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1                                                                                                                   | `pnpm exec tsc -p tsconfig.build.json --noEmit`                                                                                                                                            | 0           | 0 error                                                                                                                                                                                                                                     |
| 2                                                                                                                   | `pnpm lint`                                                                                                                                                                                | 0           | 0 error / 0 warning（eslint 扫 `{src,test,bin}/**/*.ts`；首轮 1 error + 1 warning 已修，见 §7 偏差 9）                                                                                                                                      |
| 3                                                                                                                   | `pnpm exec vitest run test/quality test/auto-practice/metrics`                                                                                                                             | 0           | **10 文件 / 169 例全绿**，failed 0，Duration 5.41s                                                                                                                                                                                          |
| 4                                                                                                                   | `pnpm exec tsx scripts/ops/quality/visitor-quality-audit.ts --dir data/archives/debug-sessions-baseline-20261109 --disfluency-out data/quality/disfluency-baseline-baseline-20261109.json` | 0           | 逐字稿 500 份 / 有效 4 场 / 降级 496 场；D7 段与基线 JSON 已出                                                                                                                                                                              |
| 5                                                                                                                   | `pnpm exec tsx scripts/ops/quality/visitor-quality-audit.ts --dir data/archives/debug-sessions-pre96-2026-11-12 --disfluency-out data/quality/disfluency-baseline-pre96-2026-11-12.json`   | 0           | 逐字稿 91 份 / 有效 70 场 / 降级 21 场；D7 段与基线 JSON 已出                                                                                                                                                                               |
| 6                                                                                                                   | `git diff --stat HEAD -- src/engine-core`                                                                                                                                                  | 0           | **空**（输出 0 行）；`git diff --stat HEAD -- src` 同样为空                                                                                                                                                                                 |
| 7                                                                                                                   | `pnpm test`（收尾全量一次）                                                                                                                                                                | 0           | **Test Files 193 passed \| 1 skipped（194）**；**Tests 3248 passed \| 4 skipped（3252）**；Duration 110.04s，**墙钟 113.3s**                                                                                                                |
| 8                                                                                                                   | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`                                                                                                                    | 2（既有债） | **401 条 / 87 文件**，与既有基线**逐字一致**；本单相关文件新增 **0** 条                                                                                                                                                                     |
| 附 1                                                                                                                | `pnpm exec prettier --check`（本单 3 个 ts + 本单**新建** 3 个 md）                                                                                                                        | 0           | All matched files use Prettier code style!                                                                                                                                                                                                  |
| 附 2                                                                                                                | `pnpm exec oxlint`（本单 3 个 ts）                                                                                                                                                         | 0           | 0 error                                                                                                                                                                                                                                     |
| 附 3                                                                                                                | `pnpm exec prettier --check`（蓝图 / 任务单 md）                                                                                                                                           | 1           | **未格式化，且刻意不格式化**：仓库 `format` 脚本只覆盖 `src` / `test` 的 `.ts`，md 不在门禁内；且蓝图在 HEAD（`ab012f1`）版本本就不满足 prettier（实测 `--stdin-filepath` 校验 exit 1），对它跑 `--write` 会产生与本单无关的大面积重排 diff |
| **净增用例**：3252 − 3240（既有基线）= **+12 例**，与本单新增 spec 的 12 例**逐条对应**；测试文件 193 → 194（+1）。 |

**机器状态（2026-11-13 13:24 ~ 13:26 同机实测）**：

| 项         | 值                                                      |
| ---------- | ------------------------------------------------------- |
| Node       | v26.13.0                                                |
| pnpm       | 9.15.0                                                  |
| PowerShell | 5.1.26100.9818                                          |
| 操作系统   | Microsoft Windows 11 Home China 10.0.26300 build 26300  |
| CPU        | 8 逻辑核；全量测试运行期间负载 100%（194 workers 并发） |
| 内存       | 15.88 GB 总 / 4.13 GB 空闲                              |
| 进程数     | 308                                                     |
| C 盘空闲   | 70.1 GB                                                 |

## 7. 偏差与处置（9 条）

| #   | 偏差                                                                                                                           | 处置与理由                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | 任务单 §4.3 要求「新增 `reportD7(valid)`」在脚本内；本单把汇总 / 渲染 / 基线组装抽成独立纯模块 `visitor-quality-disfluency.ts` | audit 脚本末尾 `await main()` **无 import 守卫**，脚本层无法被单测 import，而 §4.4 明确要求 D7 快照测试落 `test/quality/`。故采用「纯模块 + 编排脚本」分层，脚本内保留同名 `reportD7(valid)` 编排入口。同仓库先例：`d1-event-classifier-evidence.lexicon.ts` |
| 2   | 新增 CLI `--disfluency-out <path>`                                                                                             | 任务单 §4.5 要求产物落 `data/quality/` 但未指定导出方式；新增显式开关最省事，且 `--dir` / 默认目录行为不变（§4.3.7）                                                                                                                                         |
| 3   | 基线 JSON 含 `batchDir` 与 `seed_comparison.*.inside`（布尔位）                                                                | §4.5.2 字面是「只含数字与批次 id」，但同段自身列了「结构含批次目录名」，且 `inside` 是种子对照表第三列「是否落在区间内」的标志位。**无台词、无 matchedTerms、无解释文本** → 台账 P1-N6                                                                       |
| 4   | 批次层口径用「合计口径」，跨场均值另列                                                                                         | §4.2.2 规定的是整场 per_turn = typeCounts[k] / texts.length（已按此实现）；批次层按「合计事件 ÷ 合计纳入轮数」聚合，与 `aggregateDisfluency` 对全量轮次同源、与 P0 快照 `text.disfluency.*` 同源，避免小批次被跨场均值放大                                   |
| 5   | `SessionAudit.fillerPerTurn` 改为 **analyzer 口径**填充（旧值无法在脚本内复现）                                                | §4.1.4（保留旧字段）与 §1.4 #4 / §4.1.3（filler 计数全部走 `counts.filler`）**只能二选一**；按主控已决口径「filler 计数全部走 analyzer」执行，旧口径数值用一次性离线探针在同批次 valid 场次复算后写入 §3 与备忘 §2.6，**不进脚本输出** → 台账 P1-N3          |
| 6   | D7 段数字用 `toFixed(4)`，基线 JSON 用 `round6`                                                                                | 前者沿用脚本既有报告范式，后者与 P0 快照同源（跨机器可 diff）；两者精度不同但**不混用**（报告给人看，JSON 给机器看）                                                                                                                                         |
| 7   | 测试文件落 `test/quality/phase3-disfluency-d7-baseline.spec.ts`                                                                | 任务单要求文件名在交付记录注明（§6.2）                                                                                                                                                                                                                       |
| 8   | 备忘 md 落 `data/quality/disfluency-baseline-memo-2026-11-13.md`                                                               | §4.5.3 允许 `data/quality/` 或 completed 目录二选一；选前者与两个 JSON 同目录，便于一起随交付提交                                                                                                                                                            |
| 9   | 首轮 `pnpm lint` 报 1 error + 1 warning（`import/order` + `unicorn/no-array-for-each`）                                        | 已改为 scripts import 在前 + `for…of` 循环；复跑 lint 0 error 0 warning，prettier --check 0                                                                                                                                                                  |

**未发生的偏差**：未新增任何判据数组 / 阈值常量；未碰 prompt / env / 表 / migration；未改 `src/auto-practice/metrics/` 下 P0 任何文件；未清理既有类型债；未新增内核导出或文件。

## 8. 遗留项与建议人工复核清单

### 8.1 本单登记的遗留（详见台账）

| #     | 遗留                                                                                               | 状态      |
| ----- | -------------------------------------------------------------------------------------------------- | --------- |
| P1-N1 | D7 只纳入 valid 场次 → baseline 批有效样本仅 4 场 52 轮，代表性由真跑批次承担                      | 🟠 待批次 |
| P1-N2 | trailoff / elongation 在 828 轮里命中 0 次，检测器有效性未证（与 L-6 合并）                        | 🟠 待批次 |
| P1-N3 | `fillerPerTurn` deprecated 字段的删除时机需拍板                                                    | 🟠 待拍板 |
| P1-N4 | D7 段（脚本）与 P0 快照（服务层）同源但分处两处，未来口径变更须同改                                | 🟠 待拍板 |
| P1-N5 | audit 脚本无 import 守卫 → 脚本层装配无法被单测直接 import                                         | 🟠 待拍板 |
| P1-N6 | 基线 JSON 的 `inside` 布尔位与 §4.5.2「只含数字」字面不符                                          | 🟠 待拍板 |
| P1-N7 | 两批 valid 口径依赖 DB runner 落库数据，无 DB 环境复算会回退逐字稿自数（valid 集合变、数字不可比） | 🟠 待拍板 |

### 8.2 建议人工复核清单

1. **核 baseline 有效场次抽样**：4 场 / 52 轮的代表性需人工确认是否可作锚点，或直接弃用该批基线。
2. **核 pre96 批 70 场有效场次的代表性**：91 场里 21 场降级被剔除，需确认剔除没有系统性偏置。
3. **核种子区间结论**：`repair_per_turn ≤ 0.25` 在 baseline 已达上界 92.3%，P2 接判据前建议先重算。
4. **核 trailoff / elongation 是否该保留**：若访客侧永不产出省略号 / 破折号形态，这两类检测器应考虑下线。
5. **核 deprecated 字段删除时机**：`fillerPerTurn` 计划保留一个版本周期，需明确在哪个版本删除。

## 9. 隐私自检

1. **台词原文只在一处被读取**：审计脚本逐轮调 `analyzeDisfluency(text)` → 只保留数值；原始 `text` 不进任何下游结构。
2. **纯模块零台词**：`visitor-quality-disfluency.ts` 不 import analyzer，只消费纯数值契约（`aggregateDisfluency` + 类型）。
3. **compute 层零改动**：`batch-metrics.compute.ts` 本单未动，不出现任何文本形参或 analyzer import。
4. **输出物检查**：两个基线 JSON + 备忘 md + D7 报告段 + 测试快照**均不含台词原文**；D7 段只出 id / 数字 / 标签。
5. **护栏自动化**：D7 spec 的泄漏护栏用唯一占位串 `ZZ_CANARY_7F3A9C` 断言「整场汇总 / 批次汇总 / 报告文本 / 基线 JSON」四处均不出现该串，并断言汇总结构的叶子值**全部是有限数字**（无字符串叶子）。
6. **归档只读**：`data/archives/` 两个目录零修改。

## 10. 提交信息草稿

```
feat(quality): P1 audit 接入不流利分析器并新增 D7 双批次基线
docs(worklog): Phase3 P1 任务单 / 交付记录 / backlog 台账与索引回写
```

> 提交纪律：一个提交一个意图（脚本 + 测试一组，docs + 产物一组），**不跳过 `--no-verify`**；由用户手动提交与推送。
