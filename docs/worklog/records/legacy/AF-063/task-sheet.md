---
taskId: AF-063
contextId: phase2.5-orchestration-closed-loop
title: 编排门 squash 标题去重返修
type: fix
status: backlog
baselineRef: 29a855b5122c86b4754b9d245f75babceb92de83
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-17T21:12:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/branch-workflow.mjs
    - scripts/orchestration/__tests__/orchestration.spec.mjs
    - docs/worklog/completed/phase2.5/
    - docs/worklog/pending/
    - docs/worklog/README.md
    - docs/team/agent-orchestration/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af063-orchestration-squash-title-rework-2026-11-17.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排单测全绿
    threshold: 0 failed
  - command: pnpm typecheck
    check: 0 error
    threshold: 0 error
  - command: pnpm lint
    check: 0 error
    threshold: 0 error
  - command: node scripts/orchestration/cli.mjs events verify
    check: 事件链与索引投影一致
    threshold: exit 0
successCriteria:
  - 交付记录任务单链接用 ../../pending/ 解析到真实文件，V4 断链归零
  - 交付记录含 gateResults / scopeCheck / contractChecks / backlogItems / deviationTable / reviewVerdict 六组机读标记
  - 保留 AF-062 已实测的 squash 标题去重代码与 233 项编排单测
  - AF-063 合并后 integrate 新 HEAD 的 Orchestration Gate 为 success
  - 不改 AF-062 归档终态，不把 AF-062 rejected 提交带入 AF-063 PR
evidenceFormat: 链接检查 + 六组标记 + 单测用例数 + merge SHA + push 门 conclusion
---

# AF-063 · 编排门 squash 标题去重返修

> 状态：✅ 已验收（2026-11-17，PR 待合并）
> 执行方：自做
> 仓库：`D:\work\Project\backend\mofang-nestjs`
> 基线：`29a855b5122c86b4754b9d245f75babceb92de83`

## 1. 背景

AF-062 修好了 squash 标题生成器，但机读验收被判 `rejected`，原因不在代码：

```text
断链：../pending/af062-orchestration-squash-title-task-2026-11-17.md
交付记录未出现字段标记：gateResults
交付记录未出现字段标记：scopeCheck
交付记录未出现字段标记：contractChecks
交付记录未出现字段标记：backlogItems
交付记录未出现字段标记：deviationTable
交付记录未出现字段标记：reviewVerdict
```

交付记录位于 `docs/worklog/completed/phase2.5/`，`../pending/` 会解析到不存在的 `completed/pending/`；正确路径是 `../../pending/`。六组机读标记也漏写。AF-062 的生成器修复与 233 项单测本身是绿的。

## 2. 范围

- 保留 `buildSquashCommitMessage()` 的任务号剥离逻辑与回归用例（来自 AF-062 已实测提交 `94fd133`）。
- 新建 AF-063 交付记录，链接改为 `../../pending/`，补齐六组机读标记。
- 从 `integrate` 干净切分支，只提交 AF-063 自己的提交；AF-062 的 rejected 提交留在原分支。
- 重新走登记、领单、回执、验收、PR 与合并后 push 门验证。

**明确不在范围内：**

- 不改 `ci-task-gate.mjs` 的唯一任务号规则。
- 不改 AF-062 的 rejected 终态与原始提交。
- 不改业务源码、不跑 LLM 批次、不动数据库与 `.env`。

## 3. 交付物

1. **代码**：`scripts/orchestration/branch-workflow.mjs` 标题剥离逻辑。
2. **测试**：`scripts/orchestration/__tests__/orchestration.spec.mjs` 三类引用回归用例。
3. **交付记录**：`docs/worklog/completed/phase2.5/af063-orchestration-squash-title-rework-2026-11-17.md`。
4. **机读回执**：`transport/receipts/AF-063.json`，六组字段齐全；durable 副本进 `pending/archive/`。
5. **状态面**：仅经 CLI 写；合并后验证 integrate 新 HEAD 的 push 门。

## 4. 红线

- 不跳过 Husky、不 `--no-verify`、不关闭保护、不手改状态面。
- 不把 AF-062 rejected 提交 cherry-pick 进 AF-063 的提交集合。
- 不把外部任务引用写进 squash 标题。
- 不改写 AF-061/AF-062 的归档历史。

## 5. 闸门

| 闸门     | 命令                                                                          | 阈值     |
| -------- | ----------------------------------------------------------------------------- | -------- |
| 编排单测 | `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 0 failed |
| 类型检查 | `pnpm typecheck`                                                              | 0 error  |
| Lint     | `pnpm lint`                                                                   | 0 error  |
| 内核边界 | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                      | 0 failed |
| 状态链   | `node scripts/orchestration/cli.mjs events verify`                            | exit 0   |

## 6. 完成判据

- [x] 交付记录链接解析到真实文件，V4 断链归零。
- [x] 交付记录六组机读标记齐全。
- [x] 编排单测 233 项、typecheck、lint、boundary 全绿。
- [ ] AF-063 合并后 integrate 新 HEAD 的 Orchestration Gate 为 success。
