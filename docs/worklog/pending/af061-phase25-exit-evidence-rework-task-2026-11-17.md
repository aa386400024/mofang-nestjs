---
taskId: AF-061
contextId: phase2.5-export-evidence
title: Phase2.5 出口条件取证重定（AF-060 验收断链返修）
type: verification
status: backlog
baselineRef: 4c4f695d89ce697451c6136f95230341024b3a7e
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-17T20:55:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - docs/worklog/completed/phase2.5/phase2.5-exit-evidence-2026-11-17.md
    - docs/worklog/pending/af061-phase25-exit-evidence-rework-task-2026-11-17.md
    - docs/worklog/pending/phase2.5-README.md
    - docs/worklog/pending/phase2.5-wp-list-2026-11-08.md
    - docs/worklog/README.md
    - docs/worklog/pending/archive/
    - data/batch-reports/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/phase2.5-exit-evidence-2026-11-17.md
    kind: report
gates:
  - command: pnpm typecheck
    check: 0 error
    threshold: 0 error
  - command: pnpm lint
    check: 0 error
    threshold: 0 error
  - command: pnpm exec vitest run test/engine-core/boundary.spec.ts
    check: boundary 全绿
    threshold: 0 failed
  - command: node scripts/orchestration/cli.mjs events verify
    check: 事件链与索引投影一致
    threshold: exit 0
successCriteria:
  - AF-060 交付记录内两处相对链接改为可解析路径，验收 V4 断链归零
  - AF-060 的取证内容、数字与结论不改写；本单只做链接返修与验收回放
  - 交付记录、回执六组字段、durable 副本齐全；AF-061 completed 后归档
  - 全程不新跑 LLM 批次、不改业务源码、不动并行产物
  - typecheck / lint / boundary / events verify 定向闸门全绿
evidenceFormat: 链接解析结果 + 验收结论 + 闸门退出码 + 事件条数
---

# AF-061 · Phase2.5 出口条件取证重定（AF-060 验收断链返修）

> 状态：📋 待执行（2026-11-17）
> 执行方：自做
> 仓库：`D:\work\Project\backend\mofang-nestjs`，stacked 分支 `task/AF-061-phase25-exit-evidence-rework`
> 基线：`4c4f695d89ce697451c6136f95230341024b3a7e`

## 1. 背景与根因

AF-060 首轮 `run-once` 的机读验收结论为 `rejected`：

```text
机读护栏不通过：断链：phase2.5-README.md；phase2.5-wp-list-2026-11-08.md
```

根因是交付记录顶部两个相对链接按交付记录所在目录解析：

- `docs/worklog/completed/phase2.5/phase2.5-exit-evidence-2026-11-17.md`
- `[Phase2.5 工作入口](phase2.5-README.md)` → 应指向 `../../pending/phase2.5-README.md`
- `[WP 登记表](phase2.5-wp-list-2026-11-08.md)` → 应指向 `../../pending/phase2.5-wp-list-2026-11-08.md`

AF-060 的取证内容本身未失败；本单只修链接并重新走验收，不改写既有数字与结论。

## 2. 范围

- 修 `phase2.5-exit-evidence-2026-11-17.md` 两处相对链接。
- 保留 AF-060 交付记录与两次提交，不重写历史。
- 重新登记回执、跑 `run-once`、归档、PR 与合并。
- 复核 `phase2.5-README.md`、`phase2.5-wp-list-2026-11-08.md`、`docs/worklog/README.md` 的链接可达。

**明确不在范围内：**

- 不新跑 LLM 批次，不改数据库、`.env`、业务源码。
- 不重判出口 ④ 数值；只做验收链路返修。
- 不改 AF-060 已归档终态。

## 3. 交付物

1. **链接修复**：交付记录两个入口链接改为 `../../pending/...`。
2. **验收回放**：`run-once` 摄入 AF-061 回执，V4 `相对链接目标均存在`。
3. **交付记录**：沿用 `phase2.5-exit-evidence-2026-11-17.md`，补 AF-061 返修说明与验收结果。
4. **机读回执**：`transport/receipts/AF-061.json`，六组字段齐全；durable 副本进 `pending/archive/`。
5. **文档回写**：`docs/worklog/README.md` 与 Phase2.5 入口补 AF-061 返修记录。

## 4. 红线

- 心理对话原文禁止进日志、console、交付记录或回执；只允许 debug session id、角色 slug、模式 id、维度名、数值、事件枚举。
- 不改写 AF-060 的 `rejected` 历史，不以返修覆盖原始终态；新任务承接。
- 不把单批 WP-K 输出冒充四态结论；出口 ④ 结论保持“未通过 / 核心指标不可判”。
- 不跳过 Husky、不 `--no-verify`、不关闭保护、不手改状态面。

## 5. 闸门

| 闸门     | 命令                                                     | 阈值     |
| -------- | -------------------------------------------------------- | -------- |
| 类型     | `pnpm typecheck`                                         | 0 error  |
| Lint     | `pnpm lint`                                              | 0 error  |
| 内核边界 | `pnpm exec vitest run test/engine-core/boundary.spec.ts` | 0 failed |
| 状态链   | `node scripts/orchestration/cli.mjs events verify`       | exit 0   |

## 6. 完成判据

- [ ] 交付记录两处链接解析到真实文件，V4 断链归零。
- [ ] `run-once` 验收为 completed，回执六组字段齐全。
- [ ] 闸门数字真实、退出码可复现。
- [ ] 归档、PR、merge 后 push 证据完整。
