# 批次 XhkRkyS0NFJp-4EXDQZVx

- 计算时间: 2026-11-10T18:10:16.386Z
- 配置指纹 combined: `418e08ca1224e53e`
- 纳入/期望: 1/1, 总轮数 2
- intake 验收: **FAIL**

## 指标

| 指标                                   | 值    |
| -------------------------------------- | ----- |
| `dim.trust.first_avg`                  | 0.28  |
| `dim.trust.last_avg`                   | 0.28  |
| `dim.trust.delta_avg`                  | 0     |
| `dim.trust.per_turn_rate`              | 0     |
| `dim.trust.p10`                        | 0.28  |
| `dim.trust.p90`                        | 0.28  |
| `dim.safety.first_avg`                 | 0.4   |
| `dim.safety.last_avg`                  | 0.4   |
| `dim.safety.delta_avg`                 | 0     |
| `dim.safety.per_turn_rate`             | 0     |
| `dim.safety.p10`                       | 0.4   |
| `dim.safety.p90`                       | 0.4   |
| `dim.bond.first_avg`                   | 0.5   |
| `dim.bond.last_avg`                    | 0.5   |
| `dim.bond.delta_avg`                   | 0     |
| `dim.bond.per_turn_rate`               | 0     |
| `dim.bond.p10`                         | 0.5   |
| `dim.bond.p90`                         | 0.5   |
| `dim.valence.first_avg`                | -0.45 |
| `dim.valence.last_avg`                 | -0.45 |
| `dim.valence.delta_avg`                | 0     |
| `dim.valence.per_turn_rate`            | 0     |
| `dim.valence.p10`                      | -0.45 |
| `dim.valence.p90`                      | -0.45 |
| `dim.arousal.first_avg`                | 0.62  |
| `dim.arousal.last_avg`                 | 0.62  |
| `dim.arousal.delta_avg`                | 0     |
| `dim.arousal.per_turn_rate`            | 0     |
| `dim.arousal.p10`                      | 0.62  |
| `dim.arousal.p90`                      | 0.62  |
| `dim.verbal.first_avg`                 | 0.42  |
| `dim.verbal.last_avg`                  | 0.42  |
| `dim.verbal.delta_avg`                 | 0     |
| `dim.verbal.per_turn_rate`             | 0     |
| `dim.verbal.p10`                       | 0.42  |
| `dim.verbal.p90`                       | 0.42  |
| `dim.depth.first_avg`                  | 0.5   |
| `dim.depth.last_avg`                   | 0.5   |
| `dim.depth.delta_avg`                  | 0     |
| `dim.depth.per_turn_rate`              | 0     |
| `dim.depth.p10`                        | 0.5   |
| `dim.depth.p90`                        | 0.5   |
| `dim.style.first_avg`                  | 0.38  |
| `dim.style.last_avg`                   | 0.38  |
| `dim.style.delta_avg`                  | 0     |
| `dim.style.per_turn_rate`              | 0     |
| `dim.style.p10`                        | 0.38  |
| `dim.style.p90`                        | 0.38  |
| `event.empathy.count`                  | 0     |
| `event.empathy.rate`                   | 0     |
| `event.acceptance.count`               | 0     |
| `event.acceptance.rate`                | 0     |
| `event.normalization.count`            | 0     |
| `event.normalization.rate`             | 0     |
| `event.open_probe.count`               | 0     |
| `event.open_probe.rate`                | 0     |
| `event.affirmation.count`              | 0     |
| `event.affirmation.rate`               | 0     |
| `event.judgment.count`                 | 0     |
| `event.judgment.rate`                  | 0     |
| `event.preaching.count`                | 0     |
| `event.preaching.rate`                 | 0     |
| `event.minimizing.count`               | 0     |
| `event.minimizing.rate`                | 0     |
| `event.boundary_cross.count`           | 0     |
| `event.boundary_cross.rate`            | 0     |
| `event.sensitive_touch.count`          | 0     |
| `event.sensitive_touch.rate`           | 0     |
| `event.neutral.count`                  | 2     |
| `event.neutral.rate`                   | 1     |
| `event.positive.rate`                  | 0     |
| `strategy.simple_response.count`       | 0     |
| `strategy.simple_response.rate`        | 0     |
| `strategy.request.count`               | 0     |
| `strategy.request.rate`                | 0     |
| `strategy.recounting.count`            | 2     |
| `strategy.recounting.rate`             | 1     |
| `strategy.cognitive_exploration.count` | 0     |
| `strategy.cognitive_exploration.rate`  | 0     |
| `strategy.affective_exploration.count` | 0     |
| `strategy.affective_exploration.rate`  | 0     |
| `strategy.insight.count`               | 0     |
| `strategy.insight.rate`                | 0     |
| `strategy.discussing_plans.count`      | 0     |
| `strategy.discussing_plans.rate`       | 0     |
| `strategy.resistance.count`            | 0     |
| `strategy.resistance.rate`             | 0     |
| `exploration.rate`                     | 0     |
| `session.zero_motion`                  | 1     |
| `session.outcome.completed`            | 1     |
| `session.outcome.crisis_ended`         | 0     |
| `session.outcome.stagnant`             | 0     |
| `session.outcome.failed`               | 0     |
| `pipeline.llm_call_ratio`              | 1     |
| `pipeline.fallback_ratio`              | 0     |

## 未达标项

- `dim.trust.delta_avg` (实际 0): 首次会谈信任温和上升; 焦虑型快速理想化
- `dim.safety.delta_avg` (实际 0): 试探性安全, 只小幅涨
- `session.zero_motion` (实际 1): 零变化场次应为 0; 否则说明冷漠被静默成中性、检测失效
