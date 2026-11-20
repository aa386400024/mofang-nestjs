# AF-216 · 来访者真人度 R6-A 交付记录

日期：2026-11-21
基线：`9fd9792af0ae7f860e59d8299568dbeec4631bbc`（AF-214 R5 合并后 `integrate` HEAD）
任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-216/task-sheet.md`

## 一句话结论

R6-A 把 R2 的“口语事件词表 + 总上限”升级为**状态化事件节奏**：同一角色在 steady / guarded / flooded 三态下，停顿形态、改口位置、短答偏置、句/分句上限由纯函数决定，并写进 active prompt 的条件指令。真实 MiniMax-M3 探针按任务单原命令跑完 3 角色 × 3 状态 × 3 次 = 27 次调用，两道条件分布闸门通过：**guarded 短答率显著高于 steady；flooded 长停顿率显著高于 guarded**。但 **flooded 的句中改口率仍为 0**，状态差异目前主要由“短答”和“长停顿”承载，不能宣称三个维度都已被模型稳定执行。

本报告是 AI 代理预评审，`humanSupervision=false`、`clinicalAcceptanceEligible=false`，不构成临床验收。

## 改了什么

### 1. 状态化节奏纯函数

新增 `src/shared/realism/realism-event-rhythm.ts`：

- `resolveRealismEventRhythm({ role, state, scene })` 输出 `pauseStyle`（none / brief / held / broken）、`repairPosition`（none / clause_boundary / mid_sentence）、`shortAnswerBias`（normal / high / fragmented）、`maxSentences`、`maxClauses`、`maxPauseSpans` 与一句 `conditionDirective`。
- steady：一次短停顿、只在句缝改口、正常短答，最多 2 句 / 3 分句。
- guarded：一次短停顿、不硬改口、强短答，最多 1 句 / 2 分句。
- flooded：长停顿（失组织角色用 broken）、句中改口、碎片化短答，最多 2 句 / 2 分句，最多两个停顿 span。
- risk 轮所有事件配额归零；文字场景只额外允许一条短消息。

### 2. Prompt 条件化

`src/shared/realism/realism-event-plan.ts` 的 `buildRealismEventPromptLine(plan, rhythm?)` 增加可选 `rhythm`：

- 不传 rhythm 时输出逐字保持 R2 原文案，旧调用与旧回归不变；
- 传 rhythm 时追加“停顿写在哪、写多长、改口在句中还是句缝、这一轮最多几句/几分句”。

`src/shared/realism/visitor-realism-profile.ts` 增加 `rhythm` 字段，配额从状态带“加减一”改为状态分布：guarded 合计最多 1、只留短停顿与半截话；flooded 合计最多 3、允许两个停顿 span；steady 合计最多 2。off / audit 仍不注入一个字。

### 3. 确定性审计

`src/shared/realism/visitor-realism-audit.ts` 新增 `inspectRealismEventDistribution()`：

- 输出停顿 span 数与 brief / held / broken 分类；
- 输出改口 start / clause_boundary / mid_sentence 分类；
- 输出句子数、分句数、可见字符、是否短答、是否碎片；
- 只返回计数与分类，不返回任何台词原文。

`inspectVisitorRealism` 原签名与行为未改。`src/shared/realism/index.ts` 导出新类型与函数。

### 4. 真实 LLM 探针

新增 `bin/realism-event-probe.ts`：

- 用 `buildVisitorMessages()` 构造生产 prompt（含完整 active 真人度块），同一咨询师刺激下遍历 3 角色 × 3 状态，每组默认 3 次调用。
- 报告只落分类计数、prompt hash、finishReason，不落台词原文。
- 支持 `--dry-run`、`--roles`、`--states`、`--samples`、`--target-groups`、`--max-output-tokens`、`--model`、`--timeout-ms`、`--out`；进程内设置 `RENDER_REALISM_MODE=active`。
- `--max-output-tokens` 只约束可见台词；provider 侧额外预留 400 token 思考余量，并设 `reasoningEffort: low`，避免 160 token 全被思考吃掉。

### 5. 测试

新增 `test/auto-practice/af216-realism-conditioning.spec.ts`（10 例）：三态节奏差异、risk 全零、条件 prompt、停顿/改口/短答分类、off/audit 零注入、不返回原文。

## 真实探针结果（最终报告）

模型 `MiniMax-M3`；命令 `node --env-file=.env --import tsx bin/realism-event-probe.ts --target-groups 9 --max-output-tokens 160`；每组 3 次，共 27 次调用，全部 `finishReason=stop`。

| 状态 | 短答率 | 长停顿率 | 句中改口率 | 平均句数 | 平均分句 |
| --- | ---: | ---: | ---: | ---: | ---: |
| steady | 0.000 | 0.000 | 0.000 | 2.00 | 4.44 |
| guarded | **0.667** | 0.000 | 0.000 | 1.22 | 2.33 |
| flooded | 0.222 | **0.889** | 0.000 | 1.67 | 3.11 |

- `guardedShortAnswerHigher = true`（0.667 > 0.000）
- `floodedLongOrMidRepairHigher = true`（0.889 > 0.000，由长停顿项通过）

同一版 prompt 共跑了两轮独立 27 次采样，两轮两道门均通过。第一轮（`report.prev27.json`）为 steady 0.111 / guarded 0.444 / flooded 0.111 短答率，长停顿 0 / 0 / 1.0；两轮数值有波动，但方向稳定。

### 必须如实记录的边界

1. **句中改口没有被模型稳定执行**：两轮 `midRepairRate` 都是 0。flooded 的门是通过 `longPauseRate` 过的，不是通过 `midRepairRate`。R6-A 只证明了“短答下降 + 长停顿上升”，没有证明“改口从句缝迁移到句中”。
2. guarded 的短答率虽然最高，但 flooded 的短答率也高于 steady，说明“短答”不是 guarded 独占，而是“情绪压力升高后短答增加”。
3. 27 次调用只能证明分布方向，不证明稳定性；样本量不足以做置信区间或临床结论。

## R5 同批复算（未覆盖原基线）

对 R5 的 8 个完成 packet 用既有评分链路复算，输出到独立目录 `data/phase25-exit/af216-realism-r5-regression/`，未覆盖 `af214-realism-ai-double-blind/`：

- 候选 360 场、16 packet、12 packet 进入评分、8 完成、4 失败；
- 总体均值 3.5375，自然度 3.0；
- 自然度 exact / ±1 / κ 均为 1；
- 4 个失败全部是评分员长输出后 `dimension_missing:naturalness`（`005c9606d209a55d`、`02b82823ffa9479e`、`04172a05c74f4b76`、`069466ea9f8e0261`）；这是 R6-B 评分稳定性问题，不是 R6 prompt 改动造成。

**不能把自然度 3.0 与 R5 基线 2.75 当成“R6 提升”**：4 个失败 packet 由后续候选补位，评分集合已变化；这批复算只能作稳定性证据。

## 闸门证据

| 闸门 | 结果 |
| --- | --- |
| 定向 vitest（AF-216 + R1–R5 共 8 文件） | 8 files passed，73 tests passed |
| `pnpm typecheck` | exit 0，0 error |
| `pnpm lint`（全量，带缓存） | exit 0，0 error / 0 warning |
| `pnpm test`（全量） | 240 files passed + 1 skipped；4116 tests passed + 4 skipped |
| `node --env-file=.env --import tsx bin/realism-event-probe.ts --target-groups 9 --max-output-tokens 160` | exit 0，27 次调用，两道条件分布门通过 |
| `git diff --stat HEAD -- src/engine-core` | 空 |

全量测试首跑出现 1 个与本单无关的 Windows `EBUSY: rmdir` 临时目录清理失败（`wp-h-wave2-3-batch-observability.spec.ts`）；单跑该文件 25 例全绿，复跑全量 4116 例全绿，判定为环境抖动，不是代码回归。

## 与任务单的偏差

1. 任务单写“扩展 `inspectVisitorRealism` 或其同级纯函数”；实际新增同级 `inspectRealismEventDistribution()`，不改原函数签名，避免破坏既有调用与回归。
2. 任务单的探针命令没有 `--samples`，脚本默认每组 3 次；最终按 `--target-groups 9` 原命令执行，`--target-groups` 实现为“分组数一致性断言”，不改变调用次数与报告口径。
3. 任务单要求“停顿形态、改口位置、短答偏置至少三项中两项不同”；实际达成“短答偏置 + 停顿形态”两项，改口位置这一项目前只有 prompt 约束与确定性审计，没有真实模型执行证据。按 successCriteria 字面算通过，但不能在结论里写成三项都达成。

## 遗留

- **R6-B 评分稳定性**：4/12 packet 因评分员输出截断导致自然度维度缺失；需要只走提示词/解析加固，不碰 provider。
- **R6-C 线上场景补样本**：既有 360 场 `in_person=343`、`online_voice=0`、`online_text=0`，线上切片无法验证。
- **句中改口专项**：若要让 flooded 稳定产出句中改口，需要另立任务验证更强的指令或 few-shot 约束；当前证据不支持。
- 真人督导师双标与仲裁仍未做，`clinicalAcceptanceEligible` 保持 false。
- 工作区存在并行任务与历史取证文件（`data/batch-reports/*`、`data/phase25-exit/af13*`、`.af214-check.mjs` 等），本单不清理、不纳入提交。

## commit message

`feat(af216): 来访者真人度 R6-A 口语事件条件分布与状态化节奏`
