# AF-367 CI 门禁与状态面解耦测试假设收口 — 交付记录

- 任务：AF-367（R1 / standard / orchestrator；prior AF-366）
- 分支：`task/AF-365-orchestration-v21`
- 提交：`34ebca2d` fix(orchestration): AF-367 状态面解耦下的单测与 CI 环境收口
- 日期：2026-11-23

## 变更

1. `scripts/orchestration/__tests__/orchestration.spec.mjs`
   - 引入 `STATE_FREE = ORCH_STATE_FREE === '1'`。
   - 任务分支索引测试改为校验 `schemaRef` 与自身 `version` 自洽；仅在非 state-free 时强制 `1.2.0`。
   - 契约对账在 state-free 下用当前契约版本构造最小实例，版本漂移断言始终执行。
   - 索引/journal 投影一致性测试在 state-free 下显式跳过，由 integrate 全量门与状态快照同步负责。
2. `.github/workflows/ci.yml`
   - 顶层 `ORCH_STATE_FREE`：PR = 1，push = 0。
   - 保留 AF-366 的编排门依赖安装、contracts 的 PR/integrate 分叉。

## 证据

- `pnpm lint`：exit 0，0 error。
- `pnpm typecheck`：exit 0，0 error。
- `pnpm test`：312 files（311 passed + 1 skipped）；4745 tests（4741 passed + 4 skipped）。
- `ORCH_STATE_FREE=1` 下 `orchestration.spec.mjs`：262/262 通过；非 state-free 亦 262/262 通过。
- PR #178 / `34ebca2d`：14 项 required checks 全部 pass（`pr-release status` verdict=pass，missing=[], failing=[], pending=[]）。
- 覆盖：Risk Gate、Orchestration Gate、Contracts (framework 2.1.0)、Lint + Typecheck、Unit 1/3–3/3、Coverage 1/3–3/3、Coverage Gate、E2E、Build (Docker)、Security Audit。

## 偏差与遗留

- AF-366 因登记时未把 `docs/worklog` 纳入 scope，交付记录无法过提交门；已按 CLI 取消并以 AF-367 承接（priorTasks=AF-366）。AF-366 的 CI 修复代码保留在分支，不再单独归档交付。
- 状态面四文件仍由收尾状态快照单独同步，不进入任务分支；本任务不伪造运行态索引。
- `src/engine-core` 零改动。
