# AF-324 · 任务取消记录

- 日期：2026-11-23
- 状态：`canceled`
- 原因：`scope-domain-conflict`。本单原按 `agentRole: orchestrator` 登记，但 scope 包含 `src/engine-adapters/` 与 `test/engine-adapters/`，越出 orchestrator Agent Card 资源域；`run-once` 在派发前拦截。
- 处理：按框架状态机 `task cancel` 闭合，`archive --status canceled` 归档；未修改任务单正文，未修改 Agent Card 资源域，未绕过 scope 校验。
- 承接：标题与范围相同，改由 `agentRole: executor` 的 AF-325 承接；AF-325 因依赖已取消任务无法 promote，再经 `task rescope` 重签发为 AF-326，`priorTasks: [AF-324, AF-325]` 保留审计链。
- 交付：AF-326 的代码、测试、报告与回执见 `docs/worklog/completed/phase2.5/af326-classifier-prompt-v2-2026-11-23.md`。
