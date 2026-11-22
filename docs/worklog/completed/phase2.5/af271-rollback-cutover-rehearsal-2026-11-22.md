# AF-271 · 来访者主候选回滚切流演练 — 交付记录（2026-11-22）

## 结论

三段回滚演练全部通过，`visitor-switch-check` 与真实 router smoke 都能证明主候选方向：

| 阶段 | visitor 开关 | 引擎主候选 | 候选链 | 结果 |
| --- | --- | --- | --- | --- |
| 当前 `.env` | `doubao` | `doubao` | `doubao,minimax` | `ok=true` |
| 模拟回滚 | `minimax` | `minimax` | `minimax` | `ok=true` |
| 真实回滚 smoke | `minimax` | `minimax` | `minimax` | 5/5 `MiniMax-M3`，零回退零降级 |
| 恢复后自检 | `doubao` | `doubao` | `doubao,minimax` | `ok=true` |

真实回滚态 5 轮：`callerPath=router`、`turns=5`、5/5 `providerHint=minimax`、`model=MiniMax-M3`、`fallbackUsed=false`、`degraded=false`、`finishReason=stop`；墙钟 7 748 ms；usage 4 552 / 209 / 4 761；TTFT 971–1 733 ms；每轮 32–52 字符。

**全程未改真实 `.env`。** 回滚态通过 `--simulate-visitor-provider minimax` 只在本进程注入 env；进程退出即恢复，恢复后自检仍为 `doubao`。

## 改了什么

仅改 `bin/` 两个 smoke 工具，生产代码零改动，`src/engine-core` 零改动。

### 1. `bin/visitor-switch-check.ts`

- 新增 `--expect-primary doubao|minimax`，默认 `doubao`，零回归；
- `ok` 由写死 `primary===doubao` 改为 `primary===expectedPrimary`；
- 最终硬断言同步按期望值判定；只有期望 `doubao` 时才要求 `minimax` 备候选；
- 新增 `--simulate-visitor-provider doubao|minimax`：只在本进程设置 env，不写 `.env`，用于回滚演练。

### 2. `bin/visitor-render-smoke.ts`

- 允许 `--caller router --provider minimax`；`--fail-primary` 仍只允许豆包主候选；
- 候选装配断言改为通用 `candidates[0].id === provider`；
- 正常路径断言改为 `providerHint === provider`，不再只校验豆包；
- `--provider minimax` 时把 `ENGINE_RENDER_PRIMARY_PROVIDER=minimax` 写入本进程 env，保证候选派生与回滚态一致；
- MiniMax 主候选默认 `max-tokens=800`：M3 的 reasoning token 计入 completion，300 会截断正文制造假降级。

## 实测命令与证据

```powershell
pnpm exec tsx bin/visitor-switch-check.ts --expect-primary doubao
pnpm exec tsx bin/visitor-switch-check.ts --expect-primary minimax --simulate-visitor-provider minimax
pnpm exec tsx bin/visitor-render-smoke.ts --provider minimax --caller router --turns 5
pnpm exec tsx bin/visitor-switch-check.ts --expect-primary doubao
```

日志（未提交）：

- `data/af271-check-doubao.log`
- `data/af271-check-minimax.log`
- `data/af271-minimax5.log`
- `data/af271-check-restored.log`

## 闸门

| 闸门 | 命令 | 结果 |
| --- | --- | --- |
| 类型 | `pnpm exec tsc --noEmit -p tsconfig.json` | exit 0 |
| lint | `pnpm lint` | 0 error / 0 warning，exit 0 |
| 当前态自检 | `--expect-primary doubao` | exit 0，primary=doubao |
| 回滚态自检 | `--expect-primary minimax --simulate-visitor-provider minimax` | exit 0，primary=minimax |
| 回滚态真实路由 | `--provider minimax --caller router --turns 5` | exit 0，5/5 MiniMax |
| 恢复后自检 | `--expect-primary doubao` | exit 0，primary=doubao |
| 全量测试 | `pnpm test` | 263 files passed + 1 skipped；4 272 tests passed + 4 skipped |
| 纯层 | `git diff --stat HEAD -- src/engine-core` | 空 |

## 关键设计决策与偏差

1. **回滚用进程内 env 模拟，不写 `.env`。** 任务非目标明确不改真实配置；这样既不冒睡眠中配置残留的风险，也能证明候选派生规则和真实路由都可逆。
2. **MiniMax 主候选默认 800 completion。** 这不是生产默认，只是 smoke 工具在回滚态避免 M3 reasoning 截断造成假失败；生产 `ENGINE_RENDER_MAX_TOKENS` 仍由部署配置决定。
3. **回滚态候选链只有 MiniMax，没有备候选。** 当前 `RenderConfigFactory` 只在 `VISITOR_LLM_PROVIDER=doubao` 时自动补 MiniMax；切回 MiniMax 不会自动补豆包。真实 smoke 因此是单候选，`assertFailoverCapacity` 会有单候选告警。
4. **未做完整部署级回滚。** 没有重启服务、没有改 `.env`、没有双跑；证明的是「配置派生正确 + 真实 router 可走 MiniMax」。部署级演练需在预发/生产变更窗口另做。

## 已知缺口

- **回滚后无备候选**：切回 MiniMax 时若未显式配置 `ENGINE_RENDER_FALLBACK_PROVIDERS=doubao`，MiniMax 一熔断就全场兜底句。这是生产回滚的实际风险，建议补一条回滚检查清单/配置守卫。
- **未验证回滚态的限流/5xx/超时**：AF-264/269 的故障 smoke 只覆盖豆包主候选 + MiniMax 备；反向没有故障注入。
- **未验证回滚态的并发与长上下文**：AF-265/268 都是豆包主候选口径。
- **未验证 MiniMax 成本分账**：MiniMax 官方单价仍未核对，成本仍走全局回落价。
- **未验证部署级切换的灰度与流量比例**。

## 回执字段速览

- `gateResults`：tsc exit 0、lint 0/0、三段自检 exit 0、真实 MiniMax 5 轮 exit 0、全量 4 272 passed + 4 skipped、engine-core diff 为空。
- `scopeCheck`：in-scope，只改 `bin/visitor-switch-check.ts`、`bin/visitor-render-smoke.ts` 与 AF-271 文档。
- `contractChecks`：taskId 单任务号、状态写入全经 CLI、回执六组字段闭合、AF-263/269 开关兼容、未触碰 engine-core。
- `backlogItems`：`visitor-rollback-single-candidate-risk`、`visitor-rollback-fault-smoke`、`visitor-rollback-concurrency-long-context`、`minimax-official-pricing`。
- `deviationTable`：回滚态用进程 env 模拟而非改 `.env`；MiniMax 主候选 smoke 默认 800 completion。
- `reviewVerdict`：passed。

## commit message

`test(af271): 来访者主候选回滚切流演练与 MiniMax 真实路由 smoke`
