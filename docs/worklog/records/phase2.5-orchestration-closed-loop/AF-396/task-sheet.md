---
taskId: AF-396
contextId: phase2.5-orchestration-closed-loop
title: 引擎调试三模型 TTS 对比接入与零成本治理（补齐 env 模板域）
type: implementation
status: backlog
baselineRef: b58d64cf958ad83dcc775b9633d25382ba4e95ec
dependsOn: []
priorTasks: [AF-395, AF-394]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T01:20:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/admin-debug/
    - src/migration/
    - bin/ormconfig.ts
    - src/agent/llm/
    - src/config/envs/
    - .env.example
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
    path: docs/worklog/completed/phase2.5/af396-debug-tts-and-zero-cost-governance-2026-11-24.md
    kind: report
gates:
  - command: pnpm exec vitest run test/admin-debug/debug-tts.spec.ts test/agent/llm-doubao-usage.spec.ts test/config/wp25-env-example-coverage.spec.ts
    check: TTS / MiniMax usage / env 模板覆盖用例全绿
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
  - command: admin-dashboard type-check
    check: 0 error
    threshold: exit=0
successCriteria:
  - 调试页自动对练与手动调试的来访者气泡在点击时分别调用 MiniMax HD、MiniMax Turbo、豆包 Seed TTS 2.0。
  - 同一会话同一轮同一模型二次点击只读缓存，刷新页面后仍由后端缓存命中，不重复调用上游。
  - MiniMax 流式调用有显式 include_usage 开关，默认不改变既有生产请求体。
  - 豆包走 Agent Plan 语音接口且不在未开启抵扣时降级普通 API。
  - zero_motion 给出静态根因与不改 prompt 的安全结论，需要真实模型验证的部分登记为后续付费批次。
  - 新增环境键在 .env.example 有生效行，env 模板契约用例全绿。
  - 前端不接触任何 API key；src/engine-core 一行不动。
---

# AF-396 · 引擎调试三模型 TTS 对比接入与零成本治理（补齐 env 模板域）

## 背景

AF-395 在实现过程中触发了 `test/config/wp25-env-example-coverage.spec.ts` 的 env 模板契约：新代码读取了 `ARK_AGENT_PLAN_API_KEY` / `ARK_AGENT_PLAN_TTS_BASE_URL` / `ARK_AGENT_PLAN_TTS_SPEAKER` / `MINIMAX_LLM_INCLUDE_USAGE` / `MINIMAX_TTS_DEFAULT_VOICE`，但 AF-395 的 scope 未包含根目录 `.env.example`，导致补模板会被 preflight 判为越界。

因此按编排规则，将 AF-395 重签发为 AF-396，scope 显式加入 `.env.example`；实现代码、迁移、单据路径沿用 AF-395 已落地的内容，避免重写。

## 范围边界

- 只改调试页与调试专用后端模块，不碰 Flutter，不改生产 `src/voice` 链路。
- API key 只在服务端环境变量；前端、日志、文档、回执不得出现明文。
- `.env.example` 只补键名和空值/安全默认，不写真实 key。
- `src/engine-core` 一行不动。

## 交付记录

`docs/worklog/completed/phase2.5/af396-debug-tts-and-zero-cost-governance-2026-11-24.md`
