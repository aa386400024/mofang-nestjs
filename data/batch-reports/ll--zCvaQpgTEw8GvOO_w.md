# 批次 ll--zCvaQpgTEw8GvOO_w

- 计算时间: 2026-11-10T18:10:16.251Z
- 配置指纹 combined: `418e08ca1224e53e`
- 纳入/期望: 3/3, 总轮数 12
- intake 验收: **FAIL**

## 指标

| 指标                                   | 值        |
| -------------------------------------- | --------- |
| `dim.trust.first_avg`                  | 0.26      |
| `dim.trust.last_avg`                   | 0.392     |
| `dim.trust.delta_avg`                  | 0.132     |
| `dim.trust.per_turn_rate`              | 0.033     |
| `dim.trust.p10`                        | 0.304     |
| `dim.trust.p90`                        | 0.4768    |
| `dim.safety.first_avg`                 | 0.36      |
| `dim.safety.last_avg`                  | 0.377333  |
| `dim.safety.delta_avg`                 | 0.017333  |
| `dim.safety.per_turn_rate`             | 0.004333  |
| `dim.safety.p10`                       | 0.3148    |
| `dim.safety.p90`                       | 0.4252    |
| `dim.bond.first_avg`                   | 0.36      |
| `dim.bond.last_avg`                    | 0.374667  |
| `dim.bond.delta_avg`                   | 0.014667  |
| `dim.bond.per_turn_rate`               | 0.003667  |
| `dim.bond.p10`                         | 0.1706    |
| `dim.bond.p90`                         | 0.5234    |
| `dim.valence.first_avg`                | -0.516667 |
| `dim.valence.last_avg`                 | -0.39     |
| `dim.valence.delta_avg`                | 0.126667  |
| `dim.valence.per_turn_rate`            | 0.031667  |
| `dim.valence.p10`                      | -0.51     |
| `dim.valence.p90`                      | -0.286    |
| `dim.arousal.first_avg`                | 0.463333  |
| `dim.arousal.last_avg`                 | 0.4       |
| `dim.arousal.delta_avg`                | -0.063333 |
| `dim.arousal.per_turn_rate`            | -0.015833 |
| `dim.arousal.p10`                      | 0.186     |
| `dim.arousal.p90`                      | 0.562     |
| `dim.verbal.first_avg`                 | 0.496667  |
| `dim.verbal.last_avg`                  | 0.384487  |
| `dim.verbal.delta_avg`                 | -0.112179 |
| `dim.verbal.per_turn_rate`             | -0.028045 |
| `dim.verbal.p10`                       | 0.26      |
| `dim.verbal.p90`                       | 0.534769  |
| `dim.depth.first_avg`                  | 0.533333  |
| `dim.depth.last_avg`                   | 0.391026  |
| `dim.depth.delta_avg`                  | -0.142308 |
| `dim.depth.per_turn_rate`              | -0.035577 |
| `dim.depth.p10`                        | 0.295     |
| `dim.depth.p90`                        | 0.493462  |
| `dim.style.first_avg`                  | 0.436667  |
| `dim.style.last_avg`                   | 0.350449  |
| `dim.style.delta_avg`                  | -0.086218 |
| `dim.style.per_turn_rate`              | -0.021554 |
| `dim.style.p10`                        | 0.255     |
| `dim.style.p90`                        | 0.464077  |
| `event.empathy.count`                  | 3         |
| `event.empathy.rate`                   | 0.25      |
| `event.acceptance.count`               | 1         |
| `event.acceptance.rate`                | 0.083333  |
| `event.normalization.count`            | 0         |
| `event.normalization.rate`             | 0         |
| `event.open_probe.count`               | 0         |
| `event.open_probe.rate`                | 0         |
| `event.affirmation.count`              | 0         |
| `event.affirmation.rate`               | 0         |
| `event.judgment.count`                 | 0         |
| `event.judgment.rate`                  | 0         |
| `event.preaching.count`                | 0         |
| `event.preaching.rate`                 | 0         |
| `event.minimizing.count`               | 0         |
| `event.minimizing.rate`                | 0         |
| `event.boundary_cross.count`           | 0         |
| `event.boundary_cross.rate`            | 0         |
| `event.sensitive_touch.count`          | 0         |
| `event.sensitive_touch.rate`           | 0         |
| `event.neutral.count`                  | 8         |
| `event.neutral.rate`                   | 0.666667  |
| `event.positive.rate`                  | 0.333333  |
| `strategy.simple_response.count`       | 3         |
| `strategy.simple_response.rate`        | 0.25      |
| `strategy.request.count`               | 0         |
| `strategy.request.rate`                | 0         |
| `strategy.recounting.count`            | 8         |
| `strategy.recounting.rate`             | 0.666667  |
| `strategy.cognitive_exploration.count` | 0         |
| `strategy.cognitive_exploration.rate`  | 0         |
| `strategy.affective_exploration.count` | 0         |
| `strategy.affective_exploration.rate`  | 0         |
| `strategy.insight.count`               | 0         |
| `strategy.insight.rate`                | 0         |
| `strategy.discussing_plans.count`      | 0         |
| `strategy.discussing_plans.rate`       | 0         |
| `strategy.resistance.count`            | 1         |
| `strategy.resistance.rate`             | 0.083333  |
| `exploration.rate`                     | 0         |
| `session.zero_motion`                  | 0         |
| `session.outcome.completed`            | 3         |
| `session.outcome.crisis_ended`         | 0         |
| `session.outcome.stagnant`             | 0         |
| `session.outcome.failed`               | 0         |
| `pipeline.llm_call_ratio`              | 1         |
| `pipeline.fallback_ratio`              | 0         |

## 未达标项

- `dim.depth.delta_avg` (实际 -0.142308): 深度防御是保护性的, 不该被几次共情打穿 (现状 -0.27~-0.32 严重超标)
- `dim.style.delta_avg` (实际 -0.086218): 人格级表达风格防御稳定
- `dim.arousal.delta_avg` (实际 -0.063333): 结束时唤醒仍可能高于基线 (谈痛苦被激活), 不要求下降
