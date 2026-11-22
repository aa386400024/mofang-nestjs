---
taskId: AF-271
contextId: phase2.5-orchestration-closed-loop
title: 来访者主候选豆包→MiniMax→豆包回滚切流演练与真实路由 smoke
type: verification
status: backlog
baselineRef: fbee66e442d87d6400eaffa904580e16464fb385
dependsOn: [AF-270]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: "2026-11-22T12:00:00+08:00"
deadline: null
agentRole: executor
scope:
  files:
    - bin/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af271-rollback-cutover-rehearsal-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec tsc --noEmit -p tsconfig.json
    check: 回滚演练开关类型闭合
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm exec tsx bin/visitor-switch-check.ts --expect-primary doubao
    check: 当前真实 .env 主候选仍是豆包
    threshold: exit=0
  - command: pnpm exec tsx bin/visitor-switch-check.ts --expect-primary minimax --simulate-visitor-provider minimax
    check: 模拟回滚后候选链真实变为 MiniMax 主候选
    threshold: exit=0
  - command: pnpm exec tsx bin/visitor-render-smoke.ts --provider minimax --caller router --turns 5
    check: 回滚态真实路由 5 轮全走 MiniMax
    threshold: exit=0
---
# AF-271 · 来访者主候选回滚切流演练

## 背景

AF-263 完成了 `minimax → doubao` 的正向切流，并留下 `visitor-switch-check` 只读自检。但生产可用性还缺**反向证据**：一旦豆包角色模型故障或成本异常，运维能不能把主候选切回 MiniMax，并且真实路由确实按预期走？

当前 `visitor-switch-check` 的 `ok` 写死为 `primary === doubao`，`visitor-render-smoke --caller router` 也拒绝 `--provider minimax`，回滚方向没有可机读 gate。

## 目标

1. `visitor-switch-check.ts` 增加 `--expect-primary doubao|minimax`，`ok` 按期望值判定，默认仍是 doubao（零回归）。
2. 增加 `--simulate-visitor-provider doubao|minimax`：仅在本进程注入 env，用于演练回滚态，不写 `.env`。
3. `visitor-render-smoke.ts` 允许 `--caller router --provider minimax`，并把候选断言改为通用 `providerHint === provider`。
4. 真实跑通「豆包主候选 → 模拟切回 MiniMax 主候选 → 恢复豆包」三段演练：
   - 当前 `.env` 自检：`primary=doubao`；
   - 模拟回滚自检：`primary=minimax`，候选链无豆包；
   - 回滚态真实路由 5 轮：5/5 `providerHint=minimax`、`model=MiniMax-M3`、`fallbackUsed=false`、`degraded=false`、`finishReason=stop`；
   - 恢复后自检：`primary=doubao`。
5. 不改真实 `.env`，不写生产配置，不消耗额外豆包故障注入额度。

## 非目标

- 不改 `RenderConfigFactory` 的候选派生规则与 `VISITOR_LLM_PROVIDER` 语义。
- 不做线上蓝绿/双跑；本任务只证明本地配置可逆、真实路由可走。
- 不验证 MiniMax 与豆包的语义质量差异；质量由既有评测链路负责。
- 不改 401 策略与超时策略。

## 验收

- 四个 gate 命令全 exit 0。
- 回滚态真实 5 轮 smoke 全走 MiniMax 主候选，零回退零降级，`finishReason=stop`。
- 演练前后 `visitor-switch-check` 默认期望仍为 doubao，证明 `.env` 未被改动。
- tsc / lint 0 error；engine-core 零改动。
