---
taskId: AF-598
contextId: phase2.5-quality-gates
title: 记录包生成器跨平台哈希与未合并分支提示加固
type: fix
status: backlog
baselineRef: 39790d73d41d024af49d8ffab250bd6a4c0a709f
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-28T17:00:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/
    - docs/worklog/pending/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-quality-gates/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af598-worklog-record-hardening-2026-11-28.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__
    check: 编排层定向测试全绿
    threshold: 0 failed
  - command: pnpm typecheck
    check: 类型检查 0 error
    threshold: exit 0
  - command: pnpm lint
    check: Lint 0 error
    threshold: exit 0
  - command: pnpm test
    check: 全量测试全绿
    threshold: 0 failed
successCriteria:
  - 任务单哈希统一按 UTF-8 无 BOM、LF 规范化后的文本计算，跨 Windows/Linux 结果一致
  - 登记与 worklog 迁移在写 manifest 前自动规范化任务单换行与 BOM
  - verify 对缺 manifest 给出未合并任务分支提示，对哈希不匹配给出 migrate 修复提示
  - 新增定向测试覆盖 LF/CRLF/BOM 同哈希、登记后文工件规范化、错误提示可行动
  - 定向测试、typecheck、lint、全量测试全绿，engine-core 零 diff
objective: 消除记录包 manifest 因 CRLF/BOM 与跨平台检出造成的假失败，并让未合并任务分支的记录包缺口在 PR 门之前可诊断
outOfScope:
  - 不改任务状态机、事件链、PR 合并门语义
  - 不改既有已完成任务的业务证据内容
  - 不引入新依赖
  - 不触碰 src/engine-core
constraints:
  - 只通过 CLI 写状态面，不手改 task-state-index.json 或 journal.jsonl
  - 任务单、交付记录、回执统一 UTF-8 无 BOM + LF
  - 兼容既有 manifest 格式，不新增破坏性 schema 字段
---

# AF-598 · 记录包生成器跨平台哈希与未合并分支提示加固

> 状态：📋 待执行（2026-11-28）
> 执行方：自做
> 分支：task/AF-598-worklog-record-hardening
> 唯一事实源：AF-597 PR #307 的 Orchestration Gate 失败证据

## 1. 背景

AF-597 的 PR 门失败不是业务代码问题，而是 `worklog verify --strict --state-free` 暴露了两类记录包欠账：

- AF-593/594/595 的 `task-sheet.md + manifest.json` 只在各自未合并任务分支，记录包没有进入 `integrate`；
- AF-596 manifest 保存的是 CRLF 任务单哈希，而提交进仓库的是 LF blob，Linux CI 因此判定哈希不匹配。

当前 `worklog.mjs` 的 `sha256File` 直接对原始文本求哈希，任务单又可能在 Windows 编辑器、PowerShell 写盘或旧迁移路径中带入 CRLF/BOM。结果同一份逻辑内容在不同平台生成不同 manifest。

## 2. 目标

1. 任务单哈希以规范化文本为准：UTF-8 去 BOM、CRLF/孤立 CR 统一为 LF，再计算 SHA-256。
2. 登记与迁移在写 manifest 前自动规范化任务单文件，避免 manifest 与仓库 blob 口径漂移。
3. `verify` 对缺 manifest 明确提示“记录包可能滞留未合并任务分支”，对哈希不匹配明确提示执行 `worklog migrate --apply`。
4. 新增定向测试，覆盖跨换行/编码同哈希与可行动错误提示。

## 3. 范围

在范围内：

- `scripts/orchestration/worklog.mjs`
- `scripts/orchestration/__tests__/af598-worklog-record-hardening.spec.mjs`
- 本任务单、交付记录、回执

不在范围内：

- 不改任务状态机、事件链、PR 合并门语义
- 不改既有已完成任务的业务证据内容
- 不引入新依赖
- 不触碰 `src/engine-core`

## 4. 闸门

- 定向：`pnpm exec vitest run scripts/orchestration/__tests__`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `git diff --stat HEAD -- src/engine-core` 为空

## 5. 交付记录

`docs/worklog/completed/phase2.5/af598-worklog-record-hardening-2026-11-28.md`
