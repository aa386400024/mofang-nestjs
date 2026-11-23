---
taskId: AF-360
contextId: phase2.5-orchestration-closed-loop
title: BDI 复审 hygiene：审计披露、注释漂移与来源契约措辞
type: documentation
status: backlog
baselineRef: 2b1b5bd6cf2cebc1026b57f774e8799e7ae50a48
dependsOn: [AF-359]
priorTasks: [AF-359, AF-358, AF-357]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.1, conventions.md#1.3, conventions.md#2.5]
createdAt: 2026-11-23T13:25:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - bin/bdi-readiness-audit.ts
    - src/engine-core/cognition/state-transition.ts
    - src/engine-core/cognition/intention-planner.ts
    - src/engine-core/domain/desires.ts
    - src/engine-adapters/wiring/character/character-desire-mapping.ts
    - test/engine-core/
    - test/engine-adapters/
    - docs/worklog/completed/
    - docs/worklog/records/
  modules:
    - engine-core
    - engine-adapters
  interfaces:
    - UnderlyingDesireSeed
artifacts:
  - name: 复审 hygiene 修复
    path: bin/bdi-readiness-audit.ts
    kind: code
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af360-bdi-review-hygiene-2026-11-23.md
    kind: report
gates:
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
  - command: pnpm lint
    check: 0 error / 0 warning
    threshold: exit=0
  - command: pnpm exec vitest run test/engine-core/af359-bdi-review-followup.spec.ts test/engine-adapters/af359-character-desire-pairing.spec.ts test/engine-adapters/af358-character-desire-provenance.spec.ts test/engine-core/boundary.spec.ts
    check: 定向回归全绿
    threshold: exit=0
  - command: pnpm exec tsx bin/bdi-readiness-audit.ts --out .tmp/af360-audit --strict
    check: 阻断项 0，新增披露说明可见
    threshold: exit=0
  - command: node scripts/orchestration/cli.mjs worklog verify --strict
    check: 记录包完整
    threshold: exit=0
successCriteria:
  - 审计 Markdown 明确说明缺失键按 0 计，与内核 ?? 0 同口径。
  - 内核对 1e-9 容差与审计侧注释互相指向，降低未来漂移风险。
  - state-transition 函数级否定口径注释与 AF-359 实际规则一致。
  - character-desire-mapping 的 sourceLabels[0] 假定改成条件式；UnderlyingDesireSeed.sourceKeys 注明可能重复、按 (key,label) 对索引。
  - 不改变任何运行时行为、阈值数值与角色权重；仅注释与审计展示层。
  - 交付记录补记 AF-359 任务单 §2.1 期望值 0.22/0.25 与实际 0.72/0.45 的口径偏差。
---

# AF-360 · BDI 复审 hygiene

> 来源：MiniMax Code 对 AF-359 的只读复审（accepted，无 P0/P1，附 4 条可收口项）。

## 1. 范围

在范围内：

- 审计 Markdown 增加“缺失键按 0 计”的披露说明。
- 内核与审计的 `1e-9` 容差注释互指。
- `state-transition.ts` 函数级注释按 AF-359 新否定口径改写。
- `character-desire-mapping.ts` 的 `sourceLabels[0] === label` 改为条件式表述。
- `desires.ts` 的 `sourceKeys` 注释注明可能重复 key、按 `(key,label)` 对索引。
- 交付记录补记 AF-359 任务单期望值与实际产物的偏差。

不在范围内：

- 不改任何运行时判定、阈值、权重、映射行为。
- 不做 hedge 判定清单（属督导签字）。
- 不改 admin-dashboard。
- 不改已归档的 AF-359 交付记录正文（证据不可变），偏差记在本单交付记录。

## 2. 设计

纯注释与审计 Markdown 展示层修正：代码分支零变化，所有既有测试应逐字通过。

## 3. 红线

- `src/engine-core` 只改 `state-transition.ts` 注释、`intention-planner.ts` 注释、`domain/desires.ts` 注释。
- 不改 `boundary.spec.ts`、不新增 public export。
- 不伪造临床数值，不改审计判定结果。

## 4. 闸门

- `pnpm typecheck` 0 error；`pnpm lint` 0 error / 0 warning。
- 定向 4 文件全绿；审计 strict 阻断 0。
- `worklog verify --strict` PASS。

## 5. 交付记录

`docs/worklog/completed/phase2.5/af360-bdi-review-hygiene-2026-11-23.md`，含六组机读标记。
