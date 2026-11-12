# 批次 g3ONzlqSGMVJqkFMF9Lwh

- 计算时间: 2026-11-12T04:58:31.148Z
- 配置指纹 combined: `491558624aeafdb3`
- 纳入/期望: 96/96, 总轮数 1112
- intake 验收: **FAIL**

## 指标

| 指标                                   | 值        |
| -------------------------------------- | --------- |
| `dim.trust.first_avg`                  | 0.298542  |
| `dim.trust.last_avg`                   | 0.382667  |
| `dim.trust.delta_avg`                  | 0.084125  |
| `dim.trust.per_turn_rate`              | 0.007072  |
| `dim.trust.p10`                        | 0.18      |
| `dim.trust.p90`                        | 0.685     |
| `dim.safety.first_avg`                 | 0.325354  |
| `dim.safety.last_avg`                  | 0.337719  |
| `dim.safety.delta_avg`                 | 0.012365  |
| `dim.safety.per_turn_rate`             | 0.001037  |
| `dim.safety.p10`                       | 0.118     |
| `dim.safety.p90`                       | 0.7       |
| `dim.bond.first_avg`                   | 0.38774   |
| `dim.bond.last_avg`                    | 0.395948  |
| `dim.bond.delta_avg`                   | 0.008208  |
| `dim.bond.per_turn_rate`               | 0.00069   |
| `dim.bond.p10`                         | 0.115     |
| `dim.bond.p90`                         | 0.65      |
| `dim.valence.first_avg`                | -0.478125 |
| `dim.valence.last_avg`                 | -0.464375 |
| `dim.valence.delta_avg`                | 0.01375   |
| `dim.valence.per_turn_rate`            | 0.001113  |
| `dim.valence.p10`                      | -0.625    |
| `dim.valence.p90`                      | -0.165    |
| `dim.arousal.first_avg`                | 0.454583  |
| `dim.arousal.last_avg`                 | 0.447292  |
| `dim.arousal.delta_avg`                | -0.007292 |
| `dim.arousal.per_turn_rate`            | -0.000545 |
| `dim.arousal.p10`                      | 0.18      |
| `dim.arousal.p90`                      | 0.685     |
| `dim.verbal.first_avg`                 | 0.480547  |
| `dim.verbal.last_avg`                  | 0.459083  |
| `dim.verbal.delta_avg`                 | -0.021464 |
| `dim.verbal.per_turn_rate`             | -0.001781 |
| `dim.verbal.p10`                       | 0.25      |
| `dim.verbal.p90`                       | 0.625385  |
| `dim.depth.first_avg`                  | 0.493281  |
| `dim.depth.last_avg`                   | 0.483232  |
| `dim.depth.delta_avg`                  | -0.010049 |
| `dim.depth.per_turn_rate`              | -0.000827 |
| `dim.depth.p10`                        | 0.25      |
| `dim.depth.p90`                        | 0.684615  |
| `dim.style.first_avg`                  | 0.474766  |
| `dim.style.last_avg`                   | 0.474845  |
| `dim.style.delta_avg`                  | 0.000079  |
| `dim.style.per_turn_rate`              | 0.000032  |
| `dim.style.p10`                        | 0.28875   |
| `dim.style.p90`                        | 0.680769  |
| `event.empathy.count`                  | 92        |
| `event.empathy.rate`                   | 0.082734  |
| `event.acceptance.count`               | 14        |
| `event.acceptance.rate`                | 0.01259   |
| `event.normalization.count`            | 2         |
| `event.normalization.rate`             | 0.001799  |
| `event.open_probe.count`               | 2         |
| `event.open_probe.rate`                | 0.001799  |
| `event.affirmation.count`              | 0         |
| `event.affirmation.rate`               | 0         |
| `event.judgment.count`                 | 2         |
| `event.judgment.rate`                  | 0.001799  |
| `event.preaching.count`                | 4         |
| `event.preaching.rate`                 | 0.003597  |
| `event.minimizing.count`               | 5         |
| `event.minimizing.rate`                | 0.004496  |
| `event.boundary_cross.count`           | 0         |
| `event.boundary_cross.rate`            | 0         |
| `event.sensitive_touch.count`          | 6         |
| `event.sensitive_touch.rate`           | 0.005396  |
| `event.neutral.count`                  | 994       |
| `event.neutral.rate`                   | 0.893885  |
| `event.positive.rate`                  | 0.098921  |
| `strategy.simple_response.count`       | 191       |
| `strategy.simple_response.rate`        | 0.171763  |
| `strategy.request.count`               | 0         |
| `strategy.request.rate`                | 0         |
| `strategy.recounting.count`            | 535       |
| `strategy.recounting.rate`             | 0.481115  |
| `strategy.cognitive_exploration.count` | 3         |
| `strategy.cognitive_exploration.rate`  | 0.002698  |
| `strategy.affective_exploration.count` | 137       |
| `strategy.affective_exploration.rate`  | 0.123201  |
| `strategy.insight.count`               | 0         |
| `strategy.insight.rate`                | 0         |
| `strategy.discussing_plans.count`      | 0         |
| `strategy.discussing_plans.rate`       | 0         |
| `strategy.resistance.count`            | 246       |
| `strategy.resistance.rate`             | 0.221223  |
| `exploration.rate`                     | 0.125     |
| `session.zero_motion`                  | 38        |
| `session.outcome.completed`            | 91        |
| `session.outcome.crisis_ended`         | 5         |
| `session.outcome.stagnant`             | 0         |
| `session.outcome.failed`               | 0         |
| `pipeline.llm_call_ratio`              | 1         |
| `pipeline.fallback_ratio`              | 0         |

## 未达标项

- `dim.safety.delta_avg` (实际 0.012365): 试探性安全, 只小幅涨
- `session.zero_motion` (实际 38): 零变化场次应为 0; 否则说明冷漠被静默成中性、检测失效
