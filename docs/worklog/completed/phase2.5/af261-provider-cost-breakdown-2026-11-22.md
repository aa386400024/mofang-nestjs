# AF-261 · 单场成本按 provider 分账（2026-11-22）

## 结论

通过。`session_cost_summary` 现在在 `render.providerHint` 可用时按 provider 维护 token 桶，并用 provider 覆盖价分别计价；`providerBreakdown` 给出每个 provider 的模型、token、费用、口径与定价来源，`estimatedCostCny` 等于各桶之和。旧调用不报 provider 时保持原有单一价口径，零回归。

## scopeCheck

- `src/engine-adapters/observability/session-cost.ts`：provider 桶、定价表、分账折算与 summary 字段；在 scope 内。
- `src/engine-adapters/wiring/engine-stream-backend.adapter.ts`：`providerHint` 入桶、定价表注入；在 scope 内。
- `src/engine-adapters/wiring/engine.providers.ts`：deps 增加 `pricingTable`；在 scope 内。
- `src/engine-adapters/wiring/engine.module.ts`：env → 定价表装配；在 scope 内。
- `test/engine-adapters/af261-provider-cost.spec.ts`：6 例；在 scope 内。
- `.env.example`：新增 4 个 provider 覆盖价键（留空回落全局价）；在 scope 内。
- `docs/worklog/completed/phase2.5/af261-provider-cost-breakdown-2026-11-22.md`、`records/.../AF-261/`：本交付记录与记录包；在 scope 内。
- 未暂存 `web/orchestration/data.js` 的并行本地改动；`data/af261-*.log` 仅为本机取证日志，不提交。

## contractChecks

- 分支 `task/AF-261-provider-cost-breakdown` 自 `integrate 785a60f4` 切出；状态 `submitted`。
- `SessionUsageTotals.byProvider` 为可选字段，空起点形状不变；既有 `wp24-session-cost-log.spec.ts` 18 例全绿。
- provider 覆盖价未配置时回落 `fallback`（旧两个全局键）；`pricingSource` 如实标 `fallback`，不编造厂商单价。
- 某个 provider 缺输入侧时只计输出侧，整场 `costBasis=output_only`，不把缺失输入当 0。
- 构造参数把 `costPricingTable` 放在末尾，避免移动既有位置参数导致工厂/测试错位。
- 未改 `src/engine-core`。

## gateResults

- 定向：`pnpm exec vitest run test/engine-adapters/af261-provider-cost.spec.ts test/engine-adapters/wp24-session-cost-log.spec.ts` → 2 files / 24 passed（AF-261 6 + WP24 18），exit 0。
- lint：`pnpm lint` → 0 error / 0 warning，exit 0。
- CI 同口径 typecheck：`pnpm exec tsc --noEmit -p tsconfig.json` → 0 error，exit 0。
- 全量：`pnpm test` → 261 passed + 1 skipped files / 4264 passed + 4 skipped tests，exit 0。
- engine-core：`git diff --stat HEAD -- src/engine-core` 为空。

分账口径证据：

| provider | 输入价 | 输出价 | 1000 输入 + 1000 输出 | 定价来源 |
| -------- | ------ | ------ | --------------------- | -------- |
| doubao | 0.002 | 0.006 | 0.008 元 | provider_override |
| minimax | 0.001 | 0.004 | 0.005 元 | provider_override |
| 合计 | — | — | 0.013 元 | — |

- 混合会话 `estimatedCostCny` = 0.013，等于两桶之和。
- 未配置覆盖价时 summary 标 `pricingSource=fallback`，费用按全局价。
- 后端闭环 `render.providerHint=doubao` 时 `providerBreakdown` 含 `doubao` 桶与 `doubao-seed-character-260628`。

## backlogItems

- `doubao-cost-price-source`：仓库没有核对过的豆包官方单价，`.env.example` 只给空键；上线前需用当期火山方舟账单填写 `LLM_PRICE_*_PER_1K_DOUBAO`，否则仍按 MiniMax 全局价估算。
- `cost-board-provider-dimension`：`session_cost_summary` 已带 `providerBreakdown`，但管理后台成本看板仍按整场汇总展示，未按 provider 拆分图表。
- `auto-practice-cost-provider`：自动对练落库路径仍只看单场总成本，未消费 `providerBreakdown`。

## deviationTable

- `taskSays`: 按 provider 分账需要 provider 单价。
  `reality`: 仓库没有核对过的豆包报价，不能凭空内置。
  `action`: 做成 `LLM_PRICE_*_PER_1K_DOUBAO` 覆盖键，留空回落全局价；明细标 `pricingSource`。
  `why`: 宁可显式标注"未配置覆盖价"，也不把未核对数字当真实账单。
- `taskSays`: 成本看板复用 `estimateSessionCost`。
  `reality`: 本任务只改会话汇总与函数签名，看板聚合仍按整场口径。
  `action`: 看板 provider 维度另列 backlog。
  `why`: 避免把观测层改动扩散到管理后台 UI，保持任务边界。

## reviewVerdict

`passed`。scope 与提交事实一致；六组机读字段齐全；定向 24 例、lint、CI 同口径 tsc、全量 4264 例全绿；两家 provider 不同单价分别计费且合计等于分桶之和；缺输入侧仍落 `output_only`；engine-core 零改动。

## 变更文件

- `src/engine-adapters/observability/session-cost.ts`（修改：provider 桶、定价表、分账折算）
- `src/engine-adapters/wiring/engine-stream-backend.adapter.ts`（修改：providerHint 入桶、定价表）
- `src/engine-adapters/wiring/engine.providers.ts`（修改：deps 增加 pricingTable）
- `src/engine-adapters/wiring/engine.module.ts`（修改：env → 定价表）
- `test/engine-adapters/af261-provider-cost.spec.ts`（新增）
- `.env.example`（修改：新增 provider 覆盖价键）
- `docs/worklog/completed/phase2.5/af261-provider-cost-breakdown-2026-11-22.md`（本任务）
- `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-261/`
- `docs/team/agent-orchestration/` 状态面

## commit message

`feat(af261): 单场成本按 provider 分账`
