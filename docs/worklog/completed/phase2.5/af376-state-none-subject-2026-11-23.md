# AF-376 修复纯状态面提交被 subject 任务号误判冲突

> 状态：实现完成，待回执冻结与验收（2026-11-23）
> 执行方：Doubao 主控 AI（orchestrator 自做）
> 仓库：`D:\work\Project\backend\mofang-nestjs-af281r`，分支 `task/AF-376-state-none-subject`
> 任务性质：CI 编排门解析修复
> 改动范围：`scripts/orchestration/ci-task-gate.mjs` 与单测，不触碰 engine-core、业务与状态面生成物。

## 1. 背景

AF-375 的状态快照提交使用 `Task: none`，subject 自然写 `AF-375`，CI 逐提交门返回 `ambiguous-task-id`，导致 PR #182 失败。纯状态面已由 `state-none-with-impl` 单独硬失败，subject 提及所属任务号是合法上下文，不应再判冲突。

## 2. 改动清单

- `scripts/orchestration/ci-task-gate.mjs`
  - `resolveCommitTaskId`：`Task: none` 分支直接返回 `{taskId:null, source:'trailer', none:true}`，不再因 subject 含任务号抛错。
  - 保留 `state-none-with-impl`：`Task: none` 只要携带实现文件仍硬失败。
  - 保留 trailer 与 subject 任务号不一致的硬失败。
- `scripts/orchestration/__tests__/orchestration.spec.mjs`
  - 原冲突用例改为断言解析为 `none`。
  - 纯状态面判定用例改用“subject 含任务号 + 实现文件”，继续断言 `state-none-with-impl`。

## 3. 验证

- `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs`：268 passed。
- 本地用新代码复核 AF-375 的 4 个提交：4 passed / 0 failed，两个状态快照提交判定为 `state-plane-only`。

## 4. 与任务单的偏差

无。

## 5. 提交序列

1. 首个提交包含任务单、代码修复与本交付记录。
2. 第二个提交包含冻结回执与 manifest。
3. PR 基于 AF-375 的 `d333af50` 堆叠，原 PR #182 关闭，由本 PR 取代。
