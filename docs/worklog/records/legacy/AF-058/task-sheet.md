---
taskId: AF-058
contextId: phase2.5-orchestration-enforcement
title: squash 全生命周期归档门修复
type: fix
status: backlog
baselineRef:
dependsOn: [AF-057]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3, agent-orchestration/README.md#0, agent-orchestration/autonomous-team-design.md#6.2]
createdAt: '2026-11-17T11:50:00Z'
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/ci-task-gate.mjs
    - scripts/orchestration/__tests__/orchestration.spec.mjs
    - docs/team/agent-orchestration/
    - docs/worklog/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af058-squash-lifecycle-gate-2026-11-17.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排单测与 squash 生命周期正反用例全绿
    threshold: failed=0
  - command: node scripts/orchestration/ci-task-gate.mjs --base f3d6009e80d2c258ab1295fde140dc40e9b99e10 --head 04f6f9baa02f6f3f8a503780920e3562a42f511b
    check: AF-057 真实 squash 回放通过；缺回执负向仍拒绝
    threshold: exit=0
  - command: pnpm typecheck
    check: 类型检查通过
    threshold: errors=0
  - command: pnpm lint
    check: lint 无 error / warning
    threshold: errors=0 warnings=0
  - command: ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate
    check: 适配层校验 FAIL=0
    threshold: FAIL=0
  - command: pnpm orchestration:contracts
    check: 框架契约包一致
    threshold: FAIL=0
successCriteria:
  - 父提交无任务、当前提交 completed/archived 的 squash 全生命周期，仅在 passed durable 回执存在时按 archived-transition 放行
  - 缺少回执、父任务已归档后的追加写、canceled/rejected 借用仍阻断
  - AF-056 与 AF-057 真实 merge SHA 本地回放通过
  - AF-058 自身 PR 与 squash 后 integrate push 的 Orchestration Gate 均 success
  - 最终 13 项 checks 全绿后 squash 合并，事件链与索引投影一致
evidenceFormat: 单测数 + 两个历史 merge SHA 回放 + 负向用例 + AF-058 PR/push 远端结论 + merge SHA
---

# AF-058 · squash 全生命周期归档门修复

## 根因

受保护 PR squash 后，登记、实现、交付和归档被压成一个提交。父提交没有该任务，当前提交直接是 archived/completed；AF-056 的 archived-transition 只覆盖“父提交 active → 当前归档”的单独状态提交，导致 merge 后 integrate push 被误报 no-active-task。

## 目标

- 保留普通归档迁移语义；
- 增加 squash-lifecycle 识别：parent 无该任务 + current archived/completed + 当前树存在 passed/in-scope/completed durable receipt；
- 缺回执或父任务已归档后的追加写不得借道；
- 用 AF-056/AF-057 真实 merge SHA 回放，并用 AF-058 自身合并验证。
