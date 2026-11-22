---
taskId: AF-254
contextId: phase2.5-orchestration-closed-loop
title: 引擎渲染路径豆包端到端 smoke
type: implementation
status: backlog
baselineRef: 393cb30c0534355b1651be4108c064454d02630a
dependsOn: [AF-252, AF-253]
priorTasks: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-22T08:10:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/engine-adapters/wiring/
    - test/engine-adapters/
    - bin/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af254-render-doubao-smoke-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec vitest run test/engine-adapters/af254-llm-service-chat-caller.spec.ts
    check: LlmService ChatCaller 映射与错误语义全绿
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm exec tsc --noEmit -p tsconfig.json
    check: CI 全量 typecheck 0 error
    threshold: exit=0
---
# AF-254 · 引擎渲染路径豆包端到端 smoke

## 背景

AF-252/AF-253 只验证了装配期候选与模型解析，没有让真实豆包请求走一遍引擎渲染适配器：

- `RenderConfigFactory` 产出 `{provider: doubao, model: doubao-seed-character-260628}`；
- `buildEngineRenderPort` 的 `LlmRenderAdapter` 走候选主备、流式状态机、prompt 组装与输出 guard；
- 真正的上游调用应经 `ChatCaller`，生产是 `RouterChatCaller`。

缺少这条链的真实证据，生产切换只能证明“环境变量被读到了”，不能证明“来访者真的能通过引擎渲染说出一句安全的口语”。

## 目标

1. 新增可复用的 `LlmServiceChatCaller`：把 `LlmService.streamChat` 映射成 `ChatCaller.stream`，供 smoke 与后续离线验证使用。
2. 新增 `bin/visitor-render-smoke.ts`：只读 `.env`，用 `VISITOR_LLM_PROVIDER=doubao` 走 `RenderConfigFactory → buildEngineRenderPort → LlmRenderAdapter → LlmService → 豆包`，真实调用一次。
3. smoke 输出候选序列、实际候选、模型、TTFT、usage、finishReason、降级标记与前 80 字预览，不打印密钥与完整 prompt。
4. 真实运行一次并记录证据。

## 非目标

- 不改 `src/engine-core`。
- 不改生产 `.env`，不改 AF-252 的候选/模型解析逻辑。
- 不做并发、429/5xx、长对话压测（另开任务）。
- 不做成本分 provider 分账（另开任务）。

## 验收

- `LlmServiceChatCaller` 单测覆盖 content/done/error 与参数透传。
- 真实 smoke 成功：`providerHint=doubao`，文本非空，usage 非全 0。
- 定向测试、lint、CI 同口径 tsc、全量测试全绿；`git diff HEAD -- src/engine-core` 为空。
