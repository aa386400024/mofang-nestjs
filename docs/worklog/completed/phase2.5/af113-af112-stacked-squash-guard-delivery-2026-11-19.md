# AF-113 交付记录 · 多任务堆叠 PR 的 squash scope 折叠守卫

- 任务：AF-113（`priorTasks: [AF-112]`）
- 分支：`task/AF-113-af112-stacked-squash-guard`
- 类型：fix（编排工具链）
- 日期：2026-11-19

## 一、问题与根因

AF-112 的 PR #42 分支上同时存在 AF-111 的实现提交与 AF-112 的元数据修正提交。PR 阶段逐提交门禁按各自任务判定，13 项 required checks 全绿；`pr-release merge` 按框架要求 squash 后，`integrate` 上只剩一个提交，服务端 Orchestration Gate 只能按提交标题主任务 AF-112 的 scope 判定，AF-111 的实现文件（`src/`、`bin/`、`test/`、协议）被判 `scope-residual`。

根因不是实现缺陷，而是发布流程缺少“一个 PR 只能承载一个任务”的前置守卫。`ci-task-gate` 的 scope 并集只对“各自已验收（completed + 可合并 durable 回执）”的任务生效；AF-111 因元数据缺口被归档为 rejected，不能进入并集，因此一旦与 AF-112 堆叠 squash 必然折叠失败。

## 二、修复内容

- `scripts/orchestration/pr-release.mjs`：新增 `findForeignCommitTaskIds` 与 `assertSingleTaskBranch`；`create` 在推送前扫描 `base..branch` 的提交标题，发现目标任务编号以外的任务号即拒绝，提示先单独合并前置任务并从最新 base 重建分支。
- 纯状态面提交（标题无任务号）放行；目标任务重复出现放行；同一标题含多个任务号 fail closed。
- `docs/team/agent-orchestration/README.md` §5.3.1 增加“单任务 PR”强制口径。
- 新增 3 例单测：单任务/状态面放行、混入其他任务拒绝、标题多任务号 fail closed。

## 三、闸门证据（实跑）

| 闸门 | 命令 | 退出码 | 结果数字 |
| --- | --- | --- | --- |
| 编排单测 | `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 0 | 1 file / 254 tests passed |
| 全量 lint | `pnpm lint` | 0 | 0 error / 0 warning |
| 任务单 schema | `node scripts/orchestration/cli.mjs validate --sheet docs/worklog/pending/af113-af112-stacked-squash-guard-task-2026-11-19.md` | 0 | 运行态任务单 + 索引投影 + 事件日志均 PASS |
| 事件链 | `node scripts/orchestration/cli.mjs events verify` | 0 | 490 条；哈希链与索引投影一致 |
| 空白/CR | `git diff --check` | 0 | 无空白错误、无 CR |
| 守卫 dry-run | `node scripts/orchestration/pr-release.mjs create --taskId AF-113` | 0 | 当前分支未检出外部任务号，输出 mode=dry-run |

## 四、范围与边界

- 只改 `scripts/orchestration/pr-release.mjs`、对应单测、编排 README、本任务单与交付记录。
- 不改变 `ci-task-gate` 既有逐提交判定语义、不调整 13 项必需检查、不修改分支保护。
- 不伪造历史提交 `c8ad077` 的状态，不改写 `integrate` 历史；该提交的 post-merge 红是 AF-111/AF-112 堆叠 PR 的历史结果，由本守卫防止再次发生。

## 五、遗留与结论

- 出口④临床质量结论不变：候选口径，未接硬门，仍不可判定。
- 真实督导师双人盲标与仲裁仍未发生（既有遗留，不在本单处理）。
- 阻塞项：无。
- 本单结论：修复完成，待回执摄入与受保护 PR 合并。

## 六、机读字段标记

- `backlogItems`
  - `OI-AF113-01`：真实督导师双人盲标与仲裁仍未发生（owner: clinical-supervisor，不阻塞本单）。
  - `OI-AF113-02`：`c8ad077` 的 post-merge Orchestration Gate 仍为历史红；不回写历史，只以 AF-113 守卫防止复发（owner: orchestrator）。
- `reviewVerdict`：`passed`
  - 理由：守卫与单测实跑绿，lint/schema/事件链/空白检查均 exit 0；改动严格限于编排发布工具链与文档，不触碰业务实现与临床结论。
- `scopeCheck`：`in-scope`
- `deviationTable`：无偏差。
