---
taskId: AF-052
contextId: phase2.5-orchestration-enforcement
title: 强制编排门交付发布与状态面提交修正
type: fix
status: ready
dependsOn:
  - AF-051
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs:
  - conventions.md#1.3
  - conventions.md#1.4
  - agent-orchestration/README.md#0
  - agent-orchestration/autonomous-team-design.md#6.1
createdAt: 2026-11-17T17:42:14+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - AGENTS.md
    - package.json
    - .husky/
    - docs/team/conventions.md
    - docs/team/wp-task-template.md
    - docs/team/agent-orchestration/
    - docs/worklog/pending/
    - docs/worklog/completed/
    - scripts/orchestration/
    - web/orchestration/data.js
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af052-orchestration-delivery-release-2026-11-17.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排单测与新增状态面提交用例全绿
    threshold: 'failed=0'
  - command: pnpm typecheck
    check: 类型检查通过
    threshold: 'errors=0'
  - command: pnpm lint
    check: lint 无 error / warning
    threshold: 'errors=0 warnings=0'
  - command: pnpm orchestration:preflight
    check: 在办任务的交付集放行，纯状态面提交在归档后放行，业务文件无任务仍阻断
    threshold: 'exit=0'
  - command: ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate
    check: 适配层机读校验全 PASS
    threshold: 'FAIL=0'
  - command: pnpm orchestration:contracts
    check: 框架 2.0.0 契约包一致
    threshold: 'FAIL=0'
successCriteria:
  - AF-047、AF-048、AF-049、AF-050、AF-051 的强制门交付与机读记录经任务分支提交并推送
  - preflight 支持无活跃任务时的纯编排状态面提交；混入任何非状态面文件仍必须有在办任务
  - 任务回执经 run-once 摄入并归档 completed，事件链与索引投影一致
  - 任务分支经 CLI squash 合并进 integrate，并推送 origin/integrate
  - admin-dashboard/pnpm-lock.yaml、data/batch-reports/**、未跟踪架构稿不进入本任务提交
  - src/engine-core 零改动，不触发 L4 master/tag/release/deploy
evidenceFormat: vitest 用例数 + preflight 正反退出码 + typecheck/lint/validate/contracts + commit/branch/push SHA + receipt autoVerdict + events/status 数字
---

# AF-052 · 强制编排门交付发布与状态面提交修正

## 1. 目标

把已验收的 AF-047～AF-051 强制编排门交付按 L1–L3 发布流程提交并推送，不再逐次向用户确认 commit / push。同步修复闭环中暴露的边界：任务验收归档后，只剩 `task-state-index.json`、事件日志、快照等编排状态面变更时，旧 preflight 会因没有活跃任务而阻断，导致验收状态无法合法提交。

## 2. 范围与排除

- 在范围内：AF-047～AF-051 已交付的仓内文件、AF-052 任务单 / 交付记录 / 回执、`task-entry-gate.mjs` 的纯状态面提交豁免及回归测试。
- 排除：`admin-dashboard/pnpm-lock.yaml`、`data/batch-reports/**`、`docs/architecture/phase3-judge-layer-ai-review-design-2026-11-15.md` 与其他并行产物。
- 不改业务 `src/`、不改 `src/engine-core`、不动数据库 / Redis、不新跑 LLM 批次。

## 3. 发布口径与 baselineRef

按 AF-046 已验收先例，本单直接以 `ready` 登记且不写 `baselineRef`：任务单和登记状态必须先落到 `integrate`，`branch merge` 才能读取任务；落单提交本身会推进 HEAD，填写固定 SHA 会形成伪漂移。合并时 `verifyBaseline` 必须显式打印“任务记录未登记 baselineRef”，不伪造对齐值。

执行链：登记并领单 → 落单提交 → CLI 建任务分支 → 实现与闸门 → 分支提交 / 推送 → 回执验收归档 → 状态面提交 → CLI squash 合并 → 推送 `integrate`。

## 4. 完成判据

- 新增纯函数用例证明：无任务时纯状态面提交 PASS；纯状态面 + 一个业务文件 FAIL；有在办任务时原 scope 校验不退化。
- 所有提交均经过真实 Husky，不使用 `--no-verify`。
- 远端只出现 `task/AF-052-orchestration-delivery` 与 `integrate` 的规定更新；master、tag、release、deploy 零操作。
