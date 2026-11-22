---
taskId: AF-212
contextId: phase2.5-provider-fallback
title: AF-210 实现补提交与状态面收口（提交时序纠正，代码零新增）
type: fix
status: backlog
baselineRef: e54012bfc3f7f01c36bf60695df7bfa775558dca
dependsOn: []
priorTasks: [AF-210, AF-211]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.1, conventions.md#2.1]
createdAt: 2026-11-21T00:38:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/llm/registry/llm-router.service.ts
    - src/llm/providers/doubao.provider.ts
    - src/engine-adapters/wiring/render-config.factory.ts
    - test/llm/
    - test/engine-adapters/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-provider-fallback/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录（复用 AF-210）
    path: docs/worklog/completed/phase2.5/af210-doubao-fallback-provider-2026-11-21.md
    kind: report
gates:
  - command: pnpm exec vitest run test/llm/af210-doubao-tier-mapping.spec.ts test/engine-adapters/af210-render-model-override.spec.ts
    check: 定向用例仍全绿（代码未改，复核用）
    threshold: exit=0
  - command: pnpm typecheck
    check: 类型检查 0 error
    threshold: exit=0
  - command: pnpm test
    check: 全量 0 failed
    threshold: exit=0
  - command: git diff --stat HEAD -- src/engine-core
    check: engine-core 零改动
    threshold: empty
  - command: ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate
    check: 机读校验全 PASS
    threshold: FAIL=0
successCriteria:
  - 把 AF-210 已完成的实现（3 个 src + 2 个测试 + 交付记录）补提交入库，内容与 AF-210 回执 changedFiles 完全一致，不新增任何功能改动。
  - 状态面（journal / index / snapshot / data.js）作为编排生成物单独提交，不进入任务 scope 比对。
  - engine-core 零 diff；提交后 preflight 与 CI Gate 可通过。
---

# AF-212 · AF-210 实现补提交与状态面收口

## 为什么需要这一单

AF-210 的实现、验收与归档全部完成（归档数 222，回执 `RC-AF-210-1` 已摄入），但提交顺序错了：先把任务推进到 completed/archived，再尝试 `git commit`。仓库的 `orchestration:preflight` 要求提交时存在 ready/submitted/working/input-required/completed 的**在办任务**，已归档任务不满足，于是整批实现被 gate 拒绝。

仓库规则明确禁止 `--no-verify` 绕过，也禁止先做后补任务单。正确做法是登记一单「补提交」，在本单处于 submitted 时提交 AF-210 的实现产物，再把状态面单独提交。

AF-211 首次登记时把 `docs/team/agent-orchestration/` 写进了 scope，触发 `scope-domain-conflict`：executor Agent Card 的可写资源域不含该目录（状态面属于编排者域）。按 IM-010 口径 rescope 到本单，scope 只保留执行者可写目录；编排状态面作为生成物由 gate 的剔除规则处理。

## 范围

- 允许提交：AF-210 已产出的 3 个 src、2 个测试、交付记录、AF-210 记录包，以及编排状态面。
- 不新增代码、不改测试断言、不改 task-sheet AF-210（已归档不可变）。
- 若发现实现缺陷，不在本单修，另开任务单。

## 验收

- 提交后 `git diff --stat HEAD~2 HEAD -- src/engine-core` 为空。
- 定向 8 例、typecheck、全量测试、validate 与 AF-210 记录一致或更好。
- 状态面提交只含 `docs/team/agent-orchestration/**` 与 `web/orchestration/data.js`。

commit message：`chore(af212): 补提交 AF-210 实现（豆包 provider 接入）`
