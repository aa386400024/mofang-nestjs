# AF-262 · 取消说明（2026-11-22）

## 结论

取消，未开始实现。原因：任务单把 `docs/runbooks/` 与 `.env` 放进 executor 文件域，`run-once` 的 `validateScopeDomain` 判定越出 Agent Card 资源域（`scope-domain-conflict`），任务停在 `ready` 未领单。

同一意图已由 **AF-263** 重新登记：文件域收敛到 `bin/` 与 `docs/worklog/completed/phase2.5/`、`docs/worklog/records/...`；切流预案改写到 `docs/worklog/completed/phase2.5/doubao-visitor-cutover-runbook-2026-11-22.md`；`.env` 作为运行态变更记录在交付记录里，不进 git scope。

## 影响

- 无代码、无环境变更、无提交。
- AF-263 承接全部目标与验收。

## 后续

按 AF-263 执行。
