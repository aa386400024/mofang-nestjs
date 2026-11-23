# AF-425 取消说明：scope 越过 orchestrator 资源域

- 日期：2026-11-24
- 任务：AF-425（documentation / orchestrator）
- 状态：`canceled`（未认领、无实现提交；分支 `task/AF-425-presence-calibration-ledger` 废弃）
- 原因：任务单 scope 写了 `src/engine-adapters/deliberation/`（修过期注释），但 orchestrator Agent Card 的 `resources` 资源域不含 `src/`，`run-once` 判 `scope-domain-conflict` 拒绝派发。
- 处置：文档部分重登 AF-426（scope 只留 `docs/architecture/`、`docs/worklog/completed/phase2.5/`、记录包）；`deliberation-types.ts` 的过期注释改成 backlog 项，留给 executor 角色的后续任务处理。
- 教训：orchestrator 只能写 `docs/`、`scripts/`、`data/`、`web/orchestration/` 与根配置；任何 `src/` 改动都必须派给 executor。
