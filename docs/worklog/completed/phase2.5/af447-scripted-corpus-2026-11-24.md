# AF-447 归档补齐件 · 零语料算子剧本补语料（重签发）

本任务**未实施即被重签发**，此文件只用于补齐记录包声明的交付记录路径，不含实现内容。

## 事实

- AF-447 任务单在 `docs/worklog/pending/` 落单时 `baselineRef` 留空（写法上按模板当成"可空"，但 `task promote` 的校验口径是「基线不明确 → 拒绝提级」）。
- 任务单登记后内容不可原地修改（改 `baselineRef` 会让登记时的内容哈希与事件链不一致），因此没有走手改，而是按编排纪律重签。
- 执行 `node scripts/orchestration/cli.mjs task reissue --from AF-447 --sheet docs/worklog/inbox/af448-scripted-corpus-task-2026-11-24.md --apply --archive-old`：AF-447 → `canceled` 并归档，新任务 AF-448（`baselineRef: df537e60cbc150fedfd84bfc3554c496f923419b`，`priorTasks: [AF-447, AF-427]`）承接同一 scope 与目标。
- 实际实现与证据见 `docs/worklog/completed/phase2.5/af448-scripted-corpus-2026-11-24.md`。

## 教训（已登记为遗留）

落任务单时必须取**登记当时的 HEAD 全量 SHA** 写进 `baselineRef`；模板写"可空"只代表 schema 允许缺省，CLI 的 promote 校验不接受缺省值。
