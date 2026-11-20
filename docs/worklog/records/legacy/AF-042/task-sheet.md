---
taskId: AF-042
contextId: phase2.5-orchestration-closed-loop
title: WP38 用例超时预算复单（AF-041 因投递定性判 failed 后重开）
type: fix
status: backlog
baselineRef: ba582325d10426d5bf194048b07899dcb3a1a373
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs:
  - conventions.md#1.3
  - conventions.md#1.4
createdAt: 2026-11-17T03:55:00.000Z
deadline: null
agentRole: executor
scope:
  files:
    - test/admin-debug/
    - docs/worklog/completed/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af042-wp38-timeout-budget-rework-2026-11-17.md
    kind: report
gates:
  - command: pnpm exec vitest run test/admin-debug/wp38-debug-session-resume.spec.ts
    check: 该文件全绿
    threshold: 'failed=0'
successCriteria:
  - 复用 AF-041 已在库的 4 行改动（commit c8632c6），不重复改动
  - 以文件通道投递（本单在会话内执行，不驱动桌面 relay），投递事实如实登记
  - 交付记录写明 AF-041 被判 failed 的真实原因与重开依据
evidenceFormat: vitest 用例数 + commit hash + 投递记录
---

# AF-042 任务单（WP38 用例超时预算复单）

## 1. 为什么重开

AF-041 的代码改动本身是对的，但它死在**流程**上：`channel fallback` 缺省 `cause` 落成 `deterministic-defect`，运行时决策链据此按 `reliability.md §4.1` 直接把任务判 `failed`（`delivery-terminal`），回执虽已写出却没有机会进入验收。

这是「留痕手段反噬」的典型：定性字段填错一格，任务就被判死。复单承接同一改动，投递改走文件通道（本单在会话内执行，无需桌面 relay），让验收有机会跑。

## 2. 范围

- `test/admin-debug/wp38-debug-session-resume.spec.ts` 的 4 行改动已在库（`c8632c6`），本单**不重复改动**，只补交付记录与验收事实。
- 新增交付记录 1 份。

## 3. 前车之鉴（登记给下一单）

通道降级时必须同时给准 `--cause`：会话内代执行属于「未走本通道」，不是「确定性缺陷」。把代执行写成 `deterministic-defect` 会直接把任务判死，且 `failed` 是终态不可复活。
