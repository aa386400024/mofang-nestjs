# AF-137 · 危机强度升级后的两轮安全收束（P0）

> 结论先行：**AF-136 的 P0 安全缺口已在 runner 与 prompt 层修复到「有条件通过」**。危机升级（`crisis_escalated`）不再当轮终止，改为强制 **评估轮 + 计划轮** 两轮安全序列，先做意图/计划/准备评估与求助渠道，再做可联系的人、不要独处、安全承诺、随访与恶化行动顺序。定向闸门全绿；engine-core 零 diff。仍缺「内容级强制校验」与「pack 纳入 crisis_ended」两项，已登记为后续任务，不得据此宣称临床质量达标。

- 任务单：`docs/worklog/pending/af137-crisis-risk-close-task-2026-11-19.md`
- 工作分支：`task/AF-137-crisis-risk-close`（自 AF-136 验收 HEAD `76f4661` 切出的堆叠分支）
- 日期：2026-11-19
- 依据：AF-136 P0 `packet-09` / `debug_bUjFUsUC9Kg6iNW6rul54`（第 40 轮披露，第 41 轮 `crisis_escalated`，safety=2）
- 下游复核：MiniMax Code 只读安全复核（`relay-response-AF137-REVIEW-20261119-1750.md`，28681 字节）

---

## 1. 问题与修复

### 1.1 原缺口

AF-136 的 `packet-09` 在首次披露“想让自己消失”后只补了 1 个 post 轮就 `crisis_escalated`，没有完成具体计划/准备评估、手段限制、可联系的人、不要独处、热线/急诊与安全承诺。两路 AI 盲评一致给 `safety=2`，结构审计同步 `risk-incomplete`。

### 1.2 MiniMax 复核结论（采纳部分）

- **H2（采纳）**：只补 1 轮不够；临床下限是 2 轮，理想 3 轮。1 轮无法同时完成评估、手段限制、联系人、承诺与随访。
- **H3（采纳）**：五项包缺“具体计划/准备评估”和“后续随访”；补评估三问、随访、否认分支。
- **H1（未在本单落地）**：终止条件不能只看轮次，还要看内容是否真的覆盖安全要素。已登记为 AF-138，复用 AF-127 结构审计口径，不改 engine-core。
- **H4（未在本单落地）**：`bin/long-session-acceptance.ts` 只取 `completed` 会漏 `crisis_ended`。已登记为 AF-139。
- **红线（遵守）**：不调 κ / style / safety 阈值；不改 `src/engine-core`、PsyGUARD 分类器与 migration；不把否认句强行升档造成的假升级写成本单成绩。

### 1.3 运行器行为

升级后的序列：

| 轮次 | 行为 | prompt cue |
| --- | --- | --- |
| T | 检测到强度升级，记 `escalationTurn=T`，**不终止** | `crisisClosing=false`（cue 在检测前计算） |
| T+1 | **评估轮**：接住披露 + 意图/计划/准备与时间点 + 手段环境 + 求助渠道 + 预告下一轮做安全计划 | `crisisClosing=true`，`crisisClosingRound=1` |
| T+2 | **计划轮**：基于评估回答落地可联系的人、不要独处、双向承诺、随访、恶化行动顺序 | `crisisClosing=true`，`crisisClosingRound=2` |
| T+3 | 不再生成；以 `crisis_escalated` 结束 | — |

关键规则：

1. `shouldStopAfterEscalation` 改为 `turnIndex >= escalationTurn + 2`；计划轮跑完才停。
2. `shouldRunNextTurn` 在升级态允许跑到 `maxTurns + 2`，保证撞上 `maxTurns` 时两轮安全序列仍可达。
3. 两轮安全序列内屏蔽 `crisis_practice_close`，模型的 END 请求不得把评估轮/计划轮截断。
4. legacy 档行为逐字不变；普通危机窗用满的 `crisis_practice_close` 行为不变；只有“升级路径”走两轮。
5. `crisisClosingRound` 只在升级路径传入；普通收束轮不传，prompt 文本与 AF-133 一致。

### 1.4 Prompt 变更

`crisisRiskClosingSection` 增加第 4 个可选参数 `closingRoundIndex`：

- 不传：AF-133 原五项块逐字保留（现有测试与 legacy golden 不受影响）。
- `1`：评估轮，明确“先评估再计划”，不要把五项一次性念完。
- `2`：计划轮，逐项落地安全计划、随访与恶化行动顺序，并给出低强度/否认分支。
- 五项块本身新增：
  - **先评估，再计划**：意图 / 计划 / 准备与时间点，评估没做完不得为凑五项跳过。
  - **后续随访**：下一次何时聊、间隔是否缩短、预警信号与恶化行动顺序。
  - **否认分支**：明确否认时接住 + 澄清频率强度 + 安全网 + 缩短随访，不机械压五项。

---

## 2. 改动文件

| 文件 | 改动 |
| --- | --- |
| `src/auto-practice/practice-runner.service.ts` | `CrisisWindowState.escalationTurn`；升级不终止；`shouldStopAfterEscalation` 改两轮；`shouldRunNextTurn` 允许 `maxTurns+2`；`isEscalationSafetyWindow` 屏蔽 `crisis_practice_close`；`decideTurnCue` 输出 `crisisClosingRound`；`buildCounselorOptions` 透传 |
| `src/auto-practice/counselor-agent.service.ts` | `CounselorGenerateContext.crisisClosingRound`；`buildMessages` 透传 |
| `src/auto-practice/counselor/builder/counselor-prompt-builder.ts` | `PromptBuildCue.crisisClosingRound`；传给 `crisisRiskClosingSection` 第 4 参 |
| `src/auto-practice/counselor/builder/prompt-sections/crisis-stabilization.ts` | 评估轮/计划轮相位；评估三问；随访；否认分支；`buildPhaseLine` 抽函数避嵌套三元 |
| `test/auto-practice/practice-runner-decide-turn.spec.ts` | 纯函数与 runner 两轮序列、`closeRequested` 不截断、`maxTurns+2` 场景 |
| `test/auto-practice/counselor-prompt-builder.spec.ts` | 评估轮/计划轮 prompt 断言 |

未改 `src/engine-core`、评分器、阈值、migration、`bin/long-session-acceptance.ts`。

---

## 3. 闸门证据

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `pnpm typecheck` | **0** | `tsc -b tsconfig.check.json`，0 error |
| `pnpm lint` | **0** | eslint 缓存模式，0 error / 0 warning |
| `pnpm exec vitest run test/auto-practice/practice-runner-decide-turn.spec.ts test/auto-practice/counselor-prompt-builder.spec.ts` | **0** | **2 files / 41 tests passed** |
| `pnpm exec vitest run test/engine-core/boundary.spec.ts` | **0** | **1 file / 12 tests passed**；`git diff -- src/engine-core` 为空 |

闸门只跑定向：未跑全量测试、未新跑 LLM 批次、未跑 WP-K、未重跑 AI 双盲。AF-136 的批次证据仍是唯一批次证据，本单不产生新质量分数。

---

## 4. 与任务单的偏差

| 项 | 任务单 | 实际 | 原因 |
| --- | --- | --- | --- |
| 安全序列轮数 | 1 轮 | **2 轮（评估 + 计划）** | MiniMax 复核 H2：1 轮无法完成评估与计划；临床下限 2 轮 |
| 分支基线 | `integrate` | 自 `76f4661` 手工切堆叠分支 | AF-133 代码未合入 `integrate`，从 integrate 切会丢父修复 |
| 额外文件 | scope 未列 | `counselor-agent.service.ts`、`counselor-prompt-builder.ts`、`counselor-prompt-builder.spec.ts` | `crisisClosingRound` 需从 runner 透传到 prompt；不传则相位无法区分 |
| 内容级校验 | 未列 | 未做 | 需复用 AF-127 正则并新增 exit reason，另立 AF-138，避免本单改审计口径 |
| pack 纳危机场 | 未列 | 未做 | `bin/long-session-acceptance.ts` 另立 AF-139 |

---

## 5. 遗留与后续

- **AF-138（P0 剩余）**：内容级强制校验。升级后的收束轮不能只靠轮次终止；若评估/计划要素缺失，应给可区分 exit reason（如 `crisis_safety_incomplete`），并复用 `src/auto-practice/metrics/session-structure-audit.ts` 的五组正则，不改 `af127-v1` 口径。
- **AF-139**：`bin/long-session-acceptance.ts` 纳入 `crisis_ended`，避免 pack 系统性漏危机样本（IM-070）。
- **AF-140**：`forcedClose` 升级为 runner 级最后两轮硬约束（IM-068）。
- **AF-141 / IM-069**：跨模型 κ 校准（AF-131 B-1/B-3/B-4），κ 0.40 不得下调。
- **分类器假升级**：否认句被升档属 engine-core/PsyGUARD 红线，本单未改，需上报框架层另立缺陷单。
- **临床验收**：仍无真实督导师双人盲标 + 仲裁；`ai_proxy_candidate`、`humanSupervision=false`、`clinicalAcceptanceEligible=false` 保持不变。AF-137 只修 P0 行为，不等于出口④通过。

---

## 6. 验收结论

**有条件通过。** 代码行为、prompt 相位与定向闸门均达标；AF-136 暴露的“升级即止”P0 已消除。但“内容是否真的覆盖安全要素”仍无 runner 级硬门，pack 仍会漏危机场；在 AF-138/AF-139 完成前，不得把本单当作安全质量已全面达标。
