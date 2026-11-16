# C5-1 · 探索指标分层（角色级探索覆盖观测 · I-16 / I-24）· 交付记录

> 2026-11-13 · 执行方：MiniMax Code · 分支 `integrate` · 基线 HEAD `368da4f`
> 任务单：[`phase2.5-c5-exploration-stratified-metrics-task-2026-11-13.md`](phase2.5-c5-exploration-stratified-metrics-task-2026-11-13.md)（已归档至本目录，状态行已改为 ✅）
> 事实源：台账 `docs/worklog/pending/phase2.5-p1d-known-issues-2026-11-11.md`（I-16 / I-24 / P0-c）；结构债草案 `docs/worklog/pending/phase2.5-engine-core-structural-debt-assessment-2026-11-12.md`（§4 I-16 / I-24 行、§6 第 1 条）；intake 验收口径文档 `docs/worklog/pending/phase2.5-intake-acceptance-criteria-2026-11-11.md`（§3 探索率行 / §3.1）
> 性质：**评测 / 指标层单**（结构债类别 C5）—— 纯观测，零门禁变化，零 core 改动

---

## 1. 一句话总结

**批次快照新增角色级探索覆盖指标 `exploration.character_coverage`，§7 十一项闸门全绿，工作区未 commit / 未 push。**

既有 `exploration.rate` 是**场次比例**（含探索的场次 ÷ 纳入场次），回答不了「多少角色完全 0 探索」—— 这正是 I-16 的结构问题（安然一人 100% 探索掩盖其余 7 角色 0 探索）。本单新增 `exploration.character_coverage`（= 至少一场含探索策略的**角色**数 ÷ 本批纳入场次覆盖到的不同角色数），全局 / byMode / byCharacter 三处同函数同口径产出，**byCharacter 切片值 ∈ {0, 1}**。

**只增不废弃**：旧键 `exploration.rate` 的数值口径与 direction **一字未改**，两者并存、互不替代。**纯观测**：不进判据表、不进批次健康门禁、不参与 verdict（方向 `neutral` → 跨批回归判定器整条跳过），**不新建任何探索阈值**。

---

## 2. 实际方案 vs 任务单（偏差登记）

### 2.1 结构性偏差

| #   | 任务单口径                                                                              | 实际落地                                                                                                                        | 理由                                                                                                                                                                                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | §3.1 未提**指标字典版本递增**                                                           | `METRIC_DICTIONARY_VERSION` **`dict-v3` → `dict-v4`**（含版本历史注释），并同步改 `wp-k-metric-dictionary.spec.ts` 两处版本断言 | 字典**内容变了**（新增 1 个指标 + `exploration.rate` 补档位标注）。仓库既有纪律是「**版本必须跟着字典内容走**」——两份内容不同的字典共用同一版本号 = **前端缓存不失效 + 审计比对看不出字典换过**（Phase3 P0 `dict-v1 → dict-v2`、D-2 `dict-v2 → dict-v3` 已是同款约定）。不升版就是照抄 D-2 当初登记过的那条缺陷 |
| D-2 | §3.1 B.2「`exploration.rate` 定义补档位适用标注（**在 `definition` 或相邻注释**注明）」 | 选 **definition**（不是注释）                                                                                                   | 字典是「口径**单一真相源**」，前端 tooltip 直接读 `definition`；只写代码注释的话只有翻源码的人看得到 → 用户目标「**字典标注探索属长会话档观测**」在 definition 里才成立。**数值口径与 direction 一字未改**（仍是场次比例 / `higher_is_better`）                                                                 |
| D-3 | §3.1 C.1「补 :126-130 **既有切片用例**」                                                | **新增**断言组，不动既有用例的 fixture 与断言                                                                                   | §7 闸门要求「零丢失 / **零改写**」—— 给既有用例换 fixture 就是改写。新增断言组既能钉住切片探索率，又不碰既有 6 条用例                                                                                                                                                                                           |
| D-4 | §3.1 C「沿用既有 helper；若内聚度需要可新建 `c5-exploration-coverage.spec.ts`」         | **沿用两份既有 spec 增补**（`wp-k-batch-compute.spec.ts` + `wp-k-metric-dictionary.spec.ts`），**不新建** spec 文件             | 硬约束写的是「**既有 spec 增补**」；复用既有 helper（`session()` / `trace()` / `context()`）既省脚手架又不制造第二个真相源                                                                                                                                                                                      |
| D-5 | §3.1 A.1「新指标键写入 `computeSummaryMetrics`」                                        | 照此实现；配套新增**模块私有纯函数** `computeCharacterExplorationCoverage`                                                      | 任务单 §3.1 A.2 允许「模块内纯函数 / 内联循环」。抽成纯函数的好处：口径只有一处，三处切片复用同一函数 —— 「同函数同口径」这条契约由**代码结构**保证，而不是靠三处各写一遍                                                                                                                                       |

### 2.2 工程取舍

| #   | 项               | 实际取值                                                        | 理由                                                                                                                                                           |
| --- | ---------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E-1 | 新指标 direction | **`neutral`**                                                   | 任务单 §3.1 B.1 拍板。副作用正好达成 R1：跨批回归判定器对 `direction === 'neutral'` 的指标**整条 `continue`** → 新指标天然**不进 verdict**（比「不进表」更硬） |
| E-2 | 空集回落         | 分母 0 → **0**（不 null、不抛错）                               | 与 `exploration.rate` 的零场次兜底一致（任务单 §1.3-6）                                                                                                        |
| E-3 | 角色集合         | 本批纳入场次里出现过的**不同 `characterSlug`**                  | 分母只含**跑到的**角色（未跑到不计入）→ definition 显式写明；跨样本不可直接横比（R2）                                                                          |
| E-4 | 浮点             | `round6`                                                        | 与既有指标同一浮点纪律（跨机器复算一致）                                                                                                                       |
| E-5 | 旧键             | `exploration.rate` **一字不改**（数值口径 + direction）         | 只增不废弃；旧快照与旧看板读法不受影响                                                                                                                         |
| E-6 | 快照 schema      | `schemaVersion` 仍为 **1**；`MetricsSlice.metrics` 是自由键 map | 新键无需改 schema 类型；`assertMetricsMap` 只验值为有限数字或 null → 新键自动通过（任务单 §3.2）                                                               |

---

## 3. 改动文件清单

### 3.1 源码（恰好 2 个既有文件，均在 `src/auto-practice/metrics/`）

| 文件                                                 | 改动                                                                                                                                                                                                                                                                                                                                               | 规模     |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `src/auto-practice/metrics/batch-metrics.compute.ts` | ① 新增**模块私有纯函数** `computeCharacterExplorationCoverage(sessions)`（分子 = 至少一场含探索策略的角色数；分母 = 不同 `characterSlug` 数；角色级去重；空集 → 0）；② `computeSummaryMetrics` 内写入新键 `exploration.character_coverage`（`round6`）。`exploration.rate` 既有计算与口径**一字未改**                                              | +27      |
| `src/auto-practice/metrics/metric-dictionary.ts`     | ① `SCALAR_METRICS` 新增 `exploration.character_coverage`（ratio / **neutral** / `RATIO_BOUNDS` / `nullable: false` + 分子分母 definition + 长会话档位标注）；② `exploration.rate` definition 追加档位标注（**数值口径与 direction 未变**）；③ 文件头「指标分层」清单补一行；④ `METRIC_DICTIONARY_VERSION` `dict-v3` → **`dict-v4`** + 版本历史注释 | +28 / −1 |

> **零新增文件、零新增具名导出**（新函数是模块私有；新键是自由键 map 里的字符串键）。**core / 前端零改动**（见 §4 变更面）。

### 3.2 测试（既有 spec 增补 2 份，零新建）

| 文件                                                | 状态                                  | 内容                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `test/auto-practice/wp-k-batch-compute.spec.ts`     | **增补**（既有 6 条用例**一字未动**） | 新增 `describe('C5-1 · 探索指标分层 (角色覆盖 · 纯观测)')`，**7 例**：切片 `exploration.rate` 断言（byMode / byCharacter 各切片内场次比例）+ 覆盖率 a（1/N，与 rate 分别断言）/ b（全覆盖 = 1）/ c（空集 = 0，不 null）/ d（同角色多场去重）/ e（切片退化 ∈ {0,1} + byMode 口径）/ f（确定性深相等）               |
| `test/auto-practice/wp-k-metric-dictionary.spec.ts` | **增补 + 2 处版本断言同步**           | 新增 `describe('C5-1 · 探索角色覆盖指标 (dict-v4)')`，**4 例**：新键齐备（ratio / neutral / nullable=false / bounds [0,1] / label / definition 非空）+ 进 `NON_NULLABLE_IDS` + direction neutral（不进跨批回归判定）+ 旧键 `exploration.rate` 仍在且口径未改（只补档位标注）；另两处版本断言 `dict-v3` → `dict-v4` |

### 3.3 文档（5 份回写 + 2 份产出）

| 文档                                                                                            | 改动                                                                                       |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `docs/worklog/pending/phase2.5-p1d-known-issues-2026-11-11.md`                                  | I-16 行 + I-16 小节 + I-24 行 + I-24 小节（C5-1 观测分层已落地；阈值与 core 可达性另案）   |
| `docs/worklog/pending/phase2.5-engine-core-structural-debt-assessment-2026-11-12.md`            | §4 I-16 行（现状列改写）+ §4 I-24 行（现状列追加）+ §6 第 1 条（顺序项状态同步）           |
| `docs/worklog/pending/phase2.5-README.md`                                                       | §3 新增 C5-1 一行（完成态数字已填）                                                        |
| `docs/worklog/pending/phase2.5-intake-acceptance-criteria-2026-11-11.md`                        | §3 探索率表格行补注「角色覆盖率属结构观测、非门槛」+ §3.1 补一条（不新增 40 轮档判定条款） |
| `docs/worklog/completed/phase2.5/phase2.5-c5-exploration-coverage-implementation-2026-11-13.md` | 本交付记录                                                                                 |
| `docs/worklog/completed/phase2.5/phase2.5-c5-exploration-stratified-metrics-task-2026-11-13.md` | 任务单归档（状态行 ✅ + checklist 全勾）                                                   |

> `phase2.5-wp-list-2026-11-08.md` 按任务单 §8.2 **不回写**（冻结快照）。

---

## 4. §7 闸门实测（11 项全过）

> 命令均为 `pnpm exec ...` / `pnpm lint` / `pnpm test`（**未用裸 npx**）；工作目录 `E:\Work\Project\backend\mofang-nestjs`；PowerShell 5.1；PATH 补 `D:\Apps\Git\cmd`。

| 闸门            | 命令                                                                                                                            | exit code | 真实结果                                                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 类型（build）   | `pnpm exec tsc -p tsconfig.build.json --noEmit`                                                                                 | **0**     | 0 错                                                                                                                                                   |
| 类型（含 spec） | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`                                                         | **2**     | `TOTAL_ERRORS=401` / `AFFECTED_FILES=87` —— 与 HEAD `368da4f` **实测基线逐字一致**（stash 差分法现场重测），**本单相关文件 0 error**                   |
| Lint            | `pnpm lint`                                                                                                                     | **0**     | **0 error / 0 warning**                                                                                                                                |
| 定向测试        | `pnpm exec vitest run test/auto-practice test/quality test/engine-core test/engine-adapters`                                    | **0**     | **121 文件 / 2187 例全绿**，Duration **46.26s**（基线 121 / 2176 → **+11 例**，零丢失 / 零改写）                                                       |
| 全量            | `pnpm test`                                                                                                                     | **0**     | **192 passed + 1 skipped（193 文件）/ 3227 passed + 4 skipped（3231 例）**，Duration **86.57s**，**墙钟 88.99s**（基线 3216+4 / 3220 例 → **+11 例**） |
| 边界护栏        | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                                                                        | **0**     | **12 例全绿**（本单不碰 core，该文件未改）                                                                                                             |
| core 变更面     | `git diff --stat HEAD -- src/engine-core`                                                                                       | **0**     | **空**                                                                                                                                                 |
| 前端变更面      | `git diff --stat HEAD -- src/admin-dashboard`                                                                                   | **0**     | **空**                                                                                                                                                 |
| 门禁文件变更面  | `git diff --stat HEAD -- src/auto-practice/metrics/acceptance-thresholds.ts src/auto-practice/practice-batch-health.service.ts` | **0**     | **空**（新指标不进门禁 —— R5 的直接证据）                                                                                                              |
| 改动文件清单    | `git diff --stat HEAD`                                                                                                          | **0**     | **恰好 4 个文件**（2 源码 + 2 spec），**+183 / −7**；无新增 `.ts` 源文件                                                                               |
| 隐私自检        | 新增 spec / 注释人工过一遍                                                                                                      | —         | 见 §7                                                                                                                                                  |

### 4.1 基线测法（可复算）

```powershell
# 类型债基线: 暂存本单改动 → 量 HEAD 基线 → 恢复
git stash push -m 'c5-1-baseline-measure' | Out-Null
$out  = pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals" 2>&1
$errs = @($out | Select-String -Pattern 'error TS' | ForEach-Object { $_.Line })
$files = @($errs | ForEach-Object { ($_ -replace '\(.*$','').Trim() } | Sort-Object -Unique)
Write-Output "BASE_TOTAL_ERRORS=$($errs.Count)"; Write-Output "BASE_AFFECTED_FILES=$($files.Count)"
git stash pop | Out-Null

# 定向用例数基线: 同一命令在 HEAD 上量一次
git stash push -m 'c5-1-baseline-vitest' | Out-Null
pnpm exec vitest run test/auto-practice test/quality test/engine-core test/engine-adapters
git stash pop | Out-Null
```

> 实测：HEAD `368da4f` 基线 = **401 条 / 87 文件**、定向 **121 文件 / 2176 例**；本单交付态 = **401 / 87**、**121 / 2187** → 类型债**逐字回基线**、用例数 **+11**（7 批次用例 + 4 字典用例）。
> 本单**未新增 `.ts` 文件**，故量基线时无需像 D-2 / D-3 那样先把新 spec 移出编译范围（`git stash` 只暂存已跟踪文件，未跟踪产物全程留在工作区未被误清）。

### 4.2 机器状态（实测）

| 项       | 值                                                                                       |
| -------- | ---------------------------------------------------------------------------------------- |
| Node     | **v26.13.0**                                                                             |
| pnpm     | **9.15.0**                                                                               |
| CPU 核数 | 8                                                                                        |
| 内存     | 15.9 GB 总 / 5.0 GB 空闲                                                                 |
| 常驻进程 | 取样时刻**无常驻 node 进程**（闸门 worker 已退出；无 `nest start --watch` / `vite dev`） |
| OS       | Windows 11 Home China 10.0.26300 / PowerShell 5.1                                        |

> 口径提示：任务单 §7 写「主控本地 Node v22.23.2」；本单回执机器 **Node 实测 v26.13.0**（两者都是各自会话的 `node -v` 实测值，历史记录不回改）。

### 4.3 主控复核（2026-11-13 · 本机 DESKTOP-6U804B0 · Node v22.23.2 / pnpm 9.15.0）

| 闸门            | 命令                                                                                                                                                                | 主控实测结果                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 定向抽跑        | `pnpm exec vitest run test/auto-practice/wp-k-batch-compute.spec.ts test/auto-practice/wp-k-metric-dictionary.spec.ts test/engine-core/boundary.spec.ts`            | **3 文件 / 51 例全绿**（字典 20 + 批次 19 + boundary 12），3.94s                     |
| Lint            | `pnpm lint`                                                                                                                                                         | **0 error / 0 warning**                                                              |
| 类型（build）   | `pnpm exec tsc -p tsconfig.build.json --noEmit`                                                                                                                     | exit **0**，0 错                                                                     |
| 类型（含 spec） | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`                                                                                             | exit 2，**401 条 / 87 文件** = HEAD `368da4f` 基线逐字一致；本单 4 个文件 **0 错**   |
| 全量            | `pnpm test`                                                                                                                                                         | 193 文件 / **3231 例**：3226 passed + 4 skipped + **1 failed**；Duration **150.60s** |
| 隔离面复核      | `git diff --stat HEAD -- src/engine-core src/admin-dashboard src/auto-practice/metrics/acceptance-thresholds.ts src/auto-practice/practice-batch-health.service.ts` | **四个变更面全空**（主控实测）                                                       |

**flake 定性**：唯一失败用例 `test/admin-debug/wp38-debug-session-resume.spec.ts` ③「重启后调 resume」30000ms 超时；**单文件复跑 10 例全绿**（4.15s）→ 定性**负载 flake**：本机 Node v22.23.2 全量 150.60s，回执机器 v26.13.0 / 86.57s，30s 超时用例在高负载下被拖垮。本单改动面在 `auto-practice/metrics/`，与 admin-debug 调试会话恢复链路**无因果**；与 D-3 首跑 flake 同型。

---

## 5. §6 风险逐条处置确认

| 风险   | 内容                                                                          | 本单处置                                                                                                                                                                                                 | 证据                                   |
| ------ | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| **R1** | `rate`（场次）与 `coverage`（角色）被误读为同一指标，或 coverage 被当成新门槛 | 字典 definition 写清分子 / 分母与两者区别；spec 分别断言两值（a 用例：coverage 0.5 vs rate 0.666667 同批并存）；新指标 direction `neutral` → 跨批回归判定器**整条跳过**；判据表 / 健康门禁 **diff 为空** | §4 变更面两行；spec a / 字典 §4 例     |
| **R2** | 分母只含本批跑到的角色，覆盖随样本覆盖波动                                    | definition 显式写「**本批纳入场次覆盖到的角色**」；spec d（去重）/ e（切片语义）钉住；交付记录与台账注明**不可跨样本直接横比**                                                                           | spec d / e；§8 L-3                     |
| **R3** | byCharacter 切片 coverage ∈ {0,1} 被误读为「整场探索率」                      | 字典 definition 写明角色口径；spec e 显式断言两个切片的 ∈ {0,1}；面板展示属后续前端单，本单不呈现该切片值                                                                                                | spec e                                 |
| **R4** | 旧快照缺新键导致读端 undefined                                                | `metrics` 是自由键 map + 字段只增不删纪律（`zeroMotionBreakdown` 先例）；`assertMetricsMap` 只验值为有限数字或 null → 新键自动通过；**不改 `schemaVersion`**；spec 确定性用例覆盖新键存在性              | `batch-metrics.schema.ts` 未改；spec f |
| **R5** | 新指标被复制进阈值表 / 健康门禁，越界成隐式门禁                               | **两个门禁文件 diff 为空**（闸门专列一行）；§3.2 边界写入任务单；新指标 direction `neutral` 即使被误接也**不参与 verdict**                                                                               | §4 门禁文件变更面行                    |
| **R6** | 误触 core 边界或新增导出 / 文件撞护栏                                         | 改动限 `metrics/` 2 个既有文件；零新增文件、零新增具名导出；**core diff 为空**；boundary 12 例全绿                                                                                                       | §4 core 变更面行；GATE boundary        |
| **R7** | 探索门槛临床口径（I-11 可达性）被误读为本单已解决                             | 交付记录与台账 / 结构债草案三处复述边界：本单**只做观测分层**，门槛取值、可达性对账、delta 速率均属 core 另案（S-1 已端口化但未解决可达性）                                                              | §1、§8 L-4；台账 I-16 / I-24 备注      |

---

## 6. 新指标口径示例（固定输入，`MIXED` fixture）

> 输入：`vpt_a` 两场（expert 一场含 `affective_exploration`、cold 一场含 `cognitive_exploration`）+ `vpt_b` 一场（expert，无探索）= 3 场 / 2 个角色 / 2 场含探索。

| 口径                   | 场次数 | 角色数 | `exploration.rate`（场次比例） | `exploration.character_coverage`（角色比例） |
| ---------------------- | ------ | ------ | ------------------------------ | -------------------------------------------- |
| 全局                   | 3      | 2      | **0.666667**（2/3）            | **0.5**（1/2）                               |
| `byMode['expert']`     | 2      | 2      | **0.5**（1/2）                 | **0.5**（1/2）                               |
| `byMode['cold']`       | 1      | 1      | **1**                          | **1**                                        |
| `byCharacter['vpt_a']` | 2      | 1      | **1**                          | **1**                                        |
| `byCharacter['vpt_b']` | 1      | 1      | **0**                          | **0**                                        |

**读法**：全局行两个数**不相等** —— 这正是本单要暴露的结构（总量 2/3 看着不低，但只有 **1/2 的角色**有过探索）。`byCharacter` 两行是 0/1 二值（单角色切片退化的必然语义）。

**旧快照兼容**：新键只增不删 → 旧快照**没有**这个键。读端按缺省处理（自由键 map，缺键 ≠ 0），跨批次比较时「键缺失」与「值为 0」**不可混同**；`schemaVersion` 保持 **1**，不回溯重算、不覆盖写。

**指纹段影响**：`acceptance` 段挂 `./metrics/acceptance-thresholds`（**判据表文件**，本单未改）→ **`acceptance` 指纹段不变**；本单改的是 `batch-metrics.compute.ts` 与 `metric-dictionary.ts`，二者**不在**任何指纹段的文件清单里 → 其余 7 段亦不变。跨批次比较的指纹一致性判定不受本单影响。

---

## 7. 隐私自检结论

| 检查项                  | 结论                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 新指标消费了什么        | 只有 `SessionComputationInput.characterSlug` 与 `TraceInput.strategy` —— **合规投影字段**，计算层物理接触不到对话文本 |
| 有没有来访 / 咨询师原话 | **没有**                                                                                                              |
| 有没有 prompt 全文      | **没有** —— 本单不碰 prompt 层                                                                                        |
| 有没有 `kernelState`    | **没有** —— 本单不新增任何观测字段                                                                                    |
| 有没有展示名            | **没有** —— 新指标只带一个中文 label（指标目录展示名，非来访者信息）                                                  |
| 新增 spec 里的文本      | **没有** —— 只用 `'affective_exploration'` / `'cognitive_exploration'` 这类**策略枚举字面量**                         |
| 新增日志面 / env 键     | **没有** —— 本单零日志、零 env                                                                                        |
| DB / 前端 / 批次        | **零改动** —— 零 DDL、零前端 diff、零批次、零真模型调用                                                               |

---

## 8. 遗留项

| #   | 遗留                                                                                             | 归属                                                   |
| --- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| L-1 | 前端分组行（byCharacter）展示切片内探索率 / 覆盖率；批次列表与趋势图的总量口径标注               | **前端单**（甲方案明确不碰前端）                       |
| L-2 | **40 轮档探索判据与阈值标定**（含「探索率 >0」候选条款取值）                                     | **标定批次单**（依赖第二家 provider 与长会话批次样本） |
| L-3 | 角色覆盖率的**跨样本可比性**：分母只含跑到的角色 → 不同批次覆盖率**不可直接横比**                | 口径已写进 definition；真要横比需另立归一化口径        |
| L-4 | **I-11 core 探索门槛结构复核与可达性对账**（C2 / C1，core 另案；S-1 仅完成端口化，未解决可达性） | **core 另案**                                          |
| L-5 | **轮档元数据字段**（12 / 24 / 40 档）—— 若未来要按档分派判据                                     | 另立 schema / 实体变更单                               |
| L-6 | 指标字典**版本治理**：每次改字典内容都必须升版（否则前端缓存不失效 + 审计看不出字典换过）        | 纪律（本单已按此升到 `dict-v4`）                       |

---

## 9. 提交分组与 commit message

### 9.1 提交分组隔离

本单文件**不与并行产物混入**（`data/quality/*.diff` 是 D-2 遗留的未跟踪诊断产物，**不属于本单**）。建议单独成一个提交，提交前确认：

- `git status --short` 中只有本单的 4 个代码/测试文件 + 本单文档；
- `git diff --stat HEAD -- src/engine-core` **为空**；
- `git diff --stat HEAD -- src/admin-dashboard` **为空**；
- `git diff --stat HEAD -- src/auto-practice/metrics/acceptance-thresholds.ts src/auto-practice/practice-batch-health.service.ts` **为空**。

### 9.2 commit message 草稿

```text
feat(auto-practice): C5-1 探索指标分层 (新增 exploration.character_coverage 角色覆盖口径 + 切片探索率断言; dict-v4)
```

> 备选（更短）：`feat(auto-practice): C5-1 探索指标分层（角色级探索覆盖观测口径，纯观测不进门禁）`
>
> **不自动 commit / 不 push**（红线），请手动提交。

### 9.3 本单文档产出

| 文档         | 去向                                                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 本交付记录   | `docs/worklog/completed/phase2.5/phase2.5-c5-exploration-coverage-implementation-2026-11-13.md`                               |
| 任务单       | `docs/worklog/completed/phase2.5/phase2.5-c5-exploration-stratified-metrics-task-2026-11-13.md`（状态行改 ✅ 并链本交付记录） |
| 台账回写     | `docs/worklog/pending/phase2.5-p1d-known-issues-2026-11-11.md`（I-16 / I-24 行与小节）                                        |
| 结构债回写   | `docs/worklog/pending/phase2.5-engine-core-structural-debt-assessment-2026-11-12.md`（§4 I-16 / I-24 行 + §6 第 1 条）        |
| 活清单回写   | `docs/worklog/pending/phase2.5-README.md`（§3 新增一行）                                                                      |
| 验收口径回写 | `docs/worklog/pending/phase2.5-intake-acceptance-criteria-2026-11-11.md`（§3 表格行 + §3.1）                                  |
| 回执         | `docs/worklog/pending/relay-response-20261113-0825.md`                                                                        |

> 交付记录写完时间：2026-11-13。工作区**未 commit / 未 push**。
