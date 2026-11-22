# AF-285 · 生产主候选上线前真实链路复核

## 一、结论

当前 integrate（`2769836e`）上，来访者渲染主候选 `doubao / doubao-seed-character-260628` 与回滚候选 `minimax / MiniMax-M3` 都真实出流、3/3 正常收尾，无回退、无降级、无 guard 拦截。开关自检确认 `VISITOR_LLM_PROVIDER=doubao` 时引擎主候选为豆包、自动补备为 MiniMax，两把 key 都在。

结论：AF-282 / AF-283 的改动没有破坏真实主备链路，灰度上线前可以按 AF-283 Runbook 的 S0 影子段开始。

## 二、开关自检

命令：`pnpm exec tsx bin/visitor-switch-check.ts --expect-primary doubao`，exit 0，日志 `data/af285-switch-check.log`。

| 项 | 实测 |
| --- | --- |
| `VISITOR_LLM_PROVIDER` | doubao |
| 角色模型 | doubao-seed-character-260628 |
| prompt variant | shared |
| 引擎主候选 | doubao（chat model 同上） |
| 候选链 | doubao → minimax(MiniMax-M3) |
| fallbackProviders | minimax |
| `ENGINE_RENDER_PRIMARY_PROVIDER` | minimax（被来访者总开关覆盖，符合 AF-252 设计） |
| key 就绪 | `LLM_DOUBAO_API_KEY`、`MINIMAX_API_KEY` 均 present |

## 三、豆包主候选 smoke

命令：`pnpm exec tsx bin/visitor-render-smoke.ts --provider doubao --caller router --turns 3`，exit 0，日志 `data/af285-smoke-doubao.log`。

| 轮 | TTFT | 耗时 | prompt tokens | completion | finish | fallback | degraded | guard |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1237ms | 1252ms | 745 | 13 | stop | false | false | pass |
| 2 | 947ms | 948ms | 778 | 16 | stop | false | false | pass |
| 3 | 738ms | 741ms | 813 | 7 | stop | false | false | pass |

- 总计：wall 2942ms；prompt 2336 / completion 36 / total 2372。
- 三轮文本均落在睡眠困扰主题，无离题兜底句。

## 四、MiniMax 回滚候选 smoke

命令：`pnpm exec tsx bin/visitor-render-smoke.ts --provider minimax --caller router --turns 3`，exit 0，日志 `data/af285-smoke-minimax.log`。

| 轮 | TTFT | 耗时 | prompt tokens | completion | reasoning | finish | fallback | degraded | guard |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1751ms | 2169ms | 821 | 137 | 106 | stop | false | false | pass |
| 2 | 939ms | 1225ms | 871 | 25 | 0 | stop | false | false | pass |
| 3 | 1041ms | 1346ms | 915 | 23 | 0 | stop | false | false | pass |

- 总计：wall 4740ms；prompt 2607 / completion 185 / total 2792。
- 回滚候选延迟明显高于豆包，但仍在 AF-283 的 2s P95 告警线内（首轮 1.75s 逼近阈值，值得灰度期盯住）。

## 五、与 AF-278 基线对比

| 项 | AF-278（2026-11-22 早） | AF-285（当前 integrate） | 判读 |
| --- | --- | --- | --- |
| 豆包 stop | 3/3 | 3/3 | 一致 |
| wall | 2651ms | 2942ms | +291ms，正常波动 |
| TTFT | 683 / 1252 / 696ms | 1237 / 947 / 738ms | 分布不同，量级一致 |
| prompt tokens | 745 / 775 / 811 | 745 / 778 / 813 | 第 2、3 轮各 +3 / +2，未定位到同轮 prompt 文本差异，按观测噪声记录 |
| fallback / degraded | false / false | false / false | 一致 |

## 六、机读标记

### gateResults

- `visitor-switch-check --expect-primary doubao`：exit 0；主候选 doubao、备 minimax、两 key present。
- `visitor-render-smoke --provider doubao --turns 3`：exit 0；3/3 stop，fallback/degraded false，wall 2942ms。
- `visitor-render-smoke --provider minimax --turns 3`：exit 0；3/3 stop，fallback/degraded false，wall 4740ms。
- `git diff --stat HEAD -- src test bin docker docs/runbooks`：输出为空。

### scopeCheck

in-scope。只新增交付记录与记录包，未改 `.env`、未改代码、未改告警规则。工作树内 `src/shared/realism/visitor-prompt-variants.ts`、`test/agent/visitor/`、`test/engine-adapters/af280-render-prompt-variant.spec.ts` 为 AF-280/AF-281 并行半成品，未跟踪、未改动。

### contractChecks

- taskId：分支 `task/AF-285-production-candidate-smoke`，提交只含 AF-285。
- state-write：register / promote / branch / run-once 均经 CLI。
- engine-boundary：`src/engine-core` 零改动。
- telemetry-privacy：记录只含模型名、token 数与来访者短句预览，不含完整 prompt、密钥或会话标识。

### backlogItems

- `visitor-minimax-ttft-near-threshold`：回滚候选首轮 TTFT 1.75s，接近 2s P95 告警线，灰度期需观察是否为稳定特征。
- `visitor-prompt-token-drift`：同剧本 prompt tokens 比 AF-278 基线高 2–3，未定位原因，需在同 prompt 快照下复测。

### deviationTable

1. prompt token 与 AF-278 基线有 +2~+3 漂移，未定位，不当作回归结论。
2. 本单只跑 3 轮/候选，不做质量结论。

### reviewVerdict

passed。
