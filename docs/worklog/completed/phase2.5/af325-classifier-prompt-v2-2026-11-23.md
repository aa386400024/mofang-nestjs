# AF-325 · 任务取消记录

- 日期：2026-11-23
- 状态：`canceled`（记录包 manifest 仍显示 `backlog`，属字段语义遗留，未手改）
- 原因：本单为 `agentRole: executor` 的替换任务，依赖声明为 `[AF-323, AF-324]`；AF-324 已被取消，`task promote` 拒绝在依赖不满足时提级。
- 处理：不做依赖特批、不手改索引；按框架受审计的 `task rescope --from AF-325 --sheet ... --apply --archive-old` 重签发为 AF-326，`priorTasks` 显式包含 AF-325。
- 交付：AF-326 的代码、测试、报告与回执见 `docs/worklog/completed/phase2.5/af326-classifier-prompt-v2-2026-11-23.md`。
