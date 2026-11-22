# AF-236 · 修复 squash 归档门被无关在办任务阻断

- 任务：`AF-236`（`phase2.5-orchestration-closed-loop`）
- 分支：`task/AF-236-squash-gate-active-task-fix`（自 `b10bc368` 叠层）
- 日期：2026-11-22

## 结论

`integrate` HEAD `b10bc368` 的 Orchestration Gate 失败根因已定位并修复。`task-entry-gate.mjs` 的 `archivedTransition` 原来要求 `currentEligible.length === 0`（索引里没有任何在办任务）才允许借用归档投影；AF-234 合并后 AF-229、AF-231 仍处于 `ready`，导致 AF-234 的 squash 提交虽然显式写了任务号、durable 回执也是 passed，仍被判 `task-not-found`。

修复后：提交标题显式声明任务号时，按该任务从 HEAD 索引借出 completed 归档投影，不受其他无关在办任务影响；未显式声明任务号时保留原保守行为。用修复后的门禁在本地重判 `b10bc368`，输出 `PASS task=AF-234 reason=archived-transition files=29`，exit 0。

## 改动

| 文件 | 改动 |
| --- | --- |
| `scripts/orchestration/task-entry-gate.mjs` | `archivedTransition` 增加显式任务号分支：`explicitTaskId` 存在时只借与该 ID 匹配的 completed 归档任务；无显式任务号仍要求无在办任务 |
| `scripts/orchestration/__tests__/orchestration.spec.mjs` | 在 `AF-058 squash 全生命周期归档门` 下新增「显式任务号的归档 squash 不被无关在办任务阻断」回归用例 |

保守边界未变：仍要求同次提交携带 `task-state-index.json`、HEAD 任务可写且任务单存在、当前索引里该任务为 `completed`、且存在 passed 回执； cancel/rejected 与无状态索引都不能恢复写权限。

## 闸门

- `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs`：259/259 通过。
- 本地重判历史 squash：`node scripts/orchestration/ci-task-gate.mjs --base a99032327c7adc70011d7e2bd18e5932172a2b50 --head b10bc368cf53545144783dd1f10376e1af64e23b`：exit 0，`PASS task=AF-234 reason=archived-transition files=29`。
- `pnpm lint`：exit 0，0 error / 0 warning。
- `pnpm typecheck`（`tsc -b tsconfig.check.json`）：exit 0。
- CI 同款全量 `tsc --noEmit -p tsconfig.json`：exit 0。
- `pnpm test`：252 文件通过 + 1 skipped；4212 tests 通过 + 4 skipped；24.47s。
- `git diff --stat HEAD -- src/engine-core`：空。

## 偏差

- AF-235 以 `agentRole: executor` 登记后，因 executor 资源域不含 `scripts/` 被判 `scope-domain-conflict`，已取消；AF-236 改 `agentRole: orchestrator` 重新登记并领单。
- 首次复制任务单时源文件已随 AF-235 登记移入 records，生成空文件导致 `task register` 报 frontmatter 缺失；改为从 records 任务单重建后登记成功。

## 复现

```powershell
pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
node scripts/orchestration/ci-task-gate.mjs --base a99032327c7adc70011d7e2bd18e5932172a2b50 --head b10bc368cf53545144783dd1f10376e1af64e23b
pnpm lint
pnpm typecheck
pnpm exec tsc --noEmit -p tsconfig.json --incremental --tsBuildInfoFile node_modules/.tmp/tcheck-full.tsbuildinfo
pnpm test
git diff --stat HEAD -- src/engine-core
```
