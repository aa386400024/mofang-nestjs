---
taskId: AF-161
contextId: phase2.5-orchestration-closed-loop
title: worklog 记录包化：inbox/records 生命周期与历史迁移
type: implementation
status: backlog
baselineRef: 4059a39
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-20T03:25:00+08:00
deadline: 2026-11-20T08:00:00+08:00
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/
    - scripts/orchestration/__tests__/
    - docs/worklog/
    - docs/team/agent-orchestration/
    - .github/workflows/
  modules: [orchestration]
  interfaces:
    - node scripts/orchestration/cli.mjs
    - node scripts/orchestration/worklog.mjs
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af160-worklog-record-bundles-2026-11-20.md
    kind: report
gates:
  - command: pnpm lint
    check: lint 零错误
    threshold: exit=0
  - command: pnpm typecheck
    check: 类型检查零错误
    threshold: exit=0
  - command: node --test scripts/orchestration/__tests__
    check: 编排单测全绿
    threshold: exit=0
  - command: pnpm test
    check: 全量测试通过
    threshold: exit=0
successCriteria:
  - inbox 只允许未登记草稿，终态任务单不得留在 inbox
  - 登记即把任务单移入 records/<contextId>/<taskId>/task-sheet.md，并写 manifest 与 SHA-256
  - 回执摄取写入 records 记录包，不再依赖 pending/archive
  - 旧任务双读兼容，174 个归档任务迁移后全部指针可解析
  - worklog verify 检出断链、哈希不匹配、重复 taskId、孤儿包、终态在 inbox
  - 121 张历史任务单一次性迁移，迁移脚本可重复执行且无副作用
  - events verify / lint / typecheck / 编排单测 / 全量测试全绿
---

# AF-160 · worklog 记录包化

## 背景

`docs/worklog/pending` 同时承担“未登记草稿”“历史任务单”“回执归档”“常驻参考文档”，
141 个文件里 121 张任务单全部已归档。根因不是闭环缺失，而是归档生命周期没有定义
任务单正文的最终位置：`archiveTaskSheetFile` 只处理 transport 副本，pending 里的
markdown 原地不动，`artifacts.taskSheet` 永久指向 pending。

## 目标

一次完成企业级收口：

1. `inbox/` 只放未登记草稿；登记即移入 `records/<contextId>/<taskId>/`。
2. 一个任务一个不可变记录包：`manifest.json` + `task-sheet.md` + `receipt-*.json`。
3. 回执摄入、归档、PR gate、CI gate 全部改读记录包，旧路径 dual-read 过渡。
4. 121 张历史任务单与 134 份回执一次性迁移，旧指针全部改写并校验。
5. 新增 `worklog verify` / `worklog stats`，纳入 CI 与 preflight。
6. 全程经 CLI 事务化迁移，禁止手工 mv / 手改索引。

## 非目标

- 不改生产 `src/` 业务代码。
- 不改 13 项 required checks 的名称与保护规则。
- 不为迁移重写历史提交；用 `git mv` 保留 blame。

