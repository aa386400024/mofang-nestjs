---
taskId: AF-579
contextId: phase2.5-orchestration-closed-loop
title: 修复全仓 validate 对已归档旧回执 deletionChecks 的误报
type: fix
status: backlog
baselineRef: 57ca6616354f8b92f34eb3277bbe39415207a5f1
dependsOn: []
priorTasks: [AF-578]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-27T19:40:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af579-legacy-receipt-deletion-checks-2026-11-27.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排单测全绿，新增旧回执兼容用例通过
    threshold: exit 0
  - command: node scripts/orchestration/cli.mjs validate
    check: 全仓机读校验全 PASS，不再因 AF-534/535/557 旧回执报 must be object
    threshold: exit 0
  - command: node scripts/orchestration/cli.mjs events verify
    check: 事件链与索引投影一致
    threshold: exit 0
  - command: pnpm lint
    check: 后端 lint 0 error
    threshold: exit 0
successCriteria:
  - validate 对 AF-534 / AF-535 / AF-557 三份已归档回执不再报 deletionChecks must be object，全仓 validate 无 FAIL
  - 兼容只作用于已归档任务的历史回执，活动任务的回执仍按 2.1.0 回执 schema 严格校验
  - 不修改三份历史回执正文，不改变其 sha256 与 manifest 证据链
  - 新增单测覆盖「已归档旧结构放行」与「活动任务旧结构仍拒绝」两条边界
  - 交付记录写明根因、兼容边界、闸门真实数字，engine-core 零改动
objective: 消除全仓 validate 的既有红灯，让历史回执的冻结事实与当前契约校验口径各自成立，而不是靠改历史证据或放宽全局 schema 凑绿
outOfScope:
  - 不改 contracts/agent-collaboration-framework 下的框架 schema
  - 不修改任何已冻结回执、manifest 或交付记录正文
  - 不处理 AF-580 台账清理
  - 不改 src/engine-core 与业务代码
constraints:
  - 兼容逻辑只做校验视图归一化，不落盘、不回写历史回执
  - 活动任务回执必须继续严格失败，禁止全局放宽 deletionChecks 类型
  - 状态面只经 CLI 写入
---

## 背景

AF-578 收尾时记录了一笔既有债：全仓 `validate` 因 AF-534 / AF-535 / AF-557 三份旧回执的 `changedFiles.deletionChecks` 是字符串数组而报 `must be object`。三份回执已归档并冻结，改正文会破坏 sha256 与证据链，因此修复点必须在校验侧。

## 目标

- 已归档回执：历史结构按兼容视图校验，仅用于审计，不回写。
- 活动任务回执：继续按 receipt 2.1.0 严格校验，字符串项照样失败。
- 全仓 `validate` 回到全 PASS。

## 验收

1. `node scripts/orchestration/cli.mjs validate` 无 FAIL。
2. 新增两条单测分别覆盖 archived 兼容与 active 拒绝。
3. `events verify` PASS，三份历史回执文件内容未变。
4. 交付记录记录根因、边界与真实闸门数字。
