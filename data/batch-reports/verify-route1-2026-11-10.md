# 批次 verify-route1-2026-11-10

- 计算时间: 2026-11-10T18:10:16.022Z
- 配置指纹 combined: `418e08ca1224e53e`
- 纳入/期望: 16/16, 总轮数 331
- intake 验收: **FAIL**

## 指标

| 指标                                   | 值        |
| -------------------------------------- | --------- |
| `dim.trust.first_avg`                  | 0.27625   |
| `dim.trust.last_avg`                   | 0.431625  |
| `dim.trust.delta_avg`                  | 0.155375  |
| `dim.trust.per_turn_rate`              | 0.005512  |
| `dim.trust.p10`                        | 0.2       |
| `dim.trust.p90`                        | 0.663     |
| `dim.safety.first_avg`                 | 0.341875  |
| `dim.safety.last_avg`                  | 0.362313  |
| `dim.safety.delta_avg`                 | 0.020438  |
| `dim.safety.per_turn_rate`             | 0.000659  |
| `dim.safety.p10`                       | 0.218     |
| `dim.safety.p90`                       | 0.557     |
| `dim.bond.first_avg`                   | 0.272813  |
| `dim.bond.last_avg`                    | 0.287875  |
| `dim.bond.delta_avg`                   | 0.015063  |
| `dim.bond.per_turn_rate`               | 0.000506  |
| `dim.bond.p10`                         | 0.065     |
| `dim.bond.p90`                         | 0.5195    |
| `dim.valence.first_avg`                | -0.46875  |
| `dim.valence.last_avg`                 | -0.29     |
| `dim.valence.delta_avg`                | 0.17875   |
| `dim.valence.per_turn_rate`            | 0.006103  |
| `dim.valence.p10`                      | -0.55     |
| `dim.valence.p90`                      | 0.055     |
| `dim.arousal.first_avg`                | 0.440625  |
| `dim.arousal.last_avg`                 | 0.370625  |
| `dim.arousal.delta_avg`                | -0.07     |
| `dim.arousal.per_turn_rate`            | -0.001959 |
| `dim.arousal.p10`                      | 0.005     |
| `dim.arousal.p90`                      | 0.725     |
| `dim.verbal.first_avg`                 | 0.481154  |
| `dim.verbal.last_avg`                  | 0.350849  |
| `dim.verbal.delta_avg`                 | -0.130304 |
| `dim.verbal.per_turn_rate`             | -0.004556 |
| `dim.verbal.p10`                       | 0.1       |
| `dim.verbal.p90`                       | 0.585     |
| `dim.depth.first_avg`                  | 0.546442  |
| `dim.depth.last_avg`                   | 0.381667  |
| `dim.depth.delta_avg`                  | -0.164776 |
| `dim.depth.per_turn_rate`              | -0.005746 |
| `dim.depth.p10`                        | 0.1075    |
| `dim.depth.p90`                        | 0.68      |
| `dim.style.first_avg`                  | 0.479615  |
| `dim.style.last_avg`                   | 0.377889  |
| `dim.style.delta_avg`                  | -0.101727 |
| `dim.style.per_turn_rate`              | -0.003422 |
| `dim.style.p10`                        | 0.185     |
| `dim.style.p90`                        | 0.6       |
| `event.empathy.count`                  | 27        |
| `event.empathy.rate`                   | 0.081571  |
| `event.acceptance.count`               | 8         |
| `event.acceptance.rate`                | 0.024169  |
| `event.normalization.count`            | 1         |
| `event.normalization.rate`             | 0.003021  |
| `event.open_probe.count`               | 0         |
| `event.open_probe.rate`                | 0         |
| `event.affirmation.count`              | 0         |
| `event.affirmation.rate`               | 0         |
| `event.judgment.count`                 | 0         |
| `event.judgment.rate`                  | 0         |
| `event.preaching.count`                | 2         |
| `event.preaching.rate`                 | 0.006042  |
| `event.minimizing.count`               | 2         |
| `event.minimizing.rate`                | 0.006042  |
| `event.boundary_cross.count`           | 0         |
| `event.boundary_cross.rate`            | 0         |
| `event.sensitive_touch.count`          | 1         |
| `event.sensitive_touch.rate`           | 0.003021  |
| `event.neutral.count`                  | 290       |
| `event.neutral.rate`                   | 0.876133  |
| `event.positive.rate`                  | 0.108761  |
| `strategy.simple_response.count`       | 22        |
| `strategy.simple_response.rate`        | 0.066465  |
| `strategy.request.count`               | 0         |
| `strategy.request.rate`                | 0         |
| `strategy.recounting.count`            | 252       |
| `strategy.recounting.rate`             | 0.761329  |
| `strategy.cognitive_exploration.count` | 0         |
| `strategy.cognitive_exploration.rate`  | 0         |
| `strategy.affective_exploration.count` | 3         |
| `strategy.affective_exploration.rate`  | 0.009063  |
| `strategy.insight.count`               | 0         |
| `strategy.insight.rate`                | 0         |
| `strategy.discussing_plans.count`      | 0         |
| `strategy.discussing_plans.rate`       | 0         |
| `strategy.resistance.count`            | 54        |
| `strategy.resistance.rate`             | 0.163142  |
| `exploration.rate`                     | 0.0625    |
| `session.zero_motion`                  | 4         |
| `session.outcome.completed`            | 15        |
| `session.outcome.crisis_ended`         | 1         |
| `session.outcome.stagnant`             | 0         |
| `session.outcome.failed`               | 0         |
| `pipeline.llm_call_ratio`              | 0         |
| `pipeline.fallback_ratio`              | 0         |

## 未达标项

- `dim.depth.delta_avg` (实际 -0.164776): 深度防御是保护性的, 不该被几次共情打穿 (现状 -0.27~-0.32 严重超标)
- `dim.style.delta_avg` (实际 -0.101727): 人格级表达风格防御稳定
- `dim.arousal.delta_avg` (实际 -0.07): 结束时唤醒仍可能高于基线 (谈痛苦被激活), 不要求下降
- `session.zero_motion` (实际 4): 零变化场次应为 0; 否则说明冷漠被静默成中性、检测失效
