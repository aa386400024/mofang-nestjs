# Phase2.5 · D-1 取证 · 规则轨事件判定漏判率离线取证 —— 交付记录

> 状态：✅ 已交付（2026-11-12）
> 任务单：`docs/worklog/completed/phase2.5/phase2.5-d1-event-classifier-evidence-task-2026-11-12.md`（开工单，含例外批准声明）
> 事实源：预研结论 `docs/worklog/pending/phase2.5-d1-model-event-classifier-research-result-2026-11-12.md`（R1–R8 已验收通过）；母版 `docs/worklog/pending/phase2.5-engine-core-structural-debt-assessment-2026-11-12.md` §3 / §4.2 / §6 / §9.3；台账 `docs/worklog/pending/phase2.5-p1d-known-issues-2026-11-11.md` I-01 / I-02 / I-18
> 执行方：MiniMax Code
> 仓库 / 分支：`mofang-nestjs` / `integrate`
> 改动性质：**离线取证**（逐轮投影 + 规则轨基线快照 + 标注骨架 + 分层抽样 + 漏判率统计）。**零 core 改动、零 adapter 改动、零 LLM 调用、零批次重跑、零 DB 写入**。

---

## 1. 一句话总结

把规则轨事件判定的漏判率用**可复算离线口径**钉死：96 份活逐字稿 / 1112 轮逐轮投影 → `neutral` 994 轮 = **89.39%**（误吞上界，Wilson 95% 区间 **[0.8744, 0.9107]**），正向事件率 **0.0989**、负向**词**事件率 **0.0099**；并交付**规则轨基线快照 spec**（39 例，零回归锚）+ 60 条分层抽样清单 + 可回填的标注骨架 CSV；`git diff --stat HEAD -- src/engine-core` 与 `-- src/engine-adapters` 实测**均为空**。

## 2. 实际方案 vs 任务单偏差（conventions §2.5）

共 6 处偏差，全部是「按任务单红线与仓库实际落地所必需的调整」，无一处为省事。

### 2.1 偏差 1：降级轮口径 —— `traces[].degraded` 是**来访者侧**渲染降级，不是咨询师侧

| 项       | 内容                                                                                                                                                                                                                               |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 任务单   | 「降级轮过滤：按 `traces[].degraded` 剔除，并单独统计降级轮占比」                                                                                                                                                                  |
| 实际方案 | 照此执行，但**如实标注口径**：`src/admin-debug/debug-session.service.ts:310-311` 的字段注释明写「本轮**来访者侧**是否走了渲染降级 (LLM 失败/超时回兜底句)」；咨询师侧兜底计数在 DB `ap_practice_sessions.counselor_degraded_turns` |
| 为什么   | 咨询师侧降级轮**离线不可识别**：① 本地 MySQL 3306 不可达（拿不到 `counselor_degraded_turns`）；② 兜底话术池 `DEFAULT_REPLIES` 是模块私有未导出，复制一份就是**第二份真相源**（反双胞胎）                                           |
| 实际影响 | 本批**降级轮 = 0**（96 场全部 `render_fallback_ratio = 0.0`），分母 1112 实际不受该缺口影响；但结论**只在「本批零降级」前提下成立**（见 §7.3 D1-1）                                                                                |
| 可核对性 | CLI 控制台逐行打印「降级轮(来访者侧渲染降级) N                                                                                                                                                                                     | 有效轮 M」，口径写在输出里 |

### 2.2 偏差 2：模式列不连 DB，改用批次血缘

| 项       | 内容                                                                                                                                                                               |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 任务单   | 「模式字段：经 DB `ap_practice_sessions.counselor_mode_id` 按 `debug_session_id` 关联；若离线不连 DB，模式列留空并在报告注明缺口」                                                 |
| 实际方案 | **不连 DB**，改从批次血缘 `data/batch-reports/g3ONzlqSGMVJqkFMF9Lwh.json` 的 `lineage[]` 取 `counselorModeId`（96 条全命中）                                                       |
| 为什么   | ① 本地 MySQL 不可达；② 血缘是**已入库**的批次快照，口径与该批次的 `counselor_mode_id` 同源，比临时连库更可复现；③ 顺带拿到 `fileSha256` → 白送一个**口径漂移校验**（见 §5 风险 J） |
| 收益     | 模式分层从「不可用」变成**真实可用**（cold 530/551 = 96.19% vs expert 464/561 = 82.71%），这是 cold 富集抽样决策的直接依据                                                         |

### 2.3 偏差 3：sha256 校验口径 = UTF-8 字符串前 16 位

| 项         | 内容                                                                                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 开工单原文 | 未写口径，只写「口径漂移」要防                                                                                                                        |
| 实际采用   | `createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16)` —— 与 `src/auto-practice/metrics/batch-metrics.service.ts:222` **逐字同款** |
| 为什么     | 首版实现按 Buffer 全长 sha256 比 → **96/96 全不一致**（假失败）。读仓库口径后改正 → **一致 96 / 不一致 0**。这是真 bug，已修，不是绕过                |

### 2.4 偏差 4：文件命名拆「纯逻辑 + CLI」两文件，且加 `d1-` 前缀

| 项       | 内容                                                                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 任务单   | 「纯逻辑模块 `scripts/ops/quality/event-classifier-evidence.ts`（或按 lexicon 范式拆为 `*.lexicon.ts` 纯模块 + CLI 编排两文件）」                                        |
| 实际方案 | `d1-event-classifier-evidence.lexicon.ts`（纯逻辑，零 IO）+ `d1-event-classifier-evidence.ts`（CLI 编排），spec 同名 `test/quality/d1-event-classifier-evidence.spec.ts` |
| 为什么   | ① 任务单已明确允许 lexicon 范式拆两文件；② 加 `d1-` 前缀是**为后续「模型轨分类器实现单」预留命名空间**，避免那单落地时与本单的取证脚本撞名                               |

### 2.5 偏差 5：事件种类与负向事件集**全部从仓库既有单一真相源派生**，不复制

| 项                      | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 实际方案                | 事件种类表 / 正向事件表：`src/auto-practice/metrics/metric-dictionary.js`（`TRACKED_EVENTS` 11 类含 neutral、`POSITIVE_EVENTS` 5 类）运行时导入；负向**词**事件集合：从 core 的 `EVENT_LEXICON` **运行时派生**（词表 kind 减去正向 kind = 4 类）                                                                                                                                                                                                                                                                                |
| 为什么                  | 复制一份就是第二份真相源（反双胞胎）。`metric-dictionary.ts:66` 的注释本身就写「11 种事件 (与 CounselorEventKind 对齐; 含 neutral)」                                                                                                                                                                                                                                                                                                                                                                                            |
| ⚠️ 交付前抓到的口径缺陷 | 首版把「负向」写成 `TRACKED_EVENTS − POSITIVE_EVENTS − neutral` → **把 `sensitive_touch` 也算成负向**，负向率打成 0.0153（17 例）。核对 `src/engine-core/cognition/rule-based-classifier.ts:31-37` 后确认：`sensitive_touch` **不在静态词表**，它由角色 `sensitiveTopics` 上下文命中，语义是「本轮触碰敏感议题」而非「说了负向话」，与任务单 §5 / DOC-2 备忘的「**4 类负向词事件**」不是一回事。改为从 `EVENT_LEXICON` 派生后 → 负向**词**事件率 **0.0099（11 例）**，与预研结论的数字**逐字对上**；同时补 1 例单测钉死这个口径 |

### 2.6 偏差 6：人工标注词表扩到 13 值，标注列允许改判为任一规则 kind

| 项       | 内容                                                                                                                                                                                                                                                        |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 任务单   | 「本单标注列只区分 `holding_present` / `cold_absent` / `neutral` 三类候选」                                                                                                                                                                                 |
| 实际方案 | 人工标注词表 = **规则轨 11 类（含 neutral）∪ 两类在场标签 = 13 值**；人工可把某一轮改判为任一规则 kind                                                                                                                                                      |
| 为什么   | 三值口径只能算「两向漏判率」，**算不出 per-kind precision / recall**；而任务单 §3.1-1 同时要求 `precision_k` / `recall_k` —— 三值口径满足不了。扩到 13 值后，人工把「其实这是共情，只是规则词表没命中」改判成 `empathy`，per-kind precision / recall 才成立 |
| 边界     | 两类在场标签只是**标注列取值**，**不产出 core 类型**，不进 `CounselorEventKind` 联合（任务单 §1.2 已拍板）                                                                                                                                                  |

---

## 3. 改动文件清单

### 3.1 新增（源码**零改动**，全部是新增文件）

| 文件                                                          | 内容                                                                                                                                                                                                                                                                                                                                                                       | 规模   |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `scripts/ops/quality/d1-event-classifier-evidence.lexicon.ts` | **纯逻辑模块**：零 IO / 零 DB / 零网络。字段白名单投影（禁字段连类型都不声明）、`charBucket` / `segmentOf` / `isNeutralOnly`、连续 neutral 段长、`wilsonInterval`、`bucketize`、`computeRuleTrackBaseline`、`machineCandidateLabel`、`turnKey`、`stratifiedSample`、`computeLabelAgreement`（per-kind precision/recall + 两向漏判 + 误吞分解）、三个 CSV 构造器 + 标注读回 | ~25 KB |
| `scripts/ops/quality/d1-event-classifier-evidence.ts`         | **CLI 编排**：读逐字稿 + 批次血缘 → sha256 口径校验 → 写三个 CSV → 打印比率表 → 可选 `--labels` 读回人工标注重算 precision/recall                                                                                                                                                                                                                                          | ~11 KB |
| `test/quality/d1-event-classifier-evidence.spec.ts`           | 39 例，9 组：① 投影白名单/隐私 ② 降级过滤与基线 ③ precision·recall 与两向漏判 ④ Wilson 区间 ⑤ CSV 契约 ⑥ 分层抽样 ⑦ 机器候选标签 ⑧ 辅助口径 ⑨ **规则轨基线快照**                                                                                                                                                                                                           | ~21 KB |

### 3.2 新增（离线数据文件，**不入 DB**）

| 文件                                                 | 行数        | 表头                                                                                                                                                                     |
| ---------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `data/quality/d1-turn-projection-2026-11-12.csv`     | 1112 + 表头 | `debug_session_id,turn_index,character_slug,counselor_mode_id,event_tags,degraded,crisis,char_bucket,segment,neutral_run_length,machine_candidate`                       |
| `data/quality/d1-sample-list-2026-11-12.csv`         | 60 + 表头   | `sample_index,stratum,debug_session_id,turn_index,character_slug,counselor_mode_id,segment,char_bucket,neutral_run_length,event_tags,degraded,machine_candidate`         |
| `data/quality/d1-annotation-skeleton-2026-11-12.csv` | 60 + 表头   | `debug_session_id,turn_index,character_slug,counselor_mode_id,event_tags,degraded,machine_candidate,human_label,note`（`human_label` **留空**，`note = 候选待主控复核`） |

### 3.3 文档（新增 / 改）

- 新增本交付记录。
- 开工单 `docs/worklog/pending/phase2.5-d1-event-classifier-evidence-task-2026-11-12.md` → 移入 `docs/worklog/completed/phase2.5/`，状态行改完成标记并链接本记录。
- 改：台账 `phase2.5-p1d-known-issues-2026-11-11.md`（I-01 / I-02 / I-18 备注）、结构债草案 `phase2.5-engine-core-structural-debt-assessment-2026-11-12.md`（§3 三行现状列 + §4.2 D-1 进度）、`phase2.5-wp-list-2026-11-08.md` §四 独立单、`phase2.5-README.md` §3 活清单。

### 3.4 明确未改

- `src/**`（`engine-core` / `engine-adapters` / 业务层）—— **零改动**：`git diff --stat HEAD -- src/engine-core`、`-- src/engine-adapters`、`-- src` 实测**全为空**。
- `test/engine-core/boundary.spec.ts` —— 未改；断言⑥ / ⑦ 绿（12 例全过）。
- env / `.env.example` / module 装配 / migration / DB schema / prompt / 前端 / Flutter —— 未碰。
- 未跑批次、未调 LLM、未连 DB、未 commit / push。
- **未新增任何 core 公开导出、未新增 core `.ts` 文件**（`EVENT_LEXICON` 只是被**读取**，其公开面不变）。

---

## 4. 闸门（真实命令 / exit code / 真实数字）

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

### 4.1 零回归基线对比

| 阶段                   | Test Files                        | Tests                               | Duration |
| ---------------------- | --------------------------------- | ----------------------------------- | -------- |
| S-1 交付后基线（全量） | 189（188 passed + 1 skipped）     | 3072 passed / 4 skipped（3076）     | 93.47s   |
| **本单交付后（全量）** | **190（189 passed + 1 skipped）** | **3111 passed / 4 skipped（3115）** | 82.70s   |
| **差值**               | **+1 文件**                       | **+39 例**                          | —        |

+1 文件 = 新增 `test/quality/d1-event-classifier-evidence.spec.ts`；**+39 例恰好等于该文件的 39 个 `it`** → **零用例被删除 / 改名 / 跳过**（3072 + 39 = 3111，分毫不差），failed 仍为 0，skipped 仍为 4（未新增）。

定向口径：开工基线 core+adapters = 91 文件 / 1643 例；收尾 core+adapters+test/quality = 99 文件 / 1779 例（91 + 8 文件，1643 + 136 例），同样零丢失。

---

## 5. 风险 F / J / K / I 处理确认（开工单 §4 必钉四点）

### 风险 F · 无回归锚 —— ✅ 已钉死

- 交付 `test/quality/d1-event-classifier-evidence.spec.ts` 第 ⑨ 组「**规则轨基线快照**」：固定**构造语料**（全部是构造句，不含任何真实逐字稿原文）→ 调 `RuleBasedClassifier.classify` → **逐字**锁定 `kind` + `matchedTerms` + `strength` 序列。
- 快照里含一条**现场证据**：句 `你觉得呢` **同时命中 `empathy`（词 `你觉得`）与 `open_probe`（词 `你觉得呢`）** —— 这正是结构债草案 §4.2「附带登记 G-4：词表子串重叠，单轮 trust 合计 +0.15」的**可执行证据**（此前只是未经证实的假设）。
- 另含 `sensitive_touch` 走 `context.sensitiveTopics` 上下文命中、不在静态词典里的逐字断言。
- 快照语料全构造 → 版本库里稳定可读，且**不泄露任何真实对话**。

### 风险 J · 口径漂移 —— ✅ 已闭合

- **血缘 sha256 校验**：批次血缘 `lineage[].fileSha256` 对逐字稿逐份比对 → **一致 96 / 不一致 0 / 无血缘 0**；口径与 `batch-metrics.service.ts:222` 逐字同款（§2.3）。
- 漂移是**双向**的：① 逐字稿被改过 → sha256 不一致 → 报错；② 分类器口径变了 → 基线快照 spec 变红。两条都堵死。
- `engine_version` / `prompt_version`：逐字稿 JSON **顶层没有**该字段（`DebugSessionRecord` 无此字段），批次血缘只有**批次级** `promptVersion` → 逐轮级版本分布本单**未记录**，改列为证据边界 D1-3（由 sha256 + 基线快照双保险兜底）。

### 风险 K · 降级轮污染 —— ⚠️ 部分闭合（**分母干净，但只覆盖来访者侧**）

- **分母**：`traces[].degraded` 为真的轮已剔除，并单独报降级轮数与占比（CLI 控制台打印）。本批降级轮 **0** → 有效轮 1112 = 总轮 1112。
- **缺口**：该字段是**来访者侧**渲染降级（`debug-session.service.ts:310-311`），**咨询师侧**兜底轮离线不可识别（DB 不可达 + `DEFAULT_REPLIES` 模块私有未导出，详见 §2.1）。本批兜底 0 轮（批次 `render_fallback_ratio = 0.0`），**实际不受影响**，但口径缺口如实登记为 D1-1。

### 风险 I · 隐私 —— ✅ 已闭合

- **禁字段连类型都不声明**：投影模块只声明 `RawTrace` / `RawMessage` / `RawTranscript` 的**允许字段**；`title` / `characterLabel` / `renderSpec` / `kernelState` **连类型都没有** → 编译器保证本模块**不可能**去碰它们。
- **双向子串扫描**：把 96 份逐字稿的 **2200** 段原文（≥8 字）与 **94** 个展示名，对三个 CSV 的 **166** 个长单元格做**两个方向**的子串包含检查 → 原文命中 **0** / 展示名命中 **0**；`renderSpec` / `kernelState` / `characterLabel` / `promptFull` / `promptPreview` / `systemPrompt` / `title` 关键字命中 **0**。
- **输出面**：只有 id / 计数 / 比率 / 标签 / 归一化字符数桶（`charBucket` 只出桶，不出原始长度 —— 长度也是内容侧信息）。
- 本交付记录同样不含任何对话原文。

### 反双胞胎 —— ✅ 已闭合

统计口径**全部**集中在 `d1-event-classifier-evidence.lexicon.ts`；CLI 只做 IO 编排；spec 直接测**同一模块**。脚本与 spec 不存在两套计算。

---

## 6. 离线统计结果（实测，CLI 可复现）

### 6.1 样本与口径

| 项                         | 值                                                              |
| -------------------------- | --------------------------------------------------------------- |
| 逐字稿                     | **96 份**（解析失败 0）· 场次 96 · 轮次 **1112**                |
| 降级轮（来访者侧渲染降级） | **0** → 有效轮 **1112**                                         |
| 血缘 sha256                | 一致 **96** / 不一致 **0** / 无血缘 **0**                       |
| 事件种类来源               | `metric-dictionary.js` 的 `TRACKED_EVENTS`（11 类，含 neutral） |
| 正向事件来源               | 同上 `POSITIVE_EVENTS`（5 类）                                  |
| 负向词事件来源             | 从 core `EVENT_LEXICON` 派生（4 类，**不含 sensitive_touch**）  |

### 6.2 事件标签实例计数（占有效轮）

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

### 6.3 头号指标

| 指标                               | 值                   | 说明                                                                                           |
| ---------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------- |
| **neutral 误吞上界（比率）**       | **0.8939**           | = neutral 轮 / 有效轮；**不依赖人工标注**，是本单唯一可立即确证的头号数字                      |
| **neutral 误吞上界（Wilson 95%）** | **[0.8744, 0.9107]** | 稀有类用区间表达，不做点估计（开工单 §3.1-1）                                                  |
| 正向事件率                         | **0.0989**           | 110 实例 / 有效轮；分母是**有效轮**（剔降级），与仓库 `event.positive.rate` 分子同构、分母不同 |
| 负向词事件率（4 类）               | **0.0099**           | 11 实例 / 有效轮；**不含 `sensitive_touch`**（§2.5）                                           |

### 6.4 分层（分母均为有效轮）

**按咨询师模式** —— cold 的 neutral 占比**显著更高**，这是「cold 富集抽样」的直接依据：

| 模式   | 有效轮 | neutral | 占比       |
| ------ | ------ | ------- | ---------- |
| cold   | 551    | 530     | **96.19%** |
| expert | 561    | 464     | 82.71%     |

**按轮次段**：

| 段     | 有效轮 | neutral | 占比   |
| ------ | ------ | ------- | ------ |
| head   | 375    | 334     | 89.07% |
| middle | 375    | 345     | 92.00% |
| tail   | 362    | 315     | 87.02% |

**按角色**（8 个角色，取极值）：`vpt_intimate_avoidance_l1` **95.00%**（最高）/ `vpt_general_secure_l1` **82.14%**（最低），其余 87.50% ~ 90.91%。

### 6.5 **待人工标注才能出的数字**（本单**不**出）

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

> ⚠️ 机器候选标签**不得**直接进入 precision / recall（任务单 §1.2 已拍板）。当前骨架里 `human_label` **留空**、`note = 候选待主控复核`。

---

## 7. 标注 / 抽样位置与遗留项

### 7.1 标注与抽样清单位置

| 用途                                  | 文件                                                 |
| ------------------------------------- | ---------------------------------------------------- |
| 逐轮投影（1112 轮，标注时的对照底稿） | `data/quality/d1-turn-projection-2026-11-12.csv`     |
| 分层抽样清单（60 条，标了 `stratum`） | `data/quality/d1-sample-list-2026-11-12.csv`         |
| 标注骨架（60 条，`human_label` 待填） | `data/quality/d1-annotation-skeleton-2026-11-12.csv` |

用法：主控按任务单 §5 判据复核 → 把标签填进 `human_label` 列（13 值词表）→ 重跑上面那条 `--labels` 命令 → 打印 per-kind precision / recall、两向漏判率与 Wilson 区间。

### 7.2 抽样口径（**确定性，无随机**）

- 分层维度：**模式 × 角色 × 轮次段**（任务单 §1.2 已拍板）。
- 富集与优先级：**cold 优先 → 尾段（tail）优先 → 角色字典序**；段内按 `turnIndex` 降序；轮转取样。
- 默认 **60 条**；样本规模由抽样清单 + 精确区间表达，**不按「30 轮」拍点估计**。
- 剔除降级轮在**先**（本批降级轮 0，不影响）。
- **机器候选规则是工程种子值**：段长 ≥ 2 仅表示「该轮处在连续 neutral 段内」，**不是** `cold_absent` 的临床缺席轮数阈值（阈值留 D-2 标定）；孤立短句不给候选（标 `unclear`）；两类候选带 `?` 后缀。

### 7.3 遗留项 / 证据边界

| #    | 遗留项                                                                                                             | 归属     | 备注                                                                                                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1-1 | **咨询师侧降级轮离线不可识别**                                                                                     | 证据边界 | `traces[].degraded` 只覆盖来访者侧；咨询师侧兜底在 DB `counselor_degraded_turns`（MySQL 不可达）+ 模块私有 `DEFAULT_REPLIES`。本批兜底 0 轮，结论不受影响，但换批次前须复核              |
| D1-2 | **per-kind precision/recall 与两向漏判率待人工标注**                                                               | 主控复核 | 骨架 CSV + `--labels` 通路已就绪（见 §6.5）                                                                                                                                              |
| D1-3 | 逐轮级 `engine_version` / `prompt_version` **未记录**                                                              | 证据边界 | 逐字稿 JSON 无该字段；批次血缘只有批次级 `promptVersion`。口径漂移改由 sha256 + 基线快照双保险（§5 风险 J）                                                                              |
| D1-4 | `data/quality/*.csv` **当前未被 `.gitignore` 覆盖**                                                                | 主控决策 | 仓库只忽略 `data/quality/transcripts/` 与 `data/quality/*.txt`；三个 CSV 内容**不含原文**（已双向扫描验证），是否入库由主控定。本单**不改 `.gitignore`**（并行进程正在改该文件，不混入） |
| D1-5 | 稀有类（`normalization` / `open_probe` / `judgment` 各 2 例、`boundary_cross` / `affirmation` 0 例）**不做点估计** | 口径     | 只报计数与区间；需扩样才能给稳定比率（任务单附录要求：效力不足要明确列出，不凑结论）                                                                                                     |
| D1-6 | `neutral` 的**最终联合形状**（保留第三类 / 收敛 / 降级为未分类标记）                                               | D-2 拍板 | 本单只取证，不定形状（任务单 §5 已划界）                                                                                                                                                 |
| D1-7 | 根 `tsconfig.json` 全量类型检查的 **396 条既有债**                                                                 | 技术债   | 与 S-1 交付时同量同文件；`pnpm typecheck` 至今不覆盖 test/**                                                                                                                             |

### 7.4 本单**不**解决的事（必须复述，避免误读为「漏判已修好」）

- **规则轨一个字都没改**：本单只**测量**漏判，不修。`neutral` 误吞上界 89.39% 依然是现状。
- **模型轨分类器未实现**（按已拍板拆两段，待本单复核通过后另派开工单）。
- **`holding_present` / `cold_absent` 未产出 core 类型**，未进 `CounselorEventKind` 联合，未改 `DELTA_TABLE`。
- **两类事件的 delta 方向 / 数值、缺席轮数阈值、时序权重** —— 一律留 D-2 / D-3。

---

## 8. 交付回写清单（任务单 §7.2）

- [x] 交付记录写到 §7.1 路径
- [x] 本任务单移入 `completed/phase2.5/`，状态行改完成标记并链接交付记录
- [x] 台账 `phase2.5-p1d-known-issues-2026-11-11.md` I-01 / I-02 / I-18 备注：规则轨漏判率已离线取证（附关键比率）；模型轨分类器待另派
- [x] 结构债草案 §3 总表 I-01 / I-02 / I-18 现状列、§4.2 D-1 进度同步
- [x] `phase2.5-wp-list-2026-11-08.md` §四 独立单登记状态
- [x] `phase2.5-README.md` §3 当前活清单登记
- [x] `git diff --stat HEAD -- src/engine-core` 与 `src/engine-adapters` 均为空（实测记录）
- [x] 提交分组隔离：本单文件不混入并行产物；给一行 commit message 草稿，**不自行 commit / push**

## 9. 提交分组

**本单文件（建议单 commit）**

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

**commit message 草稿**

```
feat(quality): D-1 规则轨漏判率离线取证 (逐轮投影 + 基线快照 + 标注骨架, neutral 误吞上界 89.39%)
```
