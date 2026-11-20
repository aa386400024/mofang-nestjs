---
taskId: AF-046
contextId: phase2.5-orchestration-closed-loop
title: CI 门禁实弹演练（branch merge --require-ci 阻断与放行双路径）
type: verification
status: ready
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs:
  - conventions.md#1.3
  - conventions.md#1.4
createdAt: 2026-11-17T04:40:00.000Z
deadline: null
agentRole: orchestrator
scope:
  files:
    - docs/team/agent-orchestration/
    - docs/worklog/pending/
    - docs/worklog/completed/
  modules: []
  interfaces: []
artifacts:
  - name: 演练记录
    path: docs/team/agent-orchestration/ci-gate-fire-drill-2026-11-17.md
    kind: report
gates:
  - command: node scripts/orchestration/cli.mjs branch merge --taskId AF-046 --require-ci --sha <分支提交>
    check: 阻断路径必须退非零并判 unknown
    threshold: 'exit=2'
  - command: node scripts/orchestration/cli.mjs branch merge --taskId AF-046 --require-ci --sha <CI 全绿提交> --apply
    check: 放行路径判 pass 并完成 squash 合并
    threshold: 'exit=0'
successCriteria:
  - 阻断路径用真实 REST 取数判 unknown 并中止，分支不被改写
  - 放行路径在同一分支上判 pass 后完成 squash-merge → commit，合并提交真实落入 integrate
  - 演练记录写清两次调用的 sha、verdict、check 数与合并提交 hash
evidenceFormat: 两次 CLI 调用的 sha + verdict + check 数 + 合并提交 hash
---

# AF-046 任务单（CI 门禁实弹）

## 1. 为什么单独立单

`--require-ci` 此前只有单测（假 REST 响应）覆盖，没有一次真实远端结论真正决定过合并。实弹演练要造「有分支、有提交、有 CI」的真实条件，且合并会改写 `integrate`，不能混进实现单的 scope。

## 2. 为什么这份单不登记 baselineRef

`verifyBaseline` 的判据是「`task.baselineRef` == **当前 HEAD**」。本单的任务单必须先落库（否则 `branch merge` 报「任务不在索引中」），而落库本身就是一次提交，写入任何固定 SHA 都会在合并前一刻变成漂移。缺 `baselineRef` 时 `verifyBaseline` 返回 `matches: null` + `reason: 任务记录未登记 baselineRef`，口令可见、不静默——演练要测的是 **CI 门禁**，基线面保持显式跳过，不伪造一个刚好对上的 SHA。

## 3. 做法

1. `git switch -c task/AF-046-af-046`（自 `integrate` 切出，分支名符合 `task/<taskId>-<slug>`）；
2. 在分支上做一次真实文档改动（README §5.3 门禁一节点指向演练记录），提交并 push；
3. **未触发 CI** 时执行 `branch merge --require-ci`（不带 `--apply`）：应判 `unknown` 并中止——**阻断路径**；
4. `workflow_dispatch` 对该 ref 手动触发 CI，等 12 项 check 全 `completed`；
5. 再执行同命令 + `--apply`：判 `pass` 后走 `squash-merge → commit`——**放行路径**。

## 4. 判据

阻断路径退出码 2 且错误文案含 `unknown`；放行路径输出「远端 CI 通过：N 项 check」并产生合并提交；两条路径的 sha / check 数写进演练记录与交付记录。
