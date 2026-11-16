# Phase3 文字层真人度 · P1 审计基线 —— 已交付（2026-11-13 13:32）

> 仓库：`E:\Work\Project\backend\mofang-nestjs`，分支 `integrate`，基线 HEAD `ab012f1`
> 任务单：`docs/worklog/completed/phase2.5/phase3-disfluency-p1-audit-baseline-task-2026-11-13.md`（✅ 已归档）
> 交付记录：`docs/worklog/completed/phase2.5/phase3-disfluency-p1-audit-baseline-implementation-2026-11-13.md`

## 1. 结论摘要

1. **口径同源闭环（L-1）**：审计脚本的私有 `FILLERS`（6 词）与私有 `normalize` **已删除**，词表与归一化全部改从 P0 纯模块 `src/auto-practice/metrics/` import；重复率 / n-gram / 唯一性三条路径改用 `normalizeForLength`（与旧 `normalize` 逐字等价，数值零漂移）。`fillerPerTurn` 字段保留并标 `@deprecated`，D4 报告行保留展示并标注 deprecated。
2. **D7 段落地**：新增 `[D7] 不流利分布`，输出八指标 + 六类计数合计 + 五类 per_turn，与蓝图 §5.2.4 三条种子区间**并列对照**（只观测，**不出 PASS / FAIL**，不接门禁）。**elongation 只入事件总量，无 per_turn 键**（P0 偏差 5）。
3. **D7 快照测试落地**：`test/quality/phase3-disfluency-d7-baseline.spec.ts`，**12 例**（六类计数 / 聚合口径 / 空态全零不出 NaN / 原文泄漏护栏），全部是构造句，不含任何真实逐字稿原文。
4. **双批次基线产出**：两批实跑 **exit 0**，各出一份基线 JSON（只含数字与批次 id）+ 一份备忘 md（观测事实 / 建议调参分节）。
5. **台账建立（L-10）**：`docs/worklog/pending/phase3-disfluency-backlog-2026-11-13.md` 迁移 L-1 ~ L-9 并标注归属阶段，登记本单新遗留 P1-N1 ~ P1-N7。
6. **红线全清**：`src/` P0 文件零改动（`git diff --stat HEAD -- src` 为空）、engine-core 零 diff、未碰 prompt / env / 表 / migration / 判据数组；类型债 **401 条 / 87 文件 = 既有基线逐字一致**，本单新增 0。

## 2. 交付物清单

**脚本**

- `scripts/ops/quality/visitor-quality-disfluency.ts`（新增）：D7 纯模块 —— 整场 / 批次汇总、种子区间对照、报告渲染、基线 JSON 组装。零 IO / 零台词；只 runtime import `aggregateDisfluency` + `round6`，**不 import analyzer**。
- `scripts/ops/quality/visitor-quality-audit.ts`（修改）：口径迁移 + `reportD7(valid)` + 新增 CLI `--disfluency-out <path>`（`--dir` 与默认目录行为不变）。

**测试**

- `test/quality/phase3-disfluency-d7-baseline.spec.ts`（新增，12 例）。

**产物**

- `data/quality/disfluency-baseline-baseline-20261109.json`
- `data/quality/disfluency-baseline-pre96-2026-11-12.json`
- `data/quality/disfluency-baseline-memo-2026-11-13.md`（观测事实 / 建议调参分节）

**docs**

- 交付记录（上述固定路径）、Phase3 backlog 台账、任务单归档（状态行 ✅ + DoD 8 项全勾）、README §3 P1 行改 ✅、蓝图 §6 P1 段补链接 + 遗留表加台账交叉链接、预研草案修链接并追加交付指向。

## 3. 口径迁移前后对照（filler，旧 vs 新，同一批 valid 场次）

| 批次              | 旧口径（6 词 split）跨场均值 | 旧命中总数 | 新口径（analyzer）跨场均值 | 新命中总数 | 新/旧命中比 |
| ----------------- | ---------------------------- | ---------- | -------------------------- | ---------- | ----------- |
| baseline-20261109 | 0.569444                     | 26         | 0.322619                   | 15         | 57.7%       |
| pre96-2026-11-12  | 0.429366                     | 324        | 0.191222                   | 141        | 43.5%       |

差异主因：新口径**只统计句首或标点隔离的命中**，旧口径把「其实就是…」「然后…」这类句中正常承接全计进去（pre96 里「就是」139 + 「其实」79 = 旧命中数的 67.3%）；另有与高优先级类别的互斥消歧。**两个数字不混用对照**，旧口径数值只进交付记录与备忘，不进任何脚本输出。

## 4. 两批次基线数字与种子区间对照

| 指标                                                           | baseline-20261109                             | pre96-2026-11-12                              |
| -------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------- |
| 有效场次 / 纳入轮次                                            | 4 / 52                                        | 70 / 776                                      |
| events / eventTurns / 归一化字符数                             | 51 / 34 / 1 663                               | 468 / 344 / 27 244                            |
| events_per_turn                                                | 0.980769                                      | 0.603093                                      |
| event_turn_rate                                                | 0.653846                                      | 0.443299                                      |
| density_per100                                                 | 3.066747                                      | 1.717809                                      |
| filler / pause / repair / repetition / trailoff per_turn       | 0.288462 / 0.442308 / 0.230769 / 0.019231 / 0 | 0.181701 / 0.207474 / 0.182990 / 0.030928 / 0 |
| 六类计数（filler/pause/repetition/repair/trailoff/elongation） | 15 / 23 / 1 / 12 / 0 / 0                      | 141 / 161 / 24 / 142 / 0 / 0                  |

种子区间（只观测，不判定）：baseline 的 `event_turn_rate`（0.653846 > 0.55）与 `events_per_turn`（0.980769 > 0.8）**落在区间外**，`repair_per_turn`（0.230769 ≤ 0.25，**达上界 92.3%**）落在区间内；pre96 三项**全部落在区间内**。

## 5. 三个必须知道的观测事实

1. **baseline 批有效样本只剩 4 场 / 52 轮**：500 场里 496 场有渲染降级（DB runner 落库口径）。该批数字**只能当「口径可离线复算」的锚点**，不得当临床标定结论（README §3.1 记录该批兜底句占比 91.8%、大量场次 `total_tokens = 0`）。
2. **trailoff 与 elongation 两批合计 828 轮命中 0 次**：检测器依赖的省略号 / 破折号形态在访客台词里一次都没出现 —— 当前数据**无法区分**「访客不写」与「检测器在本产品线无效」。建议下轮先确认生成侧形态，再决定是否保留这两类检测器。
3. **两批 valid 口径依赖 DB runner 落库数据**（`ap_practice_sessions.degraded_turns`）：无 DB 环境复算会 warn 并回退逐字稿自数，valid 场次集合随之变化、数字**不可比**（已登记为 P1-N7）。

## 6. 闸门（真实命令与数字）

| #    | 命令                                                                    | exit        | 结果                                                                                                                         |
| ---- | ----------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1    | `pnpm exec tsc -p tsconfig.build.json --noEmit`                         | 0           | 0 error                                                                                                                      |
| 2    | `pnpm lint`                                                             | 0           | 0 error / 0 warning                                                                                                          |
| 3    | `pnpm exec vitest run test/quality test/auto-practice/metrics`          | 0           | **10 文件 / 169 例全绿**，Duration 5.41s                                                                                     |
| 4    | audit（baseline 批，`--dir` + `--disfluency-out`）                      | 0           | 逐字稿 500 份 / 有效 4 场 / 降级 496 场，D7 段 + JSON 已出                                                                   |
| 5    | audit（pre96 批，`--dir` + `--disfluency-out`）                         | 0           | 逐字稿 91 份 / 有效 70 场 / 降级 21 场，D7 段 + JSON 已出                                                                    |
| 6    | `git diff --stat HEAD -- src/engine-core`                               | 0           | **空**（`-- src` 同样为空）                                                                                                  |
| 7    | `pnpm test`（收尾全量一次）                                             | 0           | **Test Files 193 passed \| 1 skipped（194）**；**Tests 3248 passed \| 4 skipped（3252）**；Duration 110.04s，**墙钟 113.3s** |
| 8    | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` | 2（既有债） | **401 条 / 87 文件** = 既有基线逐字一致，本单新增 **0**                                                                      |
| 附 1 | `pnpm exec prettier --check`（本单 3 个 ts + 新建 3 个 md）             | 0           | All matched files use Prettier code style!                                                                                   |
| 附 2 | `pnpm exec oxlint`（本单 3 个 ts）                                      | 0           | 0 error                                                                                                                      |

净增用例：3252 − 3240（既有基线）= **+12 例**，与新增 spec 的 12 例逐条对应；测试文件 193 → 194。

**机器状态（2026-11-13 13:24 ~ 13:26 同机实测）**：Node v26.13.0 / pnpm 9.15.0 / PowerShell 5.1.26100.9818 / Windows 11 Home China 10.0.26300 build 26300 / 8 逻辑核（全量测试期间负载 100%，194 workers 并发）/ 内存 15.88 GB 总、4.13 GB 空闲 / 308 进程 / C 盘空闲 70.1 GB。

## 7. 偏差与处置（9 条，详见交付记录 §7）

摘要：① D7 逻辑抽成独立纯模块（audit 脚本末尾 `await main()` 无 import 守卫，脚本层无法被单测 import，而 §4.4 要求测试落 `test/quality/`；同仓库先例 `d1-event-classifier-evidence.lexicon.ts`）；② 新增 `--disfluency-out` CLI；③ 基线 JSON 含 `batchDir` 与 `inside` 布尔位；④ 批次层用合计口径、跨场均值另列；⑤ `fillerPerTurn` 改由 analyzer 口径填充（旧值靠一次性离线探针在同批次复算，探针已删除不入库）；⑥ 报告 `toFixed(4)` vs JSON `round6` 精度分工；⑦⑧ 测试与备忘落点；⑨ 首轮 lint 的 `import/order` + `unicorn/no-array-for-each` 已修。

**未发生**：未新增判据 / 阈值常量、未碰 prompt / env / 表 / migration、未改 P0 文件、未清理既有类型债、未新增内核导出或文件。

## 8. 遗留（台账已登记，详见交付记录 §8）

P1-N1 baseline 有效样本仅 4 场（待批次）· P1-N2 trailoff / elongation 全零（待批次，与 L-6 合并）· P1-N3 `fillerPerTurn` deprecated 字段删除时机（待拍板）· P1-N4 D7 段与 P0 快照同源但分处两处（待拍板）· P1-N5 audit 脚本无 import 守卫（待拍板）· P1-N6 `inside` 布尔位与「只含数字」字面不符（待拍板）· P1-N7 valid 口径依赖 DB（待拍板）。

**建议人工复核**：① 核 baseline 4 场 / 52 轮是否可作锚点，或直接弃用该批基线；② 核 pre96 剔除 21 场降级是否无系统性偏置；③ P2 接判据前重算三条种子区间（repair 已达上界 92.3%）；④ 核 trailoff / elongation 是否该保留；⑤ 定 `fillerPerTurn` 删除时机。

## 9. 提交信息草稿（**未自动提交 / 未 push**）

```
feat(quality): P1 audit 接入不流利分析器并新增 D7 双批次基线
docs(worklog): Phase3 P1 任务单 / 交付记录 / backlog 台账与索引回写
```

一个提交一个意图（脚本 + 测试一组，docs + 产物一组），**不跳过 `--no-verify`**。

## 10. 状态

工作区共 4 改 + 7 新增（含 2 份基线 JSON、备忘 md、台账、任务单归档、交付记录、2 个脚本/测试文件），**均未提交**，由你手动提交与推送。归档目录 `data/archives/` 零修改；两个基线 JSON 与备忘 md **不含任何台词原文**（D7 spec 内置唯一占位串泄漏护栏自动校验）。
