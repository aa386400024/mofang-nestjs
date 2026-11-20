---
taskId: AF-215
contextId: phase2.5-orchestration-closed-loop
title: 来访者真人度 R6：口语事件的条件分布与状态化节奏
type: implementation
status: backlog
baselineRef: 9fd9792af0ae7f860e59d8299568dbeec4631bbc
dependsOn: [AF-214]
priorTasks: [AF-207, AF-208, AF-209, AF-213, AF-214]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-21T02:33:22+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - src/shared/realism/
    - src/engine-adapters/rendering/
    - bin/
    - test/auto-practice/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
    - data/phase25-exit/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af215-realism-r6-event-conditioning-2026-11-21.md
    kind: report
  - name: 条件分布探针报告
    path: data/phase25-exit/af215-realism-event-conditioning/report.json
    kind: report
gates:
  - command: pnpm exec vitest run test/auto-practice/af215-realism-conditioning.spec.ts test/auto-practice/af213-register-scene.spec.ts test/auto-practice/af214-realism-rating.spec.ts test/auto-practice/af214-realism-blind-pack.spec.ts
    check: R6 条件分布测试 + R4/R5 回归全绿
    threshold: exit=0
  - command: pnpm typecheck
    check: 后端类型检查 0 error
    threshold: exit=0
  - command: pnpm lint
    check: lint 0 error / 0 warning
    threshold: exit=0
  - command: pnpm test
    check: 全量测试 0 failed
    threshold: exit=0
  - command: node --env-file=.env --import tsx bin/realism-event-probe.ts --target-groups 9 --max-output-tokens 160
    check: 真实 LLM 条件分布探针
    threshold: exit=0 且 guarded/steady/flooded 三组可区分
  - command: git diff --stat HEAD -- src/engine-core
    check: engine-core 零改动
    threshold: empty
successCriteria:
  - 同一角色在 steady / guarded / flooded 三个状态带得到不同的事件节奏：停顿形态、改口位置、短答偏置至少三项中两项不同；risk 仍为零事件。
  - 事件层 prompt 不再只列词表与总上限，而是写明停顿该出现在哪里、持续多长、改口发生在句中还是句缝、短答上限；off 与 audit 仍不注入一个字。
  - 新增确定性审计可区分停顿长度、改口位置、短答与碎片形态，只返回计数与分类，不返回台词原文。
  - 真实 LLM 探针至少覆盖 9 组（3 角色 × 3 状态带），guarded 的短答比例高于 steady，flooded 的长停顿或句中改口比例高于 guarded。
  - 探针与报告明确标注 AI 代理预评审，humanSupervision=false、clinicalAcceptanceEligible=false；不得写成临床达标。
  - 既有 R2/R3/R4/R5 行为回归通过；off 模式 prompt 逐字不变；engine-core 零改动。
  - 不修改 provider 配置、.env、scripts/orchestration/；不触碰 admin-dashboard 与 Flutter。
---

# AF-215 · 来访者真人度 R6：口语事件的条件分布与状态化节奏

## 1. 背景

R5 的 AI 双盲基线显示自然度 2.75/5，是最低维；两个评分员在该维度上 exact 0.75、±1 1.00、κ 0.692，说明低分是稳定共识，不是抽样噪声。交付记录给出的根因是：R2 的口语事件计划只做到“有事件”，没有做到“事件随状态变化”。

当前实现的具体问题：

1. `buildQuotas()` 只在状态带之间做少量加减，steady / guarded / flooded 的事件种类基本一致。
2. `ROLE_EVENT_TOKENS` 是角色级词表，状态不改变 token，也不改变事件发生的位置或长度。
3. prompt 只告诉模型“这一轮最多几处、候选是什么”，没有告诉它“停顿该在第一个短句之后、改口该在句中、戒备时更常一句就停”。
4. R2 审计只统计事件总数与超配额，不记录停顿长度、改口位置、短答/碎片形态，无法证明分布发生了变化。

## 2. 本单目标

把“事件数量配额”升级为“事件条件分布”，保持确定性、可审计、可复算。

### 2.1 状态化节奏

新增纯函数事件节奏，由 `role × state × scene` 决定：

- `pauseStyle`：`none` / `brief` / `held` / `broken`。guarded 只允许短停顿一次；flooded 允许长停顿或断裂停顿；steady 事件稀少。
- `repairPosition`：`none` / `clause_boundary` / `mid_sentence`。flooded 的改口发生在句中；steady 只在句缝修正；guarded 不应为了“像真人”硬改口。
- `shortAnswerBias`：`normal` / `high` / `fragmented`。guarded 短答比例最高；flooded 允许碎片但不超过两句；steady 允许一个具体细节，最多三句。
- `maxClauses`：与短答偏置一致的硬上限，供 prompt 与审计共用。

风险轮仍然全零，安全信息优先清楚。

### 2.2 Prompt 条件化

事件层 prompt 从“候选词表 + 合计上限”改成条件指令，至少包含：

- 停顿出现的位置与长度；
- 改口发生的位置；
- 这一轮最多几个短句/分句；
- 哪些事件在该状态下不自然、不要硬加。

off / audit 仍不注入；只有 active 生效。

### 2.3 审计可观测

扩展 `inspectVisitorRealism` 或其同级纯函数，输出：

- 每类事件计数；
- 停顿 span 数量与长度分类；
- 改口位置分类；
- 句子数、分句数、是否短答、是否碎片。

只返回分类与计数，不返回台词。

### 2.4 真实 LLM 探针

新增 `bin/realism-event-probe.ts`，用同一段咨询师刺激、同一角色底色，遍历 3 个状态带，构建真实 active prompt 并调用模型；输出只含分组、分类计数、是否短答/长停顿/句中改口，不含台词原文。

探针不是生产会话，不替代 R5 双盲评分，也不替代真人督导；它只验证“同一角色在不同状态下，事件分布是否真的不同”。

## 3. 不做

- 不做线上场景补样本（R6-C）；当前 `online_voice/online_text` 切片仍为 0。
- 不做评分稳定性专项（R6-B）。
- 不做真人督导师双标，`clinicalAcceptanceEligible` 保持 false。
- 不改 provider、`.env`、`scripts/orchestration/`。
- 不改 engine-core。

## 4. 闸门

见 frontmatter `gates`。定向测试至少覆盖：

- 三角色 × 三状态的事件节奏差异；
- risk 全零；
- off / audit prompt 空；
- 停顿长度、改口位置、短答分类；
- R2/R3/R4/R5 回归。

## 5. 交付

- 交付记录：`docs/worklog/completed/phase2.5/af215-realism-r6-event-conditioning-2026-11-21.md`
- 探针报告：`data/phase25-exit/af215-realism-event-conditioning/report.json`（gitignored，交付记录引用）
- 机读回执：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-215/receipt-RC-AF-215-1.json`
