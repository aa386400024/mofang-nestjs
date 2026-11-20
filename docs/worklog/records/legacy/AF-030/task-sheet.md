---
taskId: AF-030
contextId: phase2.5-orchestration-closed-loop
title: 验收护栏收口：任务单豁免 V7 + 索引工件指针三键（AF-024 返修）
type: implementation
status: backlog
baselineRef: 04f6524
dependsOn: [AF-023]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs:
  - conventions.md#1.3
  - conventions.md#1.4
createdAt: 2026-11-17T10:44:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/
    - docs/team/agent-orchestration/
    - docs/worklog/pending/
    - docs/worklog/completed/
  modules: []
  interfaces: []
artifacts:
  - name: 验收护栏收口实施记录
    path: docs/worklog/completed/phase2.5/af030-acceptance-guard-closure-2026-11-17.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排单测全绿
    threshold: 'failed=0'
  - command: ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate
    check: 适配层框架 schema 校验全 PASS
    threshold: 'fail=0'
successCriteria:
  - 任务单自身的状态行改动不再被 V7 判成越域残留，同目录其它任务单仍算交付面
  - 索引归档条目的 artifacts 只落 taskSheet / deliveryRecord / reply 三键，回执 others 留在运行态
  - 上述两条各有单测与仓内真实索引的 schema 复核
evidenceFormat: 命令 + exit code + 用例数；索引复核取 validate 的 PASS/FAIL 行
---

# AF-030 验收护栏收口（AF-024 返修任务单）

## 1. 背景

AF-024 首次自动验收被判 `rejected`，机读理由是「scope 外变更文件：docs/worklog/pending/af024-gui-dispatch-task-2026-11-17.md」。该文件就是本次任务自己的任务单——登记、提级、提交、归档每一跳都会改写它的 `status` 行与 §状态，把它算成交付残留，等于任何走正规流程的任务都必然被拒。

同一轮验收还暴露出第二处：AF-024 归档条目带 `artifacts.others`，框架 `task-state-index 1.1.0` 的归档工件对象是 `additionalProperties=false` 且只允许三键，索引 schema 直接判 FAIL。

两处都属验收护栏与投影口径缺陷，不是 AF-024 的交付内容问题（AF-024 的四闸、真实 GUI 投递、协商轮评审均已完成）。返修关系记在正文：本单 `reworkOf=AF-024`；`dependsOn` 只放真正的前置任务 AF-023——把返修关系写成依赖会让 rejected 上游卡死新单（AF-029 就是这么废掉的，已 canceled 归档留痕）。

## 2. 目标

- V7 残留比对按「本任务自己的任务单路径」精确豁免，不按目录前缀豁免（避免同目录其它任务单被一起放过）。
- 索引投影只落三键工件指针；回执 `artifactRefs.others` 保留在 `task.receipt`，不进索引。
- 两处都要有单测固定，并用仓内真实索引跑一次 schema 复核。

## 3. 切片（scope）

纳管 `scripts/orchestration/` 的验收与投影实现、`docs/team/agent-orchestration/` 的口径说明与运行态重建、本单任务单与交付记录。不改业务代码，不改框架仓 schema（上游口径本就更严，是本仓投影写错）。

## 4. 验收

- `runAcceptance` 传入「本任务任务单」变更项时 V7 为 pass，传入其它任务单时仍 fail；
- `pickArtifactPointers` 只返回三键，归档条目 schema 复核 PASS；
- `events rebuild` 后 `validate` 全 PASS、`events verify` 哈希链一致。

## 5. 状态

✅ 已交付。根因与修法见 `docs/worklog/completed/phase2.5/af030-acceptance-guard-closure-2026-11-17.md`；AF-024 的历史 `rejected` 记录保留不改写，本单承担其返修。
