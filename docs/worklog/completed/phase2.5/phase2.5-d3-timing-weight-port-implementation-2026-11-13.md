# D-3 · 时序权重端口骨架（holding_present / cold_absent 的时序维度 · I-19 / S-3）· 交付记录

> 2026-11-13 · 执行方：MiniMax Code · 分支 `integrate` · 基线 HEAD `960adbc`
> 任务单：[`phase2.5-d3-timing-weight-port-implementation-task-2026-11-13.md`](phase2.5-d3-timing-weight-port-implementation-task-2026-11-13.md)（已归档至本目录，状态行已改为 ✅）
> 前置文档：D-3 复核备忘 [`phase2.5-d3-timing-weight-protocol-review-2026-11-13.md`](phase2.5-d3-timing-weight-protocol-review-2026-11-13.md)；D-2 交付记录 [`phase2.5-d2-event-kind-split-implementation-2026-11-12.md`](phase2.5-d2-event-kind-split-implementation-2026-11-12.md)
> 事实源：结构债草案 `docs/worklog/pending/phase2.5-engine-core-structural-debt-assessment-2026-11-12.md`（§4.3 S-3 / §9 D-3 表行）；台账 `docs/worklog/pending/phase2.5-p1d-known-issues-2026-11-11.md`（I-19）

---

## 1. 一句话总结

**时序权重端口骨架落地，§7 十项闸门全绿，工作区未 commit / 未 push。**

`TransitionStateOptions` 扩两个**可选**字段（`timingWeight?` / `turnIndex?`），`state-transition.ts` 内新增两个**模块私有纯函数**（`resolveTimingWeight` / `scaleDeltaVector`），两处管道在 `capTurnDelta` **之后**接入折损点；会话层透传 `runtime.turnIndex + 1` 与构造注入的 `timingWeightConfig`；适配层 `engine.providers.ts` 透传同款端口（**不接 env**）。

本单只落地 **`none` 形态**：`linear_decay / recency / window` 三种形态的纯函数实现与临床斜率留标定批次单。**缺省与非 `none` 形态一律回退等权 1.0** → 落库 delta 与改造前**逐字相同**（不是「结果一样」，是「根本没走那条路」）。

---

## 2. 实际方案 vs 任务单（偏差登记）

### 2.1 结构性偏差

| #   | 任务单口径                                                                                                   | 实际落地                                                                                                                                                                                                                                                               | 理由                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | §3.1 C.1「`EngineSessionTuningDeps` 追加 `timingWeightConfig?: <同 A.1 内联结构>`」                          | 三处**都不再手抄内联结构**，改为**反推既有类型**：core 会话层写 `TransitionStateOptions['timingWeight']`，适配层写 `EngineSessionOptions['timingWeightConfig']`（= `ConstructorParameters<typeof InMemoryEngineSession>[0]` 的索引访问，任务单 §4.1 本就点了这条口径） | 手抄 = **两份真相**，将来内核改形状（加参数 / 改联合位）适配层不会跟着动，且**类型系统查不出来**（可选字段缺失不报错）。反推让三处形状**恒等**，内核改一处三处同步。**不新增任何 core 具名导出**（断言⑥⑦ 不触发）                                               |
| D-2 | §3.1 A.2「`resolveTimingWeight` 缺省 / none / turnIndex 缺省 → 返回 `1.0`」                                  | 四个分支都返回**命名常量** `TIMING_WEIGHT_EQUAL = 1`（模块私有，不导出）                                                                                                                                                                                               | `sonarjs/no-invariant-returns` 会把「所有分支返回同一值」的函数判为 smell 并**打回 lint**。本单不用 `eslint-disable` 压味道（仓库纪律），而是把「等权」提为**唯一语义来源**的命名常量 —— 顺带说清一件事：标定批次落地时换的是**算子公式**，不是「等权」这个语义 |
| D-3 | §3.1 A.3 示意代码 `const capped = capTurnDelta(...); const delta = scaleDeltaVector(capped, ...)`            | 照此实现：cap 结果变量由原名 `delta` 改名为 `capped`，**加权后的**才叫 `delta`；`buildDeltaCapReport(raw, capped, ...)` 第二参用**折损前**的 `capped`                                                                                                                  | 任务单 §3.1 A.3 的示意代码即此命名与口径；cap 报告口径因此**不变**（折损不改变砍幅结论）                                                                                                                                                                        |
| D-4 | §3.1 D.5「快照序列与既有 `engine-core.spec.ts` 多轮断言一致（复用既有基线，**不新造跨轮快照**）」            | 本单**没有硬编码任何跨轮快照基线**，改为「**缺省 vs 注入**」逐字对照（整快照 `toEqual`）+ 复用既有基线的 `turnIndex` 递增断言（1 → 2，同 `engine-core.spec.ts:131`）                                                                                                   | 「缺省 vs 注入」证明的是**与改造前相同**（强于「与某组手写数字相同」）；且 `none` 恒等下**任何**硬编码快照都是多余的真相副本。既有基线只复用 `turnIndex` 口径那一处                                                                                             |
| D-5 | §8.2 回写清单「活清单 `phase2.5-README.md` 登记（`phase2.5-wp-list-2026-11-08.md` 为**冻结快照，不回写**）」 | 只回写 `phase2.5-README.md`；**不动** wp-list                                                                                                                                                                                                                          | 任务单明示 wp-list 已冻结。注意：D-2 那一单是**回写**了 wp-list（§四 独立单表 24 → 25 行）—— 本单按任务单口径**不回写**，两单差异在此显式登记，不静默                                                                                                           |
| D-6 | §3.1 D.1~D.6 六条验收                                                                                        | 展开为 **15 例**（`it.each` 覆盖三形态），分五组                                                                                                                                                                                                                       | 六条验收落到 15 条可执行断言；**没有一条靠「应该没问题」**                                                                                                                                                                                                      |

### 2.2 工程取舍

| #   | 项           | 实际取值                                                                                                                  | 理由                                                                                        |
| --- | ------------ | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| E-1 | 缺省语义     | **不构造权重配置、不走折损分支**（`resolveTimingWeight` 恒返回等权，`scaleDeltaVector` 对 `weight === 1` **原引用返回**） | 「缺省 = 逐字零回归」的根：不仅数值相同，**连对象都不换**                                   |
| E-2 | 管道顺序     | 聚合 → 人格调节 → **cap → 折损** → apply → 信念演化                                                                       | P5 已定案（复核备忘 §5.2）：cap 是「一回合最多动多少」的最后一道尺子，权重不得绕过它        |
| E-3 | 轮次号口径   | 会话层传 `runtime.turnIndex + 1`（**1 起**，同 `MatchContext` 口径）                                                      | 任务单 §1.2-3 拍板；`runtime.turnIndex` 在第 8 步才自增，所以本轮内取值 = 已完成轮数 + 1    |
| E-4 | 落库路径     | 本单**不接入**折损分支（任务单 §4.3）                                                                                     | `none` 恒等下两路径逐字一致；接入点与口径在 §6 R2 登记，标定批次落地非 `none` 时再接        |
| E-5 | env 通道     | **不开**（`engine.module.ts` **一字未动**，装配项不传 → 内核走缺省）                                                      | 任务单 §1.2-5；内核零 `process.env`（断言⑩ 由注入端口保证）                                 |
| E-6 | 配置注入方式 | **构造注入**（与 cap / 人格 / 同盟 / 衰减同款范式）                                                                       | 权重形态是**部署形态**的决定（灰度到哪批会话），不是会话参数；构造注入 = 一场会话内口径恒定 |

---

## 3. 改动文件清单

### 3.1 core 纯层（例外批准，恰好 2 个既有文件）

| 文件                                                    | 改动                                                                                                                                                                                                                                                                                                                                                                                                       | 规模     |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `src/engine-core/cognition/state-transition.ts`         | ① `TransitionStateOptions` 追加 `timingWeight?`（内联结构类型：`kind` 联合位 + `slope?` + `windowTurns?`）与 `turnIndex?`；② 新增模块私有常量 `TIMING_WEIGHT_EQUAL`；③ 新增模块私有纯函数 `resolveTimingWeight(config, turnIndex)` 与 `scaleDeltaVector(delta, weight)`；④ `transitionState` / `transitionStateDetailed` 两处管道在 `capTurnDelta` 之后接入折损点，cap 报告第二参改用**折损前**的 `capped` | +94 / −4 |
| `src/engine-core/in-memory/in-memory-engine-session.ts` | ① `InMemoryEngineSessionOptions` 追加 `timingWeightConfig?: TransitionStateOptions['timingWeight']`（**反推**，不抄第三份）；② 同名私有字段 + 构造赋值（照既有范式）；③ 临时快照路径（`transitionState` 调用）options 内传入 `turnIndex: runtime.turnIndex + 1` 与 `timingWeight: this.timingWeightConfig`                                                                                                 | +21      |

> 合计 **2 文件 / +111 / −4** —— 与任务单「例外批准声明」表的 2 个 core 文件**逐条对应**。**不新增 core 文件、不新增具名导出**（`TIMING_WEIGHT_EQUAL` 是模块私有常量，未 export）；`test/engine-core/boundary.spec.ts` **未改**。
> 落库路径（事件 delta + 剧本 delta 合并后统一过一次 cap）**本单不接入**折损分支 —— 接入点与口径见 §6 R2。

### 3.2 adapter（1 个既有文件）

| 文件                                             | 改动                                                                                                                                                                                                                                                                          |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/engine-adapters/wiring/engine.providers.ts` | ① `EngineSessionTuningDeps` 追加 `timingWeightConfig?: EngineSessionOptions['timingWeightConfig']`（**反推**，不新增 core 具名类型 import）；② `resolveEngineSessionTuningOptions` 追加对应「有才传」三元（照既有范式）。`engine.module.ts` **一字未动**（本单不开 env 通道） |

### 3.3 测试（1 个新增 spec）

| 文件                                             | 状态     | 内容                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `test/engine-core/d3-timing-weight-port.spec.ts` | **新增** | **15 例**，五组：① 缺省零回归（基线数值 + 整快照 `toEqual`）② `none` 形态等权 ③ 非 `none` 三形态（`it.each`）回退等权 ④ 管道顺序与 cap 报告口径（报告逐字相同 + 砍幅明细仍是 cap 结论 + 两个出口一致）⑤ 会话层透传（缺省 / `none` / `recency` 三种配置落库快照逐字相同 + 多轮 `turnIndex` 递增） |

> **零既有测试文件被改动** —— 本单不扩事件联合、不改 `DELTA_TABLE`、不改词表、不改审计实体，故既有 spec 全部**一字未动**仍绿。

---

## 4. §7 闸门实测（10 项全过）

> 命令均为 `pnpm exec ...` / `pnpm lint` / `pnpm test`（**未用裸 npx**）；工作目录 `E:\Work\Project\backend\mofang-nestjs`；PowerShell 5.1；PATH 补 `D:\Apps\Git\cmd`。

| 闸门                  | 命令                                                                      | exit code | 真实结果                                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GATE1 类型（build）   | `pnpm exec tsc -p tsconfig.build.json --noEmit`                           | **0**     | 0 错                                                                                                                                                                               |
| GATE2 类型（含 spec） | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`   | **2**     | `TOTAL_ERRORS=401` / `AFFECTED_FILES=87` —— 与 HEAD `960adbc` **实测基线逐字一致**（stash 差分法现场重测），**本单相关文件 0 error**                                               |
| GATE3 Lint            | `pnpm lint`                                                               | **0**     | **0 error / 0 warning**                                                                                                                                                            |
| GATE4 边界护栏        | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                  | **0**     | **12 例全绿**（本单未改该文件；断言⑥⑦⑩ 未触发）                                                                                                                                    |
| GATE5 定向测试        | `pnpm exec vitest run test/quality test/engine-core test/engine-adapters` | **0**     | **102 文件 / 1881 例全绿**，Duration **27.74s**（基线 101 / 1866 → **+1 文件 / +15 例**）                                                                                          |
| GATE6 全量            | `pnpm test`                                                               | **0**     | **192 passed + 1 skipped（193 文件）/ 3216 passed + 4 skipped（3220 例）**，Duration **68.63s**，**墙钟 70.37s**（基线 191+1 / 192 文件、3201+4 / 3205 例 → **+1 文件 / +15 例**） |
| GATE7 core 变更面     | `git diff --stat HEAD -- src/engine-core`                                 | **0**     | **恰好 2 个既有文件**（+111 / −4），与例外批准表**逐条对应**                                                                                                                       |
| GATE8 adapter 变更面  | `git diff --stat HEAD -- src/engine-adapters`                             | **0**     | **恰好 1 个既有文件**（`engine.providers.ts`，+14）                                                                                                                                |
| GATE9 前端变更面      | `git diff --stat HEAD -- src/admin-dashboard`                             | **0**     | **空**                                                                                                                                                                             |
| GATE10 隐私自检       | 人工过新增 spec / 算子注释 / 观测面                                       | —         | 见 §7                                                                                                                                                                              |

### 4.1 类型债基线的测法（可复算）

任务单沿用的「401 条 / 87 文件」是 D-2 在 HEAD `2bf32f0` 实测的值；本单基线 HEAD 已推进到 `960adbc`，故**重新测了一次**：

```powershell
# 现场对比法: 把本单改动暂存 → 量 HEAD 基线 → 恢复
#   注意: 新增 spec 是未跟踪文件, tsc 会连它一起查 —— 先改名移出编译范围, 否则基线里会混进新 API 的报错
Rename-Item 'test\engine-core\d3-timing-weight-port.spec.ts' 'd3-timing-weight-port.spec.ts.bak'
git stash push -m 'd3-baseline-measure' | Out-Null
$out  = pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals" 2>&1
$errs = @($out | Select-String -Pattern 'error TS' | ForEach-Object { $_.Line })
$files = @($errs | ForEach-Object { ($_ -replace '\(.*$','').Trim() } | Sort-Object -Unique)
Write-Output "BASE_TOTAL_ERRORS=$($errs.Count)"; Write-Output "BASE_AFFECTED_FILES=$($files.Count)"
git stash pop | Out-Null
Rename-Item 'test\engine-core\d3-timing-weight-port.spec.ts.bak' 'd3-timing-weight-port.spec.ts'
```

> 实测：HEAD `960adbc` 基线 = **401 条 / 87 文件**；本单交付态 = **401 条 / 87 文件** → **逐字回到基线**。`git stash` 只暂存**已跟踪**文件，未跟踪文件全程留在工作区未被误清。
> 顺带一条经验：**新增 spec 必须在量基线时移出编译范围** —— 否则「基线」里会混进新 API 的报错，基线就不可比了（D-2 量基线时新 spec 是未跟踪的，它同样会进 tsc 视野；本单显式避开）。

### 4.2 机器状态（实测）

| 项       | 值                                                    |
| -------- | ----------------------------------------------------- |
| Node     | **v26.13.0**                                          |
| pnpm     | **9.15.0**                                            |
| CPU 核数 | 8                                                     |
| 内存     | 15.9 GB 总 / 5.8 GB 空闲                              |
| 常驻进程 | 2 个 node（**78.8 MB / 34.2 MB**），**无 watch 模式** |
| OS       | Windows 11 Home China 10.0.26300 / PowerShell 5.1     |

> 墙钟口径说明：GATE5 定向测试在同一份代码上量过两次（27.74s / 49.97s），GATE6 全量量过两次（68.63s / 84.28s）—— 波动来自机器负载（并行度 / 磁盘），**用例数与通过与否每次一致**。本表取终态那轮。

### 4.3 主会话验收现场复核（2026-11-13 提交前）

主 AI 在本地工作区对回执证据抽跑复现，结果与上表一致：

| 闸门                 | 现场复现结果                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GATE4 boundary       | 12 例全绿，exit 0（2.58s）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| GATE5 定向           | 102 文件 / 1881 例全绿，exit 0（54.68s；回执 27.74s，机器负载波动）                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| GATE3 lint           | 0 error / 0 warning，exit 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| GATE2 tsc（含 spec） | 401 条错误 = 基线逐字一致；本单四个改动文件 **0 命中**                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| GATE6 全量           | 首跑 193 文件：**3215 passed + 4 skipped + 1 failed**，Duration 145.27s（现场 Node v22.23.2，回执机为 v26.13.0）；失败用例 `test/admin-debug/debug-session-persistence.spec.ts` ⑥「跑满 3 轮 → 自动生成标题」`waitFor` 10000ms 超时。**单文件复跑 26 例全绿、exit 0** → 定性为负载 flake（隔离 worker 启动 + 机器负载导致轮询条件未在 10s 内成立）；该文件不在本单改动面（core / adapter / quality），`none` 等权骨架不改变任何轮询或标题生成行为，与失败用例无因果。复跑通过后用例数回到回执口径 3216 passed + 4 skipped。 |

> 现场诊断日志（本地、不入库）：`data/quality/d3-acceptance-boundary.log` / `d3-acceptance-targeted.log` / `d3-acceptance-lint-tsc.log` / `d3-acceptance-full.log` / `d3-acceptance-flake-rerun.log`。

---

## 5. §6 风险逐条处置确认

| 风险   | 内容                                                               | 本单处置                                                                                                                                                                                                                                                                                | 证据                                       |
| ------ | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **R1** | 状态可复现性契约、落库快照、轨迹回放受影响                         | 缺省 `none` **逐字走旧路径**：`resolveTimingWeight` 恒等权 + `scaleDeltaVector` 对 `weight === 1` **原引用返回**（连对象都不换）；未实现形态同样回退等权；**零既有 spec 改动**                                                                                                          | §6 证据表；GATE5 / GATE6                   |
| **R2** | 落库路径未接入折损点，与临时快照路径在未来非 `none` 形态下口径漂移 | 本单 `none` 恒等 → 两路径逐字一致；接入点与口径（**cap 之后**、`turnIndex + 1`、与临时快照**同一算子**）在会话层代码注释 + 本记录 §3.1 登记；标定批次落地非 `none` 时须在两条路径接入同一算子（若需跨文件复用，走 **D-6 白名单授权**：独立 cognition 文件 + 导出）并补两路径一致性 spec | §3.1；§8 L-4                               |
| **R3** | cap 前缩放翻转砍幅结论                                             | 本单定 **cap 后折损**（§1.2-2 拍板）；`buildDeltaCapReport(raw, capped, ...)` 第二参用**折损前**的 `capped` → **砍幅结论与折损无关**；spec ④ 用「三个共情撞 trust cap」钉住报告明细仍是 `0.3 → 0.2`                                                                                     | spec ④；代码注释                           |
| **R4** | 既有批次轨迹可比性（加权改变早期 / 晚期 delta）                    | `none` 缺省**不触发**任何非等权行为 → 现有批次口径不变；非 `none` 上线前须全量批次重跑并比对 `stateTransition` 指纹段                                                                                                                                                                   | §8 L-5                                     |
| **R5** | 新增导出 / 文件撞 boundary ⑥⑦                                      | 纯函数与常量**模块私有**（`TIMING_WEIGHT_EQUAL` 未 export）；配置类型走**已导出**接口的**可选字段** + 内联结构；`index.ts` **公开面零变化**；既有 12 例 boundary spec 守护                                                                                                              | GATE4；`git diff --stat` 显示无 `index.ts` |
| **R6** | 非 `none` 形态临床方向未标定                                       | 纯函数实现与 `slope` / `windowTurns` 参数**留标定批次**；本单联合位留空、**不填种子斜率**；未实现形态**回退等权**（不猜方向）                                                                                                                                                           | §2.1 D-2；§8 L-1 / L-2                     |

---

## 6. 缺省零回归证据

| 证据             | 断言                                                                                                                       | 结果 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- | ---- |
| 基线数值         | 不传任何端口 → 旧模型算术逐字成立（初始 trust 0.3 / safety 0.5 / bond 0 + 共情 +0.10 / +0.02 / +0.01 → 0.4 / 0.52 / 0.01） | ✅   |
| 整快照对照       | 显式 `none` vs 缺省 → 整快照 `toEqual` **逐字相同**                                                                        | ✅   |
| 非 `none` 三形态 | `linear_decay` / `recency` / `window`（带 `slope` + `windowTurns`）+ `turnIndex` → 与缺省整快照 `toEqual` **逐字相同**     | ✅   |
| 轮次号无关性     | `none` + `turnIndex`（1 / 999）→ 与缺省逐字相同；非 `none` + `turnIndex` 缺省 → 同样等权                                   | ✅   |
| cap 报告         | 折损前后报告对象 `toEqual` **逐字相同**；砍幅明细仍是 cap 的结论（trust `0.3 → 0.2`），**不是折损后的值**                  | ✅   |
| 两出口一致       | `transitionState` 与 `transitionStateDetailed` 的快照 `toEqual` **逐字相同**                                               | ✅   |
| 会话层           | 缺省 / 注入 `none` / 注入 `recency` 三种配置的**落库快照序列**逐字相同（2 轮）                                             | ✅   |
| 多轮口径         | 缺省下 `turnIndex` 递增 **1 → 2**（同既有 `engine-core.spec.ts` 基线）                                                     | ✅   |

> **读法提醒**：本单交付后，状态演化**仍然对轮次位置不敏感** —— 这是**预期**，不是「拆分无效」。本单落地的是**端口 + 折损接入点 + 护栏测试**；真正让「第 2 轮接住」与「第 12 轮才接住」产生差异的，是**形态曲线本身**（留标定批次单）。
> 另外提醒：配置指纹的 `stateTransition` 段**会变**（`state-transition.ts` 内容变了 → 文件哈希变）→ 跨批次比较会报「配置变了」，这是**正确归因**（口径载体确实动了），不是回归。

---

## 7. 隐私自检结论

| 检查项                            | 结论                                                                                    |
| --------------------------------- | --------------------------------------------------------------------------------------- |
| 新增代码里有没有来访 / 咨询师原话 | **没有** —— 新增的只有类型、常量、纯函数与注释                                          |
| 新增 spec 里有没有真实对话文本    | **没有** —— 测试台用 `'empathy'` / `'neutral'` 这类**标签字面量**，不来自任何真实来访者 |
| 有没有 prompt 全文                | **没有** —— 内核零 prompt（本单不碰 prompt 层）                                         |
| 有没有 `kernelState`              | **没有** —— 本单不新增任何观测字段                                                      |
| 有没有展示名                      | **没有** —— 权重配置里只有形态标识（`kind`），没有面向用户的名称                        |
| 有没有新增日志面                  | **没有** —— 本单不新增任何日志 / 观测字段                                               |
| 有没有新增 env 键                 | **没有** —— 装配项不传 → 内核走缺省；内核零 `process.env`（断言⑩ 守）                   |
| DB / 前端 / 批次                  | **零改动** —— 零 DDL、零前端 diff、零批次、零真模型调用                                 |

---

## 8. 遗留项

| #   | 遗留                                                                                                                                                                            | 归属                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| L-1 | `linear_decay / recency / window` 三种形态的**纯函数实现** + `slope` / `windowTurns` 临床标定值                                                                                 | **标定批次单**（权重取值域 `[0, 1]` 约束同批落） |
| L-2 | 权重**取值域约束**与边界处理（非法值 / 负数 / >1 的兜底口径）                                                                                                                   | **标定批次单**                                   |
| L-3 | 权重 **env 覆写通道**（适配层 `resolveTimingWeightConfig` 接 env；参照 D-2 L-4 范式）                                                                                           | **标定批次单**                                   |
| L-4 | **落库路径折损接入** + 两路径**同一算子**复用（若需跨文件复用纯函数，走 **D-6 白名单授权**：独立 cognition 文件 + 导出）                                                        | **标定批次单**                                   |
| L-5 | 非 `none` 形态上线前的**全量批次重跑**与 `stateTransition` 指纹段比对                                                                                                           | **形态上线单**前置                               |
| L-6 | `turnIndex` 的**长会话口径**（超长会话的轮次号是否需要分桶 / 归一）                                                                                                             | 标定批次一并看                                   |
| L-7 | D-2 遗留 L-1~L-10（临床 delta 幅度 / 缺席阈值 / `POSITIVE_EVENTS` 归属 / env 通道 / `llm_active` 生效轨 / 词表在场标记 / 前端看板映射 / `hasNonNeutralEvent` 语义 / cold 先验） | **另案**，本单不清理                             |
| L-8 | D-4 cold 模式先验                                                                                                                                                               | DOC-2 不建议单独实施，**不复议**                 |

---

## 9. 提交分组与 commit message

### 9.1 提交分组隔离

本单文件**不与并行产物混入**（`data/quality/*.diff` 是 D-2 遗留的未跟踪诊断产物，**不属于本单**）。建议单独成一个提交，提交前确认：

- `git status --short` 中只有本单的 3 个改动文件 + 新增 spec + 本单文档；
- `src/engine-core` 的 diff **恰好 2 个文件**（与例外批准表逐条对应）；
- `src/engine-adapters` 的 diff **恰好 1 个文件**（`engine.providers.ts`）；
- `src/admin-dashboard` 的 diff **为空**。

### 9.2 commit message 草稿

```text
feat(wp-d3): 时序权重端口骨架落地（TransitionStateOptions 扩 timingWeight/turnIndex + cap 后折损点 + none 形态零行为变化）
```

> 备选（更短）：`feat(wp-d3): D-3 时序权重端口骨架（cap 后折损点 + none 形态等权，缺省逐字零回归）`
>
> **不自动 commit / 不 push**（红线），请手动提交。

### 9.3 本单文档产出

| 文档       | 去向                                                                                                                               |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 本交付记录 | `docs/worklog/completed/phase2.5/phase2.5-d3-timing-weight-port-implementation-2026-11-13.md`                                      |
| 任务单     | `docs/worklog/completed/phase2.5/phase2.5-d3-timing-weight-port-implementation-task-2026-11-13.md`（状态行改 ✅ 并链本交付记录）   |
| 台账回写   | `docs/worklog/pending/phase2.5-p1d-known-issues-2026-11-11.md`（I-19 行 + §7.6）                                                   |
| 结构债回写 | `docs/worklog/pending/phase2.5-engine-core-structural-debt-assessment-2026-11-12.md`（§3 I-19 行 + §4.3 S-3 进度块 + §9 D-3 表行） |
| 活清单回写 | `docs/worklog/pending/phase2.5-README.md`（§3 D-3 行）                                                                             |
| 回执       | `docs/worklog/pending/relay-response-20261113-0653.md`                                                                             |

> 交付记录写完时间：2026-11-13。工作区**未 commit / 未 push**。
