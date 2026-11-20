---
taskId: AF-137
contextId: phase2.5-ai-proxy-acceptance
title: 危机升级路径强制风险收束轮后再终止（P0 安全缺口）
type: fix
status: backlog
baselineRef: 76f466134e2e0dc7eb28e0fead693b7198b5a902
dependsOn: [AF-136]
priorTasks: [AF-136, AF-133, AF-131, AF-130]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-19T17:49:02+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/auto-practice/practice-runner.service.ts
    - src/auto-practice/counselor/builder/prompt-sections/crisis-stabilization.ts
    - test/auto-practice/practice-runner-decide-turn.spec.ts
    - docs/worklog/pending/
    - docs/worklog/completed/phase2.5/
  modules:
    - auto-practice
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af137-crisis-risk-close-2026-11-19.md
    kind: report
gates:
  - command: pnpm typecheck
    check: 类型检查 0 error
    threshold: exitCode=0
  - command: pnpm lint
    check: 0 error / 0 warning
    threshold: exitCode=0
  - command: pnpm exec vitest run test/auto-practice/practice-runner-decide-turn.spec.ts
    check: 定向单测全绿
    threshold: exitCode=0
  - command: pnpm exec vitest run test/engine-core/boundary.spec.ts
    check: engine-core 边界 12 例全绿
    threshold: exitCode=0
successCriteria:
  - 危机强度上升（crisis_escalated）当轮不再立即终止；runner 必须至少再完成 1 个风险收束轮后才允许结束。
  - 风险收束轮的咨询师 prompt 必须启用 crisisClosing=true，要求 means/channel/contact/noAlone/commitment 五项逐项落地。
  - 升级发生在 maxTurns 最后一轮时允许追加 1 轮安全收束，不允许因硬上限跳过。
  - legacy 档行为逐字不变；不修改 src/engine-core、评分器、阈值、migration。
  - 单测覆盖升级当轮继续、收束轮 cue、收束轮后终止、最后一轮升级追加轮。
---

# AF-137 · 危机升级路径强制风险收束轮

## 背景

AF-136 正式判读发现 P0 安全缺口：packet-09（`debug_bUjFUsUC9Kg6iNW6rul54`）第 40 轮披露“想让自己消失”，`decideTurn` 在强度上升时立即返回 `crisis_escalated`，仅 1 个 post 轮后结束，导致 R1/R2 一致判 `safety=2`。现有 `crisis_risk-closing` prompt 块只有 `crisisClosing=true` 时才要求五项，但升级路径没有给这一轮。

## 实现要求

1. `CrisisWindowState` 增加升级轮次记录（如 `escalationTurn`），升级当轮只标记、计数，不返回 stop。
2. `decideCrisisWindowStop` 对升级路径单独处理：升级当轮强制继续（连 `closeRequested` 也不能提前停）；升级后的下一轮结束为 `crisis_escalated`。
3. `decideTurnCue` 接收升级状态；升级后的风险收束轮 `crisisClosing=true`。
4. `runConversationLoop` 在升级发生在最后一轮时允许额外 1 轮（只限升级路径），保证收束可达。
5. legacy 档保持原行为，不启用额外轮。

## 边界

- 不改 `src/engine-core`、评分器、AF-125 阈值、migration。
- 不改 `session-profile.ts` 既有档位；`CrisisWindowState` 仅内部状态。
- 不新跑 LLM 批次；本轮只做代码与定向单测，后续另立复评任务。
- 独立临床复核由 MiniMax 只读完成，回执文件 `docs/worklog/pending/relay-response-AF137-REVIEW-<时间戳>.md`，不参与代码提交。
