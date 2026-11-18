# 批次 q_35XnpvLWLr-Yocr8kJh

- 计算时间: 2026-11-18T15:43:25.644Z
- 配置指纹 combined: `e1d4b3118bf55fa2`
- 纳入/期望: 17/17, 总轮数 748
- intake 验收 (全局 · 基线档 (intake-v1 阈值)): **FAIL**
- 回归结论: incomparable — 两批验收判据 (acceptance) 不同

## 指标

| 指标 | 值 |
|---|---|
| `dim.trust.first_avg` | 0.291765 |
| `dim.trust.last_avg` | 0.588471 |
| `dim.trust.delta_avg` | 0.296706 |
| `dim.trust.per_turn_rate` | 0.006906 |
| `dim.trust.p10` | 0.24 |
| `dim.trust.p90` | 1 |
| `dim.safety.first_avg` | 0.320588 |
| `dim.safety.last_avg` | 0.375294 |
| `dim.safety.delta_avg` | 0.054706 |
| `dim.safety.per_turn_rate` | 0.001267 |
| `dim.safety.p10` | 0.23 |
| `dim.safety.p90` | 0.614 |
| `dim.bond.first_avg` | 0.370588 |
| `dim.bond.last_avg` | 0.410471 |
| `dim.bond.delta_avg` | 0.039882 |
| `dim.bond.per_turn_rate` | 0.000888 |
| `dim.bond.p10` | 0.125 |
| `dim.bond.p90` | 0.6432 |
| `dim.valence.first_avg` | -0.482941 |
| `dim.valence.last_avg` | -0.395294 |
| `dim.valence.delta_avg` | 0.087647 |
| `dim.valence.per_turn_rate` | 0.002245 |
| `dim.valence.p10` | -0.598 |
| `dim.valence.p90` | -0.144 |
| `dim.arousal.first_avg` | 0.442941 |
| `dim.arousal.last_avg` | 0.396471 |
| `dim.arousal.delta_avg` | -0.046471 |
| `dim.arousal.per_turn_rate` | -0.00125 |
| `dim.arousal.p10` | 0.198 |
| `dim.arousal.p90` | 0.634 |
| `dim.verbal.first_avg` | 0.482353 |
| `dim.verbal.last_avg` | 0.382722 |
| `dim.verbal.delta_avg` | -0.09963 |
| `dim.verbal.per_turn_rate` | -0.002321 |
| `dim.verbal.p10` | 0.180667 |
| `dim.verbal.p90` | 0.553077 |
| `dim.depth.first_avg` | 0.502941 |
| `dim.depth.last_avg` | 0.438786 |
| `dim.depth.delta_avg` | -0.064155 |
| `dim.depth.per_turn_rate` | -0.00154 |
| `dim.depth.p10` | 0.166 |
| `dim.depth.p90` | 0.653846 |
| `dim.style.first_avg` | 0.488235 |
| `dim.style.last_avg` | 0.469687 |
| `dim.style.delta_avg` | -0.018548 |
| `dim.style.per_turn_rate` | -0.000489 |
| `dim.style.p10` | 0.262 |
| `dim.style.p90` | 0.711692 |
| `event.empathy.count` | 69 |
| `event.empathy.rate` | 0.092246 |
| `event.acceptance.count` | 8 |
| `event.acceptance.rate` | 0.010695 |
| `event.normalization.count` | 0 |
| `event.normalization.rate` | 0 |
| `event.open_probe.count` | 1 |
| `event.open_probe.rate` | 0.001337 |
| `event.affirmation.count` | 0 |
| `event.affirmation.rate` | 0 |
| `event.judgment.count` | 0 |
| `event.judgment.rate` | 0 |
| `event.preaching.count` | 3 |
| `event.preaching.rate` | 0.004011 |
| `event.minimizing.count` | 1 |
| `event.minimizing.rate` | 0.001337 |
| `event.boundary_cross.count` | 0 |
| `event.boundary_cross.rate` | 0 |
| `event.sensitive_touch.count` | 4 |
| `event.sensitive_touch.rate` | 0.005348 |
| `event.neutral.count` | 665 |
| `event.neutral.rate` | 0.889037 |
| `event.holding_present.count` | 0 |
| `event.holding_present.rate` | 0 |
| `event.cold_absent.count` | 0 |
| `event.cold_absent.rate` | 0 |
| `event.positive.rate` | 0.104278 |
| `strategy.simple_response.count` | 72 |
| `strategy.simple_response.rate` | 0.096257 |
| `strategy.request.count` | 0 |
| `strategy.request.rate` | 0 |
| `strategy.recounting.count` | 444 |
| `strategy.recounting.rate` | 0.593583 |
| `strategy.cognitive_exploration.count` | 24 |
| `strategy.cognitive_exploration.rate` | 0.032086 |
| `strategy.affective_exploration.count` | 76 |
| `strategy.affective_exploration.rate` | 0.101604 |
| `strategy.insight.count` | 0 |
| `strategy.insight.rate` | 0 |
| `strategy.discussing_plans.count` | 0 |
| `strategy.discussing_plans.rate` | 0 |
| `strategy.resistance.count` | 132 |
| `strategy.resistance.rate` | 0.176471 |
| `exploration.rate` | 0.117647 |
| `exploration.character_coverage` | 0.125 |
| `session.zero_motion` | 2 |
| `session.outcome.completed` | 16 |
| `session.outcome.crisis_ended` | 0 |
| `session.outcome.stagnant` | 0 |
| `session.outcome.failed` | 1 |
| `pipeline.llm_call_ratio` | 0.941176 |
| `pipeline.fallback_ratio` | 0 |
| `text.disfluency.events_per_turn` | 0.486631 |
| `text.disfluency.event_turn_rate` | 0.378342 |
| `text.disfluency.density_per100` | 1.393035 |
| `text.disfluency.filler_per_turn` | 0.165775 |
| `text.disfluency.pause_per_turn` | 0.108289 |
| `text.disfluency.repair_per_turn` | 0.197861 |
| `text.disfluency.repetition_per_turn` | 0.014706 |
| `text.disfluency.trailoff_per_turn` | 0 |

## 未达标项 (全局)

- `dim.trust.delta_avg` (实际 0.296706): 首次会谈信任温和上升; 焦虑型快速理想化
- `dim.bond.delta_avg` (实际 0.039882): 纽带 3-5 次会谈后才成形, 首次几乎不动
- `session.zero_motion` (实际 2): 零变化场次应为 0; 否则说明冷漠被静默成中性、检测失效

## 按咨询师模式分档判定 (intake-v2)

| 模式 | 档位 | 场次 | 判定 | 未达标项 | 零变化 总/豁免/计入 |
|---|---|---|---|---|---|
| `expert` | 基线档 (intake-v1 阈值) | 8 | **FAIL** | 2 | 0/0/0 |
| `cold` | cold 负向极端档 (候选阈值 · 待主控复核) | 9 | **FAIL** | 3 | 2/0/2 |

### `expert` · 基线档 (intake-v1 阈值)
- `dim.trust.delta_avg` (实际 0.38925): 首次会谈信任温和上升; 焦虑型快速理想化
- `dim.bond.delta_avg` (实际 0.049): 纽带 3-5 次会谈后才成形, 首次几乎不动

### `cold` · cold 负向极端档 (候选阈值 · 待主控复核)
- `dim.trust.delta_avg` (实际 0.214444): 【候选 · 待主控复核】cold 冷漠输入下信任建立显著慢 (实测 0.0297, expert 0.1386); 下限 0.01 保住"完全无响应即不合格"的底线, 上限 0.08 允许明显建立
- `dim.safety.delta_avg` (实际 0.045778): 【候选 · 待主控复核】cold 切片 safety 实测 0.0035 (几乎不涨), 属试探性安全缺失的合理反应; 下限 0 允许零增长, 上限 0.03 防"无节制依赖"滑向另一端
- `dim.verbal.delta_avg` (实际 -0.074423): 【候选 · 待主控复核】cold 切片话量阻抗实测 -0.0049 (几乎不动); 收窄到 ±0.05, 捕捉"冷漠输入下话量阻抗被压垮或泄洪"这类异常
