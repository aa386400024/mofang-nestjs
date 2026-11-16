# 批次 verify-route1-2026-11-10-r2

- 计算时间: 2026-11-10T18:10:16.172Z
- 配置指纹 combined: `418e08ca1224e53e`
- 纳入/期望: 16/16, 总轮数 185
- intake 验收: **FAIL**

## 指标

| 指标                                   | 值        |
| -------------------------------------- | --------- |
| `dim.trust.first_avg`                  | 0.27625   |
| `dim.trust.last_avg`                   | 0.397     |
| `dim.trust.delta_avg`                  | 0.12075   |
| `dim.trust.per_turn_rate`              | 0.010608  |
| `dim.trust.p10`                        | 0.245     |
| `dim.trust.p90`                        | 0.593     |
| `dim.safety.first_avg`                 | 0.341875  |
| `dim.safety.last_avg`                  | 0.358375  |
| `dim.safety.delta_avg`                 | 0.0165    |
| `dim.safety.per_turn_rate`             | 0.001464  |
| `dim.safety.p10`                       | 0.218     |
| `dim.safety.p90`                       | 0.541     |
| `dim.bond.first_avg`                   | 0.272813  |
| `dim.bond.last_avg`                    | 0.284625  |
| `dim.bond.delta_avg`                   | 0.011813  |
| `dim.bond.per_turn_rate`               | 0.001039  |
| `dim.bond.p10`                         | 0.0525    |
| `dim.bond.p90`                         | 0.513     |
| `dim.valence.first_avg`                | -0.46875  |
| `dim.valence.last_avg`                 | -0.328125 |
| `dim.valence.delta_avg`                | 0.140625  |
| `dim.valence.per_turn_rate`            | 0.012465  |
| `dim.valence.p10`                      | -0.525    |
| `dim.valence.p90`                      | -0.14     |
| `dim.arousal.first_avg`                | 0.440625  |
| `dim.arousal.last_avg`                 | 0.37875   |
| `dim.arousal.delta_avg`                | -0.061875 |
| `dim.arousal.per_turn_rate`            | -0.00553  |
| `dim.arousal.p10`                      | 0.03      |
| `dim.arousal.p90`                      | 0.635     |
| `dim.verbal.first_avg`                 | 0.481154  |
| `dim.verbal.last_avg`                  | 0.374423  |
| `dim.verbal.delta_avg`                 | -0.106731 |
| `dim.verbal.per_turn_rate`             | -0.009373 |
| `dim.verbal.p10`                       | 0.21      |
| `dim.verbal.p90`                       | 0.573462  |
| `dim.depth.first_avg`                  | 0.546442  |
| `dim.depth.last_avg`                   | 0.410569  |
| `dim.depth.delta_avg`                  | -0.135873 |
| `dim.depth.per_turn_rate`              | -0.011928 |
| `dim.depth.p10`                        | 0.2175    |
| `dim.depth.p90`                        | 0.609872  |
| `dim.style.first_avg`                  | 0.479615  |
| `dim.style.last_avg`                   | 0.400232  |
| `dim.style.delta_avg`                  | -0.079383 |
| `dim.style.per_turn_rate`              | -0.006981 |
| `dim.style.p10`                        | 0.2075    |
| `dim.style.p90`                        | 0.576923  |
| `event.empathy.count`                  | 22        |
| `event.empathy.rate`                   | 0.118919  |
| `event.acceptance.count`               | 5         |
| `event.acceptance.rate`                | 0.027027  |
| `event.normalization.count`            | 0         |
| `event.normalization.rate`             | 0         |
| `event.open_probe.count`               | 0         |
| `event.open_probe.rate`                | 0         |
| `event.affirmation.count`              | 0         |
| `event.affirmation.rate`               | 0         |
| `event.judgment.count`                 | 0         |
| `event.judgment.rate`                  | 0         |
| `event.preaching.count`                | 1         |
| `event.preaching.rate`                 | 0.005405  |
| `event.minimizing.count`               | 1         |
| `event.minimizing.rate`                | 0.005405  |
| `event.boundary_cross.count`           | 0         |
| `event.boundary_cross.rate`            | 0         |
| `event.sensitive_touch.count`          | 1         |
| `event.sensitive_touch.rate`           | 0.005405  |
| `event.neutral.count`                  | 155       |
| `event.neutral.rate`                   | 0.837838  |
| `event.positive.rate`                  | 0.145946  |
| `strategy.simple_response.count`       | 22        |
| `strategy.simple_response.rate`        | 0.118919  |
| `strategy.request.count`               | 0         |
| `strategy.request.rate`                | 0         |
| `strategy.recounting.count`            | 138       |
| `strategy.recounting.rate`             | 0.745946  |
| `strategy.cognitive_exploration.count` | 0         |
| `strategy.cognitive_exploration.rate`  | 0         |
| `strategy.affective_exploration.count` | 3         |
| `strategy.affective_exploration.rate`  | 0.016216  |
| `strategy.insight.count`               | 0         |
| `strategy.insight.rate`                | 0         |
| `strategy.discussing_plans.count`      | 0         |
| `strategy.discussing_plans.rate`       | 0         |
| `strategy.resistance.count`            | 22        |
| `strategy.resistance.rate`             | 0.118919  |
| `exploration.rate`                     | 0.0625    |
| `session.zero_motion`                  | 3         |
| `session.outcome.completed`            | 16        |
| `session.outcome.crisis_ended`         | 0         |
| `session.outcome.stagnant`             | 0         |
| `session.outcome.failed`               | 0         |
| `pipeline.llm_call_ratio`              | 0         |
| `pipeline.fallback_ratio`              | 0         |

## 未达标项

- `dim.depth.delta_avg` (实际 -0.135873): 深度防御是保护性的, 不该被几次共情打穿 (现状 -0.27~-0.32 严重超标)
- `dim.style.delta_avg` (实际 -0.079383): 人格级表达风格防御稳定
- `dim.arousal.delta_avg` (实际 -0.061875): 结束时唤醒仍可能高于基线 (谈痛苦被激活), 不要求下降
- `session.zero_motion` (实际 3): 零变化场次应为 0; 否则说明冷漠被静默成中性、检测失效
