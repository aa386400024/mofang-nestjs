---
taskId: AF-275
contextId: phase2.5-orchestration-closed-loop
title: 自动补备候选凭据守卫与按候选鉴权回退
type: implementation
status: backlog
baselineRef: b8e94a5b9946f1f801311957387b983eb6877d6d
dependsOn: [AF-274, AF-273]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: "2026-11-22T12:40:00+08:00"
deadline: null
agentRole: executor
scope:
  files:
    - src/engine-adapters/wiring/render-config.factory.ts
    - src/engine-adapters/rendering/llm-render.adapter.ts
    - bin/visitor-switch-check.ts
    - bin/visitor-render-smoke.ts
    - .env.example
    - test/engine-adapters/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af275-candidate-credential-auth-fallback-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec vitest run test/engine-adapters/af275-candidate-credential-guard.spec.ts test/engine-adapters/af275-auth-fallback.spec.ts test/engine-adapters/af273-rollback-failover-guard.spec.ts
    check: 凭据装配守卫 + 鉴权切备 + AF-273 回归
    threshold: exit=0
  - command: pnpm exec tsc --noEmit -p tsconfig.json
    check: 候选计划与凭据守卫类型闭合
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm exec tsx bin/visitor-render-smoke.ts --provider doubao --caller router --turns 3 --fail-primary --fail-primary-mode auth --expect-fallback
    check: 主候选 401 真实切到 MiniMax 备候选且零降级
    threshold: exit=0
  - command: pnpm exec tsx bin/visitor-switch-check.ts --expect-primary doubao
    check: 正向候选链双方 key 可见
    threshold: exit=0
  - command: pnpm exec tsx bin/visitor-switch-check.ts --expect-primary minimax --simulate-visitor-provider minimax
    check: 回滚态双方 key 可见
    threshold: exit=0
---
# AF-275 · 自动补备候选凭据守卫与按候选鉴权回退

## 背景

AF-273 让回滚态自动补豆包备候选，但只保证候选存在，没有保证候选可用。自动补出来的备候选缺 `LLM_DOUBAO_API_KEY` / `MINIMAX_API_KEY` 时，装配期只看到两个候选，故障真的发生才在运行期报 "API key not found"，用户仍然只听到兜底句。与此同时 `classifyFailure` 仍按 M7 的旧假设「坏 key 对所有候选都坏」把 401/403 判成不可切备；现在主备是不同厂商、独立 key，主 key 轮换不应拖死整场。

## 目标

1. `RenderConfigFactory` 自动补出来的备候选缺 apiKey 时，装配期直接抛错，不受 `ENGINE_RENDER_REQUIRE_FAILOVER` 影响。
2. 显式配置的候选缺 key：`REQUIRE_FAILOVER=true` 抛错，否则只告警，保留既有部署弹性。
3. 候选先去重，再判断是否需要自动补对端；`ENGINE_RENDER_FALLBACK_PROVIDERS` 填成主候选时不能骗过补备逻辑。
4. `classifyFailure` 把 401/403 改为可切备；主备都鉴权失败时自然耗尽并降级，不无限重试。
5. `visitor-switch-check` 输出每个候选的 `envKey` / `present`，任一候选缺 key 直接失败。
6. 移除 `.env.example` 中重复的 `ENGINE_RENDER_REQUIRE_FAILOVER`，补清楚自动补备与缺 key 策略。

## 非目标

- 不改流式块间空闲超时键，不改首包预算（AF-276）。
- 不新增 provider、不改模型映射与价格。
- 不做线上双跑或部署级 key 轮换演练。
- 不把显式 fallback 的非对端选择强行改写为对端。

## 验收

- 定向 19 例全绿（凭据 9 + 鉴权切备 4 + AF-273 回归 6）。
- 真实 auth smoke：主候选豆包 401 → 3/3 MiniMax、`fallbackUsed=true`、`degraded=false`、`finishReason=stop`。
- 正向/回滚自检均 exit 0，且 `candidateApiKeys` 两家 `present=true`。
- tsc 0 error；lint 0 error；全量测试全绿；`git diff --stat HEAD -- src/engine-core` 为空。
