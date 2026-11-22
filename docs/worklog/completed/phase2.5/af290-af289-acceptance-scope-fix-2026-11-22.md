# AF-290 · AF-289 验收 scope 修正（已取消，2026-11-22）

## 结论

AF-290 未执行，已由 CLI 取消。

## 原因

AF-289 因任务单 frontmatter 缺少 `scope.files`，回执按 commit 事实比对时 11 个实现文件全部越界，任务归档为 `rejected` 并生成 `RW-AF-289-1`。第一次返修用 AF-290 登记，但 `agentRole` 写成了 `orchestrator`。

`run-once` 领取时触发 `scope-domain-conflict`：orchestrator 的 Agent Card 资源域只含 `docs/`、`scripts/`、`web/orchestration/` 等编排资产，不含 `src/`、`test/`、`bin/`，不能写业务实现。AF-290 因此未领取、未产生代码改动。

## 处置

- 取消 AF-290，原因：角色域冲突，orchestrator 不可写源码。
- 改开 AF-291（agentRole=executor），从 `c453f05a` 切 stacked 分支，保留 AF-289 三个原始提交，补 scope 与验收记录。
- AF-289 的 rejected 审计事实保留，不抹除。

本记录只用于闭合 AF-290 的计划交付物，避免 `worklog verify --strict` 因缺文件失败。
