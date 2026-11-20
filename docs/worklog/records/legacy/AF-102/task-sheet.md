---
taskId: AF-102
contextId: phase2.5-exit4-quality-remediation
title: 长会话咨询师可见输出治本：预算、截断重试与降级计数
type: fix
status: backlog
baselineRef: d0a7c5f424f99687d0cc5b909bf19d848a9f0633
dependsOn: [AF-100, AF-101]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-18T20:35:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/auto-practice/counselor/
    - src/auto-practice/counselor-agent.service.ts
    - src/auto-practice/practice-runner.service.ts
    - test/auto-practice/
    - docs/worklog/pending/
    - docs/worklog/completed/
  modules:
    - auto-practice-counselor
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af102-long-session-visible-output-2026-11-18.md
    kind: report
gates:
  - command: corepack pnpm exec vitest run test/auto-practice/counselor-agent.spec.ts test/auto-practice/practice-runner.spec.ts
    check: 咨询师生成与批次计数单测全绿
    threshold: failed=0
  - command: corepack pnpm exec tsc --noEmit -p tsconfig.json
    check: 类型检查全绿
    threshold: error=0
successCriteria:
  - long 档案使用独立的生成预算，不再复用 500 token 的 legacy 默认
  - 可见 content 为空或 finishReason=length 时，用更高预算重试一次；仍为空才降级
  - 截断但非空的回复不得默默当作正常回复
  - legacy 档案的 prompt 与既有默认参数保持逐字不变
  - 新增单测覆盖空 content、length 截断、重试成功、重试仍失败四条路径
  - engine-core 零 diff
---
# AF-102 长会话咨询师可见输出治本

## 背景

AF-095 的 3 场 long 会话共 146 轮，咨询师可见输出为空 53 轮（36.3%），
`completionTokens` 中 reasoning 占 93%–96%。根因是咨询师统一使用
`maxCompletionTokens=500` + `reasoningEffort=low`，长会话推理把预算吃满，
`content` 为空；而 `render_fallback_turns=0`、批次健康仍为 true，空输出没有被正确识别。

## 目标

1. 为 `long` 会话档案提供独立生成策略，确保 50 轮长会话有足够可见输出预算。
2. `content` 为空或 `finishReason=length` 时，用更高预算重试一次；仍失败才走兜底并计降级。
3. 截断但非空的回复不得当正常回复静默通过。
4. 不改变 `legacy` 档案的 prompt 与默认参数，避免影响既有基线。

## 验收

- 单测覆盖空 content、length 截断、重试成功、重试仍失败。
- `tsc --noEmit` exit 0。
- `engine-core` 零 diff。
- 交付记录写明真实改动、闸门数字与隐私口径（不落台词）。
