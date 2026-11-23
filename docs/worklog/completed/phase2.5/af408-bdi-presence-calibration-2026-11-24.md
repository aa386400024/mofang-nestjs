# AF-408 交付记录：BDI 影子审计 v2 口径对齐与在场信号离线校准

- 日期：2026-11-24
- 任务：AF-408
- 基线：`integrate` @ `2dbedce2bcb0a871577b50541e2feeda9f6a575b`
- 分支：`task/AF-408-bdi-presence-calibration`
- 交叉验证：MiniMax Code 只读评估 `docs/worklog/pending/archive/relay-response-BDI-calibration-20261124-0320.md`

## 一、结论

影子审计必须切回 v2，这一条已改并验证。适配层用“疑问结构”补 `holding_present`，**按原样不值得落**。

关键数字：同一批 205 轮，落盘 `eventTags` 的 neutral 是 157 轮（76.6%），当前 v2 重放是 120 轮（58.54%），差 37 轮（18.0%）。这说明落盘标签是历史词表快照，不是当前分类器输出；影子审计如果继续用 legacy，会把这个口径差继续放大。

在 157 轮落盘 neutral 上，候选 A（宽疑问 ∧ ≤40 字）只命中 16 轮，neutral 仅从 76.6% 降到 68.8%，远达不到“把 idle 场压下去”的目标；放宽到严格疑问（句末问号/吗呢）则命中 135 轮，几乎把整个 neutral 池吃掉。**两个阈值之间没有可用甜点，问题不在阈值，在维度选错了。**

## 二、影子审计口径对齐

改动：`scripts/ops/quality/af322-classifier-shadow-audit.ts`

- 默认 `new RuleBasedClassifier({ semantics: 'v2' })`，与 `engine.providers.ts:323` 生产装配一致。
- 新增 `--legacy`，只用于复现历史口径；启动日志打印当前规则轨口径。
- 未改分类器、delta、prompt；`src/engine-core` 零 diff。

实测：

| 命令                                                                                            | 规则轨 neutral     | 轮数 |
| ----------------------------------------------------------------------------------------------- | ------------------ | ---- |
| `pnpm audit:classifier-shadow -- --rule-only --ids <13 场> --sample-per-session 20 --limit 300` | 120 / 205 = 58.54% | 205  |
| 同上 + `--legacy`                                                                               | 116 / 205 = 56.59% | 205  |

与 MiniMax 上一轮审计的 58.5% / 116 轮一致。

## 三、在场信号离线校准

新增：`scripts/ops/quality/af408-presence-calibration.mjs`，只读 trace，只输出计数与比率，不打印原文。eligible 池取落盘 `eventTags` 为 neutral-only 的轮次（157 轮）。

| 变体 | 判定                                     | holding | cold | 剩余 neutral | neutral 降幅 |
| ---- | ---------------------------------------- | ------- | ---- | ------------ | ------------ |
| A    | 宽疑问 ∧ ≤40 字 → holding                | 16      | 0    | 141          | 10.2%        |
| AS   | 严格疑问（句末问号/吗呢）→ holding       | 135     | 0    | 22           | 86.0%        |
| ABS  | 严格疑问或短承接 → holding               | 137     | 0    | 20           | 87.3%        |
| ABCS | 严格疑问/短承接 → holding；纯短句 → cold | 136     | 1    | 20           | 87.3%        |

cold 场 `debug_ITUgH5VCcuZ5QXw9SBb-T` 14 轮：

| 变体 | holding | 剩余 neutral | trust  | safety | bond   | valence | zero_motion |
| ---- | ------- | ------------ | ------ | ------ | ------ | ------- | ----------- |
| A    | 8       | 6            | 0.2500 | 0.2820 | 0.2160 | 0.0280  | false       |
| AS   | 12      | 2            | 0.2500 | 0.2980 | 0.2240 | 0.0440  | false       |

trust 不变，方向安全；但 A 只把 14 轮压到 6 轮 neutral，离“≥50% 降幅”还差；AS 虽然压到 2 轮，却是在 157 轮里命中 135 轮，等于把 neutral 池整体改名。

**维度错位**：A 命中的 16 轮里没有一轮带结构化过渡/行动规划标记；cold 场最像“在场”的 4 轮结构化长问句，长度 45 / 59 / 66 / 76，全部被 40 字上限排除。A 抓到的是短促提问，不是内容承载。

**指标可刷绿**：1 轮 `holding_present` 就能把 safety 从 0.2500 推到 0.2540，`zero_motion` 从 true 翻 false。在一个“错 1 轮就能让指标变好”的口径上加未标注规则，等于给指标装了一个误判开关。这是本单不建议落 flag 的首要理由。

风险样例（合成句）：

| 合成句                 | ABCS 标签 | 风险                       |
| ---------------------- | --------- | -------------------------- |
| “你最近睡得怎么样？”   | holding   | 合理                       |
| “你为什么现在才来？”   | holding   | 对峙句被吸成在场，方向相反 |
| “嗯。”                 | cold      | 机械敷衍与安静陪伴不可分   |
| “行，那我们下次再说。” | holding   | 结束语被短承接规则吸成在场 |

## 四、闸门

| 闸门            | 命令                                                                                       | 结果                                                    |
| --------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| 定向单测        | `pnpm exec vitest run scripts/orchestration/__tests__/af408-presence-calibration.spec.mjs` | 9/9 通过                                                |
| 校准脚本        | `node scripts/ops/quality/af408-presence-calibration.mjs --dir data/debug-sessions`        | 13 场 / 205 轮，neutral-only 157                        |
| 影子审计 v2     | `pnpm audit:classifier-shadow -- --rule-only ...`                                          | 205 轮，neutral 58.54%                                  |
| 影子审计 legacy | 同上 + `--legacy`                                                                          | 205 轮，neutral 56.59%                                  |
| 类型检查        | `pnpm typecheck`                                                                           | 0 error                                                 |
| Lint            | `pnpm lint`                                                                                | 0 error                                                 |
| 全量测试        | `pnpm test`                                                                                | 313 passed / 1 skipped，4769 passed / 4 skipped，25.38s |

## 五、下一步

1. **不要按 A/B/C/D 原样落 flag。** 如果要做，只做收窄版：A′ 用“结构化/内容承载”替代绝对字数；B′ 把 ≤4 字最小应答拆成 `cold_absent`；加对峙守卫（凭什么/难道/你到底/你总是）。
2. **前置硬条件**：先补 D-1 人工标注基线与对峙语料。当前 `data/quality/` 无标注文件，本地对峙样本为 0，无法证明“neutral 下降”是修好还是判错。
3. **更稳的路线是模型轨**：先用 `ENGINE_MODEL_CLASSIFIER_MODE=shadow` 观察模型轨的真实 `holding_present` / `cold_absent` 分布，再决定是否启用；不要用规则词表补。
4. **口径治理**：批次指标与回放必须带 `classifierSemantics` + 词表版本戳；否则落盘标签与当前 v2 的 37/205（18.0%）差异会持续污染结论。
