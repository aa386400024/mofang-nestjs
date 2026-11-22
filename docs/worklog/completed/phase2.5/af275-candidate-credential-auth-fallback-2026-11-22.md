# AF-275 · 自动补备候选凭据守卫与按候选鉴权回退 — 交付记录（2026-11-22）

## 结论

装配期不再允许「候选数够了、但备候选没 key」的假备胎：自动补出来的对端候选缺 apiKey 时直接启动失败，不受 `ENGINE_RENDER_REQUIRE_FAILOVER` 影响。运行期鉴权失败从「终止」改为「可切备」：主备厂商 key 独立，主 key 无效时切到备候选；主备都失败时候选自然耗尽降级，不无限重试。

真实 401 smoke：主候选豆包 3/3 鉴权失败，全部切到 MiniMax，`fallbackUsed=true`、`degraded=false`、`finishReason=stop`，wall 4918ms，TTFT 1855/1106/1116ms。正向与回滚候选链自检均 exit 0，两家 `candidateApiKeys` 全部 `present=true`。

## 根因

AF-273 解决的是「候选链只有 1 个」；但候选存在不等于候选可用。自动补出来的 MiniMax / 豆包备候选没有对应 key 时，装配期只看到两个候选，运行期故障真的发生才报 "API key not found"，用户仍然只听到兜底句。

同一时期 `classifyFailure` 仍沿用 M7 的旧前提「坏 key 对所有候选都坏」。那个前提成立于全场共用一把 key；现在主备是不同厂商、独立 key，主 key 轮换或临时失效不应把整场拖进降级。

## 改了什么

### 1. `src/engine-adapters/wiring/render-config.factory.ts`

- `buildCandidates()` 返回值从 `RenderCandidate[]` 改为 `{ candidates, autoFallbackId }`。
- 显式 fallback 先与主候选一起去重；去重后仍只有 1 个、且显式设置了 `VISITOR_LLM_PROVIDER` 时，才补对端候选。修复 `ENGINE_RENDER_FALLBACK_PROVIDERS=<主候选>` 去重后单候选骗过补备逻辑。
- 新增 `assertCandidateCredentials()`：
  - 自动补出来的备候选缺 key → 装配期抛错，即使 `ENGINE_RENDER_REQUIRE_FAILOVER=false`。
  - 显式候选缺 key：`REQUIRE_FAILOVER=true` 抛错，否则 warn。
  - 空白 key 视为缺失。

### 2. `src/engine-adapters/rendering/llm-render.adapter.ts`

- `classifyFailure()` 鉴权失败 `retryable` 从 `false` 改为 `true`，日志改为「切下一个候选」。
- 单候选仍只尝试一次；主备都鉴权失败候选耗尽后自然降级。
- `isAuthFailure()` 注释更新为「仍识别 401/403，但不再等于终止」。

### 3. `bin/visitor-switch-check.ts`

- 输出每个候选的 `{ id, envKey, present }`。
- 任一候选缺 key 直接 exit 2，错误文案列出 `provider(envKey)`。

### 4. `bin/visitor-render-smoke.ts`

- `FALLBACK_FAULT_MODES` 加入 `auth`；`DEGRADED_FAULT_MODES` 只剩 `midstream-stall`。
- `auth + --expect-fallback` 合法；`auth + --expect-degraded` 报错。
- 错误提示改为「鉴权 / 限流 / 服务端错误 / 超时均为可切备故障」。

### 5. `.env.example`

- 删除重复的 `ENGINE_RENDER_REQUIRE_FAILOVER=false` 生效行。
- 明确自动补对端候选必须有 key，缺 key 装配期启动失败；显式候选缺 key 受 `REQUIRE_FAILOVER` 控制。
- `REQUIRE_FAILOVER` 注释改为「候选数 < 2 或显式候选缺 apiKey 启动失败」。

### 6. 测试

新增：

- `test/engine-adapters/af275-candidate-credential-guard.spec.ts` 9 例：自动补 minimax 缺 key 即使 REQUIRE=false 也抛；空白 key；双 key 正常；显式 fallback 缺 key 默认只告警；REQUIRE=true 抛；显式 fallback 与主候选重复时去重并自动补对端；重复且对端缺 key 抛；显式 qwen fallback 优先不插对端；未设置 visitor 总开关保持单候选不拦启动。
- `test/engine-adapters/af275-auth-fallback.spec.ts` 4 例：流式主 401 切备成功；主备都 401 降级；单候选只试一次；聚合路径主 401 切备成功。

既有测试按新语义更新：

- `wp6-llm-render.spec.ts`：原「401 不循环、直接降级」拆成「主 401 切备成功」「主备都 401 耗尽降级」；「缺 apiKey 直接降级」改为「按候选切备」。
- `wp8b-stream-render.spec.ts`：原「鉴权失败不切备」改为「主候选鉴权失败切备成功」。
- `wp-h-render-availability.spec.ts`：候选数校验用例补两把假 key，避免被 AF-275 凭据硬门拦截。
- `af252-visitor-render-provider.spec.ts`：统一补两把假 key，避免自动补备候选触发缺 key 硬失败。
- `af273-rollback-failover-guard.spec.ts`：自动补备场景补两把假 key。

## 真实 smoke 证据

| 场景 | 关键结果 |
| --- | --- |
| 401 切备：`--provider doubao --caller router --turns 3 --fail-primary --fail-primary-mode auth --expect-fallback` | exit 0；probe 401 201ms；3/3 `providerHint=minimax`、model `MiniMax-M3`、`fallbackUsed=true`、`degraded=false`、`finishReason=stop`；wall **4918ms**；TTFT 1855/1106/1116ms；chars 41/34/48；totalUsage 2754 |
| 正向自检 `--expect-primary doubao` | exit 0；候选 `doubao,minimax`；两家 key `present=true` |
| 回滚自检 `--expect-primary minimax --simulate-visitor-provider minimax` | exit 0；候选 `minimax,doubao`；豆包模型 `doubao-seed-character-260628`；两家 key `present=true` |

## 闸门

| 闸门 | 命令 | 结果 |
| --- | --- | --- |
| 定向新增 | `pnpm exec vitest run af275-*.spec.ts af273-rollback-failover-guard.spec.ts` | 19/19 passed |
| 受影响既有测试 | `wp6` / `wp8b` / `wp-h` / `af252` + AF-275 三文件 | 7 files、84/84 passed |
| 类型 | `pnpm exec tsc --noEmit -p tsconfig.json` | exit 0 |
| lint | `pnpm lint` | 0 error / 0 warning，exit 0 |
| 401 真实 smoke | 见上表 | exit 0；3/3 MiniMax、零降级 |
| 正向 / 回滚自检 | 见上表 | 均 exit 0，双方 key present |
| 全量测试 | `pnpm test` | 267 files passed + 1 skipped；4297 tests passed + 4 skipped；22.59s |
| 纯层 | `git diff --stat HEAD -- src/engine-core` | 空 |

## 关键设计决策与偏差

1. **自动补备候选缺 key 必须硬失败，即使 `REQUIRE_FAILOVER=false`。** 这个候选是系统替部署方加的，不是部署方显式选择；允许它带病存在等于把「有备胎」做成幻觉。显式候选仍保留原有弹性，避免某个非主用 provider 暂时没配 key 导致整体起不来。
2. **401/403 改为可切备，不保留「鉴权失败直接终止」。** 前提已从「共用一把 key」变为「每厂商独立 key」；主 key 轮换、额度异常、误配都只影响一个候选。候选耗尽仍会降级，不会无限重试。
3. **候选先去重，再判断是否需要补对端。** 旧实现判断的是原始 fallback 文本长度，不是去重后的候选数；主候选与显式 fallback 同名时会静默退化成单候选。
4. **`visitor-switch-check` 把凭据可见性变成机器断言。** 只打印候选链不够；缺 key 的候选在故障时必然失败，自检必须在切流前失败。
5. **既有测试的「不切备」断言按新语义改写，不是放宽。** 原断言编码的是旧前提；AF-275 同时保留「主备都失败 → 降级」「单候选只试一次」的边界，并在新增 4 例里覆盖。

## 已知缺口（转后续任务）

- **空闲超时仍复用 `ENGINE_RENDER_TIMEOUT_MS`**：首包、块间空闲、整轮超时三种语义共用一个键。
- **首包固定 30s**：高 `maxTokens` 的慢首包可能被误杀，建议 `max(8000, maxTokens*8)`。
- **回滚态并发 + 超时组合未验证**：AF-271 只验证串行回滚；AF-265 只验证正向并发。
- **MiniMax HttpClient 传输层 headersTimeout 未单独核对**：是否仍会先于适配器空闲超时触发。
- **无空闲超时 / 鉴权切备指标**：缺 `stream_idle_timeout_total`、phase、candidate 维度观测。
- **客户端自动重试可能透传 raw Error**：应在 WS 层转标准 error/end。
- **成本分账未闭环到落库与看板**：`auto-practice` 未消费 `providerBreakdown`；管理后台未按 provider/model 展示。

## 回执字段速览

- `gateResults`：定向 19/19；受影响既有 84/84；tsc exit 0；lint 0/0；401 smoke exit 0（3/3 MiniMax、wall 4918ms、TTFT 1855/1106/1116ms）；正向/回滚自检 exit 0；全量 267 files +1 skipped、4297 tests +4 skipped、22.59s；engine-core diff 为空。
- `scopeCheck`：in-scope；改 `render-config.factory.ts`、`llm-render.adapter.ts`、两个 bin、`.env.example`、AF-275 新测与 4 个受影响既有测试、交付记录；未触碰 engine-core、未改 `.env`。
- `contractChecks`：单任务号 AF-275；状态只经 CLI；回执六组字段闭合；未提交密钥与日志；未用 `--no-verify`。
- `backlogItems`：`visitor-stream-idle-timeout-key`、`visitor-stream-first-delta-budget`、`visitor-rollback-concurrency-long-context`、`minimax-httpclient-transport-timing`、`visitor-stream-idle-observability`、`visitor-stream-client-auto-retry`、`visitor-cost-breakdown-persistence`、`minimax-official-pricing`。
- `deviationTable`：401/403 语义从「终止」改为「可切备」；`buildCandidates` 返回值形状变更；4 个既有测试按新语义改写。
- `reviewVerdict`：passed（MiniMax P0-3 / P0-4 / P1-5 / P1-6 / P1-7 已修）。

## commit message

`feat(af275): 自动补备候选凭据守卫与按候选鉴权回退`
