# Relay Response · C5-1 探索指标分层（角色级探索覆盖观测 · I-16 / I-24）· 2026-11-13 08:25

> 执行方：MiniMax Code · 仓库 `E:\Work\Project\backend\mofang-nestjs` · 分支 `integrate` · 基线 HEAD `368da4f`
> 任务单已归档：`docs/worklog/completed/phase2.5/phase2.5-c5-exploration-stratified-metrics-task-2026-11-13.md`（状态行 ✅，§8.2 checklist 7 项全勾）
> 交付记录：`docs/worklog/completed/phase2.5/phase2.5-c5-exploration-coverage-implementation-2026-11-13.md`
> 性质：**评测 / 指标层单**（结构债 C5）—— 纯观测，零门禁变化，零 core 改动

> 命名说明：文件路径按指令指定的 `relay-response-20261113-0825.md`；**实际回复完成时间为 2026-11-13 08:47**（闸门跑完、写完交付记录与四处回写之后）。

## 结论

**批次快照新增角色级探索覆盖指标 `exploration.character_coverage`，§7 十一项闸门全绿，工作区未 commit / 未 push。**

既有 `exploration.rate` 是**场次比例**（含探索的场次 ÷ 纳入场次），回答不了「多少角色完全 0 探索」—— 这正是 I-16 的结构问题（安然一人 100% 探索掩盖其余 7 角色 0 探索）。新指标 = **至少一场含探索策略的角色数 ÷ 本批纳入场次覆盖到的不同角色数**，全局 / byMode / byCharacter 三处**同函数同口径**产出，byCharacter 切片值 ∈ {0, 1}。

**只增不废弃**（旧键 `exploration.rate` 数值口径与 direction 一字未改，两者并存）、**纯观测**（不进判据表 / 健康门禁 / verdict，不新建任何探索阈值）、**零 core 改动**。

## 红线逐条守

| 红线                                                  | 落地                                                                                                                                                                                                                                                           |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 改动仅限 `metrics/` **两个既有文件** + 既有 spec 增补 | ✅ `src/auto-practice/metrics/batch-metrics.compute.ts`（+27）、`metric-dictionary.ts`（+28/−1）+ `wp-k-batch-compute.spec.ts`（+94）、`wp-k-metric-dictionary.spec.ts`（+41/−1）；`git diff --stat HEAD` = **恰好 4 文件 / +183 / −7**，**零新增 `.ts` 文件** |
| `src/engine-core` 变更面**必须为空**                  | ✅ `git diff --stat HEAD -- src/engine-core` = **空**                                                                                                                                                                                                          |
| `src/admin-dashboard` 变更面**必须为空**              | ✅ `git diff --stat HEAD -- src/admin-dashboard` = **空**                                                                                                                                                                                                      |
| 新指标**不进判据表 / 不进健康门禁 / 不参与 verdict**  | ✅ 判据表与健康门禁两个文件 diff = **空**；新指标 direction `neutral` → 跨批回归判定器**整条跳过**                                                                                                                                                             |
| **不新建任何探索阈值**                                | ✅ 零阈值代码；`acceptance-thresholds.ts` / `practice-batch-health.service.ts` 一字未动                                                                                                                                                                        |
| **不改 `exploration.rate` 旧键口径**（只增新键）      | ✅ 数值口径与 direction（场次比例 / `higher_is_better`）一字未改；只在 definition **追加**档位标注                                                                                                                                                             |
| 不加 DB 列 / 实体字段 / migration；不引入轮档字段     | ✅ 零 DDL、零实体改动；轮档适用性只写进字典 definition 与注释                                                                                                                                                                                                  |
| 不跑批次、不调模型                                    | ✅ 全程离线；测试用手工构造的合规输入                                                                                                                                                                                                                          |
| pnpm，**禁裸 npx**                                    | ✅ 全部走 `pnpm exec` / `pnpm lint` / `pnpm test`                                                                                                                                                                                                              |
| 不自行 commit / push                                  | ✅ 未 commit、未 push，只给 commit message 草稿                                                                                                                                                                                                                |

## 闸门实测（11/11 过）

| 闸门            | 命令                                                                                                                            | exit | 真实结果                                                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 类型（build）   | `pnpm exec tsc -p tsconfig.build.json --noEmit`                                                                                 | 0    | 0 错                                                                                                                                                   |
| 类型（含 spec） | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`                                                         | 2    | **401 错 / 87 文件**，与 HEAD `368da4f` **实测基线逐字一致**（stash 差分法现场重测），本单相关 **0 错**                                                |
| Lint            | `pnpm lint`                                                                                                                     | 0    | **0 error / 0 warning**                                                                                                                                |
| 定向测试        | `pnpm exec vitest run test/auto-practice test/quality test/engine-core test/engine-adapters`                                    | 0    | **121 文件 / 2187 例**，Duration 46.26s（基线 121/2176 → **+11 例**）                                                                                  |
| 全量            | `pnpm test`                                                                                                                     | 0    | **192 passed + 1 skipped（193 文件）/ 3227 passed + 4 skipped（3231 例）**，Duration **86.57s**、**墙钟 88.99s**（基线 3216+4 / 3220 例 → **+11 例**） |
| 边界护栏        | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                                                                        | 0    | **12 例全绿**                                                                                                                                          |
| core 变更面     | `git diff --stat HEAD -- src/engine-core`                                                                                       | 0    | **空**                                                                                                                                                 |
| 前端变更面      | `git diff --stat HEAD -- src/admin-dashboard`                                                                                   | 0    | **空**                                                                                                                                                 |
| 门禁文件变更面  | `git diff --stat HEAD -- src/auto-practice/metrics/acceptance-thresholds.ts src/auto-practice/practice-batch-health.service.ts` | 0    | **空**                                                                                                                                                 |
| 改动文件清单    | `git diff --stat HEAD`                                                                                                          | 0    | **恰好 4 文件**（2 源码 + 2 spec），+183/−7                                                                                                            |
| 隐私自检        | 新增 spec / 注释人工过一遍                                                                                                      | —    | 只消费 `characterSlug` 与 `traces[].strategy` 两个合规投影字段；无原话、无 prompt 全文、无 `kernelState`、无展示名                                     |

机器状态：Node **v26.13.0** / pnpm **9.15.0** / 8 核 / 15.9 GB 总 5.0 GB 空闲 / 取样时刻无常驻 node 进程（无 watch）/ Windows 11 Home China 10.0.26300 / PowerShell 5.1。

## 口径示例（固定输入：3 场 / 2 角色 / 2 场含探索）

| 口径                   | 场次数 | 角色数 | `exploration.rate`（场次比例） | `exploration.character_coverage`（角色比例） |
| ---------------------- | ------ | ------ | ------------------------------ | -------------------------------------------- |
| 全局                   | 3      | 2      | **0.666667**（2/3）            | **0.5**（1/2）                               |
| `byMode['expert']`     | 2      | 2      | 0.5                            | 0.5                                          |
| `byMode['cold']`       | 1      | 1      | 1                              | 1                                            |
| `byCharacter['vpt_a']` | 2      | 1      | 1                              | 1                                            |
| `byCharacter['vpt_b']` | 1      | 1      | 0                              | 0                                            |

> **全局行两个数不相等** —— 这正是本单要暴露的结构：总量 2/3 看着不低，但只有 **1/2 的角色**有过探索。`byCharacter` 两行是 0/1 二值（单角色切片退化的必然语义）。

## 已登记偏差（5 条）

1. **指标字典版本递增 `dict-v3` → `dict-v4`**（任务单未提）：字典内容变了（新增 1 个指标 + `exploration.rate` 补档位标注），按仓库既有纪律「**版本必须跟着字典内容走**」递增 —— 两份内容不同的字典共用同一版本号 = 前端缓存不失效 + 审计比对看不出字典换过（Phase3 P0、D-2 已是同款约定）。连带改字典 spec 两处版本断言；**前端零改动**（`metricCatalog.ts` 运行时从 `/metrics/catalog` 拉目录，无本地版本常量）。
2. **`exploration.rate` 的档位标注写在 `definition`**（任务单允许「definition 或相邻注释」二选一）：字典是口径单一真相源、前端 tooltip 直接读它；只写注释则只有翻源码的人看得到 → 「字典标注探索属长会话档观测」在 definition 里才成立。**数值口径与 direction 未动**。
3. **切片探索率断言用新增用例**，不改既有用例的 fixture：§7 要求「零丢失 / 零改写」，给既有用例换 fixture 就是改写。
4. **spec 文件选择**：沿用两份既有 spec 增补，**不新建** `c5-exploration-coverage.spec.ts`（硬约束写的是「既有 spec 增补」，且复用既有 helper 不制造第二个真相源）。
5. **新指标逻辑抽成模块私有纯函数** `computeCharacterExplorationCoverage`（任务单允许「纯函数 / 内联循环」）：三处切片复用同一函数，「同函数同口径」由代码结构保证。

## 零回归与兼容性

- **旧快照**：新键只增不删 → 旧快照**没有**这个键；自由键 map 按缺省处理，**「键缺失」≠「值为 0」**；`schemaVersion` 保持 **1**，不回溯重算、不覆盖写。
- **指纹段**：`acceptance` 段挂 `./metrics/acceptance-thresholds`（**本单未改**）→ **不变**；本单改的两个文件不在任何指纹段清单里 → 其余 6 段亦不变。
- **类型债**：401 条 / 87 文件 = HEAD 实测基线**逐字一致**，本单相关 0 错。

## 已回写 + 归档

- 台账 `phase2.5-p1d-known-issues-2026-11-11.md`：I-16 行 + I-16 小节 + I-24 行 + I-24 小节。
- 结构债草案 `phase2.5-engine-core-structural-debt-assessment-2026-11-12.md`：§4 I-16 行（现状列改写）+ §4 I-24 行 + §6 第 1 条。
- 活清单 `phase2.5-README.md`：§3 新增 C5-1 一行。
- intake 验收口径文档 `phase2.5-intake-acceptance-criteria-2026-11-11.md`：§3 探索率表格行 + §3.1 各一条（**不新增 40 轮档判定条款**）。
- 任务单已从 `pending/` 移入 `completed/phase2.5/`，状态行改 ✅ 并链交付记录，§8.2 checklist **7 项全勾**。
- `phase2.5-wp-list-2026-11-08.md` 按任务单口径**不回写**（冻结快照）。

## 遗留

- **前端分组行**（byCharacter）展示切片内探索率 / 覆盖率；列表与趋势图的总量口径标注（甲方案不碰前端）。
- **40 轮档探索判据与阈值标定**（含「探索率 >0」候选条款取值），依赖第二家 provider 与长会话批次样本。
- **角色覆盖率的跨样本可比性**：分母只含跑到的角色 → 不同批次覆盖率不可直接横比（口径已写进 definition）。
- **I-11 core 探索门槛结构复核与可达性对账**（core 另案；S-1 仅完成端口化，未解决可达性）—— 本单**只做观测分层**，不解读为「门槛已修好」。
- **轮档元数据字段**（12 / 24 / 40 档）若未来要按档分派判据。

## 提交

```text
feat(auto-practice): C5-1 探索指标分层 (新增 exploration.character_coverage 角色覆盖口径 + 切片探索率断言; dict-v4)
```

**未 commit / 未 push**，请手动提交。本单文件不与并行产物混入（`data/quality/*.diff` 是 D-2 遗留的未跟踪诊断产物，**不属于本单**）；提交前请确认 `src/engine-core`、`src/admin-dashboard`、判据表与健康门禁四个变更面**全空**。
