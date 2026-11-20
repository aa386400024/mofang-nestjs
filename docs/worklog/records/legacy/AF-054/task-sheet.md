---
taskId: AF-054
contextId: phase2.5-orchestration-enforcement
title: squash 合并门禁快照修正与发布记录闭环
type: fix
status: backlog
baselineRef:
dependsOn: [AF-053]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3, conventions.md#1.4, agent-orchestration/README.md#0, agent-orchestration/autonomous-team-design.md#6.1]
createdAt: '2026-11-17T10:05:00Z'
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/
    - docs/team/agent-orchestration/
    - docs/worklog/pending/
    - docs/worklog/completed/
    - docs/worklog/README.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af054-merge-gate-snapshot-2026-11-17.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排单测与新增归档迁移快照用例全绿
    threshold: failed=0
  - command: pnpm typecheck
    check: 类型检查通过
    threshold: errors=0
  - command: pnpm lint
    check: lint 无 error / warning
    threshold: errors=0 warnings=0
  - command: pnpm orchestration:preflight
    check: 正常任务提交与 squash 归档迁移均放行， canceled/rejected 不得借用 HEAD 权限
    threshold: exit=0
  - command: ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate
    check: 适配层机读校验全 PASS
    threshold: FAIL=0
  - command: pnpm orchestration:contracts
    check: 框架 2.0.0 契约包一致
    threshold: FAIL=0
successCriteria:
  - preflight 在同次提交携带任务 active→completed 归档状态迁移时，可使用 HEAD 中该任务做 scope 校验
  - 未提交状态索引、归档状态非 completed 或文件越出 scope 时仍阻断
  - AF-053 交付记录、回执 durable 副本与工作记录导航随本任务提交
  - AF-054 经登记、领单、实现提交、分支推送、机读验收、纯状态面提交、CLI squash 合并与 integrate 推送完成
  - 合并 pre-commit 不再需要手工恢复 task-state-index，且不跳过任何 Git 钩子
  - admin-dashboard、data/batch-reports、未跟踪架构稿与 src/engine-core 不进入本任务提交
evidenceFormat: vitest 用例数 + 归档迁移正反用例 + 真实 pre-commit/branch merge 输出 + receipt autoVerdict + events/status + integrate 远端 SHA
---

# AF-054 · squash 合并门禁快照修正与发布记录闭环

## 背景

AF-053 实弹合并时，squash 暂存区已携带 `AF-053 active → completed/archived` 的状态迁移。preflight 只读工作树索引，因此误判为“没有在办任务”；临时恢复 HEAD 索引后真实钩子通过并完成合并。AF-054 把这一恢复步骤变成受约束的脚本能力。

## 边界

- 仅当暂存文件包含 `docs/team/agent-orchestration/task-state-index.json`，且当前索引中对应任务已 `completed` 归档，才允许读取 HEAD 中同 taskId 的在办记录。
- 不开放 canceled/rejected 归档，不允许在未携带状态索引时借用 HEAD 任务，不改变 scope 检查。
- 不顺手调整其他门禁、前端锁文件、批次报告、架构稿或数据库。

## 完成判据

1. 正例：HEAD submitted + 当前 completed 归档 + 同次状态索引 + scope 内文件 → PASS。
2. 负例：canceled/rejected、缺少状态索引、越界文件 → FAIL。
3. AF-053 记录、回执与导航入库；本任务自己的回执走 run-once，验收后纯状态面提交。
4. 本任务 squash 合并时 preflight 自动命中归档迁移路径，无手工恢复、无 `--no-verify`。
5. L1–L3 按授权直接执行，L4 不触发。
