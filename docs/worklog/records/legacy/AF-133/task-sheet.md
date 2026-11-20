---
taskId: AF-133
contextId: phase2.5-ai-proxy-acceptance
title: 长会话收束可达性与硬模板（AF-130/AF-131 未达标项修复）
type: implementation
status: backlog
baselineRef: 6b4b8baafef92cc2bdedcef28b1696606f071906
dependsOn: [AF-130, AF-131]
priorTasks: [AF-127, AF-129, AF-130, AF-131]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-19T15:05:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/auto-practice/counselor/builder/prompt-sections/
    - src/auto-practice/counselor/builder/counselor-prompt-builder.ts
    - src/auto-practice/counselor-agent.service.ts
    - src/auto-practice/practice-runner.service.ts
    - test/auto-practice/counselor-prompt-builder.spec.ts
    - test/auto-practice/practice-runner-decide-turn.spec.ts
    - docs/worklog/pending/
    - docs/worklog/completed/phase2.5/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af133-long-session-closure-2026-11-19.md
    kind: report
gates:
  - command: pnpm typecheck
    check: 类型检查 0 error
    threshold: exitCode=0
  - command: pnpm lint
    check: lint 0 error 0 warning
    threshold: exitCode=0
  - command: pnpm exec vitest run test/auto-practice/counselor-prompt-builder.spec.ts
    check: prompt 单测全绿
    threshold: exitCode=0
  - command: pnpm exec vitest run test/auto-practice/practice-runner-decide-turn.spec.ts
    check: 收束判定单测全绿
    threshold: exitCode=0
  - command: pnpm exec vitest run test/engine-core/boundary.spec.ts
    check: engine-core 边界单测全绿
    threshold: exitCode=0
successCriteria:
  - AF-131 指出的 14/16 收束不可达必须从 runner 侧修复，不能只改 prompt
  - maxTurns 前 2 轮注入强制收束 cue，模型在被切之前有机会产出收束三件套
  - 危机窗达到 crisisPracticeTurns 时不得直接硬切，至少留 1 轮风险收束后再结束
  - 模型已请求 END 且危机窗已过披露轮时，优先走收束路径，不被 crisis_practice_max 覆盖
  - 开场五要素与常规收束三件套用可命中原词的硬模板，危机收束五项独立成块
  - legacy 档 system prompt 与改动前逐字一致，必须有 golden 断言
  - 不调低阈值、不改 AI 评分器、不跑 LLM 批次、不改数据库与队列
---
# AF-133 · 长会话收束可达性与硬模板

## 背景

AF-130 判读：style 3.312 < 3.50、overall κ 0.138462 < 0.40，AI 层面质量门未达标。
AF-131 独立复核给出更准确的归因：

- 14/16 场次结构上走不到收尾：8 个 max_turns 硬切、6 个 crisis_practice_max 先于 closeAllowed 硬切，只有 p02/p09 走到自然收尾，且 2/2 都产出 takeaway。
- style 3.312 与结构审计 takeaway 是同一证据的两种编码，不是两条独立硬门。
- κ 0.138 是评分口径未对齐（R1 系统性高约 0.31），不是质量差；本次不改评分器与阈值。

因此 AF-132（只改 prompt）方向不完整，已取消；本单承接 runner 侧可达性 + prompt 硬模板。

## 范围

允许改：

- `src/auto-practice/practice-runner.service.ts`：收束时机、forced-close cue、危机窗收束轮。
- `src/auto-practice/counselor-agent.service.ts`：把 closingCue / crisisClosing 传入 prompt builder。
- `src/auto-practice/counselor/builder/counselor-prompt-builder.ts` 与 `prompt-sections/`：硬模板块。
- 对应定向单测（可新增 `test/auto-practice/practice-runner-decide-turn.spec.ts`）。

禁止改：

- `ai-double-blind.ts`、评分阈值、`quality_annotation`、数据库 schema、队列、批次脚本。
- `engine-core/`（boundary 单测只验证未越界）。
- legacy 档 prompt 正文：必须逐字不变。

## 实现要求

### 1. runner 侧（优先）

1. 在 `runConversationLoop` 里计算 `remaining = maxTurns - i`；`remaining <= 2` 时向 `counselorAgent.generate` 传 `closingCue: "forced"`，prompt 明确“本场即将结束，这两轮内完成收束三件套并输出 END”。
2. `decideTurn` 的危机窗计时不得在 `postTurns >= crisisPracticeTurns` 时直接 `crisis_practice_max` 硬切：先返回需要收束的 `continue`（或带 `closeBlocked=false` 的 cue），至少给 1 轮风险收束；只有在收束轮之后仍继续才结束。
3. 模型 `closeRequested` 且危机窗已过披露轮（`postTurns >= 1`）时，优先返回 `crisis_practice_close`，不得被 `crisis_practice_max` 覆盖；保留 `minTurnsBeforeClose` 对常规档的约束，但危机窗激活时按“预计剩余轮数”动态放开。
4. 危机窗收束轮向 prompt 传 `crisisClosing: true`，让模型按五项（means/channel/contact/noAlone/commitment）逐项落地，不能只做 grounding。

### 2. prompt 侧

- 开场五要素：保密与例外、边界与框架、50 分钟、随时喊停/可以跳过、不录音；首轮硬模板 + 每轮补检，前 3 轮完成。
- 常规收束三件套：总结/回顾、带走/记住、下次/回去可以试；END 前自检三问，全是“是”才允许 END。
- 危机收束五项独立成块，仅在 `crisisClosing` 或危机窗激活时启用。
- 硬模板必须包含结构审计可命中的原词，但不得写成机械念稿；保留自然口语过渡。

### 3. 回归

- legacy 档 prompt 字节不变：新增 golden 断言，比较改动前后字符串（可在测试里固化期望值）。
- 定向单测覆盖：forced-close cue 出现在最后 2 轮、危机窗不硬切、closeRequested 优先、硬模板关键词、legacy 不变。

## 交付判定

- 五项闸门全绿，数字写进交付记录，不留“待用户执行”。
- 交付记录必须列出 AF-131 的 D-1/D-2 如何被本单改变，以及仍未解决的事项。
- 不产生新的质量分；复评需另登记 verification 任务并跑新批次。
