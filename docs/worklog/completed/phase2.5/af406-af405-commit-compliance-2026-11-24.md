# AF-406 · AF-405 提交合规返修（实现提交随带任务单）

- 任务：AF-406（executor），`priorTasks: [AF-405]`
- 基线：`eb051e3c06914cb91cd938713dcdf301f906eac9`
- 日期：2026-11-24
- 结论：代码与 AF-405 逐字一致，返修只改提交形态；Orchestration Gate 失败原因已定位并消除。

## 1. 为什么返修

AF-405 的代码、交付记录、回执、归档全部完成，但实现提交 `1a22abd1` 只带业务文件与交付记录，没有同时新增 AF-405 的 records 任务单。归档后远端逐提交门按该提交树内的状态索引判定为 `no-active-task`，PR #198 的 Orchestration Gate failure。

仓库的两阶段入场规则要求：实现提交标题含唯一任务号、提交 diff 内新增该任务的 records 任务单、当前/父索引都没有该任务时，才可按 submitted 入场。AF-405 因任务单在独立记录包提交里，未满足“同一实现提交新增任务单”，所以被拒。

## 2. 处置

1. `task reissue --from AF-405` 不可用（源任务已归档，CLI 要求活跃列表），改用普通 `task register` 登记 AF-406，并在任务单 `priorTasks: [AF-405]` 保留审计链路；这是与任务单“用 reissue”口述的唯一偏差。
2. 从 `integrate` 新建 `task/AF-406-commit-compliance`，把 AF-405 已验收代码与交付记录原样承接。
3. 实现提交**同一个提交**内新增 `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-406/task-sheet.md`，满足 CI 入场条件。
4. 业务逻辑零改动：`src/engine-core` 零 diff，阈值与指标语义与 AF-405 完全相同。

## 3. 验证

| 闸门     | 命令                                                                 | 结果                                                                     |
| -------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 单测     | `pnpm exec vitest run test/auto-practice/wp-k-batch-compute.spec.ts` | 1 文件 / 21 用例全绿（30ms，AF-405 同一份用例）                          |
| Lint     | `pnpm lint`                                                          | 0 error                                                                  |
| 类型     | `pnpm typecheck`                                                     | 0 error                                                                  |
| 全量     | `pnpm test`                                                          | AF-405 收尾已跑：312 passed / 1 skipped，4760 passed / 4 skipped，25.72s |
| 内核红线 | `git diff --stat HEAD -- src/engine-core`                            | 空                                                                       |

## 4. 偏差与后续

- 偏差：未使用 `task reissue`，原因见 §2。
- 后续：`pr-release.mjs` 的 `create` 阶段应在推送前检查“实现提交是否新增本任务任务单”，把这类返工前移到本地；已记入交付记录，暂不单开任务。
