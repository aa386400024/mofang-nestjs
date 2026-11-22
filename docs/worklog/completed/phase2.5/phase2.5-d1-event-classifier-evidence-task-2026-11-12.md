# D-1 取证单 · 规则轨事件判定漏判率离线取证（模型轨分类器前置 · 第一段）

> 状态：✅ 已交付（2026-11-12）—— 交付记录：`docs/worklog/completed/phase2.5/phase2.5-d1-event-classifier-evidence-implementation-2026-11-12.md`
> 执行方：MiniMax Code。
> 仓库：`E:\Work\Project\backend\mofang-nestjs`，分支 `integrate`
> 事实源：预研结论 `docs/worklog/pending/phase2.5-d1-model-event-classifier-research-result-2026-11-12.md`（R1–R8 已验收通过）；预研任务单 `phase2.5-d1-model-event-classifier-research-minimax-2026-11-12.md`；母版 `docs/worklog/pending/phase2.5-engine-core-structural-debt-assessment-2026-11-12.md` §4.2 / §6 / §9.3；台账 `docs/worklog/pending/phase2.5-p1d-known-issues-2026-11-11.md` I-01 / I-02 / I-18
> 任务性质：**离线取证**——逐轮投影 + 规则轨基线快照 + 标注骨架与抽样 + 漏判率统计。零 core 改动、零 LLM 调用、零批次重跑。
> 改动范围：`scripts/ops/quality/` 脚本与纯逻辑模块、`test/quality/` spec、`data/quality/` 离线数据文件、docs 报告；**不改任何 `src/` 源码**。

## 例外批准声明

本单**不授权改动 `src/engine-core/**` 与 `src/engine-adapters/**`**。`git diff --stat HEAD -- src/engine-core` 交付时必须为空；`boundary.spec.ts` 不许改。模型轨分类器实现、新 kind 并入 core 联合、`DELTA_TABLE` 新行均属后续单（D-2 / 模型轨实现单），本单不实施。

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `README.md` → `docs/README.md` → `docs/team/conventions.md`（§1.1 分层、§二 交付格式）
2. D-1 预研结论全文（§2 改动面、§3 R1–R8、§4 取证口径表、§5 风险表、§7 建议步骤、§8 闸门）
3. 本开工单

---

## 1. 背景与已决项

### 1.1 背景

I-01（关键词子串匹配）、I-02（词表覆盖窄）、I-18（`neutral` 吞掉冷漠缺席）同源于规则词轨结构性不可达。预研已复核：本地 96 份逐字稿 / 1112 轮，`neutral` 994 轮 = **89.39%**（误吞上界），正向实例 110（9.89%）、负向 11。本单把规则轨真实漏判 / 误判率用可复算口径钉死，作为模型轨分类器与 D-2 事件拆分的前置证据。

### 1.2 已拍板（不再复议）

- **拆两段**：本单是第一段取证（零 core、零 LLM、零批次）；模型轨分类器实现待本单复核通过后另派开工单。
- **类型形态**：本单不产出 `holding_present` / `cold_absent` 的 core 类型，不改 `CounselorEventKind` 联合；标注文件用独立标签列表达，不进 `src/`。
- **标注分工**：执行方交付脚本、纯逻辑统计模块、spec、标注骨架 CSV（表头 + 抽样清单 + 待填标签列）；**逐轮人工标签由主控离线对照 §5 判据复核填入**。脚本可预填机器候选标签，但必须标注"候选待复核"，不得作为最终标注进入 precision / recall。
- **载体**：逐轮投影与标注文件落 `data/quality/`（或已整目录忽略的 `data/quality/transcripts/`），**不入 DB**；聚合计数 / 比率进交付记录与 docs。
- **抽样**：按模式 × 角色 × 轮次段分层，cold 模式富集、尾段优先；先剔除降级轮；样本规模由抽样清单与精确区间表达，不按"30 轮"拍点估计。
- **临床数值留后**：两类事件的 delta 方向 / 大小、缺席连续轮数阈值、时序权重一律留 D-2 / 标定批次，本单不定。

## 2. 已核现状锚点（行号以代码为准，先 grep 符号名定位）

| 位置                                                 | 现状                                                                                                                                                                                                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/engine-core/cognition/rule-based-classifier.ts` | `RuleBasedClassifier implements EventClassifier`；`classify(text, context?)`；未命中归 `neutral`；`strength` 恒 1；无实例字段（纯函数）                                                                                                    |
| `src/engine-core/domain/events/session-event.ts`     | `CounselorEventKind` 11 类 + `neutral`；`SessionEvent{kind, matchedTerms, strength}`；`ClassifyContext{sensitiveTopics?}`；`EventClassifier` 接口（同步）                                                                                  |
| `src/engine-core/domain/events/event-lexicon.ts`     | `EVENT_LEXICON` 9 条规则 / 67 词条；5 正向 + 4 负向；子串包含匹配；无在场 / 缺席条目                                                                                                                                                       |
| `data/debug-sessions/{debugSessionId}.json`          | 顶层 `id, characterSlug, ..., messages[], traces[]`；`messages[]{role, text, turnIndex, ts}`；`traces[]{turnIndex, characterSlug, eventTags, eventTagLabels, degraded, crisis, ...}`。`eventTags` 是引擎当时判定结果，**取证不重跑分类器** |
| 模式字段                                             | JSON 内**无** `counselorModeId`；经 DB `ap_practice_sessions.counselor_mode_id` 按 `debug_session_id` 关联（参照 `scripts/ops/quality/visitor-quality-audit.ts` 的 mysql2 范式）。若离线不连 DB，模式列留空并在报告注明缺口                |
| 纯逻辑模块范式                                       | `scripts/ops/quality/visitor-quality-lexicon.ts`（零 IO 纯函数可单测）；CLI 脚本只留编排；spec 落 `test/quality/`（参照 `p1d-visitor-quality-lexicon.spec.ts`）                                                                            |
| 脚本运行                                             | `pnpm exec tsx scripts/ops/quality/<file>.ts`；后端命令一律 pnpm，**禁止裸 npx**                                                                                                                                                           |

## 3. 范围

### 3.1 在范围内

1. **纯逻辑模块** `scripts/ops/quality/event-classifier-evidence.ts`（或按 lexicon 范式拆为 `*.lexicon.ts` 纯模块 + CLI 编排两文件）：
   - 字段白名单投影：只取 `debug_session_id`、`turnIndex`、`role`、`characterSlug`、`counselorModeId`（DB 关联可得时）、`eventTags` / `eventTagLabels`、`degraded`、`crisis`、归一化字符数桶；**禁止**取 `messages[].text`、`traces[].renderSpec`（含 prompt 全文）、`kernelState`、`title` / `characterLabel`。
   - 降级轮过滤：按 `traces[].degraded` 剔除，并单独统计降级轮占比。
   - 标签展开与统计：多标签轮按"每轮每类"展开；`precision_k` / `recall_k`；`neutral` 误吞分**漏正向**（`holding_present` 被吞）与**漏负向**（`cold_absent` 被吞）两向，分开报；总体误吞上界 = neutral 轮数 / 总轮数。
   - 区间：稀有类用 Wilson 精确区间 / 计数比表达，不做点估计。
2. **CLI 编排脚本**：读 `data/debug-sessions/*.json`（可选 `--dir` 指向归档目录），可选 DB 关联补模式列；输出逐轮投影 CSV + 抽样清单 + 控制台比率表；输出只含码、计数、比率、标签、归一化字符数。
3. **`test/quality/d1-event-classifier-evidence.spec.ts`**：
   - 纯逻辑模块单测：投影白名单（断言禁取字段不进入输出结构）、降级过滤、标签展开、precision / recall / 两向误吞率计算、区间函数。
   - **规则轨基线快照**（补预研风险 F）：固定构造语料 → `RuleBasedClassifier.classify` 逐字事件序列（kind + matchedTerms + strength）锁定旧口径；作为后续模型轨 / D-2 改动的零回归锚。
4. **离线数据文件**（`data/quality/` 或 `data/quality/transcripts/`，git 忽略，不入 DB）：逐轮投影 CSV、标注骨架 CSV（列：`debug_session_id, turn_index, character_slug, counselor_mode_id, event_tags, degraded, machine_candidate, human_label, note`）、分层抽样清单。
5. **交付报告**：交付记录 md（§7.1）+ 离线比率表；台账与草案回写（§7.2）。

### 3.2 明确不在范围内

- 不改 `src/engine-core/**`、`src/engine-adapters/**`、`src/**` 任何源码；不改 `test/engine-core/boundary.spec.ts`。
- 不新增 core 具名导出 / `.ts` 文件；不接 env、不改 `.env.example`；不改 module 装配 / migration / DB schema。
- 不跑批次、不调 LLM、不连真实模型；不碰前端目录；不自动 commit / push。
- 不实现模型轨分类器；不新增事件 kind 到 core 联合；不改 `DELTA_TABLE`；不写两类事件 delta 数值、缺席轮数阈值、权重。
- 不复议 §1.2 已拍板项；发现与代码冲突时写进交付记录风险节，不静默改写。

## 4. 必须钉死的风险点（预研风险表 F / J / K / I）

- **F · 无回归锚**：规则轨分类器当前无专属 spec（仅 `test/engine-adapters/wp58-turn-delta-audit.spec.ts:170-171` 与 `wp1-bdi.spec.ts:41` 间接覆盖）。本单必须交付 §3.1-3 的基线快照 spec，固定语料逐字锁定事件序列。
- **K · 降级轮污染**：统计分母先剔 `degraded` 轮；降级率单独报，避免样本量被故障兜底轮稀释。
- **J · 口径漂移**：`eventTags` 是引擎当时判定；本单只评估规则轨（口径未变）。若 JSON 或 DB 带 `engine_version` / `prompt_version` 字段，记录其分布；取不到则在报告注明证据边界。
- **I · 隐私**：脚本与报告不得出现任何对话原文、prompt 全文、展示名；标注文件只存标签与 id。代码评审与交付记录均按此自检。
- **反双胞胎**：统计口径集中在纯逻辑模块，CLI 编排只做 IO；不允许脚本与 spec 各写一套计算。

## 5. 标注判据（供主控复核；脚本候选标签同口径）

> 本节只定义"怎么分类"，不定义 delta 方向 / 数值 / 缺席轮数阈值。

- **`holding_present`（有效中性 / 稳定在场）**：本轮未命中现有 5 类正向词事件，但给出可辨识承接（复述来访者要点 / 明确下一步 / 稳定回应情绪），语气在场。命中任一正向词事件则归该类，不双记。
- **`cold_absent`（冷漠缺席）**：本轮未命中任何现有词事件，且无可辨识承接（封闭回应 / 单字 / 纯应答 / 与上文无关联）；**连续性是必要属性**，单轮不作数（连续轮数阈值留 D-2 标定）。与 4 类负向词事件不同：负向事件是"说了负向话"，`cold_absent` 是"持续没给到在场回应"。
- **歧义规则**：短句但有承接 → `holding_present`；短句且无承接 → `cold_absent` 候选，需看连续性；同时命中正向词与"像缺席" → 归已命中正向类；降级兜底轮剔除不标注；咨询师本轮为空不进分类器（内核抛 `INVALID_INPUT`）。
- **`neutral` 拆分口径**留 D-2 拍板（保留第三类 / 收敛 / 降级为未分类标记）；本单标注列只区分 `holding_present` / `cold_absent` / `neutral` 三类候选，不替 D-2 决定最终联合形状。

## 6. 闸门（执行方跑，填真实数字；pnpm，禁裸 npx）

> 跑前：PATH 补 `D:\Apps\Git\cmd`（避免 vitest 调 git ENOENT 假失败）；确认无 `nest start --watch` / `vite dev` 常驻；记录机器状态（CPU / 内存 / Node 版本 / 盘读延迟）。

0. **开工基线**：先跑 `pnpm exec vitest run test/engine-core test/engine-adapters`，记录文件数 / 用例数 / failed / 墙钟（预研复核基线：core 22 文件 / 446 例全绿）。

| 闸门            | 命令                                                                    | 判据                                                          |
| --------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------- |
| 类型（src）     | `pnpm exec tsc -p tsconfig.build.json --noEmit`                         | 0 error                                                       |
| 类型（含 spec） | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` | 本单相关文件 0 error（既有债另计）                            |
| Lint            | `pnpm lint`                                                             | 0 error，记 warning 数                                        |
| 定向测试        | `pnpm exec vitest run test/quality` + 既有 core / adapters 定向         | 全绿；用例数 ≥ 开工基线，零丢失 / 改写                        |
| 边界护栏        | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                | 12 例全绿；本单不改该文件                                     |
| 全量            | `pnpm test`                                                             | 全绿，记总数 / skipped / failed / 墙钟 + 机器状态             |
| core 变更面     | `git diff --stat HEAD -- src/engine-core`                               | **必须为空**                                                  |
| adapter 变更面  | `git diff --stat HEAD -- src/engine-adapters`                           | 必须为空（本单不碰适配层）                                    |
| 隐私自检        | 投影脚本 + CSV + 报告人工过一遍                                         | 无原文、无 prompt 全文、无展示名；只有码 / 计数 / 比率 / 标签 |

## 7. 交付记录与回写

### 7.1 交付记录路径

`docs/worklog/completed/phase2.5/phase2.5-d1-event-classifier-evidence-implementation-YYYY-MM-DD.md`，含：一句话总结、实际方案 vs 任务单偏差（conventions §2.5）、改动文件清单、闸门表（命令 / exit code / 真实数字）、风险 F / J / K / I 处理确认、离线统计结果（误吞上界、两向漏判、per-kind precision / recall、区间）、标注与抽样清单位置、遗留项。

### 7.2 交付回写清单

- [x] 交付记录写到 §7.1 路径
- [x] 本任务单移入 `completed/phase2.5/`，状态行改完成标记并链接交付记录
- [x] 台账 I-01 / I-02 / I-18 备注：规则轨漏判率已离线取证（附关键比率）；模型轨分类器待另派
- [x] 结构债草案 §3 总表 I-01 / I-02 / I-18 现状列、§4.2 D-1 进度同步
- [x] `phase2.5-wp-list-2026-11-08.md` 与 `phase2.5-README.md` 活清单登记
- [x] `git diff --stat HEAD -- src/engine-core` 与 `src/engine-adapters` 均为空（实测记录）
- [x] 提交分组隔离：本单文件不混入并行产物；给一行 commit message 草稿，不自行 commit / push

## 附录 · 依赖与边界

- D-1 取证 → D-1 模型轨实现（另派）→ D-2 事件拆分（改 core 联合 + delta 表行 + 接线）→ D-3 时序权重；顺序不可反。
- 本单不解决模型轨接口同步 / 异步形状冲突（预研风险 A）、三处分类点同源收敛（风险 B）、带状态分类器会话隔离（风险 C）；这些留模型轨实现单拍板。
- 离线标注样本若统计效力不足（稀有类区间过宽），在交付记录明确列出需补跑的模式 / 轮次段，不凑结论。
