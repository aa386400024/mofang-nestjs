---
taskId: AF-051
contextId: phase2.5-orchestration-enforcement
title: AF-047 返修复验：强制编排门交付复核
type: verification
status: backlog
baselineRef: a27aba504b48b245f59a8f6ef1791310b68f94a9
dependsOn:
  - AF-050
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs:
  - conventions.md#1.3
  - conventions.md#1.4
  - agent-orchestration/README.md#0
createdAt: 2026-11-17T17:28:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - AGENTS.md
    - docs/team/conventions.md
    - docs/team/agent-orchestration/
    - docs/team/wp-task-template.md
    - docs/worklog/pending/
    - docs/worklog/completed/
    - scripts/orchestration/
    - package.json
    - .husky/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af051-af047-rework-verification-2026-11-17.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排单测与强制门用例全绿
    threshold: 'failed=0'
  - command: pnpm typecheck
    check: 类型检查通过
    threshold: 'errors=0'
  - command: pnpm lint
    check: lint 无新增 error / warning
    threshold: 'errors=0'
  - command: pnpm orchestration:preflight
    check: 暂存本返修交付集时门禁放行；越界文件被阻断
    threshold: 'exit=0'
  - command: ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate
    check: 适配层机读校验全 PASS
    threshold: 'FAIL=0'
successCriteria:
  - AF-047 的四层强制门交付文件全部仍在位，内容未被后续修改破坏
  - 门禁正向放行与负向阻断在真实仓复跑通过
  - 205 例编排单测、typecheck、lint、适配层 validate 全部通过
  - engine-core 与业务代码零改动，data/batch-reports 与并行产物不进入本任务交付集
  - 本记录明确 AF-047 原始终态为 rejected、AF-050 修复了误判、AF-051 为返修复验载体
evidenceFormat: vitest 用例数 + gate 正负退出码 + typecheck/lint + validate PASS 计数 + git diff 范围 + events/status 数字
---

# AF-051 · AF-047 返修复验

## 1. 背景

AF-047 的交付内容（强制编排门四层约束）已完成并通过全部定向闸门，但首轮机读验收被 V7 整棵工作树扫描误判为 `rejected`，根因与修复见 AF-050。框架不允许改写终态，故按返修路径新开本任务，对同一交付集做独立复核，并给出可归档的 `completed` 载体。

## 2. 复验范围

- 不新增业务代码、不修改内核、不重跑 LLM 批次、不动数据库/Redis。
- 只复核 AF-047 的 9 个仓内交付文件 + 门禁脚本 + AF-050 的验收器修复是否仍在位、是否仍通过正反路径。
- 本任务交付记录与回执计入 `docs/worklog/` 与 `scripts/orchestration/` 范围。

## 3. 判定口径

- 原 AF-047 记录 §1–§9 与 AF-050 记录 §1–§10 为事实来源；本记录不复述全部证据，只做返修后的独立复核结论。
- 若任一原交付文件缺失、门禁负向失效、或出现业务/内核改动，本任务判 fail。
