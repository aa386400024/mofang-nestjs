# AF-386 工作区未跟踪产物分类收口 — 交付记录

- 任务：AF-386（R1 / light / orchestrator）
- 基线：`5ae1cfd4805e6f168b490881727cc60ea5ad43fb`（integrate）
- 日期：2026-11-23
- 分支：`task/AF-386-workspace-artifact-cleanup`

## 结论

工作区 26 个未跟踪条目按四类收口完成，Source Control 只保留本任务应入库的文档与 `.gitignore` 变更；没有提交任何源码、实验原始数据或临时产物。

## 改动清单

1. `.gitignore` 新增 `.tmp/`、`data/handoff/`、`data/phase25-exit/` 三条阻断，均带注释说明用途与保留策略。
2. `docs/worklog/pending/archive/relay-response-AF357-review-20261123-1200.md`、`AF358-...-1300.md`、`AF359-...-1315.md` 作为 AF-357/358/359 复审证据入库；仓库已有 27 份同类 tracked 文档，命名与落点保持一致。
3. `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-371/` 移出 records，落到本机 `.tmp/af386-removed-AF-371/` 保留副本。AF-371 从未登记、事件日志为 0 条，其 coverage 矩阵 check 名称修复已由 AF-372 完成并交付，故不进入版本库。

## 关键决策

- `data/phase25-exit/` 采用整体 ignore，而不是只 ignore `reps/` 和 `joblogs.zip`：该目录是 3.2 MB 的本机实验证据，交付记录引用路径即可；避免把原始重复样本塞进主分支，也避免出现“部分 tracked、部分 ignored”的混合状态。
- `.tmp/` 不删除，只 ignore：`.tmp/af373-backup` 是 AF-373 任务单与回执的本地副本，直接删除会丢失证据；保留本地并从 Git 视图排除更安全。
- AF-371 不直接 `Remove-Item`，先移到 `.tmp` 保留：即使确认被 AF-372 取代，也保留可追溯副本，不做不可逆删除。
- 未修改 `src/`、`test/`、`bin/`、`admin-dashboard/` 与 `src/engine-core/`，因此不跑全量测试；本任务 gates 仅覆盖 ignore 规则、工作区视图与编排前置门。

## 闸门与证据

| 闸门             | 命令                                      | 结果                                                                                                           |
| ---------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 空白检查         | `git diff --check`                        | exit 0，无输出                                                                                                 |
| ignore 命中      | `git check-ignore -v` 三条                | 3/3 命中：`.gitignore:142` `.tmp/`、`:143` `data/handoff/`、`:144` `data/phase25-exit/`                        |
| 工作区视图       | `git status --porcelain=v1 -uall`         | 仅 `.gitignore`、3 份 relay 文档、AF-386 记录包与编排状态面；无 `.tmp/`、`data/handoff/`、`data/phase25-exit/` |
| 编排前置门       | `pnpm orchestration:preflight`            | PASS，files=4 covered=4（状态面提交阶段）                                                                      |
| engine-core 红线 | `git diff --stat HEAD -- src/engine-core` | 空                                                                                                             |

## 偏差

- 任务单 `scope.files` 未预列 `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-386/`，因为登记动作会把任务单与 manifest 写入该目录；实际提交按编排登记目录处理，不影响实现范围。
- 未运行 `pnpm test`：变更集合不含 `.ts/.js`，全量测试无新增覆盖意义；如后续需要，可按 `pnpm test` 复跑。
