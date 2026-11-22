# AF-263 · 豆包来访者本地切流与回滚预案（2026-11-22）

## 结论

通过。本地 `.env` 已从「未配置来访者开关」切到 `VISITOR_LLM_PROVIDER=doubao` + `VISITOR_DOUBAO_MODEL=doubao-seed-character-260628`；真实 `.env` 自检显示旧 VisitorService 与引擎渲染主候选都是 `doubao`，引擎备候选 `minimax`。20 轮真实生产路由 smoke 全轮命中豆包，无空输出、无降级、无回退。**未重启服务**，重启后生效。

## scopeCheck

- `bin/visitor-switch-check.ts`：只读 `.env` 的开关自检；在 scope 内。
- `docs/worklog/completed/phase2.5/doubao-visitor-cutover-runbook-2026-11-22.md`：切流预案；在 scope 内。
- `docs/worklog/completed/phase2.5/af263-visitor-cutover-local-2026-11-22.md`：本交付记录；在 scope 内。
- `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-263/`：任务单、manifest、回执；在 scope 内。
- `.env`：运行态变更，gitignored，不进提交；已备份到 `data/env-backup-af263-20261122.env`。
- 未暂存 `web/orchestration/data.js` 的并行本地改动；`data/af263-*.log` 仅为本机取证日志，不提交。

## contractChecks

- 分支 `task/AF-263-visitor-cutover-local` 自 `integrate 377c7ffc` 切出；状态 `submitted`。
- `.env` 只加两行：`VISITOR_LLM_PROVIDER=doubao`、`VISITOR_DOUBAO_MODEL=doubao-seed-character-260628`；未改 `ENGINE_RENDER_PRIMARY_PROVIDER=minimax`，由 AF-252 的 visitor 总开关覆盖。
- 切流前自检如实失败（`llmProvider=minimax`、`primary=minimax`、单候选），切流后自检通过（`primary=doubao`、备候选 `minimax`）。
- 未重启本地/远端服务；未改远端部署环境。
- 未改 `src/engine-core`。

## gateResults

- 切流前自检：`pnpm exec tsx bin/visitor-switch-check.ts` → exit 2，`visitorRuntime.llmProvider=minimax`、`engineRender.primary=minimax`、候选仅 MiniMax；日志 `data/af263-switch-before.log`。
- 切流后自检：`pnpm exec tsx bin/visitor-switch-check.ts` → exit 0，`visitorRuntime.llmProvider=doubao`、`doubaoModel=doubao-seed-character-260628`、`engineRender.primary=doubao`、`fallbackProviders=["minimax"]`；日志 `data/af263-switch-after.log`。
- 20 轮真实 smoke：`pnpm exec tsx bin/visitor-render-smoke.ts --caller router --provider doubao --turns 20 --max-tokens 160 --timeout-ms 45000` → exit 0，20/20 `providerHint=doubao`、`model=doubao-seed-character-260628`、`finishReason=stop`、`guardLevel=pass`；`fallbackUsed=false`、`degraded=false`；`totalUsage` prompt 20980 / completion 279；promptTokens 745 → 1356；日志 `data/af263-smoke20.log`。
- lint：`pnpm lint` → 0 error / 0 warning，exit 0。
- CI 同口径 typecheck：`pnpm exec tsc --noEmit -p tsconfig.json` → 0 error，exit 0。
- 全量：`pnpm test` → 261 passed + 1 skipped files / 4264 passed + 4 skipped tests，exit 0。
- engine-core：`git diff --stat HEAD -- src/engine-core` 为空。

20 轮关键片段：

| 轮 | promptTokens | chars | 来访回复 |
| -- | ------------ | ----- | ----- |
| 1 | 745 | 15 | 不太好，躺下要翻好久才能睡着。 |
| 3 | 810 | 16 | 就上周部门调整的事，翻来覆去想。 |
| 10 | 1035 | 20 | 快两周了吧，从调整通知发下来那天开始的。 |
| 15 | 1195 | 28 | 还是部门的事，现在还多了个担心，怕这么熬下去身体扛不住。 |
| 20 | 1356 | 28 | 会补，但根本睡不踏实，稍微有点动静就醒，醒了还浑身发沉。 |

## backlogItems

- `doubao-cost-price-source`：豆包官方单价未内置，成本仍按全局价；需填 `LLM_PRICE_*_PER_1K_DOUBAO`。
- `visitor-render-concurrency-smoke`：未做并发、429/5xx、超时与回退注入 smoke。
- `visitor-render-long-context-smoke`：20 轮 prompt 到 1356 token，仍未覆盖 `sessionSummary` 触发点。
- `doubao-cutover-restart`：本地 `.env` 已切，但未重启服务；重启后需再跑一次真实对练抽检。

## deviationTable

- `taskSays`: 切流预案放 `docs/runbooks/`。
  `reality`: executor 文件域不含 `docs/runbooks/`，`run-once` 判 `scope-domain-conflict`。
  `action`: 预案改写到 `docs/worklog/completed/phase2.5/`；AF-262 取消并由 AF-263 承接。
  `why`: 不让任务绕开文件域校验，也不手工改 Agent Card。
- `taskSays`: `.env` 进任务 scope。
  `reality`: `.env` 是 gitignored 运行态文件，executor 资源域不含它。
  `action`: 仍执行备份与切换，但只在交付记录里留痕，不进 git。
  `why`: 环境变更需要留证据，但不该把密钥文件提交进仓库。

## reviewVerdict

`passed`。scope 与提交事实一致；六组机读字段齐全；切流前后自检行为符合预期；20 轮真实 smoke 全轮豆包、无降级无回退；lint、tsc、全量 4264 例全绿；engine-core 零改动；`.env` 已备份，回滚只需改一行。

## 变更文件

- `bin/visitor-switch-check.ts`（新增）
- `docs/worklog/completed/phase2.5/doubao-visitor-cutover-runbook-2026-11-22.md`（新增）
- `docs/worklog/completed/phase2.5/af263-visitor-cutover-local-2026-11-22.md`（本任务）
- `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-263/`
- `docs/team/agent-orchestration/` 状态面
- `.env`（运行态，未提交；备份 `data/env-backup-af263-20261122.env`）
- `data/af263-switch-before.log` / `af263-switch-after.log` / `af263-smoke20.log`（取证，未提交）

## commit message

`feat(af263): 本地切流豆包来访者并补回滚预案`
