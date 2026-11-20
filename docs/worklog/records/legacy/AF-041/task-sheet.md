---
taskId: AF-041
contextId: phase2.5-orchestration-closed-loop
title: WP38 调试会话恢复用例并发超时预算治理（IM-034）
type: fix
status: backlog
baselineRef: ba582325d10426d5bf194048b07899dcb3a1a373
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs:
  - conventions.md#1.3
  - conventions.md#1.4
createdAt: 2026-11-17T03:52:00.000Z
deadline: null
agentRole: executor
scope:
  files:
    - test/admin-debug/wp38-debug-session-resume.spec.ts
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af041-wp38-timeout-budget-2026-11-17.md
    kind: report
gates:
  - command: pnpm exec vitest run test/admin-debug/wp38-debug-session-resume.spec.ts
    check: 该文件全绿
    threshold: 'failed=0'
successCriteria:
  - ③ 首个用例（两实例 + 两轮 runTurn）有显式超时预算，不再默认 30s
  - 注释写明区分「并发负载拖慢」与「真回归」，不掩盖断言失败
  - 其余用例与断言零改动
evidenceFormat: vitest 用例数 + git diff 仅 1 文件
---

# AF-041 任务单（IM-034 用例超时预算）

## 1. 背景

全量 `pnpm test` 在并发跑 lint/typecheck 的机器负载下，`test/admin-debug/wp38-debug-session-resume.spec.ts` ③ 首个用例曾报超时 30013ms；独占复跑 100ms 全绿。这是**并发负载**而非业务回归，但会让收尾闸门出现与本批改动无关的红灯，误导交付判断。

## 2. 处置

给 ③ 首个用例显式 `{ timeout: 60_000 }`，并在代码里写清判据：预算只吸收并发拖慢，断言失败仍照常红。

不改 worker 并发（全量墙钟优先），不动其余 10 个用例。

## 3. 验收

- `pnpm exec vitest run test/admin-debug/wp38-debug-session-resume.spec.ts` 全绿；
- `git diff` 仅 1 文件、仅 1 处签名 + 注释。
