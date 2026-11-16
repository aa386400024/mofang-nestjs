# D-1 取证单 · 规则轨事件判定漏判率离线取证 —— 交付回复

> 状态：✅ 已交付（2026-11-12）
> 交付记录：`docs/worklog/completed/phase2.5/phase2.5-d1-event-classifier-evidence-implementation-2026-11-12.md`
> 任务单（已归档）：`docs/worklog/completed/phase2.5/phase2.5-d1-event-classifier-evidence-task-2026-11-12.md`
> 执行方：MiniMax Code　|　仓库 / 分支：`mofang-nestjs` / `integrate`

---

## 1. 一句话总结

把规则轨事件判定的漏判率用**可复算离线口径**钉死：96 份活逐字稿 / 1112 轮逐轮投影 → `neutral` 994 轮 = **89.39%**（误吞上界，Wilson 95% 区间 **[0.8744, 0.9107]**），正向事件率 **0.0989**、负向**词**事件率 **0.0099**；并交付**规则轨基线快照 spec**（39 例，零回归锚）+ 60 条分层抽样清单 + 可回填的标注骨架 CSV。**`git diff --stat HEAD -- src/engine-core` 与 `-- src/engine-adapters` 实测均为空** —— 零 core 改动、零 adapter 改动、零 LLM 调用、零批次重跑、零 DB 写入。

## 2. 改动文件清单

### 2.1 新增（源码**零改动**，全部是新增文件）

| 文件                                                          | 内容                                                                                                                                                                                                                                                                                                                                                                         | 规模   |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `scripts/ops/quality/d1-event-classifier-evidence.lexicon.ts` | **纯逻辑模块**（零 IO / 零 DB / 零网络）：字段白名单投影（禁字段连类型都不声明）、`charBucket` / `segmentOf` / `isNeutralOnly`、连续 neutral 段长、`wilsonInterval`、`bucketize`、`computeRuleTrackBaseline`、`machineCandidateLabel`、`turnKey`、`stratifiedSample`、`computeLabelAgreement`（per-kind precision/recall + 两向漏判 + 误吞分解）、三个 CSV 构造器 + 标注读回 | ~25 KB |
| `scripts/ops/quality/d1-event-classifier-evidence.ts`         | **CLI 编排**：读逐字稿 + 批次血缘 → sha256 口径校验 → 写三个 CSV → 打印比率表 → 可选 `--labels` 读回人工标注重算 precision/recall                                                                                                                                                                                                                                            | ~11 KB |
| `test/quality/d1-event-classifier-evidence.spec.ts`           | 39 例，9 组：① 投影白名单/隐私 ② 降级过滤与基线 ③ precision·recall 与两向漏判 ④ Wilson 区间 ⑤ CSV 契约 ⑥ 分层抽样 ⑦ 机器候选标签 ⑧ 辅助口径 ⑨ **规则轨基线快照**                                                                                                                                                                                                             | ~21 KB |

### 2.2 新增（离线数据文件，**不入 DB**）

| 文件                                                 | 行数        | 表头                                                                                                                                                                     |
| ---------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `data/quality/d1-turn-projection-2026-11-12.csv`     | 1112 + 表头 | `debug_session_id,turn_index,character_slug,counselor_mode_id,event_tags,degraded,crisis,char_bucket,segment,neutral_run_length,machine_candidate`                       |
| `data/quality/d1-sample-list-2026-11-12.csv`         | 60 + 表头   | `sample_index,stratum,debug_session_id,turn_index,character_slug,counselor_mode_id,segment,char_bucket,neutral_run_length,event_tags,degraded,machine_candidate`         |
| `data/quality/d1-annotation-skeleton-2026-11-12.csv` | 60 + 表头   | `debug_session_id,turn_index,character_slug,counselor_mode_id,event_tags,degraded,machine_candidate,human_label,note`（`human_label` **留空**、`note = 候选待主控复核`） |

### 2.3 文档

- 新增交付记录 `docs/worklog/completed/phase2.5/phase2.5-d1-event-classifier-evidence-implementation-2026-11-12.md`。
- 开工单 `docs/worklog/pending/phase2.5-d1-event-classifier-evidence-task-2026-11-12.md` → **已移入** `docs/worklog/completed/phase2.5/phase2.5-d1-event-classifier-evidence-task-2026-11-12.md`，状态行改 `✅ 已交付` 并链接交付记录（pending 原件已删除，可从回收站恢复）。
- 改：台账 `phase2.5-p1d-known-issues-2026-11-11.md`（§1 总表 I-01 / I-02 / I-18 三行 + §2 逐条详述三段）、结构债草案 `phase2.5-engine-core-structural-debt-assessment-2026-11-12.md`（§3 总表 I-01 / I-02 / I-18 三行现状列 + §4.2 D-1 进度块 + §4.2 附带登记 G-4 + §6 第 3 步 + §9.3 D-1 行）、`phase2.5-wp-list-2026-11-08.md` §四 独立单、`phase2.5-README.md` §3 活清单。

### 2.4 明确未改

- `src/**`（`engine-core` / `engine-adapters` / 业务层）—— **零改动**（三处 `git diff --stat HEAD -- src/...` 实测全空）。
- `test/engine-core/boundary.spec.ts` —— 未改；断言⑥ / ⑦ 绿（12 例全过）。
- env / `.env.example` / module 装配 / migration / DB schema / prompt / 前端 / Flutter —— 未碰。
- **未新增任何 core 公开导出、未新增 core `.ts` 文件**（`EVENT_LEXICON` 只是被**读取**，公开面不变）。
- 未跑批次、未调 LLM、未连 DB、未 commit / push。

## 3. 闸门（真实命令 / exit code / 真实数字）

> 跑前：PATH 补 `D:/Apps/Git/cmd`（避免 vitest 内部调 git ENOENT 假失败）；全程 pnpm，**未用裸 npx**。

| #   | 闸门              | 命令                                                                                 | exit  | 数字                                                                                                                       |
| --- | ----------------- | ------------------------------------------------------------------------------------ | ----- | -------------------------------------------------------------------------------------------------------------------------- |
| 0   | **开工基线**      | `pnpm exec vitest run test/engine-core test/engine-adapters`                         | 0     | Test Files **91 passed (91)**；Tests **1643 passed (1643)**；Duration 35.63s                                               |
| 1   | 类型（src）       | `pnpm exec tsc -p tsconfig.build.json --noEmit`                                      | **0** | **0 error**                                                                                                                |
| 2   | 类型（含 spec）   | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`              | 2     | 全量 **396 条既有债**（与 S-1 交付时同量，全部在本单未触碰的文件里）；**本单相关文件错误 = 0**                             |
| 3   | Lint              | `pnpm lint`                                                                          | **0** | **0 error / 0 warning**；另跑 `pnpm exec eslint --fix` 于本单 3 文件（exit 0）                                             |
| 4   | 定向测试          | `pnpm exec vitest run test/quality test/engine-core test/engine-adapters`            | **0** | Test Files **99 passed (99)**；Tests **1779 passed (1779)**；failed 0 / skipped 0；Duration 38.16s                         |
| 4b  | test/quality 单档 | `pnpm exec vitest run test/quality`                                                  | **0** | Test Files **8 passed (8)**；Tests **136 passed (136)**；Duration 3.71s（本单新 spec = 1 文件 / 39 例）                    |
| 5   | 边界护栏          | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                             | **0** | Test Files 1 passed (1)；Tests **12 passed (12)**；Duration 1.62s                                                          |
| 6   | 全量              | `pnpm test`                                                                          | **0** | Test Files **189 passed \| 1 skipped (190)**；Tests **3111 passed \| 4 skipped (3115)**；failed **0**；Duration 82.70s     |
| 7   | core 变更面       | `git diff --stat HEAD -- src/engine-core`                                            | 0     | **空**                                                                                                                     |
| 8   | adapter 变更面    | `git diff --stat HEAD -- src/engine-adapters`                                        | 0     | **空**                                                                                                                     |
| 9   | src 其余变更面    | `git diff --stat HEAD -- src`                                                        | 0     | **空**                                                                                                                     |
| 10  | 取证 CLI          | `pnpm exec tsx scripts/ops/quality/d1-event-classifier-evidence.ts --sample-size 60` | **0** | 96 份 / 1112 轮 / 解析失败 0 / 降级轮 0 / 血缘一致 96                                                                      |
| 11  | 隐私自检          | 双向子串扫描（3 CSV × 96 份逐字稿）                                                  | 0     | 原文命中 **0**、展示名命中 **0**、`renderSpec` / `kernelState` / `promptFull` / `promptPreview` / `title` 关键字命中 **0** |

**机器状态**：Windows 11 Home China 10.0.26300 64-bit；Intel Core i7-8550U @ 1.80GHz；8 逻辑核；15.9 GB RAM（空闲 6.2 GB）；Node v26.13.0；pnpm 9.15.0；PowerShell 5.1.26100.9818。

**零回归对比**：S-1 交付后全量基线 = 189 文件（188 passed + 1 skipped）/ 3072 passed + 4 skipped（3076）；本单交付后 = **190 文件（189 passed + 1 skipped）/ 3111 passed + 4 skipped（3115）**。差值 **+1 文件 / +39 例**，恰好等于新增 spec 的 39 个 `it` → **零用例被删除 / 改名 / 跳过**，failed 仍为 0，skipped 仍为 4。

## 4. 离线统计结果

### 4.1 样本与口径

| 项                         | 值                                                               |
| -------------------------- | ---------------------------------------------------------------- |
| 逐字稿                     | **96 份**（解析失败 0）· 场次 96 · 轮次 **1112**                 |
| 降级轮（来访者侧渲染降级） | **0** → 有效轮 **1112**                                          |
| 血缘 sha256                | 一致 **96** / 不一致 **0** / 无血缘 **0**                        |
| 事件种类来源               | `metric-dictionary.js` 的 `TRACKED_EVENTS`（11 类，含 neutral）  |
| 正向事件来源               | 同上 `POSITIVE_EVENTS`（5 类）                                   |
| 负向**词**事件来源         | 从 core `EVENT_LEXICON` 派生（4 类，**不含 `sensitive_touch`**） |

### 4.2 事件标签实例计数（占有效轮）

| kind                         | 实例    | 占有效轮   |
| ---------------------------- | ------- | ---------- |
| neutral                      | **994** | **89.39%** |
| empathy                      | 92      | 8.27%      |
| acceptance                   | 14      | 1.26%      |
| sensitive_touch              | 6       | 0.54%      |
| minimizing                   | 5       | 0.45%      |
| preaching                    | 4       | 0.36%      |
| normalization                | 2       | 0.18%      |
| open_probe                   | 2       | 0.18%      |
| judgment                     | 2       | 0.18%      |
| boundary_cross / affirmation | 0       | 0.00%      |

多标签轮 **9** / 零标签轮 **0**。

### 4.3 头号指标

| 指标                               | 值                   | 说明                                                                                           |
| ---------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------- |
| **neutral 误吞上界（比率）**       | **0.8939**           | = neutral 轮 / 有效轮；**不依赖人工标注**，本单唯一可立即确证的头号数字                        |
| **neutral 误吞上界（Wilson 95%）** | **[0.8744, 0.9107]** | 稀有类用区间表达，不做点估计                                                                   |
| 正向事件率                         | **0.0989**           | 110 实例 / 有效轮；分母是**有效轮**（剔降级），与仓库 `event.positive.rate` 分子同构、分母不同 |
| 负向词事件率（4 类）               | **0.0099**           | 11 实例 / 有效轮；**不含 `sensitive_touch`**                                                   |

### 4.4 分层（分母均为有效轮）

**按咨询师模式** —— cold 误吞显著更高，这是「cold 富集抽样」的直接依据：

| 模式   | 有效轮 | neutral | 占比       |
| ------ | ------ | ------- | ---------- |
| cold   | 551    | 530     | **96.19%** |
| expert | 561    | 464     | 82.71%     |

**按轮次段**：head 334/375 = 89.07%；middle 345/375 = 92.00%；tail 315/362 = 87.02%。

**按角色**（8 个，取极值）：`vpt_intimate_avoidance_l1` **95.00%**（最高）/ `vpt_general_secure_l1` **82.14%**（最低），其余 87.50% ~ 90.91%。

### 4.5 **两向漏判率 与 per-kind precision / recall —— 本单不出，待人工标注**

| 指标                                                             | 依赖                       | 现状     |
| ---------------------------------------------------------------- | -------------------------- | -------- |
| per-kind `precision_k` / `recall_k`                              | 人工标注填入 `human_label` | **待出** |
| **两向漏判率**：漏正向 `holding_present` / 漏负向 `cold_absent`  | 同上                       | **待出** |
| neutral 误吞的**误吞分解**（多少是被吞的在场、多少是被吞的缺席） | 同上                       | **待出** |

补数方式（**同一脚本，不另写统计**）：

```bash
pnpm exec tsx scripts/ops/quality/d1-event-classifier-evidence.ts \
  --labels data/quality/d1-annotation-skeleton-2026-11-12.csv \
  --sample-size 60
```

> ⚠️ 机器候选标签**不得**直接进入 precision / recall（已拍板）。当前骨架 `human_label` **留空**、`note = 候选待主控复核`。

## 5. 方案 vs 任务单偏差（6 处）

| #   | 任务单                                                                 | 实际方案                                                                                                                    | 理由                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 「降级轮过滤：按 `traces[].degraded` 剔除」                            | 照做，但**如实标注口径**：`debug-session.service.ts:310-311` 明写该字段是**来访者侧**渲染降级                               | 咨询师侧兜底计数在 DB `ap_practice_sessions.counselor_degraded_turns`（本地 MySQL 不可达）+ 兜底话术池 `DEFAULT_REPLIES` 模块私有未导出（复制即第二份真相源）→ **咨询师侧降级轮离线不可识别**。本批降级轮 0，分母不受影响，但结论只在「本批零降级」下成立（D1-1）                                                                                                            |
| 2   | 模式字段走 DB `counselor_mode_id` 关联；不连 DB 则留空                 | **不连 DB**，改从批次血缘 `data/batch-reports/g3ONzlqSGMVJqkFMF9Lwh.json` 的 `lineage[]` 取 `counselorModeId`（96/96 命中） | 血缘是**已入库**的批次快照，口径同源且更可复现；顺带拿到 `fileSha256` → 白送口径漂移校验。模式分层从「不可用」变**真实可用**                                                                                                                                                                                                                                                 |
| 3   | 未写 sha256 口径                                                       | `sha256(content, utf8).hex.slice(0,16)`，与 `batch-metrics.service.ts:222` 逐字同款                                         | 首版按 Buffer 全长比 → 96/96 全不一致（假失败）；改正后 **96/96 一致**。真 bug，已修                                                                                                                                                                                                                                                                                         |
| 4   | 纯逻辑模块 `event-classifier-evidence.ts`（或按 lexicon 范式拆两文件） | `d1-event-classifier-evidence.lexicon.ts` + `d1-event-classifier-evidence.ts`                                               | 任务单已允许拆两文件；`d1-` 前缀**为后续模型轨实现单预留命名空间**                                                                                                                                                                                                                                                                                                           |
| 5   | 未规定事件种类来源                                                     | 事件表/正向表从 `metric-dictionary.js` 运行时导入；负向**词**事件集从 core `EVENT_LEXICON` **派生**                         | 不复制就是单一真相源。⚠️ 首版把「负向」写成 `TRACKED − POSITIVE − neutral`，**误把 `sensitive_touch` 算成负向**（率打成 0.0153 / 17 例）。核对 `rule-based-classifier.ts:31-37` 后确认 `sensitive_touch` 不在静态词表、由 `sensitiveTopics` 上下文命中，语义是「触碰敏感议题」而非「说了负向话」→ 改为从词表派生后 **0.0099 / 11 例**，与预研数字逐字对上，并补 1 例单测钉死 |
| 6   | 标注列只区分 `holding_present` / `cold_absent` / `neutral` 三类        | 标注词表 = **规则轨 11 类（含 neutral）∪ 两类在场标签 = 13 值**，人工可改判为任一规则 kind                                  | 三值口径算不出 per-kind precision / recall，而任务单 §3.1-1 同时要求 `precision_k` / `recall_k` → 满足不了。扩到 13 值后 per-kind 指标才成立；两类在场标签**不产出 core 类型**                                                                                                                                                                                               |

## 6. 标注与抽样

| 用途                                  | 文件                                                 |
| ------------------------------------- | ---------------------------------------------------- |
| 逐轮投影（1112 轮，标注对照底稿）     | `data/quality/d1-turn-projection-2026-11-12.csv`     |
| 分层抽样清单（60 条，带 `stratum`）   | `data/quality/d1-sample-list-2026-11-12.csv`         |
| 标注骨架（60 条，`human_label` 待填） | `data/quality/d1-annotation-skeleton-2026-11-12.csv` |

**抽样口径（确定性，无随机）**：模式 × 角色 × 轮次段分层；**cold 优先 → 尾段优先 → 角色字典序**；段内 `turnIndex` 降序；轮转取样；默认 60 条；先剔降级轮。

**机器候选规则是工程种子值**：段长 ≥ 2 仅表示「该轮处在连续 neutral 段内」，**不是** `cold_absent` 的临床缺席轮数阈值（阈值留 D-2 标定）；孤立短句不给候选；两类候选带 `?` 后缀。

## 7. 遗留项 / 证据边界

| #    | 遗留项                                                                                                                                                                                                                                | 归属     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| D1-1 | **咨询师侧降级轮离线不可识别**（DB 不可达 + `DEFAULT_REPLIES` 未导出）；本批兜底 0 轮，换批次前须复核                                                                                                                                 | 证据边界 |
| D1-2 | **per-kind precision/recall 与两向漏判率待人工标注**（骨架 + `--labels` 通路已就绪）                                                                                                                                                  | 主控复核 |
| D1-3 | 逐轮级 `engine_version` / `prompt_version` 未记录（逐字稿 JSON 无该字段）；改由 sha256 + 基线快照双保险                                                                                                                               | 证据边界 |
| D1-4 | `data/quality/*.csv` **当前未被 `.gitignore` 覆盖**（仓库只忽略 `data/quality/transcripts/` 与 `data/quality/*.txt`）；三个 CSV 内容**不含原文**（已双向扫描验证），是否入库由主控定。本单**不改 `.gitignore`**（并行进程在改该文件） | 主控决策 |
| D1-5 | 稀有类（`normalization` / `open_probe` / `judgment` 各 2 例、`boundary_cross` / `affirmation` 0 例）**不做点估计**，只报计数与区间；需扩样                                                                                            | 口径     |
| D1-6 | `neutral` 的**最终联合形状**（保留第三类 / 收敛 / 降级为未分类标记）                                                                                                                                                                  | D-2 拍板 |
| D1-7 | 根 `tsconfig.json` 全量类型检查的 **396 条既有债**（与 S-1 交付时同量同文件）                                                                                                                                                         | 技术债   |

**本单不解决的事（必须复述）**：规则轨一个字都没改（只测量、不修，`neutral` 误吞上界 89.39% 依然是现状）；模型轨分类器未实现（按已拍板拆两段，待复核通过后另派）；`holding_present` / `cold_absent` 未产出 core 类型、未进 `CounselorEventKind` 联合、未改 `DELTA_TABLE`；两类事件的 delta 方向/数值、缺席轮数阈值、时序权重一律留 D-2 / D-3。

## 8. 交付回写清单

- [x] 交付记录写到 §7.1 路径
- [x] 任务单移入 `completed/phase2.5/`，状态行改 `✅ 已交付` 并链接交付记录
- [x] 台账 I-01 / I-02 / I-18 备注（总表三行 + 详述三段）
- [x] 结构债草案 §3 三行现状列 / §4.2 D-1 进度 + G-4 / §6 第 3 步 / §9.3 D-1 行
- [x] `phase2.5-wp-list-2026-11-08.md` §四 独立单登记
- [x] `phase2.5-README.md` §3 活清单登记
- [x] `git diff --stat HEAD -- src/engine-core` 与 `src/engine-adapters` 均为空（实测记录）
- [x] 提交分组隔离（本单文件不混入并行产物）；给一行 commit message 草稿，**未自行 commit / push**

## 9. 提交分组与 commit message

**本单文件**：

```
scripts/ops/quality/d1-event-classifier-evidence.lexicon.ts
scripts/ops/quality/d1-event-classifier-evidence.ts
test/quality/d1-event-classifier-evidence.spec.ts
data/quality/d1-turn-projection-2026-11-12.csv
data/quality/d1-sample-list-2026-11-12.csv
data/quality/d1-annotation-skeleton-2026-11-12.csv
docs/worklog/completed/phase2.5/phase2.5-d1-event-classifier-evidence-implementation-2026-11-12.md
docs/worklog/completed/phase2.5/phase2.5-d1-event-classifier-evidence-task-2026-11-12.md
docs/worklog/pending/phase2.5-p1d-known-issues-2026-11-11.md
docs/worklog/pending/phase2.5-engine-core-structural-debt-assessment-2026-11-12.md
docs/worklog/pending/phase2.5-wp-list-2026-11-08.md
docs/worklog/pending/phase2.5-README.md
```

**并行产物（本单不混入）**：`.gitignore`（并行进程加的 `data/quality/*.txt` 规则）、`docs/worklog/pending/phase2.5-d1-model-event-classifier-research-minimax-2026-11-12.md`、`docs/worklog/pending/phase2.5-d1-model-event-classifier-research-result-2026-11-12.md`、`docs/worklog/pending/phase2.5-s1-*` 三份。

**commit message 草稿**：

```
feat(quality): D-1 规则轨漏判率离线取证 (逐轮投影 + 基线快照 + 标注骨架, neutral 误吞上界 89.39%)
```
