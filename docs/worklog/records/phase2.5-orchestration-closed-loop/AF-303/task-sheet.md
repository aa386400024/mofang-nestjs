---
taskId: AF-303
contextId: phase2.5-orchestration-closed-loop
title: 渲染验收器补齐「主候选失败→备候选成功」回退成功路径
type: implementation
status: backlog
baselineRef: d6243222f6c7eb2cb3ccc48b71184714118c2922
dependsOn: []
priorTasks: [AF-302, AF-299]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.1, conventions.md#1.3]
createdAt: "2026-11-22T19:58:00+08:00"
deadline: null
agentRole: executor
scope:
  files:
    - bin/visitor-render-acceptance.ts
    - bin/lib/render-acceptance-checks.ts
    - test/engine-adapters/af302-render-acceptance-checks.spec.ts
    - docs/runbooks/render-telemetry-alerting.md
    - docs/worklog/completed/phase2.5/af303-acceptance-fallback-2026-11-22.md
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-303/
  modules: [engine-adapters]
  interfaces: []
artifacts:
  - name: AF-303 交付记录
    path: docs/worklog/completed/phase2.5/af303-acceptance-fallback-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec tsx bin/visitor-render-acceptance.ts --only single-fallback
    check: 回退成功路径真实自证
    threshold: exit=0 且 PASS 1 / FAIL 0
  - command: pnpm exec vitest run test/engine-adapters/af302-render-acceptance-checks.spec.ts
    check: 断言纯函数单测
    threshold: exit=0 且 0 failed
successCriteria:
  - 新增 `single-fallback` 场景：`--fail-primary --fail-primary-mode server-error --expect-fallback`。
  - 期望按 2026-11-22 真实取证 `data/af303-smoke.log`：`rounds{success}=1`、`attempts{doubao,retry}=1`、`attempts{minimax,success}=1`、`failure{doubao,server}=1`、`fallback{doubao→minimax,cause=server}=1`、`degraded_total` 全标签和为 0、`cooldown_served_total=0`。
  - 全量运行 6 场景 PASS / FAIL 0 / 未执行 0；反向验证把 `rounds{success}` 改成 0 必须精确 FAIL 且 exit 1。
  - Runbook §5.1 故障矩阵补「回退成功」行，§5.2 场景清单与耗时改六条。
  - 闸门：定向测试全绿、typecheck 0、全量 lint 0、全量测试全绿、`src/engine-core` 零改动。
plannedArtifacts:
  - name: AF-303 交付记录
    path: docs/worklog/completed/phase2.5/af303-acceptance-fallback-2026-11-22.md
    kind: report
---
