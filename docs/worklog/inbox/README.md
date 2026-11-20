# inbox/ 任务单草稿箱

这里只放**尚未登记**的任务单 Markdown。

登记成功后 `task register` 会把文件搬到
`docs/worklog/records/<contextId>/<taskId>/task-sheet.md`，inbox 不再保留副本：

```powershell
pnpm orchestration:task register --sheet docs/worklog/inbox/af<编号>-<slug>-task-<日期>.md --status ready
```

规则：

- 文件名建议 `af<编号>-<slug>-task-<YYYY-MM-DD>.md`，便于扫描；
- 已是终态（completed / canceled / failed / rejected）的任务单留在 inbox 会被
  `worklog verify` 判失败；
- 不要把参考文档、回执或交付记录放进来。
