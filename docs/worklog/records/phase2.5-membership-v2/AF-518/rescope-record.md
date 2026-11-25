# AF-518 · 会员栈迁移号冲突消解（已取消 / 重签发）

> 日期：2026-11-26
> 状态：canceled → 重签发为 AF-519
> 关联：`docs/worklog/completed/phase2.5/af519-membership-migration-pr-closure-implementation-2026-11-26.md`

## 结论

AF-518 任务单把 `docs/specs/active/` 与 `docs/team/agent-orchestration/` 写进 executor scope。调度器按 executor Agent Card 资源域校验时判定越域（`scope-domain-conflict`），任务停在 `ready`，未进入实现。

按 `task rescope --from AF-518 --sheet <AF-519>` 的受审计流程重签发为 AF-519：

- AF-518 闭合为 `canceled`，任务单保留在 `docs/worklog/records/phase2.5-membership-v2/AF-518/`；
- AF-519 以 `priorTasks: [AF-518]` 承接同一目标、同一基线 `7fb875ce`；
- 实际会员栈实现、迁移重排、测试修复与 PR 收口见 AF-519 交付记录。

本文件仅用于闭合 AF-518 记录包的 deliveryRecord 指针，不代表 AF-518 产生过代码提交。
