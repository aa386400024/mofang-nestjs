# AF-254 · 引擎渲染路径豆包端到端 smoke（取消说明，2026-11-22）

## 结论

AF-254 未进入实现，已取消并归档。本文件只补齐任务单 `artifacts` 声明的交付记录路径，避免 `worklog verify --strict` 因文件缺失失败；它不代表任何代码交付。

## 取消原因

AF-254 登记时 `dependsOn: [AF-252, AF-253]`，而 AF-252 已因 scope 误判被 `rejected` 归档，CLI 的依赖校验不满足，任务无法进入可执行状态。随后把依赖改为已合入的 AF-253，重新登记为 AF-255；AF-254 保留为 `backlog` 后经 `task cancel` 与 `run-once` 归档，归档序号 258。

## 实际交付

无。AF-254 没有实现提交、没有测试、没有改任何业务文件。原任务目标（真实豆包渲染 smoke）由 AF-255 承接并完成：

- `docs/worklog/completed/phase2.5/af255-render-doubao-smoke-2026-11-22.md`
- `src/engine-adapters/wiring/llm-service-chat-caller.ts`
- `test/engine-adapters/af255-llm-service-chat-caller.spec.ts`
- `bin/visitor-render-smoke.ts`

## 边界

- 未改 `src/engine-core`。
- 未改生产 `.env`。
- 本说明仅补齐归档记录，不改变 AF-254 的 `canceled` 终态。
