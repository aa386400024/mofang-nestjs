# AF-050 交付记录 · 修复 V7 验收对并行产物误判

- 任务单：`docs/worklog/pending/af050-v7-parallel-artifact-acceptance-fix-task-2026-11-17.md`
- 基线：`a27aba504b48b245f59a8f6ef1791310b68f94a9`（`integrate`）
- 交付时间：2026-11-17T17:24+08:00
- 类型：fix
- 结论：**passed**。V7 改为优先使用回执 `changedFiles` 声明集；未声明的脏文件在 `parallelArtifactsExcluded=true` 时只留痕、不再把并行产物算成本任务越界。

## 1. 问题复现

AF-047 摄入回执后，`run-once` 输出：

```text
[动作] receipt-ingested AF-047
[动作] rework-proposal AF-047
```

自动结论把 24 个 `admin-dashboard/pnpm-lock.yaml` 与 `data/batch-reports/**` 文件判为 AF-047 的 scope 外变更。实际：

- AF-047 回执 `changedFiles` 只声明 11 个本任务文件；
- 回执 `parallelArtifactsExcluded=true`；
- 24 个文件是并行前端锁文件与清库重建的既有产物，均不是 AF-047 写入。

AF-048 / AF-049 也被同一路径误判为 `rejected`，原因相同：V7 使用 `git diff --name-only HEAD` 整棵工作树，而不是回执声明集。

## 2. 改动

| 文件                                                                              | 改动                                                                                                                                                              |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/orchestration/acceptance-runner.mjs`                                     | 新增 `declaredReceiptFiles(task)`；V7 在无 commit 声明时优先按回执 `changedFiles` 比对；未声明脏文件在 `parallelArtifactsExcluded=true` 时留痕放行，未标记则 fail |
| `scripts/orchestration/receipts.mjs`                                              | 摄入回执时把 `changedFiles` 与 `parallelArtifactsExcluded` 写入任务运行态，供验收器读取                                                                           |
| `scripts/orchestration/__tests__/orchestration.spec.mjs`                          | 新增 AF-050 V7 用例：声明集通过 + 并行留痕、未标记并行失败、声明集越界失败；单测 204 → 205                                                                        |
| `docs/worklog/completed/phase2.5/af047-dev-orchestration-mandatory-2026-11-17.md` | 追加 §9 验收后记，记录机器 rejected 的真实原因与修复任务，不改历史结论                                                                                            |

## 3. V7 行为矩阵

| 场景                                                              | 结果                                     |
| ----------------------------------------------------------------- | ---------------------------------------- |
| 回执声明 `changedFiles` 且全部在 scope                            | pass；工作树未声明脏文件按并行产物留痕   |
| 回执声明 `changedFiles` 含 scope 外文件                           | fail（`回执声明集含 scope 外文件`）      |
| 回执未标记 `parallelArtifactsExcluded=true`，工作树有未声明脏文件 | fail（`未声明脏文件`）                   |
| 回执声明 `changedFiles.commits`                                   | 保持 commit 事实比对，优先级最高         |
| 无回执声明、无 commit                                             | 保持整棵工作树比对（旧行为，不默认放行） |
| 状态面生成物 / 本任务任务单                                       | 继续豁免，不要求写进 scope               |

## 4. gateResults

| 命令                                                                          | 退出码 | 结果                                                     |
| ----------------------------------------------------------------------------- | ------ | -------------------------------------------------------- |
| `node --check scripts/orchestration/acceptance-runner.mjs`                    | 0      | 语法通过                                                 |
| `node --check scripts/orchestration/receipts.mjs`                             | 0      | 语法通过                                                 |
| `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 0      | 1 文件 / 205 用例 passed / 0 failed                      |
| `pnpm typecheck`                                                              | 0      | 0 error                                                  |
| `pnpm lint`                                                                   | 0      | 0 error / 0 warning（仅覆盖 `{src,test,bin}/**/*.ts`）   |
| `$env:ORCH_REQUIRE_FRAMEWORK='1'; pnpm orchestration:validate`                | 0      | 55 项 PASS，含索引投影与事件链                           |
| `node scripts/orchestration/cli.mjs events verify`                            | 0      | 202 条事件，schema + 哈希链 + 索引投影一致（回执摄入前） |

`scripts/` 不在 ESLint 项目内，本次新增/修改的 `.mjs` 以 `node --check` 与 205 例 vitest 兜底；该覆盖缺口如实记录，不冒充 lint 已覆盖。

## 5. scopeCheck

- 实际改动：`scripts/orchestration/acceptance-runner.mjs`、`scripts/orchestration/receipts.mjs`、`scripts/orchestration/__tests__/orchestration.spec.mjs`、AF-047 交付记录后记、AF-050 任务单与交付记录。
- 全部落在 AF-050 `scope.files`：`scripts/orchestration/`、`docs/worklog/pending/`、`docs/worklog/completed/`。
- `data/batch-reports/**`、`admin-dashboard/pnpm-lock.yaml`、`docs/architecture/phase3-...md` 为并行/清库产物，未声明、未 stage、未提交。
- `src/engine-core` 零改动。

## 6. contractChecks

| 项           | 结果 | 说明                                                           |
| ------------ | ---- | -------------------------------------------------------------- |
| taskId       | pass | 任务单 / 交付记录 / 回执均为 AF-050                            |
| state-write  | pass | 登记、提级、领单、回执摄入、归档均经 CLI；未手改索引或 journal |
| index-schema | pass | `task-state-index.json` 1.1.0，索引投影一致                    |
| event-chain  | pass | 摄入前 202 条，哈希链与投影一致                                |

## 7. backlogItems

1. **AF-047-O1 沿用**：提交前门禁只覆盖 `mofang-nestjs`；Flutter、psyguard、framework 仓尚未接入。
2. **AF-047-O2 沿用**：`git --no-verify` 可跳过本地 Husky；服务器端 CI 才能彻底封死。
3. **AF-050-O1**：AF-047 / AF-048 / AF-049 已被归档为 `rejected`，框架禁止改写终态；本轮只修复验收器并保留历史事件，不伪造 `completed`。后续同类误判可用 AF-050 之后的新任务重新验收。
4. **AF-050-O2**：`git diff --name-only HEAD` 不包含未跟踪文件，V7 的“未声明脏文件”留痕当前只覆盖已跟踪改动；未跟踪并行稿仍依赖 `parallelArtifactsExcluded` 与人工复核。

## 8. deviationTable

| 项        | 任务单写法               | 实际                                  | 处理                                               | 原因                         |
| --------- | ------------------------ | ------------------------------------- | -------------------------------------------------- | ---------------------------- |
| 任务范围  | 只修复 V7 误判           | 复核时发现 AF-048 / AF-049 同样被误判 | 交付记录扩展复核结论，不改历史终态                 | 终态只能经 CLI，归档不得改写 |
| 交付记录  | 只写 AF-050              | 追加 AF-047 §9 后记                   | 保留原记录并说明 rejected 根因                     | 审计需要可追溯，不覆盖历史   |
| lint 覆盖 | 任务闸门包含 `pnpm lint` | `scripts/**/*.mjs` 不在 ESLint 项目   | 用 `node --check` + 205 例单测兜底，并显式登记缺口 | 不把 lint 绿当成全仓覆盖     |
| 提交      | 任务分支提交             | 未切分支、未提交                      | 保持工作区，等待统一收尾                           | 并行产物多，避免污染         |

## 9. reviewVerdict

**passed**。V7 根因已复现、修复并用三组负向/正向用例锁定；205 例单测、typecheck、lint、55 项适配层校验与 202 条事件链全部通过。历史任务终态未被篡改，误判事实与修复边界均已记录。

## 10. 结论

这不是 AF-047 的内容失败，而是验收器的边界缺陷。AF-050 修完后：

- 有回执声明集的任务不再被同批次并行产物误杀；
- 回执未标记并行时仍然严格失败，不会默认放行；
- commit 声明、状态面豁免、任务单豁免三条既有路径未回退。
