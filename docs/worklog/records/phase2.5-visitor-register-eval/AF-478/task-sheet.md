---
taskId: AF-478
contextId: phase2.5-visitor-register-eval
title: 补缓存命中观测并重跑 10 角色 paired 600 轮成本评测
type: implementation
status: backlog
baselineRef: 3d5d4a4bece1df81bfa888443c5eb7fa8961b35d
dependsOn: [AF-475]
priorTasks: [AF-466, AF-471, AF-475]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.2, conventions.md#1.3]
createdAt: 2026-11-25T09:30:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/llm/
    - src/engine-adapters/rendering/
    - src/admin-debug/
    - src/voice/
    - test/llm/
    - test/engine-adapters/
    - test/admin-debug/
    - scripts/eval/visitor-register-stability/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-visitor-register-eval/AF-478/
  modules:
    - llm-provider-usage
    - rendering-usage
    - admin-debug
    - visitor-register-eval
  interfaces:
    - chat-provider-usage
    - stream-render-outcome
    - debug-session-llm-usage
    - run-sessions
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af476-register-cache-observability-and-paired-rerun-implementation-2026-11-25.md
    kind: report
  - name: 成本评测报告
    path: docs/worklog/completed/phase2.5/af476-register-paired-cost-rerun-2026-11-25.md
    kind: report
gates:
  - command: pnpm exec vitest run test/llm/minimax-provider.spec.ts test/engine-adapters/wp8b-stream-render.spec.ts test/admin-debug/wp58-debug-session.spec.ts scripts/eval/visitor-register-stability/__tests__/metrics.spec.mjs
    check: 缓存用量解析、渲染归约、调试 trace 与评测聚合单测全绿
    threshold: 0 failed
  - command: pnpm build
    check: 生产构建通过
    threshold: 0 error
  - command: pnpm lint
    check: lint 通过
    threshold: 0 error
  - command: pnpm typecheck
    check: 类型检查通过
    threshold: 0 error
successCriteria:
  - ChatCompletionChunk 与 ChatCompletionResponse 增加可选 cachedTokens；缺省表示上游没报，不用 0 冒充。
  - provider 同时解析 OpenAI 兼容 prompt_tokens_details.cached_tokens 与 Anthropic 兼容 cache_read_input_tokens；流式与聚合路径一致。
  - cachedTokens 经渲染归约、debug trace llmUsage、评测逐轮 row 与 metrics 聚合端到端透传；旧口径不破。
  - 新增单测覆盖两种上游形状、缺省形状与流式/聚合归约。
  - 3010 后端可启动且 /health 通过；10 角色 × base/active × 30 轮 paired 评测跑满 600 轮，0 失败轮。
  - 报告给出逐角色 p95 比值、pooled p95、bootstrap 区间与缓存命中率；明确成本门 pass/fail，失败时给出下一步单变量方案。
  - 不改生产 prompt、不压缩语域块、不改 context budget、不碰 src/engine-core。
  - lint、typecheck、build 与目标单测通过；全量闸门在交付前跑一次并记录真实数字。
---

## 1. 背景

AF-466 的 10 角色 base/active 评测暴露了两个问题：语域块 active 的 p95 延迟中位 +32.06%，超过 ≤15% 的成本门；同时 `gatePass=false` 还包含 `abstractTermRate` 回归。AF-471 归因为后段解码变慢、轮次累积与运行漂移，但缺少一个关键观测维度：MiniMax 的自动前缀缓存到底命中了多少。AF-475 已把评测改成单进程逐轮配对，但真实 600 轮尚未跑，p95 门仍未证明通过。

## 2. 目标

先把缓存命中从 provider 到评测产物端到端打通，再用同一进程逐轮配对跑满 600 轮，得到一份能解释延迟构成的干净数据：如果成本门仍失败，要能区分是语域块更长导致的后段解码成本、缓存未命中，还是运行噪声。

## 3. 实现口径

- `src/llm`：`ChatCompletionChunk` / `ChatCompletionResponse.usage` 增加可选 `cachedTokens`；OpenAI 兼容 provider 从 `usage_metadata.input_token_details` 与 `response_metadata.usage` 两条形状解析，兼容 `cache_read_input_tokens`。
- 渲染适配器：流式累计器与聚合路径都保留 cachedTokens，最终进入 `StreamRenderOutcome.usage` 与内核 `RenderResult.usage` 的适配层副本；不修改 `src/engine-core` 契约。
- 调试链路：`DebugTurnTrace.llmUsage` 增加 `cachedTokens`，缺省为 null；调试会话响应可读。
- 评测链路：逐轮 row、`metrics.mjs` 聚合与 `latency-attribution.mjs` 增加缓存命中率/占比；报告以逐角色与 pooled 两个口径输出。
- 评测跑法：`PORT=3010` 启动单进程，remote MySQL/Redis 由 `.env` 提供；`run-sessions.mjs --paired --port 3010 --run-id af476-2026-11-25-10roles --task-id AF-478`。

## 4. 非目标

- 不改生产 system prompt、不压缩语域块、不调整 `MAX_HISTORY_TURNS` 或 `contextTokens`。
- 不改 `src/engine-core`；不在本次修 `abstractTermRate` 的产品/门槛决策。
- 不把原始台词写进仓库；原始逐轮产物只落 gitignored 的 `data/eval-reports/`。
- 不宣称成本门通过，除非 600 轮真实数据与门槛计算都成立。

