# AF-533 取消说明（重签发为 AF-534）

AF-533 登记后在 `run-once` 领单阶段触发 `scope-domain-conflict`：任务 scope 含 `docs/specs/`，而 executor agent card 的资源域未覆盖该目录。按编排规则不在冲突状态下强行领取，改用 `task reissue` 重签发为 AF-534，AF-533 置 `canceled` 并归档。

- 原任务：AF-533「Phase2.5 收尾：调试落盘等待、会员退款边界与后台活动页」
- 后继任务：AF-534（`priorTasks: [AF-533]`）
- 本任务未产出代码、测试或文档交付；实际交付见 `docs/worklog/completed/phase2.5/af534-phase25-final-tails-2026-11-26.md`
- 任务分支 `task/AF-533-phase25-final-tails` 未合并，可删除
