---
taskId: AF-050
contextId: phase2.5-orchestration-enforcement
title: 修复 V7 验收对并行产物误判（回执声明变更集优先 + 工作树并行留痕）
type: fix
status: backlog
baselineRef: a27aba504b48b245f59a8f6ef1791310b68f94a9
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs:
  - conventions.md#1.3
  - conventions.md#1.4
  - agent-orchestration/README.md#0
createdAt: 2026-11-17T17:22:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/
    - docs/worklog/pending/
    - docs/worklog/completed/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af050-v7-parallel-artifact-acceptance-fix-2026-11-17.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排单测与 V7 边界用例全绿
    threshold: 'failed=0'
  - command: pnpm typecheck
    check: 类型检查通过
    threshold: 'errors=0'
  - command: pnpm lint
    check: lint 无新增 error / warning
    threshold: 'errors=0'
  - command: ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate
    check: 适配层机读校验全 PASS
    threshold: 'FAIL=0'
successCriteria:
  - 回执 changedFiles 声明的交付集优先用于 V7，不再把整棵工作树当成本任务变更
  - 未声明的脏文件按并行产物排除，但必须在回执 parallelArtifactsExcluded=true 时放行并留痕
  - 原有 commit 声明路径、状态面豁免、本任务任务单豁免保持不回退
  - 单测覆盖「声明集全在域内 + 工作树有并行脏文件→pass」「声明集含域外文件→fail」「未声明且未标记并行→fail」
  - AF-047 / AF-048 / AF-049 的机器 rejected 结论复核写入交付记录，明确是 V7 全树误判而非交付内容失败
evidenceFormat: vitest 用例数 + V7 四类结果 + typecheck/lint 结果 + validate PASS 计数 + 真实 run-once 复核证据
---

# AF-050 · 修复 V7 验收对并行产物误判

## 1. 问题

AF-047 回执摄入后，`run-once` 给出 `rework-proposal` 并归档为 `rejected`，自动结论是：

> 机读护栏不通过：scope 外变更文件（不进提交分组）：admin-dashboard/pnpm-lock.yaml；data/batch-reports/** 等 24 个文件。

这些文件不是 AF-047 的改动：`admin-dashboard/pnpm-lock.yaml` 是并行前端产物，`data/batch-reports/**` 是清库重建的既有删除/新增。AF-047 回执的 `changedFiles` 只声明 11 个本任务文件，且 `parallelArtifactsExcluded=true`，但验收器没有使用回执声明集，仍拿 `git diff --name-only HEAD` 整棵工作树比对。AF-048 / AF-049 同样被这套逻辑误判为 `rejected`。

## 2. 目标

V7 的比对基准改为：

1. 回执声明了 `changedFiles`（added/modified/deleted 至少一项）→ 以声明集为交付面，只对它做 scope 比对。
2. 工作树中未声明的脏文件 → 不计入本任务交付面；若回执明确 `parallelArtifactsExcluded=true`，在 V7 detail 留痕（数量 + 前几项），否则仍判 fail。
3. 回执声明了 `changedFiles.commits` → 保持现有 commit 事实比对路径，优先级不变。
4. 无回执声明、无 commit → 退回整棵工作树比对（保持旧行为，避免默认放行）。

## 3. 验收

- 单测覆盖四类 V7 路径：声明集通过、声明集越界失败、并行未声明且已标记通过、并行未声明且未标记失败。
- AF-047 / AF-048 / AF-049 复核结论写入交付记录，说明机器 rejected 的根因与处置边界。
- 不修改任何业务代码、引擎内核或数据面。
