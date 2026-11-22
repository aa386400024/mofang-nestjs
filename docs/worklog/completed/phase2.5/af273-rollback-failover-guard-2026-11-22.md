# AF-273 · 回滚态候选链保底守卫与故障回退 smoke — 交付记录（2026-11-22）

## 结论

回滚到 MiniMax 不再等于「单候选裸奔」。显式 `VISITOR_LLM_PROVIDER=minimax` 且未配置 `ENGINE_RENDER_FALLBACK_PROVIDERS` 时，装配期自动补 `doubao` 为备候选，并继续使用来访者 Seed Character 模型；未设置该总开关的既有部署保持原候选链，零回归。

真实回滚态 smoke 三类故障全部切到豆包并正常出话：MiniMax 429、500、超时均为 `fallbackUsed=true`、`degraded=false`、`finishReason=stop`，没有落到兜底句。

## 根因

AF-271 只完成了「能切回 MiniMax」，但 `RenderConfigFactory` 的自动补备逻辑只覆盖正向 `VISITOR_LLM_PROVIDER=doubao`。反向回滚时 `visitorProviderOverride()` 把 `minimax` 当「未覆盖」返回 `null`，候选链只剩 MiniMax；一旦限流或熔断，没有第二候选，整场对练直接降级。

## 改了什么

### 1. `src/engine-adapters/wiring/render-config.factory.ts`

- `visitorProviderOverride()` 对显式 `minimax` 返回 `AIProviderId.MINIMAX`，不再返回 `null`；`null` 只表示「未配置」。
- `buildCandidates()` 在无显式 fallback 时双向补备：显式 `doubao` 补 `minimax`，显式 `minimax` 补 `doubao`。显式 `ENGINE_RENDER_FALLBACK_PROVIDERS` 始终优先。
- `modelFor()` 对豆包候选的条件从「visitor=doubao」放宽为「visitor 总开关已显式设置」；回滚态豆包备候选仍走 `VISITOR_DOUBAO_MODEL` 或默认 `doubao-seed-character-260628`，不退化成通用豆包型号。

### 2. `bin/visitor-switch-check.ts`

- 期望主候选为 `minimax` 时，硬断言候选链里必须有 `doubao` 备候选；输出仍包含 `fallbackProviders`、`doubaoApiKeyPresent`。

### 3. `bin/visitor-render-smoke.ts`

- `--fail-primary` / `--expect-fallback` 从「只允许豆包主候选」放宽到「doubao / minimax 主候选」，且必须走 `--caller router`。
- 回退断言按主候选动态判定：豆包失败期望回退 MiniMax，MiniMax 失败期望回退豆包。
- 故障注入按主候选落到对应 provider：MiniMax 主候选的 429/500/超时把 MiniMax client 指向本机故障服务，`maxRetries=0`，超时模式 `requestTimeoutMs=2000`；探针也按主候选 provider 发请求。
- auth 故障按主候选注入对应无效 key；仍只在本进程生效，不写 `.env`、不打印原 key。
- 回退 smoke 仍要求备候选真实注册，避免「未注册 → 回落默认」造成假回退。

### 4. `test/engine-adapters/af273-rollback-failover-guard.spec.ts`

新增 6 例：回滚自动补豆包、回滚豆包备候选使用 Seed Character、显式 fallback 优先、未设置 visitor 开关零回归、回滚补备后 `ENGINE_RENDER_REQUIRE_FAILOVER=true` 不再启动失败、正向豆包切流仍补 MiniMax。

## 真实 smoke 证据

当前 `.env` 保持 `VISITOR_LLM_PROVIDER=doubao`，以下命令仅在 smoke 进程内覆写为 `minimax`，未改 `.env`。

| 场景 | 命令 | 结果 |
| --- | --- | --- |
| 回滚自检 | `visitor-switch-check.ts --expect-primary minimax --simulate-visitor-provider minimax` | exit 0；`minimax` + `doubao` 两候选，`fallback=doubao`，豆包模型 `doubao-seed-character-260628` |
| 429 | `visitor-render-smoke.ts --provider minimax --caller router --turns 3 --fail-primary --fail-primary-mode rate-limit --expect-fallback` | exit 0；probe 50 ms；3/3 回退豆包；wall 2 271 ms；TTFT 735/742/482 ms；chars 9/21/26；tokens 2 322/43/2 365 |
| 500 | 同上，`--fail-primary-mode server-error` | exit 0；probe 54 ms；3/3 回退豆包；wall 2 258 ms；TTFT 706/771/756 ms；chars 16/20/19；tokens 2 335/41/2 376 |
| 超时 | 同上，`--fail-primary-mode timeout --timeout-ms 5000 --expect-fallback-within-ms 30000` | exit 0；probe 2 030 ms；3/3 回退豆包；wall 17 063 ms；TTFT 5 679/5 666/5 552 ms；chars 14/19/16；tokens 2 328/34/2 362 |

三类故障的 9 轮全部满足：`providerHint=doubao`、`model=doubao-seed-character-260628`、`fallbackUsed=true`、`degraded=false`、`finishReason=stop`。

切流前后自检：

- 切流前：`primary=doubao`，候选 `doubao,minimax`。
- 模拟回滚：`primary=minimax`，候选 `minimax,doubao`。
- 恢复后：`primary=doubao`，证明 `.env` 未被 smoke 修改。

## 闸门

| 闸门 | 命令 | 结果 |
| --- | --- | --- |
| 定向单测 | `pnpm exec vitest run test/engine-adapters/af273-rollback-failover-guard.spec.ts` | 6/6 passed |
| 关联单测 | `pnpm exec vitest run af273... af252... wp-h-render-availability...` | 29/29 passed |
| 类型 | `pnpm exec tsc --noEmit -p tsconfig.json` | exit 0 |
| lint | `pnpm lint` | 0 error / 0 warning，exit 0 |
| 回滚自检 | `visitor-switch-check.ts --expect-primary minimax --simulate-visitor-provider minimax` | exit 0，`minimax,doubao` |
| 真实回退 smoke | 429 / 500 / timeout 三条 | 全 exit 0，9/9 回退豆包、零降级 |
| 全量测试 | `pnpm test` | 264 files passed + 1 skipped；4 278 tests passed + 4 skipped；24.69 s |
| 纯层 | `git diff --stat HEAD -- src/engine-core` | 空 |

全量测试为本机串行执行，执行期间未并行跑第二条全量或 watch 任务。

## 关键设计决策与偏差

1. **只在显式 `VISITOR_LLM_PROVIDER` 时补备。** 未设置总开关的 MiniMax 部署仍保持单候选原样，避免全局行为漂移；回滚保底只对「明确选择 visitor 主候选」的部署生效。
2. **显式 fallback 不被自动补备覆盖。** 部署方写 `ENGINE_RENDER_FALLBACK_PROVIDERS=qwen` 时尊重其选择，不强行插入豆包；此时 `visitor-switch-check --expect-primary minimax` 会因没有豆包备候选而失败，属于有意暴露配置缺口。
3. **回滚态豆包备候选使用 Seed Character。** 豆包在 visitor 链路里无论主备都应保持角色模型口径，否则故障切备会突然换成通用模型，来访者表现不可比。
4. **smoke 放宽而不是新写一套。** 复用 AF-269/270/271 的故障服务、候选循环与超时门，只把 provider 从写死豆包改成按主候选分派；不新增生产配置键。
5. **未把「豆包 key 是否存在」升级为启动硬失败。** 候选存在不等于凭据可用；`visitor-switch-check` 已输出 `doubaoApiKeyPresent`，运行期缺 key 会按候选失败处理。是否需要装配期硬门单列 backlog，避免本任务扩大启动失败面。

## 已知缺口

- **回滚态并发与长上下文未验证**：本任务只做 3 轮串行故障 smoke；并发 + 超时组合、40 轮长上下文下的回滚态仍待补。
- **回滚态 auth 策略未验证**：本任务覆盖 429/500/超时；MiniMax 401 是否快速降级与豆包 401 同策略，需单独确认。
- **MiniMax 官方单价仍未核对**：回滚态成本继续走全局回落价。
- **显式 fallback 非豆包时无保底**：部署方选择 `qwen` 等备候选时，系统不阻止单点风险；自检脚本会失败，但生产启动只告警。
- **全流中途 stall 与重试风暴**：仍沿用 AF-270 遗留判断，不在本任务范围。

## 回执字段速览

- `gateResults`：定向 6/6、关联 29/29、tsc exit 0、lint 0/0、回滚自检 exit 0、429/500/timeout 三条 smoke 全 exit 0 且 9/9 回退豆包、全量 4 278 passed + 4 skipped、engine-core diff 为空。
- `scopeCheck`：in-scope；改 `render-config.factory.ts`、`bin/visitor-switch-check.ts`、`bin/visitor-render-smoke.ts`、AF-273 单测与记录文档；未触碰 engine-core、未改 `.env`。
- `contractChecks`：单任务号 AF-273；状态只经 CLI；回执六组字段闭合；回滚 smoke 复用既有故障服务与超时门；未提交密钥与日志。
- `backlogItems`：`visitor-rollback-concurrency-long-context`、`visitor-rollback-auth-policy`、`visitor-rollback-fallback-key-guard`、`minimax-official-pricing`。
- `deviationTable`：只在显式 visitor 总开关时双向补备；显式 fallback 优先；未新增生产 env 键；未把缺 key 升级为启动硬失败。
- `reviewVerdict`：passed。

## commit message

`fix(af273): 回滚态自动补豆包备候选并验证真实故障回退`
