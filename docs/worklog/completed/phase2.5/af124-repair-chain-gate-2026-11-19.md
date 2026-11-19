# AF-124 返修链 PR、归档回执状态面与 squash 标题规范化

- 日期：2026-11-19
- 分支：`task/AF-124-repair-chain-gate`
- 基线：`integrate` `799d73fb5fd22e2c2ec78db4a0a9493740cafd5d`
- 提交：`5a3fd30`（任务登记与领取）、`a05bd98`（实现与定向单测）
- 框架契约：`agent-collaboration-framework` `9b20828`（`docs/autonomous-loop.md` §4.1）

## 一、修复项

| # | 缺口 | 修复 | 证据 |
| --- | --- | --- | --- |
| 1 | `pr-release create` 只允许主任务号，已归档任务的返修链无法出 PR | `findForeignCommitTaskIds(subjects, taskId, allowedTaskIds)` 允许任务单 `priorTasks` 链内任务号；`assertSingleTaskBranch` 读取任务链并传入；链外任务号仍拒绝 | `orchestration.spec.mjs`「priorTasks 返修链内任务提交放行，链外仍拒绝」；`pr-release create --taskId AF-124` dry-run 通过 |
| 2 | 归档后补写 durable receipt 的提交被 `task-entry-gate` 判 `no-active-task` | `STATE_PLANE_PATHS` 增加 `docs/worklog/pending/archive/`，durable receipt 按编排状态面放行 | `orchestration.spec.mjs`「归档 durable receipt 更新按编排状态面放行」 |
| 3 | squash 标题剥离任务号后残留 `/ / /` | `stripTaskIdsFromSubject` 折叠连续 `/`、`、`、`,` 分隔符，清理首尾分隔符 | `orchestration.spec.mjs`「squash 标题剥离多任务号后不残留斜杠分隔符」 |
| 4 | 单测把 `AF-104/AF-107` 任务单复制进真实 `docs/worklog/pending/archive/`，每次跑测试污染工作区 | 两条回执终态用例改用 `receiptArchiveDir` 临时目录，任务单指针移出 transport 前缀 | 连续跑测试后 `git status` 不再出现这两份生成物 |

`ci-task-gate.mjs` 未改：逐提交门禁与 squash scope 并集已有能力；本次只修发布入口与状态面清单。

## 二、闸门

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 0 | 1 file / 257 tests passed |
| `pnpm lint` | 0 | 0 error / 0 warning |
| `pnpm exec tsc --noEmit -p tsconfig.json --incremental --tsBuildInfoFile node_modules/.tmp/tcheck-full.tsbuildinfo` | 0 | 0 error（CI 同口径） |
| `pr-release.mjs create --taskId AF-124`（dry-run） | 0 | 未报 foreign task；标题 `fix(orchestration): AF-124 ...` |

首轮 lint 曾因正则 `\/` 报 3 个 `no-useless-escape`，已改为字符类内裸 `/`；复跑归零。测试首轮发现归档生成物副作用，修正测试隔离后复跑 257/257。

## 三、范围与契约

- `scopeCheck`：`in-scope`。改动仅 `scripts/orchestration/pr-release.mjs`、`task-entry-gate.mjs`、`branch-workflow.mjs`、`scripts/orchestration/__tests__/orchestration.spec.mjs` 与 `docs/worklog/`。
- 未触碰 `src/engine-core`，`engine-core` 零 diff。
- 单提交仍只允许一个任务号；多任务号继续 fail closed，未放宽。
- `priorTasks` 只放行任务单显式声明的链，不使用 `contextId` 通配。
- 框架仓规则已落 `docs/autonomous-loop.md` §4.1，提交 `9b20828`。

## 四、遗留

- PR #45 已合并的历史 squash 标题仍含 `/ / /`，属不可改写历史；本修复只影响后续合并。
- 出口④临床达标仍缺真人督导师双盲 + 仲裁；本次不改变 `ai_proxy_candidate / clinicalAcceptanceEligible=false` 口径。

## 五、结论

`passed`。三项门禁缺口与测试污染均已修复并有真实闸门证据；可进入回执摄入、归档与受保护 PR 发布。
