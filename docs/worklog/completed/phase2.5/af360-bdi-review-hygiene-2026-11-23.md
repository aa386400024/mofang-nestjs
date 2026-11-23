# AF-360 · BDI 复审 hygiene（审计披露、注释漂移与来源契约措辞）· 交付记录

- 任务：AF-360（`phase2.5-orchestration-closed-loop`）
- 类型：documentation
- 基线：`2b1b5bd6cf2cebc1026b57f774e8799e7ae50a48`（AF-359 squash 合并提交）
- 分支：`task/AF-360-bdi-review-hygiene`
- 交付日期：2026-11-23
- 输入：MiniMax Code 对 AF-359 的只读复审（accepted，无 P0/P1，附 4 条可收口项）

## 1. 交付摘要

本单只做注释、审计展示层与契约措辞，不改任何运行时判定、阈值、权重与映射行为。

1. **审计披露（F1）**：`bdi-readiness-audit.md` 在角色覆盖表前新增口径说明：“缺失键按 0 计，与内核 `?? 0` 同口径；`avoidanceDelta = avoid_pain - max(understood, accepted)`；只有 `avoidanceDelta > avoidanceMargin + 1e-9` 才判 `avoidanceDominant`”。惊尘 / 回避依恋 L1 的 `— / 0.7200` 不再容易被误读成“回避比被理解高 0.72”。
2. **容差互指（F5）**：内核 `AVOIDANCE_COMPARE_EPSILON` 注释与审计 `1e-9` 注释互相指向，注明两处必须同步改，降低未来漂移风险。
3. **函数级注释（F3）**：`extractReflectiveStatements` 规则第 3 条按 AF-359 新口径改写：hedge 型标记按后缀否定整句否决，含觉察动词的标记只在“否定词 + 可选再 + 觉察动词”时排除。
4. **来源契约措辞（F4 / B11）**：`orderWinnerFirst` 注释从“无条件 `sourceLabels[0] === label`”改为条件式；`UnderlyingDesire.sourceKeys` 注释注明“按 (key,label) 对去重，同一 key 可因 label 不同而重复，消费方按对索引”，并指向 `UnderlyingDesireSeed` 同约定。
5. **偏差补记（F2）**：AF-359 任务单 §2.1 写“惊尘 0.22、内置回避型 0.25 不变”，实际审计产物为惊尘 `0.7200`、回避依恋 L1 `0.4500`；本单交付记录补记该口径偏差，交付以内核实际口径为准。

## 2. 关键决策

- **不改已归档的 AF-359 交付记录正文**。证据不可变；F2 偏差补记放在本单 `deviationTable`，读者从 AF-360 记录可追溯。
- **不改首置映射行为**。F4 只改注释为条件式，不把 `label` 改成来源首标签；后者会改变展示语义，属产品 / 督导决策。
- **不改 `character-profile.ts`**。`UnderlyingDesireSeed` 的类型声明不在本单 scope；在 `desires.ts` 的 `UnderlyingDesire.sourceKeys` 注释里写明同约定并指向 Seed，避免越界。
- **零运行时变化**。所有改动为注释与审计 Markdown 字符串；既有 149 例与全量行为不变。

## 3. gateResults

| 命令 | 退出码 | 结果 |
| --- | ---: | --- |
| `pnpm typecheck` | 0 | 0 error |
| `pnpm lint` | 0 | 0 error / 0 warning |
| `pnpm exec vitest run` 定向 4 文件 | 0 | 4 files / 28 tests passed |
| `pnpm exec tsx bin/bdi-readiness-audit.ts --out .tmp/af360-audit --strict` | 0 | 阻断项 0；口径说明可见；念安 0.1000/否、惊尘 0.7200/是、回避依恋 L1 0.4500/是 |
| `node scripts/orchestration/cli.mjs worklog verify --strict` | 0 | 见回执实测输出 |
| `git diff --stat HEAD -- src/engine-core` | — | 仅 3 个授权文件的注释 |

机器状态：Windows / PowerShell 7.6.4 / Node v22.23.2 / pnpm 9.15.0；无长驻 `nest start --watch` / `vite dev`。

定向 4 文件：`af359-bdi-review-followup`（8）、`af359-character-desire-pairing`（4）、`af358-character-desire-provenance`（4）、`boundary`（12）。

## 4. scopeCheck

`in-scope`：

- `bin/bdi-readiness-audit.ts`（注释 + Markdown 口径说明）
- `src/engine-core/cognition/state-transition.ts`（函数级注释）
- `src/engine-core/cognition/intention-planner.ts`（容差注释互指）
- `src/engine-core/domain/desires.ts`（来源契约注释）
- `src/engine-adapters/wiring/character/character-desire-mapping.ts`（条件式注释）
- `docs/worklog/completed/`、`docs/worklog/records/`
- 编排状态面（CLI 写入）

`out-of-scope` 未触碰：运行时判定、阈值数值、角色权重、映射行为、`character-profile.ts`、`boundary.spec.ts`、`admin-dashboard/`、Flutter、migration / 表结构、`data/handoff/`、`data/phase25-exit/`。

## 5. contractChecks

| 检查项 | 结果 | 说明 |
| --- | --- | --- |
| taskId | pass | AF-360 经 CLI register / promote / run-once |
| state-write | pass | 状态面由 CLI 生成，未手改索引或事件链 |
| engine-core-auth | pass | 只改 3 个授权文件的注释；boundary 12/12；未新增 public export |
| runtime-no-change | pass | 无判定 / 阈值 / 权重 / 映射行为改动；定向 28 例逐字通过 |
| audit-disclosure | pass | 缺失键按 0 计与内核 `?? 0` 同口径，表格前可见 |
| comment-consistency | pass | 否定规则、容差互指、来源条件式假定的注释与实现一致 |
| clinical-numeric-integrity | pass | 未改任何临床数值，未把审计展示当判定 |
| privacy | pass | 审计 / 日志 / 报告无对话原文 |
| artifact-pointer | pass | taskSheet / deliveryRecord / reply 均落文件；worklog strict PASS |

## 6. backlogItems

1. **AF360-B1 hedge 判定清单**：AF359-B7 需要一份可签字的“算 / 不算”句子清单；本单不代替督导拍板。
2. **AF360-B2 insight 口径**：AF359-B2 仍需督导写明“`insight` = 来访把一条觉察展开了”，是否要求展开次数 ≥ 2 未定。
3. **AF360-B3 首置映射标签**：是否让首置路径的 `label` 与 `sourceLabels[0]` 强制一致，属展示语义决策；当前只把注释改为条件式。
4. **AF360-B4 静默截断**：`sourceLabels` 多于 `sourceKeys` 时按 keys 截断；已在注释说明，若要保留多余标签需改数据契约。
5. **AF360-B5 admin 往返定位**：`CharacterDesireDto` 只声明 `key / label / baselineWeight`，全局 `ValidationPipe whitelist:true` 会剥掉 `sourceKeys/sourceLabels`；当前 admin 前端无愿望编辑器，风险休眠，协调 Admin 单时再修。
6. **AF360-B6 生产开启**：`ENGINE_BELIEF_FORMATION_ENABLED` 仍缺省 false；AF-359/AF-360 只把复审问题修到“可开启候选”。

## 7. deviationTable

| 任务单写法 | 实际情况 | 处理 | 理由 |
| --- | --- | --- | --- |
| B11 建议在 `UnderlyingDesireSeed.sourceKeys` 类型注释补约定 | 该声明在 `character-profile.ts`，不在本单 scope | 在 `desires.ts` 的 `UnderlyingDesire.sourceKeys` 注释写明同约定并指向 Seed；`character-profile.ts` 未改 | 不越 scope 改纯层文件；注释信息等价可追溯 |
| F4 建议“让 label 与赢家对一致或改注释” | 改 label 会改变展示语义 | 只改注释为条件式 | 属产品 / 督导决策，不在文档单里改行为 |
| AF-359 任务单 §2.1 写“惊尘 0.22、内置回避型 0.25 不变” | 实际审计产物为 0.7200 / 0.4500 | 在本单偏差表补记，交付以内核 `?? 0` 实际口径为准 | 任务单期望值口径错误；不改已归档 AF-359 记录正文 |
| AF-359 复审建议“无需返工开单” | 4 条 low 项可分步收口 | 本单只做注释 / 展示层 / 契约措辞 | 零运行时风险，避免与未标定临床口径混在一起 |

## 8. reviewVerdict

`passed`（主控自检）。AF-359 独立复审为 accepted，无 P0/P1；本单按复审的 F1 / F3 / F4 / F5 与 B11 收口注释与审计披露，F2 偏差补记。`pnpm typecheck` 0、`pnpm lint` 0/0、定向 4 文件 28 例全绿、审计 strict 阻断 0；无任何运行时行为变化。
