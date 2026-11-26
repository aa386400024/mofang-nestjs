---
taskId: AF-536
contextId: phase2.5-orchestration-closed-loop
title: 出口④ safety 假阳性与风险收束误注入修复
type: fix
status: backlog
baselineRef: 477fa8062548292bd5d40230dd9dd5a04b0b3e42
dependsOn: []
priorTasks: [AF-529]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.2, conventions.md#1.3, agent-orchestration/README.md#强制准入]
createdAt: 2026-11-26T16:20:00+08:00
deadline: null
agentRole: executor
riskClass: R2
riskRationale: 修改 safety 封顶识别与风险收束注入条件，影响自动对练安全结构；只修正假阳性和误注入，不降低任何安全阈值或删减真实危机处置。
gateProfile: full
objective: 修复 AF-529 暴露的两类安全结构缺陷：咨询师筛查提问被误判为来访者危机披露，以及非风险场次被误注入风险收束话术；保持真实危机披露仍触发封顶与安全计划补齐，不调评分阈值。
successCriteria:
  - 咨询师单独询问自伤/自杀筛查、来访者明确否认时，不再被计为 crisisDisclosed；来访者明确披露风险时仍计为 crisisDisclosed。
  - 只有来访者文本存在真实危机信号时，crisisClosing 才允许确定性补齐风险五组；仅有“扛不住/顶不住”等非自伤表达时不注入安全计划话术。
  - 为 packet-10/36/37/46 同类场景补回归单测，并保留原有真实危机封顶与补齐测试。
  - 更新 AF-529 六个失败 packet 的再判定说明：只修正评分假阳性与误注入，不把 48 packet 重新写成通过，不下调阈值、不改锚点。
  - pnpm lint、pnpm typecheck、定向 vitest 全绿；全量测试按任务收尾跑一次；src/engine-core 零 diff。
outOfScope:
  - 不新跑 48 场或 1000 场 LLM 批次，不产生新的批次费用；需要新批次的正式复评另案。
  - 不改评分阈值、锚点、仲裁规则、safety 上限数值或 quality_annotation 人工表。
  - 不改 engine-core、不改数据库结构、不改 .env、不碰 admin-dashboard 与 Flutter。
scope:
  files:
    - src/auto-practice/metrics/session-structure-audit.ts
    - src/auto-practice/metrics/ai-double-blind.ts
    - src/auto-practice/practice-runner.service.ts
    - test/auto-practice/session-structure-audit.spec.ts
    - test/auto-practice/ai-double-blind.spec.ts
    - docs/worklog/completed/
    - docs/worklog/records/
  modules: [auto-practice]
  interfaces: [evaluateSafetyCap, auditSessionStructure, applyDeterministicStructure]
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af536-safety-cap-false-positive-2026-11-26.md
    kind: report
gates:
  - command: pnpm exec vitest run test/auto-practice/session-structure-audit.spec.ts test/auto-practice/ai-double-blind.spec.ts
    check: safety 封顶与结构审计定向单测全绿
    threshold: exit=0
  - command: pnpm lint
    check: lint 0 error
    threshold: exit=0
  - command: pnpm typecheck
    check: typecheck 0 error
    threshold: exit=0
  - command: pnpm test
    check: 全量单测全绿
    threshold: exit=0
  - command: git diff --stat HEAD -- src/engine-core
    check: 内核零改动
    threshold: 输出为空
---

# AF-536 出口④ safety 假阳性与风险收束误注入修复

## 背景

AF-529 的 48 packet 复评中 safety 门 FAIL，6 个 packet 为 2。逐包核对发现两类工程缺陷：

1. **评分假阳性**：`containsCrisis` 把咨询师的筛查提问（“有没有伤害自己的念头”）也当成危机披露；来访者随后明确否认，仍触发 `safety.crisis.no_plan`，把 packet-10/36/37/46 压到 2。
2. **风险收束误注入**：packet-09 的来访者只说“扛不住/顶不住”，没有自伤披露；危机窗在收尾轮触发 `completeRiskClosingText`，把药刀、热线、联系家人等安全计划追加到不相关轮次，造成明显不匹配的危机升级。

这两条都不是“评分太严”，而是识别与注入条件错了。AF-529 的任务单明确要求“复评暴露代码缺陷另立任务修复”，本任务即该项。

## 范围

- 仅修 `session-structure-audit.ts` 的危机信号识别、`practice-runner.service.ts` 的确定性风险补齐守卫，并补回归单测。
- 不新跑批次、不改阈值、不改锚点；AF-529 的 48 packet 证据保持原样，另写再判定说明。
- 真实危机披露仍必须触发封顶与风险五组补齐；只排除“咨询师筛查 + 来访者否认”和“非自伤的压力表达”。

## 验收边界

本任务修复的是评分/注入缺陷，不等于出口④临床安全门通过。修完后仍可能有 packet-09/20 类真实质量分歧；正式复评必须新跑批次并由真人督导判读，不能把本次再判定写成临床达标。
