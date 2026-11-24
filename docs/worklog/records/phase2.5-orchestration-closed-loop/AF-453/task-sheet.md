---
taskId: AF-453
contextId: phase2.5-orchestration-closed-loop
title: engine-core 两处注释与 AF-322 标定系数口径对齐（纯注释）
type: documentation
status: backlog
baselineRef: e855dbcc2f8b5a1ad59873ca5a44a3fd0857ea26
dependsOn: []
priorTasks: [AF-446, AF-322]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.2]
createdAt: 2026-11-24T10:30:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - src/engine-core/domain/events/session-event.ts
    - src/engine-core/cognition/state-transition.ts
    - docs/worklog/pending/af453-engine-core-comment-task-2026-11-24.md
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-453/
    - docs/worklog/completed/phase2.5/af453-engine-core-comment-2026-11-24.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af453-engine-core-comment-2026-11-24.md
    kind: report
gates:
  - command: pnpm exec vitest run test/engine-core/boundary.spec.ts
    check: engine-core 边界断言全绿
    threshold: exit=0
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
successCriteria:
  - session-event.ts 第 19-20 行、第 34 行、第 36 行不再声称种子向量为 ZERO，改为指向 AF-322 后的非零工程种子值。
  - state-transition.ts 第 363-368 行注释列全 two-class 的非零维度，与 DELTA_TABLE 实际字段一一对应。
  - 两处改动均为注释，零逻辑行变化；git diff 不含任何可执行代码行。
  - test/engine-core/boundary.spec.ts 全绿；pnpm typecheck 与 pnpm lint 均 0 error。
  - git diff --stat HEAD -- src/engine-core 只出现上述两个文件。
---

# AF-453 · engine-core 两处注释与 AF-322 标定系数口径对齐

## 背景

AF-322 标定批次把 `DELTA_TABLE` 里 `holding_present` / `cold_absent` 从 ZERO 改成非零工程种子值（safety +0.004 / bond +0.002 / verbal -0.002；trust -0.004 / safety -0.002 / bond -0.002，另有 valence / arousal / depth / style / negative）。但两处内核注释仍停留在标定前的说法：

- `src/engine-core/domain/events/session-event.ts:19-20`：「DELTA_TABLE 里的种子向量 = ZERO (零回归)」；
- `src/engine-core/domain/events/session-event.ts:34`、`:36`：两类事件的 doc 注释写「种子 delta = ZERO, 临床增量待标定」；
- `src/engine-core/cognition/state-transition.ts:364-367`：只列 3 个维度，实际 DELTA_TABLE 还含 valence / arousal / depth / style / negative。

读代码的人会据此认为这两类事件仍不产生任何 delta，与真实行为矛盾（AF-446-B1 / B2 登记项）。

## engine-core 红线例外（本任务唯一授权依据）

`src/engine-core` 属纯层红线，默认为一行不动。本任务在**纯注释**范围内改动，依据：

> 大炮 2026-11-24 明确批准：按豁免在任务单记本次批准，只动注释（session-event.ts + state-transition.ts），必须过 boundary.spec.ts 断言，逻辑零变化。
> —— 交互确认记录（2026-11-24 本轮会话，选项「批准改注释」）

例外边界（超出即作废）：

- 只允许改注释文本（`//` / `/** */`），不得改任何类型、常量、函数、导出；
- 不得新增文件、不得改 import；
- `git diff` 必须逐行可判定为注释行；出现一行可执行代码即视为越界，任务作废。

## 范围

- `src/engine-core/domain/events/session-event.ts`
- `src/engine-core/cognition/state-transition.ts`

## 验收

1. 注释与 DELTA_TABLE 实际值一致（逐维度核对，不写"部分维度"）。
2. 明确标注「工程种子值，非临床标定」，保留 AF-322 的措辞，避免把种子值读成临床结论。
3. `test/engine-core/boundary.spec.ts` 全绿（注释不进 AST，预期不受影响）。
4. `pnpm typecheck` / `pnpm lint` 0 error。
5. `git diff --stat HEAD -- src/engine-core` 只有上述两文件。

## 不做

- 不改 `DELTA_TABLE` 数值本身（标定结果不是本任务对象）。
- 不动 `engine-adapters` 与任何业务层。
- 不顺手清理其它注释。
