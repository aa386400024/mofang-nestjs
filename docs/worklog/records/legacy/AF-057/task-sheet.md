---
taskId: AF-057
contextId: phase2.5-orchestration-enforcement
title: 受保护 PR 验收门与全流程返修验证
type: fix
status: backlog
baselineRef:
dependsOn: [AF-056]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3, conventions.md#1.4, agent-orchestration/README.md#0, agent-orchestration/autonomous-team-design.md#6.2]
createdAt: '2026-11-17T11:25:00Z'
deadline: null
agentRole: orchestrator
scope:
  files:
    - .github/workflows/ci.yml
    - scripts/orchestration/ci-task-gate.mjs
    - scripts/orchestration/pr-release.mjs
    - scripts/orchestration/branch-protection.mjs
    - scripts/orchestration/__tests__/orchestration.spec.mjs
    - AGENTS.md
    - docs/team/agent-orchestration/
    - docs/worklog/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af057-protected-pr-acceptance-2026-11-17.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排单测与 PR 验收正反用例全绿
    threshold: failed=0
  - command: node scripts/orchestration/ci-task-gate.mjs --base <integrate> --head <task-head> --require-accepted --task-id task/AF-057-protected-pr-acceptance
    check: 归档前拒绝、归档后接受
    threshold: before=1 after=0
  - command: pnpm typecheck
    check: 类型检查通过
    threshold: errors=0
  - command: pnpm lint
    check: lint 无 error / warning
    threshold: errors=0 warnings=0
  - command: ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate
    check: 适配层机读校验全 PASS
    threshold: FAIL=0
  - command: pnpm orchestration:contracts
    check: 框架 2.0.0 契约包一致
    threshold: FAIL=0
successCriteria:
  - PR 最终 HEAD 必须 completed/archived 且含 passed + in-scope + completed durable 回执，直接页面/API 合并也不能绕过
  - AF-057 登记提交只在任务分支；向 integrate 的直接 push 被 GitHub 保护拒绝
  - 归档前 PR 的 Orchestration Gate 实弹失败，归档后同一 PR 转 success
  - 最终 13 项 required checks 全绿，pr-release squash 合并并清理任务分支
  - AF-056 最终 merge SHA、保护读回、AF-057 直推负向证据全部入库
  - 不使用 --no-verify，不改业务 src、数据库、Redis、master/tag/release/deploy
evidenceFormat: 单测数 + 直推 rejected 原文 + 归档前远端 failure + 归档后远端 success + 13 项 pass + merge SHA + events/status
---

# AF-057 · 受保护 PR 验收门与全流程返修验证

## 根因

AF-056 把 completed + passed 回执放在本地 `pr-release.mjs` 检查，但 GitHub 页面/API 也可发起合并。若 CI 不检查 PR 最终 HEAD 的验收状态，仍存在绕开本地工具的路径。

## 修正

- `ci-task-gate.mjs` 增加 `--require-accepted --task-id <branch-or-id>`；
- PR 工作在逐提交检查后，再从 HEAD git tree 读取 archivedTasks 与 durable receipts；
- archived/completed、reviewVerdict=passed、scopeCheck=in-scope、finalStatus=completed 缺一不可；
- push integrate 不启用 PR 专属检查，归档 squash 仍由 archived-transition 校验。

## 实弹计划

1. 登记与领单在工作树完成后切任务分支，登记提交不进 integrate。
2. 尝试 `git push origin HEAD:integrate`，预期保护拒绝。
3. 实现提交后创建 PR，预期远端门因未归档而 failure。
4. 正式回执、run-once 验收、归档状态提交后更新同一 PR，预期 Orchestration Gate success。
5. 13 项全绿后由 pr-release 合并；记录 AF-056 与本单最终证据。
