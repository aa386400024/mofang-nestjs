# Relay Response · D-2 事件类型拆分（holding_present / cold_absent）· 真实完成时间 2026-11-13 00:18

> 执行方：MiniMax Code · 仓库 `E:\Work\Project\backend\mofang-nestjs` · 分支 `integrate` · 基线 HEAD `2bf32f0`
> 任务单（已归档，状态行 ✅）：`docs/worklog/completed/phase2.5/phase2.5-d2-event-kind-split-implementation-task-2026-11-12.md`
> 交付记录：`docs/worklog/completed/phase2.5/phase2.5-d2-event-kind-split-implementation-2026-11-12.md`
> 命名说明：指令指定文件名 `relay-response-20261112-<HHMM>.md`，HHMM 取实际完成时间 `0018` → 本文件即 `relay-response-20261112-0018.md`；**真实墙钟完成时间为 2026-11-13 00:18**（会话跨过午夜），文件名日期段沿用指令字面，两者不矛盾。

## 结论

**D-2 事件类型拆分已落地，§7 十项闸门全绿，工作区未 commit / 未 push。**

两类「在场状态」事件（`holding_present` 稳定在场 / `cold_absent` 冷漠缺席）正式进 core 联合（11 → 13 类）与 `DELTA_TABLE`（两行种子 = `ZERO`）；旁路标签层 `sideLabels` 整体取消，模型轨映射收敛为「只有 core kind」；审计层恢复词表命中明细（D-1 期间「matchedTerms 恒空」的已知代价解除）；**不接 `llm_active`**，规则轨词表不扩，临床方向与幅度全部留标定批次。

一句话读法：**事件模型已就位（能表达、能观测、能审计命中词），但驱动 delta 的那一棒（临床幅度 + 生效轨）还没接 —— cold 场 BDI 仍然零变化，这是预期，不是「拆分无效」。**

## 红线逐条守

| 红线                                         | 落地                                                                                                                                |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| core 仅例外改 4 个既有文件                   | ✅ `git diff --stat HEAD -- src/engine-core` = **恰好 4 文件 / +44 / −5**，与例外批准表逐条对应；`boundary.spec.ts` 未改，12 例全绿 |
| 不新增 core 文件 / 不新增具名导出            | ✅ 无新增文件；`eventDetails` 复用既有 `SessionEvent` 形状                                                                          |
| 不接 `llm_active`                            | ✅ 装配**不注入**模型轨到生效路径；分类器里 `llm_active` 分支（D-1 既有代码）**未动**，本单走不到                                   |
| 两类新 kind 种子 = `ZERO`                    | ✅ `DELTA_TABLE` 两行均为 `ZERO`，与 `neutral` 的 11 维 delta **逐字相同**                                                          |
| 规则轨词表不扩                               | ✅ `src/engine-core/domain/events/event-lexicon.ts` **一字未动**；新 spec 第 ⑦ 组用多组样本证伪「规则轨产不出两类新 kind」          |
| `DELIBERATION_RULE_ALIGNED_TAGS` 一字不动    | ✅ 数组未动；补注释写明两类刻意不纳入的三条理由；wp63 spec 新增显式断言钉住该决定                                                   |
| `neutral` 保留作兜底第三类                   | ✅ neutral 判定改 `coreKinds.every(k => k === 'neutral')`                                                                           |
| `strength` 恒 1                              | ✅ 置信度只进观测；审计明细 `strength` 取内核值、缺省 1                                                                             |
| 回落逐字等价规则轨                           | ✅ D-1 既有回落路径未动                                                                                                             |
| 跨轮分桶键用业务 `sessionId`                 | ✅ 未动，禁用 `handleId`                                                                                                            |
| 不新增 env 键                                | ✅ `src/engine-adapters/wiring/delta-table.config.ts` 未动；两类新 kind **刻意不开 env 覆写通道**                                   |
| 不改审计实体 JSON 列结构 / 不接 DB migration | ✅ 零 DDL；落库仍是 `eventKinds` / `eventDetails` / `rawDelta` 三列 JSON                                                            |
| 不跑批次 / 不调真模型                        | ✅ 全程离线，测试用 stub                                                                                                            |
| 不碰前端 `admin-dashboard`                   | ✅ `git diff --stat HEAD -- src/admin-dashboard` = **空**                                                                           |
| 观测 / 审计禁含咨询师原话                    | ✅ 端口仍**无 `userText`**；`matchedTerms` 只装词表命中词；模型轨事件命中词为**空数组**（不造词）                                   |
| pnpm 禁裸 npx                                | ✅ 全部走 `pnpm exec` / `pnpm lint` / `pnpm test`                                                                                   |
| 不自动 commit / push                         | ✅ 未 commit、未 push，只给 commit message 草稿                                                                                     |

## 闸门实测（10/10 过）

| 闸门                  | 命令                                                                      | exit | 真实结果                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GATE1 类型（build）   | `pnpm exec tsc -p tsconfig.build.json --noEmit`                           | 0    | 0 错                                                                                                                                                                                   |
| GATE2 类型（含 spec） | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`   | 2    | **401 错 / 87 文件**，与 HEAD `2bf32f0` **实测基线逐字一致**；本单相关文件 **0 error**                                                                                                 |
| GATE3 Lint            | `pnpm lint`                                                               | 0    | **0 error / 0 warning**                                                                                                                                                                |
| GATE4 边界护栏        | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                  | 0    | **12 例全绿**（本单未改该文件；断言⑥⑦ 未触发）                                                                                                                                         |
| GATE5 定向测试        | `pnpm exec vitest run test/quality test/engine-core test/engine-adapters` | 0    | **101 文件 / 1866 例全绿**，Duration **27.92s**（基线 100 / 1839 → +1 文件 / +27 例）                                                                                                  |
| GATE6 全量            | `pnpm test`                                                               | 0    | **191 passed + 1 skipped（192 文件）/ 3201 passed + 4 skipped（3205 例）**，Duration **81.10s**，**墙钟 83.33s**（基线 190+1 / 191 文件、3171+4 / 3175 例、73.08s → +1 文件 / +30 例） |
| GATE7 core 变更面     | `git diff --stat HEAD -- src/engine-core`                                 | 0    | **恰好 4 个既有文件**（+44 / −5）                                                                                                                                                      |
| GATE8 adapter 变更面  | `git diff --stat HEAD -- src/engine-adapters`                             | 0    | **7 个既有文件**（+110 / −68），全在清单内                                                                                                                                             |
| GATE9 前端变更面      | `git diff --stat HEAD -- src/admin-dashboard`                             | 0    | **空**                                                                                                                                                                                 |
| GATE10 隐私自检       | 人工过新增文件 / spec / 观测样本                                          | —    | 见交付记录 §7.2                                                                                                                                                                        |

机器状态（实测）：Node **v26.13.0** / pnpm **9.15.0** / 8 核 / 15.9 GB 总、5.8 GB 空闲 / 2 个 node 常驻（77.4 MB / 34.1 MB，无 watch）/ Windows 11 Home China 10.0.26300 / PowerShell 5.1。

> GATE2 的 401/87 是**现场重测**的基线：任务单沿用的「86 文件 / 396 条」已过期（那是 D-1 记录时的数，HEAD 已推进到 `2bf32f0`）。测法用 `git stash` 对比法，可复算命令写在交付记录 §4.1；`git stash` 只暂存已跟踪文件，未跟踪的新 spec 全程留在工作区未被误清。

## 改动面（26 改 + 3 新 = 29 条，写本回执前的 `git status --short` 实测）

| 分层                  | 文件                                                                                                                                                                                                     | 规模                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| core 纯层（例外批准） | `session-event.ts` / `state-transition.ts` / `engine-session.types.ts` / `in-memory-engine-session.ts`                                                                                                   | **4 文件 / +44 / −5**   |
| adapter               | `model-event-mapping.ts` / `model-event-classifier.ts` / `deliberation-types.ts` / `turn-render-orchestrator.ts` / `engine-turn.service.ts` / `turn-delta-audit.port.ts` / `turn-delta-audit.service.ts` | **7 文件 / +110 / −68** |
| 业务层与脚本          | `event-tag-labels.ts` / `metric-dictionary.ts` / `d1-event-classifier-evidence.lexicon.ts`                                                                                                               | **3 文件 / +35 / −7**   |
| 测试                  | 新增 `test/engine-adapters/d2-event-kind-split.spec.ts`（**22 例 / 七组**）+ 改 8 份既有 spec                                                                                                            | +1 新 / 8 改            |
| 文档                  | 交付记录 + 任务单（归档）                                                                                                                                                                                | +2 新                   |
| 回写                  | 台账 / 结构债草案 / 活清单 / 总览                                                                                                                                                                        | 4 改                    |

核心设计要点：

- **core 出参新增可选 `eventDetails`**（复用 `SessionEvent` 形状）→ 审计因此能记回**内核自己算出的命中词**，不重跑分类器（C3 口径不变）、不造词（模型轨事件命中词 = 空数组）。
- **`DELTA_TABLE` 两行 = `ZERO`**：临床方向与幅度不进基础表；草案候选值（`holding_present` safety +0.002 / bond +0.001；`cold_absent` trust −0.002）**只登记为标定批次候选**。
- **旁路标签层取消**：`MODEL_SIDE_LABELS` / `ModelSideLabel` 删除，`ModelEventLabel = CounselorEventKind`；`mapModelLabels` 三条口径（未知丢弃 / 去重保序 / 全丢 → null）逐字不变。
- **三处穷尽 Record 编译期兜底**：`DELTA_TABLE` / `COUNSELOR_EVENT_LABELS` / `CORE_EVENT_KIND_TABLE` 键集合一致，新增 spec 同时做运行时断言。

## 已登记偏差（8 条结构性 + 6 条工程取舍，详见交付记录 §2）

1. **类型债基线重测**：任务单的 396/86 已过期，HEAD `2bf32f0` 实测 = **401 条 / 87 文件**，本单交付态逐字回基线。
2. **指标字典版本 `dict-v2` → `dict-v3`**（任务单未提）：`TRACKED_EVENTS` 加两项 → 字典新增 4 个 id；两份内容不同的字典共用同一版本号 = 前端缓存不失效 + 审计看不出字典换过。按 Phase3 P0 加指标时 `dict-v1 → dict-v2` 的同款既有约定递增。
3. **D-1 零回归锚零改动**：`d1-event-classifier-evidence.spec.ts` **一字未改**；改的是它依赖的 lexicon（`HUMAN_LABEL_VOCABULARY` 去重展开），去重后词表与 D-1 逐字相同（13 项、顺序不变）→ 39 例仍绿。
4. **6 份既有 spec 被联合扩张逼出连带修改**（wp38 标签数、wp-k 字典版本、wp60 两侧穷举、wp63 枚举基线、wp5 出参登记表等），逐条理由写在交付记录 §2.2。
5. **任务单内部口径不一致 2 处**：§4.2「返回 coreKinds 单数组」vs §3.1-6「保留对象去 sideLabels」→ 取后者（最小改动）；§2 现状章节旧字段名 `kernelEventKinds` vs §4.3 契约章节 `kernelEvents` → 取契约章节。
6. **工程取舍**：`POSITIVE_EVENTS` 默认不纳入 `holding_present`（正事件率口径不混「在场状态」类）；中文展示名用任务单定稿（稳定在场 / 冷漠缺席）；两类新 kind 刻意不开 env 覆写通道（§3.2「不新增 env 键」），改用穷尽 `string | undefined` 的 `envKeys` 保持穷尽性并加断言钉住。

## 已回写（4 处）+ 归档

- 台账 `phase2.5-p1d-known-issues-2026-11-11.md`：I-08 / I-10 / I-18 三行 + 新增 **§7.5**。
- 结构债草案 `phase2.5-engine-core-structural-debt-assessment-2026-11-12.md`：§3 总表 I-18 现状列 + §9.3 D-2 表行 + §4.2 S-2「D-2 进度」块。
- 活清单 `phase2.5-wp-list-2026-11-08.md`：§四 独立单表 +1 行（24 → **25 行**）。
- 总览 `phase2.5-README.md`：§3 当前有什么活 +1 行。
- 任务单已从 `pending/` 移入 `completed/phase2.5/`，状态行改 ✅ 并链交付记录，§8.2 checklist 7 项全勾。

## 遗留（10 条）

| #    | 遗留                                                                                                                | 归属                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| L-1  | 两类事件的临床 delta 方向 / 幅度 / 权重斜率（草案候选只登记、未进代码）                                             | 标定批次                                   |
| L-2  | 缺席连续轮数阈值                                                                                                    | 标定批次                                   |
| L-3  | `holding_present` 是否进 `POSITIVE_EVENTS`（本单默认不纳入）                                                        | 标定批次                                   |
| L-4  | 两类新 kind 的 env 覆写通道（本单刻意未开）                                                                         | 标定批次那一单                             |
| L-5  | `llm_active` 生效轨接线 + 模型轨结果进 `aggregateTurnDelta` 生效路径                                                | 独立单                                     |
| L-6  | 规则轨词表是否补「在场标记」条目（本单不扩）                                                                        | 标定批次 / 独立单                          |
| L-7  | 前端看板展示映射仍是 11 类（`admin-dashboard/src/components/batchRegressionMeta.ts`）→ 新 kind 在看板显示为英文原值 | 前端那一单（本单不碰前端）                 |
| L-8  | `hasNonNeutralEvent`（I-22 zero_motion 语义）：两类生效后判为「非 neutral」→ 影响 closure/idle 判定                 | L-5 生效轨单（此刻两类恒为 0，无实际影响） |
| L-9  | 时序 / 节奏权重端口                                                                                                 | D-3                                        |
| L-10 | cold 模式先验                                                                                                       | D-4（DOC-2 不建议单独实施，本单不复议）    |

## 提交

```text
feat(wp-d2): 事件类型拆分落地（holding_present / cold_absent 进 core 联合 + 种子 ZERO + 审计恢复词明细）
```

**未 commit / 未 push**，请手动提交。本单文件不与并行产物混入；提交前请确认 `src/engine-core` 的 diff 恰好 4 个文件、`src/admin-dashboard` 的 diff 为空。
