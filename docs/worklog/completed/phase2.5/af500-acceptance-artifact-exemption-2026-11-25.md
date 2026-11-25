# AF-500 交付记录 · 验收残留比对工件豁免

日期：2026-11-25
任务：AF-500（priorTasks: AF-499, AF-498）
分支：`task/AF-500-acceptance-artifact-exemption`

## 根因

`acceptance-runner.mjs` 的 commit 事实残留比对只排除了状态面与任务单，没有排除任务在 `artifacts.deliveryRecord` 中声明的交付记录。交付记录天然不在代码 scope 内，却被算进交付面，导致任务被自己的交付记录判成 `scope 外提交文件` 并打为 rejected。AF-499 的唯一 fail 就是这条。

## 修复

新增 `isDeclaredTaskArtifact(task, file)`：精确匹配本任务的 `artifacts.taskSheet` / `artifacts.deliveryRecord`（路径归一化），在 commit 事实比对与工作树比对两条路径都排除；其他 docs 路径仍进入 scope 校验，不放宽任意文档。

## gateResults

- `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs`：278 passed。
- AF-500 回归覆盖：已声明交付记录 + 代码文件同 commit → V7 pass / passed；未声明 `docs/worklog/other.md` → V7 fail / rejected。

## scopeCheck

改动仅 `scripts/orchestration/acceptance-runner.mjs` 与 `scripts/orchestration/__tests__/orchestration.spec.mjs`，均在本任务 scope；任务单与交付记录为声明产物。

## contractChecks

- 任务登记：AF-500 经 CLI register / promote / run-once。
- 状态面：由 CLI 写，实现提交不含状态面。
- engine-core：`git diff --stat HEAD -- src/engine-core` 为空。
- 隐私：无心理内容、无对话原文。

## backlogItems

无。

## deviationTable

| 项         | 任务单口径                      | 实际                                     | 处理                                                        |
| ---------- | ------------------------------- | ---------------------------------------- | ----------------------------------------------------------- |
| 返修任务链 | AF-500 scope 只含验收逻辑与测试 | 分支基于 AF-499，携带 AF-498/AF-499 提交 | priorTasks 声明链，PR 按链合并；AF-499 PR 关闭为 superseded |

## reviewVerdict

passed。根因由 AF-499 实弹验收失败定位；修复把“任务自身产物”和“代码交付面”分开，未放宽其他 docs；编排测试 278 例全绿，engine-core 未动。
