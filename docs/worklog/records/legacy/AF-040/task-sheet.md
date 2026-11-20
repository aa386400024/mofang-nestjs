---
taskId: AF-040
contextId: phase2.5-orchestration-closed-loop
title: 改进台账未实现项收口（通道可靠性 / 分支收口 / 远端 CI 门禁 / 口径裁定）
type: implementation
status: backlog
baselineRef: ba582325d10426d5bf194048b07899dcb3a1a373
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs:
  - conventions.md#1.3
  - conventions.md#1.4
createdAt: 2026-11-17T03:50:00.000Z
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/
    - docs/team/agent-orchestration/
    - docs/worklog/pending/
    - docs/worklog/completed/
  modules: []
  interfaces: []
artifacts:
  - name: 通道失败口径裁定书
    path: docs/team/agent-orchestration/channel-failure-decisions-2026-11-17.md
    kind: report
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af040-improvement-closeout-2026-11-17.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排单测全绿（含新增 IM-007/011/012/017/018 用例）
    threshold: 'failed=0'
  - command: pnpm lint
    check: lint 零 error
    threshold: 'errors=0'
  - command: pnpm typecheck
    check: 类型检查零 error
    threshold: 'errors=0'
  - command: ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate
    check: 适配层机读校验全 PASS
    threshold: 'FAIL=0'
successCriteria:
  - 台账 15 条（IM-002/003/007/011/012/017/018/020/023/024/025/026/027/028/034）逐条给出落地形态并流转到终态
  - 通道失败六条口径问题给出裁定（不写成「待讨论」）
  - 新增能力有单测覆盖，且既有断言随语义变更同步修正
  - 闸门数字为实跑值，非沿用上一轮
evidenceFormat: vitest 用例数 + lint/typecheck 数字 + validate PASS 计数 + git diff --stat
---

# AF-040 任务单（改进台账未实现项收口）

## 1. 背景

`web/orchestration` 改进台账 `improvements` 段 active=15（accepted 1 / candidate 14）：6 条代码级 tech-debt（IM-007/011/012/017/018/034）、6 条 AF-013 演练回执遗留的决策题（IM-020/023/024/025/026/027）、2 条已完成待改状态（IM-002/IM-028）、1 条依赖治理（IM-003）。

只在网页里写「候选」而不落地，台账就从治理工具退化成备忘录。本单把 15 条一次性收到终态。

## 2. 与 AF-039 的关系

AF-039 因 scope 含 `test/`、`web/` 超出 orchestrator 资源域被取消（留痕 `cancelReason`）。本单按资源域重切：

| 任务           | 角色         | scope                                                                                           | 承担条目                                                   |
| -------------- | ------------ | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| AF-040（本单） | orchestrator | `scripts/orchestration/`、`docs/team/agent-orchestration/`、`docs/worklog/{pending,completed}/` | IM-002/003/007/011/012/017/018/020/023/024/025/026/027/028 |
| AF-041         | executor     | `test/admin-debug/`                                                                             | IM-034（WP38 用例超时预算）                                |

## 3. 范围与不做什么

做：

1. 代码侧 tech-debt（含新建 `ci-status.mjs`）；
2. 六条决策题的裁定书（`channel-failure-decisions-2026-11-17.md`）；
3. IM-002 / IM-028 / IM-003 的状态与结论收口；
4. README §5.1–§5.4 新口径同步。

不做：

- 不改框架仓 `docs/reliability.md`（跨仓，另走框架仓任务单）；
- 不升级 uuid / glob / minimatch 大版本（IM-003 走触发条件登记）；
- 不实现熔断 `half-open` 恢复试探（本轮只参数化 + 开闸可观察）。

## 4. 验收

见 frontmatter `successCriteria`；闸门数字进交付记录 `docs/worklog/completed/phase2.5/af040-improvement-closeout-2026-11-17.md`。
