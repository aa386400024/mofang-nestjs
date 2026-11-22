# AF-323 · 真实语料分类器影子审计（2026-11-23）

- 数据源：`data/debug-sessions`，AF-322 调试批次 8 场目标 trace
- 抽样：每场最后 2 个咨询师轮，总调用上限 14
- 模式：`shadow`（规则轨照常产出 core 结果，模型轨只观测）
- 模型：`MiniMax-M3.1-Flash`，分类器 prompt `model-event-classifier-v1`
- 隐私：只输出 id / 计数 / 比率 / 标签 / 模型标识；不输出任何咨询师或来访原文

## 1. 覆盖

| 项目 | 结果 |
| --- | --- |
| 目标场次 | 8 |
| 实际读到 trace | 7 |
| 缺失场次 | `debug_5fF1I9GduTiJN0B_mkuZi`（本地无同名文件，存在相近 `debug_5fF7I9...`，未冒充同一场） |
| 可抽样轮 | 14 |
| 有效观测 | 14 |
| 模型调用成功 | 13 |
| 降级轮 | 1（`fetch_error`，3 次 3s 超时后回落规则轨） |

## 2. 主指标

| 指标 | 值 |
| --- | --- |
| exact agreement | 1 / 13（0.0769） |
| mean Jaccard | 0.1859 |
| mean confidence（可用轮） | 0.8908 |
| 规则轨 neutral 率 | 9 / 13（0.6923） |
| 模型轨 neutral 率 | 1 / 13（0.0769） |
| 两轨同判 neutral | 1 |
| 降级率 | 1 / 14（0.0714） |

## 3. 标签分布

| 标签 | 规则轨 | 模型轨 |
| --- | --- | --- |
| acceptance | 0 | 2 |
| affirmation | 0 | 2 |
| empathy | 4 | 8 |
| holding_present | 0 | 1 |
| neutral | 9 | 1 |
| normalization | 0 | 1 |
| open_probe | 0 | 9 |
| sensitive_touch | 0 | 8 |

## 4. 分场次

| 场次 | 轮数 | 降级 | exact | mean Jaccard |
| --- | --- | --- | --- | --- |
| debug_zenPFZu7VbSAW4LCC0_rN | 2 | 0 | 1 | 0.5000 |
| debug_PNbYXZIn3MQQt-EOlUVvm | 2 | 0 | 0 | 0.2500 |
| debug_xw7uAJodsn6o3ln9FGL_Q | 2 | 0 | 0 | 0.2917 |
| debug_s6HNZ_d_YYBHCLF2PLHNd | 2 | 0 | 0 | 0.1667 |
| debug_q_VTpzjWZQwWDcAjUuJY0 | 2 | 1 | 0 | 0.0000 |
| debug_5fF1I9GduTiJN0B_mkuZi | 0 | 0 | 0 | n/a |
| debug_aV8cenevSHfgmGB2Zkflf | 2 | 0 | 0 | 0.0000 |
| debug_PqbSdWdJDumFk6LULjVvv | 2 | 0 | 0 | 0.0000 |

## 5. 结论

**不建议把模型轨切到 `llm_active`。** 本轮影子数据暴露的是模型轨系统性过判，而不是偶发误差：

1. 规则轨判 neutral 的 9 轮里，模型轨有 8 轮改判成具体事件；模型轨 neutral 率仅 0.0769，规则轨为 0.6923。
2. `sensitive_touch` 在 13 个可用轮里出现 8 次，`open_probe` 出现 9 次；两者在规则轨均为 0。这个分布说明 prompt 把普通探问与敏感议题触碰的边界放得过宽。
3. exact agreement 0.0769、mean Jaccard 0.1859，两轨几乎不在同一套标签空间；这不是「模型更细」可以解释的差距。
4. 1 轮在 3 次 3s 超时后降级，说明 3s 超时在真实网络下并不稳定；灰度前需要单独评估 P95 延迟与降级率。

模型轨仍保持 `shadow`，生产判定与 delta 零变化。上述结论只针对当前 prompt、当前模型与这批尾部抽样。

## 6. 限制

1. 样本只有 14 轮（13 可用），且每场只取最后 2 个咨询师轮；尾部轮次偏向收束与总结，不能代表整场分布。
2. 一致性口径是规则轨 vs 模型轨，不是人工金标准；低一致率不能直接判定模型错，也不能判定规则轨对。
3. 只跑了一次，未做 prompt 变体、温度变体与跨模型复评。
4. 8 场中 1 场本地缺失，实际覆盖 7 场。
5. 模型轨的 raw 分类输出未落盘，标签分布是观测记录聚合；无法从本报告反查某一轮的模型原文（这是隐私红线的预期代价）。

## 7. 下一步

1. 按场次分层抽全 20 轮（不只尾部），扩大到至少 7 场 × 10 轮，重跑同一脚本。
2. 收紧 `sensitive_touch` 与 `open_probe` 的 prompt 判定条件，把「普通探问」和「触碰敏感议题」拆成互斥规则。
3. 以规则轨 neutral 轮为重点样本，核对模型轨改判的假阳性；同时抽规则轨非 neutral 轮核对漏判。
4. 延迟侧记录 P50 / P95 / 超时率，再决定 `llm_active` 的超时与重试预算。
5. 只有在影子一致性与人工抽检都达到预设门槛后，才讨论按 sessionId 白名单小流量切换。

## 8. 复现

```text
pnpm audit:classifier-shadow -- --rule-only --sample-per-session 3
pnpm audit:classifier-shadow -- --sample-per-session 2 --limit 14
```

日志：`docs/team/agent-orchestration/transport/af323-audit-shadow.log`（gitignored，仅本机取证）。
