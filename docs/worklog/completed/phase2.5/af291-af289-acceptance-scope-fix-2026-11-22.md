# AF-291 · AF-289 验收 scope 修正与 stacked 合并（2026-11-22）

## 1. 为什么开这一单

AF-289 的代码、测试、真实故障取证都已提交，但任务单 frontmatter 漏写 `scope.files`，登记后索引里 scope 为空。`run-once` 摄入回执时按 commit 事实比对，AF-289 的 11 个改动文件全部被判“scope 外”，任务被归档为 `rejected`，并生成 `RW-AF-289-1` 返修提案。

第一次返修尝试用 AF-290（agentRole=orchestrator）重开，被 `scope-domain-conflict` 拦截：orchestrator 的 Agent Card 资源域不含 `src/`、`test/`、`bin/`，不能写业务实现。AF-290 随即被取消。

最终按编排规范 §4 开 AF-291，agentRole=executor，从 AF-289 当前 HEAD `c453f05a` 切 stacked 分支，先保留 AF-289 的三个原始提交完成 `run-once` 验收与归档；进入 PR 阶段后因 CI 逐提交校验无法通过 AF-289 的历史空 scope，按 `squashLifecycle` 把整条分支收敛为单提交（详见 §6）。

## 2. 落地内容

- AF-291 任务单 `scope.files` 覆盖 AF-289 全部 11 个改动文件与两份 worklog 路径，`priorTasks: [AF-289, AF-290]`。
- 验收阶段的 stacked 历史：
  - `b05cb718` chore(AF-289): 登记与领单状态
  - `2ca2432f` feat(AF-289): 候选冷却当前状态 gauge 与真实故障指标取证
  - `c453f05a` docs(AF-289): 记录冷却延长修复与真实故障取证
  - `5cd5f316` chore(AF-291): 登记与领单状态
  - `5e673b93` docs(AF-291): stacked scope 修正与验收记录
  - `f3dc832d` chore(AF-291): 归档状态、durable 回执与记录包
- AF-289 交付记录补“验收返修事实”，不抹掉 rejected 事实。
- 不新增业务代码；本轮只修正任务 scope 与验收证据链。

## 3. 闸门

| 闸门 | 结果 | 证据 |
| --- | --- | --- |
| `pnpm orchestration:preflight` | 见提交钩子输出 | Husky 执行 |
| `pnpm typecheck` | exit 0 | `data/af289-typecheck4.log` |
| 定向 4 files / 14 tests | 全部通过，791ms | `data/af289-target3.log` |
| scoped ESLint | 0 error / 0 warning | `data/af289-eslint4.log`、`data/af289-eslint-fix2.log` |
| 真实 429 故障 smoke | exit 0；fallback 3/3、gauge 剩余 58.6s、cooldown_served=0 | `data/af289-fault-metrics2.log` |
| 全量 `pnpm lint` | exit 1；5 error / 4 warning 全在未跟踪 AF-280/AF-281 半成品，本单文件 0 | `data/af289-lint-full.log` |
| 全量 `pnpm test` | exit 1；276/277 files、4338 passed / 4 failed，失败全在未跟踪 AF-280 半成品 | `data/af289-test-full.log` |
| `git diff --stat HEAD -- src/engine-core` | 空 | — |

## 4. 偏差与遗留

- 偏差：AF-289 任务单 scope 缺失属登记期错误；AF-291 只做补偿性验收，不修改已归档任务的历史。
- 遗留：MiniMax 只读评审提出的 P0-1（轮次分母漏 exhausted/guard）、P0-3（`VisitorRenderAuthFailure` 空标签）仍待新任务；P0-2（冷却延长判定）已在 `2ca2432f` 修复并由生产默认参数测试覆盖。
- 遗留 backlog：`visitor-concurrency-above-8-unknown`、`visitor-smoke-history-limit-metadata`、`visitor-candidate-cooldown-alert-calibration`，以及旧有 `visitor-minimax-ttft-near-threshold`、`visitor-prompt-token-drift`、`visitor-first-delta-vs-ttft-semantics`、`visitor-aggregate-path-telemetry`。

## 5. 结论

AF-289 的实现与证据可用；AF-291 以 stacked 方式完成 `run-once` 验收，最终按 `squashLifecycle` 收敛为单提交进入合并闸门。AF-289 原 rejected 记录保留为审计事实。

## 6. PR 阶段 CI 口径返修（#131 → #132）

- PR #131 的 Orchestration Gate 失败原因不是提交内容，而是分支名 `task/AF-291-af289-merge` 的 slug 含 `af289`，被 `ci-task-gate.mjs` 的 `extractCommitTaskId` 同时解析成 `AF-291` 与 `AF-289`，触发 ambiguous。
- 处置一：本地分支改名为 `task/AF-291-scope-merge`，推送新分支，关闭 #131，由 `pr-release` 创建 PR #132。历史未动，`f3dc832d` 不变。
- 处置二：#132 的首轮 Gate 又因逐提交校验失败。原因是 AF-289 的历史任务快照 `scope.files=[]`，`run-once` 已将其归档为 rejected；CI 在 `613ca88b..HEAD` 范围内逐个提交重建快照时，`2ca2432f`/`c453f05a` 被判 `scope-residual`。这不是新的实现越界，而是“已 rejected 任务的堆叠提交无法作为独立任务通过逐提交 scope 门”。
- 最终处置：按 `squashLifecycle` 允许的单提交全生命周期形态，从基线 `613ca88b` 将整条分支收敛为一个 AF-291 提交 `0ec98095`，树内容与 `f3dc832d` 完全一致（`git diff --name-only 0ec98095 f3dc832d` 为空），提交标题仅含 `AF-291`。本地 Gate 复跑：`total=1 passed=1 failed=0 ok=true`，`reason=archived-transition files=23`，`ACCEPTANCE pass=true receipts=1`。
- 该处置改变的是提交粒度，不改变任何代码、测试、记录包、回执与任务状态；AF-289 的 rejected 审计事实仍保留在记录包与索引中。

