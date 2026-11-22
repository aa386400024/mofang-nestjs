---
taskId: AF-163
contextId: phase2.5-orchestration-closed-loop
title: worklog 历史证据收口与最终形态
type: fix
status: backlog
baselineRef: 3c8a859b855189848fb99056b59fe9135f7bfb1c
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-20T09:35:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/
    - docs/worklog/
    - docs/team/agent-orchestration/
  modules: [orchestration]
  interfaces:
    - node scripts/orchestration/cli.mjs
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af163-worklog-final-closeout-2026-11-20.md
    kind: report
gates:
  - command: pnpm lint
    check: lint 零错误
    threshold: exit=0
  - command: pnpm typecheck
    check: 类型检查零错误
    threshold: exit=0
  - command: pnpm test
    check: 全量测试通过
    threshold: exit=0
successCriteria:
  - AF-060 历史任务单从 git 历史收养进记录包，无任务单计数从 15 降到 14
  - 14 个墓碑 manifest 带可审计的缺失证据，并生成 TOMBSTONES.md 台账
  - 全部 manifest 的 deliveryRecord 从索引事实补齐；AF-065 交付指针指向实际合并交付记录
  - worklog verify --strict 检查 completed 任务的交付记录存在性并通过
  - 编排 README 的目录映射、relay 监听、回执归档口径与 records 生命周期一致
---

# AF-163 · worklog 历史证据收口与最终形态

## 背景

AF-161/AF-162 已完成 worklog 记录包化与验收返修，但历史证据还有三处未收口：

1. AF-060 的任务单在 git 历史 `8ed0a10` 可达，却仍以墓碑呈现；其余 14 个墓碑缺少统一的可审计证据台账。
2. 记录包 manifest 未写 `deliveryRecord`，AF-065 的索引交付指针指向不存在的文件，而实际正文在 AF-068/AF-065 合并交付记录里。
3. `worklog verify --strict` 只校验任务单，不校验 completed 任务的交付记录存在性；编排 README 仍有 pending 时代的目录映射描述。

## 目标

- 从 git 历史恢复可取得的 AF-060 任务单，写 manifest 哈希与恢复来源；
- 为不可恢复的 14 个墓碑写入 `tombstone` 证据块并生成 `TOMBSTONES.md`；
- 全量补齐 manifest 的 `deliveryRecord`；AF-065 以实际合并交付记录为规范位置，旧路径留转发说明；
- 校验器增加 completed 交付记录存在性检查；
- 同步编排 README 的目录映射、relay 监听与回执归档口径；
- 全量闸门与 `worklog verify --strict` 通过。

## 非目标

- 不伪造任何不存在的任务单或交付记录；
- 不改写不可变归档索引指针；
- 不搬迁 pending 中的 Phase2/2.5 母版与 relay 历史参考；
- 不动 `src/` 生产业务代码。
