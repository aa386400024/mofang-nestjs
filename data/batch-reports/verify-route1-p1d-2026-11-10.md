# 批次 verify-route1-p1d-2026-11-10

- 计算时间: 2026-11-10T18:10:16.628Z
- 配置指纹 combined: `418e08ca1224e53e`
- 纳入/期望: 16/16, 总轮数 183
- intake 验收: **FAIL**

## 指标

| 指标                                   | 值        |
| -------------------------------------- | --------- |
| `dim.trust.first_avg`                  | 0.29625   |
| `dim.trust.last_avg`                   | 0.385     |
| `dim.trust.delta_avg`                  | 0.08875   |
| `dim.trust.per_turn_rate`              | 0.007818  |
| `dim.trust.p10`                        | 0.2       |
| `dim.trust.p90`                        | 0.73      |
| `dim.safety.first_avg`                 | 0.325     |
| `dim.safety.last_avg`                  | 0.336438  |
| `dim.safety.delta_avg`                 | 0.011438  |
| `dim.safety.per_turn_rate`             | 0.001024  |
| `dim.safety.p10`                       | 0.161     |
| `dim.safety.p90`                       | 0.581     |
| `dim.bond.first_avg`                   | 0.3875    |
| `dim.bond.last_avg`                    | 0.396813  |
| `dim.bond.delta_avg`                   | 0.009313  |
| `dim.bond.per_turn_rate`               | 0.000819  |
| `dim.bond.p10`                         | 0.1325    |
| `dim.bond.p90`                         | 0.613     |
| `dim.valence.first_avg`                | -0.47875  |
| `dim.valence.last_avg`                 | -0.3875   |
| `dim.valence.delta_avg`                | 0.09125   |
| `dim.valence.per_turn_rate`            | 0.008185  |
| `dim.valence.p10`                      | -0.55     |
| `dim.valence.p90`                      | -0.075    |
| `dim.arousal.first_avg`                | 0.455     |
| `dim.arousal.last_avg`                 | 0.42625   |
| `dim.arousal.delta_avg`                | -0.02875  |
| `dim.arousal.per_turn_rate`            | -0.002686 |
| `dim.arousal.p10`                      | 0.14      |
| `dim.arousal.p90`                      | 0.645     |
| `dim.verbal.first_avg`                 | 0.48125   |
| `dim.verbal.last_avg`                  | 0.412155  |
| `dim.verbal.delta_avg`                 | -0.069095 |
| `dim.verbal.per_turn_rate`             | -0.006126 |
| `dim.verbal.p10`                       | 0.21      |
| `dim.verbal.p90`                       | 0.538462  |
| `dim.depth.first_avg`                  | 0.49375   |
| `dim.depth.last_avg`                   | 0.409095  |
| `dim.depth.delta_avg`                  | -0.084655 |
| `dim.depth.per_turn_rate`              | -0.007525 |
| `dim.depth.p10`                        | 0.15      |
| `dim.depth.p90`                        | 0.611538  |
| `dim.style.first_avg`                  | 0.475     |
| `dim.style.last_avg`                   | 0.424579  |
| `dim.style.delta_avg`                  | -0.050421 |
| `dim.style.per_turn_rate`              | -0.004488 |
| `dim.style.p10`                        | 0.24      |
| `dim.style.p90`                        | 0.653846  |
| `event.empathy.count`                  | 13        |
| `event.empathy.rate`                   | 0.071038  |
| `event.acceptance.count`               | 2         |
| `event.acceptance.rate`                | 0.010929  |
| `event.normalization.count`            | 0         |
| `event.normalization.rate`             | 0         |
| `event.open_probe.count`               | 0         |
| `event.open_probe.rate`                | 0         |
| `event.affirmation.count`              | 1         |
| `event.affirmation.rate`               | 0.005464  |
| `event.judgment.count`                 | 0         |
| `event.judgment.rate`                  | 0         |
| `event.preaching.count`                | 0         |
| `event.preaching.rate`                 | 0         |
| `event.minimizing.count`               | 0         |
| `event.minimizing.rate`                | 0         |
| `event.boundary_cross.count`           | 0         |
| `event.boundary_cross.rate`            | 0         |
| `event.sensitive_touch.count`          | 2         |
| `event.sensitive_touch.rate`           | 0.010929  |
| `event.neutral.count`                  | 165       |
| `event.neutral.rate`                   | 0.901639  |
| `event.positive.rate`                  | 0.087432  |
| `strategy.simple_response.count`       | 20        |
| `strategy.simple_response.rate`        | 0.10929   |
| `strategy.request.count`               | 0         |
| `strategy.request.rate`                | 0         |
| `strategy.recounting.count`            | 106       |
| `strategy.recounting.rate`             | 0.579235  |
| `strategy.cognitive_exploration.count` | 0         |
| `strategy.cognitive_exploration.rate`  | 0         |
| `strategy.affective_exploration.count` | 24        |
| `strategy.affective_exploration.rate`  | 0.131148  |
| `strategy.insight.count`               | 0         |
| `strategy.insight.rate`                | 0         |
| `strategy.discussing_plans.count`      | 0         |
| `strategy.discussing_plans.rate`       | 0         |
| `strategy.resistance.count`            | 33        |
| `strategy.resistance.rate`             | 0.180328  |
| `exploration.rate`                     | 0.125     |
| `session.zero_motion`                  | 4         |
| `session.outcome.completed`            | 14        |
| `session.outcome.crisis_ended`         | 1         |
| `session.outcome.stagnant`             | 1         |
| `session.outcome.failed`               | 0         |
| `pipeline.llm_call_ratio`              | 0.9375    |
| `pipeline.fallback_ratio`              | 0.060109  |

## 未达标项

- `dim.safety.delta_avg` (实际 0.011438): 试探性安全, 只小幅涨
- `session.zero_motion` (实际 4): 零变化场次应为 0; 否则说明冷漠被静默成中性、检测失效
