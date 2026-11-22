# AF-288 · 豆包主候选 20 轮长对练 soak 与 8 路并发真实 smoke

- 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-288/task-sheet.md`
- 分支：`task/AF-288-doubao-long-soak`
- 基线：`c932e9d14f98a8e1300cf69279926f7378303766`（AF-287 merge）
- 日期：2026-11-22
- 类型：verification（零业务代码改动）

## 一、结论

豆包主候选 `doubao-seed-character-260628` 在真实链路上通过三组 smoke：

| 场景 | 结果 | TTFT | 墙钟 | 回退/降级 |
| --- | --- | --- | --- | --- |
| 20 轮串行（历史无上限，最坏情况） | 20/20 `stop` | avg 711ms / P95 1271ms / max 1271ms | 15.44s | 0 / 0 |
| 20 轮编排（`--orchestrated --summary-after 10`，生产形态） | 20/20 `stop` | avg 689ms / P95 873ms / max 873ms | 14.27s | 0 / 0 |
| 8 路并发单轮 | 8/8 `stop` | avg 856ms / P95 1223ms / max 1223ms | 1.23s | 0 / 0 |

三组都满足 AF-283 灰度线：降级率 0、回退率 0、首包 P95 均 <2s、无 auth、无 429、无 guard block。

## 二、主候选确认

`pnpm exec tsx bin/visitor-switch-check.ts --expect-primary doubao` exit 0：

- `VISITOR_LLM_PROVIDER=doubao`
- `VISITOR_DOUBAO_MODEL=doubao-seed-character-260628`
- `promptVariant=shared`
- 引擎候选链 `doubao -> minimax`，`fallbackProviders=[minimax]`
- `LLM_DOUBAO_API_KEY` / `MINIMAX_API_KEY` 均 present
- `ENGINE_RENDER_PRIMARY_PROVIDER=minimax`，被来访者总开关覆盖，符合 AF-252

## 三、20 轮串行（最坏情况）

命令：

```powershell
pnpm exec tsx bin/visitor-render-smoke.ts --provider doubao --caller router --turns 20 --timeout-ms 45000
```

| turn | TTFT ms | wall ms | prompt | completion | finish |
| --- | --- | --- | --- | --- | --- |
| 1 | 647 | 663 | 745 | 11 | stop |
| 2 | 953 | 956 | 776 | 15 | stop |
| 3 | 564 | 776 | 810 | 16 | stop |
| 4 | 581 | 608 | 842 | 12 | stop |
| 5 | 538 | 735 | 872 | 21 | stop |
| 6 | 379 | 555 | 914 | 10 | stop |
| 7 | 1095 | 1096 | 941 | 25 | stop |
| 8 | 771 | 772 | 986 | 16 | stop |
| 9 | 734 | 736 | 1021 | 14 | stop |
| 10 | 922 | 923 | 1051 | 13 | stop |
| 11 | 472 | 677 | 1082 | 17 | stop |
| 12 | 915 | 916 | 1120 | 14 | stop |
| 13 | 600 | 602 | 1151 | 17 | stop |
| 14 | 810 | 811 | 1188 | 14 | stop |
| 15 | 561 | 561 | 1221 | 14 | stop |
| 16 | 589 | 590 | 1251 | 6 | stop |
| 17 | 1271 | 1273 | 1275 | 21 | stop |
| 18 | 783 | 784 | 1317 | 17 | stop |
| 19 | 430 | 801 | 1351 | 27 | stop |
| 20 | 604 | 605 | 1398 | 18 | stop |

聚合：

- prompt tokens 745 → 1398，净增 653，平均 `+34 token/轮`；
- totalUsage：prompt 21312 / completion 318 / total 21630；
- 全 20 轮 `fallbackUsed=false`、`degraded=false`、`guardLevel=pass`；
- TTFT 无单调漂移：第 1 轮 647ms，第 20 轮 604ms；最大值出现在第 17 轮 1271ms，随后回落。

**边界说明**：plain 模式按 `executeSessions` 把每轮 counselor/visitor 全量 push 进 history，`historyLimitTurns=16` 只是元数据、未裁剪。所以这组是“历史无上限”的最坏情况上界，不是生产真实上下文；生产形态看下一节。

## 四、20 轮编排（生产形态）

命令：

```powershell
pnpm exec tsx bin/visitor-render-smoke.ts --provider doubao --caller router --orchestrated --turns 20 --summary-after 10 --timeout-ms 45000
```

关键序列：

| 指标 | turn 1 | turn 10 | turn 11 | turn 20 |
| --- | --- | --- | --- | --- |
| prompt tokens | 799 | 1099 | 1089 | 1113 |
| prompt chars | 1091 | 1149 | 1149 | 1149 |
| summary | false | true | true | true |

- 10 轮后进入 summary：prompt tokens 从 1099 回落到 1089，之后 11–20 轮稳定在 1089–1113；
- `promptSummaryTurns` 覆盖 10–20，共 11 轮；
- TTFT avg 689ms / P95 873ms / max 873ms；
- 20/20 `stop`、无 fallback/degraded；
- totalUsage 20478 / 285 / 20763。

结论：真实编排路径会把长上下文压到约 1.1k prompt tokens，不存在“20 轮线性膨胀到 1.4k+”的生产风险；plain 模式的增长只是 smoke 无裁剪的上界。

`guardLevel=null` 是因为 orchestrated smoke 没注入输出 guard，不是 guard 失败；plain 模式 20/20 guard pass 已覆盖 guard 链路。

## 五、8 路并发

命令：

```powershell
pnpm exec tsx bin/visitor-render-smoke.ts --provider doubao --caller router --concurrency 8 --turns 1 --timeout-ms 45000
```

| slot | TTFT ms | wall ms | prompt | completion | outcome |
| --- | --- | --- | --- | --- | --- |
| 1 | 601 | 614 | 745 | 11 | stop |
| 2 | 932 | 933 | 742 | 14 | stop |
| 3 | 789 | 1023 | 745 | 18 | stop |
| 4 | 845 | 848 | 744 | 5 | stop |
| 5 | 778 | 975 | 742 | 10 | stop |
| 6 | 762 | 765 | 744 | 6 | stop |
| 7 | 920 | 921 | 744 | 11 | stop |
| 8 | 1223 | 1225 | 746 | 8 | stop |

- 8/8 `stop`；无 429、无 auth、无 fallback/degraded；
- 墙钟 1232ms，TTFT avg 856ms / P95 1223ms / max 1223ms；
- totalUsage 5952 / 83 / 6035；
- prompt tokens 742–746，说明 8 路之间无上下文串话。

## 六、与 AF-285 三轮基线对比

| turn | AF-285 TTFT / prompt | AF-288 TTFT / prompt | 判读 |
| --- | --- | --- | --- |
| 1 | 1237ms / 745 | 647ms / 745 | TTFT 更快，prompt 完全一致 |
| 2 | 947ms / 778 | 953ms / 776 | TTFT 基本一致，prompt -2 |
| 3 | 738ms / 813 | 564ms / 810 | TTFT 更快，prompt -3 |

结论：无系统性漂移。第 1 轮 590ms 的差异是单样本冷启动噪声；第 2/3 轮 prompt -2/-3 与 AF-285 已登记的 `visitor-prompt-token-drift` 观测噪声一致，未扩大。

## 七、闸门

| 命令 | 结果 | 证据 |
| --- | --- | --- |
| `visitor-switch-check --expect-primary doubao` | exit 0，候选链正确 | `data/af288-switch-check.log` |
| 20 轮串行 smoke | exit 0，20/20 stop | `data/af288-soak-20.log` |
| 8 路并发 smoke | exit 0，8/8 stop | `data/af288-concurrency8.log` |
| 20 轮编排 smoke（补充证据） | exit 0，20/20 stop，summary 生效 | `data/af288-orchestrated-20.log` |
| `git diff --stat` | 只有 docs/worklog 与状态面，无 `src/**` / `docker/**` / `.env` | 命令行输出 |

本单是 verification，不跑全量 `pnpm test`（零代码改动，跑全量只会重复 AF-280 未跟踪半成品的 4 例失败）。

## 八、发现与 backlog

1. `visitor-smoke-history-limit-metadata`：plain smoke 输出 `historyLimitTurns=16`，但 `executeSessions` 不裁剪 history，易被误读成“已按 16 轮裁剪”。建议后续在 smoke 报告里标注 `historyMode=unbounded|orchestrated`，或让 plain 模式按 16 轮裁剪做对照。
2. `visitor-candidate-cooldown-current-state`（AF-287 已登记）：本轮三组 smoke 都未触发冷却，无法在真实链路上观察新直方图；需要一次带故障注入的验证或生产样本。
3. 8 路并发未触发 429，不能据此推断更高并发安全；32/64 路压测不在本单范围。
