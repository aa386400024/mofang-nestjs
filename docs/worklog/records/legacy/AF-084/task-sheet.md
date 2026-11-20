---
taskId: AF-084
contextId: phase2.5-orchestration-closed-loop
title: 编排框架硬化：scope 重签发、回执预检、两阶段提交与 LF 规范化
type: implementation
status: backlog
baselineRef: 32b287a921eba84eab34f8fa4320f3317f10761a
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-18T05:10:00.000Z
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/cli.mjs
    - scripts/orchestration/reissue.mjs
    - scripts/orchestration/receipt-lint.mjs
    - scripts/orchestration/text-normalize.mjs
    - scripts/orchestration/task-entry-gate.mjs
    - scripts/orchestration/__tests__/orchestration.spec.mjs
    - docs/team/agent-orchestration/README.md
    - docs/worklog/pending/
    - docs/worklog/completed/phase2.5/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af084-orchestration-hardening-2026-11-18.md
    kind: report
gates:
  - command: corepack pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排单测全绿，覆盖重签发计划、回执预检、LF 规范化
    threshold: 0 failed
  - command: corepack pnpm lint
    check: lint 全绿且 scripts 段覆盖生效
    threshold: 0 error 0 warning
  - command: corepack pnpm test
    check: 全量单测全绿（收尾只跑一次）
    threshold: 0 failed
  - command: node scripts/orchestration/cli.mjs validate
    check: 状态索引、任务单、回执与契约目录全部 PASS
    threshold: exit 0
successCriteria:
  - 提供 task reissue / task rescope 受审计入口，scope 变更不在原任务上原地改写
  - 重签发只允许 backlog / ready 任务，强制 priorTasks 指向原任务，新任务登记 + 提级 + 原任务取消在同一次显式操作内完成
  - 提供 receipt lint 预检，覆盖七组字段、scope 外声明、状态面生成物、工件存在性与 CR 换行
  - 提供 docs normalize 只读检查与 --apply 落盘，统一 UTF-8 无 BOM + LF
  - preflight 的 no-active-task 提示补充两阶段提交说明，不改既有硬门
  - README 增补 scope 重签发、两阶段提交、回执预检、LF 规范化的操作口径
  - 全量测试只跑一次且记录真实数字，不新跑 LLM 批次、不改业务 src
---

# AF-084 · 编排框架硬化

## 背景

AF-079 的资源域登记错误暴露了「任务登记后 scope 无原地修订入口」；AF-080/082 又暴露了回执声明状态面文件、交付记录混入 CR 两个可预检的格式问题。上一轮用取消重登记与提交封套人工绕过，合法但步骤偏多。

本单把四类摩擦点固化成工具与规范：

1. **scope 重签发**：scope 是任务契约的一部分，登记后不原地改写；`task reissue` 在同一显式操作内登记新任务、提级、取消原任务，并要求 `priorTasks` 指向原任务。`task rescope` 作为同义入口，明确拒绝原地改 scope。
2. **回执预检**：`receipt lint` 在 `run-once` 之前检查七组字段、scope 外声明、状态面生成物、工件存在性与 CR 换行，避免验收时才被拒。
3. **两阶段提交**：实现提交必须在任务 `submitted` 时完成；回执摄入、completed/archived 与状态面单独提交。preflight 在 `no-active-task` 时给出该提示，不放宽硬门。
4. **LF 规范化**：`docs normalize` 统一 UTF-8 无 BOM + LF，支持只读检查与 `--apply`，避免跨平台 CR 触发机读护栏。

## 范围

- 只改编排工具链、单测与编排文档。
- 不改 `src/` 业务代码，不改数据库 / Redis，不新跑 LLM 批次。
- 不新增状态事件类型、不改框架契约版本；scope 变更走「重签发」而不是原地改契约。
- 既有 preflight 硬门、验收门、PR 门强度不降低。
