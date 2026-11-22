---
taskId: AF-024
contextId: phase2.5-orchestration-closed-loop
title: GUI 派发通道接入（桌面 relay 承载 MiniMax Code）
type: implementation
status: submitted
baselineRef: 04f6524
dependsOn: [AF-023, AF-013]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs:
  - conventions.md#1.3
  - conventions.md#1.4
createdAt: 2026-11-17T09:40:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/
    - docs/team/agent-orchestration/
  modules: []
  interfaces: []
artifacts:
  - name: GUI 派发通道实施记录
    path: docs/worklog/completed/phase2.5/af024-gui-dispatch-implementation-2026-11-17.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 通道决策与回执校验单测全绿
    threshold: 'failed=0'
  - command: ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate
    check: 适配层框架 schema 校验全 PASS
    threshold: 'fail=0'
successCriteria:
  - dispatch-channel 不再是纯规则函数：GUI 承载方可被真实拉起、定位输入会话、投递任务单并回写 dispatch 记录
  - 投递失败有明确失败原因与回滚，不把「已粘贴」当成「已送达」
  - 桌面自动化不可用时降级到文件 Transport，并在 dispatch 记录标注 channel=gui-file-fallback
evidenceFormat: 命令 + exit code + 用例数；GUI 证据取 dispatch 记录与回执文件时间戳
---

# AF-024 GUI 派发通道接入（任务单）

## 1. 背景

AF-013 已把派发通道规则固化为 `dispatch-channel.mjs`（`canDispatch`、单任务队列、GUI 规则），但 CLI `channel` 只是只读视图，真正拉起 MiniMax Code、定位输入框、发送并校验的实现尚未落地。G1 因此长期停在「文件 Transport 闭环 + 人工粘贴」。

## 2. 目标

把 GUI 承载做成可替换的 channel 执行器：规则判定与副作用执行分离，执行器可注入（桌面自动化 / 文件 Transport），失败可回滚、可观测，不把人工粘贴冒充自动投递。

## 3. 切片（scope）

纳管 `scripts/orchestration/` 的通道执行器与 CLI 接线、`docs/team/agent-orchestration/` 的通道口径与证据。不纳管业务代码，不改 MiniMax Code 本体，不引入常驻守护进程。

## 4. 验收

- 单测覆盖：规则拒绝、执行器异常回滚、投递成功写 dispatch、GUI 不可用降级；
- `orchestration:validate` 全 PASS；
- 一次真实 GUI 投递（若桌面自动化可用）或明确的降级证据。

## 5. 状态

✅ 已交付（2026-11-17）。真实 GUI 投递已执行并经 `channel confirm` 回写 `delivered`（会话路径 `new-task`、定位层 `paste-verify`、证据 `AF-024.sent.png`）；executor 独立评审（`af024-channel-review-by-executor.md`）查出 5 处漏口已全部整改，协商轮交接件 `transport/reviews/AF-024-review.json` 通过 `review-handover 1.1.0` 校验。交付记录见 `docs/worklog/completed/phase2.5/af024-gui-dispatch-implementation-2026-11-17.md`。
