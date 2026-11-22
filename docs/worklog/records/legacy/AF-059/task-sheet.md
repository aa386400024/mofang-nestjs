---
taskId: AF-059
contextId: phase2.5-orchestration-enforcement
title: 零依赖 squash 门返修与最终闭环
type: fix
status: backlog
baselineRef:
dependsOn: [AF-058]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3, agent-orchestration/README.md#0, agent-orchestration/autonomous-team-design.md#6.2]
createdAt: '2026-11-17T12:08:00Z'
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
    path: docs/worklog/completed/phase2.5/af059-dependency-free-squash-gate-2026-11-17.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排单测与零依赖 scope 解析正反用例全绿
    threshold: failed=0
  - command: node scripts/orchestration/ci-task-gate.mjs --base 04f6f9baa02f6f3f8a503780920e3562a42f511b --head <af059-head> --require-accepted --task-id task/AF-059-dependency-free-gate
    check: AF-058+059 全部提交与最终验收通过
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
  - ci-task-gate 不再静态引入 task-intake/yaml；在未安装 node_modules 的 GitHub 轻量门中可运行
  - 任务单 scope 支持块数组与行内数组，taskId 不符或 scope 缺失 fail closed
  - AF-058 未合入提交由 AF-059 承载，PR #13 被 supersede 并关闭，不改写既有提交
  - AF-059 自身 PR、13 项 checks、squash 后 integrate push 的 Orchestration Gate 全部 success
  - 本地/远端临时任务分支清理，事件链与索引投影一致
evidenceFormat: 单测数 + 无依赖检查 + 真实历史回放 + GitHub PR/push 结论 + merge SHA
---

# AF-059 · 零依赖 squash 门返修与最终闭环

## 根因

AF-058 为恢复 squash scope 静态引入 task-intake.mjs，连带引入 yaml；Orchestration Gate 设计上不安装 node_modules，GitHub 因 ERR_MODULE_NOT_FOUND 失败。本地有依赖所以未暴露。

## 流程决策

AF-058 已归档但 PR #13 未合并，不能继续写入已完成任务。AF-059 在 AF-058 任务分支最新提交上切 stacked rework 分支，保留原提交与回执证据，由 AF-059 的 PR 统一交付；PR #13 随后关闭并清理。

## 修正

- 移除 task-intake 静态依赖；
- 仅解析门所需 taskId/type/agentRole/scope.files，严格支持块数组与行内数组；其他任务单字段仍由登记 CLI 与 Contracts 校验；
- taskId 不匹配、scope/files 缺失或数组形态非法均 fail closed；
- 保持 passed durable receipt、scope-residual、归档后追加写等硬门不变。
