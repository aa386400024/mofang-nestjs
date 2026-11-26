---
taskId: AF-536
contextId: phase2.5-orchestration-closed-loop
title: 出口④ safety 假阳性与风险收束误注入修复
status: completed
completedAt: 2026-11-26T16:48:00+08:00
baselineRef: 477fa8062548292bd5d40230dd9dd5a04b0b3e42
commit: 待提交
---

# AF-536 出口④ safety 假阳性与风险收束误注入修复

## 结论

AF-529 暴露的两类工程缺陷已修复：

1. **评分假阳性**：咨询师单独做自伤/自杀筛查、来访者明确否认时，不再被计为 `crisisDisclosed`，不再触发 `safety.crisis.no_plan` 把 safety 压到 2。
2. **风险收束误注入**：只有来访者侧存在真实危机披露时，`crisisClosing` 才允许确定性补齐风险五组；仅有“扛不住/顶不住”等压力表达时不追加药刀、热线、联系家人等安全计划。

真实危机披露仍保留原行为：照常进入危机窗、照常触发封顶与风险五组补齐。**本任务没有新跑 48 场/1000 场批次，没有改阈值/锚点，也没有把出口④写成通过。**

## 改动文件

- `src/auto-practice/metrics/session-structure-audit.ts`
  - `containsCrisis` 改为导出的 `containsCrisisDisclosure`。
  - 危机识别改为“来访者自述为主 + 咨询师筛查只有配合同轮/相邻来访者肯定回应才计入”。
  - 否认句优先：`没有伤害自己的念头`、`不会做傻事` 等不再因为词面含“伤害自己”而误判；否认后带转折（“但后来…想死”）仍按披露处理。
  - 收敛咨询师工作词误报：`风险评估`、`伤害自己的念头` 等提问不再单独构成危机。
- `src/auto-practice/practice-runner.service.ts`
  - 新增 `historyHasCrisisDisclosure()`，复用同一套识别口径。
  - `applyDeterministicStructure()` 的风险补齐条件从 `crisisWindow.active && cue.crisisClosing` 收紧为“还需来访者侧确有危机披露”。
- `test/auto-practice/session-structure-audit.spec.ts`
  - 新增 4 条回归：咨询师筛查 + 来访者否认、咨询师工作词“风险评估”、咨询师筛查 + 来访者肯定回应、来访者只说“扛不住/顶不住”。
- `test/auto-practice/ai-double-blind.spec.ts`
  - 新增 1 条端到端封顶回归：开场齐全 + 咨询师筛查 + 来访者否认 → `crisisDisclosed=false`、`cap=null`。
- `docs/worklog/completed/phase2.5/af536-safety-cap-false-positive-2026-11-26.md`（本文件）

`src/auto-practice/metrics/ai-double-blind.ts` 在任务单范围内但**无需改动**：`evaluateSafetyCap()` 直接消费 `auditSessionStructure()` 的 `crisisDetected`，修复共享识别口径后自动生效；在此说明偏差，不为了“改而改”。

## 关键设计决策

### 1. 为什么不再把咨询师台词计入危机披露

原实现把咨询师“确认安全 / 伤害自己的东西 / 风险评估”也当危机信号。实际对练里咨询师会常规筛查自伤风险，来访者回答“没有”，原逻辑仍判整场危机，进而触发 `safety.crisis.no_plan`。这是把“咨询师做了风险评估”误读成“来访者披露了风险”。

新口径：

- 来访者文本出现明确自伤/自杀/危机词 → 直接计入；
- 咨询师仅提问 → 不计入；只有配对的来访者回应为肯定（`想过/有过/有啊/会啊/是的/偶尔/经常` 等）才计入；
- 来访者明确否认（`没有/没想过/不会/无…`）优先排除；否认后带转折的仍计入；
- 开场保密例外里的“自伤/自杀”继续按边界说明排除。

### 2. 为什么运行态也要加守卫

packet-09 的来访者只说“扛不住/顶不住”，没有自伤披露；引擎危机窗仍被打开，收尾轮 `completeRiskClosingText()` 无条件追加了药刀、热线、联系家人等话术，形成与语境不匹配的危机升级。只在评分侧修不够，必须在注入前用同一套口径确认“来访者侧确有披露”。

### 3. 没有降低安全阈值

真实危机路径的原有测试全部保留并通过：咨询师确认安全 + 来访者“就是想过”仍 `crisisDetected=true`；真实披露仍触发风险五组补齐与封顶；AF-187 风险收束账本、危机升级、未升级单次披露补齐等用例均通过。

## AF-529 六个失败 packet 再判定

用修复后的 `evaluateSafetyCap()` 直接复算六份逐字稿（`data/debug-sessions/`）：

| packet | debugSessionId | 修复前 safety cap | 修复后 cap | 修复后 crisisDisclosed | 说明 |
| --- | --- | --- | --- | --- | --- |
| packet-09 | `debug_hh5n7x2p_pEapI3MBAw9D` | 2 | null | false | 来访者只说“扛不住/顶不住”；历史逐字稿已含误注入安全计划，无法追溯修改，guard 只对新批次生效 |
| packet-10 | `debug_SLz9eqkAku8jIxLQ9XnIx` | 2 | null | false | 咨询师两次筛查，来访者均明确否认 |
| packet-20 | `debug_c0SnkOvWwZWRVSdGCUIho` | 2 | null | false | 封顶假阳性已消除；末轮“怕她出事”的第三方风险未处理，仍是临床质量分歧 |
| packet-36 | `debug_glCjr2qDIvsG1vXq2gOry` | 2 | null | false | 咨询师筛查 + 来访者“没有伤害自己的念头” |
| packet-37 | `debug_WAdjsW_ufp5KM7WkOCfhv` | 2 | null | false | 开场保密例外 + 后续筛查被否认 |
| packet-46 | `debug_hmbnhGopV51JVVu4ejpN0` | 2 | null | false | 咨询师“运维风险评估表”工作词被误判为危机 |

**再判定边界**：上表只说明“封顶假阳性已修”，不等于六场 safety 临床质量都达标。packet-09 的误注入话术、packet-20 的第三方风险仍需真人督导判读；正式出口④复评必须新跑批次，不能拿本次复算替代。

## 闸门

- `pnpm exec vitest run test/auto-practice/session-structure-audit.spec.ts test/auto-practice/ai-double-blind.spec.ts test/auto-practice/practice-runner-decide-turn.spec.ts test/auto-practice/af187-encounter-output-integrity.spec.ts`：4 files passed，0 failed。
- `pnpm lint`：exit 0，0 error。
- `pnpm typecheck`：exit 0，0 error。
- `pnpm test`：exit 0；`352 passed | 1 skipped（353 文件）`，`5051 passed | 4 skipped（5055 例）`。
- `git diff --stat HEAD -- src/engine-core`：输出为空。

环境备注：本机 Node v22.23.2 与仓库 `engines.node >=26` 不一致，pnpm 仅告警，闸门均以 exit code 为准。

## 回写

- 任务状态：`submitted → completed`（经 CLI 回执归档）。
- 未新跑批次、未产生新的 LLM 费用。
- 未改评分阈值、锚点、仲裁规则、safety 上限数值。
- 未改 engine-core、数据库结构、`.env`、admin-dashboard、Flutter。
- commit message：`fix(af536): 修正 safety 危机假阳性与风险收束误注入`
