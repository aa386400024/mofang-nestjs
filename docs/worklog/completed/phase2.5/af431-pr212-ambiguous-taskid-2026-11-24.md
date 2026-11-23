# AF-431 交付记录：PR #212 提交标题歧义修复

- 日期：2026-11-24
- 任务：AF-431（fix / orchestrator）
- 基线：`67e54372e171920fad603e667b181cfce59cb9b7`
- 分支：`task/AF-427-operator-delta-ledger`（补丁尾提交，随 PR #212 合入）

## 1. 现象

PR #212 CI `Orchestration Gate` 失败，作业日志中 `ci-task-gate.mjs` 逐提交判定：

```
[ORCH-CI-GATE] PASS 84249acdfc23 task=AF-427 reason=pass files=7
[ORCH-CI-GATE] PASS b5c94f3a7015 task=state-plane reason=state-plane-only files=4
[ORCH-CI-GATE] FAIL b370f88470e6 reason=ambiguous-task-id subject=fix(af429): AF-427 端到端用例加无语料守卫（data/debug-sessions 被 gitignore）
[ORCH-CI-GATE] PASS 4544a01d49c3 task=state-plane reason=state-plane-only files=4
```

`b370f884` 的标题里既有 `af429` 又有 `AF-427`（描述里想说明「修的是 AF-427 的用例」），被判 `ambiguous-task-id`，门禁整条 PR 不通。

## 2. 修复

`git rebase` 停在 `b370f884`，`git commit --amend` 仅改标题为：

```
fix(af429): 端到端用例加无语料守卫（data/debug-sessions 被 gitignore）
```

tree 不变（`git diff b370f884 <新哈希>` 为空），其余三条提交原样重放。

## 3. 教训

**提交标题是机读字段，不是散文。** 描述「修的是哪个任务的产物」时不能把另一个 taskId 写进标题，只能写进正文；`ci-task-gate` 对标题做的是 taskId 计数，不是语义理解。

## 4. 闸门

| 闸门          | 命令                                                         | 结果          |
| ------------- | ------------------------------------------------------------ | ------------- |
| 记录包校验    | `node scripts/orchestration/cli.mjs worklog verify --strict` | PASS          |
| 标题单 taskId | `git log --format=%s b5c94f3a..HEAD` 人眼 + CI 复核          | 逐条单 taskId |
| 内容不变      | `git diff b370f884 <新哈希> --stat`                          | 空            |
