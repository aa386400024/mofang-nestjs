# D-2 · 事件类型拆分（holding_present / cold_absent）· 交付记录

> 2026-11-12 · 执行方：MiniMax Code · 分支 `integrate` · 基线 HEAD `2bf32f0`
> 任务单：[`phase2.5-d2-event-kind-split-implementation-task-2026-11-12.md`](phase2.5-d2-event-kind-split-implementation-task-2026-11-12.md)（已归档至本目录，状态行已改为 ✅）
> 事实源：结构债草案 `docs/worklog/pending/phase2.5-engine-core-structural-debt-assessment-2026-11-12.md`（§4.2 S-2 / §9 D 编号表行 285-286）；台账 `docs/worklog/pending/phase2.5-p1d-known-issues-2026-11-11.md`（I-08 / I-10 / I-18）；D-1 交付记录 `docs/worklog/completed/phase2.5/phase2.5-d1-model-classifier-implementation-2026-11-12.md`

---

## 1. 一句话总结

两类「在场状态」事件（`holding_present` 稳定在场 / `cold_absent` 冷漠缺席）**正式进 core 联合与 delta 表行**，种子向量 = `ZERO`（缺省零回归）；旁路标签层整体取消、模型轨映射收敛为「只有 core kind」；审计层**恢复词表命中明细**（D-1 期间「matchedTerms 归零」的已知代价解除）；**不接 `llm_active`**，规则轨词表**不扩**，临床幅度全部留标定批次；**10 项闸门全绿**。

---

## 2. 实际方案 vs 任务单（偏差登记）

### 2.1 结构性偏差

| #   | 任务单口径                                                                                                 | 实际落地                                                                                                                                                                                                                                                                                                | 理由                                                                                                                                                                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | 任务单沿用「既有类型债 86 文件 396 条」                                                                    | HEAD `2bf32f0` **实测基线 = 401 条 / 87 文件**（用 `git stash` 对比法现场测得），本单交付态 = **401 / 87**，与基线**逐字一致**、**本单相关文件 0 error**                                                                                                                                                | 任务单沿用的 396/86 是 D-1 记录时的数，HEAD 已推进到 `2bf32f0`，基线本身漂了。**以现场实测为准**（本单唯一一次重新测基线，用的是 stash + 逐文件差分，可复算）                                                                                                                                       |
| D-2 | §3.1-8 未提指标字典版本                                                                                    | `METRIC_DICTIONARY_VERSION` **`dict-v2` → `dict-v3`**                                                                                                                                                                                                                                                   | `TRACKED_EVENTS` 加两项 → 字典新增 4 个 id。**两份内容不同的字典共用同一版本号 = 前端缓存不失效 + 审计比对看不出字典换过**（`metricCatalog.ts` 按版本缓存）。按 Phase3 P0 加 8 指标时 `dict-v1 → dict-v2` 的**同款既有约定**手动递增。连带改 `wp-k-metric-dictionary.spec.ts` 的版本断言并新增 2 例 |
| D-3 | §3.1-14「`d1-event-classifier-evidence.spec.ts` **复用不改**」                                             | 该 spec **一字未改**；改的是它依赖的 `scripts/ops/quality/d1-event-classifier-evidence.lexicon.ts`：`HUMAN_LABEL_VOCABULARY = [...TRACKED_EVENTS, ...]` 改为**去重展开**                                                                                                                                | `TRACKED_EVENTS` 扩两项后原式子会产生**重复项**（CSV 表头重复 = 标注模板出现两列同名），并打破 D-1 那 39 例零回归锚（断言 `toHaveLength(13)`）。去重后词表与 D-1 **逐字相同**（13 项、顺序不变）→ 零回归锚保住                                                                                      |
| D-4 | §3.1 清单未列 `test/engine-core/wp5-rendering.spec.ts`                                                     | 「出参字段集合」登记表断言 **+1**（`eventDetails`）                                                                                                                                                                                                                                                     | 该文件**已为每次加只读观测字段留了登记位**（WP38 `events` / WP65 `revision` 都在注释里逐条登记）。本单按**同款格式**登记 `eventDetails`，属 core 例外批准 #3/#4 的必然连带                                                                                                                          |
| D-5 | §3.1-9「`DELIBERATION_RULE_ALIGNED_TAGS` 不动」                                                            | 该数组**一字未动**；改的是 `wp63-deliberation-schema.spec.ts` 里那份「内核枚举运行时基线」清单（**必须跟着加两项**，否则断言与内核脱节 —— 正是那份清单存在的理由），并把「规则对齐组 = 内核去掉 neutral」的断言按 D-2 显式决定改为「去掉 neutral **与两类在场状态事件**」，另加一条显式断言钉住这个决定 | 断言红灯是**预期的绊线**（该 spec 注释明写「内核哪天加了新事件类型, 这条断言立刻变红 → 逼着人显式决定」）。本单的显式决定就是「不加」，故按决定改断言                                                                                                                                               |
| D-6 | §3.2「不新增 env 键」                                                                                      | 两类新 kind **刻意不开 env 覆写通道**；`wp60-delta-table-config.spec.ts` 的 `envKeys` 从穷尽 `Record<..., string>` 改为穷尽 `Record<..., string \| undefined>`                                                                                                                                          | 联合一变，穷尽 Record 立刻编译报错逼人表态。改成 `string \| undefined` 后**仍是穷尽**（联合一变仍逼人显式决定），但允许「本单明确不开通道」；另加一条断言钉住「填了 env 也不生效且**不告警**」（不是解析失败）                                                                                      |
| D-7 | §4.2「`mapModelLabels` 返回 `coreKinds` 单数组」 vs §3.1-6「`MappedModelLabels` 的 `sideLabels` 字段移除」 | 取**后者**：保留 `{ coreKinds }` 对象形态，去掉 `sideLabels` 字段与分支                                                                                                                                                                                                                                 | 任务单内部两处口径不一致。取后者是最小改动（调用点 `outcome.labels.coreKinds` 一行不动），且「去掉 sideLabels 分支」的实质要求已满足。若取前者要连带改 `ModelTrackOutcome` 与 3 处消费点，收益为零                                                                                                  |
| D-8 | §2 现状锚点表写旧字段名 `kernelEventKinds`                                                                 | 实现按 §4.3 的契约形状走：字段名 **`kernelEvents`**，元素 = 明细（`kind` + `matchedTerms` + `strength?`）                                                                                                                                                                                               | §4.3 是**契约**章节，§2 是**现状**章节（描述旧代码）。契约章节优先                                                                                                                                                                                                                                  |

### 2.2 连带修改的测试文件（任务单 §3.1-D 未列，但被联合扩张逼出）

| 文件                                                    | 为什么必须改                                                                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `test/admin-debug/wp38-debug-event-tags.spec.ts`        | 断言标签数 **11 → 13** + 新增两条中文标签断言                                                                             |
| `test/auto-practice/wp-k-metric-dictionary.spec.ts`     | 标题「11 个事件」→「13 个事件」；版本断言 `dict-v2` → `dict-v3`；新增 2 例（两类新 kind 的 count/rate 登记 + 版本一致性） |
| `test/engine-adapters/wp60-delta-table-config.spec.ts`  | `envKeys` 是**穷尽** `Record<CounselorEventKind, string>` → 联合一变就编译报错（见 D-6）                                  |
| `test/engine-adapters/wp63-deliberation-schema.spec.ts` | 见 D-5                                                                                                                    |
| `test/engine-core/wp60-delta-table-config.spec.ts`      | 「端口表覆盖全部 11 种事件」清单 → 13（顺带证明**覆写通路对两类新 kind 同样生效**，即标定批次的落地路径已通）             |
| `test/engine-core/wp5-rendering.spec.ts`                | 见 D-4                                                                                                                    |

### 2.3 工程取舍

| #   | 项                                             | 实际取值                                                 | 理由                                                                                                                                                      |
| --- | ---------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E-1 | 两类新 kind 的 `DELTA_TABLE` 种子              | **`ZERO`**                                               | 任务单 §1.2.4 拍板。临床方向与幅度**不写进基础表**                                                                                                        |
| E-2 | 临床候选幅度                                   | **只登记为标定批次候选**，不进代码                       | 草案候选：`holding_present` safety +0.002 / bond +0.001；`cold_absent` trust −0.002。**工程不替临床拍板数值**                                             |
| E-3 | `POSITIVE_EVENTS`                              | **默认不纳入** `holding_present`                         | 任务单 §3.1-8 拍板。理由写进注释：正事件率若混入「在场状态」类，口径会变糊；且此刻两类**恒为 0**（规则轨词表不扩 + 模型轨走 shadow 旁路不进 core events） |
| E-4 | `holding_present` / `cold_absent` 的中文展示名 | **`稳定在场`** / **`冷漠缺席**                           | 任务单 §3.1-7 的定稿，执行方不另造近义词                                                                                                                  |
| E-5 | 审计 `matchedTerms`                            | **取内核给出的值**；模型轨事件为**空数组**               | 空数组 = 「没有词表证据」，不是「忘了填」。审计**不造词**                                                                                                 |
| E-6 | `engine-turn.service.ts` 的兜底                | `eventDetails` 缺失但 `events` 在时 → 记 kind + 空命中词 | 旧出参形状的兜底路径；不造词                                                                                                                              |

---

## 3. 改动文件清单

### 3.1 core 纯层（例外批准，恰好 4 个既有文件）

| 文件                                                    | 改动                                                                                                                                                       | 行数     |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `src/engine-core/domain/events/session-event.ts`        | `CounselorEventKind` 联合追加 `holding_present` / `cold_absent`；头注释口径同步（**在场状态类**，非行为动作类）                                            | +15 / −1 |
| `src/engine-core/cognition/state-transition.ts`         | `DELTA_TABLE` 追加两行 `holding_present: ZERO` / `cold_absent: ZERO`；注释写明「临床增量留标定批次、走 `DeltaTableConfig` 覆写范式」；算子数注释 11 → 13   | +13 / −2 |
| `src/engine-core/domain/engine-session.types.ts`        | `EngineTurnOutput` 新增**可选**出参 `eventDetails?: readonly SessionEvent[]`（复用既有 `SessionEvent` 形状，**不新增具名导出类型**）；旧 `events` 逐字不变 | +17 / −1 |
| `src/engine-core/in-memory/in-memory-engine-session.ts` | `events.length > 0` 分支内一并挂 `eventDetails: [...events]`（数组副本）；旧 kind 投影逐字不变                                                             | +4 / −1  |

> 合计 **4 文件 / +44 / −5**。**不新增 core 文件、不新增具名导出**；`test/engine-core/boundary.spec.ts` **未改**。

### 3.2 adapter（7 个既有文件）

| 文件                                                                      | 改动                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/engine-adapters/cognition/model-event-mapping.ts`                    | `CORE_EVENT_KIND_TABLE` 补两项；**移除 `MODEL_SIDE_LABELS` / `ModelSideLabel`**，`ModelEventLabel = CounselorEventKind`；`ModelClassification` / `MappedModelLabels` / `ModelLabelMapping` 去掉 `sideLabels` / `sideLabel`；`MODEL_LABEL_MAPPING` 两类改为 `coreKind` 映射自身；`mapModelLabels` 去掉 sideLabels 分支（未知丢弃 / 去重保序 / 全丢 → null 三条口径不变） |
| `src/engine-adapters/cognition/model-event-classifier.ts`                 | neutral 判定改 `coreKinds.every(kind => kind === 'neutral')`；cold / holding 判定改从 `coreKinds.includes(...)`；`modelKinds` 直接取 `coreKinds`；prompt 文案两类从「旁路标签」改述为「在场状态事件」                                                                                                                                                                   |
| `src/engine-adapters/wiring/turn-delta-audit/turn-delta-audit.port.ts`    | 写侧输入从 `kernelEventKinds` 升级为 `kernelEvents: readonly TurnDeltaAuditEventInput[]`（`kind` + `matchedTerms` + `strength?`）；新增 `TurnDeltaAuditEventInput`（**端口文件内**的类型，非 core 导出）                                                                                                                                                                |
| `src/engine-adapters/wiring/turn-delta-audit/turn-delta-audit.service.ts` | `kernelEventsToSessionEvents` 改为 `toAuditSessionEvents`，**直接消费内核明细**（`matchedTerms` 取内核值，`strength` 缺省 1）；`persist` 由明细派生 `eventKinds`（去重保序），落库结构不变                                                                                                                                                                              |
| `src/engine-adapters/rendering/turn-render-orchestrator.ts`               | `TurnRenderResult` 加可选 `eventDetails`；**三处**结果构造点透传（`turn` / `turnStream` / 阻断轮）。审议输入 `kernelEvents` 与观测 `events` **仍只取 kind 数组**，不扩                                                                                                                                                                                                  |
| `src/engine-adapters/wiring/engine-turn.service.ts`                       | `auditTurn` 改传本轮 `eventDetails`（含旧出参兜底）                                                                                                                                                                                                                                                                                                                     |
| `src/engine-adapters/deliberation/deliberation-types.ts`                  | `DELIBERATION_RULE_ALIGNED_TAGS` **一字未动**；补注释写明「两类新 kind 刻意不纳入规则对齐组」及三条理由                                                                                                                                                                                                                                                                 |

### 3.3 业务层与脚本（3 个文件）

| 文件                                                          | 改动                                                                                                                                              |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/admin-debug/event-tag-labels.ts`                         | `COUNSELOR_EVENT_LABELS` 补两项（`稳定在场` / `冷漠缺席`）；「11 类」注释改「13 类」                                                              |
| `src/auto-practice/metrics/metric-dictionary.ts`              | `TRACKED_EVENTS` 补两项（13）；`POSITIVE_EVENTS` **不变**但补注释写明「默认不纳入 + 待决」；`METRIC_DICTIONARY_VERSION` **`dict-v2` → `dict-v3`** |
| `scripts/ops/quality/d1-event-classifier-evidence.lexicon.ts` | `HUMAN_LABEL_VOCABULARY` 去重展开（见 D-3）                                                                                                       |

### 3.4 测试

| 文件                                                    | 状态         | 内容                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/engine-adapters/d2-event-kind-split.spec.ts`      | **新增**     | **22 例**，七组：① core 联合 13 类 + 三处穷尽 Record 键集合一致 ② 种子 ZERO（零 delta / 与 neutral 逐字相同 / 覆写通路生效）③ 映射收敛（`sideLabels` 形态消失 / 未知丢弃 / 全丢 → null / 校验器不变）④ 出参 `eventDetails` 往返 + 旧 `events` 逐字不变 + 空则不挂 ⑤ 审计按明细落库 `matchedTerms` + 模型轨空数组 ⑥ 中间态零回归（快照逐字不变 / shadow 下模型新 kind 不进 core events）⑦ 规则轨**产不出**两类新 kind |
| `test/engine-adapters/wp58-turn-delta-audit.spec.ts`    | **改**       | 输入形状迁移到 `kernelEvents` 明细；命中词断言改为按输入明细校验；新增 3 例（规则轨命中词落库 / 模型轨空数组 + 零 delta / 门面兜底路径）                                                                                                                                                                                                                                                                             |
| `test/engine-adapters/model-event-classifier.spec.ts`   | **改**       | `sideLabels` 断言改 `coreKinds` 口径；`CORE_EVENT_KINDS` 11 → 13                                                                                                                                                                                                                                                                                                                                                     |
| `test/engine-adapters/wp60-delta-table-config.spec.ts`  | **改**       | `envKeys` 改穷尽 `string \| undefined`；新增「两类新 kind 刻意没有 env 通道」断言                                                                                                                                                                                                                                                                                                                                    |
| `test/engine-adapters/wp63-deliberation-schema.spec.ts` | **改**       | 内核枚举基线 +2；规则对齐组断言按 D-2 决定收窄；新增显式断言                                                                                                                                                                                                                                                                                                                                                         |
| `test/engine-core/wp60-delta-table-config.spec.ts`      | **改**       | 端口穷举清单 11 → 13                                                                                                                                                                                                                                                                                                                                                                                                 |
| `test/engine-core/wp5-rendering.spec.ts`                | **改**       | 出参字段登记表 +1（`eventDetails`）                                                                                                                                                                                                                                                                                                                                                                                  |
| `test/admin-debug/wp38-debug-event-tags.spec.ts`        | **改**       | 标签数 11 → 13 + 两条中文标签断言                                                                                                                                                                                                                                                                                                                                                                                    |
| `test/auto-practice/wp-k-metric-dictionary.spec.ts`     | **改**       | 标题 + 版本断言 + 新增 2 例                                                                                                                                                                                                                                                                                                                                                                                          |
| `test/quality/d1-event-classifier-evidence.spec.ts`     | **复用未改** | D-1 的 39 例规则轨零回归锚，**一字未动**                                                                                                                                                                                                                                                                                                                                                                             |

---

## 4. §7 闸门实测（10 项全过）

> 命令均为 `pnpm exec ...` / `pnpm lint` / `pnpm test`（**未用裸 npx**）；工作目录 `E:\Work\Project\backend\mofang-nestjs`；PowerShell 5.1；PATH 补 `D:\Apps\Git\cmd`。

| 闸门                  | 命令                                                                      | exit code | 真实结果                                                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GATE1 类型（build）   | `pnpm exec tsc -p tsconfig.build.json --noEmit`                           | **0**     | 0 错                                                                                                                                                                                       |
| GATE2 类型（含 spec） | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`   | **2**     | `TOTAL_ERRORS=401` / `AFFECTED_FILES=87` —— 与 **HEAD `2bf32f0` 实测基线逐字一致**，**本单相关文件 0 error**                                                                               |
| GATE3 Lint            | `pnpm lint`                                                               | **0**     | **0 error / 0 warning**                                                                                                                                                                    |
| GATE4 边界护栏        | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                  | **0**     | **12 例全绿**（本单未改该文件；断言⑥⑦ 未触发）                                                                                                                                             |
| GATE5 定向测试        | `pnpm exec vitest run test/quality test/engine-core test/engine-adapters` | **0**     | **101 文件 / 1866 例全绿**，Duration **27.92s**（基线 100 / 1839 → **+1 文件 / +27 例**）                                                                                                  |
| GATE6 全量            | `pnpm test`                                                               | **0**     | **191 passed + 1 skipped（192 文件）/ 3201 passed + 4 skipped（3205 例）**，Duration **81.10s**，**墙钟 83.33s**（基线 190+1 / 191 文件、3171+4 / 3175 例、73.08s → **+1 文件 / +30 例**） |
| GATE7 core 变更面     | `git diff --stat HEAD -- src/engine-core`                                 | **0**     | **恰好 4 个既有文件**（+44 / −5），与例外批准表**逐条对应**；无新增 core 文件 / 具名导出                                                                                                   |
| GATE8 adapter 变更面  | `git diff --stat HEAD -- src/engine-adapters`                             | **0**     | **7 个既有文件**（+110 / −68），全在 §3.1 B / C 清单内                                                                                                                                     |
| GATE9 前端变更面      | `git diff --stat HEAD -- src/admin-dashboard`                             | **0**     | **空**                                                                                                                                                                                     |
| GATE10 隐私自检       | 人工过一遍新增文件 / spec / 观测样本                                      | —         | 见 §7                                                                                                                                                                                      |

### 4.1 类型债基线的测法（可复算）

任务单沿用的「86 文件 396 条」是 D-1 记录时的数；HEAD 已推进到 `2bf32f0`，基线本身漂了。本单**重新测了一次**：

```powershell
# 现场对比法: 暂存本单改动 → 量 HEAD 基线 → 恢复
$cur  = @(pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals" 2>&1 | Select-String -Pattern 'error TS' | ForEach-Object { $_.Line })
git stash push -m 'd2-baseline-measure' | Out-Null
$base = @(pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals" 2>&1 | Select-String -Pattern 'error TS' | ForEach-Object { $_.Line })
git stash pop | Out-Null
```

> 逐文件差分结果：**HEAD `2bf32f0` 基线 = 401 条 / 87 文件**；本单交付态 = 401 条 / 87 文件 → **逐字回到基线**。
> 测量过程中 `git stash` 只暂存**已跟踪**文件的改动，未跟踪文件（新 spec）全程留在工作区，未被误清。

### 4.2 机器状态（实测）

| 项       | 值                                                    |
| -------- | ----------------------------------------------------- |
| Node     | **v26.13.0**                                          |
| pnpm     | **9.15.0**                                            |
| CPU 核数 | 8                                                     |
| 内存     | 15.9 GB 总 / 5.8 GB 空闲                              |
| 常驻进程 | 2 个 node（**77.4 MB / 34.1 MB**），**无 watch 模式** |
| OS       | Windows 11 Home China 10.0.26300 / PowerShell 5.1     |

---

## 5. §6 风险逐条处置确认

| 风险   | 内容                                                     | 本单处置                                                                                                                                                                                                                                                                                                                | 证据                                                                     |
| ------ | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **T1** | 穷尽 Record 漏补 = 静默漂移                              | 三处穷尽 Record（`DELTA_TABLE` / `COUNSELOR_EVENT_LABELS` / `CORE_EVENT_KIND_TABLE`）由**编译期穷尽性**逼补；新增 spec 断言三处**运行时**键集合完全一致                                                                                                                                                                 | spec ①；GATE1/GATE2 通过                                                 |
| **T2** | 回归口径漂移（事件扩展影响分类输出 / 审计统计 / 回放）   | 种子 ZERO + 旧 kind 表行数值**逐字不动**；**但** `stateTransition` 配置指纹段**会变**（`state-transition.ts` 内容变了 → 哈希变）→ 跨批次比较会报「配置变了」，这是**正确归因**；指标字典版本 `dict-v3`；旧快照缺 4 个新键 → 回归判定器对事件指标（`direction` 为 neutral）本就跳过 + 缺值 `continue` → **不会误判回归** | §4.1；`regression-evaluator.ts` 判定逻辑；`config-fingerprint.ts` 段定义 |
| **T3** | 幅度叠加（I-08 仍待批次复验）                            | **种子 ZERO 隔离**：两类临床幅度**不进** core 基础表，只在注释与本记录里登记为**标定批次候选**；I-08 复验与新 kind 标定**分开排期**                                                                                                                                                                                     | `state-transition.ts` 注释；本记录 §8                                    |
| **T4** | 隐私：`eventDetails` 被误解为可落原话                    | `eventDetails` 只带 **kind + 命中词 + 强度**；命中词是**词表命中词 / 正则原文**，不是话；模型轨为空数组；**不新增原文落库面**；审计端口**仍无 `userText`**                                                                                                                                                              | §7 自检；spec ⑤                                                          |
| **T5** | 映射回退被破坏                                           | `mapModelLabels` 三条口径**逐字不变**（未知标签丢弃 / 去重保序 / 全丢 → null）；spec ③ 覆盖                                                                                                                                                                                                                             | spec ③                                                                   |
| **T6** | 审议口径：两类被误纳入规则对齐组                         | `DELIBERATION_RULE_ALIGNED_TAGS` **一字未动** + 注释写明三条理由；wp63 spec **新增显式断言**钉住这个决定                                                                                                                                                                                                                | `deliberation-types.ts`；wp63 spec                                       |
| **T7** | 中间态误读（cold 场 BDI 仍零变化，被误判为「拆分无效」） | 本单落地的是**事件模型 + 审计词明细**；**临床行为改善留 `llm_active` 接线独立单 + 标定批次**。附 shadow 下快照**逐字不变**的证据（spec ⑥）                                                                                                                                                                              | spec ⑥；本记录 §6                                                        |
| **T8** | 出参契约破坏                                             | `eventDetails` **可选**、旧 `events` **保留**；adapter / 前端读旧字段路径不变；wp5 的出参字段登记表按**既有格式**（WP38 / WP65 已留位）登记 +1                                                                                                                                                                          | wp5 spec；spec ④                                                         |

---

## 6. 中间态形态证据（shadow 下逐字不变）

| 证据                                     | 内容                                                                                                                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 模型轨 shadow 下内核拿到的仍是规则轨结果 | 模型判 `holding_present` → `output.events` 仍为 `empathy`，模型结果只进旁路观测（`modelKinds` = `holding_present`，`agreement` = false） |
| 判出两类新 kind 时 BDI 快照逐字不变      | 种子 ZERO → 判 `holding_present` 的那轮，快照与判 `neutral` 的那轮**逐字相同**                                                           |
| 两类新 kind 的 delta 逐维为零            | `aggregateTurnDelta` 对两类返回 11 维全零，与 `neutral` **逐字相同**                                                                     |
| `llm_active` 分支**未接线**              | 分类器里 `llm_active` 分支（D-1 既有代码）本单**未动**；装配仍**不注入**模型轨到生效路径 → 该分支本单**走不到**                          |
| 规则轨**产不出**两类新 kind              | 规则轨词表**不扩**（`event-lexicon.ts` **一字未动**）；spec ⑦ 用多组样本证伪                                                             |

> **读法提醒**：本单交付后，cold 场的 BDI **仍然零变化** —— 这是**预期**，不是「拆分无效」。事件模型已就位（能表达、能观测、能审计词明细），但**驱动 delta 的那一棒（临床幅度 + 生效轨）还没接**。

---

## 7. 审计词明细口径与隐私自检

### 7.1 口径

| 项                 | 口径                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------- |
| 事件来源           | **只认内核**（C3 不变）：审计不再自己跑分类器                                           |
| 命中词来源         | **内核出参 `eventDetails`** —— 审计**不重跑分类器**、**不造词**                         |
| 模型轨事件的命中词 | **空数组**（模型轨不产词表命中；空数组 = 「没有词表证据」）                             |
| `strength`         | 取明细值，缺省 **1**                                                                    |
| 落库结构           | **不变**（`eventKinds` / `eventDetails` / `rawDelta` 三列 JSON 本就含三键），**零 DDL** |
| 读侧形状           | **不变**（`TurnDeltaAuditEventDetail` 不动）                                            |

### 7.2 隐私自检结论

| 检查项                            | 结论                                                             |
| --------------------------------- | ---------------------------------------------------------------- |
| `eventDetails` 里有没有咨询师原话 | **没有** —— 只有 kind + 命中词 + 强度                            |
| 命中词是不是原话                  | **不是** —— 是词表命中词 / 正则原文（如 `听起来你`），不是整句   |
| 模型轨事件的命中词                | **空数组**，不补造                                               |
| 审计层有没有原文                  | **没有** —— 端口仍**无 `userText`**（D-1 的 C3 收窄未回退）      |
| 审议输入有没有新增原文面          | **没有** —— 审议 `kernelEvents` / 观测 `events` 仍只取 kind 数组 |
| 新增日志 / 观测字段               | **无** —— 本单不新增任何 env 键、不新增任何日志面                |
| 批次快照                          | 新增 4 个**纯数值**事件指标（count / rate），**不含任何文本**    |
| 调试面板展示名                    | 只有两个**事件类别名**（稳定在场 / 冷漠缺席），非心理内容        |

---

## 8. 遗留项

| #    | 遗留                                                                                                                                                                 | 归属                                                                                                                    |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| L-1  | **两类事件的临床 delta 方向 / 幅度 / 权重斜率**（草案候选：`holding_present` safety +0.002 / bond +0.001；`cold_absent` trust −0.002 —— **只登记为候选，未进代码**） | **标定批次**（经 `DeltaTableConfig.deltas` 覆写）                                                                       |
| L-2  | **缺席连续轮数阈值**                                                                                                                                                 | **标定批次**                                                                                                            |
| L-3  | `holding_present` 是否进 `POSITIVE_EVENTS`                                                                                                                           | **标定批次**（本单默认**不纳入**，理由见注释）                                                                          |
| L-4  | **两类新 kind 的 env 覆写通道**（`ENGINE_DELTA_HOLDING_PRESENT` / `ENGINE_DELTA_COLD_ABSENT`）本单**未开**                                                           | 标定批次那一单扩 `src/engine-adapters/wiring/delta-table.config.ts` 的两个字面量读取（本单 §3.2 明确「不新增 env 键」） |
| L-5  | **`llm_active` 生效轨接线** + 模型轨结果进 `aggregateTurnDelta` 生效路径                                                                                             | **独立单**（含每轮 LLM 往返、成本 / 429 / 熔断评估）                                                                    |
| L-6  | 规则轨词表是否补「在场标记」条目                                                                                                                                     | **标定批次 / 独立单**（本单**不扩**）                                                                                   |
| L-7  | 前端看板展示映射仍是 11 类（`admin-dashboard/src/components/batchRegressionMeta.ts`）→ 新 kind 在看板里显示为英文原值                                                | 本单**不碰前端**；前端那一单补                                                                                          |
| L-8  | `hasNonNeutralEvent`（I-22 zero_motion 语义）：两类新 kind 判为「非 neutral」→ 生效轨接线后会影响「合理封闭 vs 纯 neutral 空转」的判定                               | **L-5 生效轨单**（此刻两类恒为 0，无实际影响）                                                                          |
| L-9  | 时序 / 节奏权重端口                                                                                                                                                  | **D-3**（本单不涉及）                                                                                                   |
| L-10 | cold 模式先验                                                                                                                                                        | D-4：DOC-2 结论为不建议单独实施，本单**不复议**                                                                         |

---

## 9. 提交分组与 commit message

### 9.1 提交分组隔离

本单文件**不与并行产物混入**。建议单独成一个提交，提交前确认：

- `git status --short` 中只有本单的改动路径 + 新增 spec + 任务单归档；
- `src/engine-core` 的 diff **恰好 4 个文件**，与例外批准表**逐条对应**；
- `src/admin-dashboard` 的 diff **为空**。

### 9.2 commit message 草稿

```text
feat(wp-d2): 事件类型拆分落地（holding_present / cold_absent 进 core 联合 + 种子 ZERO + 审计恢复词明细）
```

> 备选（更短）：`feat(wp-d2): D-2 事件类型拆分（两类在场状态事件进 core 联合，种子 ZERO，审计恢复命中词）`
>
> **不自动 commit / 不 push**（红线），请手动提交。

### 9.3 本单文档产出

| 文档       | 去向                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 本交付记录 | `docs/worklog/completed/phase2.5/phase2.5-d2-event-kind-split-implementation-2026-11-12.md`                                    |
| 任务单     | `docs/worklog/completed/phase2.5/phase2.5-d2-event-kind-split-implementation-task-2026-11-12.md`（状态行改 ✅ 并链本交付记录） |
| 台账回写   | `docs/worklog/pending/phase2.5-p1d-known-issues-2026-11-11.md`（I-18 / I-10 / I-08 备注 + §7.5）                               |
| 结构债回写 | `docs/worklog/pending/phase2.5-engine-core-structural-debt-assessment-2026-11-12.md`（§4.2 S-2 进度 + §9 D-2 表行）            |
| 活清单回写 | `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md`（§四 独立单表）                                                          |
| 总览回写   | `docs/worklog/pending/phase2.5-README.md`（§3 当前有什么活）                                                                   |

---

> 交付记录写完时间：2026-11-12。工作区**未 commit / 未 push**。
