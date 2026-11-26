---
taskId: AF-561
contextId: phase2.5-audit-remediation
title: Phase2.5 出口④安全收束门 + Max TTS 并发治理 + 会员 TTS 权益口径对齐
type: implementation
status: backlog
baselineRef: 0268e96da68fa7697dba00cad3559ff120dc7eb9
riskClass: R2
gateProfile: full
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-27T10:00:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/auto-practice/practice-runner.service.ts
    - src/auto-practice/metrics/session-structure-audit.ts
    - test/auto-practice/
    - src/voice/tts/
    - test/voice/
    - src/membership/
    - test/membership/
    - docs/worklog/pending/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-audit-remediation/AF-560/
  modules: [auto-practice, voice, membership]
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af560-safety-tts-membership-closure-2026-11-27.md
    kind: report
gates:
  - command: pnpm exec vitest run test/auto-practice test/voice test/membership
    check: 定向全绿
    threshold: exit 0
  - command: pnpm typecheck
    check: 0 error
    threshold: exit 0
  - command: pnpm lint
    check: 0 error
    threshold: exit 0
  - command: pnpm test
    check: 全绿
    threshold: exit 0
successCriteria:
  - 危机窗内咨询师请求收尾时，风险五组未覆盖不得直接结束；必须进入修复轮，覆盖齐后才允许 crisis_practice_close
  - 修复轮后仍缺失时以 crisis_safety_incomplete 结束，crisisOutcome=incomplete，不伪装成 safety_plan_completed
  - 豆包 premium TTS 会话接入并发上限与排队，超限不无限建连；MiniMax 既有池行为不回退
  - 会员套餐对外 ttsModel 与 resolver 实际档位一致：Max=premium、Pro=hd、Free/Plus=turbo
  - 补对应单测，全量测试全绿，engine-core 零 diff
  - 交付记录写清改动、偏差、闸门真实数字
---

# AF-560 · Phase2.5 出口④安全收束门 + Max TTS 并发治理 + 会员 TTS 权益口径对齐

## 背景

AF-529 出口④复评六门 5/6，唯一失败项 safety：packet-09/10/20/36/37/46 为 2 分。复评证据显示其中 10/37 为真实危机披露但全稿无安全计划，36/46 与 20 存在“咨询师筛查提问/第三方担忧”触发评测封顶的口径问题。产品侧先修“危机窗允许在未覆盖风险五组时直接收尾”的出口缺陷，避免真实用户对练出现披露风险但无安全计划的会话。

同时处理两项已确认的工程债：
- 豆包 premium TTS 一场一条 WS，无并发上限与排队；AF-557 已登记 BL-AF557-04。
- 会员套餐 `ttsModel` 对外字段 Max 仍写 HD，但 TTS resolver 对 max 档实际解析 premium，存在对外口径与实际档位不一致。

## 范围

只改 auto-practice 危机收尾判定、voice TTS 会话并发治理、membership 套餐常量与对应测试/交付记录；不动 engine-core，不改 Flutter，不改 admin-dashboard。

## 不在范围

- 不重跑 48 packet、不改历史评测分数。
- 不做 1000 场出口⑤批次（另立任务）。
- 不改真支付、退款、法务留存等待外部依赖项。
