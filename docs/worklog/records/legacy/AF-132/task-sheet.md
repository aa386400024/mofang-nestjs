---
taskId: AF-132
contextId: phase2.5-ai-proxy-acceptance
title: 长会话开场/收尾硬模板与结构化依从（AF-130 未达标项修复）
type: implementation
status: backlog
baselineRef: 86a7c8580302c018047c900bc91d6beef9ce339a
dependsOn: [AF-130]
priorTasks: [AF-127, AF-129, AF-130]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-19T14:50:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - src/auto-practice/counselor/builder/prompt-sections/
    - src/auto-practice/counselor/builder/counselor-prompt-builder.ts
    - test/auto-practice/counselor-prompt-builder.spec.ts
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af132-prompt-hard-template-2026-11-19.md
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
  - command: pnpm exec vitest run test/engine-core/boundary.spec.ts
    check: 边界单测全绿
    threshold: exitCode=0
successCriteria:
  - 开场五要素改为首轮/前 3 轮可命中的硬模板，保留危机优先
  - 常规收束三件套给出可直接照做的句式，不伪造来访者发言
  - 危机收束五项独立成块，仅在危机/风险收尾时启用
  - legacy 档 prompt 字节不变；long/standard 档才启用
  - 定向单测覆盖硬模板关键词与启用边界
---

# AF-132 · 长会话开场/收尾硬模板

## 背景

AF-130 判定未达标：style 3.312（<3.50）、overall κ 0.138462（<0.40）。结构审计显示开场全项 4/16、常规收束三项 0/16、危机收束完整 4/16。根因不是模型不会说，而是 prompt 只给“说什么”，没有给“必须原样出现的结构句”，模型在自然口语中把关键词改写了，审计无法命中，评分员也给低 style。

## 范围

- 只改 `src/auto-practice/counselor/builder/prompt-sections/`、`counselor-prompt-builder.ts`、对应单测。
- 不改 AI 双盲评分阈值、不改 `ai-double-blind.ts` 的硬上限、不改数据库/队列、不跑 LLM 批次。
- legacy 档保持逐字不变；long/standard 档启用硬模板。

## 交付判定

- 硬模板必须包含审计可命中的原词：保密、例外、边界、约定、50 分钟、每周一次、随时喊停、可以跳过、不录音；常规收束包含“总结/回顾”“带走/记住”“下次/回去可以试”；危机收束包含 means/channel/contact/noAlone/commitment 五类语义。
- 通过定向单测与 tsc/lint/boundary 四项闸门；不做全量测试。
- 本单只修 prompt 结构，不产生新的质量分；复评需另登记 verification 任务。
