---
taskId: AF-448
contextId: phase2.5-orchestration-closed-loop
title: 零语料算子剧本补语料（boundary_cross / normalization / affirmation）
type: implementation
status: backlog
baselineRef: df537e60cbc150fedfd84bfc3554c496f923419b
dependsOn: []
priorTasks: [AF-447, AF-427]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T09:40:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/ops/quality/af448-scripted-corpus.ts
    - docs/worklog/inbox/af448-scripted-corpus-task-2026-11-24.md
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-448/
    - docs/worklog/completed/phase2.5/af448-scripted-corpus-2026-11-24.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af448-scripted-corpus-2026-11-24.md
    kind: report
gates:
  - command: pnpm exec tsx scripts/ops/quality/af448-scripted-corpus.ts --dry-run
    check: 干跑三个零语料算子全部命中且不写盘
    threshold: exit=0
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
---

# 背景

`docs/architecture/behavior-operator-delta-ledger-v1.0.md` 表三显示 `normalization` / `affirmation` / `boundary_cross` 三类算子在真实语料里命中轮次为 0（台帐只读 `traces[].deltaDetail.events`），导致这些算子的 delta 幅度是否生效、是否被 cap 吞掉无法用语料验证。

AF-447 因任务单缺 `baselineRef` 无法 `task promote`（登记后任务单不可原地改基线），按编排纪律重签为 AF-448，范围与目标完全一致。

# 目标

1. 新增 `scripts/ops/quality/af448-scripted-corpus.ts`：人工剧本 + 生产同款 `RuleBasedClassifier({semantics:'v2'})` + 内核 `aggregateTurnDelta`，产出带真实事件标签的调试会话 JSON（写 `data/debug-sessions/`，该目录 gitignored）。
2. 会话文件必须带 `synthetic: true` / `generationMethod: 'rule-track-scripted-replay'` / `scriptedScenario` 标记，供台帐分组时区分真实与合成语料。
3. 支持 `--dry-run`（只打印计数、不写盘）与 `--apply`（写盘）。
4. 落地后用 `--apply` 跑一遍，记录三类算子的命中数与落盘文件名。

# 边界

- 只做规则轨可判定的三类算子；`holding_present` / `cold_absent` 是模型轨跨轮事件，规则轨不伪造，留 backlog（需真跑 LLM）。
- 不打印逐字稿原文（隐私红线），控制台只输出计数。
- 不改 `src/engine-core`，不改台帐脚本 `af427-operator-delta-ledger.mjs`（kernelRef 分桶是另一单）。

# 成功判据

1. `pnpm exec tsx scripts/ops/quality/af448-scripted-corpus.ts --dry-run` 退出码 0，且 `normalization` / `affirmation` / `boundary_cross` 三类命中数均大于 0。
2. `--apply` 落盘后，`data/debug-sessions/debug_scripted_af448_*.json` 存在且新增文件不进入 git 跟踪（gitignored）。
3. `pnpm typecheck` 0 error；`git diff --stat HEAD -- src/engine-core` 为空。
