# AF-326 · 分类器 prompt v2 影子复评（真实语料）

- 审计日期：2026-11-23
- 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-326/task-sheet.md`
- 审计脚本：`scripts/ops/quality/af322-classifier-shadow-audit.ts`（AF-323 交付，本单未改统计口径）
- 模型：`MiniMax-M3.1-Flash`
- 场景：`full_simulation`
- 模式：`shadow`（规则轨照常产出，模型轨只观测；生产判定零变化）
- 样本：`data/debug-sessions` 目标 8 场，每场抽样尾部 10 轮，总调用上限 70
- 隐私：只输出 id / 计数 / 比率 / 标签 / 模型标识；不输出任何咨询师或来访原文

## 1. 结论

prompt v2 把模型轨从「几乎不判 neutral、成批过判具体行为」拉回到与规则轨同一量级的 neutral 分布：

- **neutral 差**：v1 为 61.54 个百分点（模型 0.0769 / 规则 0.6923），v2 为 **1.52 个百分点**（模型 0.5606 / 规则 0.5758），满足「≤ 10pp」硬门槛。
- **exact**：v1 1/13（0.0769）→ v2 33/66（**0.5000**）。
- **mean Jaccard**：v1 0.1859 → v2 **0.5581**。
- **sensitive_touch**：v1 13 个可用轮出现 8 次（0.6154/轮）→ v2 66 个可用轮 **0 次**。
- **open_probe**：v1 9/13（0.6923/轮）→ v2 9/66（**0.1364/轮**），相对下降约 80.3%。
- **降级**：70 次调用降级 4 次（5.71%），全部为 3 次 3s 超时后的 `fetch_error`；比 v1 的 1/14（7.14%）略低，但仍高于早期建议的 5%。

exact 0.5000 低于早期建议的 0.60，但该值不是本任务单的硬门槛；硬门槛（neutral 差 ≤10pp、7 场 × 10 轮抽样、sensitive_touch 词表约束）已满足。**结论仍是继续 `shadow`，不切 `llm_active`**：规则轨不是人工金标准，0.50 的 exact 不足以证明模型轨可在生产替代规则轨；同时 3s 超时下的降级率仍需先治理。

## 2. 最终数字（v2）

| 指标 | 值 |
| --- | --- |
| 观测轮数 | 70 |
| 可用轮 | 66 |
| 降级轮 | 4（0.0571） |
| exact agreement | 33 / 66（0.5000） |
| mean Jaccard | 0.5581 |
| mean confidence（可用轮） | 0.9327 |
| 规则轨 neutral 率 | 38 / 66（0.5758） |
| 模型轨 neutral 率 | 37 / 66（0.5606） |
| 两轨同判 neutral | 26 |
| 模型标识 | MiniMax-M3.1-Flash |
| 缺失场次 | `debug_5fF1I9GduTiJN0B_mkuZi` |

## 3. 标签分布（按轮次计数，可多标签）

| 标签 | 规则轨 | 模型轨 |
| --- | --- | --- |
| acceptance | 3 | 5 |
| affirmation | 0 | 1 |
| empathy | 22 | 23 |
| judgment | 1 | 0 |
| minimizing | 4 | 0 |
| neutral | 38 | 37 |
| open_probe | 1 | 9 |

`sensitive_touch`、`preaching`、`boundary_cross`、`holding_present`、`cold_absent` 两轨均为 0。

## 4. 分场次

| 场次 | 抽样轮 | 降级 | exact | mean Jaccard |
| --- | --- | --- | --- | --- |
| debug_zenPFZu7VbSAW4LCC0_rN | 10 | 0 | 9 | 0.9000 |
| debug_PNbYXZIn3MQQt-EOlUVvm | 10 | 0 | 6 | 0.6000 |
| debug_xw7uAJodsn6o3ln9FGL_Q | 10 | 1 | 4 | 0.4444 |
| debug_s6HNZ_d_YYBHCLF2PLHNd | 10 | 1 | 2 | 0.3148 |
| debug_q_VTpzjWZQwWDcAjUuJY0 | 10 | 2 | 2 | 0.4375 |
| debug_aV8cenevSHfgmGB2Zkflf | 10 | 0 | 4 | 0.5500 |
| debug_PqbSdWdJDumFk6LULjVvv | 10 | 0 | 6 | 0.6000 |
| debug_5fF1I9GduTiJN0B_mkuZi | 0 | 0 | n/a | n/a |

实际覆盖 7 / 8 场；缺失场次在本地没有对应 trace，不能用相近文件名替代。

## 5. 与 v1 基线对照

v1 基线来自 `docs/worklog/completed/phase2.5/af323-classifier-shadow-audit-2026-11-23.md`（14 轮抽样、13 可用、1 降级）。

| 指标 | v1 | v2 |
| --- | --- | --- |
| 可用轮 | 13 | 66 |
| exact | 1 / 13（0.0769） | 33 / 66（0.5000） |
| mean Jaccard | 0.1859 | 0.5581 |
| 规则轨 neutral 率 | 0.6923 | 0.5758 |
| 模型轨 neutral 率 | 0.0769 | 0.5606 |
| 两轨 neutral 差 | 61.54pp | 1.52pp |
| 模型轨 `sensitive_touch` | 8 | 0 |
| 模型轨 `open_probe` | 9 | 9 |
| 降级率 | 1 / 14（0.0714） | 4 / 70（0.0571） |

v1 模型轨标签总量集中在 `open_probe` 9、`sensitive_touch` 8、`empathy` 8；v2 模型轨回落到 `neutral` 37、`empathy` 23、`open_probe` 9，与规则轨的 `neutral` 38、`empathy` 22 基本同形。

## 6. 迭代记录（为什么 v2 分两版收紧）

第一版 v2 只拆了标签定义与互斥规则，70 次调用 / 56 可用：

- exact 13/56（0.2321）、Jaccard 0.3720；
- 规则轨 neutral 0.5714、模型轨 0.2143，差 35.71pp；
- `open_probe` 27、`empathy` 38、`sensitive_touch` 0；
- 降级 14/70（20.00%）。

第一版仍把「分析 + 建议 + 句末问句」判成 `open_probe`，把分析因果时提到的情绪词判成 `empathy`。第二版补充三条约束后才达到最终数字：

1. `empathy` 必须是咨询师对**当下感受**的回应，不是分析因果、给建议或心理教育时顺带提到情绪词；
2. `open_probe` 排除行动许可、练习确认、二选一、问「愿不愿意试一次」、问「哪一句想改」；句末问号不等于 open_probe；
3. 整轮主功能是分析 / 建议 / 练习 / 心理教育时，附带问题不算 open_probe；默认只给一个具体行为标签，最多 2 个。

## 7. 限制

1. 规则轨是词法词典，不是人工金标准；exact / Jaccard 只描述两轨差异，不能当成模型准确率。
2. 样本只取每场尾部 10 轮，不是全量 20 轮；7/8 场覆盖，缺少 1 场。
3. 单模型、单次运行、`MiniMax-M3.1-Flash` 一个模型标识；未做跨模型复评。
4. 4 轮降级来自 3 次 3s 超时，说明 3s 预算在真实网络下仍不稳定；降级轮不进入 exact / Jaccard，可能影响分布。
5. 没有真实咨询师在环，也没有人工双标；本报告不构成临床有效性或安全性证据。

## 8. 下一步建议

1. 先治理 3s 超时与降级率，再评估是否扩到全量 20 轮 × 8 场。
2. 用人工双标或咨询师金标准校准 `open_probe` 剩余 9 次与 `empathy` 23 次，判断是模型对、规则漏，还是模型仍过判。
3. 在 `llm_active` 前保留 shadow 对照至少一个灰度周期；本单不切换。

## 9. 可复现命令

```bash
pnpm exec vitest run test/engine-adapters/model-event-classifier.spec.ts
pnpm audit:classifier-shadow -- --rule-only --sample-per-session 10 --limit 70
pnpm audit:classifier-shadow -- --sample-per-session 10 --limit 70
```

原始日志在 `docs/team/agent-orchestration/transport/af326-audit-*.log`（gitignored）。
