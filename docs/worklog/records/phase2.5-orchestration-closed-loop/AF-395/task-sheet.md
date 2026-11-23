---
taskId: AF-395
contextId: phase2.5-orchestration-closed-loop
title: 引擎调试三模型 TTS 对比接入与零成本治理
type: implementation
status: backlog
baselineRef: b58d64cf958ad83dcc775b9633d25382ba4e95ec
dependsOn: []
priorTasks: [AF-394]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T01:00:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/admin-debug/
    - src/migration/
    - bin/ormconfig.ts
    - src/agent/llm/
    - src/config/envs/
    - admin-dashboard/src/views/AutoPractice.vue
    - admin-dashboard/src/api/client.ts
    - test/admin-debug/
    - test/agent/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af394-debug-tts-and-zero-cost-governance-2026-11-24.md
    kind: report
gates:
  - command: pnpm exec vitest run test/admin-debug
    check: 调试 TTS 定向用例全绿
    threshold: 全绿
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排健康投影用例全绿
    threshold: 全绿
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
  - command: pnpm test
    check: 全量用例全绿
    threshold: 全绿
successCriteria:
  - 三个零成本治理项有可核验结论；编排回执告警不再把归档/取消任务算作运行健康异常。
  - MiniMax 流式调用有显式 include_usage 开关，默认不改变既有生产请求体。
  - zero_motion 给出静态根因与不改 prompt 的安全结论，需要真实模型验证的部分登记为后续付费批次。
  - 调试页自动对练与手动调试的来访者气泡在点击时分别调用 MiniMax HD、MiniMax Turbo、豆包 Seed TTS 2.0。
  - 同一会话同一轮同一模型二次点击只读缓存，不重复调用上游。
  - 豆包走 Agent Plan 语音接口且不在未开启抵扣时降级普通 API。
  - 前端不接触任何 API key；src/engine-core 一行不动。
---

# AF-394 · 引擎调试三模型 TTS 对比接入与零成本治理

## 背景

引擎调试页需要在不影响 Flutter 生产语音链路的前提下，对比 AI 来访者侧的三个 HTTP TTS 模型：

- MiniMax `speech-2.8-hd`
- MiniMax `speech-2.8-turbo`
- 豆包 `doubao-seed-tts-2.0`（Agent Plan 语音通道）

交互约束：回复气泡 hover 只展示三个工具按钮，不预取；点击才生成；生成过的同一会话同一轮同一模型再次点击直接回放缓存，不重复调用上游。

同时收口三项零成本治理：

1. 编排运行健康对归档/取消任务的陈旧回执告警误报。
2. MiniMax 流式调用补 `include_usage` 成本取证能力，默认不改变既有生产行为。
3. `zero_motion` 的静态根因定位与不改 prompt 的安全结论；需要真实模型验证的部分登记为后续付费批次，不擅自执行。

## 范围边界

- 只改 `admin-dashboard` 的引擎调试页与后端 `admin-debug` 调试专用接口，不碰 Flutter，不改生产 `src/voice` 链路。
- API key 只放服务端环境变量，前端、日志、文档、回执均不得出现明文。
- 豆包接口必须走 Agent Plan；若账户未开启 Agent Plan 抵扣，记录为环境阻塞，不降级到普通 API token。
- `src/engine-core` 一行不动。


